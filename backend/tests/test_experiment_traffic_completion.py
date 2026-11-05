"""Finite traffic lifecycle: real loopback ping plus deterministic runner races.

No Mininet/Ryu/OVS startup or production database writes.
"""
import asyncio
import copy
import os
import shutil
import signal
import subprocess
import sys
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from backend.api import experiments
from backend.services import experiment_runner as er
from backend.services.mininet_worker import MininetWorker
from backend.services.operation_error import OperationError
from backend.tests.test_telemetry_ownership import OwnershipFixture
from backend.tests.test_runtime_errors import request
from fastapi import FastAPI


class RunnerFixture(OwnershipFixture):
    def setUp(self):
        super().setUp()
        self.runner = er.ExperimentRunner()
        self.saved = []
        patch.object(er, "mininet_client", self.client).start()
        patch.object(er, "save_event_log").start()
        patch.object(er, "save_experiment", side_effect=lambda value: self.saved.append(copy.deepcopy(value))).start()
        patch.object(er.controller_manager, "select_controller", new_callable=AsyncMock).start()
        patch.object(er.controller_manager, "active_controller", "baseline").start()
        patch.object(er.controller_manager, "status", "READY").start()
        patch.object(er.controller_manager, "generation", "g1").start()
        patch.object(er.controller_manager, "last_recovery_event", None).start()
        self.client.controller_type = "baseline"


class ProgressDeadlineTests(RunnerFixture):
    def setUp(self):
        super().setUp()
        self.clock = 0.0
        self.polls = []
        self.restored = []
        self.client.set_link_status = AsyncMock(side_effect=self.link)
        self.runner._sleep = AsyncMock(side_effect=self.advance)
        patch.object(er, "time", SimpleNamespace(monotonic=lambda: self.clock, time=lambda: self.clock)).start()

    async def link(self, src, dst, status, **kwargs):
        self.restored.append(status)

    async def advance(self, delay):
        self.clock += delay

    def readings(self, snapshots):
        iterator = iter(snapshots)
        last = snapshots[-1]
        async def stats(job):
            nonlocal last
            last = next(iterator, last)
            self.clock = last[0]
            result = {**self.jobs[job], "transmitted": last[1], "received": last[2],
                      "active": last[3], "accounting_complete": not last[3],
                      "loss_percent": round(100 * (last[1] - last[2]) / last[1], 2) if last[1] else 0}
            self.jobs[job].update(result)
            self.polls.append(copy.deepcopy(result))
            return result
        self.client.get_traffic_stats = AsyncMock(side_effect=stats)

    async def test_slow_but_measured_transmit_progress_finishes_300_not_timeout(self):
        # The live failure drained only 284 attempts after ~19.46s. Nominal
        # 300*.02 was not a completion bound. Strict progress now earns only
        # remaining configured spacing plus the existing grace.
        self.readings([(3, 100, 100, True), (12, 220, 100, True),
                       (19, 284, 100, True), (19.5, 284, 100, True), (21, 300, 100, False)])
        record = await self.runner.run_experiment("baseline", packet_count=300, traffic_interval=.02, failure_delay_sec=2)
        self.assertEqual(record["status"], "COMPLETED")
        self.assertEqual((record["packets_transmitted"], record["packets_received"]), (300, 100))
        self.assertEqual(record["packet_loss_percent"], 66.67)
        self.assertEqual(self.restored, ["down", "up"])

    async def test_stalled_process_is_504_and_cleanup_only_stops_owned_job(self):
        await self.client.start_traffic("h1", "h2", .05, 1000, "manual-B")
        self.readings([(3, 100, 100, True), (16, 100, 100, True)])
        with self.assertRaises(OperationError) as caught:
            await self.runner.run_experiment("baseline", packet_count=300, traffic_interval=.02, failure_delay_sec=2)
        self.assertEqual(caught.exception.status_code, 504)
        self.assertEqual(self.saved[0]["status"], "FAILED")
        owned = self.saved[0]["summary"]["traffic_job_id"]
        self.assertFalse(self.jobs[owned]["active"])
        self.assertTrue(self.jobs["manual-B"]["active"])
        self.assertEqual(self.saved[0]["summary"]["final_traffic"]["transmitted"], 100)
        self.assertEqual(self.restored, ["down", "up"])

    async def test_tx_at_count_but_process_still_active_does_not_become_success(self):
        self.readings([(7, 300, 0, True), (16, 300, 0, True)])
        with self.assertRaises(OperationError) as caught:
            await self.runner.run_experiment("baseline", packet_count=300, traffic_interval=.02, failure_delay_sec=2)
        self.assertEqual(caught.exception.status_code, 504)
        self.assertEqual(self.saved[0]["status"], "FAILED")

    async def test_zero_transmissions_cannot_keep_stalled_process_alive(self):
        self.readings([(16, 0, 0, True)])
        with self.assertRaises(OperationError) as caught:
            await self.runner.run_experiment("baseline", packet_count=300, traffic_interval=.02, failure_delay_sec=2)
        self.assertEqual(caught.exception.status_code, 504)

    async def test_deadline_expired_but_real_final_state_is_not_misclassified(self):
        self.readings([(20, 300, 0, False)])
        result = await self.runner.run_experiment("baseline", packet_count=300, traffic_interval=.02, failure_delay_sec=2)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["packet_loss_percent"], 100)

    async def test_actual_api_retains_504_for_genuine_timeout(self):
        self.readings([(16, 0, 0, True)])
        app = FastAPI()
        app.include_router(experiments.router)
        with patch.object(experiments, "experiment_runner", self.runner):
            status, body = await request(app, "/api/experiments/run", {
                "controller": "baseline", "packet_count": 300, "traffic_interval": .02, "failure_delay_sec": 2})
        self.assertEqual(status, 504)
        self.assertEqual(body["detail"]["message"], "Experiment traffic timed out")


