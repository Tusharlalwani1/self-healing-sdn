# Self-Healing SDN Control Center

## Adaptive, Intent-Aware and Verifiable Self-Healing SDN

**Course:** Computer Communication and Networks (CCN)

**Final implementation commit:** `fa2c07e` — `feat: add intent-aware adaptive healing with bounded re-healing`

An intent-aware closed-loop Self-Healing SDN platform that detects hard failures and service degradation, selects recovery using a deterministic service-aware policy, verifies actual end-to-end recovery, evaluates whether service requirements were restored, and performs bounded re-healing when justified.

The web NOC connects React + TypeScript/Vite to FastAPI, Ryu 4.34, real Mininet/Open vSwitch switches and OpenFlow 1.3. REST, WebSocket telemetry and SQLite history connect operator actions to network evidence.

```text
Network Failure / Degradation
              ↓
            Detect
              ↓
Evaluate Network State + Service Intent
              ↓
Select Recovery Candidate (within the chosen strategy)
              ↓
            Recover
              ↓
Verify Actual End-to-End Recovery
              ↓
     Evaluate Service Intent
              ↓
          Satisfied?
   YES → Complete
   NO  → Justified bounded re-healing / Best Achievable
         or FAILED / ESCALATED when recovery or safe continuation fails
```

Operators select one of four strategies. Intent-aware candidate selection and bounded re-healing belong to **Adaptive**; selecting another strategy does not enable Adaptive behavior.

## Current capabilities

| Capability | Final status |
|---|---|
| Professional web NOC: overview, topology, controllers, traffic and failure controls | Implemented |
| Diamond and Multi-Path Mesh topologies; real ICMP traffic and OVS inspection | Implemented & live validated |
| Baseline, Reactive Self-Healing and Fast Failover | Implemented; distinct recovery behavior preserved |
| Hard link failure injection, individual restoration and Restore All | Implemented & live validated |
| Recovery Verification and Service Intent evaluation | Implemented & live validated |
| Real TC delay/loss injection and soft degradation detection | Implemented & live validated |
| Full Phase 5 live Mininet validation | Completed |
| Adaptive hard-failure and soft-degradation healing | Implemented & live validated |
| Bounded closed-loop re-healing | Implemented & validated through controlled integration tests |
| Experiment Lab, Analytics, Event Logs, REST/WebSocket telemetry and SQLite history | Implemented |

Operational state (**UP/DOWN**) is separate from health (**HEALTHY/DEGRADED/CRITICAL/UNKNOWN**). An UP link can provide degraded service. UNKNOWN means insufficient evidence, not assumed health. Kernel-read configured impairment, measured TC counter evidence and measured end-to-end traffic remain distinct.

## Four controller strategies

| Strategy | Behavior |
|---|---|
| **1. Baseline** | Initial shortest-path forwarding without automatic failure recovery. An active-path failure can interrupt traffic; restoration can recover connectivity. This is intentional comparison behavior. |
| **2. Reactive Self-Healing** | Detects hard-link failure, computes an alternative and installs replacement flows. Logged processing time is not total network outage time. |
| **3. Fast Failover** | Installs OpenFlow `type=ff` groups with primary/backup buckets and `watch_port`. Local bucket selection and later controller reconciliation are different operations; local switching latency is not measured here. |
| **4. Adaptive Healing** | Considers topology, operational state, link health, available degradation evidence, the job-bound Service Intent and eligible candidates. It deterministically selects and applies a justified candidate, then verifies recovery and evaluates intent. |

No strategy guarantees zero packet loss. Inspect real OVS flows/groups and measured traffic rather than treating a controller log or HTTP 200 as proof of recovery.

## Adaptive policy and the closed loop

Phase 4 evaluates service requirements **after** recovery. Adaptive also uses the frozen Service Intent as an **input** to recovery decisions. The policy is **deterministic and project-defined**, not AI or machine learning; its profiles are demonstration requirements, not universal networking standards.

| Profile | Decision emphasis | Default measured loss / average RTT targets |
|---|---|---|
| Standard | Balanced project policy | ≤5% / ≤100 ms |
| Interactive / Low Latency | Latency-sensitive | ≤1% / ≤25 ms |
| Reliable | Loss/reliability-sensitive | 0% / ≤100 ms |
| Bulk / Throughput-Tolerant | More tolerant according to its requirements | ≤10% / ≤250 ms |
| Custom | Uses configured requirements where supported | User-configured |

