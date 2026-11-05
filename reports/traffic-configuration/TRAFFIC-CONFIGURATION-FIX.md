# Traffic Monitor — configuration reset fix

Date: 2026-11-05. Scope: traffic request configuration state only. Existing redesign and motion retained. No commit or push.

## Root cause and evidence

`frontend/src/pages/TrafficView.tsx` previously held all four configuration fields in local `useState` hooks:

```tsx
useState('h1');
useState('h2');
useState(0.05);
useState(300);
```

The selects were correctly controlled, and `handleStart` correctly sent `{ src, dst, interval, count }` to the existing `useSDNStore.startTraffic` action and `api.startTraffic`. Neither the start response, REST statistics handler nor WebSocket start/tick/completion handler wrote to those local form states. Live/result telemetry remained separate in `sdnStore.trafficStats`.

`App.tsx` renders only the selected page. Switching away unmounts `TrafficView`; returning creates a new instance and reruns its defaults. The motion wrapper is also keyed by the current tab, but telemetry updates do not change that key. The reset is lost page-local configuration on remount, not a wrong packet count sent to Mininet, and not telemetry directly assigning 300.

This local-state limitation was present before the redesign as well: the repository's HEAD version of TrafficView also used those four local hooks and App switched between page components. The current design retained it; this fix does not remove routing or motion.

### Before-fix browser reproduction

The actual production React bundle was exercised in hidden Edge against a separate local fixture server. The server recorded the real frontend POST body, and fixture WebSocket messages went through the existing frontend WebSocket/store handling. No live SDN/backend actions were sent.

1. Default controls rendered h1, h2, 0.05 seconds, 300 packets.
2. Selecting 500 produced an actual POST body with `count: 500`.
3. Start acknowledgement, WebSocket tick, completion at sequence #500 and subsequent REST polling all preserved 500 while TrafficView stayed mounted.
4. Navigating to Topology removed the TrafficView DOM. Returning created a new instance.
5. The browser assertion failed with:

```text
page remount must preserve user traffic configuration
actual:   ['h1', 'h2', '0.05', '300']
expected: ['h1', 'h2', '0.05', '500']
```

[Before-fix evidence](before-fix-evidence.json) retains the successful POST/telemetry checks before the failing remount assertion. The user's exact navigation during the manual run was uncertain, so this report does not claim navigation was observed in that run. It establishes a reproducible route to the reported reset. A completion-only reset of a continuously mounted component was not reproduced.

## Exact fix and changed files

Production changes:

- **`frontend/src/stores/trafficConfigurationStore.ts` — new:** a small dedicated Zustand store for the user's editable request draft: `src`, `dst`, `interval`, `count`. Defaults remain h1, h2, 0.05 seconds and 300. Only explicit form setters update it.
- **`frontend/src/pages/TrafficView.tsx`:** replace the four local hooks with the independent configuration store. Keep all controlled select values, request construction, operation handlers, metrics and markup/styles otherwise unchanged from the existing redesigned page.

Tests/documentation:

- **`frontend/tests/traffic-configuration.test.ts` — new:** five focused regression tests.
- **`frontend/tests/traffic-configuration.browser.mjs` — new:** real DOM/control and page-remount regression with an isolated HTTP/WebSocket fixture.
- **`reports/traffic-configuration/`:** this report and before/after browser evidence.

The draft survives SPA page unmount/remount and traffic job transitions in the same loaded application. It is not populated from result counters, previous job parameters, overview quick actions or experiment traffic. Editing the draft for the next request does not rewrite current/result telemetry. This is in-memory application state; full document reload/storage persistence was not added.

## Regression coverage

Unit/integration tests:

1. Original configuration defaults.
2. 500 packets: exact API body; real store WebSocket start/tick/completion handling; REST result fetch; unchanged configuration across tab selection.
3. 1,000 packets with reversed h2→h1 and interval 0.1 seconds: all four non-default fields remain unchanged.
4. Explicit 300-packet request remains valid.
5. Overview-style quick traffic and late result telemetry cannot replace explicit next-request edits.

Browser regression:

- Uses actual React controlled selects and their change events, existing Start Traffic Stream button, real API serialization and actual application routing.
- Checks 500, 1,000 and 300 packet selections and exact POST bodies.
- Checks all four rendered field values after acknowledgement, TRAFFIC_STARTED, TRAFFIC_TICK, TRAFFIC_COMPLETED and actual three-second REST polling.
- Checks final reply sequence, then navigates to Topology and back; a DOM marker confirms an actual remount before checking field values.
- Confirms that explicit next-job configuration is not replaced by old result telemetry.
- Fixtures are confined to the test harness; production services and WebSocket contracts are not mocked or changed.

## Validation

| Check | Result |
|---|---|
| Full frontend test suite | **75 passed, 0 failed** (70 existing + 5 new) |
| Standalone TypeScript check, including new test | PASS |
| Application TypeScript (`tsc -b`) | PASS |
| Production build | PASS |
| Real-browser regression against rebuilt assets | **PASS**: 500, 1,000 and 300; all four fields; telemetry/polling; actual page remounts; next-job edits |
| Browser console errors | **0** |
| Diff whitespace check | PASS |
| Backend/API/core telemetry/controller code changes | None |

Production assets were rebuilt locally. CSS remains 79.04 kB and unchanged; JavaScript is 871.26 kB / 257.52 kB gzip. Vite's pre-existing large-chunk advisory remains.

The previously failing browser remount assertion passes after the fix. [Final browser evidence](browser-evidence.json) records the exact three request bodies and all completed browser scenarios. Unlike the unit tests, these checks exercise the rendered controlled selects and a real unmount/remount through the application sidebar.

Backend regressions were not rerun for this fix because no backend code, API contract/assumption, ownership or metric computation changed. The frontend test suite still includes the existing accounting, error, ownership, cleanup, metric-truthfulness and HTTP request-ID tests. The user's already completed live 500/500 run remains the SDN evidence; isolated browser fixtures are not represented as a fresh Mininet run.

## Manual live retest

1. Reload the rebuilt application, select Reactive, confirm READY and RUNNING, and open Traffic Monitor.
2. Confirm the original fresh-application default is 300. Select h1→h2, 0.05 seconds and 500 packets; start traffic.
3. Verify the request body is 500; check the dropdown during live updates and after Tx/Rx reach 500/500 and sequence #500. It must still read 500.
4. During or after a run, visit Topology/Failure Simulator and return. The four selected values must remain unchanged. Repeat using browser back/forward.
5. Test h2→h1, interval 0.1 seconds and 1,000 packets; verify all four controls survive telemetry and page navigation.
6. Explicitly choose 300 and run again; verify request/results use 300 and the control continues to display 300.
7. Edit configuration for a subsequent job, or launch overview quick traffic, and confirm result telemetry does not silently replace the Traffic Monitor draft.

No backend accounting, worker/controller behavior, loss/RTT semantics, WebSocket contract, styling or motion was changed. No historical database values were modified by this task's tests.
