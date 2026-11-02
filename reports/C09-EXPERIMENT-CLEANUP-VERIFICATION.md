# C09 — Experiment cancellation / failure cleanup verification

Status: implemented; automated verification recorded below. Live dashboard/Mininet/Ryu/OVS verification remains pending. Only C09 is addressed. No commit, push, topology change, controller algorithm change, UI redesign, or C10 implementation.

## 1. Confirmed root causes and audit concerns

The pre-change source was traced before editing. The findings are supported by explicit fake-IPC lifecycle regression tests; no claim is made that a live pre-change SDN experiment was executed. Existing C08 ownership checks were retained rather than replacing them with generic traffic cleanup.

| Concern | Finding before C09 | Relevant code / evidence |
|---|---|---|
| 1. Experiment task remains alive | Confirmed | `ExperimentRunner.cancel` only set a flag. `_run_single` checked it once after failure_delay, not in collection; comparison reset it for the next child. |
| 2. Experiment ping remains alive | Confirmed | Cancellation/exception handlers never stopped the experiment job. Worker stop additionally abandoned ping when SIGINT readiness timed out. |
| 3. TrafficService job remains active | Not applicable to experiment ownership | Experiments already bypassed TrafficService and used their own explicit MininetClient job. Manual traffic is intentionally not stopped by experiment cleanup. |
| 4. Worker job remains active | Confirmed | Worker retained its process/job until natural completion or an unrelated network stop. |
| 5. Injected link stays DOWN | Confirmed | Restoration existed only on the successful path; no finally cleanup restored an interrupted injection. |
| 6. DB/status remains RUNNING | Partially confirmed | Initial RUNNING records were not saved to SQLite. Memory/UI could stay busy; the initial event/log operations also preceded try/finally. No new database RUNNING rows are introduced. |
| 7. UI stays RUNNING after cancellation | Confirmed | Runner sent CANCELLED as EXPERIMENT_PROGRESS, whose store handler unconditionally set experimentRunning=true. |
| 8. Delayed success after cancel | Confirmed | No cancel checks during collection, restoration or persistence; cancellation could be ignored. |
| 9. Temporary controller retained | Not applicable as a rollback bug | Experiments intentionally activate a mode and leave controller/network available afterward. No original-selection restoration contract exists. Keep this behavior. |
| 10. Busy flag never releases | Partially confirmed | Existing finally released it for most failures, but initial logging/broadcast preceded that protection. Comparison had unprotected busy gaps between children. |
| 11. A cleanup affects B | C08 telemetry already resolved; lifecycle gap confirmed | No resource cleanup existed to guard. C09 holds the busy boundary through cleanup and validates exact job, experiment and runtime for every cleanup mutation. |
| 12. Partial result saved as successful | Partially confirmed | C05 already prevented successful persistence after final restoration failure. Ignored cancellation could still produce COMPLETED; timeout could stop incomplete traffic and treat the run as success. |
| 13. Cancel reports success before cleanup | Confirmed | API unconditionally returned status=ok / Cancellation requested, including with no active run. |
| 14. Shutdown abandons experiment work | Confirmed | Shutdown stopped controller/network without requesting/joining experiment finalization first. |

Related pre-existing protection: C06 already drains exact final ping totals on normal explicit stop; C08 already uses an exact experiment job, generation/runtime checks and guarded frontend run IDs. These were preserved.

## 2. Complete lifecycle and resource ownership

