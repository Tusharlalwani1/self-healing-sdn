# C08 — Telemetry ownership verification

Status: implementation ready for manual runtime verification. Work resumed from saved files after the laptop shutdown and validation was rerun. No live Mininet/Ryu/OVS test is claimed. C08 tests use fake SDN IO and a temporary SQLite database; existing C06 local ping tests remain. No commit or push was made. C09 and C10 are not implemented.

## 1. Confirmed findings, and concerns already fixed

Findings below were confirmed by tracing current code and adding regression tests, not by claiming an unperformed live dashboard audit.

| Original concern | Before C08 | Evidence / resolution |
|---|---|---|
| 1. Old counters presented as LIVE after simulation stop | Confirmed race | Store did not finalize traffic on SIMULATION_STATUS STOPPED; traffic service could retain active ownership until a later poll. Now worker drain finalizes jobs, service ownership clears, and the UI gates LIVE on running simulation plus active owned job. |
| 2. Restart reuses previous counters | Confirmed cache problem | No runtime identity; service latest_stats survived rebuild. New runtime invalidates that live cache, and old-runtime messages are rejected. |
| 3. B temporarily inherits A | Partly fixed by C06 | C06 reset after a successful B start. It could still overwrite a newer B WS tick with its zeroed HTTP acknowledgement, or accept an old A REST result. Both are guarded now. |
| 4. Delayed A WS overwrites B | Confirmed | TRAFFIC_TICK/COMPLETED were unconditional assignments. Job ordering and identity checks now reject A. |
| 5. Controller switch misattributes existing traffic | Confirmed missing association | Mininet/traffic intentionally continue across switches; metrics had no controller owner. Jobs now retain their starting controller/generation, with a changed-since-start indicator. |
| 6. Experiment counts read global/latest manual telemetry | Already avoided | Runner already used an explicit exp_traffic job ID and did not read TrafficService.latest_stats. C08 verifies the echoed owner rather than assuming it. |
| 7. Previous experiment contaminates next | Partly confirmed | Exact job lookup already helped. Timestamp-only experiment IDs could collide/replace DB rows; ownership was not verified; frontend progress/final events had no request-level guard. Unique IDs and explicit ownership now protect these paths. |
| 8. Wrong controller on experiment result | Confirmed missing guard | Runner activates its controller, but external switches/restarts could occur during awaits. Generation/runtime/READY checks now abort rather than save a mixed run as COMPLETED. |
| 9. Backend reset / frontend stale LIVE disagreement | Confirmed | No shared runtime identity/invalidation path. Lifecycle metadata, cache callbacks and frontend revision checks now agree. |
| 10. Frontend clears while old backend job active | Partly confirmed | Start HTTP/WS ordering and simulation transitions could disagree. No successful stop is fabricated; reset follows authoritative runtime boundaries, while explicit traffic stop adopts C06's drained result. |
| 11. Completion/final-stat races | Partly fixed by C06 | C06 drains the ping summary and returns exact early-stop totals. C08 adds ownership guards around completion and in-flight REST results. |
| 12. A's accounting_complete final overwrites B | Confirmed | The unconditional completion handler could replace B. Finalization now requires the current job/runtime/order. |

Additional confirmed ownership issue: healing time came from the controller's global last recovery event. It is now associated with controller generation, runtime, active experiment and observed failed link; pre-injection/previous events do not qualify.

## 2. Complete lifecycle and cache map