Default profiles also require reachability. Priority is metadata, not QoS enforcement.

Adaptive enumerates bounded, loop-free candidates from the runtime topology, excludes DOWN links, strongly avoids CRITICAL edges, penalizes DEGRADED/UNKNOWN or missing evidence, and ranks configured risks, available measured TC loss and hop cost using intent-sensitive weights. These components are inspectable policy inputs, not predicted end-to-end RTT/loss. Actual flow installation is checked through OVS readback.

**Recovery VERIFIED does not necessarily mean Intent SATISFIED.** After each apply, the independent Recovery Verification engine collects a bounded real traffic window; Service Intent evaluates those measurements. If verification is VERIFIED but intent is VIOLATED, a fresh comparison may justify another **untried** candidate. That candidate is applied, verified again and evaluated again.

The strict limit is **three attempts per cycle**, with cooldown, no candidate reuse/oscillation, cancellation and runtime/controller/job ownership checks. A retry needs supported improvement in a failed requirement; missing evidence or an arbitrary different route does not justify one.

| Final outcome | Meaning |
|---|---|
| `SATISFIED` | Recovery VERIFIED and Service Intent SATISFIED. |
| `BEST_ACHIEVABLE` | Service recovered, but selected requirements remain unmet and no justified better untried candidate is available within the considered evidence/policy. |
| `FAILED` | Recovery verification did not pass. |
| `ESCALATED` | Safe continuation was unavailable, evidence was insufficient, ownership changed, or the attempt bound was reached. |

## Evidence and path truthfulness

```text
Computed Path != Installed Path != Observed Dataplane Path
```

A computed candidate is a routing decision. An installed recovery path describes checked forwarding rules; it is not automatically the path packets actually traversed. Observed dataplane path and path verification may correctly remain **UNAVAILABLE**. The dashboard labels these separately.

Overall Job Avg RTT/loss and bounded Post-Recovery Avg RTT/loss cover different traffic windows. Configured TC loss is not measured packet loss; additional configured delay is not measured per-link RTT. Missing evidence remains N/A/null. Verification duration is an engine duration, not exact outage duration, controller recovery time or Fast Failover switching latency.

## System architecture and topologies

```text
Windows browser: React + TypeScript / React Flow / Recharts / Zustand
                     ↕ HTTP + WebSocket (:8000)
WSL2: FastAPI — runtime ownership, Adaptive policy, verification, intent
         ↕ SQLite history           ↕ Ryu controller process
         ↕ Unix worker socket       ↕ OpenFlow 1.3 (:6653)
Privileged /usr/bin/python3 worker — Mininet + Open vSwitch + Linux TC
```

FastAPI serves the production frontend from `frontend/dist`. The worker uses **system Python `/usr/bin/python3`**; backend/Ryu use the SDN virtualenv. Ryu runs with topology observation and OpenFlow port 6653.

| Topology | Switches | Host links | Inter-switch links | Total links |
|---|---|---|---|---|
| Diamond — Basic (`diamond`) | s1–s4 | h1–s1, h2–s4 | 4 | 6 |
| Multi-Path Mesh — Advanced (`multipath_mesh`) | s1–s9 | h1–s1, h2–s9 | 14 | 16 |

```text
Diamond:                 h1 — s1 — s2 — s4 — h2
                               \— s3 —/
Hosts: h1 = 10.0.0.1, h2 = 10.0.0.2
```

The Mesh provides multiple redundant routes. Both definitions and their actual edges are shared in [topology_catalog.py](backend/services/topology_catalog.py); runtime inventory, not a fixed Diamond list, supplies link controls.

## Running the dashboard

Use the existing WSL2 Ubuntu 22.04 environment with Mininet 2.3.0, Open vSwitch 2.17.12, Python 3.10 and the Ryu 4.34/backend virtualenv. Node/npm are needed to build the frontend. The final frontend uses React 19, TypeScript and Vite. Privileged worker/OVS operations need the configured sudo access.

Build the production UI inside the configured Linux/WSL Node environment:

```bash
cd /mnt/e/Projects/self-healing-sdn/frontend  # adapt to your checkout
npm ci
npm run build
```

From the project directory in Windows PowerShell:

```powershell
.\Start-SDN-Dashboard.ps1
```

