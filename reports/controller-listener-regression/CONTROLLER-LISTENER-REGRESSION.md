# Controller listener regression: deterministic observation

## Root cause and reproduction

The failing test simulates loss of the managed OpenFlow listener while its fake process is still alive (`returncode is None`). It is not an unexpected-process-exit scenario. The production watcher monitors both cases, and the separate exit tests remain in the complete suite.

The test previously awaited `asyncio.sleep(1.1)` and immediately asserted FAILED. The watcher independently awaits `asyncio.wait_for(asyncio.shield(process_wait_task), timeout=1.0)`. A delayed event loop can make both timer callbacks due in the same iteration. `wait_for` must resume and finish cancellation of its shield wrapper before raising TimeoutError to the listener-check branch. The test's sleep can finish before those callbacks complete, even after more than 1.1 seconds of wall time. At that observation the process is alive, the watcher is pending at controller_manager.py's wait_for, and READY has not yet transitioned to FAILED.

This was reproduced before the fix with **20 unchanged isolated runs: 17 passed, 3 failed**. Therefore the flake is not exclusive to full-suite execution; full-suite scheduling/IO load made the invalid timing assumption more visible.

The controlled `listener_timing_probe.py` schedules a 0.4-second event-loop stall beginning 0.85 seconds after the simulated listener loss. This deliberately makes the watcher and old test timers overdue together. It observed READY about 1.269 seconds after listener loss, with a pending watcher and live process. Without calling reconcile_health, the same watcher then committed and broadcast exactly one FAILED event. The timeline was STARTING -> READY -> FAILED, with no later READY update. This isolates the observation race without test-order dependence, a real Ryu process or live Mininet IO. The deliberate blocking stall is diagnostic only; it is not part of the fix or normal backend discovery.

## Lifecycle and fixture audit

- Each ControllerExitTests case constructs its own ControllerManager and fake Process objects under IsolatedAsyncioTestCase.
- Async cleanup awaits stop_controller before patch.stopall restores fixture dependencies (LIFO cleanup registration).
- Stop marks the process as stopping, cancels and awaits the watcher, and the watcher's finally block cancels and awaits its child process-wait task. The log task is also awaited.
- Startup finishes broadcasting READY before creating the watcher, preserving startup/failure message order.
- `_mark_failed` commits state before awaiting and checks process identity/stop intent, so an old process cannot fail its replacement.
- Existing tests cover unexpected exit, startup exit, intentional stop, old watcher completion after switching, explicit restart, and health reconciliation. No stale READY overwrite or leaked singleton/task was required to reproduce this failure.

## Exact fix

Only `backend/tests/test_controller_exit.py::ControllerExitTests.test_listener_loss_detected_without_process_exit_or_repeated_alert` changes executable backend test behavior:

1. Install a per-test asyncio.Event observer on the existing mock broadcast.
2. Match an actual CONTROLLER_STATUS / FAILED notification for this manager's controller generation.
3. Await that event, with a five-second watchdog to fail a broken/missing transition. This is not a sleep, poll or retry; a successful wait finishes when the real watcher publishes failure.
4. Retain the exact FAILED state assertion before any explicit reconciliation and the exactly-one-failure-alert assertion after reconciliation.
5. Strengthen the test to require a live process, the exact listener-unavailable reason, and the status sequence STARTING -> READY -> FAILED.

No production controller manager, controller script, listener poll interval, topology, recovery verification, intent policy or measurement behavior is changed. A watcher that never detects failure, publishes the wrong generation, leaves state READY, misclassifies process exit as listener loss, duplicates a failure alert or publishes a stale READY still fails the test.

## Validation record

- Original isolated regression: **20 run, 17 passed, 3 failed**, preserved in `baseline-repeat-output.txt`.
- Corrected isolated regression, final assertions: **20/20 passed**, preserved in `fixed-repeat-output.txt`.
- Controlled late-timer diagnostic: **1/1 passed**, with the old READY observation and event-synchronized FAILED result preserved in `timing-probe-output.txt`.
- Complete backend run #1: **233 passed, 0 failures/errors**, fresh process, 173.433 seconds; `backend-run-1-output.txt`.
- Complete backend run #2: **233 passed, 0 failures/errors**, fresh process, 165.175 seconds; `backend-run-2-output.txt`.
- Frontend checks and browser evidence are recorded in the final validation summary after completion.

Reproduction from repository root (Ubuntu-22.04 WSL):

```sh
/home/i7__6thgen/sdn-env/bin/python3 reports/controller-listener-regression/listener_timing_probe.py
/home/i7__6thgen/sdn-env/bin/python3 reports/controller-listener-regression/listener_timing_probe.py repeat 20
/home/i7__6thgen/sdn-env/bin/python3 -m unittest discover -s backend/tests
```

The baseline log was captured before editing the test. The repeat command now exercises the corrected test. The suite remains 233 tests; the diagnostic lives outside backend/tests and adds no discovery test, skip or xfail. All privileged SDN/process IO and persistence in this fixture are mocked. The runtime database must remain unchanged and unstaged. No commit or push is authorized or performed.
