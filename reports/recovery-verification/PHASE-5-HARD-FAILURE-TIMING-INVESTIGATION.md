# Recovery Verification timing investigation — Phase 5 hard-failure regression

Date: 2026-11-08. Live state was inspected read-only before modifying code. No controller, link, traffic or TC action was performed during investigation; no historical result was rewritten.

**Follow-up status: live hard-failure retest completed and passed**, as subsequently reported by the project owner for final Phase 5 validation. Mesh / Reactive, s1-s2 failed: **VERIFIED**, reachability Restored, post-failure **40/40**, **0%** loss, **31.78 ms** post-recovery average RTT, stability Passed, verification duration **5.14 s**, path verification **UNAVAILABLE**. The 5.14 s is verification/orchestration duration, not outage, controller recovery time or local switching latency. This follow-up is manually reported real Mininet evidence; it does not replace the original FAILED record or turn automated fixtures into live results.

## Finding

This is a genuine **observation-budget orchestration bug**, not evidence that the Reactive dataplane stayed broken, and not incorrect packet-count or stability-bin logic. The engine started its eight-second observation deadline **before** acquiring the runtime lock and obtaining worker acknowledgement of `begin_verification`. A slow registration consumed time that the worker still needed to collect its bounded window and finish reply grace.

The saved FAILED record is an honest result under that old deadline: its latest snapshot really was incomplete. It must not be relabeled VERIFIED retrospectively. The bug is starting the observation budget before a worker-owned observation can exist. The fix changes that anchor, not classification or measurements.

## Exact live evidence

Persisted record: `verify_307b928e40b3446f9e561ee14419dc53`, Mesh / Reactive, h1→h2, failed s1-s2, traffic sequence 6.

| Field | Persisted value |
|---|---:|
| Overall actual traffic Tx/Rx (read-only worker stats) | 1000 / 998 |
| Overall loss / average RTT | 0.2% / 33.308 ms |
| Pre-injection last accepted Tx/Rx snapshot | 441 / 441 |
| Worker window baseline / end Tx | 745 / 789 |
| Bounded post-failure Tx/Rx | 44 / 44 |
| Bounded loss / average RTT | 0% / 32.07045454545455 ms |
| Bounded duration | 2.2931512650002333 s |
| Reply halves observed | 2 |
| Cached completion / invalid flags | false / false |
| Saved result | FAILED / VERIFICATION_TIMEOUT |
| Reachability / stability confirmation | true / false |
| Recorded verification duration | 10.436758578999616 s |
| Path verification | UNAVAILABLE |

The existing worker retained the same window. A read-only `get_verification` RPC returned **the identical baseline, end counters, 44/44 replies, RTT, duration and two reply halves**, now with `complete: true`. This was not new traffic, a new probe, a reconstructed path or a rewritten database record.

Approximate wall-time alignment using the job's recorded start time and its monotonic elapsed window fields:

| Stage | Recorded/derived Unix wall time |
|---|---:|
| Failure requested | 1794125015.8834593 |
| Failure acknowledged | 1794125022.3479714 |
| Verification state started | 1794125028.0402453 |
| Initial VERIFYING persistence event | 1794125029.8228817 |
| First counter baseline, elapsed 43.196840001 s into job | approximately 1794125035.6196406 |
| Window end, elapsed 45.489991266 s | approximately 1794125037.9127917 |
| End plus required one-second reply grace | approximately 1794125038.9127917 |
| Verification finalized | 1794125037.9749334 |

The derived wall times are approximate: elapsed observation and deadline clocks are monotonic, and must not be equated exactly with an adjustable wall clock. Nevertheless the saved flags and implementation establish the missing stage: collection had ended and both halves had replies, but the grace-complete flag had not been obtained before the old deadline. The job continued to 1000 attempts; it did not end after 44 attempts. A finite job ending too soon is not this failure's explanation.

The controller log separately reports s1-s2 DOWN and two Reactive controller-side HEALED computations (31.7 ms and 40.2 ms). Those are controller-processing events, not proof of an observed forwarding path, outage duration, or verification-window duration.

## Existing verification rules — unchanged

1. The worker registers a passive tap on the existing owned active ping job.
2. The first subsequent actual iputils counter summary sets `first_tx` and window start. A pre-failure reply sequence cannot count as post-window reception.
3. Actual counter summaries advance `last_tx`; the first summary at least two seconds after baseline closes the collection window. A final summary can close it early, but a short window still fails the sufficient-duration test.
4. Completion requires a final summary or passage of the one-second reply grace after window end. All 44 replies being present does not bypass this policy.
5. Classification requires valid counters, completed duration ≥2 s, at least 20 attempts and 5 replies, and reception in both halves. Loss >5% or average RTT >100 ms produces degradation rather than successful quality verification. Missing evidence remains unavailable.
6. A real observation timeout remains FAILED; reachability=true and stability=false mean reachability was demonstrated but bounded verification was not completed, not that a forwarding path was proven unstable.
7. The overall verification duration includes orchestration/publication time and is not controller recovery, outage or local Fast Failover time. The start clock predates initial publication, so it can exceed the configured observation budget even before this fix.

## Phase 5 relationship

The misplaced deadline predates Phase 5; Phase 5 did not edit `VerificationWindow` or the verification classifier. Phase 5 health polling adds contention: its readback uses the same client runtime/socket locks and the worker synchronously reads 28 TC interfaces for Mesh. It can therefore expose this pre-existing timing assumption.

