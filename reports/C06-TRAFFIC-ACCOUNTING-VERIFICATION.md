# C06 — Traffic accounting verification

Status: implementation ready for manual SDN verification. No commits or pushes. No live Mininet/Ryu/OVS/controller-failure tests were run. Tests include real local iputils ping processes, bound to loopback only, plus mocked API/service regressions.

## Root cause and original behavior

`TrafficView` → store `startTraffic` → `POST /api/traffic/start` → `TrafficService.start` → `MininetClient.start_traffic` → worker `start_traffic` → Mininet source host's `ping` process. Worker statistics return through `get_traffic_stats` → client → service polling (0.3 s) → `TRAFFIC_TICK`/`TRAFFIC_COMPLETED` WebSocket events, or `GET /api/traffic/stats` → store → TrafficView. The frontend displays worker totals; it does not measure sends.

Before C06, `_monitor_traffic` assigned `transmitted = max(transmitted, received_icmp_seq)` and incremented received for each matching reply line. Thus no replies meant no counter progress, not zero attempted sends. A later reply could suddenly jump Tx; duplicate replies could overcount Rx. Loss was derived from these unreliable live values. Min/avg/max RTT were populated only by the terminal summary. Finite completion could correct counters if that summary arrived. Stop used SIGTERM, which need not print a summary, then returned before the reader drained. Service retained its last live tick, so final/early-stop metrics could remain stale. New frontend runs inherited old totals until telemetry replaced them.

The public API currently requires a positive finite `count`. It has no unlimited-count mode; a long finite workload is used for sustained traffic. C06 does not add an unrelated continuous-mode control. The parser itself does not depend on a configured count or elapsed-time send estimate.

## New design and exact semantics

- **Tx:** iputils' own transmitted/attempted-request counter, excluding the existing pre-workload warmup ping. Never inferred from replies, sequence numbers, configured N, or a timer.
- **Rx:** iputils' received echo-reply counter. Ping handles validity/duplicates; parser reply lines do not increment counters.
- **Loss:** `Tx - Rx`; `loss_percent = round(100 * (Tx - Rx) / Tx, 2)`, or zero for Tx zero. Enforce `0 <= Rx <= Tx`. Live loss includes requests still in flight; a delayed reply can subsequently reduce it. Final loss comes from drained final totals.
- **RTT:** ping's measured min/avg/max snapshots and terminal summary, all from successful replies. Per-reply output supplies last RTT and the existing chart history. Duplicate reply lines do not add chart samples. `time<...` is not invented as an exact last-RTT value. No replies means null RTT. During an outage after earlier replies, prior observed RTT remains valid historical RTT, not a fabricated outage measurement.

A worker sampler requests SIGQUIT statistics every 250 ms. The timer only requests observations; **it never increments Tx**. iputils prints `received/transmitted packets` (verified locally with `0/3 packets, 100% loss`). Final summaries list transmitted first. These are intentionally parsed differently. Counter snapshots are independent of the presence of reply lines; e.g. `80/100` → `80/120` yields Tx 120, Rx 80, loss 33.33%.

The sampler checks `/proc/<pid>/status`'s caught-signal mask before signalling. This avoids killing the temporary stdbuf/mnexec launcher before ping installs its handler, and does not rely on a stdout header that may remain buffered during complete loss. Locale is forced to `LC_ALL=C`. No extra Python package is needed by `/usr/bin/python3`.

## Finite completion, stop, and state retention

Natural EOF drains the final count/RTT summary before marking inactive. A finite workload normally finishes at N attempted requests; missing replies do not make Tx freeze at Rx. Stop uses SIGINT, waits for process exit and reader completion **without holding the reader's lock**, and returns the final stats with `status:ok`. The configured count is never substituted for the attempts made before early stop.

If the process must be killed or its final summary cannot be confirmed, stop returns a C05-compatible 502 rather than fabricated complete totals. `accounting_complete` is false until EOF with a parsed final count summary; it is true only after that confirmation. Inactive stats without confirmation are labelled `FINAL COUNTERS UNCONFIRMED` in the existing TrafficView status text. Such exceptional totals are last observations, not a promise of final accuracy.

The service preserves the drained stop response, broadcasts those final totals, and retains them with `active:false` after stop. A new successful job resets totals/RTT/history. Experiments reuse the same worker counters and adopt the stop response's final snapshot instead of an earlier tick; controller selection, failure workflow, cancellation logic, and analytics formulas are unchanged.

Simulation stop stops worker traffic jobs through the same drain path. The traffic service can receive the final retained job through its existing polling. Final last-run totals are intentionally retained; they are not evidence of ongoing traffic. General stale telemetry/session cleanup, reconnect issues, and C08 lifecycle policy remain out of scope.

## API/schema compatibility

