"""C10 provenance/null/export tests. Temporary DB and fake SDN only."""
import csv
import io
import json
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI

from backend.database import db
from backend.models.schemas import ExperimentRecord, TrafficStats
from backend.services.metrics import PERFORMANCE_FIELDS, experiment_metrics
from backend.services.report_generator import report_generator
from backend.services.ping_accounting import PingAccounting
from backend.services import experiment_runner as er
from backend.services.mininet_worker import MininetWorker
from backend.services.operation_error import OperationError
from backend.api import experiments, reports, topology
from backend.tests.test_runtime_errors import request
from backend.tests.test_telemetry_ownership import OwnershipFixture


def record(**changes):
    return {"id": "measured", "controller": "reactive", "start_time": "2026-11-02T00:00:00",
            "status": "COMPLETED", "failure_link": "s1-s2", "summary": {}, **changes}


class MetricPersistenceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path_patch = patch.object(db, "DB_PATH", Path(self.temp.name) / "test.sqlite")
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        db.init_db()

    async def test_empty_history_is_empty_not_sample_records(self):
        app = FastAPI()
        app.include_router(experiments.router)
        status, body = await request(app, "/api/experiments/history", method="GET")
        self.assertEqual(status, 200)
        self.assertEqual(body, [])

    async def test_unknown_completed_measurements_stay_null_through_sqlite_and_api(self):
        db.save_experiment(record())
        app = FastAPI()
        app.include_router(experiments.router)
        _, body = await request(app, "/api/experiments/measured", method="GET")
        for field in PERFORMANCE_FIELDS:
            self.assertIsNone(body[field])
        model = ExperimentRecord(**body)
        self.assertIsNone(model.packet_loss_percent)

    async def test_actual_zero_survives_persistence_and_export(self):
        db.save_experiment(record(packets_transmitted=5, packets_received=5, packet_loss_percent=0, avg_rtt_ms=0))
        saved = db.get_experiment_by_id("measured")
        self.assertEqual(saved["packet_loss_percent"], 0)
        exported = json.loads(report_generator.generate_json(saved))
        self.assertEqual(exported["avg_rtt_ms"], 0)

    async def test_failed_and_cancelled_records_keep_diagnostics_not_success_metrics(self):
        for status in ("FAILED", "CANCELLED"):
            db.save_experiment(record(id=status, status=status, packets_transmitted=0, packets_received=0,
                packet_loss_percent=0, recovery_duration_ms=1,
                summary={"final_traffic": {"transmitted": 7, "received": 5}}))
        for saved in db.get_experiments():
            for field in PERFORMANCE_FIELDS:
                self.assertIsNone(saved[field])
            self.assertEqual(saved["summary"]["final_traffic"]["transmitted"], 7)

    async def test_legacy_failed_zero_defaults_masked_without_rewriting_history(self):
        conn = db.get_db_connection()
        conn.execute("INSERT INTO experiments(id,controller,start_time,status,packets_transmitted,packet_loss_percent) VALUES('legacy','baseline','old','FAILED',0,0)")
        conn.commit()
        conn.close()
        self.assertIsNone(db.get_experiment_by_id("legacy")["packet_loss_percent"])
        conn = db.get_db_connection()
        self.assertEqual(conn.execute("SELECT packet_loss_percent FROM experiments WHERE id='legacy'").fetchone()[0], 0)
        conn.close()

    async def test_export_api_null_and_timing_semantics(self):
        db.save_experiment(record(recovery_duration_ms=6.8))
        app = FastAPI()
        app.include_router(reports.router)
        status, body = await request(app, "/api/reports/measured/export?format=json", method="GET")
        self.assertEqual(status, 200)
        self.assertIsNone(body["avg_rtt_ms"])
        self.assertEqual(body["recovery_duration_ms"], 6.8)
        self.assertIn("not packet-level", body["metric_semantics"]["recovery_duration_ms"])

    async def test_topology_api_does_not_invent_backup_route(self):
        app = FastAPI()
        app.include_router(topology.router)
        with patch.object(topology.mininet_client, "get_topology", AsyncMock(return_value={"nodes": [], "links": []})):
            _, body = await request(app, "/api/topology", method="GET")
        self.assertEqual(body["backup_paths"], [])
        self.assertEqual(body["nodes"], [])


