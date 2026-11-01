# C07 — Unexpected controller exit verification

Status: implementation ready for manual runtime verification. No live Ryu/Mininet/OVS crash test was run. C07 subprocess, listener, WebSocket, and database IO tests use fakes/mocks. Existing C06 local loopback ping tests are retained. No commit or push was made.

## Confirmed original lifecycle and root cause

Dashboard selection → `sdnStore.selectController` → `POST /api/controllers/select` → `ControllerManager.select_controller` under `_lifecycle_lock` → stop old controller → C04 orphan/port checks → checked worker dataplane reset → `start_controller`. Simulation startup used stored controller type/status to decide whether to skip selection. Ryu starts through the SDN venv's `ryu-manager`, with `--observe-links`, OpenFlow port 6653, selected script, merged stdout/stderr, and a separate process group.

The asyncio subprocess object (including PID and returncode) is stored in `self.process`. Startup checked returncode and whether any listener answered on 6653 for up to 10 seconds. There was no ongoing completion watcher or readiness reconciliation. `_stream_logs` parsed stdout/stderr events, then simply stopped on EOF. An unexpected exit therefore left stored READY unchanged. `GET /api/controllers`, `GET /api/simulation/status`, and the initial WebSocket snapshot trusted that stored status.

Mininet is managed by a separate privileged worker, so Ryu death does not imply network destruction. OVS bridges/hosts can remain, with surviving flows/groups and disconnected controller sessions. No controller supervisor/automatic restart existed.

C05 already made controller cards require READY, but there was no death event to remove READY. The navbar's simulation and WebSocket badges did not communicate separate controller health. Same-mode healthy selection already had a no-op path, and intentional stops/switches already shared the C04 lock and termination/cleanup sequence.

## New health and lifecycle design

1. `owns_listener(process)` requires the managed process to be alive and uses psutil's **per-process** listening sockets to confirm ownership of port 6653. An unrelated/global listener cannot alone make this process READY. Startup and healthy same-mode selection use that check. Failure to inspect ownership fails closed.
2. After the READY broadcast completes, one watcher is attached to that exact asyncio subprocess. It awaits `process.wait()` through a shielded task; once per second it also verifies listener ownership. This is bounded periodic inspection, not busy polling. EOF of the log reader is not treated as proof of process death.
3. Unexpected exit, including code zero, transitions controller state to FAILED, records `exit_code`/safe `failure_reason`, writes one event, and broadcasts `CONTROLLER_STATUS`. Negative returncodes identify POSIX signal termination, e.g. SIGKILL → -9. Listener loss while the process is alive also transitions to FAILED. If that process later exits, its distinct exit reason/code can be recorded; there is no repeated identical notification loop.
4. `reconcile_health` is also called by controller-list/status reads and the initial WebSocket snapshot. A confirmed-dead process cannot remain READY just because the watcher has not yet run. Reads do not stop/restart Ryu, change OVS flows, or destroy Mininet.
5. Start Simulation always passes through the shared controller selection lifecycle. Healthy same-mode selection remains a no-op, while a stale READY/dead process triggers normal C04 cleanup and an explicit replacement startup. The selected controller fallback from C02 is unchanged.

### Intentional stop and stale watcher protection

The lifecycle lock still serializes stop/switch/start. Before signalling old Ryu, `_stop_controller` marks the process as intentionally stopping, cancels and awaits its watcher, then follows existing SIGTERM/SIGKILL handling and log-reader cleanup. Backend shutdown uses this same method. Stop Simulation stops the separate Mininet network; it does not intentionally kill Ryu, so no controller crash is fabricated for that operation.

The watcher is bound to a captured process object. Failure updates verify that it is still `self.process` and is not the process marked for intentional stop. Those checks and failure-state assignments occur before the first await, atomically on the event loop. The watcher does **not** wait on the lifecycle lock: stop awaits watcher cancellation while holding that lock, so having the watcher acquire it would create a completion/cancellation lock cycle. Tests cover that race, old-process completion after a replacement, and startup READY-before-FAILED broadcast ordering.

No automatic restart is added. Listener loss remains FAILED until an explicit selection/start succeeds. Recovery stops/cleans the retained old instance through C04, resets failure details, starts fresh Ryu, confirms its listener, and returns READY.

## Simulation and API semantics