| Phase | Current behavior and resource owner |
|---|---|
| A/B — Request / validation | Existing schema validates inputs. Runner synchronously reserves the busy boundary and unique request run ID; concurrent start returns 409. Reused terminal run IDs return 409. |
| C — Task creation | One named internal asyncio task owns the complete single/comparison workflow. HTTP awaits it through shield; request cancellation requests cooperative cancellation and joins this exact task. |
| D — Controller activation | Existing C04/C07 select_controller completes normally before cancellation is observed. No task.cancel interrupts a controller transition. Selected mode remains afterward. |
| E/F — Traffic / baseline | Warm-up pingall is awaited; it is bounded existing worker IO, not a detached job. The experiment records its unique traffic ID before starting. Client reserves its owner before IPC, allowing cleanup after a lost start acknowledgement. |
| G/H — Injection / collection | Capture runtime, controller generation, experiment lease, target's initial UP state and exact link. Mark injection intent before IPC to handle partial changes/lost acknowledgements. C08 recovery-event attribution is unchanged. |
| I/J/K — Restore / stop / final counters | Exact job stop retains C06 final summary accounting. Finally attempts restoration of this experiment's target only, using its runtime/lease. Both cleanup operations are attempted even if one fails. |
| L — Persistence | After cleanup, cancellation and controller/runtime validity are checked again. Only then is one terminal record saved and a final event emitted. |
| M — Task completion | Parent busy/run/task ownership is held until finalization/event delivery finishes. Comparison remains owned across all children and cooldowns. |
| N — Cancellation in any phase | Event wakes delays; checkpoints stop subsequent acquisitions/collection. Already in-flight IPC completes before cleanup. Terminal state is CANCELLED only after successful cleanup. |
| O/P/Q — Traffic / injection / restoration failure | Finally cleans all acquired/attempted resources. Lost traffic-start acknowledgement still allows exact job cleanup; lost down acknowledgement still attempts owned restoration. Cleanup failure becomes FAILED with diagnostics. |
| R/S — Activation / unexpected exception | Persist FAILED and release busy/lease after applicable cleanup. No controller rollback or automatic restart is introduced. |
| T — Graceful shutdown | Await runner cancellation/finalization before existing controller and Mininet teardown. Cleanup errors are logged, and remaining shutdown steps are still attempted. |

Per-child resources are local variables in `_run_single`: experiment ID, runtime ID, traffic job ID, injection intent, finalized-traffic flag, failure and cleanup errors. Parent run ID, task, cancel event and terminal result are maintained by the runner. No new general orchestration framework or schema migration was added.

## 3. Cancellation mechanism and race protections

`cancel()` remains a synchronous internal request helper. Public `cancel_and_wait(run_id)` verifies the exact parent run, sets its event/flag and awaits its shielded task. The frontend uses CANCELLING while waiting; the backend does not claim terminal cancellation before cleanup. Delays race a sleeper against the cancel event, cancelling/joining both helper tasks afterward. Worker/controller operations already in flight are awaited rather than interrupted. Existing socket/controller timeouts still apply.

Double cancel awaits the same task. Explicit repeated cancel of a known terminal run is a read of its cached terminal result, not another cleanup. A nonexistent/wrong run returns 404. After completion is committed, cancellation returns the actual terminal result, including COMPLETED; it does not rewrite history. Terminal IDs/results are backend-process-local, not a durable cancellation registry.

The busy boundary prevents B from starting until A's cleanup finishes. In addition, traffic cleanup validates job + experiment + runtime under the client runtime lock. Link cleanup checks runtime + experiment lease inside that same lock, serializing against simulation transitions and manual link mutations. A stale A request cannot stop B's job, restore B's link or clear B's lease. The HTTP wrapper captures its own task and checks its run identity before requesting cancellation; it never joins/cancels a replacement task accidentally.

Comparison children keep unique C08 IDs, but progress is associated with the parent request. Child final events cannot finish the parent UI. Cancellation ends the comparison after the current child's cleanup; no next controller starts. Exceptions terminate the parent with an error event.

## 4. Traffic cleanup and real process evidence

`MininetClient.stop_experiment_traffic` uses the exact owned ID, never TrafficService.stop or stop-whatever-is-active. It rejects foreign ownership or a replaced runtime. An attempted start with a confirmed worker 404 means no such job exists; missing worker connectivity is an error, not proof of absence. Returned final stats must be inactive with accounting_complete=true, with C08 identity validation intact. Cancellation records retain these real final counters in summary.final_traffic without inventing successful benchmark metrics.

The worker retains its C06 SIGINT-and-reader-drain path. If SIGINT readiness times out, it now terminates/kills and waits for the owned process instead of abandoning it. Lack of a final summary still raises an error. Two new tests use real loopback-only ping subprocesses: exact early-stop accounting plus idempotent stop; and unavailable-SIGINT fallback proving the process/reader exit while accounting remains unconfirmed. These are real process tests, not live SDN evidence.

## 5. Link cleanup and preserved state

The old initial target-UP mutation was removed. Experiments first inspect real worker topology. Missing target returns 404; a target already DOWN returns 409 without raising it or starting experiment traffic. Unrelated DOWN links remain untouched. This is the smallest safe interpretation of the existing requirement to benchmark failure of an initially UP link.

Only the exact injected target is restored; no restore-all is used. Injection intent is retained before IPC because either endpoint may have changed even when acknowledgement fails. Restoration is safe within the same runtime and experiment lease because dashboard/manual link controls are already excluded by C08 during that lease. If ownership/runtime changes, cleanup refuses to mutate the replacement and records FAILED. Out-of-band privileged CLI mutations cannot be ownership-tracked by this API; see limitations.

