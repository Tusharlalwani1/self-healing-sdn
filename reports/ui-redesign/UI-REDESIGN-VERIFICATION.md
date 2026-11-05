# Self-Healing SDN — UI Redesign & Verification

Date: 2026-11-04. Scope: the public landing page and all nine existing dashboard pages. No commit, push, publication, backend rewrite, controller rewrite, or network topology change.

## Architecture audit and baseline

The audit preceded implementation. The repository initially had no URL router: `App.tsx` switched pages using Zustand's `currentTab`. `main.tsx` mounted React StrictMode; Tailwind v4 and `index.css` supplied the presentation. React Flow rendered topology, Recharts rendered measurements, and Lucide supplied icons. Shared sidebar, runtime bar, and switch/link modals surrounded nine page components.

`src/stores/sdnStore.ts` owns runtime identity, revisions, controller generation, traffic ownership/accounting, experiment run identity, cancellation, and stale-response guards. Pages call that store rather than implementing SDN operations. `services/api.ts` uses same-origin FastAPI routes and rejects both HTTP errors and legacy error envelopes. `services/websocket.ts` connects to `/ws/events`, handles keepalive/reconnect, and passes messages to the store. The existing dashboard effect hydrates state and polls controllers/topology every three seconds, plus traffic while RUNNING. That lifecycle remains in the dashboard component; the public landing does not mount it.

The backend already has a production SPA fallback in `backend/main.py`, serving `frontend/dist/index.html` for non-API deep links. No server routing change was required.

| Page / component | Existing API dependencies | Live/state dependencies and preserved operations |
|---|---|---|
| Global runtime bar | `/api/controllers`, `/api/controllers/select`, `/api/simulation/start`, `/stop`, `/status`, `/api/links/restore-all` | Controller readiness remains separate from simulation state; select controller, start/stop, restore links, experiment lock, WebSocket status |
| NOC Overview | Shared topology, traffic and event hydration; traffic start/stop; link up/down/restore-all | Reported counts and paths, actual traffic counters/RTT, historical processing events, h1→h2 quick traffic and s1↔s2 quick failure |
| Network Topology | `/api/topology`, `/api/topology/switch/{dpid}`, link up/down/restore-all | Actual nodes/links/paths; inspect OVS flows, groups and ports; inspect host metadata |
| Controllers | Controller list/select; existing controller-log stream | READY/FAILED handling, selection lock during experiments, controller stdout/stderr buffer |
| Traffic Monitor | `/api/traffic/start`, `/stop`, `/stats` | Source/destination/count/interval, actual attempts/replies, loss and RTT, final-counter confirmation and original owner |
| Failure Simulator | `/api/links/down`, `/up`, `/restore-all`; topology and event state | Per-link status and configuration, current diamond presets, failure/restoration, recent events |
| Experiment Lab | `/api/experiments/run`, `/cancel?run_id=…`, `/history`, `DELETE /{id}`, `/api/reports/{id}/export` | Existing run-ID helper, parameter payload, cancellation/cleanup, progress, terminal status, history, HTML/JSON export and confirmed deletion |
| Analytics | Experiment history | Existing completed-only aggregation, null exclusion, measured sample counts; packet loss and processing/recomputation charts |
| Event Logs | `/api/events/logs` | Existing event stream/state, severity filter, message search, refresh, timestamps/source/message |
| System & Config | `/api/system/status`, `/api/simulation/reset` | Reported OS/interpreter/probes, WebSocket state, diagnostics refresh and existing confirmed maintenance action |

The WebSocket/store contracts remain unchanged: INITIAL_STATE, controller/simulation status, topology/path updates, traffic start/tick/completion, experiment progress/finish/comparison completion and controller log messages. Existing ownership and revision guards remain responsible for rejecting stale telemetry.

### Baseline results, before implementation

| Check | Result |
|---|---|
| Existing frontend regressions | **61 passed, 0 failed**, across eight suites |
| Application TypeScript | PASS, through `tsc -b` in production build |
| Standalone test TypeScript | PASS |
| Production build | PASS: 871.14 kB JavaScript / 253.13 kB gzip; 62.84 kB CSS |
| Existing warning | JavaScript chunk exceeds Vite's 500 kB advisory threshold |

### Risks identified and addressed

- URL navigation must preserve existing store-driven quick navigation and keep browser history aligned with the rendered page.
- Landing content must never imply that an animation is telemetry, or initialize the dashboard's live services.
- Changing metric presentation must retain null/zero distinctions and controller-processing provenance.
- Controller failure must remain visible even while Mininet is RUNNING.
- Experiment cancellation must continue waiting for real backend cleanup, with no fabricated intermediate success states.
- The old graph positioned unknown nodes at the same fallback coordinate. The frontend layout now derives positions from reported connectivity and handles disconnected components.
- Tables and runtime actions must remain usable at laptop and tablet widths.