| Stage | Path and ownership |
|---|---|
| A — Start simulation | API → shared C04/C07 controller selection → MininetClient runtime lock → fresh UUID/revision → worker build with runtime identity → RUNNING broadcast and REST topology metadata. |
| B — Start traffic A | TrafficView → store → traffic API → serialized TrafficService action → client registry → worker ping job. The worker echoes the owner before success is accepted. |
| C — Live A | Worker C06 counters → exact job lookup → validated client metadata → service current-job check → REST/WS → frontend owner/order filter → display. |
| D — Stop/finish A | C06 final-summary drain → inactive snapshot, retained as FINAL/IDLE. Backend live owner clears; final A cannot reactivate itself. |
| E — Start B | Fresh unique job ID and increasing traffic sequence; no A counters inherited. Late A reads/ticks/start/final messages cannot replace B. |
| F — Stop simulation | Worker stops/drains its jobs before network stop confirmation; client notifies the service, clears live ownership, preserves matching final history and broadcasts final snapshots. STOPPED cannot be undone by an older lifecycle revision. |
| G — Restart/reset | New runtime UUID, larger lifecycle revision, empty manual live state. Old worker records/owner entries remain diagnostic data but cannot be queried as current runtime jobs. |
| H — Controller switch | Existing Mininet and manual traffic continue. C04 still cleans the dataplane; C07 still manages process health. Job's original controller/generation remains fixed, never relabelled to the replacement. |
| I — Start experiment | Runner force-selects its controller through C04, validates actual READY/controller, captures generation/runtime, and creates a collision-resistant experiment ID and request run ID. |
| J — Experiment traffic | Runner creates its own unique traffic ID with experiment metadata, reads that exact job and uses its drained final counters. Manual TrafficService.latest_stats is never read. |
| K — End/cancel/fail | Current experiment identity is released in finally. Cancelled/failed jobs cannot be reused as a later run's owner. C09 process/link cancellation cleanup is deliberately not implemented here. |
| L — Persist/display | Final owner/context checks precede save; summary JSON records run/job/runtime/controller generation. Existing history endpoint feeds experiment/analytics components. Delayed telemetry cannot mutate already stored rows. |

Caches inspected: worker traffic_jobs (process, parser, final counters/history); MininetClient simulation state and owner registry; TrafficService active_job_id/latest_stats/poll task; ControllerManager active controller/generation and last recovery/failure; ExperimentRunner local record/current run; frontend trafficStats, topology/runtime state, controller state, pending REST actions and experiment progress/history; SQLite experiment columns and summary_json. Analytics consumes stored experiments and still has its existing C10 fallback/calculation concerns; those were not changed.

## 3. Identity contract and backend behavior

- **job_id:** existing job identity, now never reused within a backend instance. An explicit reuse returns 409. Generated manual/experiment IDs use full UUIDs.
- **runtime_id:** a fresh UUID for each network start/rebuild attempt. Stop retains that identity for final snapshots; restart creates another.
- **runtime_revision:** increasing lifecycle ordering value, initialized from backend startup milliseconds and incremented for starts/stops. It orders lifecycle snapshots while the UUID identifies the physical-runtime generation. Browser reload/new initial snapshot is the authoritative rehydration boundary after backend restart.
- **traffic_sequence:** backend ordering of newly accepted traffic owners. It prevents old STARTED/REST snapshots from adopting an earlier job again.
- **controller / controller_generation:** immutable starting association, captured when that Ryu activation begins. C07 process health is independent. controller_changed means the current controller generation differs from the job's starting one; the UI labels this as changed since start, not as a new controller's benchmark.
- **experiment_id / run_id:** exact experiment job ownership and frontend request/progress ownership. Comparison child experiments keep separate IDs; comparison progress has its own run identity.

Client runtime operations and traffic IPC are serialized at the runtime boundary. Worker start/get/stop identities must match the registered job/runtime/experiment/controller generation. Foreign/missing identity is a 502; a request for a prior-runtime owner or reused ID is a 409. No success event is logged before ownership validation. C05's existing transport/state errors remain.

The service serializes manual start/stop actions, rejects late results using captured job/runtime, and invalidates live state on runtime transitions. It retains matching inactive final values on simulation stop. A new runtime clears the live cache, not database history. Initial WS state contains a cache snapshot without issuing worker IPC, so a worker outage does not prevent a health snapshot from being delivered.

## 4. Controller switch and experiment association

Manual traffic keeps running across controller changes, matching existing architecture. Its cumulative metrics remain attached to its original owner, and controller_changed exposes the mixed context. Completed historical records are not reassigned to the active dashboard controller.

