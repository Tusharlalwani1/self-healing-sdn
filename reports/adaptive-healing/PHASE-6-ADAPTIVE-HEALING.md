# Phase 6 — Adaptive Healing + Closed-Loop Re-Healing

Implementation date: 2026-11-08. Base: `5d24182` (Phase 5).

**Status: Phase 6 validated for commit readiness, with real manual, agent-executed Mininet, and controlled integration evidence separated below.**
Earlier Phase 3–5 live evidence and reports remain unchanged. Intentional Phase 6 source, tests, approved UI and this report are prepared for explicit-path staging after final checks. Runtime data and generated evidence remain excluded. No commit or push is performed.

## Scope and architecture audit

The existing system already separates runtime-owned traffic, passive bounded service verification, independent intent evaluation, and TC link-health observations. Phase 6 reuses these boundaries:

| Existing boundary | Phase 6 use |
|---|---|
| `MininetClient.runtime_context`, `controller_context`, traffic owner snapshots, runtime lock | Ownership and short command serialization |
| `topology_catalog` / worker `get_topology` | Actual available graph, host attachments and output ports; no new topology definitions |
| Phase 5 `LinkHealthService.current()` | Runtime-owned kernel-read configuration, classification and bounded directional TC counters |
| Phase 4 `resolve_intent` / traffic owner `service_intent` | Frozen actual profile or Custom requirements, not a second intent definition |
| Phase 3 `RecoveryVerificationEngine.begin/wait/finish` | Unchanged bounded passive service measurement, registration-acknowledgement timing fix retained |
| Phase 4 `evaluate` | Independent evaluation of the exact owned verification result and cycle intent snapshot |
| Existing WS manager and Zustand store | One existing connection, reconnect snapshot, REST fallback and ownership checks |
| Existing experiment runner and JSON summary/report serialization | Adaptive cycle + final verification + intent round-trip and cleanup |

`Adaptive` is a fourth selectable strategy. The original Baseline, Reactive and Fast Failover controller scripts are unchanged. Selecting controllers still uses the existing checked stop/reset/start boundary and port 6653 with `--observe-links`.

The new Ryu `AdaptiveController` inherits discovery and initial low-priority forwarding from Baseline. It does not inherit Reactive healing. Its link-delete handler reports the incident and refreshes discovery; the backend policy owns subsequent Adaptive actions. Ryu app discovery was checked against the installed Ryu library and returned `AdaptiveController`, OpenFlow version `[4]` (1.3), without starting a controller.

## Actual forwarding action

The backend calls the existing privileged worker using `apply_adaptive_path`. The worker remains `/usr/bin/python3` and uses the running Mininet object. It:

1. Checks the runtime, active ping process, traffic job, Adaptive controller owner, controller generation and experiment owner.
2. Validates a simple host-to-host path against **fresh UP runtime links**, actual switch identities, actual host MACs and switch port numbers.
3. Removes only Adaptive's reserved cookie `0xad060001` from current runtime switches.
4. Installs destination-MAC rules in both directions, downstream before ingress, priority 200. Initial Ryu forwarding is priority 10 and cannot overwrite their precedence.
5. Runs checked, bounded `ovs-ofctl -O OpenFlow13` commands and reads back every expected match/priority/output action.
6. Returns installed-path metadata only after all checks succeed. On failure it attempts cookie cleanup on every runtime switch and returns failure/cleanup details. No successful installation is inferred from a log or HTTP 200.

These management-socket commands are sequential, not a network-wide atomic bundle. A transition can disrupt packets. A readback proves configured forwarding rules at that instant, not which path packets actually traversed. Old lower-priority Ryu rules remain outside the reserved cookie. Controller switching still resets the entire dataplane through the established boundary.

**Computed path != installed path != observed dataplane path.**

`/api/topology.active_paths` remains reserved for verified dataplane paths and remains empty when unavailable. Adaptive candidates and installation evidence use a separate contract. The canvas labels `Candidate (computed)` or `Installed rules`; DOWN and health styling retain precedence. Observed path is always null/unavailable in this implementation.

