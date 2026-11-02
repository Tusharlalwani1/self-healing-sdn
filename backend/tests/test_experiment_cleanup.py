"""C09 lifecycle tests: fake SDN IPC, no production DB or network mutations."""
import asyncio
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from fastapi import FastAPI

from backend.tests.test_telemetry_ownership import OwnershipFixture
from backend.tests.test_runtime_errors import request
from backend.services import experiment_runner as er
from backend.services.operation_error import OperationError
from backend.api import experiments
from backend.tests import test_traffic_accounting as accounting


class ExperimentCleanupTests(OwnershipFixture):
    def setUp(self):
        super().setUp()
        self.runner = er.ExperimentRunner()
        self.links = {("s1", "s2"): "UP", ("s1", "s3"): "DOWN"}
        self.saved = []
        patch.object(er, "mininet_client", self.client).start()
        patch.object(er, "save_event_log").start()
        patch.object(er, "save_experiment", side_effect=lambda record: self.saved.append(copy.deepcopy(record))).start()
        patch.object(er.asyncio, "sleep", new_callable=AsyncMock).start()
        patch.object(er.controller_manager, "active_controller", "reactive").start()
        patch.object(er.controller_manager, "status", "READY").start()
        patch.object(er.controller_manager, "generation", "g1").start()
        patch.object(er.controller_manager, "last_recovery_event", None).start()
        async def select(mode, **kwargs):
            er.controller_manager.active_controller = mode
        patch.object(er.controller_manager, "select_controller", AsyncMock(side_effect=select)).start()
        self.trigger = None
        original = self.command

        async def command(payload, **kwargs):
            if self.trigger:
                await self.trigger(payload)
            if payload["command"] == "get_topology":
                return {"status": "ok", "links": [{"src": a, "dst": b, "status": status}
                        for (a, b), status in self.links.items()]}
            if payload["command"] == "set_link_status":
                self.links[(payload["node1"], payload["node2"])] = payload["status"].upper()
            return await original(payload, **kwargs)
        self.client._send_command = AsyncMock(side_effect=command)

    async def run_case(self, **kwargs):
        return await self.runner.run_experiment("reactive", failure_delay_sec=0, **kwargs)

    def cancel_at(self, command, status=None):
        async def trigger(payload):
            if payload["command"] == command and (status is None or payload.get("status") == status):
                self.runner.cancel()
        self.trigger = trigger

    def assert_clean(self):
        self.assertFalse(self.runner.is_running)
        self.assertIsNone(self.client.experiment_id)
        self.assertTrue(all(not job["active"] for job in self.jobs.values()))
        self.assertEqual(self.links, {("s1", "s2"): "UP", ("s1", "s3"): "DOWN"})
        self.assertTrue(self.runner._task.done())

    async def test_success_cleans_and_persists_only_completed(self):
        record = await self.run_case()
        self.assertEqual(record["status"], "COMPLETED")
        self.assertEqual([r["status"] for r in self.saved], ["COMPLETED"])
        self.assertEqual(record["packets_transmitted"], 7)
        self.assert_clean()

    async def test_cancel_at_traffic_start_stops_exact_job_and_keeps_final_counts(self):
        await self.client.start_traffic("h1", "h2", .05, 1000, "manual")
        self.cancel_at("start_traffic")
        record = await self.run_case()
        self.assertEqual(record["status"], "CANCELLED")
        final = record["summary"]["final_traffic"]
        self.assertEqual((final["transmitted"], final["received"]), (7, 5))
        self.assertTrue(final["accounting_complete"])
        self.assertFalse(self.jobs[final["job_id"]]["active"])
        self.assertTrue(self.jobs["manual"]["active"])

    async def test_cancel_during_failure_restores_only_owned_link(self):
        self.cancel_at("set_link_status", "down")
        record = await self.run_case()
        self.assertEqual(record["status"], "CANCELLED")
        self.assert_clean()

    async def test_cancel_after_failure_before_measurement(self):
        self.cancel_at("get_traffic_stats")
        self.assertEqual((await self.run_case())["status"], "CANCELLED")
        self.assert_clean()

    async def test_cancel_during_restore_cannot_persist_completed(self):
        self.cancel_at("set_link_status", "up")
        self.assertEqual((await self.run_case())["status"], "CANCELLED")
        self.assertNotIn("COMPLETED", [r["status"] for r in self.saved])
        self.assert_clean()

    async def test_preexisting_target_down_is_rejected_without_restoration(self):
        self.links[("s1", "s2")] = "DOWN"
        with self.assertRaises(OperationError) as caught:
            await self.run_case()
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.links[("s1", "s2")], "DOWN")
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assertFalse(self.jobs)

    async def test_traffic_start_ack_lost_still_stops_reserved_exact_job(self):
        original = self.client._send_command.side_effect
        async def lose_ack(payload, **kwargs):
            result = await original(payload, **kwargs)
            if payload["command"] == "start_traffic":
                raise OperationError(504, "Traffic start timed out")
            return result
        self.client._send_command.side_effect = lose_ack
        with self.assertRaises(OperationError):
            await self.run_case()
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assert_clean()

    async def test_failure_injection_ack_lost_restores_intended_link(self):
        original = self.client._send_command.side_effect
        async def lose_ack(payload, **kwargs):
            result = await original(payload, **kwargs)
            if payload["command"] == "set_link_status" and payload["status"] == "down":
                raise OperationError(502, "Failure injection not confirmed")
            return result
        self.client._send_command.side_effect = lose_ack
        with self.assertRaises(OperationError):
            await self.run_case()
        self.assert_clean()

    async def test_restore_failure_is_failed_not_clean_cancel(self):
        async def fail(payload):
            if payload["command"] == "set_link_status":
                if payload["status"] == "down":
                    self.runner.cancel()
                else:
                    raise OperationError(503, "Worker unavailable")
        self.trigger = fail
        with self.assertRaises(OperationError) as caught:
            await self.run_case()
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assertIn("Link cleanup", self.saved[0]["summary"]["cleanup_errors"][0])
        self.assertFalse(self.runner.is_running)

    async def test_stop_failure_still_attempts_link_restore(self):
        async def fail(payload):
            if payload["command"] == "get_traffic_stats":
                self.runner.cancel()
            if payload["command"] == "stop_traffic":
                raise OperationError(503, "Worker unavailable")
        self.trigger = fail
        with self.assertRaises(OperationError):
            await self.run_case()
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assertEqual(self.links[("s1", "s2")], "UP")
        self.assertTrue(self.saved[0]["summary"]["cleanup_errors"])

    async def test_controller_failure_releases_busy_state(self):
        er.controller_manager.select_controller.side_effect = OperationError(503, "Controller activation failed")
        with self.assertRaises(OperationError):
            await self.run_case()
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assert_clean()

    async def test_unexpected_exception_is_failed_and_cleans(self):
        async def fail(payload):
            if payload["command"] == "get_traffic_stats":
                raise ValueError("unexpected")
        self.trigger = fail
        with self.assertRaises(ValueError):
            await self.run_case()
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assert_clean()

    async def test_double_cancel_waits_cleanup_and_blocks_replacement_until_done(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def block(payload):
            if payload["command"] == "start_traffic":
                entered.set()
                await release.wait()
        self.trigger = block
        task = asyncio.create_task(self.run_case(run_id="A"))
        await entered.wait()
        first = asyncio.create_task(self.runner.cancel_and_wait("A"))
        second = asyncio.create_task(self.runner.cancel_and_wait("A"))
        self.runner.cancel()
        self.assertFalse(first.done())
        with self.assertRaises(OperationError):
            await self.run_case(run_id="B")
        release.set()
        a, b, original = await asyncio.gather(first, second, task)
        self.assertEqual(a, b)
        self.assertEqual(original["status"], "CANCELLED")
        self.assertEqual(await self.runner.cancel_and_wait("A"), a)
        entered_b, release_b = asyncio.Event(), asyncio.Event()
        async def block_b(payload):
            if payload["command"] == "start_traffic":
                entered_b.set()
                await release_b.wait()
        self.trigger = block_b
        later = asyncio.create_task(self.run_case(run_id="B"))
        await entered_b.wait()
        # A's repeated cancel is a terminal read while B is genuinely running.
        calls = self.client._send_command.await_count
        await self.runner.cancel_and_wait("A")
        self.assertEqual(self.client._send_command.await_count, calls)
        self.assertFalse(self.runner._cancel_flag)
        self.assertFalse(later.done())
        release_b.set()
        self.assertEqual((await later)["status"], "COMPLETED")
        self.assert_clean()

    async def test_cancel_during_controller_start_finishes_switch_then_exits(self):
        async def activate(*args, **kwargs):
            self.runner.cancel()
        er.controller_manager.select_controller.side_effect = activate
        self.assertEqual((await self.run_case())["status"], "CANCELLED")
        self.assertFalse(self.jobs)
        self.assert_clean()

    async def test_cancel_after_natural_completion_is_deterministic_terminal_read(self):
        record = await self.run_case(run_id="done")
        self.assertEqual((await self.runner.cancel_and_wait("done"))["status"], "COMPLETED")
        self.assertEqual(len(self.saved), 1)
        self.assertEqual(record["status"], "COMPLETED")

    async def test_wrong_run_cancel_does_not_cancel_current(self):
        with self.assertRaises(OperationError) as caught:
            await self.runner.cancel_and_wait("missing")
        self.assertEqual(caught.exception.status_code, 404)

    async def test_old_cleanup_cannot_touch_new_runtime_or_new_link_lease(self):
        self.client.experiment_id = "B"
        with self.assertRaises(OperationError):
            await self.client.set_link_status("s1", "s2", "up", experiment_id="A", expected_runtime=self.client.runtime_id)
        self.client._send_command.assert_not_awaited()
        await self.client.start_traffic("h1", "h2", .05, 10, "B", experiment_id="B")
        with self.assertRaises(OperationError):
            await self.client.stop_experiment_traffic("B", "A", self.client.runtime_id)
        self.assertTrue(self.jobs["B"]["active"])

    async def test_shutdown_awaits_owned_cleanup(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def block(payload):
            if payload["command"] == "start_traffic":
                entered.set()
                await release.wait()
        self.trigger = block
        task = asyncio.create_task(self.run_case())
        await entered.wait()
        shutdown = asyncio.create_task(self.runner.shutdown())
        self.runner.cancel()
        self.assertFalse(shutdown.done())
        release.set()
        await shutdown
        self.assertEqual((await task)["status"], "CANCELLED")
        self.assert_clean()

    async def test_comparison_cancellation_does_not_start_next_controller(self):
        self.cancel_at("set_link_status", "down")
        result = await self.runner.run_experiment("comparison", failure_delay_sec=0, run_id="parent")
        self.assertEqual(result["status"], "CANCELLED")
        self.assertEqual(len(result["results"]), 1)
        er.controller_manager.select_controller.assert_awaited_once()
        self.assert_clean()

    async def test_comparison_stays_owned_until_all_children_finish(self):
        result = await self.runner.run_experiment("comparison", failure_delay_sec=0, run_id="parent")
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(len(result["results"]), 3)
        self.assertEqual(len({r["run_id"] for r in result["results"]}), 3)
        messages = [c.args[0] for c in er.ws_manager.broadcast.await_args_list]
        self.assertFalse(any(m.get("event_type") == "EXPERIMENT_FINISHED" for m in messages))
        self.assertEqual(messages[-1]["event_type"], "COMPARISON_FINISHED")
        self.assertEqual(messages[-1]["run_id"], "parent")
        self.assert_clean()

    async def test_context_change_during_restore_cannot_save_completed(self):
        async def change(payload):
            if payload["command"] == "set_link_status" and payload["status"] == "up":
                er.controller_manager.generation = "new-controller"
        self.trigger = change
        with self.assertRaises(OperationError):
            await self.run_case()
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assert_clean()

    async def test_collection_timeout_cleans_and_records_failed(self):
        self.hook = lambda payload: copy.deepcopy(self.jobs[payload["job_id"]]) if payload["command"] == "get_traffic_stats" else None
        with patch.object(er, "time", SimpleNamespace(time=Mock(return_value=0), monotonic=Mock(side_effect=[0, 0, 1000, 1000]))):
            with self.assertRaises(OperationError) as caught:
                await self.run_case()
        self.assertEqual(caught.exception.status_code, 504)
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assert_clean()

    async def test_cancelled_request_cannot_abandon_internal_task(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def block(payload):
            if payload["command"] == "start_traffic":
                entered.set()
                await release.wait()
        self.trigger = block
        request_task = asyncio.create_task(self.run_case())
        await entered.wait()
        request_task.cancel()
        release.set()
        with self.assertRaises(asyncio.CancelledError):
            await request_task
        self.assertEqual(self.saved[0]["status"], "CANCELLED")
        self.assert_clean()

    async def test_application_shutdown_finalizes_experiment_before_runtime_teardown(self):
        from backend import main
        order = []
        async def experiment():
            order.append("experiment")
        async def controller():
            order.append("controller")
        async def network():
            order.append("network")
        with patch.object(main.experiment_runner, "shutdown", AsyncMock(side_effect=experiment)), \
                patch.object(main.controller_manager, "stop_controller", AsyncMock(side_effect=controller)), \
                patch.object(main.mininet_client, "stop_simulation", AsyncMock(side_effect=network)):
            await main.shutdown_event()
        self.assertEqual(order, ["experiment", "controller", "network"])

    async def test_cancel_api_nonexistent_is_404(self):
        app = FastAPI()
        app.include_router(experiments.router)
        with patch.object(experiments, "experiment_runner", self.runner):
            status, _ = await request(app, "/api/experiments/cancel?run_id=missing")
        self.assertEqual(status, 404)

    async def test_cancel_api_cleanup_failure_is_non_success(self):
        app = FastAPI()
        app.include_router(experiments.router)
        with patch.object(experiments, "experiment_runner", self.runner), \
                patch.object(self.runner, "cancel_and_wait", AsyncMock(side_effect=OperationError(502, "Experiment cleanup failed"))):
            status, data = await request(app, "/api/experiments/cancel?run_id=A")
        self.assertEqual(status, 502)
        self.assertEqual(data["detail"]["message"], "Experiment cleanup failed")


@unittest.skipUnless(accounting.sys.platform == "linux" and accounting.shutil.which("ping"), "Requires Linux iputils ping")
class CleanupProcessTests(unittest.TestCase):
    start = accounting.LocalPingWorkerTests.start
    wait_tx = accounting.LocalPingWorkerTests.wait_tx

    def test_owned_ping_really_exits_and_exact_early_stop_accounting_survives(self):
        worker, monitor = self.start(count=1000)
        self.wait_tx(worker, 2)
        final = worker.stop_traffic("test")
        self.assertIsNotNone(worker.traffic_jobs["test"]["proc"].poll())
        self.assertFalse(monitor.is_alive())
        self.assertFalse(final["active"])
        self.assertTrue(final["accounting_complete"])
        self.assertLess(final["transmitted"], 1000)
        self.assertEqual(final["transmitted"], final["received"])
        # Cleanup is idempotent at the process/reader boundary too.
        self.assertEqual(worker.stop_traffic("test")["transmitted"], final["transmitted"])

    def test_missing_sigint_handler_does_not_leave_ping_running(self):
        worker, monitor = self.start(count=1000)
        self.wait_tx(worker, 1)
        with patch.object(worker, "_ping_handler_ready", return_value=False):
            with self.assertRaises(OperationError):
                worker.stop_traffic("test")
        self.assertIsNotNone(worker.traffic_jobs["test"]["proc"].poll())
        self.assertFalse(monitor.is_alive())
        self.assertFalse(worker.get_traffic_stats("test")["accounting_complete"])


if __name__ == "__main__":
    unittest.main()
