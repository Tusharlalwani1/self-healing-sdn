# C10 — Analytics / metric truthfulness verification

Status: C10 implemented; automated results below. Live Mininet/Ryu/OVS and browser verification remains pending. No redesign, network topology change, new performance instrumentation, commit or push. This report distinguishes source tracing, fake-IO tests, server-rendered UI tests and actual runtime evidence.

## 1. Confirmed findings and earlier fixes

The current production frontend, routes, schemas, database, worker, runner, controller manager/parser, exports and configured controller scripts were inspected before edits. Findings were confirmed from executable paths and focused tests; no live pre-change SDN run is claimed.

| Concern | Current finding / correction |
|---|---|
| Demo analytics when no history | Confirmed. AnalyticsView inserted Baseline loss 83.3, RTT 20.4, Reactive processing 15.2 / RTT 20.3, FF processing 3.4 / RTT 20.1, plus zero loss and zero Baseline recovery. Removed all numeric performance fallbacks. |
| Fixed performance claims | Confirmed. Summary cards claimed 10–20 ms recovery and 0% loss/sub-ms FF. Replaced with actual completed-record averages or N/A. Controller description, FF parser note and FF runtime log no longer claim observed local switching timing. |
| Invalid analytics samples | Confirmed. All statuses were grouped; cancelled/failed runs could enter averages. Only COMPLETED records now contribute; each metric has its own non-null denominator. |
| Null replaced with zero | Confirmed in no-sample averages, DB save defaults, experiment schemas, OVS count badges and exports. Corrected to null/N/A where a measurement is absent. Legitimate zero remains zero. |
| Missing Rx/loss silently defaulted | Confirmed in runner. Final accounting now requires real integer Tx/Rx and a loss field; missing data fails rather than borrowing configured totals or zero. |
| Historical events presented as live healing KPI | Confirmed. Overview counted all SUCCESS/CONTROLLER log records as healed events and used an ambiguous timing label. It now counts only typed HEALED/ROUTE_RECOMPUTED timing records and explicitly labels loaded history. |
| Unsupported topology state | Confirmed. Canvas manufactured nodes/UP links/interfaces before hydration; Overview fell back to 4 switches / 2 hosts; link pages assumed missing=UP; backend guessed backup_paths. Removed those fallbacks without changing actual Mininet topology or layout coordinates. |
| Unsupported bandwidth/delay | Confirmed. Worker returned 10 Mbps/5ms for every link, including host links with no explicit shaping. It now reads interface configuration; UI labels configuration and shows N/A when absent. |
| OVS flow/group counts | Confirmed overcount. Badges counted raw dump lines, including protocol headers, and showed zero when not queried. Counts now derive from cookie=/group_id= entries; missing query=N/A. Stale switch replies are guarded. |
| Timing precision and boundary | Confirmed wall-clock elapsed subtraction in controller/worker/runner. Elapsed intervals now use monotonic clocks. Numeric controller logs remain one-decimal milliseconds, with processing-only terminology. |
| Fake CPU/memory/utilization/throughput | Not found in active UI/services. No such instrumentation is added. Cpu icons indicate controller sections, not CPU percentages. |
| Elapsed-time packet estimation | Already fixed by C06. Parser/SIGQUIT/final ping accounting is authoritative; timers request snapshots rather than generating packets. Parser formulas are unchanged. |
| Wrong experiment/job/controller telemetry | Already protected by C08. Exact job/runtime/experiment/generation validation remains. C09 cleanup and terminal states remain. |
| Late completion after cancel | C08/C09 already guard run ownership and wait for cleanup. C10 only makes incomplete benchmark fields null and excludes non-completed records from performance aggregates. |

## 2. Metric provenance table

Classes: **A** directly measured/queried state; **B** derived from measured data; **C** estimate or workflow approximation, explicitly labelled; **D** unavailable/not instrumented; **E** fabricated or misleading before C10. Configured inputs are identified separately in the source column: they are not measured network performance. “Current” means the latest backend snapshot, not a guarantee of continuous sensor coverage.

