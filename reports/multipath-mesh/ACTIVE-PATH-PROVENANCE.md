# Multi-Path Mesh active-path provenance investigation

## Conclusion

Real telemetry bug, not Baseline self-healing. Baseline forwarding behavior is unchanged.

The saved `logs/controller_baseline.log`, lines 664–672, contains:

1. h2 MAC → h1 MAC: `s9,s6,s3,s1`.
2. h1 MAC → h2 MAC: `s1,s2,s5,s9` (twice).
3. h2 MAC → h1 MAC: `s9,s6,s3,s1`.
4. `LINK DOWN s2 <-> s5 at t=1793870880.756 (baseline: no recovery action)`.
5. Topology rebuild and the reverse link-down notification.

Thus the reverse path was reported **before** failure, not newly calculated as recovery. The existing backend overwrote one global `active_paths` slot on every direction's path log, then retained it on failure. REST and reconnect snapshots exposed that stale slot. The topology canvas treats path edges as undirected, further obscuring direction. Exact packet type is not recorded in this log; it cannot establish whether the reverse PacketIn was ARP or ICMP.

## Source and meaning

`controller_baseline.BaselineController.packet_in` learns host attachment, calculates `nx.shortest_path(graph, packet_in_switch, destination_host_switch)`, logs `Path for <src MAC> -> <dst MAC>`, then calls `_install_path` and sends PacketOut. `_install_path` requests destination-MAC flows with a 30-second idle timeout. The log precedes those requests and has no barrier confirmation or dataplane-counter verification. It is a directional, PacketIn-triggered controller computation, not an observed end-to-end forwarding path. It may also begin at an intermediate PacketIn switch.

`link_delete` rebuilds discovery state only; it does not reinstall failed flows. Nothing in this fix changes that behavior. Healthy reverse-direction intent cannot prove healthy h1→h2 forwarding. The user's measured loss is consistent with failed forward traffic; this audit does not claim to have repeated that live measurement.

Old chain: `Path for` → parser `ACTIVE_PATH` → manager global cache + misleading `Active forwarding path` event + `PATH_ACTIVE` WebSocket → REST/reconnect/store → topology/NOC highlights. Reactive `HEALED` also promoted its new path without verifying delivery. FF recomputation did not set the cache and does not identify which local bucket is carrying traffic.

## Fix and contract

- Parser emits `PATH_COMPUTED`; event logs retain directional MACs, path, raw log, runtime/generation/experiment ownership and receipt time. New message explicitly says forwarding unverified. No `PATH_ACTIVE` broadcast is emitted from computed intent.
- Controller recovery events retain their timings and ownership; neither computed paths nor Reactive `HEALED` populate active paths.
- `/api/topology` and WebSocket INITIAL_STATE return `active_paths: []`. Its schema now reserves the field for verified dataplane paths. Empty means unavailable, not no possible graph route and not failed connectivity. No such verification currently exists, for any mode. Backup paths remain unavailable too.
- Frontend rejects legacy `PATH_ACTIVE` inference and no longer turns `HEALED` into path evidence. Topology wording and the shared NOC legend now refer to verified forwarding; unavailable state says N/A. No layout/style/motion changes.
- Existing historical event rows are preserved, including their old misleading labels. New computed events use truthful labels. No database migration or history rewrite.

Reading flow tables alone would still not prove packet delivery: direction, matching priorities, group bucket liveness, current ports, timeouts and observed counters matter. No expensive polling, synthetic probes or graph-derived replacement path was added.

## Impact audit

| Consumer | Finding |
|---|---|
| Baseline | Latest PacketIn computation was mislabeled and retained across failure; fixed. No automatic recovery added. |
| Reactive | Same PacketIn logging source; HEALED shows controller reconfiguration, not verified forwarding; no longer promoted. Processing event/time unchanged. |
| Fast Failover | Group-local bucket selection is not observed by these logs; active path remains unknown. Recompute timing remains controller-only. |
| Network Topology / NOC | Shared canvas previously highlighted stale undirected edges; now receives no inferred active paths. Actual discovered links and DOWN states still display. |
| NOC processing metric | Uses typed recovery events, not computed path events; unchanged. |
| Analytics / reports | Use stored completed experiment metrics and explicit processing-time semantics, not active_paths; unchanged. |
| Event Logs | New computations explicitly unverified and directional. Historical rows untouched. |
| Experiment Lab | Captures last_recovery_event only when generation/runtime/experiment/failure link and post-failure receipt time match; never reads active_paths. No accounting or timing fallback changes. |