The live history confirms delayed admission/start, but does not record individual lock owners, socket queue waits or scheduler spans. It cannot establish how much delay came specifically from TC polling versus existing API polling, persistence, worker scheduling or host load. It would be inaccurate to claim Phase 5 was proven the sole cause. No Phase 5 injection, health, TC or monitoring behavior was modified by this fix.

## Minimal fix

Only `RecoveryVerificationEngine._begin` changes in production code: move creation of `deadline = time.monotonic() + timeout_sec` after successful, ownership-checked worker registration acknowledgement.

- Registration retains its existing separately bounded eight-second `wait_for` and failure behavior.
- After successful registration, observation receives its configured eight-second budget.
- Collection remains two seconds, grace one second, sampling requirements 20/5, quality thresholds 5%/100 ms, and the classifier unchanged.
- Setup and observation now have distinct bounded waits. Total orchestration duration may include both waits plus publication/finalization; there is no claim of an eight-second total wall-clock SLA.
- Current runtime/controller/experiment/job guards are unchanged.
- No retries, arbitrary sleeps, historic events, fake path evidence, fallback metrics or timeout-to-success override were added.
- If worker access remains unavailable for the full post-registration budget, verification can still truthfully timeout. This fix does not promise real-time scheduling under unlimited contention.

## Service Intent is independent

Standard Intent checks reachability, measured loss and measured average RTT. It does not require the Recovery Verification stability flag. Therefore SATISFIED on true / 0% / 32.07 ms is permitted even when verification timing fails. Conversely, VERIFIED recovery can still violate a stricter intent. This separation was preserved and explicitly regression-tested; neither result fabricates path verification.

## Regression coverage

Existing tests covered completed windows, reply grace, duplicate/old replies, short finite jobs, missing evidence, no reception, no traffic, ownership changes and immediate-registration timeouts. They did not cover slow registration consuming the observation deadline while a healthy real accounting window was still waiting for grace.

Three tests were added to `backend/tests/test_recovery_verification.py`:

1. **Delayed registration + live-shaped 44/44 window:** enters through the hard-failure API with active Mesh / Reactive traffic; models 7.1 seconds of queue/admission time using a virtual monotonic clock; uses the actual worker tap, PingAccounting and VerificationWindow; supplies sequences 746–789 over 2.293 seconds; requires grace before VERIFIED. The job remains active throughout verification and later finishes at 1000/998. This test was first run against unchanged production code and failed with FAILED instead of VERIFIED; it passes with the deadline-anchor fix.
2. **Bounded setup:** a never-returning worker registration still fails within its configured setup wait, with no invented counters.
3. **Intent independence:** incomplete verification still times out with FAILED while available true / 0% / 32.07 ms measurements independently satisfy Standard Intent. Path remains UNAVAILABLE.

The tests use mocked network IO and temporary SQLite files. Linux loopback tests in the focused/full suite are not Mininet live validation.

Final automated results:

| Check | Result |
|---|---|
| New delayed-registration regression before production fix | Reproduced: FAILED instead of expected VERIFIED |
| Focused Recovery Verification suite after fix | **42 passed**, 0 failed, 29.073 s |
| Complete backend suite after fix | **262 passed**, 0 failed, 121.166 s |
| `git diff --check` | PASS, exit 0 |

Full command output is retained locally in `phase5-timing-focused-tests.txt` and `phase5-timing-backend-tests.txt`; these generated logs are excluded from staging. Those automated invocations did not execute live Mininet validation. The subsequent manual live pass is recorded in the follow-up status above.

## Files changed by this investigation/fix

- `backend/services/recovery_verification.py` — deadline anchor only.
- `backend/tests/test_recovery_verification.py` — three focused regressions and required test imports.
- This report and the two adjacent automated-test output files.

Other pre-existing Phase 5/frontend changes in the worktree were preserved. No frontend, controller, topology definition, verification threshold, worker/TC, traffic-accounting or Service Intent implementation changed for this fix. SQLite was inspected read-only; historical FAILED evidence was preserved. No commit or push occurred.

## Live repeat — completed; checklist retained for future regressions

The project owner has completed the repeat successfully, with the exact results above. The investigator did not execute that manual failure injection. For future regression runs, use the same hard-failure test after deploying/restarting the backend through the existing project workflow:

1. Confirm Mesh / Reactive READY and clear prior soft impairments using the existing UI; confirm actual kernel-read baseline quality.
2. Start h1→h2, 1000 packets at 0.05 s and fail s1-s2 while sufficient traffic remains. Confirm operational DOWN and existing Reactive dataplane behavior independently.
3. Capture the **new** verification ID and full API record, including baseline/end counters, observation duration, reply bins and `complete`. Do not reuse or relabel the previous FAILED row.
4. When a complete adequate window has normal loss/RTT, expect VERIFIED / STABLE_SERVICE, reachability=true, stability=true, and path UNAVAILABLE. A genuinely incomplete/no-reception window must still fail truthfully.
5. Check overall job accounting and Standard Intent independently. Do not equate verification duration with network outage or controller processing.

**The required live hard-failure regression has now passed.** Automated reproduction/fix validation and the project owner's real Mininet retest remain separate evidence sources. Path evidence remains UNAVAILABLE; no forwarding path or exact outage duration is inferred.
