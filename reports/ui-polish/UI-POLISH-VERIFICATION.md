# Self-Healing SDN — Second-pass Visual Polish & Motion

Date: 2026-11-04. This pass builds on the first redesign. It preserves the landing sections, nine-page information architecture, routing, responsive layouts, dynamic topology layout and existing operation handlers. No commit or push.

## Files changed in this pass

| File | Presentation change |
|---|---|
| `frontend/src/motion.css` — new | Palette refinement, surface hierarchy, entrance/hover/press/status/value/drawer motion, SVG phase loop and reduced-motion rules |
| `frontend/src/main.tsx` | Imports the presentation-only polish stylesheet after the original design system |
| `frontend/src/pages/LandingPage.tsx` | Three headline reveal lines, scroll-reveal groups/targets, hook attachment; existing copy, sections and links retained |
| `frontend/src/components/landing/NetworkIllustration.tsx` | Primary-link failure and alternate-path illustration, clearer captions/labels, pause when offscreen or the document is hidden |
| `frontend/src/components/ui/useViewportReveal.ts` — new | Reusable one-time IntersectionObserver reveals using the browser Web Animations API |
| `frontend/src/components/ui/Primitives.tsx` | Animate the rendered metric/status only when its exact value/tone/text changes |
| `frontend/src/components/TopNavbar.tsx` | Brief presentation feedback when controller-readiness or WebSocket state changes |
| `frontend/src/App.tsx` | A keyed content wrapper for fast page entrance; existing dashboard lifecycle, store and routes retained |
| `frontend/tests/motion.test.tsx` — new | Readability before effects, illustrative/operational separation, exact zero/N/A/failure rendering |
| `frontend/tests/ui-browser.mjs` | Both motion preferences, SVG phase checks, anchor/reveal/pause checks, screenshots, existing nine-page read-only smoke checks |
| `reports/ui-polish/` — new | This report, browser evidence and screenshots; first-pass report/screenshots remain available |

The repository still contains the uncommitted first-pass redesign. The inventory above distinguishes this second pass from those earlier edits.

## Exact motion system

| Element | Motion and timing | Trigger / boundary |
|---|---|---|
| Header | Opacity + 12 px entrance, 500 ms | Landing mount only |
| Hero eyebrow | 520 ms, 60 ms delay | Landing mount |
| Headline lines | Upward reveal, 700 ms; delays 110 / 180 / 250 ms | Each line reveals in sequence; last finishes at about 950 ms |
| Description / CTA / footnote | 550–600 ms; delays 270 / 350 / 400 ms | Staged alongside headline, without a multi-second gate |
| Hero visualization | Opacity + 14 px translation + 0.98→1 scale, 750 ms / 240 ms delay | Landing mount; no layout resizing |
| Landing sections | 16 px upward entrance; opacity 0.35→1, 540 ms; 85 ms child stagger, capped at 425 ms | IntersectionObserver threshold 0.12 and bottom root margin −35 px; unobserved after first reveal |
| Process connectors | Horizontal line reveal, 600 ms, 100 ms step stagger | Section entry; vertical on narrow mobile |
| Strategy cards | 3 px lift, stronger border/shadow, diagram line extends | Fine-pointer hover only; no continuous motion |
| Capability cards | 1 px lift, subtle lavender surface and icon response | Fine-pointer hover only |
| Buttons | 160–220 ms color/depth transition, 1 px hover lift, 2 px trailing-icon shift, 1 px press | Hover/press; disabled controls excluded |
| Navigation text | Underline scales in | Hover / keyboard focus |
| Dashboard content | 7 px upward entrance + opacity, 180 ms | Tab changes only; sidebar and runtime remain in place |
| Sidebar | Selected marker opacity/scale, surface/icon color transitions | Selection/hover; no glow or permanent pulse |
| Status/readiness/transport | 2 px settle + opacity, 220 ms | Rendered state/text/tone changes; no repeated healthy-dot pulse |
| Overview metric values | Opacity settle, 200 ms | Exact displayed value changes; no numeric interpolation or synthetic samples |
| Real topology edges | Stroke, width and opacity transition, 200 ms | Existing reported path/failure/selection changes |
| Nodes | Border/surface/elevation feedback | Hover and selection; no invented operational status |
| Inspector | 16 px side entrance, 220 ms; backdrop 180 ms | Native dialog opens; existing focus/Escape behavior retained |

