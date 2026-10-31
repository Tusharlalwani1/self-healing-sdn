# Phase 1 — static architecture audit (2026-10-31)

Completed before mutation testing. No application changes made. Existing modifications to Start-SDN-Dashboard.ps1, backend/config.py, backend/services/mininet_worker.py, scripts/start.sh are preserved.

## Integration map

All frontend HTTP calls use services/api.ts fetchJson; state lives in stores/sdnStore.ts. App.tsx hydrates controllers, topology, events and diagnostics, polls topology every 3 seconds and traffic while RUNNING, and opens services/websocket.ts to /ws/events. FastAPI serves frontend/dist.

| UI/control | Frontend action | API | Handler/service | Underlying action / return / UI update |
|---|---|---|---|---|
| Sidebar, all nine pages | setTab/renderActiveView | none | none | local navigation |
| Navbar/controller cards | selectController | POST /api/controllers/select | controllers.select_controller → ControllerManager.select_controller/start_controller | root controller_*.py through ~/sdn-env/bin/ryu-manager, --observe-links, 6653; status and logs via WS; refresh controllers/topology |
| Navbar start | startSimulation | POST /api/simulation/start | simulation.start_simulation → manager, MininetClient | start Ryu then sudo -n worker over Unix socket → build_network; state WS + topology fetch |
| Navbar stop | stopSimulation | POST /api/simulation/stop | simulation.stop_simulation → MininetClient.stop_simulation | worker stop_network, bridge cleanup; state WS + fetch |
| Overview traffic / Traffic Monitor selectors/start/stop | startTraffic/stopTraffic | POST /api/traffic/start,/stop; GET /stats | TrafficService → MininetClient | host.popen(stdbuf ping), monitor thread; stats WS every .3s, 3s HTTP fallback |
| Topology zoom/pan; switch click, refresh, flows/groups/ports tabs | TopologyCanvas; SwitchInspectorModal.fetchDetails | GET /api/topology/switch/{dpid} | topology.get_switch_details → worker.get_switch_info | ovs-ofctl OpenFlow13 dump-flows/groups/ports; local tab display |
| Link modal, topology list, six Failure Simulator cards, presets, Overview quick failure | setLinkStatus | POST /api/links/down,/up | links → MininetClient.set_link_status → worker.set_link_status | configLinkStatus + ip link; DB event, WS topology/event, fetchTopology |
| Restore All (navbar/overview/topology/failure) | restoreAllLinks | POST /api/links/restore-all | links.restore_all_links | six sequential worker calls, WS/events, topology refresh |
| Experiment Lab parameters/start | runExperiment | POST /api/experiments/run | experiments.run_experiment → ExperimentRunner | select controller, start network, warmup, ping, delayed failure, collect, SQLite, restore selected link; WS progress + history refresh |
| Experiment cancel | cancelExperiment | POST /api/experiments/cancel | ExperimentRunner.cancel | flag checked once before failure |
| Experiment history/delete | fetchExperiments/handleDelete | GET /history, DELETE /{id} | SQLite | history store refresh; confirmation before deletion |
| Experiment HTML/CSV export | getExportUrl anchor | GET /api/reports/{id}/export | ReportGenerator + SQLite | download response |
| Analytics | useMemo(experimentsHistory) | no own request | store history only | averages plus hardcoded no-data fallbacks |
| Event logs refresh/filter/search | fetchEvents/local filtering | GET /api/events/logs | main.get_system_event_logs → SQLite | most recent 100 persisted events |
| System recheck | fetchSystemStatus | GET /api/system/status | system.system_status | sudo ovs-vsctl, which mn, socket probe; store display |
| System Clean Mininet State | handleCleanMininet → resetSimulation | POST /api/simulation/reset | stop then start worker | RESTARTS network; misleading cleanup label; swallowed store errors |

## Pre-runtime findings to verify

- Analytics fabricates no-data loss/RTT/recovery values and unconditional performance claims; does not hydrate history on direct navigation.
- Worker returns status:error in HTTP 200 responses; client/services and frontend commonly ignore status. Link errors can be logged as successful actions.
- Controller READY is assigned even if port_ready=false; unexpected process exit does not update manager state. UI ACTIVE RUNNING depends on selected ID, not status.
- Simulation start default request is reactive, potentially overriding selected mode when UI omits controller argument.
- Worker topology WS payload omits simulation_state/active_paths although frontend replaces its complete topology and assigns simulationState from it.
- FF route summaries are parsed but ignored by manager; ROUTE_RECOMPUTED ignored by frontend; no actual FF active-path telemetry.
- Overview recovery count includes controller READY SUCCESS records; history has no session boundary.
- Live ping transmitted count advances only when replies arrive; all-loss intervals freeze count/loss. RTT aggregate is parsed only from final summary.
- Experiment repetitions unused; cancellation checked only once; no guaranteed traffic/link cleanup on errors/cancel; fixed link not checked against actual active path; recovery event not reset on same-controller repeat; comparison has no outer lock.
- Link modal keeps object snapshot after topology updates. WS reconnect timers are not canceled and App effect reconnects on every simulation-state change.
- No UI consumer renders store.error. Stop/reset/restore swallow errors in some paths.
- Unused frontend wrappers: health, controller stop/log history, simulation status. Backend reset/reports export-all/detail routes exist; export-all has no UI control.
- Worker preserves the specified four-switch, two-host diamond. Root controllers are the configured executable sources; SDN_controllers and report_command_snips contain alternate/reference copies.

Runtime preflight: existing WSL backend PID 5677, simulation STOPPED, no selected controller. sudo -n ovs-vsctl fails with password required; worker startup uses this same noninteractive sudo path. No browser automation tools are exposed; local browser automation availability will be checked.