Or start directly in WSL:

```bash
cd /mnt/e/Projects/self-healing-sdn
SDN_VENV="$HOME/sdn-env" bash scripts/start.sh
```

Set `SDN_VENV` to the actual backend/Ryu virtualenv if it differs. Open `http://localhost:8000`, or the reachable WSL IP on port 8000. Environment preparation precedes launcher use; dashboard controls then manage the simulation. The worker is started lazily when simulation starts, or the backend can attach to an existing worker.

Startup performs Mininet cleanup **before** Ryu starts. Do not run `mn -c` while Ryu is running; it may terminate the controller. For diagnostics, an explicitly managed worker can be run in its own WSL terminal with `sudo /usr/bin/python3 backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock`; stop any existing worker first.

## Operator example and experiments

1. Select a topology and one of the four strategies; start simulation and check READY/running state.
2. In Traffic Monitor, select h1 → h2, an intent and sufficient traffic duration (for example 1000 packets at 50 ms).
3. For Adaptive, inspect its installed-rule path. Fail an edge on that route, or inject TC delay/loss on a relevant UP inter-switch link.
4. Compare operational/health state, candidate decision, OVS installation evidence, bounded Recovery Verification and Service Intent. Accept BEST_ACHIEVABLE when stricter requirements remain unmet without a justified alternative.
5. Restore hard links and clear quality impairment separately. Confirm fresh readback and use a new traffic run to measure restored service.

Experiment Lab automates traffic, scheduled hard failure, measurement, persistence and cleanup. All four strategies can be run individually; the existing comparison workflow compares Baseline/Reactive/Fast Failover. Analytics can group completed stored results by strategy/topology. HTML/CSV/JSON exports preserve their supported measurements; JSON retains rich Adaptive/verification/intent evidence. Null metrics are not replaced with invented success values.

## Completed validation

These are **specific validation runs, not guaranteed performance**. Configured impairment and measured results must not be interchanged.

### Phase 5 — full live Mininet validation completed

| Scenario | Real evidence |
|---|---|
| Delay degradation | +100 ms additional TC delay; link stayed UP/CRITICAL; measured end-to-end RTT rose from roughly 30–32 ms to 130.9 ms; 1000/1000 delivered. |
| Packet-loss degradation | Configured TC loss 10%; measured 1000 Tx / 893 Rx, 10.7% end-to-end loss; link stayed UP/CRITICAL. |
| Restoration | Additional impairment removed; subsequent traffic 1000/1000, 0% loss, ~32.6 ms average RTT. |
| Reactive hard-failure regression | Recovery VERIFIED; bounded 40/40, 0% loss, ~31.78 ms RTT, stability passed; path verification UNAVAILABLE. |

### Phase 6 — live and controlled evidence

All live scenarios below used Multi-Path Mesh. The first two were operator-observed manual tests; the Reliable and Reactive-isolation runs were executed by the coding agent against the real local Mininet environment.

| Scenario | Result |
|---|---|
| Adaptive hard failure, Standard, s2–s5 | Alternative installed route `h1 → s1 → s3 → s6 → s9 → h2`; Recovery VERIFIED, Intent SATISFIED, final SATISFIED. Observed dataplane path remained unavailable. |
| Adaptive soft delay, Interactive, s3–s6 | UP/CRITICAL with configured +100 ms delay; alternative installed candidate; Recovery VERIFIED, 40/40, 0% bounded loss, 31.27 ms RTT. The ≤25 ms target remained violated: **BEST_ACHIEVABLE**, correctly distinguishing recovered connectivity from unmet service requirements. |
| Adaptive soft loss, Reliable, s2–s5 | UP/CRITICAL with configured 10% TC loss; alternative installed and independently checked in OVS. Bounded recovery: **39/39, 0% loss, ~31.04 ms RTT**, VERIFIED/SATISFIED; final SATISFIED. Overall job: **1000/981, 1.9% loss, 31.928 ms average RTT**. |
| Reactive soft-loss isolation | Configured 10% loss; zero new Adaptive cycles and null current Adaptive state across 11 checks. Overall traffic 300/279, 7% measured loss. |

