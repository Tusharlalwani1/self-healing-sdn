"""C07 lifecycle tests. No Ryu, OVS, Mininet or persistent DB writes."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from backend.api import simulation
from backend.services import controller_manager as cm
from backend.tests.test_runtime_errors import request
from backend.services.operation_error import OperationError


class Process:
    def __init__(self, pid):
        self.pid, self.returncode = pid, None
        self.done = asyncio.Event()

    async def wait(self):
        await self.done.wait()
        return self.returncode

    def exit(self, code):
        self.returncode = code
        self.done.set()


class ControllerExitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        self.broadcast = patch.object(cm.ws_manager, "broadcast", new_callable=AsyncMock).start()
        self.logs = patch.object(cm, "save_event_log").start()
        patch.object(cm.mininet_client, "reset_dataplane", AsyncMock(return_value={"status": "ok", "switches": ["s1"]})).start()
        self.manager = cm.ControllerManager()
        self.manager.is_port_in_use = Mock(return_value=False)
        self.manager.owns_listener = Mock(return_value=True)
        self.manager._kill_process_on_port = Mock()
        self.manager._stream_logs = AsyncMock()
        self.processes = {}
        patch.object(cm.os, "getpgid", side_effect=lambda pid: pid).start()
        patch.object(cm.os, "killpg", side_effect=lambda pid, sig: self.processes[pid].exit(-int(sig))).start()
        self.addAsyncCleanup(self.manager.stop_controller)

    async def start(self, mode="reactive"):
        process = Process(1000 + len(self.processes))
        self.processes[process.pid] = process
        with patch.object(cm.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
            await self.manager.select_controller(mode)
        return process

    async def test_startup_alive_and_owned_listener_is_ready(self):
        process = await self.start()
        self.assertEqual(self.manager.status, "READY")
        self.assertIsNone(process.returncode)
        self.assertIsNotNone(self.manager.watch_task)

    async def test_exit_during_startup_remains_failed_with_http_service_error(self):
        process = Process(1000)
        self.processes[process.pid] = process
        process.exit(3)
        with patch.object(cm.asyncio, "create_subprocess_exec", AsyncMock(return_value=process)):
            with self.assertRaises(OperationError) as error:
                await self.manager.select_controller("reactive")
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(self.manager.status, "FAILED")
        self.assertEqual(self.manager.exit_code, 3)
        self.assertIsNone(self.manager.watch_task)

    async def test_ready_broadcast_precedes_exit_failure(self):
        async def send(message):
            if message.get("status") == "READY":
                self.manager.process.exit(2)
                await asyncio.sleep(0)
        self.broadcast.side_effect = send
        await self.start()
        await self.manager.watch_task
        states = [c.args[0].get("status") for c in self.broadcast.await_args_list]
        self.assertEqual(states[-2:], ["READY", "FAILED"])

    async def test_unexpected_exit_reports_code_once_and_preserves_mininet(self):
        process = await self.start()
        with patch.object(cm.mininet_client, "simulation_state", "RUNNING"):
            process.exit(7)
            await asyncio.wait_for(self.manager.watch_task, 1)
            await self.manager.reconcile_health()
            self.assertEqual(cm.mininet_client.simulation_state, "RUNNING")
        self.assertEqual(self.manager.status, "FAILED")
        self.assertEqual(self.manager.exit_code, 7)
        failed = [c.args[0] for c in self.broadcast.await_args_list if c.args[0].get("status") == "FAILED"]
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["exit_code"], 7)

    async def test_zero_exit_is_also_unexpected(self):
        process = await self.start()
        process.exit(0)
        await asyncio.wait_for(self.manager.watch_task, 1)
        self.assertEqual(self.manager.status, "FAILED")
        self.assertEqual(self.manager.exit_code, 0)

    async def test_intentional_stop_cancels_watcher_without_failure(self):
        await self.start()
        await self.manager.stop_controller()
        self.assertIsNone(self.manager.watch_task)
        self.assertEqual(self.manager.status, "STOPPED")
        self.assertFalse(any(c.args[0].get("status") == "FAILED" for c in self.broadcast.await_args_list))

    async def test_switch_cannot_be_overwritten_by_old_exit(self):
        old = await self.start()
        old_watcher = self.manager.watch_task
        new = await self.start("fast_failover")
        self.assertTrue(old_watcher.done())
        self.assertIs(self.manager.process, new)
        # Explicitly simulate a late old watcher, even after cancellation.
        await self.manager._watch_controller(old)
        self.assertEqual(self.manager.status, "READY")
        self.assertEqual(self.manager.active_controller, "fast_failover")
        self.assertFalse(any(c.args[0].get("status") == "FAILED" for c in self.broadcast.await_args_list))

    async def test_explicit_restart_recovers_after_failure(self):
        old = await self.start()
        old.exit(-9)
        await self.manager.watch_task
        new = await self.start()
        self.assertIs(self.manager.process, new)
        self.assertEqual(self.manager.status, "READY")
        self.assertIsNone(self.manager.exit_code)
        self.assertIsNone(self.manager.failure_reason)

    async def test_status_reconciles_dead_process_before_watcher_runs(self):
        process = await self.start()
        process.exit(-9)
        app = FastAPI()
        app.include_router(simulation.router)
        with patch.object(simulation, "controller_manager", self.manager), \
                patch.object(simulation.mininet_client, "simulation_state", "RUNNING"):
            status, data = await request(app, "/api/simulation/status", method="GET")
        self.assertEqual(status, 200)
        self.assertEqual(data["controller_status"], "FAILED")
        self.assertEqual(data["state"], "RUNNING")
        self.assertEqual(data["exit_code"], -9)
        self.assertEqual(data["pid"], process.pid)

    async def test_listener_loss_detected_without_process_exit_or_repeated_alert(self):
        failure_reported = asyncio.Event()

        async def observe_status(message):
            if (message.get("event_type") == "CONTROLLER_STATUS" and
                    message.get("status") == "FAILED" and
                    message.get("controller_generation") == self.manager.generation):
                failure_reported.set()

        self.broadcast.side_effect = observe_status
        await self.start()
        self.manager.owns_listener.return_value = False
        # A 1.1s sleep races the watcher's 1s wait_for timeout: under a
        # delayed event loop both timers can become ready before timeout
        # cancellation callbacks finish. Observe the real transition instead.
        # This timeout bounds a broken watcher; it is not a polling delay.
        await asyncio.wait_for(failure_reported.wait(), timeout=5.0)
        self.assertEqual(self.manager.status, "FAILED")
        self.assertIsNone(self.manager.process.returncode)
        self.assertEqual(self.manager.failure_reason, "Managed Ryu listener on port 6653 is unavailable")
        await self.manager.reconcile_health()
        failed = [c.args[0] for c in self.broadcast.await_args_list if c.args[0].get("status") == "FAILED"]
        self.assertEqual(len(failed), 1)
        states = [c.args[0]["status"] for c in self.broadcast.await_args_list
                  if c.args[0].get("event_type") == "CONTROLLER_STATUS"]
        self.assertEqual(states, ["STARTING", "READY", "FAILED"])


class ListenerOwnershipTests(unittest.TestCase):
    def test_unrelated_listener_does_not_prove_managed_readiness(self):
        manager = cm.ControllerManager()
        process = SimpleNamespace(pid=123, returncode=None)
        listener = SimpleNamespace(status=cm.psutil.CONN_LISTEN, laddr=SimpleNamespace(port=6653, ip="0.0.0.0"))
        with patch.object(cm.psutil, "Process") as inspect:
            inspect.return_value.net_connections.return_value = []
            self.assertFalse(manager.owns_listener(process))
            inspect.assert_called_with(123)
            inspect.return_value.net_connections.return_value = [listener]
            self.assertTrue(manager.owns_listener(process))
            process.returncode = 1
            self.assertFalse(manager.owns_listener(process))


if __name__ == "__main__":
    unittest.main()