| Metric / visible field | Frontend location | Exact backend/source | Class and formula | Units | Lifecycle / ownership; live or historical | Fix |
|---|---|---|---|---|---|---|
| Selected controller name / mode | Overview, navbar, sidebar, Controllers | ControllerManager.active_controller via API/WS | A, managed selection | mode | Current selection, may exist while FAILED | Existing C07 state retained |
| Controller READY/FAILED/STOPPED; PID / exit code / reason | Controllers/navbar; API diagnostics | Managed process + owned listener / C07 reconcile_health | A | state, PID, exit code | Current managed process generation | Descriptions corrected; no fake performance |
| Simulation state | Overview/navbar/sidebar | MininetClient confirmed lifecycle | A | state | Current runtime UUID/revision | C08 retained |
| WS indicator | Navbar | WebSocket connection callbacks | A, transport connection only | boolean | Current browser socket | WS CONNECTED; not claim all values live |
| Controller stdout / log badge | Controllers | Ryu stdout/stderr + WS LOG_LINE, bounded buffer | A | text / line index | Process log buffer, may retain older lines | LOG BUFFER when disconnected/not READY |
| Switch count | Overview | Worker switch list -> normalized topology | B, length(switches) | switches | Latest topology snapshot | Removed fallback 4 |
| Host count | Overview | Worker host list | B, length(hosts) | hosts | Latest topology snapshot | Removed fallback 2 |
| Active/failed link count | Overview | Worker checks both intf.isUp() endpoints | B, count status UP / DOWN | links | Latest topology snapshot | No missing links inferred |
| Link UP/DOWN / node presence | Canvas, failure page, topology, inspectors | Actual worker nodes/links/interfaces | A | state | Current/latest runtime topology | E -> A/D; no default-UP diagram or fake interfaces |
| Interface name, IP, MAC, DPID, port number / state | Canvas / inspectors / topology | Actual worker node/interface metadata | A, identity/configuration queried | identifiers / state | Latest topology | No generated interface fallback |
| Switch port count | Canvas node | Worker port mapping | B, Object.keys(ports).length | ports | Reported node snapshot | Real reported map; not switch flow count |
| Configured link bandwidth | Link modal/failure cards | intf.params.bw, queried configuration | A configuration, **not throughput** | Mbps | Current interface configuration | Removed universal 10 Mbps default |
| Configured link delay | Link modal/failure cards | intf.params.delay | A configuration, **not measured RTT** | configured delay string | Current interface configuration | Removed universal 5ms default |
| Reported forwarding path | Topology / highlighted core edges | Ryu parsed ACTIVE_PATH, ControllerManager.active_paths | A controller report, not independent packet trace | ordered switches | Last report from controller context | Static branch labels no longer claim which route is active |
| Verified backup path | API topology | No verified backup-path telemetry | D | path | No live sample | Removed guessed path; [] means none reported |
| OVS flow count | Switch inspector | ovs-ofctl -O OpenFlow13 dump-flows | B, number of cookie= entry lines | entries | On-demand switch snapshot | Exclude header; missing=N/A; late switch response guarded |
| OVS group count | Switch inspector | ovs-ofctl dump-groups | B, number of group_id= entry lines | groups | On-demand switch snapshot | Exclude header; not all groups presumed FF |
| OVS port counters/raw flow/group entries | Switch inspector | Actual dump-ports/flows/groups stdout | A | switch-native counters/text | On-demand snapshot | Retained; no invented throughput from these lines |
| Traffic job identity / ACTIVE, FINAL, IDLE | Traffic Monitor / Overview | Worker + TrafficService owner/cache; C08 | A | state / IDs | Exact manual job/runtime; final values retained inactive | C08 retained; chart titles say Traffic Job |
| Tx | Traffic Monitor / Overview | PingAccounting final/SIGQUIT counters | A actual attempted echo requests | packets | Exact manual job; live snapshot or final | C06 unchanged; never count*elapsed |
| Rx | Traffic Monitor / Overview | Ping valid reply counters | A | replies | Same owned job | C06 unchanged |
| Packet loss | Traffic Monitor / Overview | C06 counters | B, 100*(Tx-Rx)/Tx for Tx>0, rounded by parser | % | Same owned job | Tx=0 displays N/A; internal C06 idle sentinel 0 retained |
| Avg RTT | Traffic Monitor / Overview | iputils live/final RTT statistics | A ping summary of successful replies | ms | Same job; successful replies only | Overview accepts real zero; no replies=N/A |
| Min / max RTT | Traffic Monitor | Ping min/max summary | A | ms | Same owned job | Existing nullable values retained |
| Last RTT | Overview | Last exact successful reply time= value | A | ms | Same owned job | Null/zero distinguished; time< upper bounds not invented as exact samples |
| Last timed reply sequence | Traffic Monitor | Last retained successful RTT history item.seq | A, not total Tx | sequence | Same job, bounded history | Missing=N/A, label clarifies meaning |
| RTT chart X/Y | Overview / Traffic Monitor | PingAccounting.history seq/rtt | A per exact successful reply; no synthetic loss points | sequence / ms | Same job, last 200 samples; may be final | No demo points; chart not network outage measurement |
| RTT history t / traffic duration | API/WS history, traffic diagnostics | Monotonic elapsed at stdout processing/reader completion | B, now-started_monotonic | seconds | Exact worker job | Was wall clock; t is rounded read-time, not a packet clock |
| Processing event count | Overview | Loaded SQLite events with type HEALED/ROUTE_RECOMPUTED and numeric duration | B, length(filtered loaded records) | events | Historical loaded window (default 100 events), not session/lifetime total | Old Healed Events count corrected and labelled |
| Latest controller processing | Overview | Latest such loaded log details.duration_ms | A from Ryu timed event | ms | Historical event, not active-controller benchmark | Processing label, no sub-second outage promise; zero retained |
| Experiment history count | Experiment Lab | Loaded get_experiments rows | B, history.length | records | Historical loaded window (default 50) | Retained; not total DB count |
| Experiment execution status | Lab / navbar / history | C09 terminal decision / owned task | A | state | Exact parent run / child record | FAILED/CANCELLED not successful samples |
| Experiment start/end dates | History / reports / API | Backend datetime at request / post-cleanup terminal boundary | A wall-clock observations | ISO datetime | Exact record, historical | Wall timestamps retained for dates |
| Failure link / injection timestamp | History, report, summary | Requested pair + runner time.time before down IPC | A configured pair / action timestamp | names / epoch sec | Exact experiment | Not a timestamp of actual packet interruption |
| Configured packet count / interval / failure delay | Experiment form / traffic_params | Validated user configuration | Input, not observed performance | packets, seconds | Exact request | Never used as observed transmitted totals |
| Experiment Tx / Rx | History / reports | Exact owned drained final worker job | A | packets | COMPLETED benchmark only; cancelled drain remains summary.final_traffic diagnostic | Missing/incomplete=None; no configured fallback |
| Experiment packet loss | History / reports | Exact job final loss validated with C06 counters | B, same Tx/Rx formula | % | Historical completed run; Tx=0 unavailable | No default zero for missing/failed data |
| Experiment min / avg / max RTT | History / reports / API | Exact final ping statistics | A | ms | Historical completed run; no replies unavailable | Nullable end-to-end; zero preserved when supported |
| Experiment processing event/type | History / JSON/CSV/HTML | C08-associated new Ryu event, matching runtime/generation/experiment/link/time | A | event type | Exact completed experiment | Baseline has no healing measurement; unrelated events excluded |
| recovery_duration_ms legacy field | History / reports / Analytics | Ryu controller event duration, not ping disruption | A controller processing | ms | Exact associated event | Field name retained for compatibility; all display/export semantics corrected |
| Experiment duration_sec | Summary / API/JSON | Monotonic experiment entry -> cleanup complete / pre-persistence terminal point | B, end-start | seconds | Exact child run; includes setup/traffic/cleanup | Explicit boundary; does not mean downtime |
| Workflow progress | Navbar / Experiment Lab | Fixed runner phase milestones | C workflow approximation, **not time/packet completion** | stage % | Current owned run | Label Stage and milestone tooltip; no fake 5% bar fallback |
| Mean loss chart / Baseline loss card | Analytics | Loaded COMPLETED records grouped by recorded controller | B, unweighted sum(valid run loss)/number of measured run losses | % | Historical loaded window only | No demo series; failed/cancelled/null excluded |
| Mean controller processing chart / Reactive+FF cards | Analytics | Loaded COMPLETED measured controller events | B, mean(non-null processing duration); Baseline unavailable | ms | Historical recorded mode, not current mode | No hardcoded times; not FF switch time/outage |
| Mean RTT calculation | Analytics helper, not currently a separate visible chart | Loaded completed avg_rtt_ms values | B, unweighted mean of measured run means | ms | Historical group; null/no replies excluded | No default synthetic RTT values |
| Measured sample counts | Analytics cards | Same aggregate filters | B, exact number of eligible measured records per metric | samples | Historical loaded window | Zero sample count is legitimate, not zero performance |
| JSON / CSV / HTML performance fields | Report downloads | Same normalized stored experiment fields | A/B as above | packets, %, ms | Historical record; no live fallback | JSON null; CSV/HTML N/A; explicit timing scope |
| OS / Python version | System & Config | platform.system/python_version | A | strings | On-load/manual check snapshot | Missing=N/A, no fake Python 3.10.12 |
| Controller TCP port/listener indicator | System & Config | Configured port + socket.connect_ex | A configured port / TCP reachability | port / boolean | Diagnostic snapshot | Does not claim verified Ryu identity or switch connection |
| Mininet availability | System & Config | shutil.which('mn') | A executable availability | boolean | Diagnostic snapshot | No unsupported fixed installation path |
| OVS diagnostic | System & Config | ovs-vsctl show return code | A OVSDB reachability | boolean | Diagnostic snapshot | Renamed from stronger whole-service claim |
| API health/time | /api/system/health (no KPI chart) | Endpoint response + backend wall clock/platform | A API liveness only | state / epoch sec | Request-time backend, not whole SDN health | No health percentage introduced |
| Event timestamps / loaded log records | Event Logs / failure timeline | SQLite timestamps / source-tagged events | A dates; B loaded row count | epoch/time, records | Historical loaded window | No implied unique failure/heal count |
| CPU / memory / utilization | Not instrumented/displayed as metrics | None | D | N/A | No source | No replacement values added |
| Throughput / packets per second | Not implemented as measured KPI | None | D | N/A | No source | Config interval/bandwidth not relabelled as measurements |
| Packet-level outage / end-to-end recovery / local FF switching | No such instrumented metric | None | D | N/A | No packet-level measurement boundary | Explicitly not measured in analytics/exports |
| Network health % / controller success-rate % / uptime KPI | Not implemented | None | D | N/A | No source | No fabricated percentages or durations added |

