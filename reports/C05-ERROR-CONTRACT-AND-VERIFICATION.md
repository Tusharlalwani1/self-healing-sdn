# C05 — Runtime error contract and manual verification

Scope: runtime success/error semantics only. No live SDN verification was performed during implementation. Automated tests mock privileged operations, socket transport, and persistence; they do exercise the actual FastAPI route/client validation boundaries. Existing historical data is preserved.

## Inspection and original error map

The following paths were traced before editing. All `backend/api/*.py`, request schemas, runtime services, and frontend callers were inspected. System health/status, report exports, experiment history/delete, and event-log reads do not initiate runtime SDN actions. Existing request/response classes do not enforce operation success: runtime routes return dictionaries without response models. Request constraints now reject malformed controls before side effects; the common runtime route boundary handles service errors.

| Action | Original route → service → operation → frontend | Where failure was lost |
|---|---|---|
| Start simulation | `POST /api/simulation/start` → controller selection if needed → `MininetClient.start_simulation` → `ensure_worker`, worker `start/build_network` → store `startSimulation` | `_send_command` accepted error dictionaries; start returned them normally; frontend promoted a 200 to RUNNING. C02 controller selection already worked. |
| Stop simulation | `POST /api/simulation/stop` → client → worker `stop/stop_network` → store | Worker swallowed `net.stop()` exceptions; bridge cleanup ignored exit codes; client converted IPC exceptions to `status:ok` and STOPPED. Store swallowed rejected stops. |
| Select controller | `POST /api/controllers/select` → manager serialized stop → C04 reset → Ryu launch → store/controllers page | C04 already raised on cleanup failure (preserved). Route mapped everything to raw-message 500. Startup marked READY even if port readiness timed out. Cards interpreted the selected ID as running even when status FAILED. |
| Fail/restore link | `POST /api/links/down`, `/up` → client → worker `set_link_status` → topology/events → store refresh | Worker returned error dictionaries; nonexistent connections could be silent Mininet no-ops; `ip link` exit status ignored. Client logged/broadcast success regardless of worker error. |
| Restore all | `POST /api/links/restore-all` → six sequential client calls → worker → store refresh | Unconditional overall `status:ok`, including error dictionaries. Exceptions could stop midway without aggregate evidence. Store swallowed rejection. |
| Start traffic | `POST /api/traffic/start` → `TrafficService.start` → client → worker `start_traffic` → store | Active job registered before worker confirmation; polling started after error dictionaries; frontend accepted HTTP 200. |
| Stop traffic | `POST /api/traffic/stop` → service/client → worker job termination | Error dictionaries accepted, service cleared active job; store swallowed errors. Kill fallback did not wait before confirming stop. |
| Worker unavailable | Any worker-dependent action → Unix socket | Exceptions became raw 500; stop became success; topology queries became empty `not_running` snapshots, hiding transport failures. |
| Stopped/invalid worker action | Client → worker dispatcher | Worker errors traveled as normal JSON/HTTP 200. Unknown commands/missing fields lacked a typed contract. Unknown hosts could raise raw exceptions. |
| Switch inspection | `GET /api/topology/switch/{dpid}` → client → `ovs-ofctl` | Unknown switches and failed OVS commands could yield successful empty lists. |
| Experiment | `POST /api/experiments/run` → shared C04 lifecycle → link restore, warmup, traffic, failure, stats, restore → store | Same unchecked worker dictionaries reused. Failure injection announced before confirmation; successful completion persisted/broadcast before final restoration. Actual exceptions already marked FAILED and re-raised. Cancellation and metric formulas are outside C05. |
| Frontend boundary | `services/api.ts` → Zustand actions → page/button handlers | Only HTTP status checked, not legacy operation error envelopes. Some actions swallowed errors. `store.error` had no visible consumer. Settings could show its cleanup success alert after a swallowed reset failure. |

## Final contract

Success preserves existing 200 JSON payloads. Runtime errors use `{"detail":{"message":"safe reason"}}`. Validation retains FastAPI's standard `detail` array. Restore failures additionally include `detail.results` with each link, status, safe message, and HTTP status for failures. No `success:true` accompanies an error.