Routes and existing metric names remain unchanged. `accounting_complete: boolean` is added to backend stats and optional in TypeScript for compatibility. Existing nullable RTT fields are typed as nullable in TypeScript. Successful traffic stop now includes the final existing metric fields alongside `status:ok`. A no-active-job stop remains an idempotent acknowledgement. Invalid/stopped/unavailable traffic operations retain C05 errors. No database migration is needed.

## Exact files changed

| File | Purpose |
|---|---|
| `backend/services/ping_accounting.py` | Dependency-free parser of independent live/final counters and RTT. |
| `backend/services/mininet_worker.py` | Guarded signal sampler, parser integration, final-summary drain, safe stats snapshots. |
| `backend/services/traffic_service.py` | Fresh job counters, retained final stop totals, final WS event, guard against an old job's late tick. |
| `backend/services/experiment_runner.py` | Use drained stop totals for the existing experiment record. |
| `backend/models/schemas.py` | Final-accounting confirmation flag. |
| `frontend/src/types/index.ts` | Matching flag and nullable RTT types. |
| `frontend/src/services/api.ts` | Type the extended successful stop response. |
| `frontend/src/stores/sdnStore.ts` | Reset only on confirmed new job; adopt returned final stop counters. |
| `frontend/src/pages/TrafficView.tsx` | Render zero RTT correctly; clarify live unanswered ratio and unconfirmed final stats. No layout/style changes. |
| `backend/tests/test_traffic_accounting.py` | C06 parser, real local-process, final-state, experiment, and API regression tests. |
| `frontend/tests/traffic-accounting.test.ts` | Cumulative WS metrics, final stop totals, new-job reset tests. |
| `reports/C06-TRAFFIC-ACCOUNTING-VERIFICATION.md` | This focused report and manual procedure. |

## Automated coverage and commands

New backend tests cover zero/partial loss; **active 100% outage with increasing Tx and fixed Rx**; recovery; final finite totals; early-stop totals; null RTT without replies; duplicate handling; RTT summaries; invariants; real loopback ping completion and zero-reply sampling/early SIGINT stop; service preservation/broadcast; experiment use of final totals; and stopped/unavailable traffic API errors.

New frontend tests cover cumulative outage/recovery snapshots, final stop totals replacing an earlier tick, and resetting previous counters only for a confirmed new job. Existing C03 topology and C04/C05 runtime tests are run unchanged.

Commands executed from the repository (frontend commands from `frontend`):

```bash
~/sdn-env/bin/python3 -m unittest discover -s backend/tests -v
~/sdn-env/bin/python3 -m py_compile backend/services/ping_accounting.py backend/services/mininet_worker.py backend/services/traffic_service.py backend/services/experiment_runner.py backend/models/schemas.py backend/tests/test_traffic_accounting.py

cd frontend
export PATH=/home/i7__6thgen/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports tests/traffic-accounting.test.ts tests/runtime-errors.test.ts tests/topology.test.ts
node node_modules/rolldown/bin/cli.mjs tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts --platform node --format esm --dir node_modules/.tmp/c06-tests
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c06-tests/traffic-accounting.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c06-tests/runtime-errors.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c06-tests/topology.test.js
npm run lint
npm run build
cd ..
git diff --check
```

## Regression boundary

Final automated results: **50 backend tests passed** (13 new C06, 37 existing C04/C05); **21 frontend tests passed** (3 C06, 10 C05, 8 C03). The backend count includes two real local iputils process tests, one with a sustained zero-reply workload and early stop. Python compilation, TypeScript test checking, application TypeScript checking via production build, and `git diff --check` passed. Lint completed with **26 existing warnings and 0 errors**. Production build completed successfully with the existing large-chunk warning. These results do not constitute live Mininet/controller verification.

- C01: worker interpreter remains `/usr/bin/python3`; both helper modules support direct script imports with no third-party dependencies.
- C02: simulation/controller selection routes are unchanged.
- C03: topology normalization is unchanged; its eight frontend regressions pass.
- C04: manager and OVS cleanup code are unchanged; existing controller-switch tests are retained.
- C05: typed runtime errors remain; added traffic-specific 409/503 checks and retained all error regressions. Missing final accounting is non-success.
- No controller algorithms, FF groups, topology, database history, UI design, or C07+ work was changed. No commits/pushes were made.

## Manual WSL/Mininet verification checklist

These steps are **pending manual verification**, not recorded SDN test results.

### Preparation

Finish any active experiment. Stop traffic and simulation normally, stop the backend with Ctrl+C, then gracefully terminate only the old project's privileged worker so it reloads the parser. Find it with:

```bash
pgrep -af '^/usr/bin/python3 /mnt/e/Projects/self-healing-sdn/backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock$'
```