- Mininet `simulation_state` is left unchanged by a controller failure. A previously RUNNING network can correctly report `state:RUNNING`, `controller_status:FAILED`.
- `GET /api/simulation/status` and the initial WS snapshot add optional `pid`, `exit_code`, and `failure_reason` fields. Selected controller list records expose these details too. `pid` is the last/current managed PID, **not** an assertion that it is alive; use status and exit code with it.
- Existing controller statuses and HTTP route names remain. Request failures still use C05's non-2xx contract. A status GET may return 200 carrying FAILED, because reading the failed state itself succeeded.
- ControllerInfo backend/frontend types include the optional fields. No database migration or new status enum is required.
- System status's existing raw `openflow_port_active` probe is not proof of managed Ryu health; controller health now comes from the manager.

## Frontend behavior

The store tracks controller health separately from the C03 topology/simulation state. INITIAL_STATE and CONTROLLER_STATUS update it immediately; controller cards are updated before any follow-up GET. Late GETs issued before a newer WS status cannot replace it, and overlapping controller GETs use request ordering. A three-second controller polling fallback complements WS pushes.

Navbar displays controller status and, for RUNNING Mininet with FAILED Ryu, `MININET RUNNING / CONTROLLER FAILED`. Existing controller cards cease showing `ACTIVE RUNNING` when FAILED and retain the activation/retry action. The WebSocket transport badge is labelled `WS LIVE`, so a live backend connection is not presented as proof of Ryu health. Existing error display handles safe crash reasons; no popup loop or design system was added. SSR rendering tests inspect navbar/cards with current store state; these are not interactive browser tests.

## Exact files changed

| File | Purpose |
|---|---|
| `backend/services/controller_manager.py` | Owned-listener readiness, process watcher, intentional-stop/identity guards, health details and reconciliation. |
| `backend/api/simulation.py` | Shared health-aware selection on start; reconcile status and return failure details. |
| `backend/main.py` | Reconcile and include health details in initial WS snapshot; existing shutdown uses shared stop. |
| `backend/models/schemas.py` | Optional controller PID/exit/reason fields. |
| `frontend/src/types/index.ts` | Matching optional controller metadata. |
| `frontend/src/services/api.ts` | Extended simulation-status response type. |
| `frontend/src/stores/sdnStore.ts` | Separate health state, WS hydration, protection against stale READY reads. |
| `frontend/src/App.tsx` | Controller-health polling fallback. |
| `frontend/src/components/TopNavbar.tsx` | Truthful controller health and transport labels, existing styles. |
| `backend/tests/test_controller_exit.py` | Focused C07 lifecycle, ownership, status and race tests. |
| `backend/tests/test_controller_switch.py` | Existing healthy-no-op fixture now explicitly mocks owned-listener health; C04 assertions retained. |
| `backend/tests/test_runtime_errors.py` | Simulation API fixture explicitly mocks Ryu selection IO under the stronger health contract; C05 assertions retained. |
| `frontend/tests/controller-exit.test.tsx` | Store races, reconnect health, rendered failure and recovery presentation. |
| `reports/C07-CONTROLLER-EXIT-VERIFICATION.md` | This report and pending manual procedure. |

`frontend/dist` was rebuilt for FastAPI; generated files remain ignored. No controller algorithms, worker interpreter, topology, traffic accounting, experiments, cancellation, analytics, or historical data were changed.

## Automated tests and commands

C07 backend tests cover healthy startup; exit during startup/502; unexpected nonzero and zero exits; intentional stop and watcher cleanup; old watcher versus replacement READY; explicit recovery; API reconciliation before watcher execution; listener loss without repeated alerts; unrelated listener ownership; and READY-before-failure message ordering. Frontend tests cover rendered FAILED cards/navbar with RUNNING Mininet; late READY reply suppression; reconnect health; and fresh READY recovery.

Commands executed (from repository unless indicated):

```bash
~/sdn-env/bin/python3 -m unittest discover -s backend/tests -v
~/sdn-env/bin/python3 -m py_compile backend/services/controller_manager.py backend/api/simulation.py backend/main.py backend/models/schemas.py backend/tests/test_controller_exit.py backend/tests/test_controller_switch.py backend/tests/test_runtime_errors.py
cd frontend
export PATH=/home/i7__6thgen/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports --jsx react-jsx tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts
node node_modules/rolldown/bin/cli.mjs tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts --platform node --format esm --dir node_modules/.tmp/c07-tests
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c07-tests/controller-exit.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c07-tests/topology.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c07-tests/runtime-errors.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c07-tests/traffic-accounting.test.js
npm run lint
npm run build
cd ..
git diff --check
```

Installed psutil 7.2.2 supports the per-process `net_connections` API. C01 system worker startup and C02 selection are preserved by source inspection and existing lifecycle/API regressions; their earlier manual verification is not claimed as a new live run. C03, C04, C05 and C06 regression tests are retained. C08–C10 are not implemented.

