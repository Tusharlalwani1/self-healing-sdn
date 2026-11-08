# Phase 5 — Soft Failure / Network Degradation Detection

Status: **Phase 5 implementation and real manual Mininet validation completed and passed**, as reported by the project owner on 2026-11-08. The supplied live evidence is recorded below, separately from automated tests and browser fixtures. Phase 5 provides detection and evidence only; no adaptive rerouting is implemented.

## Real manual Mininet validation — completed and passed

These are project-owner-reported real runtime observations, not mock data, browser fixtures or new live runs performed for this documentation cleanup. The validated topology was **Multi-Path Mesh — Advanced**, with **Reactive Self-Healing Controller**. Measurements below are end-to-end h1→h2 traffic or explicitly identified Recovery Verification measurements. **Measured per-link RTT remains unavailable.**

| Live scenario | Configured TC impairment / action | Operational state | Health classification | Measured end-to-end traffic evidence |
|---|---|---|---|---|
| Delay degradation on s2-s5 | +100 ms real additional TC delay | Remained UP | UP / CRITICAL | 1000 Tx / 1000 Rx; RTT increased from roughly 30–32 ms to about 130.9 ms |
| Packet-loss degradation on s2-s5 | 10% real configured TC packet loss | Remained UP | UP / CRITICAL | 1000 Tx / 893 Rx; actual end-to-end loss 10.7% |
| Restore s2-s5 quality | Kernel-read **additional** configured delay returned to 0 ms and configured loss to 0% | Remained UP | No final post-restoration health classification was supplied; do not infer one from job totals | New run: 1000 Tx / 1000 Rx, 0% loss, average RTT about 32.6 ms |
| Hard-failure regression on s1-s2 | Actual hard link failure during h1→h2 traffic | DOWN / FAIL in topology | Hard state remains distinct from soft health; no measured path is claimed | Reactive service recovered; bounded Recovery Verification evidence is listed separately below |

The delay case demonstrates that a real soft impairment can affect service while the link remains physically UP and all packets are delivered. The loss case keeps **10% configured probability** separate from **10.7% measured end-to-end loss**; these are not interchangeable. The observed RTT change is recorded as supplied, without inferring traversal direction/count, an exact forwarding path, or a measured per-link RTT.

Restoration's 0 ms refers to **additional impairment above the topology baseline**, not removal of the original 5 ms TCLink delay. Configured values, measured job results, operational status and health classification remain separate evidence domains. The job's healthy results alone are not used to invent a per-link HEALTHY observation.

### Hard-failure Recovery Verification after the timing fix

| Recovery Verification field | Real manually reported result |
|---|---|
| Topology / controller / failed link | Multi-Path Mesh / Reactive / s1-s2 |
| Final verification status | **VERIFIED** |
| Reachability | Restored |
| Post-failure Tx / Rx | **40 / 40** |
| Post-failure loss | **0%** |
| Post-Recovery Avg RTT | **31.78 ms** |
| Stability | Passed |
| Verification duration | **5.14 s** |
| Path verification | **UNAVAILABLE** |

These are bounded post-failure service measurements, not the overall traffic-job average. **5.14 seconds is verification/orchestration duration**, not controller recovery time, exact outage duration or local Fast Failover switching latency. Path verification correctly remains UNAVAILABLE; **computed path != installed path != observed dataplane path**.

### Live regressions and supporting fixes

- The selected soft-degradation link now persists across dashboard navigation using a stable endpoint key in Zustand.
- Delay/loss drafts persist independently in Zustand, including the 0 ms / 10% case. Restoring a draft does not inject impairment, replace kernel evidence or change operational/health state.
- A pre-existing Recovery Verification timing bug started the observation deadline before worker registration acknowledgement, allowing lock/worker waiting to consume the observation budget. The timer now starts after acknowledgement, with setup separately bounded. Thresholds, reply grace, stability requirements and classification were not weakened. The supplied live retest above VERIFIED successfully. The [timing investigation](../recovery-verification/PHASE-5-HARD-FAILURE-TIMING-INVESTIGATION.md) preserves the original failure and diagnosis.
- A dead Mininet worker and stale `/tmp/mininet_worker.sock` were recovered as an environment/process-state issue. No production code change was required. The [worker recovery report](../recovery-verification/MININET-WORKER-RECOVERY.md) preserves the diagnosis, real startup checks and separate cold-start timeout observation.