## Deterministic project policy

`adaptive_policy.candidates` performs breadth-first enumeration of simple host-to-host paths. Intermediate vertices must be actual runtime switches. DOWN links and disconnected host attachments are excluded. Node expansion order is lexical and stable. Work is bounded at 4096 expansions and output at 24 candidates (configurable downward). Candidates are deduplicated by their full ordered path, including host endpoints. This bounded search does not claim to find the globally optimal path.

For each inter-switch edge the candidate preserves:

- CRITICAL, DEGRADED and UNKNOWN classification counts;
- sum of **kernel-read configured additional delay**, or null if any required configuration is missing;
- sum of **configured loss risks**, or null if missing; this sum is a policy heuristic, not measured/estimated end-to-end loss;
- worst available **bounded observed TC egress loss**; null when absent;
- missing configuration count; observed path RTT remains null.

Let `D` be the configured delay sum, `L` the configured loss-risk sum, `O` the worst available observed TC egress loss, `G` degraded count, `U` unknown count, `M` missing configuration values, and `H` inter-switch hops. The persisted policy components contain these values separately.

```
delay_weight = 100 / max(intent.max_avg_rtt_ms or 100, 1)
loss_weight = 5 / max(intent.max_loss_percent if set else 5, 0.1)
cost = D*delay_weight + L*loss_weight*10 + O*loss_weight*10
       + G*100 + U*5 + M*100 + H
rank = (CRITICAL count, cost, path length, stable candidate ID)
```

Absent terms do not contribute numeric risk, but remain null in evidence and add explicit missing/UNKNOWN penalties. They are never labeled measured zero or HEALTHY. CRITICAL count is the first ranking key, so a candidate without CRITICAL edges outranks any with them. If every available route contains CRITICAL edges, the least penalized candidate can still be attempted, with its evidence visible.

This is a transparent project policy, not an SLA prediction. Phase 4 thresholds are not changed. Interactive's 25 ms threshold increases latency weighting; Reliable's zero-loss target increases loss weighting using the documented 0.1 denominator floor; Standard is balanced; Bulk's permissive targets reduce these weights. Custom uses its actual frozen thresholds. An unset optional requirement uses the stated default risk weight for route ordering without creating an evaluation requirement. Priority remains metadata; no QoS enforcement is claimed.

Candidate evidence comes from the same runtime-owned health snapshot. Configured TC impairment, observed TC loss and measured end-to-end verification RTT/loss remain separate throughout persistence and UI. No per-link RTT is fabricated.

## Triggers and cycle lifecycle

- `SERVICE_START` establishes an Adaptive-owned route when a new active traffic owner is first admitted. This is proactive route establishment and bounded service assessment, **not proof of recovery from a failure**.
- `HARD_FAILURE` follows a successful dashboard failure action or discovery of an actual DOWN runtime edge during the Adaptive monitor's one-second poll. When an installed job route is known, unrelated failed edges do not trigger rerouting.
- `SOFT_DEGRADATION` follows a new DEGRADED/CRITICAL health signature on the installed service route while traffic is active. The signature includes stable endpoints, health class and quality revision. Repeated polls do not create repeated cycles.
- Other controller modes never admit Adaptive cycles or Adaptive flow commands.
- No active owned traffic means no cycle; no synthetic verification/intent evidence is produced.

The monitor is independent of the Phase 5 health monitor. It consumes `current()` evidence; it does not run TC classification or change impairments. API-triggered and monitor-triggered cycles share a serialized trigger boundary, preventing duplicate service-start admission. A newer relevant hard failure cancels the prior cycle and queues the newest pending incident subject to cooldown. A relevant soft transition during an active cycle is recorded as additional incident evidence without cancelling its bounded observation; the resulting verification and fresh candidate evidence decide whether a retry is justified. This prevents the monitor from preempting its own closed loop. A queued incident that is no longer relevant is dropped rather than blocking monitoring.

