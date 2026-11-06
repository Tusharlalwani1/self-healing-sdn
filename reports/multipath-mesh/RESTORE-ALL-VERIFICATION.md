# Multi-Path Mesh Restore All investigation and fix

## Root cause established before changing code

`backend/api/links.py:restore_all_links` still contained this fixed Diamond list:

`h1–s1, h2–s4, s1–s2, s2–s4, s1–s3, s3–s4`.

That explains both numbers in **“Link restoration failed for 2 of 6 links”**:

- Six was the length of the route's constant, not discovered topology size, failed-link count or ISL count.
- `h2–s4` and `s2–s4` do not exist in Multi-Path Mesh. The worker correctly rejects nonexistent links with 404; the existing aggregation turns mixed success/failure into 502.
- The four remaining pairs do exist in Mesh. The old handler omitted most Mesh ISLs and the actual h2–s9 host link. Its constant included two Diamond host links rather than intentionally restricting restoration to ISLs.
- An all-UP Mesh still triggered the six writes, including two invalid requests. Already-UP state itself is not a worker error: existing worker code applies the state and verifies both interfaces.

This is a leftover Diamond assumption, not evidence of a failed worker, stale topology snapshot, controller problem or forwarding regression. The old route did not enumerate a topology snapshot at all. It would repeat the mismatch after topology/controller switching. Earlier transient 503s cannot be retrospectively attributed to this bug without their response/log evidence; genuine dependency failures remain errors.

## Complete call path

Topology page / NOC Overview / Failure Simulator / top navbar buttons → Zustand `restoreAllLinks` → `api.restoreAllLinks` POST `/api/links/restore-all` → runtime route → `MininetClient.restore_all_links` → fresh `get_topology` worker command → worker `get_topology` enumerates `self.net.links`, using both interfaces' `isUp()` for each status → only DOWN pairs go through the existing `_set_link_status` → worker `set_link_status` checks pair membership, calls Mininet `configLinkStatus`, explicitly applies OVS interface state, verifies both endpoints → client reads topology, broadcasts `TOPOLOGY_UPDATE`, records the restore, broadcasts `LINK_RESTORED` → aggregate response → frontend fetches actual topology on both success and failure. The frontend rejects non-2xx responses; no optimistic link state is fabricated.

## Small fix and semantics

- Route delegates bulk work to the runtime service; it contains no topology-specific pairs.
- Uses actual worker inventory, not topology catalog, frontend state, Ryu discovery or cached link IDs. A separate regression uses a two-link runtime snapshot to prove the service is not just substituting a 16-link catalog constant.
- Includes host and switch links. Diamond normally reports 6; Mesh normally reports 16 (14 ISLs + 2 host links).
- Holds the client's runtime lock across discovery and mutations. The API also holds the existing lifecycle-transition lock and refuses manual operation during experiment ownership. This prevents known application lifecycle transitions from replacing the runtime mid-batch.
- Confirmed-UP links return `action: already_up` without state changes or fake restoration events. DOWN links use unchanged worker confirmation. A one-sided failure is DOWN because discovery requires both ends UP.
- Success response preserves `status`, `message`, `results`, adding runtime context, `link_count`, `restored_count`, `already_up_count`. Each result identifies its endpoints and action. Empty/invalid/duplicate-identity inventory is an error, not fabricated success.
- Genuine failures retain per-link endpoint identity, HTTP status and public message under `detail.results`. Processing continues for remaining snapshot links. Mixed outcomes remain non-2xx (502), with the denominator taken from runtime inventory; uniform all-failure status is preserved as before. Discovery failures propagate their actual error status.
- Physical changes made externally after the snapshot cannot be ruled out by an application lock; already-UP means confirmed by that fresh snapshot, not an eternal guarantee.
- No changes to worker IPC contracts, worker implementation, controllers, forwarding, traffic accounting, telemetry provenance, UI layout or styling.

## Experiment Lab and Failure Simulator

Failure Simulator's bulk button shares the old route and was affected; it now uses the corrected runtime enumeration. Its individual controls were not affected.

`ExperimentRunner` does **not** use Restore All. In its `finally` block it calls `set_link_status(fail_src, fail_dst, 'up', experiment_id=exp_id, expected_runtime=runtime_id)`. It restores the owned injected link, captures cleanup errors and fails a result truthfully if cleanup fails. Controller comparison runs construct their requested topology through existing runtime startup. No experiment production change was necessary.

Mesh experiment tests now explicitly forbid calling bulk restore and check that all three modes restore only the requested s6–s9 target. Cancellation cleanup still restores its target. Existing cleanup-error/ownership tests remain in the full suite.

## Files changed for this issue

