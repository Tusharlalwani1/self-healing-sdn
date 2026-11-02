"""C06 counter regressions plus local iputils tests (no Mininet/OVS changes)."""
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI

from backend.api import traffic
from backend.tests.test_runtime_errors import request
from backend.services import mininet_client as mc
from backend.services.ping_accounting import PingAccounting
from backend.services.mininet_worker import MininetWorker
from backend.services import traffic_service as ts
from backend.services import experiment_runner as er


def stats():
    return {"job_id": "test", "active": True, "transmitted": 0, "received": 0,
            "loss_percent": 0.0, "min_rtt": None, "avg_rtt": None,
            "max_rtt": None, "last_rtt": None, "history": [], "duration_sec": 0,
            "accounting_complete": False}


class AccountingTests(unittest.TestCase):
    def setUp(self):
        self.stats = stats()
        self.parser = PingAccounting(self.stats)

    def snapshot(self, tx, rx):
        self.parser.feed(f"{rx}/{tx} packets, 0% loss", 1.0)
        self.assertGreaterEqual(self.stats["transmitted"], self.stats["received"])
        self.assertGreaterEqual(self.stats["received"], 0)
        self.assertTrue(0 <= self.stats["loss_percent"] <= 100)

    def test_zero_loss_and_partial_loss(self):
        self.snapshot(10, 10)
        self.assertEqual(self.stats["loss_percent"], 0)
        self.snapshot(100, 80)
        self.assertEqual(self.stats["loss_percent"], 20)

    def test_active_total_outage_tx_keeps_advancing_without_any_reply_lines(self):
        self.snapshot(100, 80)
        self.snapshot(110, 80)
        self.assertEqual(self.stats["transmitted"], 110)
        self.snapshot(120, 80)
        self.assertTrue(self.stats["active"])
        self.assertEqual(self.stats["received"], 80)
        self.assertEqual(self.stats["loss_percent"], 33.33)

    def test_restoration_is_cumulative_and_reply_sequences_do_not_set_tx(self):
        self.snapshot(120, 80)
        self.parser.feed("64 bytes from h2: icmp_seq=999 ttl=64 time=2.4 ms", 1)
        self.assertEqual((self.stats["transmitted"], self.stats["received"]), (120, 80))
        self.snapshot(140, 100)
        self.assertEqual(self.stats["loss_percent"], 28.57)

    def test_finite_summary_is_authoritative_and_loss_is_recomputed(self):
        self.snapshot(99, 66)
        self.parser.feed("100 packets transmitted, 67 received, 33% packet loss, time 2000ms", 2)
        self.assertEqual((self.stats["transmitted"], self.stats["received"]), (100, 67))
        self.assertEqual(self.stats["loss_percent"], 33)
        self.assertTrue(self.parser.final_seen)

    def test_early_stop_uses_summary_not_configured_count(self):
        self.parser.feed("7 packets transmitted, 5 packets received, 28% packet loss", .3)
        self.assertEqual(self.stats["transmitted"], 7)
        self.assertEqual(self.stats["loss_percent"], 28.57)

    def test_no_replies_rtt_null_and_loss_100(self):
        for tx in (1, 20, 40):
            self.snapshot(tx, 0)
            self.assertEqual(self.stats["loss_percent"], 100)
            self.assertIsNone(self.stats["avg_rtt"])
            self.assertIsNone(self.stats["min_rtt"])
            self.assertIsNone(self.stats["max_rtt"])

    def test_rtt_snapshots_and_duplicates_do_not_change_counters(self):
        self.parser.feed("3/4 packets, 25% loss, min/avg/ewma/max = 1.0/2.0/1.1/3.0 ms", .4)
        self.assertEqual((self.stats["min_rtt"], self.stats["avg_rtt"], self.stats["max_rtt"]), (1, 2, 3))
        self.parser.feed("64 bytes from h2: icmp_seq=3 ttl=64 time=3.0 ms (DUP!)", .5)
        self.assertEqual((self.stats["transmitted"], self.stats["received"]), (4, 3))
        self.assertEqual(self.stats["history"], [])
        self.parser.feed("rtt min/avg/max/mdev = 1.0/2.5/4.0/0.5 ms", .6)
        self.assertEqual(self.stats["avg_rtt"], 2.5)

    def test_zero_and_invalid_counters(self):
        self.snapshot(0, 0)
        self.assertEqual(self.stats["loss_percent"], 0)
        with self.assertRaises(ValueError):
            self.snapshot(2, 3)


