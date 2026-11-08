# Mininet worker availability investigation and recovery

Date: 2026-11-08. **No production code or test code changed for this recovery.** Existing Phase 5 and verification edits in the worktree were preserved. No commit or push occurred.

**Subsequent Phase 5 status:** the project owner has now reported completed, passing live delay/loss/restoration and hard-failure validation. The post-timing-fix hard-failure retest VERIFIED with 40/40, 0% loss, 31.78 ms average RTT, stability Passed, 5.14 s verification duration and path UNAVAILABLE. This update preserves the worker outage/recovery history below; it does not attribute the independent verification timing bug to the worker environment issue.

## Initial findings

- Backend PID 482975 was running, listening on port 8000, with fresh STOPPED state and no selected controller.
- There was no worker process and no OVS bridge inventory.
- `/tmp/mininet_worker.sock` existed, owned by root, but a direct connection returned `ECONNREFUSED`. `ss -xlpn` confirmed no listener at that path.
- `/api/topology` returned the truthful 503 `Mininet worker unavailable`.
- `sudo -n /usr/bin/python3 -c 'import mininet.net'` failed with `sudo: a password is required` in the diagnostic session. Sudo timestamps can be terminal-specific; this does not establish the authentication cache of every other terminal.
- The intended `/usr/bin/python3` system interpreter and installed Mininet were retained. No change to sudoers or installed packages was made.

The immediate cause was **an absent daemon with a stale Unix socket**, not a Mininet import failure demonstrated by a worker crash. The exact historical cause of the old daemon's exit is not recoverable from the available logs. An abrupt prior shutdown is consistent with the stale socket, but is not asserted as proven.

## Lifecycle trace

1. `MininetClient` is instantiated as a backend singleton in `backend/services/mininet_client.py`. This creates client state, not a worker process.
2. FastAPI startup initializes the DB, binds persistence and starts health monitoring. It deliberately does **not** call `ensure_worker()`.
3. Worker spawn is lazy: `_start_simulation()` calls `ensure_worker()`.
4. `ensure_worker()` first pings an existing socket; otherwise it launches `sudo -n /usr/bin/python3 backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock`.
5. The privileged entry point constructs `MininetWorker()` inside `main()`, opens its Unix server and waits for requests. It can exist without a Mininet network. An already-running worker can be reused; it need not be a child of the current backend.
6. `/api/simulation/start` first stops the old controller/simulation before controller selection and `_start_simulation()`. A stale socket makes that preliminary stop fail before lazy worker creation is reached.
7. A STOPPED topology read returns an empty topology without RPC only when no socket file exists. If a stale file exists, it tries the connection; `FileNotFoundError`/`ConnectionRefusedError` map to 503.
8. Normal worker termination closes/removes the socket. A backend restart does not itself recreate the lazy worker or guarantee removal of an old root-owned socket.

Therefore **no worker child after fresh FastAPI startup is expected**, and the stale filesystem artifact explains why restarting only FastAPI did not resolve topology availability. The current backend's fresh runtime/STOPPED state rules out leftover Python singleton state as the current cause.

The other successful APIs do not prove daemon availability: controller reads expose configuration/status; stopped link-health reads return an empty snapshot; verification/intent reads return current stored/in-memory evidence without starting Mininet.

The recent Recovery Verification timing fix changes a deadline inside failure observation. That code is not executed to launch a worker or start a network and cannot explain this absent-daemon/stale-socket state.

## Recovery performed

After confirming there was no worker or live socket listener, the existing worker entry point was launched as WSL root with **`/usr/bin/python3`**. Its existing startup replaced the dead socket. It was detached with stdin redirected to `/dev/null`, output to `logs/mininet-worker-recovery.log`, and a separate process session.

- Worker PID: **483152**.
- Direct `ping` returned `pong`.
- Existing FastAPI process was kept running; no duplicate backend was created.
- `/api/topology` immediately changed from 503 to **200**, truthfully reporting STOPPED / no network.
- The worker is a separately launched daemon adopted by the backend's existing ping/reuse path, not a newly spawned child of backend PID 482975.

No `mn -c`, blanket process kills, topology changes, controller rewrites, virtualenv-worker switch, privilege-policy change, or historical DB editing was performed.

## Separate cold-start timeout observed