Final validation results: **61 backend tests passed** (11 C07 + 50 existing C04–C06), **25 frontend tests passed** (4 C07 + 21 existing C03/C05/C06). Python compilation and application/test TypeScript checks passed. Production build passed with the existing large-chunk warning. Lint passed with **26 existing warnings and 0 errors**. `git diff --check` passed. No live Ryu/Mininet crash or browser interaction test is claimed.

## Pending manual WSL / dashboard verification

Do this later during consolidated runtime testing, with no experiment running. Reload the backend normally to load C07 and hard-refresh the rebuilt frontend. Stop/finish any earlier workload first. Do not run `mn -c` after Ryu starts. The C06 worker is unchanged and needs no C07-specific restart.

### 1. Start and establish real healthy state

```bash
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"reactive"}'
curl -i -X POST http://localhost:8000/api/simulation/start -H 'Content-Type: application/json' -d '{}'
curl -s http://localhost:8000/api/simulation/status
curl -s http://localhost:8000/api/controllers
sudo ovs-vsctl --columns=target,is_connected list Controller
sudo ovs-vsctl list-br
```

Expect RUNNING/READY, a managed PID, four bridges, and connected OVS targets on 6653. In dashboard, verify controller READY/card ACTIVE RUNNING and simulation RUNNING. Keep DevTools Network/WS messages visible.

### 2. Validate and kill only the managed Ryu PID

```bash
ryu_pid=$(curl -fsS http://localhost:8000/api/simulation/status | /usr/bin/python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["controller_status"] == "READY"; print(s["pid"])')
ps -p "$ryu_pid" -o pid=,args=
```

Inspect that exact command before proceeding: it must be this project's `ryu-manager`, with Reactive's script and port 6653. If it is not, stop the test and investigate; do not use broad `pkill`/`killall` commands.

```bash
kill -KILL "$ryu_pid"
```

This deliberately bypasses ControllerManager's normal stop intent and simulates an unexpected crash. Do not stop Mininet.

### 3. Verify all layers after death

```bash
ps -p "$ryu_pid" -o pid=,args=
curl -s http://localhost:8000/api/simulation/status
curl -s http://localhost:8000/api/controllers
sudo ovs-vsctl --columns=target,is_connected list Controller
sudo ovs-vsctl list-br
curl -s http://localhost:8000/api/topology
curl -s 'http://localhost:8000/api/events/logs?limit=20'
```

Expect process gone, controller FAILED, `exit_code:-9` and useful reason. Mininet state remains RUNNING and bridges/topology still exist; OVS controller sessions become disconnected (allow OVS to update its connection state). Dashboard should receive FAILED by WS and show the degraded Mininet-running/controller-failed label; controller card must not claim running. Without WS, allow the three-second polling fallback. Confirm the error event is not repeatedly appended on every poll. Surviving OVS forwarding/FF state may still carry traffic; absence of Ryu is not proof of total traffic loss.

### 4. Explicit recovery through C04

```bash
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"reactive"}'
curl -s http://localhost:8000/api/simulation/status
sudo ovs-vsctl --columns=target,is_connected list Controller
```

Expect a new live PID, READY, cleared failure details, checked dataplane reset before launch, OVS reconnection and healthy dashboard indication. No automatic restart should occur before this explicit request. Repeating Start Simulation with a healthy same controller must preserve the selected mode.

### 5. Intentional lifecycle regression

Through dashboard, switch Reactive → FF → Baseline and verify no unexpected-exit notification for intentionally stopped instances. Confirm C04 reset still precedes replacement launch. Stop simulation: physical Mininet stops while Ryu may intentionally remain READY under existing semantics. `POST /api/controllers/stop` and normal backend shutdown should end STOPPED without a crash event. Observe correct C05 non-2xx behavior if cleanup or startup cannot succeed; do not force dangerous OVS corruption merely to produce a failure.

## Remaining limitations

- Watcher exit notification depends on normal event-loop scheduling; listener checks run at about one-second intervals. HTTP status reads reconcile immediately when called. Frontend polling is a fallback, not a hard real-time guarantee.
- Readiness means the tracked Ryu process is alive and owns the expected listener. It does not prove OpenFlow handshake completion, application responsiveness, topology convergence, or all OVS sessions connected. Those require the manual SDN checks above.
- psutil ownership inspection must be permitted. An inaccessible listener is treated as unconfirmed/FAILED rather than assumed healthy.
- PID/reason metadata is retained for diagnosis until explicit stop/reselection; it is not an automatic process supervisor or persistent recovery mechanism across backend restarts.
- General stale telemetry, experiment cancellation/handling of controller loss, report/analytics corrections, and C08–C10 remain outside this phase.

Awaiting user review and manual runtime verification before further work.
