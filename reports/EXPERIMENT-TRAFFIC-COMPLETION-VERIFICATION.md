# Automated experiment finite traffic completion — runtime fix

Implemented and automatically verified. **No live Mininet/Ryu/OVS test was performed.** Real ping tests were confined to loopback; Mininet host/controller/IPC boundaries were substituted. No commit or push. The existing modified database and uncommitted frontend request-ID fix were preserved.

## 1. Root cause and observed evidence

The runner treated `count * interval` plus a fixed grace as an upper bound on finite ping completion. It is only nominal transmission spacing: actual attempts can take longer under scheduling/backpressure, and ping can remain alive waiting for replies after sending its count. The worker command also omitted `-W`, while the older C06 real-process tests explicitly passed `-W 1`.

Read-only inspection of the actual failed record `exp_7cad810cbaa744e0b48458abea626128_baseline` found diagnostic final_traffic with **Tx=284, Rx=100, loss=64.79%, duration=19.4566 seconds, accounting_complete=true after cleanup**. Cleanup had interrupted a genuinely unfinished finite ping. It had not already naturally finished 300 requests and merely failed to clear a cached active flag. That evidence does not identify the precise kernel/scheduler reason for the slower send cadence; it proves the nominal deadline was not a valid completion bound.

A separate real loopback-only reproduction with iputils 20211215, `ping -n -I lo -i .02 -c 300 192.0.2.1`, naturally returned **300 transmitted, 0 received** in **17.67 seconds**; ping reported 8572ms of transmit time, followed by its default no-reply linger. This command did not send traffic through Mininet or change routes/firewalls. The default no-reply wait adds another issue for complete outages; it is not asserted to be the sole cause of the partially successful live record.

No missing natural-exit detector, polling deadlock, experiment-specific worker process, or ownership mismatch was found. The existing reader does consume EOF, wait for the process and publish terminal state. Its natural-completion behavior is now tested through the complete worker/client/runner chain rather than assuming the old C06 test command matched production.

## 2. Why manual Traffic Monitor worked

Manual and experiment traffic use the same MininetClient.start_traffic and worker start/read/accounting implementation. Manual TrafficService keeps polling its owned job until it becomes inactive; it does not impose ExperimentRunner's nominal-duration timeout. Consequently a manual job can naturally finish after the estimate an experiment would reject. Manual traffic is not the source of experiment counters, and no fallback to latest/global traffic was introduced.

## 3. Complete path inspected

| Stage | Actual implementation / finding |
|---|---|
| Request | ExperimentLabView -> store request ID -> API POST /api/experiments/run -> ExperimentRunner.run_experiment. HTTP request-ID fallback is unchanged. |
| Preparation | Existing controller activation and runtime/READY checks; C08 generation/runtime capture and experiment link lease. |
| Start | _run_single chooses a unique traffic_job_id -> MininetClient runtime lock -> owner registry reservation -> worker command. |
| Worker process | start_traffic validates runtime, finds hosts, primes path with a separate one-packet ping, launches finite ping through host.popen, stores exact owner/process/parser/thread. |
| Live accounting | _sample_traffic checks proc.poll and sends SIGQUIT for ping's actual counters. PingAccounting consumes interim/final counters and successful-reply RTT; no elapsed-time packet generation. |
| Natural exit | _monitor_traffic drains stdout to EOF, calls proc.wait, then commits accounting_complete from final_seen and active=false under traffic_lock. Poll/exit code 1 with valid packet-loss summary is not a process failure. |
| Query | Worker get_traffic_stats returns a locked copy of this job; MininetClient validates job/runtime/experiment/generation metadata; runner reads this exact ID. |
| Completion | Runner observes inactive, calls existing idempotent exact-job stop/final drain, validates ownership and final accounting, extracts actual metrics, restores its link, persists the truthful terminal result. |
| Failure/cancel | Existing C09 finally stops only the owned traffic ID and restores only its own link within its runtime/lease. Cleanup errors remain errors. |

Client runtime/socket locks serialize IPC; the worker command handlers execute sequentially, while the stdout reader and snapshot signaler are threads. traffic_lock protects short parsing/copy updates and initial launch. Existing stop logic joins the reader **without** holding traffic_lock. No locks were removed or bypassed. get_traffic_stats intentionally does not declare completion from elapsed time or a guessed packet count.

## 4. Old and new behavior

**Old:** launch `ping -i interval -c count destination` -> finite transmission can run longer than the nominal spacing -> default reply linger can further delay exit -> reader correctly still reports active -> experiment's fixed window expires -> 504 -> C09 SIGINT stops it early and drains actual partial counts.