Topology configuration, DPID/IP values and diamond layout coordinates are legitimate configuration/identity rather than invented performance. The worker's four switch-switch links remain configured at 10 Mbps/5ms; host links have no explicit bw/delay in build_network. Their missing configuration is not measured zero and now displays N/A.

## 3. Measurement boundaries and terminology

Reactive controller timing starts at link-delete handler entry, includes topology rebuild and the controller's healing loop up to each HEALED log. Flow programming is submitted through Ryu; the timer does not wait for packet resumption or prove switch barrier completion. Multiple destination/path log events can arise from one physical failure; event count is not unique healed failures.

FF timing starts at link-delete handler entry and ends after rebuild / _install_all_routes. It measures later controller recomputation, not local bucket selection. The old text “switches had already failed over locally” was an unverified assertion; active FF logs/parser notes now say local timing is not measured. Baseline has no automatic recovery and no controller-healing duration. Neither controller algorithm was changed; only elapsed clock choice and FF log wording changed.

`time.perf_counter()` now measures active controller durations. Worker job duration/history read timestamps and runner collection deadlines/duration use `time.monotonic()`. Epoch wall clocks remain for event/injection dates and C08 event association. Existing parser output has one-decimal millisecond timing; the UI does not claim finer network timing from the 0.5-second experiment polling loop. The diagnostic experiment duration ends after cleanup and before SQLite/event publication, not at first returned traffic packet.