Each cycle freezes runtime ID/revision, topology, controller generation, job ID/sequence, experiment owner, intent and config. Checks run before and after every forwarding command and before accepting verification. The cycle object identity protects replacements even in the same runtime. A worker reply must echo cycle/attempt/job ownership. Starting replacement traffic or switching runtime/controller invalidates current evidence and old actions. Completed histories retain their original ownership.

The runtime lock spans inventory or individual worker commands only. It is released for the verification window and cooldown. The unchanged Phase 3 timer starts after worker registration acknowledgement. Cancellation during registration also finalizes the owned verification tap; cancellation cannot finalize another cycle's verification.

## Bounded closed loop and outcomes

Default maximum: **3 attempts**, configurable only within 1–3. Default cooldown: **2 seconds**, API bounds 1–30. Candidate limit: 1–24. Config is frozen per admitted cycle and cannot change during an active cycle.

Every attempt persists its ranked candidate snapshot, health/evidence snapshot, intent snapshot, action acknowledgement, verification ID/result and independently computed intent evaluation.

After an attempt:

| Condition | Result |
|---|---|
| Recovery VERIFIED and Intent SATISFIED | `SATISFIED`, terminal |
| Recovery verification did not pass | `FAILED`, terminal; a SATISFIED independent intent cannot override this |
| VERIFIED + VIOLATED and supported untried improvement | Fresh candidate selection, apply, new bounded verification and intent evaluation |
| VERIFIED + VIOLATED, comparable configured evidence, no justified untried improvement | `BEST_ACHIEVABLE` within the bounded considered candidates and policy |
| Missing evidence, unsafe/stale ownership, no eligible route, apply failure, unavailable intent, exhausted bound, cancellation | `ESCALATED`, terminal |

A retry is permitted only when an actually failed RTT/loss requirement has a strictly better corresponding configured risk on an untried candidate, compared against the previous path using the **same fresh health snapshot**. Both paths need complete configured delay/loss evidence; neither configured risk may worsen, and CRITICAL count cannot increase. A different hop count or unexplained high measured RTT alone does not justify a retry. No path is tried twice in a cycle; no A→B→A oscillation is allowed.

With unchanged evidence, the initial best-ranked route will commonly have no justified alternative after an intent violation. That is correctly reported as BEST_ACHIEVABLE or ESCALATED, not a forced demonstration of a second action. A deterministic regression fixture introduces a newly supported delay impairment on route A after the first VERIFIED + VIOLATED observation; route B is then genuinely justified by the fresh evidence and independently verified. The fixture is not a live result.

## Persistence, REST and WebSocket

SQLite migration is additive: `adaptive_cycles(cycle_id, runtime_id, created_at, record_json)`. Full JSON preserves trigger evidence, ownership, snapshots, decision components, attempts, actual action results and final outcome. Meaningful transitions also enter existing event logs with source `ADAPTIVE`. Reads/imports do not initialize or modify the runtime database. Tests use temporary databases.

| API | Contract |
|---|---|
| `GET /api/adaptive/current` | Owned current cycle or JSON null |
| `GET /api/adaptive/history?limit=50` | Persisted history; empty array when absent |
| `GET /api/adaptive/cycles/{id}` | Exact persisted record; 404 if absent |
| `GET /api/adaptive/cycles/{id}/candidates` | Persisted ranked snapshot, not an invented current graph |
| `GET /api/adaptive/cycles/{id}/attempts` | Persisted attempt history |
| `GET /api/adaptive/config` | Current bounded policy config |
| `PUT /api/adaptive/config` | Validated config; 409 during active cycle, JSON-safe 422 for invalid/nonfinite inputs |
| `POST /api/adaptive/cancel` | Cancel active cycle and clear pending incident; no claim of successful recovery |

`ADAPTIVE_HEALING` WS messages contain `{event_type, adaptive: <full cycle>}` on meaningful transitions only. `INITIAL_STATE.adaptive` provides reconnect hydration. No second WS connection was added. The frontend validates ownership, generation, topology, job sequence, cycle creation order and within-cycle sequence; late REST responses cannot overwrite newer WS evidence. Controller stop/runtime replacement clears live Adaptive state.