**New:** launch `ping -i interval -c count -W 1 destination` -> actual attempts proceed; explicit bounded no-reply tail -> natural process exit -> reader drains actual final summary and waits/reaps process -> inactive/accounting_complete -> exact-job result is accepted. No wall-clock `-w` is used, because that could truncate actual transmissions. The explicit one-second no-reply linger can change how long an entirely silent job waits after its final attempt; it does not change forwarding, controller logic, topology, or the configured attempt count.

The runner's timing window now uses confirmed start time and measured progress rather than assuming packet spacing guarantees completion. The existing **8-second grace is unchanged**; no huge constant timeout was added.

## 5. Exact timeout policy

After the start acknowledgement, capture monotonic `traffic_started`:

```text
initial deadline = traffic_started + count * interval + 8 seconds
observed_tx = 0

poll exact job:
    if actually inactive: proceed to authoritative finalization
    if observed_tx < measured Tx <= configured count:
        observed_tx = measured Tx
        deadline = max(deadline, now + (count - measured Tx) * interval + 8 seconds)
    if now >= deadline while still active: 504
```

Only strictly increasing integer Tx from the C08-validated job renews its remaining-work allowance. Repeated counters, Rx changes, missing counters, elapsed time or a fabricated count cannot renew it. Once Tx reaches count, it cannot renew again: an active job stuck at its full count still times out. A process with no further measured transmission progress eventually exhausts its allowance. Continuous real progress may make a run longer than nominal spacing; this is intentional, not a hard overall wall-clock SLA. Renewal opportunities are bounded by the finite configured count.

The initial clock now starts after traffic start confirmation, **before** failure_delay and injection, instead of beginning only after injection. A final inactive result is checked before rejecting an elapsed deadline, preventing late polling of an already completed job from becoming a false timeout. Time never forces active=false. The estimate never substitutes for transmitted counts.

## 6. Natural completion and final accounting

Natural completion remains owned by the worker reader, not the runner's clock. EOF plus proc.wait precede terminal state. accounting_complete reflects the parsed final summary, not merely process exit. Missing final summary remains a truthful error through existing stop/finalization. SIGQUIT snapshots remain interim and cannot manufacture final completion. SIGINT remains the explicit stop/cancel/timeout path, with C06 summary drain and C09 fallback behavior intact.

Real 300/.02 tests prove:

- live active snapshots occur;
- the last worker/client sample is inactive and accounting_complete before the runner's stop call;
- the ping process is reaped and reader has exited;
- no SIGINT was needed for completion;
- final actual Tx=300 and Rx=300 or 0, with correct loss;
- complete loss preserves null min/avg/max RTT and still completes the experiment.

These assertions use a real ping subprocess and the production worker/parser/client/runner. Only host namespaces, controller, topology mutations, persistence and IPC transport are substituted. Partial-loss and slow-progress timing cases use deterministic measured snapshots; they are not claimed as real injected link failures.

## 7. Exact files changed for this fix

| File | Change |
|---|---|
| backend/services/mininet_worker.py — start_traffic | Explicit `-W 1` finite ping no-reply linger; existing reader/accounting/stop mechanism retained. |
| backend/services/experiment_runner.py — _run_single | Monotonic start-based, measured-progress-aware completion window; unchanged 504 for still-active expired jobs. |
| backend/tests/test_experiment_traffic_completion.py | Eight new completion, loss, deadline, API and exact-cleanup regression tests. |
| backend/tests/test_experiment_cleanup.py | Existing timeout fixture now represents a genuinely stalled zero-progress job; C09 failure/restoration assertions retained. Positive-counter stalls are covered by the new tests. |
| reports/EXPERIMENT-TRAFFIC-COMPLETION-VERIFICATION.md | This report. |

Pre-existing frontend/src/services/requestId.ts, frontend/src/stores/sdnStore.ts and frontend/tests/request-id.test.ts were **not edited**. The existing data/sdn_dashboard.db change was not reverted or written by this fix; investigation queried it with SQLite mode=ro. Production frontend assets were rebuilt and remain ignored.

## 8. Tests and results

**128 backend tests passed** (120 existing + 8 new), including C04/C05/C06/C07/C08/C09/C10 suites. Focused new suite also passed separately. **61 frontend tests passed**, including all six request-ID tests. Application/test TypeScript checks, Python compilation, production frontend build and git diff --check passed. Existing build chunk-size warning and FastAPI event-hook deprecations remain. Injected failure logs in unit tests are expected test evidence, not live SDN failures.

New tests:

1. Real loopback 300 packets/.02 naturally completes through worker -> client -> runner.
2. Same real finite job with 100% loss naturally completes; final counts/RTT and no SIGINT verified.
3. Slow partial-loss progression (including 284 attempts around 19s) reaches actual 300 final attempts instead of false 504.
4. Positive counters that stop progressing cause 504; cleanup stops the experiment job, preserves manual B and restores only the owned link.
5. Tx=count but process active beyond grace still causes 504, never guessed success.
6. Zero-transmission active job cannot keep itself alive indefinitely.
7. Actually inactive final state discovered after the nominal deadline is accepted with real accounting.
8. The real experiment ASGI route preserves HTTP 504 and its truthful public message for a genuine stalled job.