## 4. Analytics corrections and null semantics

Analytics fetches actual history on entry. There is no analytics seed/demo endpoint. Empty history returns [] and shows no completed-data message; no fabricated controller rows are inserted. If completed records exist but no value was measured for a chart, that chart shows unavailable/no measured samples.

Only status=COMPLETED records feed historical performance comparisons. Every metric independently excludes null/undefined/nonfinite values; legitimate zero contributes to its denominator. Means are unweighted means of experiment-level measurements, not pooled packet means. A 5ms record plus a null record yields 5ms over one measured sample, not 2.5ms over two. Missing controller groups do not acquire zero-loss/default-recovery bars. Baseline's processing duration is unavailable rather than a misleading zero that would imply fastest recovery.

For Tx=0, percentage loss has no defined denominator and displays N/A; C06's internal empty/live-zero sentinel is left unchanged. Rx=0 has no successful-reply RTT. Historical records are normalized on read: failed/cancelled performance fields are null, without updating/deleting original rows. This masks old zero defaults while preserving raw diagnostic summary data. Successful legacy records remain available; records without provenance cannot be retroactively certified as clean C08-owned measurements merely by C10.

## 5. Experiment and database changes

Current experiments still require exact C08 job/runtime/experiment/controller generation and C09 cleanup. Missing final Tx/Rx/loss no longer defaults to zero; it produces a truthful failed run. New cancelled/failed records expose benchmark fields as null; actual drained counters remain diagnostic summary.final_traffic. Even cancellation after full collection cannot become a successful aggregate sample. Summary IDs and diagnostic counters remain attached to their original owner.