Experiments continue to own activation (existing behavior), plus abort-on-change checks. Each runner captures actual confirmed controller type/generation and runtime, rechecks during traffic collection and before persistence, and validates final telemetry's job/runtime/experiment/generation/accounting_complete fields. It uses actual final totals, never configured-count defaults when ownership is unconfirmed. Summary JSON preserves the association without a DB migration.

While an experiment owns link controls, external link down/up/restore-all requests receive 409; the runner passes its owner explicitly. This small ownership guard prevents manual failure injection from supplying the experiment's healing event. Controller recovery events carry runtime/generation/experiment and failed-link identity, and must be new since this experiment's own failure injection. Unrelated/old recovery events leave recovery time unset; no value is fabricated. Controller processing/reconfiguration time remains distinct from network disruption and local FF switching time.

External controller/runtime changes are not blocked; the experiment fails truthfully if they invalidate its context. Cancellation releases ownership and cannot contaminate another run, but stopping every cancelled process/restoring every interrupted link remains C09.

## 5. Frontend ownership and presentation

Traffic updates must match current runtime and job ordering. Ticks/finals cannot adopt an unknown new job; TRAFFIC_STARTED or a guarded authoritative REST snapshot does that. Active data cannot revive a finalized same job or a stopped simulation. Late REST A/stop acknowledgements cannot replace B. A late B start acknowledgement cannot erase B counters already received by WS. Initial-state snapshots are filtered too.

Runtime revision rejects older lifecycle updates; a new runtime clears traffic. C03 topology normalization/merge is retained, with ownership handled separately. Final values may remain visible as FINAL/IDLE; no owner is NO ACTIVE TRAFFIC. LIVE/STREAMING requires both RUNNING simulation and active owned traffic. Existing styling/layout remains unchanged.

Experiment request run IDs guard progress/completion. A previous run cannot finish the currently active one, and known finished runs cannot reopen it through delayed progress. Experiment history remains authoritative DB data rather than being overwritten from traffic ticks.

## 6. Exact files changed

| File | Purpose |
|---|---|
| backend/services/mininet_client.py | Runtime identity/lock, owner registry/validation, lifecycle notifications/finals and link-control ownership. |
| backend/services/mininet_worker.py | Echo/store job owner; reject foreign runtime; return drained finals on network stop. C06 parser is unchanged. |
| backend/services/traffic_service.py | Serialize actions, invalidate current owner, retain final history, guard late reads and publish STARTED. |
| backend/services/controller_manager.py | Activation generation; tag recovery/failure ownership. C04/C07 lifecycle logic is retained. |
| backend/services/experiment_runner.py | Unique IDs, exact final-owner validation, controller/runtime guards, owned link controls and recovery association. |
| backend/api/experiments.py | Optional request run ID forwarding. |
| backend/api/simulation.py | Return runtime context in status. |
| backend/api/topology.py | Return runtime context for refresh/hydration. |
| backend/main.py | Initial WS runtime, cached traffic and experiment run identity. |
| backend/models/schemas.py | Optional ownership fields and nullable no-job snapshot identity. |
| frontend/src/services/telemetry.ts | Small shared traffic acceptance policy. |
| frontend/src/stores/sdnStore.ts | Ownership checks, lifecycle invalidation and async/run guards. |
| frontend/src/services/api.ts | Optional metadata/run request types. |
| frontend/src/types/index.ts | Runtime/traffic/run metadata types. |
| frontend/src/pages/TrafficView.tsx | LIVE versus final/no-owner labels and original controller association. |
| frontend/src/pages/OverviewView.tsx | STREAMING requires RUNNING simulation. |
| backend/tests/test_telemetry_ownership.py | New C08 unit/IPC/persistence coverage with temporary SQLite. |
| frontend/tests/telemetry-ownership.test.ts | New explicit out-of-order/lifecycle cases. |
| backend/tests/test_runtime_errors.py | Fake worker echoes the new identity contract; existing error assertions retained. |
| backend/tests/test_traffic_accounting.py | Explicit confirmed activation and job metadata in the existing experiment fixture. |
| frontend/tests/traffic-accounting.test.ts | Existing live-counter fixture explicitly starts in RUNNING state. |
| reports/C08-TELEMETRY-OWNERSHIP-VERIFICATION.md | This report. |