| Condition | HTTP |
|---|---|
| Confirmed operation success; already stopped with no known simulation/socket | 200 |
| Malformed HTTP request, controller enum, nonpositive traffic count/interval | 422 |
| Invalid worker command/request | 400 |
| Stopped simulation for link/traffic/switch actions; experiment already running | 409 |
| Missing physical link, host, switch, or traffic job | 404 |
| Worker missing/refusing connections; worker startup unavailable | 503 |
| Worker timeout, operation outcome unconfirmed | 504 |
| Malformed/empty IPC response; communication error; Mininet/OVS operation failure | 502 |
| Mixed restore-all success/failure | 502 |
| All restorations fail with the same cause | That cause's status, e.g. 409/503 |
| C04 reset fails | Original typed cause (502/503/504); replacement controller is not launched |
| Ryu exits during startup or does not listen on 6653 in time | 502 |
| Unexpected internal error / missing configured controller script | 500, safe public message |

The standalone worker imports a dependency-free `operation_error.py` using system Python. Typed worker failures carry `status:error`, `error_code`, and a safe message. Client transport validation distinguishes successful delivery from successful operation. Legacy stopped/error dictionaries are rejected too. Raw exceptions stay in server logs, not HTTP/WS error details. Successful individual link operations remain committed if another restore fails; there is no fabricated rollback.

Frontend errors reject promises, preserve unconfirmed state, and appear in a dismissible alert using the existing error store and existing styling. Partial restore refreshes actual topology. Controller selection failure refreshes backend status; controller cards only claim running when READY. C03 topology merge remains unchanged.

## Automated validation commands

In WSL, from `/mnt/e/Projects/self-healing-sdn`:

```bash
~/sdn-env/bin/python3 -m unittest discover -s backend/tests -v
~/sdn-env/bin/python3 -m py_compile backend/api/runtime_route.py backend/api/controllers.py backend/api/experiments.py backend/api/links.py backend/api/simulation.py backend/api/topology.py backend/api/traffic.py backend/models/schemas.py backend/services/operation_error.py backend/services/mininet_client.py backend/services/mininet_worker.py backend/services/controller_manager.py backend/services/experiment_runner.py backend/services/traffic_service.py backend/tests/test_runtime_errors.py
git diff --check
cd frontend
export PATH=/home/i7__6thgen/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports tests/runtime-errors.test.ts tests/topology.test.ts
node node_modules/rolldown/bin/cli.mjs tests/runtime-errors.test.ts tests/topology.test.ts --platform node --format esm --dir node_modules/.tmp/c05-tests
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c05-tests/runtime-errors.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c05-tests/topology.test.js
npm run lint
npm run build
```

Absolute test paths avoid a relative-path resolution issue observed with the installed Node runner. No dependencies were added.

Recorded validation: backend **37 passed** (20 C05 + 17 unchanged C04); frontend **10 C05 + 8 C03 passed**; application/test TypeScript checks passed; Python compilation passed; lint **26 warnings, 0 errors**; production build passed (existing large-chunk warning); `git diff --check` passed. These are mocked/static/build results, not physical SDN or browser interaction results.

## Changed files

- `backend/services/operation_error.py`: shared safe typed errors and worker-result validation.
- `backend/api/runtime_route.py`: common HTTP mapping, retaining FastAPI validation errors.
- `backend/api/controllers.py`: controller routes use the common boundary.
- `backend/api/simulation.py`: simulation routes use the boundary; C02 selection remains intact.
- `backend/api/topology.py`: propagate worker/OVS query failures.
- `backend/api/links.py`: link errors and restore-all aggregate outcomes.
- `backend/api/traffic.py`: traffic routes use the common boundary.
- `backend/api/experiments.py`: propagate runtime failures without raw exceptions.
- `backend/models/schemas.py`: controller/input constraints before side effects.
- `backend/services/mininet_client.py`: checked IPC responses, truthful lifecycle failures and events.
- `backend/services/mininet_worker.py`: typed errors, physical link validation, checked commands and stop confirmation.
- `backend/services/controller_manager.py`: safe errors and startup readiness confirmation; shared C04 lifecycle preserved.
- `backend/services/traffic_service.py`: register active job only after successful start.
- `backend/services/experiment_runner.py`: confirmed failure injection/restoration before success reporting; safe errors.
- `frontend/src/services/api.ts`: parse safe messages; reject non-2xx and legacy failure envelopes.
- `frontend/src/stores/sdnStore.ts`: reject failed runtime actions, refresh partial/controller state, preserve error details.
- `frontend/src/App.tsx`: display/dismiss the existing store error.
- `frontend/src/components/TopNavbar.tsx`: handle rejected button/dropdown actions.
- `frontend/src/pages/ControllersView.tsx`: claim running only for READY; show failed status/retry.
- `frontend/src/pages/ExperimentLabView.tsx`: handle rejected cancellation request (cancellation behavior unchanged).
- `frontend/src/pages/FailureSimulatorView.tsx`: handle rejected runtime button actions.
- `frontend/src/pages/OverviewView.tsx`: handle rejected stop/restore actions.
- `frontend/src/pages/TopologyView.tsx`: handle rejected link/restore actions.
- `frontend/src/pages/TrafficView.tsx`: handle rejected stop action.
- `backend/tests/test_runtime_errors.py`: focused HTTP/client/worker regressions.
- `frontend/tests/runtime-errors.test.ts`: focused API/store regressions.
- `reports/C05-ERROR-CONTRACT-AND-VERIFICATION.md`: original error map, contract, validation, and manual procedures.

