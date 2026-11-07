# Phase 4 — Intent-Aware Recovery Evaluation

Implementation base: `tushar-fixes`, `c46d95d feat: add recovery verification engine`.

## Purpose and boundaries

**Recovery VERIFIED does not necessarily mean Service Intent SATISFIED.**

Phase 3 independently measures and classifies bounded post-failure service evidence using its existing generic rules. Phase 4 compares that evidence against the policy captured for the affected traffic job. For example, 32 ms successful-reply average RTT can pass Phase 3's generic 100 ms limit while violating an intent's 25 ms limit.

“Intent-Aware Healing” here means intent-aware recovery evaluation and policy context. Adaptive routing/recovery selection is future work. This implementation does not enforce QoS, reserve bandwidth, change forwarding, select controllers adaptively, guarantee SLAs, or claim AI/ML. Priority is metadata only. Controller scripts, topology definitions, worker accounting, loss/RTT calculation, and Phase 3 classification/thresholds are unchanged.

Computed path != installed path != observed dataplane path.

Verification duration is the duration of the verification workflow, not controller recovery time, exact outage duration or local Fast Failover switching time. Intent evaluation adds no independent packet measurement or path observation.

## Architecture and audited integration

The existing architecture was inspected before implementation: FastAPI routes, the traffic service, Mininet client's runtime/job ownership, worker accounting, RecoveryVerificationEngine and configuration, controller generations, experiment cancellation and cleanup, SQLite initialization, report generation, WebSocket initial snapshots, guarded Zustand updates, traffic draft persistence, shared UI primitives, and existing unit/browser fixtures.

```text
Traffic Monitor / Experiment Lab intent draft
  -> traffic/start or experiments/run (validated IntentSelection)
  -> server resolves profile / validates custom policy
  -> MininetClient captures immutable intent snapshot in job owner
  -> confirmed link failure starts the existing Phase 3 observation
  -> RecoveryVerification includes captured policy and job sequence metadata
  -> Phase 3 publishes its unchanged recovery classification
  -> independent IntentEvaluationEngine consumes a copy
  -> requirement comparisons + own aggregate state
  -> SQLite / INTENT_EVALUATION WebSocket / current REST snapshot
  -> reusable intent card, experiment history, Analytics and reports
```

The evaluator consumes completed Phase 3 fields, rather than lifetime traffic totals, controller logs, computed routes or historical recovery timings. No new ping process or worker command was introduced. Job sequence metadata additionally prevents a previous experiment's result from becoming current for a later manual traffic job.

## Model and demonstration profiles

Built-in thresholds are **project demonstration defaults, not universal SLA standards**. They are defined once on the backend and loaded by the editor through the profiles API.

| Profile ID | Name | Priority metadata | Reachability required | Maximum loss | Maximum successful-reply average RTT |
|---|---|---|---|---|---|
| standard | Standard | NORMAL | Yes | 5% | 100 ms |
| interactive | Interactive / Low Latency | HIGH | Yes | 1% | 25 ms |
| reliable | Reliable | CRITICAL | Yes | 0% | 100 ms |
| bulk | Bulk / Throughput-Tolerant | LOW | Yes | 10% | 250 ms |
| custom | User-supplied name | LOW/NORMAL/HIGH/CRITICAL | Configurable | Optional | Optional |

`ServiceIntent` includes `profile_id`, `name`, `priority`, `require_reachability`, `max_loss_percent`, and `max_avg_rtt_ms`. A numeric threshold of null means that requirement is omitted. Reachability false means no reachability requirement, not an instruction to expect failure. At least one requirement must be configured.

Loss must be finite and between 0 and 100 inclusive. RTT must be finite, greater than zero and at most 60,000 ms. Names must contain non-whitespace text and be at most 80 characters. Priority and profile IDs are explicit enums; unknown fields and incomplete custom policies are rejected. Built-in overrides are rejected: select Custom instead. Invalid values are never clamped. Intent-enabled routes return JSON-safe HTTP 422 validation details, including for non-standard NaN/Infinity input.

Requests select a built-in with `{"profile_id":"interactive"}` or custom with `{"profile_id":"custom","custom":{...complete ServiceIntent...}}`, under `service_intent`. For backward-compatible new API jobs that omit this optional field, the server captures Standard. Older persisted records are not assigned a profile retroactively.