## 6. Controller and persistent runtime semantics

Controller activation and a simulation automatically started for the experiment remain selected/running after completion or cancellation, matching prior product behavior. They are shared dashboard state, not disposable per-run resources. Their transitions are not interrupted, and cleanup does not stop a controller or roll back a newer selection. C04 dataplane reset and C07 health/watcher/no-auto-restart behavior are unchanged. C08 context is rechecked after cleanup before committing COMPLETED, including controller changes during restoration.

## 7. Terminal states, persistence and API semantics

| Outcome | Record / API |
|---|---|
| Valid metrics + confirmed cleanup + unchanged context | COMPLETED; normal result. |
| Cancel observed before terminal commit + confirmed cleanup | CANCELLED; cancel waits and returns that actual status. |
| Operation/unexpected exception, collection timeout, invalid final ownership | FAILED; original C05 error semantics retained (timeout 504). |
| Cleanup partly/fully unconfirmed | FAILED; 502 with cleanup results, summary.cleanup_errors and any original summary.error retained. Never clean cancellation. |
| Cancel wrong/nonexistent active run | 404. |
| Cancel known terminal run with explicit run_id | Return its actual terminal result, or repeat its truthful error; no cleanup side effects. |
| Start while run/cleanup is active | 409. |

Endpoint remains POST /api/experiments/cancel, now optionally accepts `?run_id=<parent request ID>`. Dashboard supplies it; existing callers without it target the currently active run. Success response contains status, message and finalized experiment/comparison. Existing RuntimeRoute handles errors. No unconditional status=ok cancellation envelope remains. Final records use existing SQLite schema/summary JSON; no production/history data is deleted.

## 8. Frontend behavior

Store sends exact run identity, keeps experimentRunning true while cleanup is pending, shows CANCELLING and disables repeat cancel clicks. It adopts the actual terminal status after acknowledgement or final WS event. Cleanup API failure is surfaced with existing error handling; it does not fabricate CANCELLED. A received FAILED terminal event remains terminal even if the cancel HTTP request subsequently fails.

Finished run IDs reject stale success/progress. The original long-running run response cannot erase an already received terminal state. Late A cancel responses/errors cannot finish B. The existing execution-status label now shows terminal status rather than always READY; history continues to load stored records. Only functional text/disabled state changed; layout/colors are unchanged.

## 9. Exact files changed

| File / function | Change |
|---|---|
| backend/services/experiment_runner.py — run_experiment, _run_single, run_comparison, cancel_and_wait, shutdown | Owned task/cancel event, wakeable delays, common resource finalization, truthful persistence, comparison boundary. |
| backend/services/mininet_client.py — _start_traffic, stop_experiment_traffic, set_link_status | Reserve owner before IPC; exact-owner cleanup; runtime/lease-checked locked link mutations. |
| backend/services/mininet_worker.py — _stop_traffic_job | Terminate owned ping on unavailable SIGINT handler; preserve unconfirmed-accounting error. |
| backend/api/experiments.py — cancel_experiment | Await exact-run cleanup and return terminal result. |
| backend/main.py — shutdown_event | Finalize active experiments before shared runtime teardown. |
| frontend/src/services/api.ts | Cancel run query/terminal contract; comparison status type. |
| frontend/src/stores/sdnStore.ts — runExperiment, cancelExperiment, WS handlers | CANCELLING, terminal ownership, stale reply protections. |
| frontend/src/pages/ExperimentLabView.tsx | Disable cancellation during cleanup; truthful terminal status text. |
| backend/tests/test_experiment_cleanup.py | Focused lifecycle/race/API/shutdown and real process tests. |
| backend/tests/test_runtime_errors.py | Query-aware ASGI fixture; topology fixture; restoration failure now targets the single owned restoration, preserving failure assertions. |
| backend/tests/test_traffic_accounting.py | Explicit initially-UP topology fixture; final counter assertions unchanged. |
| backend/tests/test_telemetry_ownership.py | Explicit initially-UP target in fake topology; ownership assertions unchanged. |
| frontend/tests/experiment-cleanup.test.ts | Focused cancellation/terminal/race/error tests. |
| frontend/tests/runtime-errors.test.ts | Assert explicit FAILED terminal state instead of cleared progress; error/busy assertions retained. |
| reports/C09-EXPERIMENT-CLEANUP-VERIFICATION.md | This verification record. |