There is no exit animation delaying dashboard navigation, no scroll interception/snapping and no animation framework.

### Hero sequence

The repeating 12-second loop is explicitly an **illustration, not live telemetry**:

1. Primary path via s2 carries subtle short SVG dashes; the alternate branch remains visible but inactive.
2. At approximately 32% of the illustration cycle, only s1↔s2 becomes coral/dashed, a small break and LINK DOWN label appear, and primary packet pulses stop.
3. During the interruption phase, no replacement packet route is claimed yet.
4. At approximately 48%, the lower branch via s3 becomes active and carries the illustrative pulses; the caption says PATH RECOVERED.
5. The recovered state holds, then the illustration resets and repeats.

These percentages and seconds describe CSS artwork, not measured network/controller performance. The loop is decorative explanatory content; repeated phase captions are hidden from screen-reader announcements, with a static accessible description instead.

The illustration's internal CSS animations pause when outside the viewport or when the browser document is hidden. No React frame loop, interval, animation-library runtime or telemetry subscription was added.

### Real dashboard topology

The dynamic graph, nodes, links and paths still come from the existing store. There are **no packet pulses on the operational graph**, including while idle. Available traffic totals and controller-reported paths do not independently establish per-edge packet direction. This pass therefore uses only reported edge-color/width transitions rather than suggesting unverified directional traffic. DOWN links remain labeled, and selection never removes a failure's red encoding.

## Palette and surface changes

- Warm light background retained, with more neutral graphite text and cooler secondary surfaces.
- Primary accent refined to plum (`#75516f`), with lavender action surfaces rather than violet across every card.
- Navigation moved to deep forest/graphite (`#23312c`), with a plum selected surface and pale lavender marker.
- Hero network uses a contrasting forest canvas (`#24312b`), lavender primary routing and muted green alternate routing; coral is reserved for the failure stage.
- Problem section gains a subtle lavender surface; strategies use a cool neutral secondary surface with restrained neutral/plum/green top rules.
- Overview distinguishes the network summary, central topology surface, lavender quick-action surface, supporting processing panel and traffic evidence surface.
- Semantic healthy/warning/failure colors retain text and symbols; no new health score or recovered state is inferred.
- Shadows are small surface/elevation cues, not glowing borders. The hero's faint tonal backdrop is stationary and competes minimally with content.

## Accessibility and performance

**This Windows environment reports `prefers-reduced-motion: reduce` by default.** This may explain a static appearance during the earlier manual review. The site continues to honor that preference. Windows settings were not changed. Browser QA explicitly emulates both `no-preference` and `reduce` for verification.

For a full-motion manual review, use browser developer tools to emulate `prefers-reduced-motion: no-preference`, or enable Windows animation effects if that is your desired system preference. With reduced motion requested, the correct behavior is readable static content and a static illustrative alternate path.

- Reduced motion disables CSS animations/transitions and smooth anchors. The reveal hook skips new animations and cancels in-flight Web Animations if the preference changes.
- No content waits hidden for JavaScript or an observer. Scroll targets remain rendered/readable before the effect; entry animation begins at opacity 0.35. Unsupported observers/Web Animations leave content visible.
- Observers/listeners/animations are cleaned up on unmount. Revealed sections are unobserved and do not replay when scrolled back into view.
- Fine-pointer hover effects do not become sticky motion on touch devices.
- Existing focus rings, semantic buttons/links, labels, native dialog focus containment, Escape and focus return remain.
- Dashboard measurements change directly to the actual supplied text. There are no counters counting up through fabricated values, new samples, extra fetches, new subscriptions or modifications to the WebSocket service.
- SVG stroke/color work is limited to a small public illustration. Most entrances use opacity/transform. No expensive filters, parallax, particle system or continuous dashboard animation was added.
- No dependency, package manifest or lockfile change.

## Verification

| Check | Result |
|---|---|
| Existing frontend suites, including first-pass redesign tests | **67 passed** |
| New motion/readability/truthfulness suite | **3 passed** |
| Total frontend | **70 passed, 0 failed** |
| Standalone TypeScript check for all frontend test sources | PASS |
| Application TypeScript (`tsc -b`) | PASS |
| Production build (`npm run build`) | PASS |
| Backend regressions (`python3 -m unittest discover -s backend/tests -v`) | **128 passed, 0 failed**, 76.905 seconds |
| Diff whitespace check | PASS |
| Protected backend/controller/store/API/WebSocket/metric/request-ID/dependency diff | No changes |