Only the scenarios and values explicitly supplied here are marked manually validated. Combined impairment, Diamond-specific health checks, partial restoration failures, stale ownership, no-traffic handling and soft-experiment limitations retain their automated coverage/documented status; this update does not claim that every repeatable checklist item was manually exercised.

## Scope and architecture audit

The existing worker builds TCLinks from `topology_catalog.py`; Diamond has four inter-switch links and Mesh fourteen. Both use **10 Mbps bandwidth and 5 ms base one-way delay**, plus two host links. The existing UP/DOWN state is read from both Mininet interfaces. Existing traffic accounting is actual end-to-end ICMP job accounting; it cannot measure an individual inter-switch RTT or loss rate.

Existing runtime identity/revision and controller generation originate in `MininetClient`. Dashboard lifecycle actions use `runtime_transition_lock`, experiments retain their existing ownership/cleanup, WebSocket messages use the existing `/ws/events` channel, and SQLite initializes additive tables. Phase 3 verifies bounded post-failure service; Phase 4 evaluates that evidence against an intent. Neither is a periodic link health detector.

The implementation follows:

```text
Failure Simulator / runtime-pinned REST request
  -> existing lifecycle and Mininet client runtime locks
  -> privileged worker / actual net.links inventory
  -> checked tc qdisc change on BOTH actual switch interfaces
  -> fresh tc JSON readback and interface operational state
  -> LinkHealthService classification and bounded counter windows
  -> transition-only SQLite history + existing event logs
  -> existing WebSocket snapshot + REST polling fallback
  -> quality card, topology edge labels/patterns, NOC health counts
```

`backend/services/link_quality.py` is standard-library-only so the privileged system-Python worker can import it in package and script modes. `backend/services/link_health.py` uses the existing runtime context; it does not create another runtime identity model.

## Hard versus soft failure

Physical `status` / `operational_status` remains UP or DOWN. Independent `health_status` is HEALTHY, DEGRADED, CRITICAL or UNKNOWN. Soft injection never calls link-down, controller recovery, routing, Recovery Verification, or intent evaluation. DOWN takes precedence and forces UNKNOWN with unavailable observed evidence.

Hard restoration does not remove a soft impairment. Quality restoration does not bring a DOWN link UP. A quality revision changes on quality writes and hard status-change attempts, so a rapid DOWN/UP between health polls still invalidates the old observation window.

## Real injection and restoration

The worker resolves endpoints through the active Mininet network, excludes host links, rejects missing/stopped/stale/DOWN targets, and validates finite additional delay in 0–2000 ms and loss in 0–100%, with at least one nonzero injection value.

The project TCLink layout is an HTB bandwidth parent with a netem child. The helper reads the existing child's handle, parent, limit, delay and random loss, snapshots the original configuration, and uses **`tc qdisc change`**, not delete/add or TCIntf reconfiguration. Bandwidth, topology definitions and interface operational state remain unchanged. Delay is added to the captured original; loss composes with any captured original random loss probability. Repeated injection replaces this phase's added impairment rather than accumulating it.

Both interface readbacks must confirm requested settings. On failure, both prior endpoint configurations are restored and verified where possible; error details identify the link and any interfaces whose rollback could not be confirmed. Original snapshots remain available for retry after an incomplete operation. Unsupported qdisc layouts/options are rejected rather than overwritten.

Clear restores the captured original, normally 5 ms and 0% loss here. Repeated clear is idempotent. Clear-all enumerates the **current runtime's inter-switch links**, skips links with no owned injection, and reports exact per-link genuine failures. Counts are four for Diamond and fourteen for Mesh, not six Diamond-era total links. An impaired DOWN link cannot be cleared until hard restoration succeeds. Clear-all can therefore truthfully return a partial failure. It never silently turns a DOWN interface UP.

Stopping Mininet removes its interfaces and resets worker quality ownership/revisions; restarting or switching topology cannot reuse those original snapshots. Restart the privileged worker when deploying this new worker protocol; an old worker will truthfully reject unsupported commands.

## Evidence model and automatic detection

Each record contains runtime ID/revision, topology, controller generation, actual endpoints/interfaces, operational status, health, detection/sample timestamps, quality revision, reason code/text, source, scope, and the classification threshold snapshot.