`frontend/dist` was rebuilt for FastAPI; generated build files are ignored by the repository.

## Manual WSL verification

These are procedures to execute, **not recorded live test results**. Use browser DevTools Network and Console alongside the dashboard; save HTTP status/body and direct OVS output. Port defaults to 8000.

### Preparation: load updated backend, frontend, and worker

Finish/cancel any existing experiment through the existing workflow. Stop simulation with the existing API, then stop the running backend normally with Ctrl+C. An already-running privileged worker retains its old code until restarted. List only this project's worker:

```bash
pgrep -af '^/usr/bin/python3 /mnt/e/Projects/self-healing-sdn/backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock$'
```

If listed, terminate the displayed **worker PID** with `sudo kill -TERM <worker_PID>` and wait for it to exit. Do not kill unrelated Python processes. Do not run `mn -c`. Start the backend again:

```bash
cd /mnt/e/Projects/self-healing-sdn
~/sdn-env/bin/python3 -m backend.main
```

Use a second WSL terminal for commands below. Hard-refresh `http://localhost:8000` to load the rebuilt `frontend/dist`.

### A — Normal success

```bash
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"baseline"}'
curl -i -X POST http://localhost:8000/api/simulation/start -H 'Content-Type: application/json' -d '{}'
curl -s http://localhost:8000/api/simulation/status
curl -s http://localhost:8000/api/topology
sudo ovs-vsctl list-br
sudo ovs-vsctl get-controller s1
sudo ovs-vsctl get Bridge s1 protocols
sudo ovs-vsctl --columns=target,is_connected list Controller
pgrep -af 'mininet_worker.py|ryu-manager'
curl -i -X POST http://localhost:8000/api/traffic/start -H 'Content-Type: application/json' -d '{"src":"h1","dst":"h2","interval":0.05,"count":40}'
```

Expect 200/`status:ok`, RUNNING, Baseline retained, four bridges, OpenFlow13, controller target 6653 connected, and real traffic. Repeat start from STOPPED using the dashboard Start button. Check errors are absent and loading ends. Test a real link DOWN/UP from Failure Simulator and confirm both interfaces using topology's `src_intf`/`dst_intf` and `sudo ip -br link`; for host interfaces use that host's namespace rather than the root namespace. Successful restore-all must return six successful entries.

### B — Stopped state

```bash
curl -i -X POST http://localhost:8000/api/simulation/stop
curl -i -X POST http://localhost:8000/api/links/down -H 'Content-Type: application/json' -d '{"node1":"s1","node2":"s2"}'
curl -i -X POST http://localhost:8000/api/traffic/start -H 'Content-Type: application/json' -d '{}'
curl -i -X POST http://localhost:8000/api/links/restore-all
```

Expect stop 200, subsequent actions 409 with meaningful details (restore includes six failures). Dashboard remains stopped with no fabricated traffic/link success. Disabled controls can be checked using the same request via DevTools; do not change UI code to bypass disabling.

### C — Invalid link and request

Restart simulation before testing link existence:

```bash
curl -i -X POST http://localhost:8000/api/simulation/start -H 'Content-Type: application/json' -d '{}'
curl -i -X POST http://localhost:8000/api/links/down -H 'Content-Type: application/json' -d '{"node1":"s1","node2":"s4"}'
curl -i -X POST http://localhost:8000/api/links/up -H 'Content-Type: application/json' -d '{"node1":"s99","node2":"s1"}'
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"invalid"}'
curl -i -X POST http://localhost:8000/api/traffic/start -H 'Content-Type: application/json' -d '{"count":-1}'
```

Expect 404 for nonexistent physical links and 422 for malformed controls, without success logs or synthetic link changes.

### D — Temporary worker unavailability and recovery

Run while simulation is RUNNING and no experiment is active. This temporarily renames the existing Unix socket; the worker/network remain alive. **Do not start/reset simulation while the socket is moved**, since worker startup can create a replacement socket. Only perform the specified link action. The subshell trap restores the same socket automatically:

```bash
(
  set -eu
  sock=/tmp/mininet_worker.sock
  held=/tmp/mininet_worker.sock.c05-held
  test -S "$sock" && test ! -e "$held"
  sudo -v
  trap 'if test -S "$held" && test ! -e "$sock"; then sudo mv -T -- "$held" "$sock"; fi' EXIT
  trap 'exit 1' HUP INT TERM
  sudo mv -T -- "$sock" "$held"
  curl -i -X POST http://localhost:8000/api/links/up -H 'Content-Type: application/json' -d '{"node1":"s1","node2":"s2"}'
  read -r -p 'Try one dashboard link action; expect an error alert. Press Enter to restore IPC: ' c05_reply
)
curl -i -X POST http://localhost:8000/api/links/up -H 'Content-Type: application/json' -d '{"node1":"s1","node2":"s2"}'
curl -s http://localhost:8000/api/topology
```

Expect 503 while hidden; no successful requested state change. After the subshell exits, expect 200 and topology refresh. If the shell is forcibly killed and the trap cannot run, check no replacement socket exists and restore with `sudo mv -T -- /tmp/mininet_worker.sock.c05-held /tmp/mininet_worker.sock`. Never overwrite a newly created socket; first identify the running workers. No bridges, processes, or DB rows are deleted by this probe.

### E — Restore-all partial failure

All six configured links are valid in the fixed diamond. Forcing just one restoration to fail would require tampering with live interfaces/OVS. Use `test_partial_restore_has_five_successes_one_failure_and_502` instead: the real HTTP/client path attempts all six, records five successes and one failure, and returns 502 with `detail.results`. The frontend test rejects that response and refreshes the actual partial topology. This is automated evidence, not a claimed physical partial-failure run.

### F — C04 switch failure propagation and recovery

Ensure RUNNING with Baseline first. Do not run an experiment during this test. The intentional switch failure stops the old controller, so traffic can be interrupted until recovery. It never starts a replacement without successful C04 cleanup.

```bash
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"baseline"}'
(
  set -eu
  sock=/tmp/mininet_worker.sock
  held=/tmp/mininet_worker.sock.c05-held
  test -S "$sock" && test ! -e "$held"
  sudo -v
  trap 'if test -S "$held" && test ! -e "$sock"; then sudo mv -T -- "$held" "$sock"; fi' EXIT
  trap 'exit 1' HUP INT TERM
  sudo mv -T -- "$sock" "$held"
  curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"reactive"}'
  curl -s http://localhost:8000/api/controllers
  ss -ltnp 'sport = :6653'
  read -r -p 'Check Controllers shows FAILED, not ACTIVE RUNNING. Press Enter to restore IPC: ' c05_reply
)
curl -i -X POST http://localhost:8000/api/controllers/select -H 'Content-Type: application/json' -d '{"controller_type":"reactive"}'
sudo ovs-vsctl --columns=target,is_connected list Controller
```

Expect failed switch 503, FAILED status, no replacement listener; after recovery, expect 200/READY, verified reset logged before Ryu launch, and switches reconnecting on 6653. The earlier C04 real-mode-transition verification remains applicable; C05 automated tests retain all 17 C04 checks. Do not interpret controller processing time as packet disruption or FF switching time.

## Scope preserved

C01 system worker Python, C02 selected-controller startup, C03 merge logic, C04 serialized checked dataplane reset, fixed four-switch diamond, controller algorithms, FF behavior, SQLite history, and UI design remain intact. C06 accounting, C07 unexpected exits, C08 stale telemetry, C09 cancellation, C10 analytics, and WebSocket retry changes are not addressed.