Validation commands (repository root, WSL Ubuntu-22.04 unless noted):

```bash
/home/i7__6thgen/sdn-env/bin/python3 -m unittest backend.tests.test_experiment_traffic_completion -v
/home/i7__6thgen/sdn-env/bin/python3 -m unittest discover -s backend/tests -q
/home/i7__6thgen/sdn-env/bin/python3 -m py_compile backend/services/mininet_worker.py backend/services/experiment_runner.py backend/tests/test_experiment_traffic_completion.py backend/tests/test_experiment_cleanup.py
cd frontend
export PATH=/home/i7__6thgen/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports --jsx react-jsx tests/request-id.test.ts tests/metric-truthfulness.test.tsx tests/experiment-cleanup.test.ts tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts
node node_modules/rolldown/bin/cli.mjs tests/request-id.test.ts tests/metric-truthfulness.test.tsx tests/experiment-cleanup.test.ts tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts --platform node --format esm --dir node_modules/.tmp/request-id-tests
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/request-id.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/metric-truthfulness.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/experiment-cleanup.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/telemetry-ownership.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/controller-exit.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/runtime-errors.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/topology.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/request-id-tests/traffic-accounting.test.js
npm run build
cd ..
git diff --check
```

Standalone test TypeScript check ran with Windows Node against those same test files; npm run build runs application tsc -b in WSL. No unrelated backend/controller algorithms or frontend source were changed. No fresh live Mininet/OVS/controller result is claimed by these test totals.

## 9. Live manual retest — required reload and exact configuration

1. In the dashboard, cancel any active experiment and let cleanup finish. Stop manual traffic and Stop Simulation normally. Stop the backend with Ctrl+C so its existing shutdown sequence finishes.
2. Reload the **project worker**, not just the backend. In WSL, list candidates:

   ```bash
   pgrep -af 'backend/services/mininet_worker.py'
   ```

   Identify the existing project worker whose command uses `/usr/bin/python3 /mnt/e/Projects/self-healing-sdn/backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock`. After the simulation/backend are stopped, terminate **only that confirmed worker PID** with `sudo kill -TERM PID` and wait for exit. Do not kill unrelated Python/Ryu processes, delete history, or run mn -c after Ryu starts. Existing startup handles a stale socket.
3. Restart normally, or from WSL:

   ```bash
   cd /mnt/e/Projects/self-healing-sdn
   ~/sdn-env/bin/python3 -m backend.main
   ```

   The updated worker starts on demand. Hard-refresh Windows Chrome at the WSL-IP HTTP dashboard. The unchanged request-ID fallback must still send the experiment POST.
4. Select Baseline, start simulation and confirm READY/RUNNING. In Experiment Lab set **Baseline, s1-s2, 300 packets, interval 0.02s, failure delay 2.0s**. Click Run once. Keep Network/WS and backend logs visible. Confirm the worker launch line includes `ping -i 0.02 -c 300 -W 1 10.0.0.2`.
5. Expect the actual finite job to finish and POST/history to show COMPLETED, with **actual Tx=300**, observed Rx/loss and successful-reply-only RTT. Packet loss is a valid Baseline result, not traffic-process failure. Its magnitude depends on which branch is actually active; an inactive-branch failure may cause no loss. No healing claim should be added for Baseline.
6. Read the returned experiment/GET `/api/experiments/ACTUAL_ID` and compare its recorded controller, summary traffic_job_id/runtime/generation and final counts. Confirm s1-s2 is restored by C09. With no other manual job running, `pgrep -af '^ping -i 0.02 -c 300 -W 1 10.0.0.2$'` should show no remaining finite experiment ping afterward.
7. Repeat a no-reply case in the normal safe test procedure: all finite attempts must still finish, Rx=0/loss=100%/RTT=N/A. Do not expect total job duration to equal exactly 6s on WSL. A real still-active stall must still surface 504 and cleanup, not successful fabricated metrics.
8. Cancel another run during traffic/failure; confirm CANCELLED, owned traffic stopped and owned link restored. Immediately start a new run and verify old cleanup cannot affect it. Preserve the existing C09 checks for unrelated/manual traffic and pre-existing link states.

Do not use /api/traffic/stats as experiment telemetry: it describes the manual TrafficService job. This fix uses the exact experiment-owned worker job throughout. Backend and worker must both reload; an already-running old worker retains its old ping arguments until restarted.

Stop for live manual verification. No UI redesign, topology expansion, commit or push.
