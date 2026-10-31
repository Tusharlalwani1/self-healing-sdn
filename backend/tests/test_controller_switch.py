"""C04 regression tests. OVS/process IO is mocked; these are not SDN tests."""
import asyncio
import itertools
import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from backend.services import controller_manager as cm
from backend.services import experiment_runner as er
from backend.services import mininet_client as mc
from backend.services.mininet_worker import MininetWorker


class ControllerSwitchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.events = []
        self.broadcast = AsyncMock()
        self.addCleanup(patch.stopall)
        patch.object(cm.ws_manager, "broadcast", self.broadcast).start()
        patch.object(cm, "save_event_log").start()
        self.reset = patch.object(cm.mininet_client, "reset_dataplane", new_callable=AsyncMock).start()

        async def reset():
            self.events.append("reset")
            return {"status": "ok", "switches": ["s1", "s2", "s3", "s4"]}
        self.reset.side_effect = reset

    def manager(self, old):
        manager = cm.ControllerManager()
        manager.active_controller = old
        manager.status = "READY"
        manager.process = SimpleNamespace(returncode=None)

        async def stop():
            self.events.append("stop")
            manager.process = None
            manager.status = "STOPPED"

        async def start(mode):
            self.events.append("start:" + mode)
            manager.process = SimpleNamespace(returncode=None)
            manager.status = "READY"
            return {"status": "ok", "controller": mode, "state": "READY"}

        manager._stop_controller = AsyncMock(side_effect=stop)
        manager.start_controller = AsyncMock(side_effect=start)
        manager._kill_process_on_port = Mock(side_effect=lambda port: self.events.append("orphans"))
        manager.is_port_in_use = Mock(return_value=False)
        return manager

    async def test_all_mode_transitions_stop_reset_then_start(self):
        for old, new in itertools.permutations(("baseline", "reactive", "fast_failover"), 2):
            with self.subTest(old=old, new=new):
                self.events.clear()
                manager = self.manager(old)
                result = await manager.select_controller(new)
                self.assertEqual(self.events, ["stop", "orphans", "reset", "start:" + new])
                self.assertEqual(result["controller"], new)
                self.assertEqual(manager.status, "READY")

    async def test_healthy_same_mode_is_noop(self):
        manager = self.manager("fast_failover")
        manager.is_port_in_use.return_value = True
        result = await manager.select_controller("fast_failover")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(self.events, [])
        self.reset.assert_not_awaited()
        manager.start_controller.assert_not_awaited()

    async def test_forced_same_mode_run_gets_fresh_boundary(self):
        manager = self.manager("reactive")
        await manager.select_controller("reactive", force_restart=True)
        self.assertEqual(self.events, ["stop", "orphans", "reset", "start:reactive"])

    async def test_cleanup_failure_never_launches_or_reports_ready(self):
        manager = self.manager("fast_failover")
        self.reset.side_effect = RuntimeError("del-groups s2 failed")
        with self.assertRaisesRegex(RuntimeError, "del-groups s2 failed"):
            await manager.select_controller("baseline")
        manager.start_controller.assert_not_awaited()
        self.assertEqual(manager.status, "FAILED")
        messages = [call.args[0] for call in self.broadcast.await_args_list]
        self.assertEqual(messages[-1]["status"], "FAILED")
        self.assertNotIn("READY", [msg["status"] for msg in messages])
        cm.save_event_log.assert_called_with(
            "ERROR", "CONTROLLER", "Controller switch to baseline failed: del-groups s2 failed"
        )

    async def test_stop_failure_or_occupied_port_blocks_cleanup(self):
        manager = self.manager("fast_failover")
        manager._stop_controller.side_effect = RuntimeError("old process still alive")
        with self.assertRaisesRegex(RuntimeError, "old process still alive"):
            await manager.select_controller("baseline")
        self.reset.assert_not_awaited()
        manager = self.manager("fast_failover")
        manager.is_port_in_use.return_value = True
        with self.assertRaisesRegex(RuntimeError, "still in use"):
            await manager.select_controller("baseline")
        self.reset.assert_not_awaited()
        manager.start_controller.assert_not_awaited()

    async def test_overlapping_selections_are_serialized(self):
        manager = self.manager("baseline")
        entered, release = asyncio.Event(), asyncio.Event()

        async def blocked_reset():
            self.events.append("reset")
            entered.set()
            await release.wait()
            return {"status": "ok"}

        self.reset.side_effect = blocked_reset
        first = asyncio.create_task(manager.select_controller("reactive"))
        await entered.wait()
        second = asyncio.create_task(manager.select_controller("fast_failover"))
        await asyncio.sleep(0)
        self.assertEqual(self.events, ["stop", "orphans", "reset"])
        release.set()
        await asyncio.gather(first, second)
        self.assertEqual(self.events, [
            "stop", "orphans", "reset", "start:reactive",
            "stop", "orphans", "reset", "start:fast_failover",
        ])

    async def test_stop_waits_after_sigkill_before_releasing_process(self):
        manager = cm.ControllerManager()
        manager.process = SimpleNamespace(pid=12345, returncode=None)
        waits = []

        async def wait():
            waits.append("wait")
            if len(waits) == 1:
                raise asyncio.TimeoutError()
            manager.process.returncode = -9
            return -9

        manager.process.wait = AsyncMock(side_effect=wait)
        with patch.object(cm.os, "getpgid", return_value=12345), patch.object(cm.os, "killpg") as kill:
            await manager.stop_controller()
        self.assertEqual(len(waits), 2)
        self.assertEqual(kill.call_args_list[-1].args[1], cm.signal.SIGKILL)
        self.assertIsNone(manager.process)