New database creation uses nullable performance columns; saves explicitly insert None for missing data. Existing SQLite columns already allow NULL, so no migration or historical rewrite is needed. Read normalization masks unavailable old failed/cancelled benchmark values but leaves stored history unchanged. Existing run/job/controller IDs are not reassigned. Summary_json may retain original diagnostic data for older records; performance analytics reads eligible top-level fields only.

## 6. Reports / export compatibility

HTML shows N/A for absent loss, counts and every RTT; it labels the historical experiment controller and Controller Processing / Recomputation. CSV writes N/A for absent values and replaces its ambiguous recovery_duration_ms column heading with controller_processing_ms plus timing_scope. Consumers importing that CSV heading must adjust. JSON keeps the persisted legacy recovery_duration_ms key and adds metric_semantics explaining processing-only scope and unavailable outage/local-FF timing. Export-all JSON preserves arrays/nulls. Exports preserve failed/cancelled status and do not promote them to successful performance samples.

No report makes a stronger recovery claim than the logs. Raw historical controller output text can still contain earlier wording; C10 does not rewrite historical logs or delete experiments.

## 7. Historical versus live

C08 owner/revision handling remains unchanged. Manual job final RTT/counts may remain visible, explicitly FINAL/IDLE; they do not borrow the last experiment's values. Experiment records and Analytics are historical, grouped by the controller stored with each run. Analytics says loaded history only (default 50 records), not whole-database or current-session averages. Overview processing KPI says loaded event history (default 100 records), not current session/lifetime total.

WS CONNECTED is a transport state, not proof every individual value is fresh. Topology is the latest reported snapshot; independent continuous OVS polling is not added. OVS table inspection and system diagnostics are on-demand snapshots. A missing topology/OVS response no longer creates a healthy diagram or zero-entry measurement. Layout/colors remain unchanged; absence of data can leave an empty canvas rather than inventing runtime state.

## 8. Exact files changed

| File(s) | Function/component and change |
|---|---|
| backend/services/metrics.py | experiment_metrics / PERFORMANCE_FIELDS / TIMING_SCOPE: shared benchmark eligibility and null semantics. |
| backend/database/db.py | init_db/save_experiment/get_experiments/get_experiment_by_id: nullable writes/read normalization, no historical deletion. |
| backend/models/schemas.py | ExperimentRecord nullable counters/loss; LinkInfo unavailable config defaults. |
| backend/services/experiment_runner.py | _run_single: final accounting completeness, incomplete benchmark nulls, monotonic deadlines/duration, timing scope. |
| backend/services/mininet_worker.py | get_topology: actual interface configuration; _monitor_traffic: monotonic elapsed. C06 parser/counter math unchanged. |
| backend/services/controller_manager.py | get_controller_info/_handle_parsed_event: remove unsupported FF precision/observation claims. Lifecycle logic unchanged. |
| backend/services/log_parser.py | FF event note accurately scopes controller recomputation. Regex unchanged. |
| backend/services/report_generator.py | JSON/CSV/HTML unavailable values and timing semantics. |
| backend/api/topology.py | get_topology no longer fabricates backup_paths. |
| controller_reactive.py / controller_ff.py | Monotonic processing stopwatch; FF log no longer asserts local switching observation. Algorithms unchanged. |
| frontend/src/services/metrics.ts | Shared measured-number formatter, completed-record comparisons/counts, topology/log/OVS count derivations. |
| frontend/src/types/index.ts | Nullable experiment fields and optional configured bandwidth/delay. |
| frontend/src/pages/AnalyticsView.tsx | Remove demo values, fetch history, aggregate measured completed samples, empty states and accurate copy. |
| frontend/src/pages/OverviewView.tsx | Real topology counts, null/zero display, scoped loaded processing history, job chart labels. |
| frontend/src/pages/TrafficView.tsx | Tx=0 loss unavailable, timed-reply sequence semantics, final-job chart wording. |
| frontend/src/pages/ExperimentLabView.tsx | Nullable table fields, processing heading, branch labels, workflow-stage copy. |
| frontend/src/pages/TopologyView.tsx / FailureSimulatorView.tsx | Missing links unavailable; no assumed primary/backup use; configuration labelled. |
| frontend/src/pages/SettingsView.tsx | No fixed OS/Python fallback; scope TCP/mn/OVS checks accurately. |
| frontend/src/pages/ControllersView.tsx / components/TopNavbar.tsx | Log buffer / WS transport scope and workflow stage label. |
| frontend/src/components/topology/TopologyCanvas.tsx | Use reported nodes/links/inspectors; remove made-up runtime objects. Coordinates and actual network unchanged. |
| frontend/src/components/topology/SwitchNode.tsx | Correct protocol label OpenFlow 1.3 (not OVS version 1.3). |
| frontend/src/components/modals/LinkInspectorModal.tsx | Configuration label, missing=N/A. |
| frontend/src/components/modals/SwitchInspectorModal.tsx | Entry counts exclude headers; missing=N/A; request/version and switch identity guard stale table responses. |
| backend/tests/test_metric_truthfulness.py | Focused persistence/API/export/owned-run/configuration tests with temporary DB/fake IO. |
| frontend/tests/metric-truthfulness.test.tsx | Aggregate/formatter/provenance tests and server-rendered UI assertions. |
| backend/tests/test_experiment_cleanup.py | Timeout fixture supplies monotonic clock; same C09 timeout assertions retained. |
| reports/C10-METRIC-TRUTHFULNESS-VERIFICATION.md | This report. |

