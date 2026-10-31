# C04 — manual WSL verification

Status: READY FOR MANUAL VERIFICATION. The regression tests mock process/OVS IO;
they do not establish real switch behavior. No real dataplane was reset during
implementation. No frontend rebuild is needed for this backend-only change.

## Load the new backend and worker code

Stop simulation in the dashboard, then stop the controller:

```bash
curl -fsS -X POST http://127.0.0.1:8000/api/controllers/stop
```

Stop FastAPI with Ctrl+C in its terminal. An already-running Mininet worker must
also be restarted; it otherwise does not recognize the new reset command.
List workers and terminate only the PID for this project:

```bash
pgrep -af '[m]ininet_worker.py'
sudo kill -TERM <THIS_PROJECT_WORKER_PID>
```

If there is no worker, skip the kill. Start the dashboard with its normal launcher
or existing WSL startup command. The worker must still use `/usr/bin/python3` and
Ryu/FastAPI must still use `~/sdn-env`. Do not run `mn -c` after Ryu starts.

## A — establish real FF state

Select Fast Failover, start simulation, restore previously failed links, and wait
for discovery of all four switches and four inter-switch edges. Generate h1→h2
traffic using Traffic Monitor (for example 1000 packets at 0.1-second intervals).

```bash
sudo ovs-vsctl get-fail-mode s1
sudo ovs-ofctl -O OpenFlow13 dump-groups s1
sudo ovs-ofctl -O OpenFlow13 dump-flows s1
sudo ovs-ofctl -O OpenFlow13 dump-group-stats s1
```

Expected: secure mode, `type=ff` groups with watch ports, and destination flows
containing `actions=group:<id>`. Save both groups and flows for comparison.

## B — switch FF → Baseline through the dashboard

Keep the simulation running and activate Baseline. Wait for the selection request
to complete and fresh switch/topology discovery.

```bash
ps aux | grep -E 'ryu-manager' | grep -v grep
sudo ovs-ofctl -O OpenFlow13 dump-groups s1
sudo ovs-ofctl -O OpenFlow13 dump-flows s1
curl -fsS http://127.0.0.1:8000/api/simulation/status
curl -fsS 'http://127.0.0.1:8000/api/events/logs?limit=20' | /usr/bin/python3 -m json.tool
```

Expected: only `controller_baseline.py` runs; no FF groups and no group-referencing
flows remain; simulation stays RUNNING. Event logs should show a dataplane-reset
confirmation for s1–s4 before Baseline startup. Fresh table-miss, LLDP and Baseline
forwarding rules may already exist; their presence is legitimate.

Inspect **all four switches**, not just s1:

```bash
for sw in s1 s2 s3 s4; do
    sudo ovs-ofctl -O OpenFlow13 dump-groups "$sw"
    sudo ovs-ofctl -O OpenFlow13 dump-flows "$sw"
done
```

Empty groups alone are insufficient: verify the flow actions too. Cleanup should
not change bridges, host processes, physical link state or interface names:

```bash
sudo ovs-vsctl list-br
ip -br link
```

## C — verify Baseline's own behavior

Generate fresh h1→h2 traffic. Inspect the h2-destination flow and port mapping:

```bash
sudo ovs-ofctl -O OpenFlow13 dump-flows s1
sudo ovs-ofctl -O OpenFlow13 show s1
```

For destination MAC `00:00:00:00:00:02`, determine the actual output interface.
With this topology, port 2 usually leads to s2 and port 3 to s3; verify the mapping
with `show` rather than assuming it. Fail that active s1 inter-switch link through
the dashboard. Baseline must suffer disruption without inheriting local FF
forwarding. Check flows, groups and real traffic, not just the dashboard loss
percentage (live accounting is a separate deferred issue). Restore the link.

For an independent live ping, identify this network's h1 shell and attach to its
existing namespace (replace the PID placeholder; do not start another Mininet):

```bash
pgrep -af '[m]ininet:h1'
sudo mnexec -a <H1_PID> ping -i 0.1 10.0.0.2
```

Keep that ping running while failing/restoring the active link; stop it with Ctrl+C.

## D — switch to Reactive

Restore all test links and activate Reactive while simulation remains running.
Repeat the process/group/flow checks:

```bash
ps aux | grep -E 'ryu-manager' | grep -v grep
sudo ovs-ofctl -O OpenFlow13 dump-groups s1
sudo ovs-ofctl -O OpenFlow13 dump-flows s1
```

Only Reactive should run and groups should be empty. Wait for complete discovery,
generate traffic, determine its actual path, then fail a link on that path.
Verify Reactive's HEALED log/new flows and restored connectivity. Its controller
processing time is not an end-to-end outage measurement. Restore the link.

## E — return to FF and repeat experiments

Activate FF, wait for complete discovery and generate traffic:

```bash
ps aux | grep -E 'ryu-manager' | grep -v grep
sudo ovs-ofctl -O OpenFlow13 dump-groups s1
sudo ovs-ofctl -O OpenFlow13 dump-flows s1
sudo ovs-ofctl -O OpenFlow13 dump-group-stats s1
```

Verify newly installed groups and their referenced flows. Group IDs may legitimately
be reused, so different IDs are not a requirement or proof. Correlate fresh group
durations/counters with the reset-confirmation log and the current FF process.

Run Experiment Lab's three-way comparison, then repeat a single-controller run.
Each experiment must record the same shared reset boundary before Ryu starts,
including repeated runs of the same mode. Selecting an already-ready controller
normally remains a no-op; experiments explicitly request a fresh restart/reset.
This fixes dataplane inheritance, not every other experiment/metric issue.

## Failure behavior

If the worker is unavailable while simulation is active, an OVS command fails,
secure mode is absent, or either table remains nonempty, controller selection
must return an error and backend controller status must be FAILED. No replacement
Ryu may launch after failed cleanup. Controller targets remain configured for a
retry; the old controller has stopped. Inspect API status/logs because existing
frontend error/status presentation is outside C04.

## Automated checks used

From the repository root in WSL:

```bash
~/sdn-env/bin/python3 -m unittest discover -s backend/tests -v
~/sdn-env/bin/python3 -m py_compile backend/services/controller_manager.py backend/services/mininet_client.py backend/services/mininet_worker.py backend/services/experiment_runner.py backend/tests/test_controller_switch.py
git diff --check
```

These checks do not replace A–E on real Mininet/OVS/Ryu.