Experiment Lab accepts Adaptive as an individual strategy and stores the cycle with its verification and intent in the experiment summary. Existing report JSON serialization retains that evidence. Cancellation/finalization stops Adaptive actions before restoring the experiment's injected link. The legacy three-controller comparison workflow remains unchanged; Adaptive can be run individually and compared through Analytics' measured controller groups. Analytics only includes actual completed persisted traffic results; absent processing measurements remain N/A.

## UI

Controllers and global selection include Adaptive. Overview and Failure Simulator reuse the approved Adaptive card: compact metadata, Trigger → Decision → Recovery → Intent workflow, distinct outcome summary and separated installed-route chips / unavailable observed path. Desktop shows four connected steps, mobile stacks them, and long routes wrap. All recovery metrics are display-only reads of bounded verification evidence, with at most two decimals and no fallback to overall job telemetry. Candidates, policy components, attempt history and IDs are collapsed. Numeric policy values display at most two decimals; null remains N/A. The topology canvas highlights selected candidates/checked installations with explicit provenance and preserves DOWN/CRITICAL/DEGRADED semantics. No existing Phase 3/4/5 card, threshold, controller behavior or topology definition was redesigned.

## Automated validation

Generated logs/screenshots are local validation artifacts and remain unstaged. The final validation manifest records exact commands and results.

- Focused backend: **40 passed**; policy, eligible runtime graph, missing/UNKNOWN evidence, intent-dependent ranking, Custom freeze, actual worker command/readback boundary, cancellation during admission, stale generations/runtime/job ownership, simultaneous triggers, cooldown, pending incidents, failed verification, justified second attempt, no repeats, attempt bound, independent intent evaluation, API and additive persistence.
- Experiment regression: Adaptive summary retains cycle/verification/intent; cancellation happens while failed link is still DOWN, before cleanup restores it.
- Full backend: **303 passed**; includes existing Baseline/Reactive/FF, C05/C06/C08/C09/C10 and Phase 3/4/5 regressions.
- Frontend: **148 passed**, including **18 Adaptive tests**; application and test TypeScript passed; production build passed. Vite's existing large-chunk warning remains informational.
- Hidden Edge production-bundle Mesh fixture: **12 check groups**, including Adaptive selection, reconnect hydration, card/provenance, stale WS rejection, responsive 390 px rendering and existing Phase 3/4/5 regressions; zero browser console errors.
- Hidden Edge traffic fixture: **8 check groups**, including 300/500/1000 packet request preservation and navigation; zero browser console errors.
- Ryu app discovery: `AdaptiveController [4]`, no listener/network started.

Final validation commands/results (2026-11-08): `python -m unittest backend.tests.test_adaptive_healing -v` — 40 passed; `python -m unittest discover -s backend/tests -v` — 303 passed. Bundled Node focused Adaptive tests — 18 passed; full frontend suite — 148 passed. Application `tsc -b`, test `tsc --noEmit`, and `npm run build` passed. Production Mesh/Adaptive browser fixture (12 check groups) and traffic browser fixture (8 check groups) passed with zero console errors. `git diff --check` passed. Backend production logic required no final-validation fix. The generated command outputs are retained under `reports/adaptive-healing-final/` and excluded from staging.

Browser/API/OVS unit fixtures are explicitly synthetic transports. Their results are distinct from the real Mininet evidence below; fixtures alone do not establish live dataplane recovery.

## LIVE VALIDATION — evidence categories kept separate

Validation date: 2026-11-08. The approved Adaptive card design is retained. No production logic, thresholds, controller behavior, topology, TC behavior or evaluation semantics were changed during final validation. Three additional regression tests strengthen explicit bounds/stale-result coverage.

### A. REAL MANUAL MININET EVIDENCE — supplied and accepted from the operator

**A1. Adaptive hard failure — PASSED.** Multi-Path Mesh — Advanced, Adaptive, Standard intent, active h1 → h2 traffic; failure s2 ↔ s5. The operator observed the Adaptive trigger, attempt 1 of 3, installed alternate rules for `h1 → s1 → s3 → s6 → s9 → h2`, Recovery VERIFIED, Intent SATISFIED and final SATISFIED. Installed rules were distinguished from the observed dataplane path, which remained unavailable. No packet totals or RTT are invented for this accepted manual scenario because none were provided.