@unittest.skipUnless(sys.platform == "linux" and shutil.which("ping"), "Requires Linux iputils ping")
class RealFiniteExperimentTests(RunnerFixture):
    def setUp(self):
        super().setUp()
        self.worker = MininetWorker()
        self.worker.runtime_id = self.client.runtime_id
        self.processes = []
        self.samples = []
        self.stops = []
        self.commands = []
        self.outage = False
        source = SimpleNamespace(name="h1", IP=lambda: "127.0.0.1", cmd=Mock(), popen=self.popen)
        destination = SimpleNamespace(name="h2", IP=lambda: "192.0.2.1" if self.outage else "127.0.0.1")
        self.worker.net = SimpleNamespace(hosts=[source, destination])
        self.client._send_command = AsyncMock(side_effect=self.dispatch)
        self.addAsyncCleanup(self.finish_processes)
        # Keep collection/cancellation real, skipping only controller warm-up delays.
        async def delay(seconds):
            if seconds not in (1.0, 1.5):
                await asyncio.sleep(seconds)
        self.runner._sleep = delay

    def popen(self, command, **kwargs):
        self.commands.append(command)
        # Real production argv/worker, but force loopback so no external or SDN
        # packets are sent. Only Mininet host/IPC boundaries are substituted.
        process = subprocess.Popen(command[:-1] + ["-n", "-I", "lo", command[-1]], **kwargs)
        process.send_signal = Mock(wraps=process.send_signal)
        self.processes.append(process)
        return process

    async def dispatch(self, payload, **kwargs):
        command = payload["command"]
        if command == "start_traffic":
            owner = {key: value for key, value in payload.items() if key not in
                     ("command", "src", "dst", "interval", "count", "job_id")}
            return self.worker.start_traffic(payload["src"], payload["dst"], payload["interval"], payload["count"], payload["job_id"], owner)
        if command == "get_traffic_stats":
            stats = self.worker.get_traffic_stats(payload["job_id"])
            self.samples.append(copy.deepcopy(stats))
            return stats
        if command == "stop_traffic":
            self.stops.append(self.worker.get_traffic_stats(payload["job_id"]))
            return self.worker.stop_traffic(payload["job_id"])
        if command == "get_topology":
            return {"status": "ok", "links": [{"src": "s1", "dst": "s2", "status": "UP"}]}
        return {"status": "ok"}

    async def finish_processes(self):
        for job_id in self.worker.traffic_jobs:
            process = self.worker.traffic_jobs[job_id]["proc"]
            if process.poll() is None:
                self.worker.stop_traffic(job_id)
            process.wait(timeout=3)
            self.worker.traffic_jobs[job_id]["_monitor"].join(timeout=3)
            process.stdout.close()

    async def check_finite(self, outage):
        self.outage = outage
        result = await asyncio.wait_for(self.runner.run_experiment("baseline", packet_count=300,
            traffic_interval=.02, failure_delay_sec=2), timeout=40)
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["packets_transmitted"], 300)
        self.assertEqual(result["packets_received"], 0 if outage else 300)
        self.assertEqual(result["packet_loss_percent"], 100 if outage else 0)
        self.assertTrue(any(sample["active"] for sample in self.samples))
        self.assertFalse(self.samples[-1]["active"])
        self.assertTrue(self.samples[-1]["accounting_complete"])
        self.assertFalse(self.stops[-1]["active"])  # final before explicit stop
        self.assertIsNotNone(self.processes[-1].poll())
        self.assertFalse(self.worker.traffic_jobs[result["summary"]["traffic_job_id"]]["_monitor"].is_alive())
        self.assertFalse(any(call.args == (signal.SIGINT,) for call in self.processes[-1].send_signal.call_args_list))
        self.assertEqual(self.commands[-1][-3:-1], ["-W", "1"])
        self.assertEqual(result["summary"]["runtime_id"], self.client.runtime_id)
        self.assertEqual(result["summary"]["controller_generation"], "g1")
        if outage:
            self.assertIsNone(result["avg_rtt_ms"])
            self.assertIsNone(result["min_rtt_ms"])
            self.assertIsNone(result["max_rtt_ms"])

    async def test_real_300_at_002_finite_ping_completes_through_runner(self):
        await self.check_finite(False)

    async def test_real_300_at_002_total_outage_naturally_completes_through_runner(self):
        await self.check_finite(True)


if __name__ == "__main__":
    unittest.main()