The first normal API Mesh + Reactive start returned **504** after 51.72 seconds overall: its existing 45-second network-start RPC deadline elapsed. The worker remained alive and subsequently completed a real nine-switch, two-host, sixteen-link network. Because confirmation was late, the backend correctly remained ERROR; it was not manually relabeled RUNNING.

The worker log's connection-lost/BrokenPipe diagnostics occurred while replying to a connection the timed-out backend had closed. They are not evidence of an interpreter/import crash; the same worker remained responsive.

After confirming that completed state, **one clean restart through the normal `/api/simulation/start` lifecycle succeeded with HTTP 200 in 22.0467 seconds**. Existing timeouts and error contracts were not changed. The cold-start 504 is recorded as a separate timing observation, not silently called a successful request. If it recurs, investigate network-construction latency separately; this recovery does not establish that every cold start will meet 45 seconds.

## Final actual runtime verification

| Check | Result |
|---|---|
| Backend | PID 482975, running; `/api/system/health` 200 |
| Worker | PID 483152, `/usr/bin/python3`, alive and responds |
| Normal simulation start | 200, confirmed worker result |
| Simulation | RUNNING / Multi-Path Mesh |
| Controller | Reactive READY, PID 487916, `--observe-links --ofp-tcp-listen-port 6653` |
| Actual OVS bridges | s1–s9 exist |
| Actual controller connections | All nine `is_connected=true`, target `tcp:127.0.0.1:6653` |
| Actual protocols | All nine bridges `OpenFlow13` |
| `/api/topology` | 200, nine switches, h1/h2, sixteen links UP |
| `/api/link-health` | 200, fourteen ISLs, zero injected or nonbaseline quality settings |
| Traffic | No active job; no test traffic/failure injected during this recovery |
| Final runtime ID | `09e17a5272d34ea3914c155530f01820` |
| Complete backend suite | **262 passed**, 0 failed, 156.242 s |
| `git diff --check` | PASS, exit 0 |

Backend test output: `worker-recovery-backend-tests.txt`. Tests use existing fake IO/isolated loopback and temporary DB fixtures; no new production or regression-test source was warranted for this environmental recovery.

## Minimal recurrence commands

**Do not run these now: the worker is already alive.** For the same confirmed-dead-daemon/no-listener condition, leave FastAPI running and launch the existing worker in a separate terminal:

Windows PowerShell:

```powershell
wsl -d Ubuntu-22.04 -u root -- /usr/bin/python3 /mnt/e/Projects/self-healing-sdn/backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock
```

Or inside WSL, with normal interactive sudo authentication:

```bash
sudo /usr/bin/python3 /mnt/e/Projects/self-healing-sdn/backend/services/mininet_worker.py --socket /tmp/mininet_worker.sock
```

Keep that foreground worker terminal open. The entry point replaces the confirmed stale socket itself; no extra `rm`, `mn -c`, backend restart or Python replacement is required. Do not launch a second worker while one is already listening.

Then use the dashboard Start Simulation action, or from another WSL terminal:

```bash
curl --fail-with-body -X POST http://127.0.0.1:8000/api/simulation/start \
  -H 'Content-Type: application/json' \
  -d '{"controller_type":"reactive","topology_id":"multipath_mesh"}'
curl --fail-with-body http://127.0.0.1:8000/api/simulation/status
curl --fail-with-body http://127.0.0.1:8000/api/topology
```

For normal automatic spawning, use the existing launcher with appropriate sudo authentication; absence of cached `sudo -n` authorization can prevent lazy spawning. The manual root-worker method avoids changing privilege policy and is supported by the existing client reuse path.

## Readiness at recovery and subsequent manual result

At the end of this worker recovery, the runtime was ready for the Phase 5 hard-failure test: no active traffic or injected impairment, all sixteen links UP. That readiness check itself did not execute a failure/recovery test. The project owner subsequently performed the live validation and reported the passing result summarized above and in the Phase 5 report. Verification duration is not outage or controller processing time; an observed forwarding path remains unavailable.

Files added by this task: this report and `worker-recovery-backend-tests.txt`; generated worker diagnostics are in `logs/mininet-worker-recovery.log`. Normal runtime starts/stops also wrote their usual database events through the application. The runtime DB was not staged, and no commit/push occurred.