## Lifecycle and comparisons

Only configured requirements appear in `requirements`. Each contains `target`, `actual`, `unit`, and PASS / FAIL / UNAVAILABLE. Reachability compares an actual boolean with true. Numeric comparisons use `actual <= target`, including equality. RTT uses successful-reply average RTT from Phase 3.

| Phase 3 state/evidence | Phase 4 behavior |
|---|---|
| No incident | Current REST returns null; UI NOT EVALUATED / N/A |
| VERIFYING | EVALUATING / VERIFICATION_PENDING; no partial satisfied result |
| NOT_STARTED / no active traffic | UNAVAILABLE / NO_ACTIVE_TRAFFIC; no inferred measurements |
| VERIFIED, DEGRADED or FAILED with evidence | Evaluate configured requirements independently |
| Reachability required; measured reachability_restored is false | VIOLATED, even when RTT is unavailable |
| Any configured requirement has a valid FAIL | VIOLATED; known failure takes precedence over unavailable requirements |
| No FAIL, but a configured requirement lacks valid evidence | UNAVAILABLE / EVIDENCE_UNAVAILABLE |
| All configured requirements pass | SATISFIED / INTENT_SATISFIED |
| Historical evidence without captured policy | UNAVAILABLE / INTENT_UNAVAILABLE |
| Replaced runtime/controller/job | Excluded from current; preserved in history |

Missing reachability remains null; it is not false. Missing RTT/loss remains null; it is not zero. No-active-traffic and pending states do not consume leftover successful values as final evidence. DEGRADED does not automatically mean intent violation: a more tolerant policy can pass actual measured values. Likewise, Phase 4 does not overwrite a Phase 3 FAILED or VERIFIED status.

Reason codes include INTENT_SATISFIED, REACHABILITY_REQUIREMENT_FAILED, LOSS_THRESHOLD_EXCEEDED, RTT_THRESHOLD_EXCEEDED, MULTIPLE_REQUIREMENTS_FAILED, EVIDENCE_UNAVAILABLE, INTENT_UNAVAILABLE, VERIFICATION_PENDING and the Phase 3 no-start reason such as NO_ACTIVE_TRAFFIC.

## Identity, snapshots and provenance

Each evaluation retains verification ID/status, job ID/sequence, runtime ID/revision, topology, controller mode/generation, experiment ID, host pair, failed link, failure timestamp, policy snapshot, requirement actuals/targets, evidence timestamps, and evaluation created/completed timestamps. The stable evaluation ID is derived from the unique verification ID. EVALUATING transitions update the same record and preserve its creation timestamp.

**Intent evaluation uses measured post-failure evidence produced by the Recovery Verification Engine.** Its `measurement_source` and `evidence` explicitly preserve that provenance.

Frontend drafts are separate from job/result telemetry. Traffic and experiment intent drafts are independent and survive page navigation. Editing a profile after starting a job changes the next request, not the captured job policy. Existing source/destination/interval/packet-count persistence is retained. Backend current-state checks require the matching Phase 3 incident and runtime, valid owner generation and latest job sequence. UI REST/WS handling also rejects stale runtimes, revisions, controller generations, earlier jobs, earlier incidents, malformed messages, late pending transitions and responses superseded by newer WS state. Lifecycle changes clear current intent while leaving historical records intact.

## REST and WebSocket

| Endpoint | Behavior |
|---|---|
| GET `/api/intents/profiles` | Four backend demonstration profiles |
| POST `/api/intents/validate` | Validate a selection and return its resolved snapshot; does not mutate a job |
| GET `/api/intents/evaluation/current` | Owned current evaluation or null |
| GET `/api/intents/evaluation/history?limit=50` | Stored incident evaluations; limit 1–500 |
| GET `/api/intents/evaluation/{evaluation_id}` | Stored evaluation, or HTTP 404 |

Existing traffic and experiment POSTs accept optional `service_intent`. Operation failures retain existing truthful HTTP semantics. `INTENT_EVALUATION` carries the evaluation and runtime identity independently of `RECOVERY_VERIFICATION`. `INITIAL_STATE.intent_evaluation` hydrates reconnects. Three-second REST fallback uses guarded requests; live transitions are delivered through WebSocket.

## Persistence, experiments, reports and UI