**Controlled integration proof, not live Mininet Attempt-2 proof:** attempt 1 VERIFIED/VIOLATED → fresh evidence justifies a different untried candidate → attempt 2 VERIFIED/SATISFIED. The test exercises real policy, cycle logic and intent evaluation with explicit worker/verification transport fixtures. Distinct verification IDs, exactly two applies and no candidate reuse are checked. A naturally occurring real-network Attempt-2 scenario was not forced or claimed.

Final Phase 6 regression: **303 backend tests** (40 focused Adaptive), **148 frontend tests** (18 focused Adaptive), application/test TypeScript checks and production build passed. Mesh/Adaptive and traffic browser fixtures passed with zero console errors. Tests cover the three-attempt bound, stale owners/results, duplicate triggers, cancellation, truthful outcomes and earlier phase regressions.

Details: [Phase 5 report](reports/soft-failure-detection/PHASE-5-SOFT-FAILURE-DETECTION.md) · [Phase 6 report and evidence categories](reports/adaptive-healing/PHASE-6-ADAPTIVE-HEALING.md).

## What differentiates the project

The project differentiates itself through the integration of these capabilities into one measurable SDN resilience workflow: hard and soft failure detection, multiple recovery strategies, deterministic intent-aware decisions, real post-recovery traffic verification, application-quality evaluation, bounded re-healing when justified and truthful evidence provenance. Simple SDN rerouting alone is not presented as a research novelty claim. Results are bounded by available evidence; service requirements are not guaranteed to be met on every topology.

## Repository and API guide

| Location | Purpose |
|---|---|
| `controller_baseline.py`, `controller_reactive.py`, `controller_ff.py`, `controller_adaptive.py` | Four Ryu strategy apps |
| `backend/api/`, `backend/services/` | REST routes, lifecycle, worker IPC, policy, verification, intent, TC health and experiments |
| `backend/database/db.py`, `data/sdn_dashboard.db` | SQLite schema/history; the database is runtime data |
| `frontend/src/`, `frontend/tests/` | NOC pages, reusable cards, state, telemetry and frontend/browser regressions |
| `backend/tests/`, `reports/` | Backend regressions and phase evidence/limitations |
| `scripts/`, `Start-SDN-Dashboard.ps1` | Environment/start/stop helpers and Windows launcher |

Open `http://localhost:8000/docs` for the generated REST schema. Important entrypoints:

| Interface | Endpoints |
|---|---|
| System / controllers | `GET /api/system/health`, `GET /api/system/status`, `GET /api/controllers`, `POST /api/controllers/select` |
| Simulation / topology | `POST /api/simulation/start`, `POST /api/simulation/stop`, `GET /api/topology/options`, `GET /api/topology`, `GET /api/topology/switch/{dpid}` |
| Hard links / traffic | `POST /api/links/down`, `POST /api/links/up`, `POST /api/links/restore-all`; `POST /api/traffic/start`, `POST /api/traffic/stop`; `GET /api/traffic/stats` |
| Soft quality | `GET /api/link-health`; `POST /api/degradation/inject`, `POST /api/degradation/clear`, `POST /api/degradation/clear-all` |
| Verification / intent | `GET /api/verification/current`, `GET /api/verification/history`; `GET /api/intents/profiles`, `GET /api/intents/evaluation/current` |
| Adaptive | `GET /api/adaptive/current`, `GET /api/adaptive/history`, `GET /api/adaptive/config`, `GET /api/adaptive/cycles/{cycle_id}`; `POST /api/adaptive/cancel` |
| Experiments / exports / logs | `POST /api/experiments/run`; `GET /api/experiments/history`, `/api/reports/{exp_id}/export?format=json`, `/api/events/logs` |
| Live updates | WebSocket `/ws/events`, with current-state hydration and REST polling fallback |

For backend regression in the configured environment: `"$HOME/sdn-env/bin/python3" -m unittest discover -s backend/tests -v`. Frontend production validation starts with `cd frontend && npm run build`; test bundles and browser fixtures are under `frontend/tests/`.

## Completed implementation phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Professional NOC / UI | DONE |
| 2 | Multi-Path Mesh Topology | DONE |
| 3 | Recovery Verification Engine | DONE |
| 4 | Service Intent Evaluation | DONE |
| 5 | Soft Failure / Network Degradation Detection | DONE |
| 6 | Adaptive Healing + Bounded Closed-Loop Re-Healing | DONE |

**Feature development is complete for the current project scope.** Work now moves to research, report writing and documentation rather than additional software features.