| Evidence | Meaning |
|---|---|
| `configured_additional_delay_ms` | Maximum actual kernel-read delay above the TCLink baseline across the two interfaces; not measured RTT |
| `configured_loss_percent` | Maximum actual kernel-read random loss probability; not measured packet loss |
| `endpoints` | Actual kernel qdisc configuration and cumulative egress packet/drop counters per direction |
| `observed_loss_percent` | Worst adequately sampled direction's bounded netem drops / (dequeued packets + drops), multiplied by 100 |
| `sample_count` | Total attempts from both directions in that bounded counter window, not ICMP Tx/Rx |
| `observation_window_sec` | Actual duration of that counter window, not outage or failover time |
| `observed_avg_rtt_ms` | **null**: no per-link RTT probe exists |
| `both_directions_sampled` | Whether each direction met the sample minimum |

Netem counters may include discovery/control/ARP and data packets. They are not attributed to an ICMP traffic job, service intent, installed path or observed forwarding path. End-to-end job RTT/loss remain in Traffic Monitor with their existing calculations; they are never copied into per-link evidence. Configured impairment is never copied into observed fields. No missing measurement becomes zero.

The service polls actual TC state approximately once per second while RUNNING; REST refreshes also obtain readback. This is periodic kernel-state polling with bounded counter observations, **not a continuous per-link end-to-end probe system**. Kernel-read impairment can automatically establish DEGRADED/CRITICAL even on an idle link, with observed loss/RTT still N/A. The operator never selects a health classification.

## Project demonstration thresholds

These are configurable laboratory defaults, **not industry SLA standards** and not Phase 3/4 policy values.

| Setting | Default | Rationale |
|---|---:|---|
| Healthy additional one-way configured delay ceiling | 10 ms | Tolerance above the existing 5 ms per-link baseline; does not compare an end-to-end ~30 ms RTT with a per-link threshold |
| Critical additional configured delay | 100 ms | The requested +100 ms demonstration is a substantial change from the 5 ms baseline |
| Healthy loss ceiling | 1% | Permits low bounded sampling noise for this demonstration |
| Critical loss | 10% | Separates the requested severe-loss laboratory case |
| Observation window minimum | 2 s | Requires a complete bounded window before confirming acceptable quality |
| Minimum attempts per direction | 10 | Both directions need real packet evidence to establish HEALTHY |

DOWN → UNKNOWN. Otherwise critical configured delay/loss or adequately measured directional loss → CRITICAL. Values above a healthy ceiling → DEGRADED. HEALTHY requires acceptable kernel configuration **and sufficient bounded evidence in both directions**. Otherwise UNKNOWN (`NO_TRAFFIC_OR_INSUFFICIENT_EVIDENCE`).

A sampling gap exceeding twice the configured minimum window, counter reset, quality revision change, runtime/topology/controller-generation change, or hard transition invalidates confirmation. Clearing impairment initially gives UNKNOWN; only a subsequent complete valid traffic window can establish HEALTHY. No arbitrary recovery sleep or single instantaneous sample is used. Unavailable worker/readback invalidates cached evidence and is reported as an error, not success.

Threshold changes clear observation windows and reclassify using fresh readback. Configuration is process-local and resets to project defaults on backend restart; the threshold snapshot is persisted with each incident. No restart-persistent policy editor is claimed.

## Incidents and persistence

The additive `degradation_incidents` table stores JSON transition records with incident ID, runtime ID and detected-at index. Existing databases/tables/records remain compatible. Each incident also creates a `MININET` event log entry.

Initial UNKNOWN polling is not persisted. Entering DEGRADED/CRITICAL, subsequent health changes (including escalation/restoration confirmation) or operational changes create transitions. Remaining in the same state does **not** create another incident every poll. Clear can record CRITICAL → UNKNOWN → HEALTHY rather than falsely declaring immediate recovery. History is explicitly historical; current cards use only current runtime snapshots.

No live database schema/data was manually edited during implementation. Automated database tests use temporary files. The pre-existing modified runtime DB remains unstaged.