## Redesign plan and implementation

The implementation used a warm, light neutral workspace with graphite navigation and a restrained violet accent for primary actions and selection. Small green/amber/red status indicators retain accompanying text; inactive infrastructure uses neutral styling. Panels use fine borders and small radii rather than glow, glass or decorative gradients. Monospace is reserved for technical data.

Research informed hierarchy and status communication, rather than copying an existing product:

- [Carbon dashboard patterns](https://www.carbondesignsystem.com/building-blocks/data-visualization/dashboards): distinguish operational overview from evidence exploration.
- [Carbon status indicators](https://www.carbondesignsystem.com/building-blocks/core/patterns/status-indicators): retain text/symbols alongside semantic color.
- [HPE color foundation](https://design-system.hpe.design/foundation/color): use neutral surfaces and purposeful semantic colors.

The Sites skill's local repository workflow was used. No Sites hosting or deployment was performed. No dependencies were added; package manifests and lockfile are unchanged.

### Shared system and shell

- `src/index.css`: shared surface, typography, border, accent, semantic-color, radius and motion tokens; button/panel/form/table/chart/node/inspector styling and responsive layouts. Existing utility palette names are mapped to the neutral system so preserved page markup does not retain the former dark palette.
- `components/ui/Primitives.tsx`: reusable page headers, panels, metrics, status and empty states.
- `components/Brand.tsx`: shared identity for landing and dashboard.
- `components/Sidebar.tsx`: nine semantic navigation links grouped into Operate, Investigate and Workspace. Narrow widths use an icon rail with accessible link names/tooltips.
- `components/TopNavbar.tsx`: runtime, selected controller/readiness, existing actions, experiment state and transport status. The controller-failed/Mininet-running distinction is preserved. STOPPING is explicitly labeled.
- `App.tsx` / `services/navigation.ts`: landing `/`, overview `/dashboard`, and `/dashboard/{topology,controllers,traffic,simulator,experiment,analytics,logs,settings}`. Store-driven navigation updates history; back/forward updates the selected page. Unknown routes show a useful not-found state. Modified-click links retain normal browser behavior.
- `frontend/index.html`: product title/description and light document foundation.

### Landing page

`pages/LandingPage.tsx` and `components/landing/NetworkIllustration.tsx` provide an editorial hero, clearly illustrative diamond animation, problem statement, monitor/detect/recover/analyze sequence, truthful strategy explanations, eight existing capabilities, architecture stack and launch CTAs. The SVG/CSS animation has no polling/timers or dashboard runtime dependency. Reduced motion produces a static alternate-path illustration. No unsupported SLA, recovery-verification, local-switching-time, signup or pricing claims were added.

### Existing pages

| Page | Final presentation |
|---|---|
| NOC Overview | Network-state summary, selected strategy/readiness, dominant topology canvas, contextual quick actions, historical controller-processing provenance and a separate traffic evidence strip/RTT chart. Replaces ten equally weighted KPI cards. |
| Network Topology | Canvas with contextual node/link drawers, keyboard-accessible inventory, actual reported links and all reported active paths. No fixed four-switch layout or fixed six-link inventory. |
| Controllers | Three backend-provided strategy cards, READY-aware activation and a distinct controller-log console. No invented switch-connection or performance measurements. |
| Traffic Monitor | Retained traffic configuration, actual counters and nullable RTT, larger RTT visualization, owner and final-accounting labels. |
| Failure Simulator | Physical-link table based on real topology, explicit endpoints/interfaces/configured capacity, red failure actions, restoration, current diamond presets and recent recorded events. Missing topology has an empty state. |
| Experiment Lab | Accessible parameter controls, retained start/cancel behavior, current-stage timeline, backend message and stage percentage, visible terminal message, stored-result table and exports/deletion. Only PREPARING, WARMUP, TRAFFIC_ACTIVE and FAILURE_INJECTED are listed as reported stages; no fabricated recovery/cleanup completions. |
| Analytics | Completed-history evidence, measured sample counts, nullable comparisons and neutral chart surfaces. Controller processing/recomputation remains distinct from outage/local FF switching. |
| Event Logs | Clear severity, filtering/search, quieter timestamp/source columns and readable message rows. Existing refresh behavior remains. |
| System & Config | Reported environment/probe cards, transport status and visually separate maintenance action with its existing confirmation. Static deployment version assertions were removed from diagnostic descriptions. |

### Topology and inspection

`services/topologyLayout.ts` performs deterministic BFS layering from actual nodes and links. It supports arbitrary names, additional nodes and disconnected components without altering topology data. The 24-node regression checks unique finite positions and order independence. It is a simple readable layout, not a crossing-minimization engine; large dense graphs may need a more advanced layout in a future topology-expansion phase.

`TopologyCanvas.tsx`, `SwitchNode.tsx` and `HostNode.tsx` distinguish hosts/switches, reported paths, other links, failures and selection. Host links are not automatically claimed as active forwarding merely because their names start with `h`. The live graph does not animate decorative packet pulses. Actual measurement still requires traffic.

`InspectorDrawer.tsx` uses native dialog focus containment, Escape and focus return. Link inspection reads the latest reported link status. Host inspection displays reported IP/MAC/interfaces with N/A for missing fields. Switch inspection retains request-version guards and OVS flow/group/port queries; read errors are visible rather than appearing as an empty flow table.

## Verification results

| Check | Final result |
|---|---|
| Existing frontend regression suites | **61 passed**, unchanged test assertions |
| New redesign regression suite | **6 passed** |
| Frontend total | **67 passed, 0 failed** |
| Standalone test TypeScript | PASS |
| Application TypeScript | PASS (`tsc -b`) |
| Production build | PASS (`npm run build`) |
| Final build assets | JavaScript 868.44 kB / 256.71 kB gzip; CSS 65.59 kB / 12.97 kB gzip |
| Backend regression discovery | **128 passed, 0 failed**, 71.211 seconds |
| Diff whitespace check | PASS (`git diff --check`) |
| Protected backend/store/service/dependency diff | No changes |

The existing large JavaScript chunk advisory remains. There was no new dependency or bundle-splitting/configuration change in this presentation task.

Frontend tests were bundled with the installed Rolldown CLI using `--platform node --format esm`, then each suite was executed with Node's `--test`. Suites: request-ID fallback, metric truthfulness, experiment cleanup, telemetry ownership, controller exit, runtime errors, topology hydration, traffic accounting, and redesign. Suites affected by the final terminal-state/inspector changes were bundled and rerun after those edits. New tests cover all route round-trips, truthful public copy, arbitrary/disconnected graph layout, current-stage-only timeline, retained failed experiment message and missing host metadata.

Backend command: `/home/i7__6thgen/sdn-env/bin/python3 -m unittest discover -s backend/tests -v` under Ubuntu-22.04. These are isolated regression tests (including existing local finite-ping tests), not a new live three-controller Mininet trial. Expected simulated failure logs in these tests are not application test failures.

### Browser checks and screenshots

`frontend/tests/ui-browser.mjs` runs hidden Edge against the existing production FastAPI service at `http://127.0.0.1:8000`. It uses built-in Node/CDP APIs and adds no browser-testing dependency. `SDN_QA_URL` can target another reachable deployment.

Read-only checks include all nine sidebar destinations, all nine direct FastAPI deep links, browser refresh/back/forward, heading/URL alignment, accessible form labels, real controller options, WebSocket connection, reduced motion and horizontal-overflow checks at desktop/laptop/tablet widths. Landing mobile is checked at 390×844. Console exceptions/errors, failed HTTP responses, API reads and any mutation requests are recorded in [browser-evidence.json](browser-evidence.json).

The service was STOPPED with no selected controller, no discovered topology or traffic measurements, and empty loaded experiment history during captures. The screenshots deliberately show those real empty states. The system page reported Mininet command availability, no OpenFlow listener and an unsuccessful OVSDB probe; this is runtime evidence, not a claim of a running network. No production fixture/mock data was introduced.

Screenshots:

- [Landing, desktop](landing-desktop.png), [full landing narrative](landing-full.png), [landing, mobile](landing-mobile.png)
- [Overview](overview-desktop.png), [topology inspector workspace](topology-desktop.png)
- [Traffic](traffic-desktop.png), [Experiment Lab](experiment-desktop.png)
- [Analytics](analytics-desktop.png), [event timeline](logs-desktop.png)
- [System, laptop](system-laptop.png), [system, tablet](system-tablet.png)

Initial browser harness attempts were limited by sandboxed Edge and fixed-delay waits. The completed checks use hidden Edge with approved execution access and wait for expected page readiness. They are not counted as successful checks until the final evidence file records completion.

**Final browser run: PASS.** All nine pages and all nine direct deep links rendered; real controller options loaded and WebSocket connected. Refresh/back/forward, form labels, reduced motion and overflow checks passed. The final evidence records **zero console errors/exceptions, zero failed HTTP responses and zero mutation requests**. Screenshots were inspected for the landing desktop/mobile, overview, topology, experiment form and system tablet layout. Live traffic/failure/recovery visuals still require the manual network checks below.

### Changed file inventory

Modified:

- `frontend/index.html`
- `frontend/src/App.tsx`, `frontend/src/index.css`
- `frontend/src/components/Sidebar.tsx`, `TopNavbar.tsx`
- `frontend/src/components/topology/TopologyCanvas.tsx`, `SwitchNode.tsx`, `HostNode.tsx`
- `frontend/src/components/modals/SwitchInspectorModal.tsx`, `LinkInspectorModal.tsx`
- `frontend/src/pages/OverviewView.tsx`, `TopologyView.tsx`, `ControllersView.tsx`, `TrafficView.tsx`, `FailureSimulatorView.tsx`, `ExperimentLabView.tsx`, `AnalyticsView.tsx`, `EventLogsView.tsx`, `SettingsView.tsx`

Added:

- `frontend/src/components/Brand.tsx`
- `frontend/src/components/ui/Primitives.tsx`, `InspectorDrawer.tsx`
- `frontend/src/components/landing/NetworkIllustration.tsx`
- `frontend/src/components/experiments/ExecutionTimeline.tsx`
- `frontend/src/pages/LandingPage.tsx`
- `frontend/src/services/navigation.ts`, `topologyLayout.ts`
- `frontend/tests/redesign.test.tsx`, `ui-browser.mjs`
- This report, `browser-evidence.json` and the PNG screenshots in `reports/ui-redesign/`

The ignored `frontend/dist` production artifacts were regenerated by the build.

## Deliberately unchanged

- Baseline, Reactive and Fast Failover algorithms and controller scripts.
- Physical/logical diamond topology, addresses and OpenFlow configuration.
- Ryu/Mininet/OVS process lifecycle and readiness management.
- API routes, payloads, error semantics and WebSocket contracts.
- C06 actual Tx/Rx accounting and loss/RTT calculations.
- C08 runtime/controller/traffic ownership and stale-event guards.
- C09 cancellation, cleanup and terminal-state ownership.
- C10 metric provenance, nullable measurements and completed-only analytics.
- Insecure-HTTP-safe request-ID fallback and finite experiment traffic completion.
- SQLite schema, historical records and report generation.

## Manual live verification checklist before committing

These network mutations were deliberately left for the requested manual verification. Passing read-only browser checks and isolated regressions does not replace real SDN validation.

1. Open `/` using the actual Windows Chrome / WSL-IP HTTP URL. Follow both launch CTAs; inspect mobile layout and reduced-motion behavior.
2. Visit all nine dashboard pages, refresh a deep link, then use back/forward. Confirm labels, focus rings, laptop/tablet controls and table scrolling.
3. Select each controller. Confirm real READY state, correct Ryu process/6653 listener and no orphaned controller after mode switches. Confirm unexpected controller exit remains visible without falsely reporting Mininet stopped.
4. Start simulation. Compare reported nodes/links with Mininet and OVS. Check graph fit/zoom, switch/host selection and keyboard inventory selection. Open flow/group/port inspectors; verify Escape, focus return, refresh and visible query errors.
5. Start h1→h2 traffic from Traffic Monitor and overview. Compare counters/RTT/loss with the worker, then stop and confirm final accounting. No replies must leave RTT N/A; no attempts must leave loss N/A.
6. Fail a reported active-path link using the simulator or drawer. Confirm both physical interfaces, API state, topology, event history and traffic effects. Restore it and use Restore All Links. Verify current-state labels update inside an already-open drawer.
7. Baseline: active-path failure causes loss without automatic healing; restoration recovers traffic. Reactive: inspect an actual affected-path reroute and its valid event if produced. Fast Failover: inspect real FF groups/buckets/watch ports before failure. Do not label controller recomputation as local switch failover time.
8. Run automated experiments for all three modes with the live-verified parameters: s1↔s2, 300 packets, 0.02-second interval, failure at 2 seconds. Check request-ID fallback over HTTP, natural finite completion, real progress, preserved nullable processing measurements and stored results.
9. Cancel during execution. Confirm CANCELLING remains pending until backend cleanup and that a cancelled/failed result never becomes a successful sample. Check visible terminal errors.
10. Open HTML/JSON reports and compare fields with the stored record. Delete only a disposable test record after confirmation; reject any unrelated data deletion.
11. Compare Analytics with completed stored experiments and sample counts. Confirm N/A stays unavailable, legitimate zero survives, and processing/outage/local-FF concepts remain distinct.
12. Filter/search/refresh events. Recheck diagnostics; review the maintenance confirmation without accepting it during a running controller unless intentionally testing cleanup.
13. Disconnect/reconnect the browser transport, refresh while simulation is running, and induce a safe API error. Confirm actual state and visible errors rather than a false success.

No commit or push was performed. The production assets are built locally and ready for manual review.