Use `sudo kill -TERM <confirmed_worker_PID>` if listed, and wait for exit. Do not kill other Python processes; do not run `mn -c` after Ryu starts. Restart backend with `cd /mnt/e/Projects/self-healing-sdn && ~/sdn-env/bin/python3 -m backend.main`. Hard-refresh the rebuilt dashboard. Use a second terminal for curls below.

### A — Baseline outage and restoration

```bash
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"baseline"}'
curl -i -X POST http://localhost:8000/api/simulation/start -H 'Content-Type: application/json' -d '{}'
curl -i -X POST http://localhost:8000/api/traffic/start -H 'Content-Type: application/json' -d '{"src":"h1","dst":"h2","interval":0.05,"count":2000}'
curl -s http://localhost:8000/api/traffic/stats
curl -s http://localhost:8000/api/topology
sudo ovs-ofctl -O OpenFlow13 dump-flows s1
sudo ovs-ofctl -O OpenFlow13 dump-flows s2
sudo ovs-ofctl -O OpenFlow13 dump-flows s3
```

In Traffic Monitor, verify Tx/Rx advance and RTT is measured. Determine active path from `active_paths` plus increasing OVS flow/port counters; do not assume s1–s2 is always active. In the dashboard Failure Simulator, fail s1–s2 **if that is the active branch**, otherwise s1–s3. Capture two stats responses several seconds apart while failure persists. Expect Tx to increase, Rx to freeze/grow less, loss to rise; Baseline must not heal. Interface state and OVS counters should corroborate the actual failure.

Optional independent evidence: find this workload's ping PID using `sudo pgrep -af '^ping -i 0.05 -c 2000 10.0.0.2$'`. Read source-host kernel ICMP counters with `sudo nsenter -t <ping_PID> -n cat /proc/net/snmp`. Compare `OutEchos`/`InEchoReps` deltas over the same interval; warmup and other ICMP traffic mean absolute totals can differ. Do not inject additional pings while making this comparison. The UI/service samples lag the process slightly.

Restore the failed link through the dashboard. Verify Rx resumes, Tx remains cumulative, loss reflects cumulative requests/replies, and the store does not reset this job. Repeat entirely failed traffic if desired by failing the active path before starting a fresh job: Tx should progress with Rx zero and RTT null.

### B — Reactive

Stop traffic and simulation normally. Select Reactive, start simulation, then start a fresh workload using the same traffic request. Identify the actual active branch and fail it through the dashboard. Compare REST/WS/dashboard metrics during healing: counters remain cumulative and logical, measured loss may be brief or zero. Do not confuse controller processing time with packet outage duration. Restore the link and stop the run.

### C — Fast Failover

Select FF after stopping the previous simulation/workload, then start a fresh simulation/workload. Inspect `sudo ovs-ofctl -O OpenFlow13 dump-groups s1` and relevant switches; identify the primary bucket/path. Fail its link through the dashboard. Check cumulative Tx/Rx/loss invariants throughout local failover. Do not label later controller recomputation as local FF switching time. Restore the link afterward.

### D — Explicit stop and finite completion

```bash
curl -i -X POST http://localhost:8000/api/traffic/stop
curl -s http://localhost:8000/api/traffic/stats
```

For the 2000-packet run stopped early, final Tx must remain the actual smaller attempted count, never jump to 2000. Expect `active:false`, `accounting_complete:true`, and identical final counts in stop response, retained REST stats, and dashboard. Wait and confirm totals remain stable. New job counters/RTT should reset intentionally.

For natural completion, start a fresh `count:40` workload and wait until completion. Normally final Tx is 40; final Rx reflects actual replies and loss is recomputed. Repeat with an active failed Baseline path to confirm finite 100% loss still ends with Tx 40/Rx 0/null RTT.

Stop simulation and attempt traffic start: expect C05 409, no false active job. For a worker-unavailable 503 check, use the already documented C05 temporary-socket procedure, directing the request to `/api/traffic/start` while backend state is RUNNING, then restore IPC. Do not start/reset simulation while that socket is moved.

## Remaining limitations

- Linux iputils, C-locale statistics, Linux signals, and readable `/proc` signal masks are required. They were exercised locally, but privileged Mininet namespace execution remains to be verified manually.
- Live counters are process snapshots (nominally 250 ms plus service/transport latency), not instantaneous measurements. In-flight requests count as unanswered until their replies arrive.
- Sampling/timers never estimate missing sends. A forced kill or missing final summary leaves `accounting_complete:false` and cannot guarantee exact final totals; stop reports failure.
- Last-run inactive metrics are retained intentionally. General stopped-session/stale telemetry policies remain C08, outside this change.
- Unlimited/continuous API mode is not currently implemented; positive finite counts and sustained long finite runs retain the existing contract.

Awaiting the user's real Baseline/Reactive/FF dashboard verification before declaring C06 runtime-verified.