Final production assets: 871.12 kB JavaScript / 257.48 kB gzip; 79.04 kB CSS / 15.89 kB gzip. Compared with the first redesign build, compressed JavaScript increased about 0.77 kB and compressed CSS about 2.92 kB. Vite's existing >500 kB JavaScript-chunk advisory remains. An intermediate CSS build reported an unsupported `@theme` in the standalone stylesheet; it was corrected to ordinary custom properties, and the final build has no new CSS warning.

All frontend test suites were bundled with the installed Rolldown CLI, then executed individually using Node's test runner under WSL. The backend tests are existing isolated regressions, not a fresh live three-controller experiment. No live controller/Mininet/traffic/failure mutation was sent by browser QA.

### Browser verification

Hidden Edge tested the production build served by the existing FastAPI backend. [Browser evidence](browser-evidence.json) records console exceptions/errors, failed responses, mutation requests and the relevant API reads.

Verified:

- Full-motion headline sequence and each illustrative healthy / LINK DOWN / PATH RECOVERED phase, sampled deterministically through browser animation controls.
- Native anchor navigation and scroll-triggered section reveals.
- No replay when returning to an already revealed process section.
- Illustration animation pauses when offscreen.
- Reduced-motion illustration and headlines are static; smooth scroll becomes `auto`.
- All nine sidebar destinations and direct deep links; refresh and browser back/forward.
- Actual controller options and connected WebSocket, accessible form labels and desktop/laptop/tablet overflow checks.
- Mobile landing layout at 390×844.
- Zero application console errors/exceptions, zero failed HTTP responses and zero mutation requests in the successful browser run.

Runtime was STOPPED during dashboard captures. The overview may show a measured duration from **loaded historical processing events**, with that provenance explicitly labeled. This is neither current-session healing nor a fabricated decorative metric. Live graph failure/path transitions, native drawers on real discovered elements, traffic changes and experiment execution should still receive the manual live verification below.

## Screenshots

- Landing hero: [healthy](hero-healthy.png), [link down](hero-link-down.png), [recovered](hero-recovered.png)
- Lower landing: [process sequence](landing-process.png), [strategy section](landing-strategies.png), [full page](landing-full.png)
- [NOC Overview](overview-desktop.png)
- [Topology page](topology-desktop.png)
- [Mobile landing](landing-mobile.png)
- Other pages: [Traffic](traffic-desktop.png), [Experiment Lab](experiment-desktop.png), [Analytics](analytics-desktop.png), [Event Logs](logs-desktop.png), [System laptop](system-laptop.png), [System tablet](system-tablet.png)

## Manual verification checklist

1. Review the landing with full motion enabled/emulated. Confirm quick staggered entry, the complete 12-second recovery loop and clear illustrative labeling. Leave it through multiple cycles.
2. Scroll through every section, return upward and confirm reveals do not repeat. Test both native anchor links and normal wheel/touch scrolling.
3. Inspect strategy/capability hover, CTA trailing-arrow movement, press response, keyboard focus and disabled buttons. Check touch/mobile without hover.
4. Enable reduced motion or restore the system preference. Confirm all content remains visible, motion stops, no repeated phase announcement occurs and anchor scrolling is immediate.
5. Navigate all nine dashboard pages at laptop/tablet widths. Confirm the short content entrance, stable sidebar/runtime, active indicator and no overlapping actions.
6. Start the existing SDN environment manually. Confirm controller READY/FAILED, simulation and WebSocket changes display actual state and settle once rather than permanently pulse.
7. Confirm topology node hierarchy/hover/selection and real switch/host/link inspectors, including keyboard focus, Escape, refresh and visible read errors.
8. Generate actual traffic. Confirm Tx/Rx/loss/RTT values change directly to measured values; zero and N/A are preserved. Confirm idle graphs have no packet animation.
9. Fail and restore an actual link. Compare API/Mininet/OVS state with the graph, failure text and edge transition. Verify reported path changes without claiming unmeasured recovery or local FF timing.
10. Run/cancel a disposable experiment and inspect terminal message, stored results/exports, measured-only Analytics and event search/filter/refresh. Ensure existing cleanup and error semantics remain intact.
11. Review diagnostics and existing maintenance confirmation without accepting cleanup accidentally. Check browser console during these real operations.

No backend/controller/traffic/experiment/WebSocket/database behavior was changed. No commit or push was performed.