**A2. Adaptive soft delay — PASSED; BEST_ACHIEVABLE is the correct accepted outcome.** Mesh, Adaptive, Interactive / Low Latency intent, active h1 → h2 traffic. s3 ↔ s6 remained operationally **UP**, with kernel-read **configured additional delay 100 ms**, **configured loss 0%**, health **CRITICAL**, and measured per-link RTT **N/A**. Adaptive installed alternate rules for `h1 → s1 → s2 → s5 → s9 → h2`.

| Bounded Recovery Verification field | Operator-observed result |
|---|---|
| Status / reachability / stability | VERIFIED / Restored / Passed |
| Post-recovery Tx / Rx | 40 / 40 |
| Measured post-recovery loss | 0% |
| Measured post-recovery average RTT | 31.27 ms |
| Engine verification duration | 5.52 s |
| Path verification | UNAVAILABLE |

Interactive reachability passed, measured loss 0% passed its ≤1% target, and measured RTT 31.27 ms violated its ≤25 ms target. Intent was VIOLATED. Final outcome was **BEST_ACHIEVABLE**: service recovered, but requirements remained unmet and no justified better untried candidate was available. Normal measured Mesh RTT is around 30–32 ms, so this is truthful termination, not a Phase 6 failure. The 25 ms threshold was not changed. The 5.52 s duration is the verification engine's duration, not exact outage duration, controller recovery time or local switching latency.

### B. REAL MININET EVIDENCE EXECUTED BY THE AGENT

The existing local WSL backend, privileged system-Python worker, actual Mininet network, Ryu and OVS were used. Mutations went through the real REST endpoints; independent OVS inspection used `ovs-ofctl` against actual bridges. These are not browser/unit fixtures. Runtime: `a7904e0eef0a411f8c04223082b96904`, topology `multipath_mesh`.

**B1. Adaptive + Reliable + configured 10% TC loss — PASSED.** The previous s3–s6 delay was explicitly cleared first; fresh kernel readback confirmed zero additional delay/loss on all 14 ISLs. A new h1 → h2 Reliable job ran 1000 packets at 0.05 s. SERVICE_START installed `h1 → s1 → s2 → s5 → s9 → h2` and completed SATISFIED. Then the currently installed s2–s5 edge received **configured additional delay 0 ms / configured TC loss 10%**.

Fresh readback showed s2–s5 **UP / CRITICAL**, configured loss **10%**, additional delay **0 ms** and per-link RTT **null**. Adaptive automatically admitted `SOFT_DEGRADATION` cycle `adaptive_a475723daa0242feb335f1f6ad35aa4d` for job `phase6_reliable_85304db8810e449186a0be3a5c4fff2f`. Its single attempt installed `h1 → s1 → s3 → s6 → s9 → h2`, avoiding the impaired edge. Its action source was `OVS_OPENFLOW13_FLOW_READBACK`; a separate root OVS query confirmed priority-200 rules under cookie `0xad060001` on the selected bridges. This confirms installed rules, not an observed packet path.

| Measurement scope | Actual result |
|---|---|
| Overall finite job, drained accounting complete | 1000 Tx / 981 Rx |
| Overall measured end-to-end job loss | 1.9% |
| Overall successful-reply average RTT | 31.928 ms |
| Bounded recovery window | 39 Tx / 39 Rx |
| Measured bounded post-recovery loss | 0% |
| Measured bounded post-recovery average RTT | 31.03589743589744 ms |
| Recovery / reachability / stability | VERIFIED / restored / passed |
| Verification engine duration | 6.026084397000886 s |
| Reliable intent / final Adaptive outcome | SATISFIED / SATISFIED |
| Path verification / observed dataplane path | UNAVAILABLE / null |

