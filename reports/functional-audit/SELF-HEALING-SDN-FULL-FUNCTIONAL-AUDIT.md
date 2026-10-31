# SELF-HEALING SDN — FULL FUNCTIONAL AUDIT

**Overall status: Major Integration Problems**  
**Audit date: 31 October 2026, Asia/Karachi**  
**Functionality score: 54/100. UI redesign decision: NO.**

This is an evidence-based audit of the existing implementation, not a redesign or a controller rewrite. No application source, controller, topology, frontend bundle, sudo configuration, or dependencies were changed. Audit scripts and evidence were added in this directory. Normal API operations appended test events and experiment records to SQLite; original historical records were preserved.

**Scope qualification:** the project could not start Mininet through its native backend launch path in the supplied environment. Real downstream testing therefore used the unchanged worker launched explicitly as WSL root with `/usr/bin/python3`. Every SDN PASS below is conditional on that disclosed fixture; it does not turn native startup into a PASS. The existing FastAPI server remained the real non-root backend throughout.

## Feature result table

“Frontend” describes observed UI behavior or an explicitly identified static finding. “Real SDN Action” is based on processes, interfaces, flows, groups, or counters, not HTTP status. Evidence labels refer to records in the files listed below.

| ID | Area | Feature | Frontend | Backend | Real SDN Action | Status | Evidence | Problem |
|----|------|---------|----------|---------|-----------------|--------|----------|---------|
| F01 | Delivery | Production frontend served by FastAPI | Nine pages opened | HTML and assets served | N/A | PASS | Browser page snapshots; GET `/` | PASS limited to delivery/navigation |
| F02 | System | Health endpoint | Wrapper exists; not operational status UI | Liveness JSON returned | Does not test SDN | PASS | Initial API probe | Healthy means server alive only |
| F03 | System | OVS diagnostics | Displays STOPPED | Reports false | OVS daemon and database actually running | FAIL | Initial root `ovs-vsctl show`; API system/status | Permission failure misrepresented as service failure |
| F04 | Controllers | Start/select all three modes | Activations observed | Correct root scripts launched | Ryu processes, `--observe-links`, port 6653 | PARTIAL | Mode snapshots, process command lines | Native network startup fails; selected mode overridden on start |
| F05 | Controllers | Stop and process cleanup | No dedicated stop-controller control | Stop endpoint works | Audit Ryu processes removed | PARTIAL | Final cleanup and mode snapshots | Selected ID remains active in UI; death not monitored |
| F06 | Controllers | Unexpected process exit | Can still claim ACTIVE RUNNING | READY remains cached | Port closed; process absent | FAIL | `unexpected-controller-exit` | No process-exit reconciliation |
| F07 | Simulation | Native Start Simulation | Error shown; unhandled rejection also logged | Worker startup times out | Ryu starts; Mininet absent initially | FAIL | `native start no controller selected` | Noninteractive sudo unavailable; configured venv lacks Mininet |
| F08 | Simulation | Preserve selected Baseline | Selecting Baseline works | Start defaults to Reactive | Reactive process launched instead | FAIL | `dashboard start after selecting baseline` | Omitted frontend argument becomes backend default Reactive |
| F09 | Simulation | Fixture-assisted start/reset | Running state eventually displayed | Worker creates network | Four OF1.3 bridges, six correct links, two hosts | PARTIAL | `after-reset`, `baseline-real-before` | Startup timeout can precede actual completion |
| F10 | Simulation | Stop | STOPPED displayed | Normal worker stop succeeds | Bridges and host shells removed | PARTIAL | `network-stopped-worker-alive`, final cleanup | Missing worker also returns success without verification |
| F11 | Overview | Switch/host/link counts | Shows 4/2 even with no network | API correctly returns empty arrays | No bridges after cleanup | FAIL | `initial stopped overview`; `final-clean-state` | Expected topology presented as observed live state |
| F12 | Overview | Healed events/time | Counts historical controller SUCCESS entries | Event DB returns historical data | Includes readiness records | FAIL | OverviewView recoveryEvents filter; stopped snapshots | READY counts as healed; no session boundary |
| F13 | Topology | Correct physical diamond | Correct when HTTP topology loaded | Real worker topology | Endpoint flags match API | PARTIAL | OVS/interface snapshots | Static fallback falsely appears operational while stopped |
| F14 | Topology | Link toggles and live state | Link action can blank entire page | Link operation executes | Both switch interfaces change | FAIL | Inspector toggle; browser TypeError | WS topology omits active_paths; page dereferences `.length` |
| F15 | Topology | Switch flows/groups/ports inspector | Actual tables loaded; tabs/refresh work | Real dump commands | Outputs match OVS | PASS | `inspector actual loaded flows/groups/port counters` | Counts include protocol header rows; header DPID may be blank on fallback node |
| F16 | Topology | Active/backup routes | Reactive route changes visible | Last log path; guessed backup | Reactive flow reroute confirmed | PARTIAL | `reactive-before/down`; topology route | FF summaries ignored; backup inferred, not verified |
| F17 | Failure Simulator | Fail/restore links | Six controls and presets wired | Valid links change physically | Both endpoints verified DOWN/UP | PARTIAL | `baseline-real-down/restored`, `ff-proof-down` | Temporary STOPPED state; fixed primary/backup labels |
| F18 | Failure Simulator | Restore All | Physical restoration works with running network | Sequential six-link operation | Interfaces restored | PARTIAL | Restoration snapshots | Returns overall ok even if every child action fails |
| F19 | Traffic | Dashboard traffic generation | Real stream started | Worker launches host ping | h1 ping to 10.0.0.2; flow counters increase | PASS | `baseline-real-before`, `reactive-before` | PASS limited to valid running-network case |
| F20 | Traffic | Live received/RTT history | Changes with real replies | Parsed from ping output | Correlated with packet counters | PARTIAL | Real traffic snapshots | Mean/min/max RTT unavailable until summary; no failed-sample history |
| F21 | Traffic | Live loss/transmitted counters | Outage falsely remains 0% | Counters freeze on missing replies | Ping continues transmitting into failed path | FAIL | `baseline-real-down/outage` | Transmitted estimated from received sequence numbers |
| F22 | Traffic | Stop and session state | Can revert to active/stale metrics | Cached stats survive stop/reset | Ping gone while API active=true | FAIL | `after-reset`, `final-clean-state` | latest_stats not finalized or invalidated |
| F23 | Baseline | No automatic rerouting | Failed link reflected | Baseline logs no recovery | Active s1-s3 path fails; flows unchanged | PASS | `baseline-real-before/down/outage` | Intentional behavior preserved; live loss UI is wrong |
| F24 | Baseline | Restore connectivity | Restore action executes | Both endpoints UP | Restoration verified | PARTIAL | `baseline-real-restored` | Finite test stream had ended before restoration snapshot; continuous-stream recovery not proven |
| F25 | Reactive | Alternate path/healing | New route displayed | HEALED events persisted/broadcast | s1-s3-s4 becomes s1-s2-s4 | PASS | `reactive-down/healed/final` | Processing time is not outage time |
| F26 | FF | Groups, buckets, flow reference | Inspector shows real FF group | Correct controller running | type=ff; watch ports 2/3; actions=group:2 | PASS | `ff-proof-before` | Two buckets confirmed before valid test |
| F27 | FF | Local backup switching | Failure injected through dashboard | Worker changes link while Ryu paused | Backup bucket 0→6 packets; replies continue | PASS | `ff-proof-down`; signal evidence | Traffic for isolated proof API-initiated; precise switching time not measured |
| F28 | FF | Route/path/metric presentation | Active route missing; generic recovery labels | Recompute event parsed | Local switching proven separately | FAIL | Ignored ROUTES_SUMMARY / ROUTE_RECOMPUTED handlers | Cannot infer local switching latency from recomputation |
| F29 | WebSocket | Connect, ping, reconnect, malformed client text | Connection badge changes | Initial state and pong returned twice | N/A | PARTIAL | websocket-probe.json; browser offline test | Incomplete hydration, reconnect timer ownership and duplicate-connection risks |
| F30 | WebSocket | Topology schema | STOPPED flicker and blank-page crash | Sends raw worker schema | Network remains RUNNING | FAIL | Topology TypeError, `ff-proof-down` | REST and WS topology contracts differ |
| F31 | Events | Persist valid lifecycle/failure/healing/experiment events | History/filter/search available | SQLite persists records | Correlated with real actions | PARTIAL | Event API and final DB counts | Invalid actions also logged as successes; not a complete live event feed |
| F32 | Experiment Lab | Three-way workflow | Starts and history receives results | Three COMPLETED records stored | Real ping/failure actions occur | PARTIAL | Comparison records below | Dataplane not isolated, so comparisons invalid |
| F33 | Experiments | Mode isolation/repeatability | Labels selected controller | Switches Ryu process only | Baseline retains FF flow/group | FAIL | `comparison-midrun` | Previous controller forwarding state persists |
| F34 | Experiments | Cancel | Request accepted | Early CANCELLED; late COMPLETED | Early cancel leaves ping running | FAIL | cancellation-evidence.jsonl; `early-cancel-process-cleanup` | One flag check; no guaranteed cleanup |
| F35 | Experiments | Repetitions/progress/refresh | Run button can re-enable mid-comparison | repetitions unused; no persisted in-progress state | N/A | FAIL | Source + comparison stage snapshots | UI and server lifecycle differ |
| F36 | Analytics | Real/no-data chart handling | Demo numbers appear before history hydration | No dedicated analytics API | N/A | FAIL | AnalyticsView; direct-navigation snapshot | Hardcoded no-data values and unconditional performance claims |
| F37 | Reports | JSON/CSV/HTML endpoint exports | JSON downloaded to audit folder | Real stored records serialized | N/A | PARTIAL | API exports; downloads/*.json | HTML browser download not completed in captured artifacts; labels ambiguous |
| F38 | Errors | Invalid SDN input | UI generally sees HTTP success | 200 with error or false ok | s1-s4 nonexistent link reports ok | FAIL | `invalid SDN input`, stopped worker probes | Missing validation and error propagation |
| F39 | System maintenance | Clean Mininet control | Confirmation reachable | Calls reset, which stops and rebuilds | Reset creates network | FAIL | SettingsView.handleCleanMininet; reset test | Label and action disagree; store can swallow error |
| F40 | Preservation | Delete existing history | Confirmation dismissed | Missing-ID delete returns 404 | N/A | NOT TESTED | Existing data preserved | Successful deletion deliberately not executed |
| F41 | Quality checks | TypeScript/Python syntax | TypeScript check succeeds | 37 Python files parse | N/A | PASS | schema-syntax-evidence.json; tsc command | Not a substitute for runtime testing |
| F42 | Quality checks | Frontend lint | Not executed successfully | N/A | N/A | NOT TESTED | oxlint native-binding error | Supplied Windows node_modules lacks native binding |

## 1. Executive Summary

The SDN controllers are not the main problem. Baseline's non-healing behavior, Reactive rerouting, and OpenFlow local FF switching were observed against real OVS state. The existing four-switch topology was retained.

The dashboard cannot presently be treated as a trustworthy operational view. It can show a dead controller as running, display old traffic as active after the network has stopped, report 0% live loss during a Baseline outage, and crash when a valid link action delivers an incomplete WebSocket payload. Analytics invents data when history has not loaded. Controller switching leaves old forwarding state behind, invalidating comparative experiments.

The native start path also fails in this environment. Fixture-assisted tests prove useful downstream functionality but do not prove a working zero-CLI deployment.

The comparison saved Baseline 68% loss, Reactive 53%, and FF 37% for the configured run. These are genuine stored outputs, **not reliable controller benchmarks**: modes shared forwarding state and the experiment did not establish a clean active path before failure. They must not be used to contradict the isolated controller tests or to claim FF's local switching time.

### Evidence and reproducibility

- [Phase 1 map](PHASE1.md): static findings recorded before mutation testing.
- [Source route inventory](route-inventory.json), [source OpenAPI](openapi-source.json): 26 API operations plus the SPA route; `/ws/events` additionally inspected/tested.
- [HTTP evidence](api-evidence.jsonl): method, URL, request body, HTTP status, elapsed time, label, raw parsed response.
- [SDN evidence](sdn-evidence.jsonl): command, exit code, stdout/stderr for processes, bridge protocols/controllers, interfaces, flows, groups, bucket counters and port counters. Followed by API snapshots; these sequential observations are not simultaneous measurements.
- [Browser evidence](browser-evidence.jsonl): page text, controls and disabled states, action outcomes, WebSocket frames, console exceptions and network failures. Large because full telemetry frames are retained.
- [WebSocket probe](websocket-probe.json), [cancellation evidence](cancellation-evidence.jsonl), [signal evidence](signal-evidence.jsonl), [schema/syntax checks](schema-syntax-evidence.json), [cleanup](final-cleanup-evidence.json).
- Screenshots and actual JSON download reside alongside the report and in `downloads/`.

Reproduction scripts are audit artifacts, not automated regression tests installed in the application. They are not idempotent: mutation probes create real events/experiments. Browser scripts contain this session's WSL IP and require the separate Chrome debugging endpoint. Do not rerun mutation scripts casually against a live demonstration.

Some early automation actions returned DISABLED/NOT FOUND or hit Windows `ERR_NETWORK_CHANGED`. Those attempts are retained transparently and are not counted as successful tests. In particular `ff-*`, `ff-real-*`, and the first `ff-local-before` are insufficient local-failover evidence. The definitive FF evidence is `ff-proof-before/down`, with the latter's bucket counter proof. Later browser tests used the launcher's direct WSL IP.

## 2. Architecture / Integration Map

The full control-by-control chain is in [PHASE1.md](PHASE1.md). Main execution paths:

```text
frontend/dist served by backend/main.py
  React pages → Zustand sdnStore → services/api.ts
    /api/controllers → ControllerManager → ~/sdn-env/bin/ryu-manager
      --observe-links --ofp-tcp-listen-port 6653 <root controller script>
    /api/simulation, /api/links, /api/topology → MininetClient
      Unix socket /tmp/mininet_worker.sock → privileged MininetWorker
        Mininet object → namespaces/veth/OVS/OpenFlow13
    /api/traffic → TrafficService → worker host.popen(stdbuf ping)
    /api/experiments → ExperimentRunner → managers/worker → SQLite
    /api/reports, /api/events/logs → SQLite → serializers
  services/websocket.ts ← /ws/events ← broadcasts from services/log parser
```

Runtime controllers are **root** `controller_baseline.py`, `controller_reactive.py`, `controller_ff.py`, as configured in `backend/config.py`. `SDN_controllers/` and `report_command_snips/` contain alternate/reference copies; they are not the configured launch targets. The worker builds the diamond directly; it does not import `topo_diamond.py` at runtime. Topology script copies were inspected and not altered.

REST topology adds controller, simulation state and routes in `backend/api/topology.py:get_topology`. Worker-originated WS topology does not add those fields. This is the principal broken integration contract.

Unused frontend wrappers: `api.getHealth`, `stopController`, `getControllerLogs`, `getSimulationStatus`. `uptime` is initialized in the store but never hydrated. `/api/reports/export-all`, experiment detail GET, and CSV export are backend capabilities with no dedicated UI action in the current pages. No frontend URL mismatch was found among the defined wrappers.

## 3. Frontend Page Test Results

| Page | Observed functionality | Defects / limits | Result |
|---|---|---|---|
| NOC Overview | Counters, topology, traffic actions, quick failure/restoration, real Reactive update | Historical READY counted as healing; 4/2 fallback counts; stale traffic; state flicker | FAIL |
| Network Topology | Real topology, node/edge selection, link matrix, inspectors | Link action can blank React tree; modal snapshot stale; fallback interfaces invented | FAIL |
| Controllers | Three activations, real streamed logs | ACTIVE RUNNING ignores status; selected mode changed by Start; mixed old logs; no stop-controller UI | PARTIAL |
| Traffic Monitor | Host/interval/count selectors; dashboard start; stop request; live response history | Loss freezes; aggregates summary-only; stopped stats can reactivate UI | FAIL |
| Failure Simulator | Six link cards, primary/backup presets, restore-all | Fixed route labels; brief STOPPED disables controls; events not reliably live | PARTIAL |
| Experiment Lab | Parameters, comparison start, progress, persisted history, export actions, delete confirmation | State isolation, cancellation and comparison lifecycle defective | FAIL |
| Analytics | Charts render; available history averaged | Fake no-data values; direct visit does not fetch history; cancelled/failed records included | FAIL |
| Event Logs | Refresh, filters ALL/INFO/WARNING/SUCCESS/ERROR inspected; warning/success/error/all clicks and search exercised | Last 100 records only; no session/date distinction in main table; not complete live subscription | PARTIAL |
| System & Config | Recheck and diagnostic data load; maintenance confirmation reachable | OVS false-negative; cleanup label actually reset; swallowed errors | FAIL |

Switch inspector's correctly named Flow Table, Group Table and Port Counters tabs and refresh were retested after earlier selector misses. Later snapshots contain actual OVS output, including the two-bucket FF group. JSON browser download produced a nonempty report file. HTML was requested but no completed HTML browser download artifact was captured; HTML response content itself was verified through HTTP.

UI controls whose successful destructive behavior was intentionally not exercised: deleting an existing experiment and accepting the maintenance confirmation. Their dialogs were opened and dismissed. Reset's underlying endpoint was separately executed. React Flow visual zoom/pan and node dragging were not exhaustively tested by physical pointer input; their standard controls were inspected, not claimed as fully interaction-tested.

## 4. Backend API Test Results

All endpoint names below came from source and source-generated OpenAPI. PASS here is limited to the tested contract; it does not certify an entire SDN feature. Coverage varies by endpoint rather than pretending every possible state/input permutation was executed.

| Method / endpoint | Normal/running result | Invalid/stopped result | Classification |
|---|---|---|---|
| GET `/api/system/health` | Liveness JSON | Also healthy with SDN stopped, appropriate only for liveness | PASS |
| GET `/api/system/status` | OS/Python/port fields real | OVS false despite running daemon due sudo permission | FAIL |
| GET `/api/controllers` | Three correct definitions, active selection | Stale READY after process death; selected stopped ID remains active | PARTIAL |
| POST `/api/controllers/select` | Starts all three correct scripts | Missing body 422; unknown value 500 instead of client error | PARTIAL |
| POST `/api/controllers/stop` | Stops owned Ryu process | Idempotent endpoint; active ID remains | PARTIAL |
| GET `/api/controllers/logs` | Actual Ryu lines | No per-controller reset; old mode lines retained | PARTIAL |
| POST `/api/simulation/start` | Real network with fixture | Native worker timeout 500; omitted mode overrides selection | FAIL |
| POST `/api/simulation/stop` | Real stop verified | Repeated stop ok; missing worker also falsely “stopped” | PARTIAL |
| GET `/api/simulation/status` | Cached RUNNING and controller | READY persists after death; uptime is controller uptime | FAIL |
| POST `/api/simulation/reset` | Worker stop/rebuild executed | Stopped-without-controller matrix not fully executed; does not ensure controller by source | PARTIAL |
| GET `/api/topology` | Real worker nodes/interfaces/links | Empty physical state when stopped; invented backup route persists | PARTIAL |
| GET `/api/topology/switch/{dpid}` | Real flows/groups/ports | Bad type 422; absent worker 500; nonexistent switch 200 empty tables | PARTIAL |
| POST `/api/links/down` | Both ends DOWN | Missing fields 422; stopped worker 200 error; nonexistent s1-s4 reports ok | FAIL |
| POST `/api/links/up` | Both ends UP | Missing node returns HTTP 200 error; logged as restored | FAIL |
| POST `/api/links/restore-all` | Six physical restorations | Stopped worker: overall ok despite six errors; absent worker unstructured 500 | FAIL |
| POST `/api/traffic/start` | Real source-host ping | Bad type 422; stopped/missing node 200 error; invalid ranges accepted by schema | FAIL |
| POST `/api/traffic/stop` | Ping termination requested/executed | No job ok; poisoned/nonexistent job not_found; stale stats remain | PARTIAL |
| GET `/api/traffic/stats` | Actual reply history | Can return `{}` or old active=true with no live network | FAIL |
| POST `/api/experiments/run` | Three real completed stages and stored data | Bad type 422; invalid controller 500 + FAILED record; results contaminated | FAIL |
| POST `/api/experiments/cancel` | Always acknowledgment | Early cancellation leaves traffic; late request does not cancel | FAIL |
| GET `/api/experiments/history` | Persistent records returned | `limit=-1` accepted and returns unbounded history | PARTIAL |
| GET `/api/experiments/{exp_id}` | Matches saved record | Missing ID 404 | PASS |
| DELETE `/api/experiments/{exp_id}` | Successful deletion intentionally skipped | Missing ID 404; UI confirmation dismissed | NOT TESTED |
| GET `/api/reports/{exp_id}/export` | JSON/CSV/HTML from saved record | Missing ID 404; bad format 422 | PASS |
| GET `/api/reports/export-all` | Real JSON and CSV history | Bad format 422 | PASS |
| GET `/api/events/logs` | Real persisted events | Negative limit accepted; misleading events included | PARTIAL |

Static delivery `/` works. An unknown `/api/nonexistent` returns **200 null**, not 404, because the SPA catch-all returns `None` for unmatched API paths.

The exact endpoint requests, statuses and response bodies are in `api-evidence.jsonl`. Numeric/domain-invalid inputs were additionally passed to Pydantic without executing potentially unbounded or negative-interval ping commands; these accepted-schema tests are not represented as real traffic tests.

## 5. Controller Test Results

All three launches used `~/sdn-env/bin/ryu-manager --observe-links --ofp-tcp-listen-port 6653` and the expected root Python file. Process snapshots establish actual PIDs and mode changes. No surviving audit Ryu process was found at final cleanup.

Baseline retained old forwarding when the active link failed. This is correct and must remain unchanged. Reactive installed a new path and logged HEALED. FF created real `OFPGT_FF` groups.

Lifecycle failures are in `ControllerManager.start_controller`, `get_controller_info`, `_stream_logs`, and frontend `ControllersView`: readiness is declared even if the port-wait loop times out with `port_ready=False`; unexpected EOF/exit does not update status; stopped/failed selected controllers are rendered as ACTIVE RUNNING. Historical DB evidence also contains READY records with `listening=False`; those historical records are evidence of past reporting, not a new reproduction of a port-bind failure in this audit.

Process cleanup is not equivalent to dataplane cleanup. Old groups/flows survived a successful process switch and contaminated the next controller.

## 6. Mininet/OVS Test Results

Actual network verified under the worker fixture:

- s1, s2, s3, s4 OVS bridges; each configured `OpenFlow13` and remote controller `tcp:127.0.0.1:6653`.
- h1 and h2 Mininet host shells; real host traffic targeted 10.0.0.2 from h1.
- Exactly h1-s1, h2-s4, s1-s2, s2-s4, s1-s3, s3-s4 physical links.
- Switch controller connection rows and Ryu discovery logs examined, not inferred from topology rendering.
- OVS flow, group and packet-counter outputs captured before/after failures.
- `ip -br link` and worker interface flags corroborated inter-switch failures on both endpoints.

The first fixture start exceeded backend response timing and left a real network present while the backend said ERROR. A later explicit Baseline retry succeeded. This proves a timeout/state-reconciliation problem rather than proving the first operation failed to create any resources.

Final stop removed bridges and namespace shells. The worker fixture was then terminated by its exact command identity. Final evidence: no remaining bridges, socket absent, no audit ping/Ryu processes. The pre-existing backend and OVS service were left running. No `mn -c` was executed during the audit, including after Ryu startup.

Host-link bandwidth/delay metadata is not truthful: `build_network` applies `bw=10, delay='5ms'` only to inter-switch links, but `get_topology` assigns those values to every link, including host access links.

## 7. Traffic Test Results

Real traffic was generated through the dashboard and correlated with `ping -i ... -c ... 10.0.0.2` processes and increasing forwarding/port counters. RTT history values are parsed from ping replies; they are not random/demo values.

Important measured examples:

| Observation | Evidence |
|---|---|
| Baseline before failure | 117 transmitted / 117 received, 0% reported loss, actual path s1-s3-s4 |
| Baseline during outage, two separate snapshots | Both freeze at 323/323 and 0% despite a continuing ping process |
| Baseline final ping summary | 1000 transmitted / 323 received, 67.7% loss |
| Reactive final ping summary | 1000 transmitted / 999 received, 0.1% loss |
| FF isolated proof | 12/12 before, 19/19 after failure snapshot; backup bucket increased while Ryu paused |
| After all traffic/network cleanup | API still returns an older job with active=true, 54/37 and 31.5% loss |

The worker updates `transmitted` using the highest **received** ICMP sequence. With no replies, transmitted/loss/duration stop advancing. The final ping summary can correct aggregate loss, but that does not repair the misleading live display. Lost packets also have no failed history entries.

`min_rtt/avg_rtt/max_rtt` are populated from ping's final summary, not maintained live. Manual termination uses SIGTERM rather than requesting a ping summary, so final aggregates are not guaranteed. `TrafficService.stop` cancels polling and clears the job ID but does not finalize/invalidate `latest_stats`; later GETs can restore stale active state in the UI.

On a fresh stopped-page load, the UI instead showed default zero/idle traffic because App does not hydrate traffic stats while stopped, although the API still returned an old active job. This is a separate hydration discrepancy, not proof of live telemetry on that fresh page.

No precise outage duration is established by these samples. UI, socket and command snapshots are sequential, WSL scheduling/network changes occurred, and ping sampling is finite.

## 8. Failure/Recovery Test Results

Valid switch-link DOWN actions changed actual endpoint flags, API link status and dashboard failed-link indications. Restorations changed endpoint flags back UP; restore-all physically worked in a running network. Failure/restoration events were persisted, though invalid attempts can also generate those events.

**Baseline:** OVS established the active path through s3 before failing s1-s3. Baseline logged no recovery action, did not automatically reroute, and suffered loss. The stream completed before the restoration snapshot, so continuous-stream recovery after restoration is PARTIAL rather than falsely claimed as proven. Physical restoration itself is verified.

**Reactive:** failing s1-s3 produced new flows through s2 and persisted HEALED events. Logs show reverse-path processing 3.5 ms and forward-path processing 17.6 ms. These measure controller-side work starting in its link-delete handler, not detection delay, OpenFlow acknowledgment, or end-to-end outage. The final ping stream lost one packet.

**FF:** the definitive proof used a two-bucket s1 group with primary watch/output port 2 and backup watch/output port 3, referenced by `eth_dst=00:00:00:00:00:02 actions=group:2`. Ryu was paused from approximately 1793388974.882 to 1793388981.589. The dashboard failed s1-s2 during that pause. The group remained two-bucket; bucket1 packet count rose 0→6 while replies continued. Ryu was resumed and links restored. Subsequent controller recomputation is separate from this local dataplane action. No sub-millisecond timing claim is made.

The first aborted long-pause attempt is not evidence of normal failover behavior: pausing a controller for an extended period can lead to switch disconnections and rediscovery. It was resumed explicitly. Only the short, fully captured `ff-proof` interval supports the local-switching conclusion.

## 9. WebSocket Test Results

The real endpoint accepts connections, sends INITIAL_STATE, answers `ping` with `pong`, tolerates non-ping/malformed client text without crashing, and works on a second independent connection. Browser captures include controller/log, simulation, topology, link, traffic, HEALED and experiment messages. Offline HTTP emulation left the WS badge LIVE, so that emulation alone is not proof of WebSocket disconnect detection. A separate browser-only diagnostic tracked and closed the audit page's actual WebSocket: the badge changed to OFFLINE, then automatically returned to LIVE. The `actual WS disconnect` and `actual WS automatic reconnect` snapshots retain the result. Instrumentation changed only the test page's JavaScript context, not application files.

| Value | Mechanism | Reliability |
|---|---|---|
| Topology | Action-triggered WS + 3-second GET polling | WS schema replacement can crash page; polling later repairs fields |
| Controller | CONTROLLER_STATUS + initial GET | ID updated; status ignored by UI; no reliable process-death notification |
| Simulation | SIMULATION_STATUS + topology GET | Raw topology WS sets state to undefined, rendered as STOPPED |
| Link state | WS topology/link events + GET | Physical data real; UI contract defective |
| Traffic replies/last RTT/loss | TRAFFIC_TICK approximately every .3s + running-state GET fallback | Real replies but incomplete loss accounting |
| Healing | HEALED | Reactive path and event refetch work |
| FF recomputation | ROUTE_RECOMPUTED | Frontend handler absent |
| Event logs | Initial/mount/manual GET and HEALED refetch | Not a general live database log stream |
| Historical controller logs | GET wrapper exists but unused | Refresh loses prior in-memory log history |
| Experiments | Stage progress/finish messages and history refetch | No initial running-experiment snapshot; comparison outer lifecycle missing |

`App.tsx` reconnects its singleton WebSocket whenever `simulationState` changes. `WebSocketService` keeps no cancellable reconnect timeout or connection-generation identity, and old onclose callbacks share `shouldReconnect`. Pending retries can therefore reopen after cleanup or overlap a replacement connection. Browser evidence contains repeated open/close/premature-close messages. Counts across separate CDP attachments are not used as an exact server connection-count measurement. This is a source-established ownership/race defect, not a fabricated exact count of leaked connections.

Malformed **server** messages and every possible unmount/reconnect timing were not injected into the production stream. JSON parse errors are swallowed by source inspection. Reconnect does not rehydrate traffic, event history or current experiment state comprehensively.

## 10. Database/Event Log Results

SQLite is real and persistent. `backend/database/db.py` uses parameterized statements for IDs/limits and stores experiments plus event details JSON. Startup/stop/failure/restoration/Reactive healing/FF recomputation/experiment events were read back. Report exports match stored records.

Initial history contained the original `exp_20261027_120440_reactive`. Final read-only DB verification confirms it remains. Final database counts: **8 experiments and 308 event logs**. These include audit-created completed, cancelled and failed experiments. Nothing was deleted.

There is no session identifier or session-scoped dashboard counter. Overview selects all fetched `SUCCESS` events with `source=CONTROLLER`, so controller readiness, FF recomputation and historical records are mixed into “Healed Events.” The latest READY record can mask a previous healing duration. This is not an accurately labeled lifetime healing count either.

Invalid link/traffic actions are persisted as though successful because MininetClient logs/broadcasts without checking the worker's status. `/links/restore-all` while stopped logged six restoration attempts while returning overall success. Event persistence works; event semantics do not reliably establish that an action occurred.

`traffic_params` is present in an in-memory experiment result but is not a dedicated persisted column or automatically included in summary_json. Reproducing a past experiment's exact traffic configuration from stored history is therefore incomplete.

## 11. Experiment Lab Results

Implemented workflows: one controller run; comparison sequencing Baseline→Reactive→FF; cancellation flag; history/detail/delete; export of stored results. `repetitions` is accepted but unused.

The dashboard comparison actually executed and stored:

| Experiment ID | Controller | Status | TX/RX | Stored loss | Interpretation |
|---|---|---|---|---|---|
| exp_20261031_003705_baseline | Baseline | COMPLETED | 100/32 | 68% | Retained old FF state; invalid isolated benchmark |
| exp_20261031_003744_reactive | Reactive | COMPLETED | 100/47 | 53% | Shared dataplane/host-learning state; no recorded healing duration |
| exp_20261031_003822_fast_failover | FF | COMPLETED | 100/63 | 37% | Not a measurement of local FF switching time |

`comparison-midrun` proves that the Baseline-selected dataplane still contained FF group 2 and a flow invoking it. The runner does not reset switches between controllers, clear all previously failed links, verify complete discovery/host learning, or confirm the injected link is on the established active path. Merely starting the correct process does not produce comparable clean runs.

`ExperimentRunner` starts traffic directly through MininetClient, bypassing TrafficService; global dashboard traffic telemetry can therefore remain attached to an old manual job. Per-experiment final metrics may be real while Traffic Monitor shows a completely different stream.

Cancellation tests:

- `late-cancel`: acknowledgment after FAILURE_INJECTED, final status COMPLETED. The only cancel check had already passed.
- `early-cancel` and `early-cancel-long`: status CANCELLED before injection. The longer run left `ping -i 0.1 -c 1000 10.0.0.2` running, verified in `early-cancel-process-cleanup`.
- CANCELLED emits EXPERIMENT_PROGRESS, which the frontend interprets as running. Another tab can remain stuck RUNNING. Each inner comparison finish also resets frontend experimentRunning before the outer comparison ends.

Other source-established reliability defects: last_recovery_event is not reset for a repeated run with the same already-ready controller; failure/no-stats responses can become COMPLETED with default zero loss; timeout stats are captured before explicit stop/finalization; no guaranteed cleanup in finally; outer comparison has no continuous lock; run IDs have one-second resolution and database uses INSERT OR REPLACE.

Not every one of those race conditions was forced at runtime. They remain distinct source findings, not invented execution results.

## 12. Analytics/Report Results

Analytics reads Zustand history only and does not fetch on mount. Visiting it before Experiment Lab or a finish event uses an empty store even when DB history exists. In that state it shows hardcoded Baseline 83.3% loss / 20.4 ms RTT, Reactive 0% / 15.2 ms / 20.3 ms, and FF 0% / 3.4 ms / 20.1 ms. It always advertises Reactive “10–20 ms Recovery” and FF “0% Loss (Sub-ms).” These are not measurements from this session.

When history is available, it averages all records by controller without requiring status COMPLETED, matching traffic/failure conditions, successful measurements, or clean controller isolation. Failed/cancelled default metrics can bias the mean. Null recovery values become zero; Baseline recovery is hardcoded zero rather than “not applicable.” Only the latest fetched history window is included.

JSON, CSV and HTML generation use real database values. JSON UI download was verified on disk; CSV API content includes correct headers/rows; HTML API output includes stored values. A completed HTML browser download was not captured. HTML export fields are interpolated without escaping. Recovery labels in exports and experiment tables do not clearly distinguish controller processing/reconciliation from packet disruption/local FF switching.

## 13. Browser Console Errors

Observed, retained in `browser-evidence.jsonl`:

- Unhandled promise rejection from Start Simulation HTTP 500, bundled `index-DgAFfMAz.js`, `startSimulation`.
- `TypeError: Cannot read properties of undefined (reading 'length')`, bundled TopologyView, after raw topology WS replacement. React page becomes blank.
- Failed API requests and repeated `Failed to fetch topology/traffic stats` console messages during Windows `net::ERR_NETWORK_CHANGED`.
- “WebSocket is closed before the connection is established” during reconnect/state transitions.

`ERR_NETWORK_CHANGED` is an observed browser/environment problem; its underlying cause is not proven to be application code. Direct WSL-IP retesting produced valid downstream evidence. Audit-evaluation errors caused by an early navigation snapshot before document.body existed are automation errors, not application defects, and are excluded from the bug list.

## 14. Backend Errors

- Native Mininet startup: `Mininet worker socket was not ready within 15 seconds`; API elapsed about 24.5 seconds including Ryu startup.
- Noninteractive sudo: `a password is required`; configured SDN virtualenv import: `ModuleNotFoundError: No module named 'mininet'`.
- Worker absence: missing Unix socket becomes 500 for topology inspector/link/traffic; restore-all can return unstructured Internal Server Error.
- Worker socket request timeouts produced blank exception text and worker-side `ConnectionResetError` / `BrokenPipeError`, including “Task exception was never retrieved,” when attempting to write another error response to a dead client.
- Unknown controller values produce 500, not a validated 4xx response.
- Worker command errors frequently do not become HTTP errors at all.

The pre-existing backend writes stdout to an existing terminal, not a complete dedicated audit log file. API responses, controller log API/DB records, observed worker tool output and browser failures support these findings. A complete archived backend stdout history was not available and is not claimed.

## 15. Hardcoded/Fake/Placeholder Data Found

| Location | Value or behavior | Consequence |
|---|---|---|
| AnalyticsView.comparisonData | 83.3%, 15.2 ms, 3.4 ms, 20.x ms no-data values | Fabricated chart observations |
| AnalyticsView summary cards | Fixed recovery and loss performance claims | Can contradict stored experiments |
| OverviewView | `switches.length || 4`, `hosts.length || 2` | Stopped network still appears to have active equipment |
| TopologyCanvas | Six default nodes, six assumed-up edges and guessed interface names | Placeholder topology can be mistaken for discovered state |
| FailureSimulatorView | Missing link treated UP; static primary=s2, backup=s3 | Incorrect live/path description |
| backend/api/topology.py | Backup path chosen by two hardcoded alternatives | Not checked against actual groups or failed links |
| MininetWorker.get_topology | Every link 10 Mbps/5ms | Incorrect host-link metadata |
| SettingsView | Fallback Python/OS strings | Missing diagnostics look like detected values |

The physical diamond's fixed node layout is intentional, not itself a bug. The defect is representing unavailable live state as UP/active or measured.

## 16. Broken or Disconnected UI Controls

No rendered primary action was found with a deliberately empty onClick handler. The defects are incorrect action/state integration:

- Start Simulation can override the controller just selected.
- Network Topology link control can trigger a whole-page crash.
- LinkInspectorModal retains the selected object; it does not derive the latest link from the store, so a toggle can continue offering the old action.
- Clean Mininet State calls reset/rebuild, not a cleanup-only action.
- Cancel does not reliably cancel or clean up.
- Stop Traffic can be visually undone by stale polling data.
- Restore All can announce success when every operation failed.
- Most stored errors have no visible error component: `sdnStore.error` is written but not consumed by the application views.
- Controller stop exists in the API wrapper but has no corresponding management button.
- Event history and controller historical logs are not fully live/reloaded after reconnect.

HTML/JSON anchors are wired to valid endpoints; JSON completed a real download. CSV exists in API/wrapper typing but has no current experiment-row control.

## 17. Incorrect Metrics or Labels

Live packet loss/transmitted; healed-event counts; selected controller as ACTIVE RUNNING; controller uptime labeled as simulation uptime by status semantics; cached traffic as active after stop; inferred backup route; fixed primary branch; unmeasured FF sub-ms/0% claims; Baseline no recovery represented as zero duration; generic Recovery Duration for both Reactive processing and FF controller reconciliation; and OVS output-row counts presented as flow/group counts.

A flow-table header is counted as an entry because `get_switch_info` splits all lines into an array. The inspected UI showed Flow Table (5) for a header plus four flows, and Group Table (2) for a header plus one group. Raw table content is useful; the counts are off by one in that example.

## 18. Critical Bugs

Every entry below includes reproduction, expected/actual behavior, likely cause and exact relevant functions. Runtime confirmation is stated separately from source-only implications.

| ID | Symptom and reproduction | Expected → actual | Likely root cause and files/functions |
|---|---|---|---|
| C01 | From supplied stopped backend, POST simulation/start | Real network → 500 worker readiness timeout | `backend/services/mininet_client.py:ensure_worker` uses sudo -n and configured venv; sudo unavailable and venv lacks Mininet. `backend/config.py:VENV_PYTHON`, `scripts/setup.sh`/`start.sh` provision/use different venv locations and no guaranteed system Mininet visibility. Runtime confirmed. |
| C02 | Activate Baseline, then navbar Start Simulation with no argument | Baseline remains selected → Reactive starts | `frontend/src/components/TopNavbar.tsx`, `stores/sdnStore.ts:startSimulation`, `services/api.ts:startSimulation`; `backend/models/schemas.py:SimulationStartRequest` defaults reactive before `backend/api/simulation.py:start_simulation` considers active controller. Runtime confirmed. |
| C03 | Network Topology → fail a link while live WS connected | Updated link/path and stable page → STOPPED flicker or blank page TypeError | `MininetClient.set_link_status/start_simulation` broadcasts raw worker topology; `sdnStore.handleWebSocketMessage(TOPOLOGY_UPDATE)` replaces object and state; `frontend/src/pages/TopologyView.tsx:109` reads missing `active_paths.length`. Runtime confirmed. |
| C04 | Run FF traffic, switch to Baseline without rebuilding, inspect s1 | Baseline owns forwarding → old FF group and actions=group:2 remain | `ControllerManager.select_controller` only replaces process; `ExperimentRunner.run_experiment/run_comparison` reuses network/dataplane. `controller_ff.py:_add_flow` installs persistent flows. Runtime confirmed, no controller rewrite warranted. |
| C05 | With worker alive but network stopped, fail/restore/start traffic; restore-all | Client error and no success event → 200 error bodies, overall restore success and false logs | `backend/services/mininet_client.py:set_link_status/start_traffic`; `backend/api/links.py:restore_all_links`; `TrafficService.start`; frontend `api.ts:fetchJson` and store actions validate HTTP only. Runtime confirmed. |
| C06 | Continuous Baseline traffic; fail established s1-s3; compare snapshots | Sent/lost counters advance → 323/323, 0% stays frozen during outage | `backend/services/mininet_worker.py:_monitor_traffic` derives transmitted only from successful reply seq; no send/timeout accounting. Runtime confirmed. |
| C07 | Terminate audit Ryu process and query statuses | FAILED/STOPPED with closed port → READY/RUNNING retained | `ControllerManager._stream_logs/start_controller/get_controller_info`; `ControllersView` checks ID rather than status. Runtime confirmed; readiness on port timeout additionally source-established. |
| C08 | Stop traffic or reset/stop network, then query traffic/stats | inactive current/final job → old job remains active=true | `backend/services/traffic_service.py:stop/get_stats`, simulation handlers omit telemetry reconciliation; `sdnStore.stopTraffic/fetchTrafficStats`. Runtime confirmed with real ping absent. |
| C09 | Cancel after FAILURE_INJECTED, or cancel before failure during long traffic | Stops execution and traffic, restores affected state → late COMPLETED; early CANCELLED leaves ping | `backend/services/experiment_runner.py:cancel/run_experiment` checks flag once and has no cleanup finally; frontend progress handler treats cancelled as running. Runtime confirmed. |
| C10 | Visit Analytics directly before history hydration; view stopped Overview | No data / real healed count → fabricated benchmarks and READY counted as healing | `frontend/src/pages/AnalyticsView.tsx:comparisonData/summary cards`, `OverviewView:recoveryEvents`; no history load on analytics mount, no event/session filter. Source + browser confirmed. |

## 19. Medium-Priority Bugs

| ID | Reproduction / symptom | Expected → actual | Likely cause and relevant function/files |
|---|---|---|---|
| M01 | Repeated link-state events or network reconnect during simulation | One owned WS with cleanup → old callbacks/timers can reopen or affect replacement connection | `frontend/src/App.tsx:useEffect([simulationState])`; `services/websocket.ts:connect/disconnect/onclose`. Reconnect churn observed; exhaustive race stress not performed. |
| M02 | Start simulation with slow initial worker build | Failure rollback or later state reconciliation → ERROR while real network exists | `MininetClient._send_command/start_simulation` fixed timeouts; worker synchronous `build_network` continues after disconnect. Runtime confirmed. |
| M03 | Stop with worker unavailable | Unknown/error unless state independently verified → unconditional status ok and STOPPED | `MininetClient.stop_simulation` catch-all; UI store trusts it. Runtime confirmed; killing a live worker with stranded bridges was not required to demonstrate false verification. |
| M04 | Invalid node, nonadjacent link, dpid999, negative/zero traffic/experiment parameters | 4xx validation → accepted schema/200 empty or false ok/500 unknown controller | `backend/models/schemas.py`; `MininetWorker.set_link_status/get_switch_info`; API wrappers. Runtime and isolated-schema confirmed. |
| M05 | Fail/restore a link while keeping modal open | Current state/action → selected snapshot remains old; second toggle can repeat old action | `frontend/src/components/modals/LinkInspectorModal.tsx:isUp/handleToggle`; `OverviewView/TopologyView` keep inspectLink object. Source confirmed; repeated modal test was interrupted by C03, so isolated runtime outcome remains partial. |
| M06 | Compare controllers or repeat same controller experiment | Clean state, current event, definitive final stats → shared state, stale last_recovery_event, missing stats default to 0 loss | `ExperimentRunner.run_experiment/run_comparison`. State contamination runtime confirmed; stale-event/default-stat variants source-only. |
| M07 | Run comparison; refresh or observe an inner finish | Whole comparison stays RUNNING → UI resets at each inner finish; refresh has no active experiment snapshot | `sdnStore.handleWebSocketMessage`; `backend/main.py:websocket_events_endpoint`; runner outer lifecycle. Premature run-button availability observed. |
| M08 | Send repetitions=2 | Two runs → parameter never used | `backend/models/schemas.py:ExperimentRunRequest`, `backend/api/experiments.py:run_experiment`, `ExperimentRunner.run_experiment`. Source-established; extra repetition not executed. |
| M09 | Leave Event Logs open during arbitrary lifecycle/FF events; refresh browser on controller page | General live logs and hydrated history → selective refetch; historical Ryu wrapper unused | `sdnStore.handleWebSocketMessage/fetchEvents`, `App.tsx`, `api.ts:getControllerLogs`. Source and page history behavior inspected. |
| M10 | Observe FF routing after groups install | Actual active/backup path → no FF path; guessed backup | `ControllerManager._handle_parsed_event` ignores ROUTES_SUMMARY; frontend ignores ROUTE_RECOMPUTED; `backend/api/topology.py:get_topology`. Runtime route absence + source confirmed. |
| M11 | Click maintenance cleanup; inspect endpoint | Cleanup-only result → reset/rebuild; error can still produce success alert | `SettingsView.handleCleanMininet`, `sdnStore.resetSimulation` swallows errors, `simulation.reset_simulation`. Reset runtime confirmed; button confirmation dismissed to avoid duplicate mutation. |
| M12 | Request unknown API URL or negative history limit | 404 / bounded validation → 200 null / unbounded history | `backend/main.py:serve_spa`, `backend/api/experiments.py:get_history`, `main.py:get_system_event_logs`, DB LIMIT. Runtime confirmed. |
| M13 | Export history containing invalid/cancelled measurements | Comparable complete dataset and exact run parameters → averages include default values; traffic settings not fully persisted | `AnalyticsView:getAvg/filter`, `database/db.py:save_experiment`, runner summary construction. Source confirmed; cancelled rows exist in test history. |
| M14 | Export HTML with arbitrary stored ID/link strings | Escaped HTML → direct interpolation | `backend/services/report_generator.py:generate_html_report`. Source-only; no script-injection payload executed. |
| M15 | Rapid overlapping controller/simulation requests | Serialized lifecycle → no controller/start-level mutex | `ControllerManager.select_controller`, `MininetClient.start_simulation`, `ExperimentRunner.run_comparison`. Source risk; concurrent destructive lifecycle stress NOT TESTED. |

## 20. Minor Bugs

| ID | Reproduction / symptom | Expected → actual | Files/functions |
|---|---|---|---|
| N01 | Inspect flow/group counts | Count entries → header line counted | `MininetWorker.get_switch_info`; `SwitchInspectorModal` tab labels. Runtime confirmed. |
| N02 | Inspect host access links | Actual TC parameters → hardcoded 10 Mbps/5ms | `MininetWorker.build_network/get_topology`; `FailureSimulatorView`. Source confirmed. |
| N03 | View stopped/missing topology | Offline/unknown equipment → assumed UP links, 4 switches, 2 hosts, fabricated intf names | `TopologyCanvas`, `OverviewView`, `FailureSimulatorView`. Browser confirmed. |
| N04 | Read status uptime after reset/stop | Simulation uptime → time since controller start, still increasing after stop | `backend/api/simulation.py:get_simulation_status`; store uptime never updated. Runtime + source confirmed. |
| N05 | View latest controller logs after changing mode | Mode-specific history → recent_logs contains old controller's lines | `ControllerManager.select_controller/recent_logs`; `ControllersView`. Runtime confirmed. |
| N06 | View null/zero timing or RTT in experiment table | Zero distinguished from missing → falsy 0 displayed None/dash | `frontend/src/pages/ExperimentLabView.tsx` result cells. Source-only. |

## 21. Features That Are Fully Working

Within the explicitly disclosed fixture and tested cases:

- Serving the existing production bundle and navigating all nine sections.
- Correct real controller executable selection when selection is explicitly supplied; correct port/observe-links command construction.
- Real diamond creation, inter-switch administrative link changes, and normal worker network teardown.
- Baseline's intentional no-reroute behavior.
- Reactive alternate-path flow installation with persisted/controller-stream HEALED evidence.
- Real FF group creation and local backup-bucket use without controller recomputation.
- Real host ping generation and reply/last-RTT history parsing for successful packets.
- OVS switch inspector table retrieval, tabs and refresh.
- SQLite persistence, record detail lookup and real report serialization; actual JSON UI download.
- Event list fetching, local filters and search controls.
- Basic server WebSocket connection, initial state, ping/pong and reconnection at the protocol level.

These are component/scenario PASSes, not a claim that the entire dashboard is fully functional.

## 22. Features That Could Not Be Tested

- A successful **native** zero-CLI Mininet start: blocked by actual sudo/runtime setup; no sudoers or dependency repairs were made.
- Successful deletion of existing history: deliberately not executed to honor preservation. Only missing-ID response and dismissed UI confirmation tested.
- Exact end-to-end packet outage, sub-millisecond FF switching latency and sustained-through-restoration Baseline traffic recovery: not established by this finite sampling/run.
- Long-duration load, every rapid-click race, backend restart while a real network remains live, and a completely exhausted worker output pipe.
- Every link/controller combination, downstream FF protection for all possible failures, and exhaustive repeated experiment isolation after repair.
- Server-generated malformed WS frames, every reconnect/unmount timing, and exact server-side concurrent WS count.
- Full physical-pointer React Flow drag/pan/zoom testing.
- Completed HTML browser download; HTML API response was tested. JSON browser download succeeded. No CSV download button exists to click.
- Full archived backend terminal stdout; runtime API/DB/controller/worker error evidence was available.
- A fresh Vite production rebuild: existing dist was preserved. TypeScript checked successfully; oxlint could not load its Windows native binding. No dependency installation or cleanup was performed.

## 23. Recommended Fix Order

1. Repair native worker provisioning and observability: one documented compatible runtime with Mininet access; appropriate privilege configuration; capture worker exit/stderr instead of waiting blindly. Do not mask the failure with permanent manual fixtures.
2. Define one complete topology/state contract for REST and WS; normalize/merge updates and guard absent fields. Eliminate the TopologyView crash and false STOPPED transitions first.
3. Preserve explicit/selected controller mode. Make process state reflect readiness, port ownership and unexpected exits.
4. Establish a clean dataplane boundary when changing modes, especially experiments, without altering the intended Baseline algorithm or the four-switch topology.
5. Validate domain/range input and worker responses. Return meaningful non-2xx failures; log/broadcast only confirmed actions; show errors in the UI. Stop must report uncertainty when the worker cannot be contacted.
6. Correct traffic send/loss accounting and finalize/invalidate job state on traffic stop, network stop/reset and worker failure. Keep real experiment and dashboard telemetry associated with the right job.
7. Make experiment lifecycle/cancellation and finally cleanup reliable; keep comparison locked through all stages; reset per-run events, verify actual active path/discovery and final stats; either implement or reject repetitions.
8. Remove fabricated analytics and unsupported fixed performance claims. Distinguish no-data, failed/cancelled, historical/session and measurement type. Correct healed-event filters and report timing labels.
9. Resolve WS connection ownership/retry cleanup and hydration; then smaller modal/count/config labels and output escaping.
10. Repeat the complete audit natively after those corrections before approving redesign.

## FUNCTIONALITY SCORE

| Category | Score | Reason |
|---|---|---|
| Backend/API | 12/20 | Real useful routes and persistence; false success/error semantics and stale lifecycle state |
| Frontend functionality | 11/20 | All pages and many actions operate; blank-page crash, stale metrics and weak error presentation |
| Frontend ↔ Backend integration | 8/20 | Real HTTP/WS delivery; incompatible state contracts, wrong mode and telemetry ownership |
| Mininet/Ryu/OVS integration | 15/20 | Real three-mode SDN behavior demonstrated; native worker startup fails and mode switches retain dataplane |
| Experiments/Metrics/Reports | 8/20 | Real experiments/storage/exports; invalid comparisons, cancellation leaks and fabricated/misleading analytics |
| **Total** | **54/100** | **Functionality/integration only; no visual-design score** |

This is an engineering assessment of the inspected/tested implementation, not a statistical percentage of exhaustive test cases. Unexecuted scenarios are identified rather than awarded fabricated passes.

## GO / NO-GO DECISION

**Is the project functionally stable enough to begin the UI redesign phase? NO.**

Only the blockers that must be addressed before redesign:

- Native worker launch/runtime/privilege failure (C01).
- Selected controller overridden; dead/unready controllers reported ready/running (C02, C07).
- WS topology contract crash and false simulation state (C03).
- Cross-controller forwarding-state contamination and unreliable comparison lifecycle (C04; M06–M08).
- False success, misleading event logs, swallowed/unrendered operational errors and unverifiable stop (C05; M03–M04).
- Incorrect live loss and stale active traffic after stop/reset; wrong experiment telemetry association (C06, C08).
- Cancellation that fails to stop work or clean up traffic/link state (C09).
- Fabricated analytics, incorrect healed counters and ambiguous recovery/FF timing labels (C10, M10, M13).
- WS retry/connection ownership that undermines reliable live state (M01).

No redesign or bug fix was performed. Approval for a subsequent repair phase remains with the project owner.
