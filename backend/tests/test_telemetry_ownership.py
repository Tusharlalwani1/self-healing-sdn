"""C08 ownership tests. Fake SDN IO; isolated SQLite for persistence checks."""
import asyncio
import copy
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace
from unittest.mock import Mock

from backend.services import mininet_client as mc, traffic_service as ts, experiment_runner as er
from backend.services.operation_error import OperationError
from backend.database import db
from backend.services.mininet_worker import MininetWorker


class OwnershipFixture(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.client = mc.MininetClient()
        self.client.simulation_state = "RUNNING"
        self.client.controller_type = "reactive"
        self.client.controller_generation = "g1"
        self.jobs = {}
        self.hook = None
        self.client._send_command = AsyncMock(side_effect=self.command)
        self.client.ensure_worker = AsyncMock()
        patch.object(mc, "save_event_log").start()
        patch.object(ts, "mininet_client", self.client).start()
        patch.object(mc.ws_manager, "broadcast", new_callable=AsyncMock).start()
        self.service = ts.TrafficService()
        self.service._poll_stats = AsyncMock()
        self.addAsyncCleanup(self.cleanup)

    async def cleanup(self):
        task = self.service.polling_task
        self.service._runtime_changed([])
        if task:
            await asyncio.gather(task, return_exceptions=True)

    async def command(self, payload, **kwargs):
        command = payload["command"]
        if self.hook:
            result = self.hook(payload)
            if result is not None:
                return result
        if command == "start_traffic":
            job = {k: payload[k] for k in ("job_id", "runtime_id", "runtime_revision", "controller",
                   "controller_generation", "experiment_id", "traffic_sequence")}
            job.update(active=True, transmitted=7, received=5, loss_percent=28.57,
                       history=[], avg_rtt=2, min_rtt=1, max_rtt=3, accounting_complete=False)
            self.jobs[job["job_id"]] = job
            return {"status": "ok", **job}
        if command in ("get_traffic_stats", "stop_traffic"):
            job = self.jobs[payload["job_id"]]
            if command == "stop_traffic" or job.get("experiment_id"):
                job.update(active=False, accounting_complete=True)
            return copy.deepcopy(job)
        if command == "stop":
            for job in self.jobs.values():
                job.update(active=False, accounting_complete=True)
            return {"status": "ok", "traffic_stats": copy.deepcopy(list(self.jobs.values()))}
        if command == "get_topology":
            return {"status": "ok", "nodes": [], "links": [{"src": "s1", "dst": "s2", "status": "UP"}]}
        return {"status": "ok"}

class OwnershipTests(OwnershipFixture):
    async def test_a_b_and_final_accounting(self):
        await self.service.start(job_id="A")
        self.assertEqual((await self.service.get_stats())["transmitted"], 7)
        await self.service.stop()
        final = await self.service.get_stats()
        self.assertFalse(final["active"])
        self.assertEqual((final["transmitted"], final["received"]), (7, 5))
        await self.service.start(job_id="B")
        self.assertEqual(self.service.latest_stats["transmitted"], 0)
        self.assertEqual(self.service.latest_stats["job_id"], "B")
        self.assertGreater(self.service.latest_stats["traffic_sequence"], final["traffic_sequence"])

    async def test_delayed_rest_read_from_a_cannot_replace_b(self):
        await self.service.start(job_id="A")
        entered, release = asyncio.Event(), asyncio.Event()
        old = copy.deepcopy(self.jobs["A"])
        async def delayed(job):
            entered.set()
            await release.wait()
            return old
        with patch.object(self.client, "get_traffic_stats", AsyncMock(side_effect=delayed)):
            pending = asyncio.create_task(self.service.get_stats())
            await entered.wait()
            await self.service.start(job_id="B")
            release.set()
            result = await pending
        self.assertEqual(result["job_id"], "B")
        self.assertEqual(self.service.latest_stats["job_id"], "B")

    async def test_stop_and_restart_invalidates_old_runtime(self):
        await self.service.start(job_id="A")
        old_runtime = self.client.runtime_id
        await self.client.stop_simulation()

        self.assertIsNone(self.service.active_job_id)
        self.assertFalse((await self.service.get_stats())["active"])
        self.assertTrue(self.service.latest_stats["accounting_complete"])
        await self.client.start_simulation()
        self.assertNotEqual(self.client.runtime_id, old_runtime)
        fresh = await self.service.get_stats()
        self.assertFalse(fresh["active"])
        self.assertIsNone(fresh["job_id"])
        self.assertEqual(fresh["transmitted"], 0)
        with self.assertRaises(OperationError) as error:
            await self.client.get_traffic_stats("A")
        self.assertEqual(error.exception.status_code, 409)
        # Historical worker records from A must not make a later stop fail.
        await self.client.stop_simulation()

    async def test_completed_history_stays_final_on_simulation_stop(self):
        await self.service.start(job_id="A")
        await self.service.stop()
        await self.client.stop_simulation()
        final = await self.service.get_stats()
        self.assertEqual(final["job_id"], "A")
        self.assertEqual(final["transmitted"], 7)
        self.assertFalse(final["active"])

    async def test_switch_keeps_original_controller_and_marks_mixed_run(self):
        await self.service.start(job_id="A")
        self.client.controller_type = "baseline"
        self.client.controller_generation = "g2"
        result = await self.service.get_stats()
        self.assertEqual(result["controller"], "reactive")
        self.assertTrue(result["controller_changed"])
        self.assertTrue(result["active"])

    async def test_wrong_worker_owner_and_reused_id_rejected(self):
        await self.service.start(job_id="A")
        self.hook = lambda payload: {**self.jobs["A"], "job_id": "foreign"} if payload["command"] == "get_traffic_stats" else None
        with self.assertRaises(OperationError) as error:
            await self.client.get_traffic_stats("A")
        self.assertEqual(error.exception.status_code, 502)
        self.hook = None
        with self.assertRaises(OperationError) as error:
            await self.client.start_traffic("h1", "h2", .05, 10, "A")
        self.assertEqual(error.exception.status_code, 409)

    async def test_manual_link_failure_cannot_supply_experiment_healing(self):
        self.client.experiment_id = "owned-run"
        with self.assertRaises(OperationError) as error:
            await self.client.set_link_status("s1", "s2", "down")
        self.assertEqual(error.exception.status_code, 409)
        self.client._send_command.assert_not_awaited()
        await self.client.set_link_status("s1", "s2", "down", experiment_id="owned-run")


class ExperimentOwnershipTests(OwnershipFixture):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        patch.object(db, "DB_PATH", Path(self.directory.name) / "isolated.sqlite").start()
        db.init_db()
        patch.object(er, "mininet_client", self.client).start()
        patch.object(er, "save_event_log").start()
        patch.object(er, "save_experiment", side_effect=db.save_experiment).start()
        patch.object(er.asyncio, "sleep", new_callable=AsyncMock).start()
        self.runner = er.ExperimentRunner()
        patch.object(er.controller_manager, "active_controller", None).start()
        patch.object(er.controller_manager, "status", "STOPPED").start()
        patch.object(er.controller_manager, "generation", None).start()
        patch.object(er.controller_manager, "last_recovery_event", None).start()
        async def select(mode, **kwargs):
            er.controller_manager.active_controller = mode
            er.controller_manager.status = "READY"
            er.controller_manager.generation = uuid.uuid4().hex
            self.client.controller_type = mode
            self.client.controller_generation = er.controller_manager.generation
        patch.object(er.controller_manager, "select_controller", AsyncMock(side_effect=select)).start()

    async def test_own_job_not_manual_or_previous_experiment_and_immutable_history(self):
        await self.client.start_traffic("h1", "h2", .05, 1000, "manual")
        self.jobs["manual"].update(transmitted=999, received=999)
        first = await self.runner.run_experiment("reactive", failure_delay_sec=0)
        second = await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertNotEqual(first["id"], second["id"])
        self.assertNotEqual(first["summary"]["traffic_job_id"], second["summary"]["traffic_job_id"])
        self.assertEqual((first["packets_transmitted"], first["packets_received"]), (7, 5))
        self.assertEqual(first["controller"], "reactive")
        saved = db.get_experiment_by_id(first["id"])
        self.jobs[first["summary"]["traffic_job_id"]]["transmitted"] = 1234
        self.assertEqual(db.get_experiment_by_id(first["id"]), saved)
        self.assertEqual(len(db.get_experiments()), 2)

    async def test_foreign_job_causes_failed_record_not_completed_result(self):
        self.hook = lambda payload: {"job_id": "manual", "runtime_id": self.client.runtime_id,
                    "active": False} if payload["command"] == "get_traffic_stats" else None
        with self.assertRaises(OperationError):
            await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertEqual(db.get_experiments()[0]["status"], "FAILED")

    async def test_controller_change_aborts_instead_of_relabelling_result(self):
        def change(payload):
            if payload["command"] == "get_traffic_stats":
                er.controller_manager.active_controller = "baseline"
                er.controller_manager.generation = "replacement"
            return None
        self.hook = change
        with self.assertRaises(OperationError) as error:
            await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertEqual(error.exception.status_code, 409)
        record = db.get_experiments()[0]
        self.assertEqual(record["status"], "FAILED")
        self.assertEqual(record["controller"], "reactive")

    async def test_cancelled_run_cannot_supply_next_run_metrics(self):
        async def sleep(delay):
            if delay == .123:
                self.runner.cancel()
        with patch.object(er.asyncio, "sleep", AsyncMock(side_effect=sleep)):
            cancelled = await self.runner.run_experiment("reactive", failure_delay_sec=.123)
        self.jobs[cancelled["summary"]["traffic_job_id"]].update(transmitted=999, received=999)
        later = await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertEqual(cancelled["status"], "CANCELLED")
        self.assertEqual(later["packets_transmitted"], 7)
        self.assertNotEqual(cancelled["id"], later["id"])

    async def test_prior_recovery_event_is_not_this_runs_healing(self):
        def event(payload):
            if payload["command"] == "pingall":
                er.controller_manager.last_recovery_event = {
                    "type": "HEALED", "duration_ms": 999,
                    "controller_generation": er.controller_manager.generation,
                    "runtime_id": self.client.runtime_id, "event_received_at": time.time()}
            return None
        self.hook = event
        record = await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertIsNone(record.get("recovery_duration_ms"))

    async def test_runtime_change_aborts_old_experiment(self):
        def change(payload):
            if payload["command"] == "get_traffic_stats":
                self.client.runtime_id = "replacement-runtime"
            return None
        self.hook = change
        with self.assertRaises(OperationError):
            await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertEqual(db.get_experiments()[0]["status"], "FAILED")

    async def test_only_this_experiments_failure_can_supply_recovery(self):
        def healed(payload):
            if payload["command"] == "set_link_status" and payload["status"] == "down":
                er.controller_manager.last_recovery_event = {
                    "type": "HEALED", "duration_ms": 5,
                    "controller_generation": er.controller_manager.generation,
                    "runtime_id": self.client.runtime_id, "experiment_id": self.client.experiment_id,
                    "failure_link": ["s1", "s2"], "event_received_at": time.time()}
            return None
        self.hook = healed
        record = await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertEqual(record["recovery_duration_ms"], 5)


class WorkerOwnershipTests(unittest.TestCase):
    def test_worker_echoes_identity_and_does_not_accept_foreign_runtime(self):
        worker = MininetWorker()
        worker.runtime_id = "R"
        process = SimpleNamespace(returncode=0, poll=Mock(return_value=0), wait=Mock(return_value=0),
                                  stdout=["2 packets transmitted, 1 received, 50% packet loss\n"])
        source = SimpleNamespace(name="h1", IP=Mock(return_value="10.0.0.1"), cmd=Mock(), popen=Mock(return_value=process))
        destination = SimpleNamespace(name="h2", IP=Mock(return_value="10.0.0.2"))
        worker.net = SimpleNamespace(hosts=[source, destination])
        owner = {"runtime_id": "R", "controller_generation": "g", "experiment_id": "E", "traffic_sequence": 1}
        result = worker.start_traffic("h1", "h2", .05, 2, "owned", owner)
        worker.traffic_jobs["owned"]["_monitor"].join(timeout=2)
        self.assertEqual(result["runtime_id"], "R")
        final = worker.stop_traffic("owned")
        self.assertEqual((final["job_id"], final["experiment_id"], final["transmitted"]), ("owned", "E", 2))
        self.assertTrue(final["accounting_complete"])
        with self.assertRaises(OperationError):
            worker.start_traffic("h1", "h2", .05, 2, "foreign", {**owner, "runtime_id": "old"})


if __name__ == "__main__":
    unittest.main()