Application database initialization safely creates `intent_evaluations` if missing, with evaluation ID primary key, verification/runtime identity, creation timestamp and full JSON. It adds a history index and logs evaluation transitions in existing SYSTEM event logs. Existing experiment rows/schema/history are not rewritten. Persistence failures are logged and exposed through `persistence_error`; a memory result is not proof of durable storage. No manual live-database migration was executed during implementation.

ExperimentRunner freezes the request before awaiting preparation; each comparison child captures the same selected policy. Experiment summaries retain `service_intent` and matching `intent_evaluation`, alongside the independent `verification`. Finalization captures the evaluation before restoring the experiment's link. Existing cancellation, exact-owner traffic cleanup and target-only link restoration remain intact.

The shared editor appears in Traffic Monitor and Experiment Lab. The shared intent card complements Recovery Verification in Traffic Monitor, NOC Overview, Failure Simulator and Experiment Lab. Historical experiment details and Analytics show stored cards; old records show N/A. Displayed requirement numbers have at most two decimal places with trailing zeros removed, without changing evidence or backend classification.

Analytics summarizes only loaded experiment records in the selected topology filter. It reports recorded evaluations, satisfied/violated/unavailable counts, per-requirement failures, and satisfied rate among SATISFIED + VIOLATED records. Old, pending and unavailable records do not enter the rate denominator. These are loaded experiment-history statistics, not lifetime network guarantees or an aggregate of every manual incident.

JSON preserves separate verification, policy snapshot and intent evaluation. CSV adds distinct intent status/reason/profile, snapshot JSON, requirement JSON and provenance IDs/source. HTML has separate recovery and intent sections, requirement targets/actuals/results, and escapes custom policy text. Older report records show N/A rather than a manufactured result.

## Exact implementation inventory

Added source/tests:

- `backend/models/intent.py`
- `backend/services/service_intent.py`
- `backend/api/intents.py`
- `backend/api/intent_route.py`
- `backend/tests/test_service_intent.py`
- `frontend/src/services/intent.ts`
- `frontend/src/stores/intentConfigurationStore.ts`
- `frontend/src/components/ServiceIntentEditor.tsx`
- `frontend/src/components/ServiceIntentCard.tsx`
- `frontend/tests/intent.test.tsx`
- `frontend/tests/intentFixture.ts`

Modified source/tests:

- `backend/models/schemas.py`
- `backend/models/verification.py` (additive policy/job-sequence metadata only)
- `backend/services/mininet_client.py` (job metadata only)
- `backend/services/traffic_service.py`
- `backend/services/recovery_verification.py` (snapshot/publication integration only)
- `backend/services/experiment_runner.py`
- `backend/services/report_generator.py`
- `backend/database/db.py`
- `backend/api/traffic.py`
- `backend/api/experiments.py`
- `backend/main.py`
- `frontend/src/services/api.ts`
- `frontend/src/stores/sdnStore.ts`
- `frontend/src/App.tsx`
- `frontend/src/index.css` (scoped Service Intent card presentation)
- `frontend/src/components/RecoveryVerificationCard.tsx` (RTT label only)
- `frontend/tests/metric-truthfulness.test.tsx`
- `frontend/tests/recovery-verification.test.tsx`
- `frontend/src/pages/TrafficView.tsx`
- `frontend/src/pages/ExperimentLabView.tsx`
- `frontend/src/pages/AnalyticsView.tsx`
- `frontend/src/pages/OverviewView.tsx`
- `frontend/src/pages/FailureSimulatorView.tsx`
- `frontend/tests/multipath-mesh.browser.mjs`
- `frontend/tests/traffic-configuration.browser.mjs`

This report and its automated validation/browser evidence are added under `reports/intent-aware-healing/`. `data/sdn_dashboard.db` was already modified before this task and was not intentionally edited by this implementation.

## Final commit-readiness cleanup scope

This final cleanup changes only these seven documentation/source/test files, plus refreshed generated validation evidence in this report directory:

- `reports/intent-aware-healing/PHASE-4-INTENT-AWARE-HEALING.md`: live results, validation provenance and final regression record.
- `frontend/src/pages/TrafficView.tsx`: Overall Job Avg RTT label only.
- `frontend/src/components/RecoveryVerificationCard.tsx`: Post-Recovery Avg RTT label only.
- `frontend/src/components/ServiceIntentCard.tsx`: Post-Recovery Avg RTT requirement label only.
- `frontend/tests/metric-truthfulness.test.tsx`: overall-job label assertion.
- `frontend/tests/recovery-verification.test.tsx`: post-recovery label assertion.
- `frontend/tests/intent.test.tsx`: matching requirement-label assertion.