class MetricExportTests(unittest.TestCase):
    def test_html_missing_loss_and_rtt_are_na_not_zero_or_none(self):
        html = report_generator.generate_html_report(record())
        self.assertIn('>N/A<', html)
        self.assertNotIn('>0.0%<', html)
        self.assertNotIn('None ms', html)
        self.assertIn('Controller Processing / Recomputation', html)
        self.assertIn('local FF switching time: not measured', html)

    def test_csv_na_zero_and_accurate_header(self):
        rows = list(csv.DictReader(io.StringIO(report_generator.generate_csv([
            record(), record(id="zero", packet_loss_percent=0, recovery_duration_ms=0)]))))
        self.assertEqual(rows[0]["packet_loss_percent"], "N/A")
        self.assertEqual(rows[0]["controller_processing_ms"], "N/A")
        self.assertEqual(rows[1]["controller_processing_ms"], "0")
        self.assertEqual(rows[1]["packet_loss_percent"], "0")
        self.assertIn("not packet-level", rows[0]["timing_scope"])

    def test_json_all_export_preserves_null(self):
        values = json.loads(report_generator.generate_json([record(), record(id="cancel", status="CANCELLED", packet_loss_percent=0)]))
        self.assertIsNone(values[0]["avg_rtt_ms"])
        self.assertIsNone(values[1]["packet_loss_percent"])
        self.assertEqual(values[1]["status"], "CANCELLED")

    def test_baseline_has_no_controller_healing_timing(self):
        self.assertIsNone(experiment_metrics(record(controller="baseline", recovery_duration_ms=0))["recovery_duration_ms"])

    def test_link_configuration_is_queried_not_assigned_to_unshaped_host_links(self):
        worker = MininetWorker()
        def interface(name, params, up=True):
            return SimpleNamespace(name=name + '-eth1', node=SimpleNamespace(name=name),
                                   params=params, isUp=lambda: up)
        worker.net = SimpleNamespace(switches=[], hosts=[], links=[
            SimpleNamespace(intf1=interface('h1', {}), intf2=interface('s1', {})),
            SimpleNamespace(intf1=interface('s1', {'bw': 10, 'delay': '5ms'}), intf2=interface('s2', {}, False)),
        ])
        links = worker.get_topology()['links']
        self.assertIsNone(links[0]['bw'])
        self.assertIsNone(links[0]['delay'])
        self.assertEqual((links[1]['bw'], links[1]['delay'], links[1]['status']), (10, '5ms', 'DOWN'))

    def test_c06_outage_and_zero_loss_are_authoritative_no_reply_rtt_null(self):
        stats = {"history": [], "avg_rtt": None, "min_rtt": None, "max_rtt": None}
        parser = PingAccounting(stats)
        parser.feed("0/8 packets, 100% loss", 1)
        self.assertEqual((stats["transmitted"], stats["received"], stats["loss_percent"]), (8, 0, 100))
        self.assertIsNone(stats["avg_rtt"])
        parser.feed("10 packets transmitted, 10 received, 0% packet loss", 2)
        self.assertEqual(stats["loss_percent"], 0)


class OwnedExperimentMetricTests(OwnershipFixture):
    def setUp(self):
        super().setUp()
        self.saved = []
        patch.object(er, "mininet_client", self.client).start()
        patch.object(er, "save_experiment", side_effect=lambda value: self.saved.append(dict(value))).start()
        patch.object(er, "save_event_log").start()
        patch.object(er.asyncio, "sleep", new_callable=AsyncMock).start()
        patch.object(er.controller_manager, "select_controller", new_callable=AsyncMock).start()
        patch.object(er.controller_manager, "active_controller", "reactive").start()
        patch.object(er.controller_manager, "status", "READY").start()
        patch.object(er.controller_manager, "generation", "g1").start()
        patch.object(er.controller_manager, "last_recovery_event", None).start()
        self.runner = er.ExperimentRunner()

    async def test_no_replies_remain_null_and_controller_owner_is_preserved(self):
        def outage(payload):
            if payload["command"] in ("get_traffic_stats", "stop_traffic"):
                return {**self.jobs[payload["job_id"]], "active": False, "accounting_complete": True,
                        "received": 0, "loss_percent": 100, "avg_rtt": None, "min_rtt": None, "max_rtt": None}
        self.hook = outage
        result = await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertEqual((result["packets_transmitted"], result["packets_received"], result["packet_loss_percent"]), (7, 0, 100))
        self.assertIsNone(result["avg_rtt_ms"])
        self.assertIsNone(result.get("recovery_duration_ms"))
        self.assertEqual(result["summary"]["controller_generation"], "g1")
        self.assertIn("not packet-level", result["summary"]["timing_scope"])
        self.assertGreaterEqual(result["summary"]["duration_sec"], 0)

    async def test_missing_final_counters_fail_instead_of_configured_fallback(self):
        def incomplete(payload):
            if payload["command"] == "stop_traffic":
                result = dict(self.jobs[payload["job_id"]], active=False, accounting_complete=True)
                result.pop("received")
                return result
        self.hook = incomplete
        with self.assertRaises(OperationError):
            await self.runner.run_experiment("reactive", packet_count=1000, failure_delay_sec=0)
        self.assertEqual(self.saved[0]["status"], "FAILED")
        self.assertIsNone(self.saved[0]["packets_transmitted"])

    async def test_cancelled_traffic_is_diagnostic_not_success_sample(self):
        def cancel(payload):
            if payload["command"] == "start_traffic":
                self.runner.cancel()
        self.hook = cancel
        result = await self.runner.run_experiment("reactive", failure_delay_sec=0)
        self.assertEqual(result["status"], "CANCELLED")
        self.assertIsNone(result["packet_loss_percent"])
        self.assertEqual(result["summary"]["final_traffic"]["transmitted"], 7)


if __name__ == "__main__":
    unittest.main()