frontend/dist was rebuilt for FastAPI and remains ignored. Root controllers are selected by backend/config.py; duplicate SDN_controllers and report_command_snips files are not the dashboard controller entrypoints and were not rewritten.

## 9. Automated verification

Focused C10 backend: empty SQLite/history API; nullable model/API persistence; measured zero; failed/cancelled diagnostics; old failed zero rows masked without rewriting DB; report JSON endpoint; no invented backup route; HTML/CSV/JSON unavailable and timing semantics; Baseline unavailable timing; C06 outage/loss; exact owned no-reply experiment; incomplete final counters fail; cancelled run diagnostic-only; queried link configuration including unshaped host link and both-endpoint state.

Focused C10 frontend: empty history/no demo values; completed-only samples; null denominator and sample counts; controller attribution/Baseline unavailable; zero versus N/A; Tx=0/no replies; real topology counts; typed processing-history count; OVS headers versus entries; actual Analytics labels; traffic 100% loss with N/A RTT; history null/zero rendering. React server rendering is used, not a live browser or browser console test.

Final validation: **120 backend tests passed** (16 C10 + 104 existing), and **55 frontend tests passed** (12 C10 + 43 existing). Focused C10 also passed separately. Application/test TypeScript checks, Python compilation, production build and git diff --check passed. Lint: **26 pre-existing warnings plus one request-generation cleanup warning, zero errors**. The new warning concerns reading a generation counter ref during effect cleanup; invalidating the latest generation is intentional, not reading a DOM node. Existing large-chunk build warning and FastAPI on_event deprecations remain.

Exact commands, run with existing WSL Ubuntu-22.04 tools (repository root unless noted):

```bash
/home/i7__6thgen/sdn-env/bin/python3 -m unittest backend.tests.test_metric_truthfulness -v
/home/i7__6thgen/sdn-env/bin/python3 -m unittest backend.tests.test_experiment_cleanup backend.tests.test_telemetry_ownership backend.tests.test_traffic_accounting -q
/home/i7__6thgen/sdn-env/bin/python3 -m unittest discover -s backend/tests -q
/home/i7__6thgen/sdn-env/bin/python3 -m py_compile backend/api/topology.py backend/database/db.py backend/models/schemas.py backend/services/metrics.py backend/services/controller_manager.py backend/services/experiment_runner.py backend/services/log_parser.py backend/services/mininet_worker.py backend/services/report_generator.py backend/tests/test_metric_truthfulness.py backend/tests/test_experiment_cleanup.py controller_reactive.py controller_ff.py
cd frontend
export PATH=/home/i7__6thgen/.nvm/versions/node/v24.22.2/bin:/usr/local/bin:/usr/bin:/bin
node node_modules/typescript/bin/tsc -b
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target es2023 --module esnext --moduleResolution bundler --lib es2023,dom --types node --skipLibCheck --allowSyntheticDefaultImports --jsx react-jsx tests/metric-truthfulness.test.tsx tests/experiment-cleanup.test.ts tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts
node node_modules/rolldown/bin/cli.mjs tests/metric-truthfulness.test.tsx tests/experiment-cleanup.test.ts tests/telemetry-ownership.test.ts tests/controller-exit.test.tsx tests/runtime-errors.test.ts tests/topology.test.ts tests/traffic-accounting.test.ts --platform node --format esm --dir node_modules/.tmp/c10-tests
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c10-tests/metric-truthfulness.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c10-tests/experiment-cleanup.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c10-tests/telemetry-ownership.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c10-tests/controller-exit.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c10-tests/runtime-errors.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c10-tests/topology.test.js
node --test /mnt/e/Projects/self-healing-sdn/frontend/node_modules/.tmp/c10-tests/traffic-accounting.test.js
npm run lint
npm run build
cd ..
git diff --check
```