Backend logic, controller scripts, topology definitions, Phase 3 classification, intent policies and evaluation semantics were not changed by this cleanup. The broader implementation inventory above includes earlier Phase 4 work already present at the start of finalization. The existing runtime database remains unstaged and outside the code change.

## Automated validation

Tests use temporary SQLite databases and controlled SDN IO; browser fixtures serve the actual production bundle against isolated fixture HTTP/WebSocket data. They do not contact the live SDN backend.

| Check | Final result |
|---|---|
| Complete backend unittest discovery after listener-test synchronization fix | Two fresh runs: 233 passed each, 0 failures/errors |
| Phase 4 backend module | 30 passed, including inherited Mesh regressions |
| Complete frontend suite, 14 bundled files | 117 passed, zero failures/skips |
| Phase 4 frontend tests | 19 passed within the complete suite |
| Application TypeScript (`tsc -b`, through production build) | PASS |
| Test-source TypeScript (`tsc --ignoreConfig --noEmit ...`) | PASS, no diagnostics |
| Production build (`npm run build`) | PASS |
| Production Mesh/intent hidden Edge fixture | PASS, 6 check groups, zero browser console errors |
| Production traffic configuration hidden Edge fixture | PASS, 8 check groups, zero browser console errors |
| `git diff --check` | PASS, exit 0; existing Git line-ending advisories are not whitespace errors |

Reproduction commands (Ubuntu-22.04 WSL, repository root unless specified):

```sh
/home/i7__6thgen/sdn-env/bin/python3 -m unittest discover -s backend/tests
/home/i7__6thgen/sdn-env/bin/python3 -m unittest backend.tests.test_service_intent
# frontend/ with Node v24.22.2 on PATH:
node node_modules/rolldown/bin/cli.mjs tests/*.test.ts tests/*.test.tsx --platform node --format esm --dir node_modules/.tmp/phase4
# Pass the 14 generated *.test.js paths explicitly to Node:
node --test --test-concurrency=1 <explicit bundled test paths>
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports --jsx react-jsx tests/*.test.ts tests/*.test.tsx
npm run build
```

The bundled files are controller-exit, experiment-cleanup, intent, metric-truthfulness, motion, multipath-mesh, redesign, request-id, runtime-errors, telemetry-ownership, topology, traffic-accounting, traffic-configuration and recovery-verification. Full output is saved in `backend-test-output.txt`, `intent-test-output.txt`, `frontend-test-output.txt`, `typescript-test-output.txt` (empty means no diagnostics), and `production-build-output.txt`. Backend logs include intentionally injected worker/operation/persistence errors from negative tests; these are not live-runtime failures. Vite retains its existing large-chunk advisory; no code-splitting refactor was introduced.

Historical pre-fix finalization timing note: the first complete backend run, concurrent with the frontend build, ran 233 tests with two failures: `ControllerExitTests.test_listener_loss_detected_without_process_exit_or_repeated_alert` and `LocalDataplaneEvidenceTests.test_real_loopback_replies_verify_without_changing_job_counters`. Both passed unchanged in isolation (2/2). The next complete serial run passed 232/233, with the listener-loss check failing again; the loopback check passed. One final unchanged complete run was then performed. Logs are retained as `backend-initial-concurrent-output.txt`, `backend-timing-recheck-output.txt`, `backend-serial-recheck-output.txt` and the historical `backend-test-output.txt`. The listener test used a fixed 1.1-second sleep; those initial results suggested timing/scheduling sensitivity but did not yet establish its cause. During those pre-fix attempts, no timing assertion, controller behavior, verification threshold or classification rule was altered. The existing loopback tests use real Linux ping on loopback, not Mininet.

The historical final unchanged full run also passed 232/233, with only `backend/tests/test_controller_exit.py:147` (`test_listener_loss_detected_without_process_exit_or_repeated_alert`) failing: expected controller status FAILED, actual READY after the fixed wait. The loopback recovery test passed in both serial runs. That earlier finalization gate was not fully green; its logs remain preserved rather than being overwritten by later success.

### Listener regression resolved by deterministic test synchronization