class WorkerResetTests(unittest.TestCase):
    def setUp(self):
        self.worker = MininetWorker()
        self.worker.net = SimpleNamespace(
            switches=[SimpleNamespace(name="s" + str(i)) for i in range(1, 5)],
            controllers=[SimpleNamespace(IP=lambda: "127.0.0.1", port=6653)],
        )
        self.calls = []

    def ovs(self, args, **kwargs):
        self.calls.append(args)
        self.assertTrue(kwargs["check"])
        self.assertEqual(kwargs["timeout"], 5)
        output = "secure\n" if "get-fail-mode" in args else ""
        return subprocess.CompletedProcess(args, 0, output, "")

    def test_drop_all_sessions_then_delete_flows_groups_and_verify(self):
        with patch("backend.services.mininet_worker.subprocess.run", side_effect=self.ovs):
            result = self.worker.reset_dataplane()
        self.assertEqual(result["switches"], ["s1", "s2", "s3", "s4"])
        dropped = [i for i, args in enumerate(self.calls) if "bridge/reconnect" in args]
        self.assertEqual(len(dropped), 4)
        self.assertFalse(any("del-controller" in args or "set-controller" in args for args in self.calls))
        for name in result["switches"]:
            commands = [(i, args[-2]) for i, args in enumerate(self.calls) if args[0] == "ovs-ofctl" and args[-1] == name]
            self.assertEqual([command for _, command in commands], ["del-flows", "del-groups", "dump-flows", "dump-groups"])
            self.assertTrue(all(max(dropped) < i for i, _ in commands))
        # Existing topology object, hosts, interfaces and link states are not rebuilt.
        self.assertEqual(len(self.worker.net.switches), 4)

    def test_flow_or_group_command_failure_propagates(self):
        for command in ("del-flows", "del-groups"):
            with self.subTest(command=command):
                self.calls.clear()

                def fail(args, **kwargs):
                    if command in args:
                        self.calls.append(args)
                        raise subprocess.CalledProcessError(1, args, stderr="OVS rejected reset")
                    return self.ovs(args, **kwargs)

                with patch("backend.services.mininet_worker.subprocess.run", side_effect=fail):
                    with self.assertRaisesRegex(RuntimeError, "OVS rejected reset"):
                        self.worker.reset_dataplane()
                self.assertFalse(any("dump-flows" in args for args in self.calls))

    def test_nonempty_flows_or_groups_fail_verification(self):
        for command, output in (("dump-flows", "cookie=0x0, actions=group:1"), ("dump-groups", "group_id=1,type=ff")):
            with self.subTest(command=command):
                def stale(args, **kwargs):
                    result = self.ovs(args, **kwargs)
                    if command in args:
                        result.stdout = output
                    return result
                with patch("backend.services.mininet_worker.subprocess.run", side_effect=stale):
                    with self.assertRaisesRegex(RuntimeError, "verification failed"):
                        self.worker.reset_dataplane()

    def test_session_reset_failure_is_not_success(self):
        def fail(args, **kwargs):
            if "bridge/reconnect" in args:
                raise subprocess.CalledProcessError(1, args, stderr="cannot drop old session")
            return self.ovs(args, **kwargs)
        with patch("backend.services.mininet_worker.subprocess.run", side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, "cannot drop old session"):
                self.worker.reset_dataplane()

    def test_nonsecure_mode_is_rejected_before_cleanup(self):
        def standalone(args, **kwargs):
            result = self.ovs(args, **kwargs)
            if "get-fail-mode" in args:
                result.stdout = "standalone"
            return result
        with patch("backend.services.mininet_worker.subprocess.run", side_effect=standalone):
            with self.assertRaisesRegex(RuntimeError, "expected secure fail mode"):
                self.worker.reset_dataplane()
        self.assertFalse(any("del-flows" in args for args in self.calls))

    def test_no_network_is_noop(self):
        self.worker.net = None
        with patch("backend.services.mininet_worker.subprocess.run") as run:
            self.assertEqual(self.worker.reset_dataplane()["switches"], [])
        run.assert_not_called()


class ClientAndExperimentTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_validates_reset_and_preserves_simulation_state(self):
        client = mc.MininetClient()
        client.simulation_state = "RUNNING"
        client._send_command = AsyncMock(return_value={"status": "ok", "switches": ["s1"]})
        with patch.object(mc.os.path, "exists", return_value=True):
            await client.reset_dataplane()
            self.assertEqual(client.simulation_state, "RUNNING")
            client._send_command.assert_awaited_with({"command": "reset_dataplane"}, timeout=90.0)
            for response in (None, {"status": "error", "message": "OVS failed"}, {"status": "ok"}, {"status": "ok", "switches": []}):
                client._send_command.return_value = response
                with self.assertRaises(RuntimeError):
                    await client.reset_dataplane()
            client._send_command.side_effect = asyncio.TimeoutError()
            with self.assertRaisesRegex(RuntimeError, "Dataplane reset request failed .TimeoutError"):
                await client.reset_dataplane()

    async def test_missing_worker_rejected_unless_simulation_stopped(self):
        client = mc.MininetClient()
        with patch.object(mc.os.path, "exists", return_value=False):
            client.simulation_state = "RUNNING"
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                await client.reset_dataplane()
            client.simulation_state = "STOPPED"
            self.assertEqual((await client.reset_dataplane())["switches"], [])

    async def test_worker_ipc_dispatches_reset(self):
        worker = MininetWorker()
        worker.reset_dataplane = Mock(return_value={"status": "ok", "switches": ["s1"]})
        reader = SimpleNamespace(readline=AsyncMock(side_effect=[b'{"command":"reset_dataplane"}\n', b'']))
        writer = SimpleNamespace(write=Mock(), drain=AsyncMock(), close=Mock(), wait_closed=AsyncMock())
        await worker.handle_client(reader, writer)
        worker.reset_dataplane.assert_called_once_with()
        self.assertEqual(json.loads(writer.write.call_args.args[0])["status"], "ok")

    async def test_experiment_forces_shared_boundary_even_for_same_ready_mode(self):
        runner = er.ExperimentRunner()
        with patch.object(er, "save_event_log"), patch.object(er, "save_experiment") as save, \
                patch.object(er.ws_manager, "broadcast", new_callable=AsyncMock), \
                patch.object(er.controller_manager, "active_controller", "reactive"), \
                patch.object(er.controller_manager, "status", "READY"), \
                patch.object(er.controller_manager, "select_controller", new_callable=AsyncMock) as select, \
                patch.object(er.mininet_client, "start_simulation", new_callable=AsyncMock) as start:
            select.side_effect = RuntimeError("cleanup failed")
            with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
                await runner.run_experiment("reactive")
            select.assert_awaited_once_with("reactive", force_restart=True)
            start.assert_not_awaited()
            self.assertEqual(save.call_args.args[0]["status"], "FAILED")


if __name__ == "__main__":
    unittest.main()