Standalone TypeScript commands were also run using Windows Node on the same files. The final extra provenance test initially used an unhashable fake interface with a ports map; the fixture was corrected, not production behavior. Tests use temporary DB files and mocked SDN IO; existing C06/C09 loopback process tests remain real local subprocess tests. Expected injected error logs in regression tests are not unhandled production failures.

## 10. C01–C09 regression status

C01 worker interpreter/startup and C02 selection are unchanged. C03 merge/hydration remains; removing fake display data does not change topology wiring or normalization. C04 dataplane reset/controller selection and C07 watcher/process semantics remain, with tests rerun. C05 HTTP/error propagation remains truthful. C06 PingAccounting/SIGQUIT/final drain formulas are unchanged; monotonic time only affects elapsed metadata. C08 IDs/registry/ownership remain unchanged and tested. C09 exact-resource cleanup, cancellation joins, comparison workflow and terminal states remain tested; only timeout's fake clock changed to match a monotonic deadline. No actual production history was changed by tests.

## 11. Static fabrication search findings

Production search command:

```powershell
rg -n -i 'random|fake|mock|placeholder|demo|sample|synthetic' frontend/src backend/api backend/models backend/database backend/services controller_baseline.py controller_reactive.py controller_ff.py
rg -n 'recovery|Recovery|Sub-|Mbps|5ms|throughput|utilization|memory|health' frontend/src backend/services backend/api
```

Manual interpretation: randomUUID is run identity, not metric generation. _sample_traffic requests real ping SIGQUIT snapshots; it never estimates Tx. PingAccounting's “sample” comment describes avoiding an invented exact RTT for time< values. lossSamples/processingSamples/rttSamples count actual eligible values. EventLogs placeholder attributes are search-box hint text/CSS, not data. Static numeric values in coordinates, UI sizes, user packet/interval choices, OpenFlow port/version, timeout limits, workflow milestones and TCLink configuration are not sensor readings.

Removed runtime fallbacks include analytics demo values, timing guarantees, default node/link health, guessed backup paths, manufactured interface names, OVS header line counts, unsupported Python/config defaults and numerical zeros for unavailable benchmark data. Parser comments still contain example log numbers (15.2/3.4); they are regex documentation, not values emitted to UI. Historical logs and inactive controller copies may contain earlier timing wording; no active dashboard code calls them. No production Math.random/random.uniform/random.randint performance source was found. No fake CPU/memory/throughput/network-health percentage was substituted.

## 12. Final consolidated runtime checklist (pending)

Reload backend, the confirmed project worker and root controller scripts using the normal project procedure; hard-refresh rebuilt frontend. Stop existing work normally first; do not kill unrelated Python processes or run mn -c after Ryu starts. Record controller PID/generation, runtime ID, experiment/job IDs, API/WS payloads, OVS state and UI values. Do not judge success from HTTP 200 or colors alone.

**A — No history:** use an isolated test copy/database with no records; preserve the real DB, do not delete it to manufacture this condition. Analytics must show no completed-data/no measured-sample messages, no Baseline/Reactive/FF performance numbers. Before topology hydration there must be no fabricated UP network or 4/2 count fallback. In normal production, existing history legitimately remains visible as history.

**B — Baseline:** run a real completed experiment, determine the actual active path, fail a link on that path, inspect packet loss and restore it. Baseline must not automatically reroute. Compare Tx/Rx/loss/RTT with final ping and exact stored record; processing duration should be N/A, never 0ms “fast recovery.” The configured failure target is not proof it was carrying traffic.

**C — Reactive:** run a completed owned experiment on an active-path link. Match new HEALED log duration with experiment recovery_duration_ms, event ownership and UI Controller Processing. Inspect changed OVS flows/path and packet behavior. The value is handler processing/submission time, not measured network disruption.