1. `backend/api/links.py`: replace fixed list with guarded service delegation.
2. `backend/services/mininet_client.py`: fresh inventory, runtime lock, idempotent skips and truthful result aggregation.
3. `backend/tests/test_bulk_restore.py`: 13 focused tests.
4. `backend/tests/test_runtime_errors.py`: original partial-failure test now supplies its six-link DOWN inventory instead of relying on the removed route constant.
5. `backend/tests/test_mesh_experiments.py`: assert cleanup never invokes bulk restore and restores only the owned target across all modes/cancellation.
6. `frontend/tests/runtime-errors.test.ts`: healthy Mesh bulk success/refresh and genuine Mesh partial-error/state refresh regressions.
7. This report.

Other existing uncommitted work, historical data and the user's live runtime were preserved. No commit/push.

## Test coverage

New backend cases: Diamond six-link restore; Mesh sixteen-link restore including h2–s9; single Mesh failure plus repeated idempotent call; multiple Mesh failures including a host link; all links UP with no mutation/fake events; genuine partial worker failure with exact failed pair and continued restoration; Diamond→Mesh→Diamond fresh inventory; runtime inventory differing from catalog; mismatched worker topology rejection; worker unavailable; unavailable/malformed inventory; stopped/experiment-owned runtime; runtime lock held across all commands.

Frontend cases verify one POST followed by actual topology refresh for a healthy sixteen-link response, and a 502 partial failure remaining visible while the actual DOWN state loads. Existing Diamond partial-failure coverage is retained.

Validation:

- Focused initial bulk/error suites: **31 passed** before adding the two additional inventory-provenance tests.
- Final focused bulk/error/Mesh experiment suites: **36 passed** (7.995s), including all final added assertions.
- Complete frontend suite: **84 passed** across 12 bundled Node suites.
- TypeScript source and test checks: **passed**.
- Production build: **passed** (Vite 8.3.5; 2667 modules; existing >500 kB bundle advisory only).
- Whitespace check: **passed** using the existing CRLF-aware configuration.
- Complete backend runs: **164 tests, 163 passed, 1 failed**, both initially (73.451s) and on rerun without parallel build load (59.809s). The failure is the unchanged `test_listener_loss_detected_without_process_exit_or_repeated_alert`, which asserts FAILED after a 1.1-second sleep for a one-second background check; it observed READY. The isolated controller-exit suite rerun **passed all 11 tests**. This remains a full-suite validation failure; it is not counted as a passing run. No unrelated controller/test-timing changes were made. The exact full-suite scheduling interaction was not resolved in this focused fix.

Tests use fake SDN IPC and isolated persistence; they do not claim a new live Mininet run.

## Manual Mesh retest

1. Restart FastAPI using the normal project launcher to load the backend fix; reload the built dashboard. Start Multi-Path Mesh + Fast Failover, wait READY. Keep browser Network panel open.
2. Verify GET `/api/topology` reports 9 switches, 2 hosts and 16 links. With all links UP, click Restore All. Expected POST 200: `link_count=16`, `restored_count=0`, `already_up_count=16`, sixteen endpoint results with `action=already_up`. No h2–s4 or s2–s4 entries. Repeat: same safe result, no error or controller/network restart.
3. Fail s2–s5 using the dashboard. Verify both endpoint interface states are DOWN using the actual interface names returned by `/api/topology` and `ip link show <interface>`; confirm failed count 1. Restore All: 200, sixteen results, one restored, fifteen already UP; both ends UP, topology/NOC failed count 0.
4. Fail s2–s5 and s6–s9; repeat. Expect two restored and fourteen already UP. Optionally test the actual h2–s9 host link, checking the host end inside its Mininet namespace and switch end on the root namespace. Both host and ISL restoration are supported.
5. Verify updated topology through WebSocket and REST, event logs only for actual restore operations, and refresh/reconnect state. Use the Failure Simulator and navbar bulk buttons too; they share the corrected path.
6. Switch Diamond→Mesh→Diamond with the normal stopped/start workflow, restoring after each. Response `topology_id`, runtime identity, endpoint results and `link_count` must follow the current network: 6→16→6, with h2–s4 only in Diamond and h2–s9 only in Mesh.
7. Run a Mesh automated experiment for each controller with target s6–s9 and verify its target returns UP on completion/cancellation and results retain truthful metrics. Manual bulk controls during an owned experiment should return 409 rather than interfere.
8. Genuine worker restore-failure behavior is covered by injected regression tests; do not damage a healthy live network merely to produce a partial error. If one occurs naturally, inspect POST `detail.results` for the exact endpoints/status/message and confirm remaining healthy/restored links still reflect actual state. No failure may be reported as bulk success.

Live manual verification remains for the user; this fix did not stop/start their current Mininet/Ryu processes.