The configured 10% link impairment is **not** called measured loss. The overall job's 1.9% includes traffic before and during route transition and differs from the successful bounded 0% recovery window. No exact outage/switching time is claimed.

Generated local evidence (excluded from staging): `reports/adaptive-healing-final/live-reliable-evidence.json`, `live-reliable-summary.json`, and `live-reliable-ovs-readback.json`.

**B2. Reactive soft-loss isolation — PASSED.** After clearing degradation and selecting Reactive through the normal checked controller transition, a new h1 → h2 job ran 300 packets at 0.05 s. Independent OVS destination-MAC flow inspection reconstructed the installed rule chain `h1 → s1 → s2 → s5 → s9 → h2` before injection; this is not claimed as an observed dataplane path. Configured 10% loss / 0 additional delay was injected on its s2–s5 link. Fresh kernel evidence showed **UP / CRITICAL**. Across **11 current-state checks**, `/api/adaptive/current` remained null. Comparing Adaptive history IDs before and after showed **zero new Adaptive cycles**. Actual final drained accounting was **300 Tx / 279 Rx, 7% overall measured loss, 32.7 ms overall average RTT**. Configured 10% and measured 7% remain separate.

Generated local evidence (excluded): `live-reactive-evidence.json` and `live-reactive-summary.json` under `reports/adaptive-healing-final/`.

**Cleanup independently verified.** All injected quality impairments were cleared; traffic was stopped/completed; Adaptive was restored READY under a new generation. Real OVS showed **9/9 controller connections true** to `tcp:127.0.0.1:6653`; topology showed **16/16 links UP**; fresh kernel evidence showed **14/14 ISLs with zero additional delay and zero configured loss**; no active traffic remained. Idle UNKNOWN link health was not relabeled HEALTHY. Evidence: `live-final-runtime.json` (generated, excluded). The runtime database naturally contains these live events and remains excluded from staging.

### C. AUTOMATED/CONTROLLED INTEGRATION EVIDENCE — NOT LIVE MININET ATTEMPT-2 PROOF

The existing `CycleTests.test_soft_monitor_transition_during_observation_preserves_closed_loop` was executed unchanged and its full controlled trace captured. It runs the real Adaptive cycle/state machine, candidate enumeration/ranking, monitor transition handling, ownership checks and actual Service Intent evaluator. Worker/OVS acknowledgements and Recovery Verification results are **explicit deterministic transport fixtures**, not real network measurements. The following RTT values are fixture inputs, not live evidence:

| Attempt | Computed candidate (host endpoints included) | Verification | Intent | Fixture RTT |
|---|---|---|---|---|
| 1 | h1 → s1 → s2 → s4 → h2 | VERIFIED (`v1`) | VIOLATED | 30 ms |
| 2 | h1 → s1 → s3 → s4 → h2 | VERIFIED (`v2`) | SATISFIED | 20 ms |

During the first observation, a controlled fresh readback fixture marks an edge on candidate A DEGRADED with 20 ms configured additional delay. The monitor coalesces this additional soft incident into the same cycle instead of cancelling observation. Once attempt 1 yields VERIFIED + VIOLATED, both paths are compared against the same fresh evidence. B has strictly lower configured delay risk with no worsening configured loss, so the actual policy justifies B. The cycle automatically performs a second distinct worker apply, admits a new verification ID, evaluates intent again and terminates **SATISFIED**. Exactly **two applies** occur. The attempted-candidate set excludes A from reuse; no A→B→A loop occurs. Trace: `controlled-attempt2-proof.json` (generated, excluded).

**Bounds and stale-state coverage.** Existing assertions are retained. Added tests explicitly exercise default **3 attempts** on Mesh (three unique candidates, exactly three applies, terminal ESCALATED), reject an old verification result after replacement of the cycle object, and show that an external stale VIOLATED intent record is never consulted to cause a retry. Existing tests cover old runtime/generation, queued writes, cancellation during tap admission, same-event deduplication, cooldown, non-Adaptive isolation, genuine action errors, unavailable evidence and independent verification/intent outcomes. FAILED verification is not promoted to success by a SATISFIED independent intent.