Subsequent investigation reproduced the unchanged test failing 3 of 20 isolated runs and isolated the cause with a controlled scheduler stall: the test's 1.1-second sleep resumed before the watcher's 1-second wait_for timeout had completed cancellation processing. The watcher then correctly transitioned and broadcast FAILED without explicit reconciliation. No production lifecycle failure, stale READY overwrite or shared-state leak was needed to reproduce the flake.

The existing test now awaits the real generation-matched FAILED notification with a bounded watchdog, then retains the exact FAILED and single-alert assertions. It additionally checks the live process, exact listener-loss reason and STARTING -> READY -> FAILED sequence. No controller behavior, poll interval, Recovery Verification rule or intent semantics changed. The corrected test passed 20/20 repeated isolated runs, followed by two complete fresh-process backend runs of 233/233. See [the investigation and evidence](../controller-listener-regression/CONTROLLER-LISTENER-REGRESSION.md), including both complete run logs. The earlier `backend-test-output.txt` in this directory is historical pre-fix evidence; current full-suite evidence is `../controller-listener-regression/backend-run-1-output.txt` and `backend-run-2-output.txt`.

Final Windows hidden Edge fixture commands, from `frontend/`:

```powershell
$env:SDN_QA_OUTPUT='../reports/intent-aware-healing/mesh-browser'
node tests/multipath-mesh.browser.mjs
$env:SDN_QA_OUTPUT='../reports/intent-aware-healing/traffic-browser'
node tests/traffic-configuration.browser.mjs
```

Both fixtures passed against the final production build. Machine-readable results are in `mesh-browser/browser-evidence.json` and `traffic-browser/browser-evidence.json`; the Mesh directory also contains five production-bundle screenshots, including `intent-verified-but-violated-fixture.png`. These are controlled fixture evidence, not live Mininet measurements. Final repository status is saved verbatim in `git-status-short.txt`; the existing modified live database is explicitly outside this implementation's changes. Branch and HEAD remain unchanged, with no commit/push/merge/reset.

Coverage includes all-pass/RTT/loss/reachability/multiple failures, null and non-finite evidence, threshold boundaries, no traffic, pending/FAILED/DEGRADED states, independent VERIFIED + VIOLATED classification, validation including NaN/Infinity HTTP errors, immutable job/custom snapshots, persistence reconstruction/errors, stale runtime/revision/controller/job ownership, API status codes, all three controller modes on both topology fixtures, experiment cleanup, old records, separate report formats and HTML escaping. Frontend coverage includes profile/editor rendering, validation, request capture, independent persistent drafts, target/actual rendering, clean formatting, N/A, simultaneous recovery/intent states, stale WS/REST/reconnect handling, lifecycle clearing and honest Analytics denominators.

Existing Phase 1–3 regression tests remain included. Browser fixtures cover native Mesh UI controls, 9 switches/16 links, custom intent editing/request submission and VERIFIED + VIOLATED rendering, experiment history/Analytics, switching back to Diamond/Baseline, and traffic configuration persistence for 500/1000/300 packets through real page remounts.

## Real manual Mininet validation (user-observed)

The following three scenarios were manually validated on the real Mininet runtime and supplied by the project owner during finalization. These are live results, distinct from the isolated automated fixtures above. This cleanup documents those observations; it did not rerun or infer the live measurements.

All three runs used Multi-Path Mesh, h1 -> h2 traffic and failure of s2-s5. RTT values below are the bounded post-failure Recovery Verification window's successful-reply averages, not the overall traffic-job average. Exact supplied measurements are retained here; UI formatting is display-only.

### 1. Reactive + Standard: SATISFIED

Recovery Verification: **VERIFIED**. Post-recovery Tx/Rx: **38/38**. Loss: **0%**. Exact average RTT: **32.03684210526316 ms** (UI: **32.04 ms**).

| Requirement | Target | Actual | Result |
|---|---|---|---|
| Reachability | Required | Restored (true) | PASS |
| Packet loss | <= 5% | 0% | PASS |
| Post-Recovery Avg RTT | <= 100 ms | 32.03684210526316 ms | PASS |

Service Intent: **Standard / SATISFIED**. Reason: **INTENT_SATISFIED**.

### 2. Reactive + Interactive / Low Latency: VIOLATED