@unittest.skipUnless(sys.platform == "linux" and shutil.which("ping"), "Requires Linux iputils ping")
class LocalPingWorkerTests(unittest.TestCase):
    """Real process/stdout/signals, bound to loopback only; not SDN tests."""

    def start(self, *, outage=False, count=8):
        worker = MininetWorker()
        command = ["stdbuf", "-oL", "-eL", "ping", "-n", "-I", "lo", "-i", ".05", "-c", str(count), "-W", "1",
                   "192.0.2.1" if outage else "127.0.0.1"]
        proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1, env={**os.environ, "LC_ALL": "C"})
        job = stats()
        job.update(proc=proc, start_time=time.time(), _sample_stop=threading.Event())
        job["_accounting"] = PingAccounting(job)
        monitor = threading.Thread(target=worker._monitor_traffic, args=("test", proc), daemon=True)
        job["_monitor"] = monitor
        worker.traffic_jobs["test"] = job

        def cleanup():
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=3)
            monitor.join(timeout=3)
            proc.stdout.close()
        self.addCleanup(cleanup)
        monitor.start()
        return worker, monitor

    def wait_tx(self, worker, minimum):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            current = worker.get_traffic_stats("test")
            if current["transmitted"] >= minimum:
                return current
            time.sleep(.02)
        self.fail(f"No ping snapshot reached Tx {minimum}: {worker.get_traffic_stats('test')}")

    def test_real_finite_ping_summary(self):
        worker, monitor = self.start()
        monitor.join(timeout=5)
        current = worker.get_traffic_stats("test")
        self.assertFalse(current["active"])
        self.assertTrue(current["accounting_complete"])
        self.assertEqual((current["transmitted"], current["received"]), (8, 8))
        self.assertEqual(current["loss_percent"], 0)
        self.assertIsNotNone(current["avg_rtt"])
        self.assertFalse(any(key.startswith("_") for key in current))

    def test_real_total_outage_snapshots_then_early_sigint_stop(self):
        worker, _ = self.start(outage=True, count=1000)
        first = self.wait_tx(worker, 1)
        second = self.wait_tx(worker, first["transmitted"] + 1)
        self.assertTrue(second["active"])
        self.assertEqual(second["received"], 0)
        self.assertEqual(second["loss_percent"], 100)
        self.assertIsNone(second["avg_rtt"])
        final = worker.stop_traffic("test")
        self.assertFalse(final["active"])
        self.assertTrue(final["accounting_complete"])
        self.assertGreaterEqual(final["transmitted"], second["transmitted"])
        self.assertLess(final["transmitted"], 1000)
        self.assertEqual(final["received"], 0)


class TrafficServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_experiment_uses_drained_stop_totals(self):
        runner = er.ExperimentRunner()
        final = {**stats(), "active": False, "transmitted": 7, "received": 5,
                 "loss_percent": 28.57, "accounting_complete": True}
        owner = {}
        async def start(*args, **kwargs):
            owner.update(job_id=args[4], runtime_id=er.mininet_client.runtime_id,
                         controller_generation=er.controller_manager.generation, experiment_id=kwargs["experiment_id"])
        with patch.object(er, "save_event_log"), patch.object(er, "save_experiment"), \
                patch.object(er.ws_manager, "broadcast", new_callable=AsyncMock), \
                patch.object(er.asyncio, "sleep", new_callable=AsyncMock), \
                patch.object(er.controller_manager, "select_controller", new_callable=AsyncMock), \
                patch.object(er.controller_manager, "active_controller", "baseline"), \
                patch.object(er.controller_manager, "status", "READY"), \
                patch.object(er.controller_manager, "last_recovery_event", None), \
                patch.object(er.mininet_client, "simulation_state", "RUNNING"), \
                patch.object(er.mininet_client, "get_topology", AsyncMock(return_value={"links": [{"src": "s1", "dst": "s2", "status": "UP"}]})), \
                patch.object(er.mininet_client, "set_link_status", new_callable=AsyncMock), \
                patch.object(er.mininet_client, "pingall", new_callable=AsyncMock), \
                patch.object(er.mininet_client, "start_traffic", AsyncMock(side_effect=start)), \
                patch.object(er.mininet_client, "get_traffic_stats", AsyncMock(side_effect=lambda job: {**final, **owner, "transmitted": 6})), \
                patch.object(er.mininet_client, "stop_traffic", AsyncMock(side_effect=lambda job: {"status": "ok", **final, **owner})):
            record = await runner.run_experiment("baseline", packet_count=1000)
        self.assertEqual(record["packets_transmitted"], 7)
        self.assertEqual(record["packets_received"], 5)
        self.assertEqual(record["packet_loss_percent"], 28.57)

    async def test_c05_stopped_and_unavailable_traffic_api_errors_remain(self):
        app = FastAPI()
        app.include_router(traffic.router)
        client = mc.MininetClient()
        service = ts.TrafficService()
        with patch.object(traffic, "traffic_service", service), patch.object(ts, "mininet_client", client), \
                patch.object(mc.asyncio, "open_unix_connection", AsyncMock(side_effect=FileNotFoundError())):
            status, _ = await request(app, "/api/traffic/start")
            self.assertEqual(status, 409)
            client.simulation_state = "RUNNING"
            status, _ = await request(app, "/api/traffic/start")
            self.assertEqual(status, 503)
        self.assertIsNone(service.active_job_id)

    async def test_stop_preserves_drained_final_totals_and_publishes_them(self):
        service = ts.TrafficService()
        service.active_job_id = "test"
        service.latest_stats = {**stats(), "transmitted": 3}
        final = {**stats(), "active": False, "transmitted": 7, "received": 5,
                 "loss_percent": 28.57, "accounting_complete": True}
        with patch.object(ts.mininet_client, "stop_traffic", AsyncMock(return_value={"status": "ok", **final})), \
                patch.object(ts.ws_manager, "broadcast", new_callable=AsyncMock) as broadcast:
            await service.stop()
            self.assertEqual(await service.get_stats(), final)
            self.assertEqual(broadcast.call_args.args[0]["stats"], final)
        self.assertIsNone(service.active_job_id)


if __name__ == "__main__":
    unittest.main()