**Remaining limitation.** A naturally occurring, justified real Mininet Attempt-2 cycle was not produced or claimed. The live Interactive scenario legitimately terminates BEST_ACHIEVABLE because all supported untried candidates lack a justified improvement for the unmet latency target. No thresholds, measurements or candidate evidence were falsified to force a second live attempt. The exact two-attempt branch has controlled integration proof as permitted by the validation request; no further operator testing is required for this stated validation scope.

## Reference live scenario checklist and restart commands

Before testing, stop the existing simulation/controller through the dashboard and restart the backend and worker using the existing project entrypoints. The already-running worker must be restarted to load the new IPC command. Keep `/usr/bin/python3` for the worker, the existing SDN venv for Ryu/backend, port 6653 and `--observe-links`. Do not run `mn -c` after Ryu starts. Do not reuse a stale worker socket/daemon as evidence of new worker code.

For explicit WSL terminals, after stopping simulation/controller and shutting down the old backend, identify the old worker with `pgrep -af 'python3.*mininet_worker.py'`. Stop that confirmed process with Ctrl+C in its terminal or `sudo kill -TERM <confirmed-worker-pid>`; confirm it exited before starting another worker. Then use separate terminals:

```bash
# Worker terminal; system Python, NOT the SDN virtualenv.
cd /mnt/e/Projects/self-healing-sdn
sudo /usr/bin/python3 backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock
```