Recovery Verification: **VERIFIED**. Post-recovery Tx/Rx: **36/36**. Loss: **0%**. Exact average RTT: **36.27222222222221 ms** (UI: **36.27 ms**).

| Requirement | Target | Actual | Result |
|---|---|---|---|
| Reachability | Required | Restored (true) | PASS |
| Packet loss | <= 1% | 0% | PASS |
| Post-Recovery Avg RTT | <= 25 ms | 36.27222222222221 ms | FAIL |

Service Intent: **Interactive / Low Latency / VIOLATED**. Reason: **RTT_THRESHOLD_EXCEEDED**.

This live run demonstrates the central Phase 4 distinction: **Recovery VERIFIED does NOT necessarily mean Service Intent SATISFIED.** Generic recovery verification passed while the selected service's RTT requirement failed. No fallback metric or threshold change is needed to explain this result.

### 3. Baseline + Standard: VIOLATED

Recovery Verification: **FAILED**. Post-recovery Tx/Rx: **35/0**. Loss: **100%**. Post-recovery RTT: **unavailable**, not zero.

| Requirement | Target | Actual | Result |
|---|---|---|---|
| Reachability | Required | Not restored (false) | FAIL |
| Packet loss | <= 5% | 100% | FAIL |
| Post-Recovery Avg RTT | <= 100 ms | Unavailable | UNAVAILABLE |

Service Intent: **Standard / VIOLATED**. Reason: **MULTIPLE_REQUIREMENTS_FAILED**. The explicit reachability and packet-loss failures establish violation despite unavailable RTT. This is consistent with intentional non-healing Baseline behavior.

## Additional validation scope and limitations

Live Phase 4 validation is established for the three Mesh scenarios above only. The following additional scenarios retain automated coverage; they are **not claimed as manually validated in Phase 4**:

| Scenario | Automated coverage | Manual Phase 4 status |
|---|---|---|
| No active traffic | Backend no-start/UNAVAILABLE behavior, no fabricated measurements; frontend N/A/pending states | Not reported |
| Diamond compatibility/regression | Owned service/experiment tests across both topology fixtures; browser Mesh -> Diamond/Baseline switch | Not reported |
| Experiment/report round trip | Isolated SQLite experiment history; captured policies; separate JSON/CSV/HTML recovery and intent results; old-record compatibility | Not reported |
| Stale runtime/controller/job protection | Backend current/history ownership checks and frontend WS/REST/reconnect/lifecycle regressions | Not reported |
| Fast Failover intent evaluation | Controlled controller-agnostic service/experiment fixtures | Not reported |

For any further manual confirmation, repeat these workflows against the live runtime and compare the recorded job/runtime/verification identities before documenting them as live results. In particular, verify no-active-traffic behavior without starting a probe, run a Diamond failure/recovery, reopen an experiment and its downloaded reports after changing the draft intent, and switch/reconnect runtimes while checking stale results do not become current. Fast Failover forwarding/group verification remains separate from intent policy comparison.

### RTT label clarity and card presentation

Traffic Monitor now labels cumulative traffic-job latency **Overall Job Avg RTT**. Recovery Verification and the Service Intent comparison label the bounded post-failure measurement **Post-Recovery Avg RTT**. These intentionally different averages can differ; no calculation, measurement source, generic threshold or intent policy changed.

The Service Intent card presents the profile, short human summary, requirement target/actual/status comparison and compact context. Failed requirements alone receive row highlighting. Technical provenance and research scope remain available in a collapsed Technical details disclosure. Frontend and browser regressions preserve independent recovery/intent states, numeric precision/N/A behavior and accessible textual statuses.

Built-in policies remain demonstration defaults, not universal SLA standards. The three live runs demonstrate bounded post-failure service verification and intent evaluation, not exact controller causation, exact outage duration, local Fast Failover switching latency, continuous SLA compliance or an observed forwarding path. Computed path != installed path != observed dataplane path. Verification duration must not be presented as controller recovery/failover time.

Current state remains in memory and scoped to the current incident; persisted history survives restart but is not promoted to current runtime state. Drafts survive in-app navigation, not a full browser-session reload. Existing runtime database content is not a source-code change and must remain unstaged/runtime-only.

No commit, push, merge or reset was performed. Final cleanup is limited to this documentation, wording-only RTT labels, corresponding test assertions and refreshed validation evidence.