## API and WebSocket contract

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/api/link-health` | Fresh current inter-switch health; empty stopped-runtime snapshot |
| GET | `/api/link-health/{src}/{dst}` | Fresh single inter-switch record; missing 404, stopped 409 |
| POST | `/api/degradation/inject` | Runtime ID/revision, src/dst, additional_delay_ms, loss_percent |
| POST | `/api/degradation/clear` | Runtime ID/revision, src/dst |
| POST | `/api/degradation/clear-all` | Runtime ID/revision; dynamic owned impairment cleanup |
| GET | `/api/degradation/incidents?limit=50` | Persisted transition history; limit 1–500 |
| GET | `/api/degradation/config` | Current independent demonstration thresholds |
| PUT | `/api/degradation/config` | Validated independent health policy; not an intent/verification policy |

Malformed/nonfinite REST input returns 422 (worker independently rejects invalid input with 400). Unsupported host injection is 400; missing target 404; stopped/stale/DOWN/experiment-owned mutations 409; genuine worker/TC failures 502, including structured partial results where available. HTTP success requires checked TC action and fresh readback, not a UI-only state change.

Mutations share the existing dashboard lifecycle lock and refuse active experiment ownership. Worker requests pin the runtime; backend readback also checks runtime/topology and guards context changes between commands. Health sample ownership includes controller generation. It never borrows a traffic job or old verification measurement.

Existing `/ws/events` adds `LINK_HEALTH` and an initial-state `link_health` snapshot. Frontend validates records and accepts only matching runtime/revision/topology/generation and nondecreasing sequence. A late REST failure cannot erase newer WS evidence. Runtime stop/change/controller transitions clear current presentation; the existing three-second REST fallback refreshes health after reconnect or missed events. No second WebSocket connection system was introduced.

## Frontend changes

- Failure Simulator adds a separate Soft Degradation panel with dynamic inter-switch selector, delay/loss inputs, inject, restore quality and restore all quality controls. Existing hard controls remain separate.
- Reusable selected-link quality card shows operational/health text, reason, kernel-read configuration, measured worst-direction egress loss, unavailable per-link RTT, sample/window context and detected time. IDs/source/scope live in collapsed Technical details. Numeric evidence uses at most two decimals without changing measurements.
- Topology edges have text/accessible health labels and distinct DEGRADED/CRITICAL/DOWN dash patterns in the existing palette. Hard DOWN takes precedence.
- Overview adds a compact inter-switch-only health summary with explicit UNKNOWN; host links do not silently count as healthy.
- Controls handle busy, stopped, DOWN and experiment-owned states; server errors remain visible. A 390 px browser fixture checks the responsive control layout.
- Selected endpoint key and editable delay/loss draft values survive page unmount/remount, traffic and health updates. They never hydrate from or overwrite authoritative kernel measurements, and their restoration never submits an impairment request. A missing selected link falls back to a valid current inter-switch link without applying the draft.

## Experiments and future Phase 6 boundary

Full soft-degradation Experiment Lab orchestration is **not implemented**. The hard-failure experiment schema, accounting, cancellation, cleanup and reports remain unchanged and are covered by the complete regression suite. Its cleanup restores only the hard failure it owns; it does not invoke the new quality clear-all route. The new manual soft controls cannot mutate the runtime while an experiment owns it.

**Operator limitation:** clear all soft impairments and confirm baseline kernel configuration before running an existing hard-failure experiment on the same running topology. A same-topology experiment can reuse Mininet, so pre-existing quality impairment is not automatically removed or included in the old hard-experiment summary. Do not describe such a mixed run as a clean hard-failure comparison. Starting a fresh simulation removes owned quality impairment. No soft experiment support or quality-comparison report is advertised.

Phase 6 can consume runtime-owned health snapshots and transition IDs as inputs. It must independently choose/authorize a recovery action and establish installed/observed forwarding evidence, then invoke Recovery Verification and Service Intent evaluation. Phase 5 does none of that. **Computed path != installed path != observed dataplane path.** No AI, prediction, congestion-aware routing, automatic optimization, exact causation, exact outage duration or local FF latency is claimed.

## Automated validation and evidence

Command outputs are retained locally beside this report as generated validation evidence; logs, screenshots, fixture output and runtime data are intentionally excluded from staging. The intentional validation results are summarized in this document:

- `backend-tests.txt`: complete backend suite, including the Phase 5 worker/service/API/persistence/ownership tests and existing Phase 3/4, controller, accounting, hard-failure and experiment tests.
- `frontend-tests.txt`: complete frontend suite, including health rendering, accessible statuses/patterns, null/configured/observed separation, runtime-owned request/error behavior and stale WS/REST rejection.
- `typescript-app.txt`, `typescript-tests.txt`: application/test TypeScript checks.
- `production-build.txt`: Vite production build (existing large-chunk advisory may remain).
- `kernel-probe.txt`: isolated real Linux veth/netem probe of the production TC helper: delay, loss and combined readback; 20 actual Ethernet frames dropped by 100% loss; repeated clear preserves one netem child, original 5 ms and 10 Mbps HTB in both directions. This is **not Mininet/Ryu/OVS live validation**. IPv6 discovery is disabled only inside this throwaway namespace so the exact-count fixture has no autonomous background frames.
- `mesh-browser/browser-evidence.json`: production-bundle isolated API/WS fixture, including 14-ISL injection, runtime-owned request, CRITICAL while UP, N/A observed metrics, responsive controls, restoration to UNKNOWN, existing hard failures, Phase 3/4, topology switching and experiments.
- `traffic-browser/browser-evidence.json`: existing 500/1000/300 packet draft/configuration regression with no live backend traffic.

Final validation on 2026-11-08:

| Check | Final result |
|---|---|
| Complete backend | **262 passed**, 0 failed, 159.902 s; 233 existing + 26 Phase 5 + three Recovery Verification timing/independence regressions |
| Complete frontend | **130 passed**, 0 failed, 0 skipped; 117 existing + 13 Phase 5 tests, including selected-link and editable-draft persistence |
| Application TypeScript | PASS, exit 0 |
| Test TypeScript | PASS, exit 0 |
| Production build | **PASS**, 32.42 s; existing large-chunk advisory, no build error |
| Mesh/Phase 3/Phase 4/Phase 5 browser fixture from implementation/fix validation | PASS, including selected-link / 0 ms–10% draft navigation and no automatic injection, zero captured console errors; fixture evidence, not live SDN |
| Final traffic configuration browser fixture | PASS, including 500/1000/300 packet controls, zero captured console errors |
| Isolated real Linux TC probe | PASS, five grouped checks; not live Mininet |
| `git diff --check` | PASS, exit 0; LF/CRLF advisories on stderr only |
| Runtime DB | Normal application runtime events/data preserved; explicitly excluded from staging |

Earlier development failures were resolved before these final runs and are not live SDN evidence. The kernel exact-count probe needed isolation from autonomous IPv6 packets; production TC behavior was not altered to satisfy that fixture.

## Exact changed-file inventory and repository state

Added application/test files:

```text
backend/api/link_health.py
backend/models/link_health.py
backend/services/link_health.py
backend/services/link_quality.py
backend/tests/link_quality_kernel_probe.py
backend/tests/test_link_health.py
frontend/src/components/LinkHealthCard.tsx
frontend/src/components/SoftDegradationPanel.tsx
frontend/src/services/linkHealth.ts
frontend/tests/link-health.test.tsx
```

Modified application/test files:

```text
backend/database/db.py
backend/main.py
backend/services/mininet_worker.py
backend/services/operation_error.py
backend/services/recovery_verification.py
backend/tests/test_recovery_verification.py
frontend/src/App.tsx
frontend/src/components/modals/LinkInspectorModal.tsx
frontend/src/components/topology/TopologyCanvas.tsx
frontend/src/index.css
frontend/src/pages/FailureSimulatorView.tsx
frontend/src/pages/OverviewView.tsx
frontend/src/services/api.ts
frontend/src/stores/sdnStore.ts
frontend/tests/multipath-mesh.browser.mjs
frontend/tests/traffic-configuration.browser.mjs
```

This report and the two preserved investigation/recovery Markdown reports are intentional documentation. Local validation scripts, logs, manifests, fixture JSON/screenshots and production build output remain generated/validation workspace material and are not staged. No controllers, topology definitions, intent/experiment algorithms, dependencies, verification thresholds or traffic accounting files were modified. Recovery Verification production changes are limited to its documented observation-deadline anchor correction.

`data/sdn_dashboard.db` was already modified at implementation start and subsequently accumulated normal real-runtime events during live validation/recovery. It is preserved and excluded from staging. Source/test/documentation staging is explicitly authorized for this final readiness review; no commit or push is authorized or performed. Generated runtime artifacts/logs are not included in the staged change.

## Repeatable manual live checklist

The project's required live Phase 5 validation has **completed and passed** as recorded above. The checklist below remains available for future regression runs; its additional items are not blanket claims of manual execution.

Deploy the new backend, worker and production frontend together using the existing project launch workflow. Restart an old worker so it understands the new commands. Preserve historical data. Do not run `mn -c` after Ryu starts.

1. **Baseline inventory:** start Multi-Path Mesh + Reactive. Confirm nine bridges, sixteen physical links UP and fourteen inter-switch health records at `/api/link-health`. Check TC qdiscs on both interfaces of a selected ISL: `tc -j -s qdisc show dev <actual-interface>`, and `tc class show dev <actual-interface>`. Use actual names from the health/topology response, not assumed port numbers. Baseline is 5 ms / 0% loss / 10 Mbps. Idle unmeasured links should be UNKNOWN, not automatically HEALTHY.
2. **Traffic/path evidence:** start a sufficiently long finite h1→h2 job (e.g. 3000 packets at 0.05 s). Record baseline job Tx/Rx, RTT and actual OVS flow/port counters (`ovs-ofctl -O OpenFlow13 dump-flows <switch>` / `dump-ports`). Select an ISL demonstrably carrying test traffic; s2-s5 is an example only, not an inferred installed path. If it is not carrying traffic, choose a verified traffic-bearing link instead.
3. **Delay:** inject +100 ms, 0% loss through Failure Simulator. Capture POST success, both TC readbacks (normally 105 ms each), API/WS CRITICAL evidence, both interfaces still UP, all sixteen physical links UP, and the topology health label/pattern. Compare successful real ping RTT with baseline. Additional delay is not measured RTT; do not claim a specific RTT change unless captured. Do not claim adaptive rerouting.
4. **Loss:** restore quality, then inject 0 ms / 10% loss. Confirm real random-loss settings on both endpoints and loss in actual h1→h2 results. After bounded traffic samples, check measured TC directional loss separately from configured probability and from end-to-end unanswered ICMP percentage. They need not be equal, particularly with loss in both directions. RTT remains N/A in the per-link health card.
5. **Combined:** inject +80 ms / 5% loss and confirm actual kernel readback, operational UP, automatic classification under current thresholds, and transition history. Repeating the same injection must not accumulate delay or create a duplicate health incident every poll.
6. **Restore and confirmation:** restore quality. Check both endpoints return to original 5 ms / 0% loss, HTB remains 10 Mbps, and one netem child remains. Confirm UNKNOWN initially, then HEALTHY only after sufficient measured egress packets in both directions over a valid window. A selected unused link may correctly remain UNKNOWN. Confirm transition history/event logs. Repeat clear and clear-all; a healthy unmodified network must not become an error.
7. **Hard regression:** inject a real DOWN failure on a selected ISL. Confirm API/interface DOWN and health UNKNOWN with no observed quality claim. Restore hard state; confirm health reevaluation, not automatic HEALTHY. Also test DOWN→UP between polls. If soft impairment was retained, it should again classify from fresh kernel readback until separately cleared. Existing controller behavior/Phase 3/4 semantics must remain unchanged.
8. **Partial failure:** safely make a previously impaired link DOWN, then clear all quality. Expect a truthful partial error naming that link; other valid UP targets should restore. Hard-restore the target and retry quality clear. Do not stop the worker merely to manufacture a successful result.
9. **Ownership/lifecycle:** capture a runtime ID/revision, stop/start or switch Mesh→Diamond, and attempt a quality mutation with the old values: 409. Confirm four current ISLs, no stale Mesh records/impairment, and no old WS generation updates. Repeat injection/clear on Diamond; switch back and verify fourteen ISLs. Restarting must not leak impairment.
10. **No traffic and reconnect:** stop traffic, wait for the observation window to expire, and confirm no unsupported HEALTHY claim on idle links. Disconnect/reconnect the browser WS or refresh; current health must rehydrate, IDs remain in technical disclosure, and errors/stale samples cannot masquerade as success.
11. **Existing experiments:** clear quality and verify baseline first, then run the existing hard-failure experiment workflow. Confirm accounting, cancellation/target-only cleanup, reports and service intent behavior remain unchanged. Do not claim a soft experiment was executed.

Preserve real API/TC/OVS/traffic evidence and manual results separately from generated fixtures. Phase 5's reported live validation is complete. Bounded post-failure service verification, controller processing time, qdisc observation window, and local Fast Failover switching time remain different quantities.