frontend/dist is rebuilt for FastAPI and remains ignored.

## 10. Automated tests and validation

Focused backend coverage includes normal completion; exact job cancellation without stopping manual traffic; actual counts; cancellation during controller startup, traffic start, injection, collection and restoration; pre-existing DOWN target/unrelated DOWN link preservation; lost traffic/injection acknowledgement; restoration/stop failure; activation/unexpected exception; double cancel; busy/replacement isolation; terminal repeat; wrong run; runtime/lease ownership rejection; shutdown request and application teardown order; comparison success/abort; collection timeout; cancelled HTTP request; and real process stop/fallback.

Frontend coverage includes CANCELLING until cleanup, exact run query, CANCELLED replacing RUNNING, stale COMPLETED rejection, API failure visibility, FAILED WS plus failed HTTP, replacement-run protection and stale progress during cleanup. Existing C03/C05/C06/C07/C08 frontend suites are retained.

Validation results: **104 backend tests passed** (28 C09 + 76 existing); **43 frontend tests passed** (6 C09 + 37 existing: C03 8, C05 10, C06 3, C07 4, C08 12). Focused C09 tests were also rerun after the final task-identity guard and replacement-run assertion. Python compilation, application/test TypeScript checks, production build and git diff --check passed. Lint reports **26 existing warnings, zero errors**. The build retains its large-chunk warning; existing FastAPI on_event deprecation warnings appear in the shutdown test. Intentionally injected runtime failures produce expected error logs in tests; these are not live backend failures.

Commands (WSL Ubuntu-22.04, repository root unless noted):

```bash
/home/i7__6thgen/sdn-env/bin/python3 -m unittest backend.tests.test_experiment_cleanup -q
/home/i7__6thgen/sdn-env/bin/python3 -m unittest discover -s backend/tests -q
/home/i7__6thgen/sdn-env/bin/python3 -m py_compile backend/api/experiments.py backend/main.py backend/services/experiment_runner.py backend/services/mininet_client.py backend/services/mininet_worker.py backend/tests/test_experiment_cleanup.py backend/tests/test_runtime_errors.py backend/tests/test_traffic_accounting.py backend/tests/test_telemetry_ownership.py
cd frontend
export PATH=/home/i7__6thgen/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports --jsx react-jsx tests/experiment-cleanup.test.ts tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts
node node_modules/rolldown/bin/cli.mjs tests/experiment-cleanup.test.ts tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts --platform node --format esm --dir node_modules/.tmp/c09-tests
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c09-tests/experiment-cleanup.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c09-tests/telemetry-ownership.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c09-tests/controller-exit.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c09-tests/runtime-errors.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c09-tests/topology.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c09-tests/traffic-accounting.test.js
npm run lint
npm run build
cd ..
git diff --check
```

The isolated test TypeScript command was also run with Windows Node against the same files. An initial regression run exposed fixture assumptions about the removed initial UP operation, and a frontend assertion expected null instead of explicit FAILED. Fixtures/assertions were updated to the new truthful contract; their substantive error/accounting/ownership assertions remain. A shell-loop test invocation expanded variables incorrectly and did not execute suites; it is not counted as a passing validation. The suites were subsequently executed individually using absolute paths.

## 11. C01–C08 regression boundary

C01 system-Python worker startup remains unchanged. C02 controller selection is unchanged. C03 topology normalization/merge remains covered. C04 selection/dataplane cleanup and C07 process health are unchanged and their suites are rerun. C05 typed operation failures are preserved and extended to cancellation. C06 parser/actual-counter calculations are unchanged, with real subprocess stop tests. C08 runtime/job/controller/experiment ownership remains and is enforced during cleanup; DB history stays isolated. Broader suites cover these boundaries but do not replace consolidated live SDN verification.

## 12. Manual consolidated verification checklist (pending)

Use the normal project startup procedure in WSL. Reload backend **and the confirmed project worker** so the updated stop fallback is loaded, then hard-refresh the rebuilt frontend. Finish/stop existing work normally first. Do not kill unrelated processes or run mn -c after Ryu starts. Keep DevTools Network/WS and backend logs open.

Record request run_id, summary.experiment_id, summary.traffic_job_id, runtime_id, injected link and controller generation for each test. Compare UI/history with API and real interfaces/processes. Baseline must not self-heal; controller processing time is not packet disruption or local FF switching time.

### A — Cancel active traffic

