"""C05 HTTP/service/worker regression tests; no real SDN or database writes.

Call ASGI directly to use existing unittest infrastructure without adding httpx.
Only the socket transport, privileged IO, and persistence are mocked.
"""
import asyncio
import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from backend.api import controllers, experiments, links, simulation, topology, traffic
from backend.services import controller_manager as cm, experiment_runner as er
from backend.services import mininet_client as mc, mininet_worker as mw
from backend.services import traffic_service as ts
from backend.services.operation_error import OperationError


async def request(app, path, body=None, method="POST"):
    messages = []
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": b"", "root_path": "", "headers": [(b"content-type", b"application/json")],
             "server": ("test", 80), "client": ("test", 1)}
    receive = AsyncMock(return_value={"type": "http.request", "body": json.dumps(body or {}).encode()})

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    status = next(m["status"] for m in messages if m["type"] == "http.response.start")
    payload = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return status, json.loads(payload)


class RuntimeHTTPTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.app = FastAPI()
        for module in (controllers, experiments, links, simulation, topology, traffic):
            self.app.include_router(module.router)
        self.client = mc.MininetClient()
        self.client.simulation_state = "RUNNING"
        for module in (links, simulation, topology, ts, cm, er):
            patch.object(module, "mininet_client", self.client).start()
        self.events = patch.object(mc, "save_event_log").start()
        patch.object(cm, "save_event_log").start()
        self.broadcast = patch.object(mc.ws_manager, "broadcast", new_callable=AsyncMock).start()
        self.service = ts.TrafficService()
        patch.object(traffic, "traffic_service", self.service).start()
        self.reply = {"status": "ok"}
        self.command = None
        self.writer = SimpleNamespace(write=Mock(side_effect=self.write), drain=AsyncMock(),
                                      close=Mock(), wait_closed=AsyncMock())
        self.reader = SimpleNamespace(readline=AsyncMock(side_effect=self.read))
        self.connect = patch.object(mc.asyncio, "open_unix_connection",
                                    AsyncMock(return_value=(self.reader, self.writer))).start()

    def write(self, data):
        self.command = json.loads(data)["command"]

    async def read(self):
        if self.command == "get_topology":
            return b'{"status":"ok","nodes":[],"links":[]}'
        return self.reply if isinstance(self.reply, bytes) else json.dumps(self.reply).encode()

    async def post(self, path, data=None):
        return await request(self.app, path, data)

    async def test_link_down_and_up_worker_errors_are_not_success_or_events(self):
        for action in ("down", "up"):
            self.reply = {"status": "error", "message": "OVS operation failed"}
            status, data = await self.post("/api/links/" + action, {"node1": "s1", "node2": "s2"})
            self.assertEqual(status, 502)
            self.assertEqual(data["detail"]["message"], "OVS operation failed")
        self.events.assert_not_called()
        self.broadcast.assert_not_awaited()

    async def test_unavailable_worker_is_503(self):
        self.connect.side_effect = FileNotFoundError("/private/worker.sock")
        status, data = await self.post("/api/links/down", {"node1": "s1", "node2": "s2"})
        self.assertEqual(status, 503)
        self.assertEqual(data["detail"]["message"], "Mininet worker unavailable")
        self.assertNotIn("/private", json.dumps(data))

    async def test_stopped_actions_are_409_without_socket(self):
        self.client.simulation_state = "STOPPED"
        for path, body in (("/api/links/down", {"node1": "s1", "node2": "s2"}),
                           ("/api/traffic/start", {}), ("/api/links/restore-all", {})):
            status, _ = await self.post(path, body)
            self.assertEqual(status, 409)
        self.connect.assert_not_awaited()
        self.assertIsNone(self.service.active_job_id)

    async def test_worker_stopped_and_missing_link_are_4xx(self):
        for code, expected in (("not_running", 409), ("not_found", 404), ("invalid_request", 400)):
            self.reply = {"status": "error", "error_code": code, "message": "Requested operation rejected"}
            status, _ = await self.post("/api/links/down", {"node1": "s1", "node2": "s9"})
            self.assertEqual(status, expected)

    async def test_malformed_input_is_422(self):
        for path, body in (("/api/links/down", {"node1": "s1"}),
                           ("/api/controllers/select", {"controller_type": "invalid"}),
                           ("/api/simulation/start", {"controller_type": "invalid"}),
                           ("/api/traffic/start", {"count": -1}),
                           ("/api/experiments/run", {"traffic_interval": 0})):
            status, _ = await self.post(path, body)
            self.assertEqual(status, 422, path)

    async def test_partial_restore_has_five_successes_one_failure_and_502(self):
        original = self.write

        def write(data):
            original(data)
            payload = json.loads(data)
            if payload["command"] == "set_link_status":
                self.reply = ({"status": "error", "message": "Link restoration failed"}
                              if payload["node1"] == "s2" else {"status": "ok"})
        self.writer.write.side_effect = write
        status, data = await self.post("/api/links/restore-all")
        self.assertEqual(status, 502)
        results = data["detail"]["results"]
        self.assertEqual(sum(r["status"] == "ok" for r in results), 5)
        self.assertEqual([r["node1"] for r in results if r["status"] == "error"], ["s2"])
        self.assertIn("1 of 6", data["detail"]["message"])

    async def test_c04_failure_aborts_launch_and_reaches_http(self):
        manager = cm.ControllerManager()
        manager._kill_process_on_port = Mock()
        manager.is_port_in_use = Mock(return_value=False)
        manager.start_controller = AsyncMock()
        self.reply = {"status": "error", "message": "Dataplane cleanup failed"}
        with patch.object(controllers, "controller_manager", manager), patch.object(mc.os.path, "exists", return_value=True):
            status, data = await self.post("/api/controllers/select", {"controller_type": "baseline"})
        self.assertEqual(status, 502)
        self.assertEqual(data["detail"]["message"], "Dataplane cleanup failed")
        self.assertEqual(manager.status, "FAILED")
        manager.start_controller.assert_not_awaited()

    async def test_successful_links_restore_stop_and_start_still_200(self):
        for path, body in (("/api/links/down", {"node1": "s1", "node2": "s2"}),
                           ("/api/links/up", {"node1": "s1", "node2": "s2"}),
                           ("/api/links/restore-all", {}), ("/api/simulation/stop", {})):
            status, data = await self.post(path, body)
            self.assertEqual((status, data["status"]), (200, "ok"))
        with patch.object(self.client, "ensure_worker", new_callable=AsyncMock), \
                patch.object(simulation.controller_manager, "status", "READY"), \
                patch.object(simulation.controller_manager, "active_controller", "baseline"):
            status, data = await self.post("/api/simulation/start")
        self.assertEqual(status, 200)
        self.assertEqual(self.client.simulation_state, "RUNNING")

    async def test_start_and_stop_errors_never_publish_success_state(self):
        for action in ("start", "stop"):
            self.reply = {"status": "error", "message": "Network operation failed"}
            self.broadcast.reset_mock()
            with patch.object(self.client, "ensure_worker", new_callable=AsyncMock), \
                    patch.object(simulation.controller_manager, "status", "READY"), \
                    patch.object(simulation.controller_manager, "active_controller", "reactive"):
                status, _ = await self.post("/api/simulation/" + action)
            self.assertEqual(status, 502)
            self.assertEqual(self.client.simulation_state, "ERROR")
            states = [c.args[0].get("state") for c in self.broadcast.await_args_list]
            self.assertNotIn("RUNNING" if action == "start" else "STOPPED", states)

    async def test_failed_traffic_start_does_not_register_job_or_polling(self):
        self.reply = {"status": "error", "message": "Traffic process failed to start"}
        status, _ = await self.post("/api/traffic/start")
        self.assertEqual(status, 502)
        self.assertIsNone(self.service.active_job_id)
        self.assertIsNone(self.service.polling_task)

    async def test_successful_traffic_start_registers_job(self):
        self.reply = {"status": "ok", "job_id": "test", "active": True}
        with patch.object(self.service, "_poll_stats", new_callable=AsyncMock):
            status, _ = await self.post("/api/traffic/start", {"job_id": "test"})
            await self.service.polling_task
        self.assertEqual(status, 200)
        self.assertEqual(self.service.active_job_id, "test")

    async def test_timeout_protocol_and_unsafe_worker_errors(self):
        for reply, expected in ((b"", 502), (b"not json", 502), (b"[]", 502),
                                ({"status": "error", "message": "Traceback File /secret/config.py"}, 502)):
            self.reply = reply
            status, data = await self.post("/api/links/down", {"node1": "s1", "node2": "s2"})
            self.assertEqual(status, expected)
            self.assertNotIn("/secret", json.dumps(data))
            self.assertNotIn("Traceback", json.dumps(data))
        self.connect.side_effect = asyncio.TimeoutError()
        status, _ = await self.post("/api/links/down", {"node1": "s1", "node2": "s2"})
        self.assertEqual(status, 504)

    async def test_raw_controller_exception_is_safe_500(self):
        with patch.object(controllers.controller_manager, "select_controller", AsyncMock(side_effect=RuntimeError("secret /home/user/app.py"))):
            status, data = await self.post("/api/controllers/select", {"controller_type": "reactive"})
        self.assertEqual(status, 500)
        self.assertNotIn("/home", json.dumps(data))

    async def test_controller_readiness_timeout_is_not_ready_or_http_success(self):
        manager = cm.ControllerManager()
        manager.is_port_in_use = Mock(return_value=False)
        manager._kill_process_on_port = Mock()
        process = SimpleNamespace(returncode=None, pid=123)
        with patch.object(controllers, "controller_manager", manager), \
                patch.object(self.client, "reset_dataplane", AsyncMock(return_value={"status": "ok", "switches": []})), \
                patch.object(cm.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)), \
                patch.object(cm.asyncio, "sleep", new_callable=AsyncMock), \
                patch.object(manager, "_stream_logs", new_callable=AsyncMock):
            status, data = await self.post("/api/controllers/select", {"controller_type": "reactive"})
            await manager.log_task
        self.assertEqual(status, 502)
        self.assertEqual(manager.status, "FAILED")
        self.assertIn("6653", data["detail"]["message"])
        self.assertNotIn("READY", [c.args[0].get("status") for c in self.broadcast.await_args_list])

    async def test_experiment_worker_failure_is_saved_failed_not_completed(self):
        runner = er.ExperimentRunner()
        with patch.object(experiments, "experiment_runner", runner), \
                patch.object(er, "save_event_log"), patch.object(er, "save_experiment") as save, \
                patch.object(er.controller_manager, "select_controller", new_callable=AsyncMock), \
                patch.object(er.asyncio, "sleep", new_callable=AsyncMock):
            self.reply = {"status": "error", "message": "Restoration failed"}
            status, _ = await self.post("/api/experiments/run")
        self.assertEqual(status, 502)
        self.assertEqual(save.call_args.args[0]["status"], "FAILED")
        self.assertFalse(runner.is_running)

    async def test_final_experiment_restore_failure_prevents_success_broadcast(self):
        runner = er.ExperimentRunner()
        ups = 0

        def write(data):
            nonlocal ups
            self.write(data)
            payload = json.loads(data)
            self.reply = {"status": "ok"}
            if payload["command"] == "set_link_status" and payload["status"] == "up":
                ups += 1
                if ups == 2:
                    self.reply = {"status": "error", "message": "Final restoration failed"}
            elif payload["command"] == "get_traffic_stats":
                self.reply = {"active": False, "transmitted": 1, "received": 1, "loss_percent": 0}
        self.writer.write.side_effect = write
        with patch.object(experiments, "experiment_runner", runner), \
                patch.object(er, "save_event_log"), patch.object(er, "save_experiment") as save, \
                patch.object(er.controller_manager, "select_controller", new_callable=AsyncMock), \
                patch.object(er.asyncio, "sleep", new_callable=AsyncMock):
            status, _ = await self.post("/api/experiments/run")
        self.assertEqual(status, 502)
        self.assertEqual(ups, 2)
        self.assertEqual(save.call_args.args[0]["status"], "FAILED")
        finished = [c.args[0] for c in self.broadcast.await_args_list if c.args[0].get("event_type") == "EXPERIMENT_FINISHED"]
        self.assertEqual(len(finished), 1)
        self.assertEqual(finished[0]["experiment"]["status"], "FAILED")


class WorkerErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_commands_and_stopped_operation_return_typed_errors(self):
        for payload, code in (({}, "invalid_request"), ([], "invalid_request"),
                              ({"command": "set_link_status", "node1": "s1", "node2": "s2", "status": "down"}, "not_running"),
                              ({"command": "start_traffic"}, "invalid_request")):
            worker = mw.MininetWorker()
            reader = SimpleNamespace(readline=AsyncMock(side_effect=[json.dumps(payload).encode(), b""]))
            writer = SimpleNamespace(write=Mock(), drain=AsyncMock(), close=Mock(), wait_closed=AsyncMock())
            await worker.handle_client(reader, writer)
            self.assertEqual(json.loads(writer.write.call_args.args[0])["error_code"], code)

    async def test_missing_link_never_calls_mininet(self):
        worker = mw.MininetWorker()
        worker.net = SimpleNamespace(links=[], configLinkStatus=Mock())
        with self.assertRaises(OperationError) as error:
            worker.set_link_status("s1", "s4", "down")
        self.assertEqual(error.exception.status_code, 404)
        worker.net.configLinkStatus.assert_not_called()

    async def test_link_requires_both_endpoints_and_checked_command(self):
        class Switch:
            def __init__(self, name):
                self.name = name
        intfs = [SimpleNamespace(node=Switch(name), name=f"{name}-eth1", isUp=Mock(return_value=True))
                 for name in ("s1", "s2")]
        worker = mw.MininetWorker()
        worker.net = SimpleNamespace(links=[SimpleNamespace(intf1=intfs[0], intf2=intfs[1])], configLinkStatus=Mock())
        with patch.object(mw, "OVSSwitch", Switch, create=True), patch.object(mw.subprocess, "run") as run:
            self.assertEqual(worker.set_link_status("s1", "s2", "up")["status"], "ok")
            self.assertEqual(run.call_count, 2)
            self.assertTrue(all(c.kwargs["check"] for c in run.call_args_list))
            intfs[1].isUp.return_value = False
            with self.assertRaises(OperationError):
                worker.set_link_status("s1", "s2", "up")
            run.side_effect = subprocess.CalledProcessError(1, "ip")
            with self.assertRaises(OperationError):
                worker.set_link_status("s1", "s2", "down")

    async def test_worker_stop_and_ovs_cleanup_failure_propagate(self):
        worker = mw.MininetWorker()
        worker.net = SimpleNamespace(stop=Mock(side_effect=RuntimeError("stop failed")))
        with self.assertRaises(OperationError):
            worker.stop_network()
        self.assertIsNotNone(worker.net)
        worker.net = None
        with patch.object(mw.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "ovs-vsctl")):
            with self.assertRaises(subprocess.CalledProcessError):
                worker.stop_network()


if __name__ == "__main__":
    unittest.main()
