"""Controlled scheduler-stall reproduction; fixture Ryu only, no live SDN IO.

Run from the repository root. This diagnostic is outside unittest discovery.
"""
import asyncio
import json
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.tests.test_controller_exit import ControllerExitTests


class ListenerTimingProbe(ControllerExitTests):
    async def runTest(self):
        timeline = []
        failed = asyncio.Event()
        origin = time.monotonic()

        async def status(message):
            if message.get('event_type') == 'CONTROLLER_STATUS':
                timeline.append({'event': message['status'], 'elapsed': time.monotonic() - origin})
                if message['status'] == 'FAILED':
                    failed.set()

        self.broadcast.side_effect = status
        process = await self.start()
        self.manager.owns_listener.return_value = False
        start = time.monotonic()

        def stall():
            timeline.append({'event': 'stall_start', 'elapsed': time.monotonic() - origin})
            # Deliberately force both the 1.0s watcher timer and 1.1s test
            # timer overdue in one event-loop iteration. Diagnostic only.
            time.sleep(.4)
            timeline.append({'event': 'stall_end', 'elapsed': time.monotonic() - origin})

        handle = asyncio.get_running_loop().call_later(.85, stall)
        try:
            await asyncio.sleep(1.1)  # Reproduce the original observation.
            at_old_assertion = {'state': self.manager.status,
                'since_listener_loss': time.monotonic() - start,
                'watcher_done': self.manager.watch_task.done(),
                'process_returncode': process.returncode,
                'watcher_stack': [f.f_code.co_name + ':' + str(f.f_lineno)
                                  for f in self.manager.watch_task.get_stack()]}
            self.assertEqual(at_old_assertion['state'], 'READY')
            # No reconcile_health call: prove the existing watcher itself
            # commits the correct failure once its timeout handler resumes.
            await asyncio.wait_for(failed.wait(), timeout=3)
            self.assertEqual(self.manager.status, 'FAILED')
            self.assertIsNone(process.returncode)
            self.assertEqual([item['event'] for item in timeline].count('FAILED'), 1)
            print(json.dumps({'old_assertion_snapshot': at_old_assertion,
                              'event_synchronized_state': self.manager.status,
                              'timeline': timeline}, indent=2))
        finally:
            handle.cancel()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'repeat':
        count = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        suite = unittest.TestSuite(ControllerExitTests(
            'test_listener_loss_detected_without_process_exit_or_repeated_alert') for _ in range(count))
    else:
        suite = unittest.TestSuite([ListenerTimingProbe('runTest')])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