1. Start a sufficiently long Reactive experiment (e.g. 1000 packets, interval 0.05, failure delay 3 seconds).
2. While traffic is active, click Cancel. Expect CANCELLING until finalization; Start stays unavailable during cleanup.
3. Confirm API returns terminal CANCELLED and history shows CANCELLED, never a later COMPLETED. Inspect summary.final_traffic: inactive, accounting_complete, actual attempted/replied totals below configured count where interrupted early.
4. In WSL compare `pgrep -af 'ping.*10.0.0.2'` before/after and inspect only the recorded experiment process. If manual traffic was separately running, it must remain unaffected; do not interpret its ping as an orphan experiment.
5. Start the next experiment and verify a fresh job/run, no busy lock or old counters.

### B — Cancel after injection, preserve unrelated state

1. With no active experiment, manually fail s1-s3; record both actual endpoints and topology DOWN. Select initially-UP s1-s2 as experiment target.
2. Start experiment; wait for FAILURE_INJECTED and confirm s1-s2 endpoints are down. Cancel.
3. Verify s1-s2 becomes UP on **both endpoints**, while s1-s3 remains DOWN. Use `sudo ip -br link` / `sudo ovs-ofctl -O OpenFlow13 show s1` and the corresponding s2/s3 outputs, plus GET /api/topology. Interface names/ports must be taken from returned topology, not guessed.
4. A run targeting a pre-existing DOWN link must fail truthfully and must not raise it. Restore manually changed links afterward.

### C — Immediate replacement / repeated cancel

1. Start A and cancel; attempt B while cleanup is still pending. Backend must return 409 and UI must keep Start unavailable.
2. As soon as A's terminal acknowledgement arrives, start B. Repeat cancel for A using its explicit run_id; it must return A's terminal result without affecting B's traffic, links or UI.
3. Refresh/reconnect while running; ownership remains truthful. Verify comparison cancellation stops after current child's cleanup and never launches the next mode.

### D — Failure / cleanup errors / shutdown

1. Observe/inject a safe controlled operation failure in a test environment. Expect FAILED plus exact traffic cleanup and owned restoration when worker remains reachable.
2. For worker-unavailable cleanup, expect a non-success cancel/run response and summary.cleanup_errors, not CANCELLED success. Resources may remain until worker access is restored; inspect and recover exact resources manually. Do not use broad process kills.
3. Gracefully stop backend during a long run. Logs should show experiment cleanup before controller/network teardown. Confirm no experiment ping remains. Restart and inspect terminal history.
4. Repeat normal completion under Baseline, Reactive and Fast Failover; verify original controller behavior and no C01–C08 regression using their existing consolidated checklists.

Useful API reads/actions (substitute the actual parent run ID):

```bash
curl -s http://localhost:8000/api/topology
curl -s 'http://localhost:8000/api/experiments/history?limit=10'
curl -i -X POST 'http://localhost:8000/api/experiments/cancel?run_id=ACTUAL_PARENT_RUN_ID'
sudo ovs-vsctl list-br
sudo ip -br link
```

GET /api/traffic/stats describes the manual TrafficService stream, not the experiment stream. It must not be used to claim an experiment-owned job remains active or to overwrite its final counters.

## 13. Remaining limitations / stop condition

Live Mininet/Ryu/OVS/browser operation has not been run in this change. Fake-IPC tests prove lifecycle decisions and identity checks; real ping tests prove local process termination/accounting only. Production DB data was not modified by tests.

Graceful application shutdown requests and joins cleanup; forced OS termination, laptop power loss, SIGKILL, unavailable worker or uninterruptible OS operations cannot guarantee cleanup. Such failures must not be reported as clean cancellation. SQLite failure also cannot guarantee durable terminal persistence; busy state still releases through the parent finally. No durable recovery journal or new startup recovery feature is introduced.

In-flight worker/controller operations complete or hit existing timeouts before cancellation proceeds. Cancel latency therefore includes those bounded operations and final drain/restoration. Dashboard API ownership cannot distinguish privileged out-of-band CLI changes to the same link during a lease. Manual traffic may continue and cause network contention; it is deliberately outside experiment cleanup ownership.

Selected controller and shared simulation persist by design. Failed cleanup releases the runner so diagnostics/manual recovery are possible, but residual resources remain explicitly reported and can make the next run fail its initial checks. C10 analytics filtering/calculations remain untouched; terminal status is truthful, but historical cancelled/failed metric display is not redesigned here.

Stop after automated C09 verification and await review. No C10, commit or push.