## Files changed for this issue

- `backend/services/log_parser.py`: computed-intent event type.
- `backend/services/controller_manager.py`: truthful logging, stop path promotion; recovery timing retained.
- `backend/api/topology.py`, `backend/main.py`: no unverified path cache in REST/reconnect.
- `backend/models/schemas.py`, `frontend/src/types/index.ts`: contract documentation.
- `frontend/src/stores/sdnStore.ts`: reject log-based forwarding inference.
- `frontend/src/pages/TopologyView.tsx`, `frontend/src/components/topology/TopologyCanvas.tsx`: accurate labels/N/A only.
- `backend/tests/test_path_provenance.py`, `frontend/tests/topology.test.ts`: regression coverage.
- This report.

Existing uncommitted mesh/UI work and the user's live database were preserved. No controller scripts, worker behavior, traffic accounting, metric calculations or experiment lifecycle code were changed for this issue.

## Regression coverage and validation

- Backend: four new tests replay the exact forward/reverse mesh log sequence then s2–s5 failure; confirm no active-path broadcast/cache/recovery; preserve Reactive 3.2ms processing without path proof; preserve FF 12.2ms recomputation without local switching claims; reject a stale legacy cache in REST for RUNNING/STOPPED.
- Frontend: exact mesh reverse-direction legacy-message regression; existing hydration/race test updated to reject legacy path promotion; Reactive recovery/restoration test now requires unknown forwarding rather than an inferred path.
- Full backend suite: **151 passed** (124.393s); includes real-controller policy tests with mocked datapaths and isolated IO. Injected failure logs are expected test cases.
- Full frontend suite: **82 passed**, across 12 bundled Node test suites.
- TypeScript source and test checks: passed.
- Production build: passed (Vite 8.3.5, 2667 modules; JS 875.33 kB / gzip 258.71 kB). Existing >500 kB chunk advisory remains; no build error.
- Whitespace check: passed with repository CRLF-aware configuration.
- Live Mininet rerun/browser manual verification: not performed; existing running user services were not restarted or disturbed.
- Initial frontend test-launch attempts hit WSL argument/glob issues; explicit absolute bundled filenames ran successfully. These were harness failures, not product-test failures.

## Exact manual retest

1. Restart FastAPI using the project's normal launcher to load backend changes; hard-refresh Chrome to load the rebuilt production assets. Stop any existing simulation through the dashboard before selecting the new run.
2. Select Multi-Path Mesh + Baseline, start simulation and wait READY. GET `/api/topology`: controller baseline, expected nine switches and links, `active_paths: []`. Topology says forwarding verification N/A and must not highlight an inferred active route. This is expected even while traffic works.
3. Determine actual h1→h2 forwarding before failure with `sudo ovs-ofctl -O OpenFlow13 dump-flows s1` and the downstream switches, following the h2 destination-MAC output actions and confirming increasing packet counters. Use `sudo ovs-ofctl -O OpenFlow13 show <switch>` to map port numbers; do not infer an active route just from the graph. If actual forwarding does not traverse s2–s5, failing that link does not test an active-path failure; use an actually used edge for the behavior check.
4. Start h1→h2 traffic: 1000 packets, same interval as the reported live run. If active path is s1–s2–s5–s9, fail s2–s5 during traffic. Verify both interface ends DOWN, packet loss and last successful reply. Baseline must not perform link-failure rerouting. Exact Tx/Rx and RTT depend on failure timing; do not expect the previous 213 replies exactly.
5. GET `/api/topology` again: failed link DOWN, controller baseline, `active_paths: []`, no fabricated reverse route. Check Topology and NOC; refresh/reconnect and repeat GET to ensure the result persists. New computed-path event logs must retain source/destination and say forwarding unverified, not active forwarding or healed. Restore link and verify traffic recovers while path telemetry remains unknown.
6. Repeat Reactive/FF active-path failure checks. Their actual recovery behavior remains as before; paths stay unknown until genuinely verified instrumentation exists. Reactive may report owned controller processing; FF may report recomputation. Neither timing proves end-to-end outage or local bucket switching time. Inspect FF groups and counters separately.
7. Confirm experiments still finish with measured Tx/Rx/loss/RTT and truthful optional processing time; analytics/reports retain the same stored measurements. Historical event rows may still contain old wording because history was intentionally preserved.

No commit or push performed.