Generated frontend/dist is rebuilt for FastAPI and remains ignored. No legitimate database records were deleted or migrated. Analytics/report calculations, topology and controller algorithms were not modified.

## 7. Automated verification and commands

C08 backend coverage: A/B ownership; exact early-stop totals; late A REST versus B; stop/restart invalidation; completed-history retention; original controller association; foreign owner/reused-ID rejection; worker metadata round trip; manual link ownership; experiment own-job versus manual/previous jobs; unique IDs and immutable persisted history; wrong owner; controller/runtime change aborts; cancelled-run isolation; old recovery rejection and current recovery acceptance. Persistence tests use a temporary DB, never data/sdn_dashboard.db.

C08 frontend coverage: stale A tick/final/start; final cannot revive; late REST; stopped/restarted runtime; controller switch; start-response versus newer WS; old stop acknowledgement; old experiment completion/progress; initial snapshot ordering; lifecycle revision ordering; delayed simulation-stop acknowledgement; experiment ownership on reconnect.

Final rerun results: **76 backend tests passed** (15 C08 and 61 existing), and **37 frontend tests passed** (12 C08 and 25 existing). Python compilation, application and test TypeScript checks, production build, and `git diff --check` passed. ESLint completed with zero errors and 26 existing warnings. The production build retains its large-chunk warning. These automated results do not establish live SDN behavior; the manual checks below remain pending.

Commands executed in WSL from the repository (frontend commands from frontend):

```bash
~/sdn-env/bin/python3 -m unittest backend.tests.test_telemetry_ownership -v
~/sdn-env/bin/python3 -m unittest discover -s backend/tests -v
~/sdn-env/bin/python3 -m py_compile backend/api/experiments.py backend/api/simulation.py backend/api/topology.py backend/main.py backend/models/schemas.py backend/services/controller_manager.py backend/services/experiment_runner.py backend/services/mininet_client.py backend/services/mininet_worker.py backend/services/traffic_service.py backend/tests/test_runtime_errors.py backend/tests/test_traffic_accounting.py backend/tests/test_telemetry_ownership.py
cd frontend
export PATH=/home/i7__6thgen/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports --jsx react-jsx tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts
node node_modules/rolldown/bin/cli.mjs tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts --platform node --format esm --dir node_modules/.tmp/c08-tests
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c08-tests/telemetry-ownership.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c08-tests/controller-exit.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c08-tests/runtime-errors.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c08-tests/topology.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c08-tests/traffic-accounting.test.js
npm run lint
npm run build
cd ..
git diff --check
```

## 8. C01–C07 boundary

C01 retains /usr/bin/python3 and dependency-free worker helpers. C02 selection is retained. C03 merge tests remain. C04's serialized clean dataplane boundary is retained. C05 errors remain non-2xx, including ownership conflicts. C06 ping parsing, actual-attempt accounting and drained early-stop totals are unchanged. C07 watcher/intentional-stop behavior and no-auto-restart policy remain. Existing relevant backend/frontend suites are rerun. Earlier manual verification is not claimed as a new live SDN test.

## 9. Pending consolidated manual verification

### Load updated code

Finish any experiment, stop traffic/simulation normally, and stop the backend with Ctrl+C. The privileged worker must reload C08's wire contract: list only this project's worker using the command below, terminate that confirmed worker PID with `sudo kill -TERM <PID>` if still present, and wait for exit. Do not kill unrelated Python/Ryu processes and do not run mn -c after Ryu starts.

```bash
pgrep -af '^/usr/bin/python3 /mnt/e/Projects/self-healing-sdn/backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock$'
cd /mnt/e/Projects/self-healing-sdn
~/sdn-env/bin/python3 -m backend.main
```

Hard-refresh the rebuilt dashboard. Use a second WSL terminal for the following commands, and DevTools Network/WS to record owner fields alongside visible counters.

### A/B, finalization, restart