**D — FF:** verify actual OVS type=ff groups, primary/backup watch_port buckets and referring flows before failure. Run the experiment, inspect connectivity and compare any ROUTE_RECOMPUTED duration with persisted/UI processing value. Local bucket switching time remains not measured; no sub-ms/zero-loss guarantee should be displayed.

**E — Three-way comparison:** run all three modes; group only their completed records by recorded controller, not current dashboard selection. Recompute each mean manually using the non-null sample count. Include a record without a measured duration: it must not contribute zero to the timing mean. Confirm Analytics states loaded history only.

**F — 100% loss:** use continuous manual h1->h2 traffic in a safe test session, fail its active link under Baseline, and observe real increasing Tx, Rx=0, loss=100%, RTT=N/A. Compare ping snapshots, API stats and dashboard. Tx is not elapsed/configured-count arithmetic. When Tx=0, loss display is N/A, not a measured 0%.

**G — Restore traffic:** restore the exact link; real reply RTT samples should resume and cumulative counters remain C06-authoritative. Complete/stop the job, confirm final summary and inactive FINAL/IDLE state. Final values must not be labelled live or reassigned after controller switching/restart (C08).

**H — Timing / topology / OVS:** inspect every processing heading, sample count and export. Compare switch/host/link counts to Mininet/ovs-vsctl and endpoint interface states. Check host-link configuration is unavailable when no shaping was set, versus configured 10Mbps/5ms on core links. Flow/group badge counts must match actual entries excluding dump headers. Switch inspector must not show another switch's old response after changing selection.

**I — Cancel:** cancel a long experiment before/during failure. C09 cleanup should stop only its job and restore only its owned link. History=CANCELLED, benchmark values N/A; diagnostic final_traffic may retain real drained values. Analytics means/sample counts must not change as if the cancelled run were successful.

**J — Fail:** observe a controlled worker/controller/operation failure in a test environment. Expect FAILED, truthful API error, applicable C09 cleanup and unavailable benchmark fields. No zero RTT/loss should replace missing measurements. Historical failed records remain stored; read masking must not delete/rewrite them.

**K — Reports:** download JSON, CSV, HTML and export-all for completed/no-reply/cancelled/failed records. Compare values with GET /api/experiments/{id} and SQLite top-level fields/summary. Missing JSON metrics=null; CSV/HTML=N/A; actual zero remains zero. CSV processing heading and JSON metric_semantics must agree with controller logs. No export should claim packet-level outage/local FF duration.

Useful read-only commands (substitute actual experiment ID):

```bash
curl -s http://localhost:8000/api/topology
curl -s http://localhost:8000/api/traffic/stats
curl -s 'http://localhost:8000/api/experiments/history?limit=50'
curl -s http://localhost:8000/api/experiments/ACTUAL_ID
curl -s 'http://localhost:8000/api/reports/ACTUAL_ID/export?format=json'
sudo ovs-vsctl list-br
sudo ovs-ofctl -O OpenFlow13 dump-flows s1
sudo ovs-ofctl -O OpenFlow13 dump-groups s1
sudo ip -br link
```

The manual TrafficService endpoint is not the experiment stream. Use the experiment's summary job/owner and stored final result for its comparison. Save browser console/backend logs during live checks; automated SSR tests do not certify browser interaction or a clean browser console.

## 13. Remaining limitations / stop condition

No live Mininet/Ryu/OVS/browser test was run for C10. Actual packet-level disruption, local FF switch latency, throughput, CPU/memory/utilization and a whole-network health percentage remain unavailable. New instrumentation would be a separate task; none is fabricated here.

Historical means cover loaded records and are unweighted run averages; they do not control for differing traffic configuration/failure target/contention. A valid processing sample proves a controller event was timed, not that a packet-level outage recovered within that duration. Current diagnostics/topology are snapshots and can become stale between queries; WS connectivity is not measurement freshness. RTT history contains successful exact samples only, so gaps are not direct outage estimates. Legacy completed records without C08 identity cannot be retroactively proven to have clean ownership; no historical records were indiscriminately deleted.

Existing historical logs/summary_json retain their original text/data. Failed/cancelled top-level benchmark fields are unavailable for performance comparison, while owned final traffic remains diagnostic evidence. External CSV importers must adopt controller_processing_ms. Existing lint/deprecation/chunk warnings are documented separately from errors. Graceful cleanup limitations from C09 (power loss/SIGKILL/unavailable worker) are unchanged.

Stop after C10 implementation and automated verification. Await review; no topology expansion, redesign, commit or push.