```bash
# Backend terminal; existing SDN virtualenv.
cd /mnt/e/Projects/self-healing-sdn
SDN_VENV_PYTHON="$HOME/sdn-env/bin/python3" "$HOME/sdn-env/bin/python3" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

These are manual restart instructions, not commands executed during Phase 6 implementation. Refresh the production dashboard after both are running.

1. **Mesh hard failure:** select Multi-Path Mesh and Adaptive; start simulation. Confirm 9 OVS bridges, 16 actual links and controller readiness. Start h1→h2 traffic, 1000 packets at 50 ms, Standard intent. Wait for SERVICE_START installation/assessment, inspect `GET /api/adaptive/current`, then fail an inter-switch edge on its installed rule path. Confirm actual interfaces DOWN, new candidates exclude it, worker action source is `OVS_OPENFLOW13_FLOW_READBACK`, and inspect `ovs-ofctl -O OpenFlow13 dump-flows sN cookie=0xad060001/-1` on each selected switch. Compare output ports to runtime links. Confirm independent bounded verification and intent result; record the actual outcome without assuming SATISFIED. Restore the link afterward.
2. **Interactive delay:** start a fresh Adaptive traffic run with Interactive intent. Select an inter-switch edge on the current installed route, inject +100 ms additional TC delay. Confirm kernel readback and operational UP / CRITICAL independently. Verify one SOFT_DEGRADATION cycle, candidate penalties/avoidance, checked installation, measured post-action RTT/loss and actual intent outcome. Do not call configured delay a measured per-link RTT. Repeated polls must not create repeated cycles.
3. **Reliable loss:** clear prior impairment explicitly. Start a fresh Adaptive run with Reliable intent; inject 10% configured TC loss on its installed route. Confirm configured impairment, measured end-to-end traffic loss and observed TC counter evidence stay separate. Verify loss-sensitive ranking, controlled apply and bounded results. Clear quality and repeat healthy traffic for restoration evidence.
4. **Controlled re-healing:** use a long active stream with Interactive intent. Record cycle/attempt 1 and its evidence. A second action is expected only if attempt 1 is VERIFIED + VIOLATED and fresh readback demonstrates an untried route with strictly lower failed-metric risk and no worsening configured risks. If a controlled second degradation on route A causes this supported change, inspect the new candidate snapshot and attempt 2 verification ID. If evidence does not justify improvement, expect BEST_ACHIEVABLE/ESCALATED and record that honestly. Do not alter thresholds or insert fake metrics to force the demo. The automated fixture covers the deterministic two-attempt branch until a safe live setup is reproduced.
5. **Reactive non-Adaptive regression:** choose Reactive via the normal stop/reset/start boundary, run traffic, inject a soft impairment. Confirm Phase 5 health/evidence updates but no Adaptive cycle/priority-200 cookie rules are created. Clear impairment. Baseline remains non-healing and FF retains its independent group behavior.
6. **Ownership/cancellation:** during an Adaptive observation cancel the cycle or stop traffic; then start a new job/controller/runtime. Confirm old cycles remain historical, no stale job applies occur, and current REST/WS/UI rejects old ownership. Try no active traffic and verify no fabricated cycle/verification evidence. Test Diamond compatibility separately.
7. **Experiment/report:** run an individual Adaptive experiment with sufficient traffic remaining after failure. Inspect experiment summary/report JSON for exact cycle, action, verification and intent snapshots. Cancel a second experiment and verify observation/actions stop before link restoration. Analytics must include only actual completed traffic samples and show missing controller-processing time as N/A.

This checklist is retained for reproducibility, not as a request for more manual testing. The executed scenarios and their evidence categories are recorded below. A real-network two-attempt re-healing cycle was not forced; its state-machine behavior is established through controlled integration proof. Other optional scenarios in the reference checklist are not implicitly claimed as live-tested.

## Limits and defensible claims

- No AI/ML, global-optimal routing claim, guaranteed SLA, exact outage duration or local switch failover timing.
- No measured per-link RTT or verified observed forwarding path.
- Initial rank is based on explicitly scoped configured risks/TC counters and topology, not an invented end-to-end predictor.
- Closed-loop decisions are bounded by available candidates/evidence; no retry is preferable to an unsupported claim of improvement.
- One active service/job and one Adaptive cycle are coordinated at a time, matching the existing traffic/verification model.
- Polling introduces trigger latency. OVS management operations are checked but sequential, and worker/lock admission can add time. Verification duration is an engine duration, not controller recovery time.
- Process/backend restart does not resurrect historical cycles as active; the operator restarts a valid runtime/traffic owner.
- Existing Phase 5 live reports, Recovery Verification timing investigation and Mininet worker environment recovery report are preserved.

Phase 6 has real Mesh hard-failure, soft-delay, Reliable soft-loss and Reactive isolation evidence, plus controlled two-attempt state-machine proof. It does not claim a naturally reproduced real Mininet Attempt-2 cycle, universal SLA satisfaction, exact outage duration or an observed forwarding path.

## Intentional Phase 6 file list

```text
backend/api/adaptive.py
backend/api/links.py
backend/config.py
backend/database/db.py
backend/main.py
backend/models/schemas.py
backend/services/adaptive_forwarding.py
backend/services/adaptive_healing.py
backend/services/adaptive_policy.py
backend/services/controller_manager.py
backend/services/experiment_runner.py
backend/services/mininet_worker.py
backend/tests/test_adaptive_healing.py
backend/tests/test_experiment_cleanup.py
controller_adaptive.py
frontend/src/App.tsx
frontend/src/components/AdaptiveHealingCard.tsx
frontend/src/components/ServiceIntentCard.tsx
frontend/src/components/SoftDegradationPanel.tsx
frontend/src/components/topology/TopologyCanvas.tsx
frontend/src/index.css
frontend/src/pages/ControllersView.tsx
frontend/src/pages/ExperimentLabView.tsx
frontend/src/pages/FailureSimulatorView.tsx
frontend/src/pages/OverviewView.tsx
frontend/src/services/adaptive.ts
frontend/src/services/api.ts
frontend/src/services/metrics.ts
frontend/src/services/topology.ts
frontend/src/stores/sdnStore.ts
frontend/src/types/index.ts
frontend/tests/adaptive-healing.test.tsx
frontend/tests/multipath-mesh.browser.mjs
frontend/tests/traffic-configuration.browser.mjs
reports/adaptive-healing/PHASE-6-ADAPTIVE-HEALING.md
```

These 35 files are intentional source/tests/documentation. The already modified runtime database and old/new generated logs, screenshots, browser JSON and validation shell scripts remain unstaged and are excluded from this list.