```bash
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"reactive"}'
curl -i -X POST http://localhost:8000/api/simulation/start -H 'Content-Type: application/json' -d '{}'
curl -s http://localhost:8000/api/topology
curl -i -X POST http://localhost:8000/api/traffic/start -H 'Content-Type: application/json' -d '{"src":"h1","dst":"h2","interval":0.05,"count":2000}'
curl -s http://localhost:8000/api/traffic/stats
curl -i -X POST http://localhost:8000/api/traffic/stop
curl -s http://localhost:8000/api/traffic/stats
curl -i -X POST http://localhost:8000/api/traffic/start -H 'Content-Type: application/json' -d '{"src":"h1","dst":"h2","interval":0.05,"count":2000}'
curl -s http://localhost:8000/api/traffic/stats
curl -i -X POST http://localhost:8000/api/simulation/stop
curl -s http://localhost:8000/api/traffic/stats
sudo ovs-vsctl list-br
curl -i -X POST http://localhost:8000/api/simulation/start -H 'Content-Type: application/json' -d '{}'
curl -s http://localhost:8000/api/traffic/stats
```

Record A/B IDs: they must differ, B sequence must increase, and B must not inherit A counters. Stop returns exact early-stop totals and inactive/final accounting. Simulation stop removes live ownership; final values may remain FINAL/IDLE. Restart has a new runtime_id and no live traffic until a new job is started. Verify real bridges/processes alongside state; an HTTP 200 alone is not proof of SDN actions.

To test deliberate late delivery safely, save a real A tick/final in DevTools and replay it through the store only in an isolated test/browser debugging context after B starts; B must stay authoritative. Automated tests already inject this exact ordering, including old runtime and delayed REST messages, without altering SDN topology.

### Controller switch

Start manual traffic under Reactive, record its controller/generation, then select Baseline through the dashboard while Mininet remains running. Expect cumulative same-job counters, original controller=reactive, controller_changed=true, and truthful changed-since-start label. Confirm C04 flow/group cleanup and C07 controller health through their existing procedures. A fresh manual job under Baseline must get a different job ID and Baseline owner. Stop that traffic before testing experiments.

### Experiments and persistence

```bash
curl -i -X POST http://localhost:8000/api/experiments/run -H 'Content-Type: application/json' -d '{"controller":"reactive","packet_count":80,"traffic_interval":0.05,"failure_delay_sec":1,"fail_link_src":"s1","fail_link_dst":"s2"}'
curl -s 'http://localhost:8000/api/experiments/history?limit=5'
```

Verify each summary's traffic_job_id, experiment_id, runtime_id, run_id and controller_generation. Run another same-mode experiment: its IDs must differ and the first DB result must remain unchanged. Repeat through the dashboard and verify history row controller agrees with the actual activated controller. While an experiment owns links, a separate link down/up request should return 409, not inject a competing failure. Controller/runtime changes during a run should cause a truthful FAILED result, never a COMPLETED record attributed to the wrong controller.

For cancellation, check only isolation: cancelled run's ID/job must not supply the next run's counters. Do not use this phase as proof that C09 has cleaned every cancelled process/link. Avoid unsafe forced OVS corruption; ownership rejection and out-of-order cases have automated coverage.

## 10. Remaining limits / stop condition

No live Mininet, controller switching, browser interaction or consolidated application test is claimed. Final manual verification remains required. Runtime revisions order this backend's lifecycle; a backend restart requires authoritative initial-state rehydration (reload is part of the procedure), not reuse of arbitrary old captured messages. The worker/backend must be upgraded together; an old worker lacking owner metadata is rejected instead of silently trusted.

Cancelled/failed workloads may still require C09 cleanup; their unique identities prevent contamination here. Analytics fallback/sample values and aggregate formulas remain C10. Manual traffic can affect real network contention, but cannot supply an experiment's counters; experiment ownership is not a full laboratory isolation scheduler. Existing last-run history is retained without relabelling it LIVE. No topology, controller algorithm, design system, or automatic Ryu restart was added. Stop after C08 verification and await user review.
