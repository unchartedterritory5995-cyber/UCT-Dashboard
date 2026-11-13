# PR: Zoom one chart in or out (C1-028), and C1-022's log and arithmetic outcome tests

Branch `agent/pl/chart-zoom` from master `7a2c1fae47`. One Charts action family, releasable on its own: **view gestures, chart zoom**. Evidence class: LOCAL / SIMULATED (vitest, jsdom, scripted model; no real browser, no real model, no backend).

## What a member can now ask

| Row | Request | What runs (the member's own writer) | Read back | Undo |
|---|---|---|---|---|
| C1-028 | "zoom in on this chart", "zoom the AMD chart out", "zoom out a lot", "give me a wider view of the chart" | the + / - keys' time-axis zoom. It is now one function, `zoomTimeAxis(chart, out, steps)` in StockChart.jsx (module scope); the key handler calls it with one press, and the Agent reaches it through `onDateNavApi.zoom` → `ChartPane.viewDo('zoom')`. n steps = the width × 0.8ⁿ (in) or × 1.25ⁿ (out) around the window's centre, which is the same arithmetic as n key presses. | `getDateMeta().frame`: the window's width (logical `to − from`) moved the asked way by at least half a bar, and is the width asked within a bar (the time scale's clamp included) | exact: `restoreView` puts back the window and the view lock (and the active range) it zoomed from |
| C1-022 | log and arithmetic by name | `chart.setScale` (unchanged), the A / L / % toggle's stored keys | `settings.logScale` / `settings.percentScale` | exact (settings) |

New capability: `chartSetup.zoom` {`direction` in | out, `steps` 1-10}. Target kind `chart`, so the chart resolution (deixis, the clicked chart, "Which chart?") and #988's wrong-chart rules apply unchanged. Member-facing strings: summary "Zoom ONE chart's time axis in (fewer, wider bars) or out (more, narrower bars), like pressing + or - on the chart…"; receipt "Zoomed this chart in[ n steps | as far as it goes], the same as pressing + on it (view only; every bar is still there)"; the undo note, the two limit refusals and the step-range refusal below.

### Is the key move behaviour-identical?

Yes. The key handler's inline block (read the logical range; if `to > from`: `preventDefault`, centre, `half = width × (key === '-' ? 1.25 : 0.8) / 2`, `setVisibleLogicalRange` in a `try {} catch {}`) moved verbatim into `zoomTimeAxis`, with the factor raised to the `steps` power (1 for a key press). The handler is now `if (zoomTimeAxis(chartRef.current, e.key === '-', 1)) e.preventDefault()`. The only order change: `preventDefault` runs after the range is set rather than before, in the same synchronous handler, so the browser sees the same thing. A source check pins that the old inline arithmetic is gone, so there is no second zoom path.

`getDateMeta()` also reports `zoomLimits` = {minWidth, maxWidth} from the time scale's own clamp (lightweight-charts 5.2: `minBarSpacing`, and `maxBarSpacing` or half the plot width when it is 0; width = plot width ÷ spacing − 1, the units of `to − from`). Null when unreadable.

## Safety rules

1. A zoom claims success only when the window width moved the asked way to the width asked. A chart that did not change, or zoomed the wrong way, gets no receipt.
2. At the limit it refuses before the chart is told anything: "This chart is already zoomed in (out) as far as it goes." Near the limit it zooms to the limit, and the receipt says "as far as it goes" (the read-back expects the clamped width).
3. An unreadable window (chart still loading) refuses before anything is called. Steps outside 1-10 refuse and point at a range.
4. Undo restores the exact window, view lock and active range (`restoreView`, read back with `sameFrame`, which includes the lock). It goes stale once the member pans or zooms (or steps) the window: Undo then refuses with "has changed since" and moves nothing. Fingerprint: the window to a tenth of a bar, as the step uses.
5. Not destructive (a view, nothing saved), so no confirmation card, as setRange / stepBars.
6. Targeting: with two charts, only the chart named zooms (wrong-target control test).

C1-026 (drag the price axis to compress) stays BLOCKED: there is still no read-back for it. The discovery `known` line for charts now names it instead of "free zooming in or out".

## Routing

`chartSetup.zoom` is in a new group, **`chartView`**: `wordsOnly: true`, `fillLast: true`, one action, declared LAST in `GROUPS` so every existing group keeps its place and its listing order (routing.js diff: additions only; existing groups character-identical). Later view gestures can join it. It is selected only by its own words: zoom + in / out (optionally "the AMD chart" between), "closer / tighter … on / at the chart / candles / bars", "a wider / zoomed-out view of the chart", "show / see / fit more / fewer bars". Not by "reset the zoom" (chartSetup.resetView), not by a "zoom" with no direction (a company, a ticker), not by "zoom into …", not by "make the chart wider" (workspace).

Rails in `app/src/agent/nlm1/nlm1Routing.test.js`: chartView in `OWN_WORDS` (7 phrases: `wordsSelect` true and the v2 first call carries it), plus 12 negative controls (v1 words and v2 first call both without chartView). The generic "unrecognised requests carry no words-only group" rail now covers chartView too.

**Group count.** Declared groups: master 26, this branch **27**. The charts listing the server receives (`routing.groups`, groups present in the manifest): master 24, this branch **25**. Server `turn.py` `MAX_GROUPS` is 24 on master (`validate_routing` keeps `groups[:24]`), so on master's server chartView, last in the listing, is cut from the "other groups" list: the model is not told it exists when the words did not select it. When the words select it, the action is in the manifest and works. PR #1089 (MAX_GROUPS 32) removes the cut; with the other queued PRs (+5 groups) the declared count would be 32. The routingMaxGroups rail from #1089 is not on master.

## Numbers

- Count pins (commented arithmetic in each): agentRouting FULL 164 → **165**; agentScreener `manifestFor(CTX).length` 158 → **159**; agentNl1Selection core 37 + 0 = **37**; agentIndicatorsM2 indicators group 12 + 0 = **12**.
- Routing v1 and v2 first calls, master `7a2c1fae47` vs branch `a34a4eae55`, 3650 requests: **1 differs in each, in→out 0** (in→in 1, out→in 0, out→out 0). The one row (nlm1-dev[24], not held-out) adds chartView and removes nothing; the expected timeframe action stays in. Rows with an expectation in the first call: v1 643/789 both, v2 676/789 both. Table: `docs/agent/program/evidence/chart-zoom/first-calls.md`.
- Focused run A (18 files, one vitest run, no lock): **2447 / 2447 passed**. The 4 count pins; agentNl1SelectionCoverage (NL-1 first call corpus 174/182, dev-nl1 43/43, heldout-v1 164/165: the same as master, no loss); agentExecReach (every pin holds; list held-out v2 **8/8**; widget held-out v2 21/24, the same 3 misses as master); agentScanSat1Requests (after the re-capture); routeReachability; agentNoLookbehindEquivalence (**0 frozen rows changed**, nothing re-recorded); noRegexLookbehind; capreg corpus.routing, corpus.routingV2, inventory, golden, routingCollision, routingCollisionV2; agentContracts; nlm1Routing.
- Focused run B (14 files): **1685 / 1685 passed**. The #988 targeting rails (agentExcludedApproved, agentExcludedGate, agentEveryExceptSet, agentExceptCard, agentNoLookbehind988, agentStativePriceClause, agentNegatedClickAct); agentChartZoom (13/13); agentChartViewNudges (15/15); boardArrangement.outcome (incl. C1-022 ×3); capreg corpus.deterministic, corpus.finalState.2, corpus.finalState.3, corpus.dark.
- Mutants (each reverted after): zoom read-back accepts any window → 2 red; zoom dropped from undoPatch (no restoreView) → 2 red; the zoom-in limit refusal switched off → 1 red.
- pytest (venv, 20 files: every server test that reads the golden, the parity fixture or section_b_requests, plus test_uct_agent_capreg_baseline and test_uct_agent_nl1_selection): **890 passed, 1 failed** + section_b reader 19/19. The 1 failure is `test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first`, and **only because of MAX_GROUPS**: the listing is 25 groups, `validate_routing` keeps 24, so chartView is missing from the need_groups enum. With `MAX_GROUPS = 32` (a temporary local edit, reverted, as #1089 sets it) the file passes 17/17.

Regenerated, each in its own run: capreg coverage (`UPDATE_CAPREG=1`, inventory), `baseline.lock.json` (`tests/test_uct_agent_capreg_baseline.py --update`, 172 intents), `manifest.golden.json` (`UPDATE_AGENT_GOLDEN=1`, twice: after the capability, and after the hints change), `tests/fixtures/nl1_assemble_parity.json` (`UPDATE_NL1_PARITY=1`). SAT-1 section B re-captured in its own commit (`b77e5ee9de`): all 30 hunks are the same 4 added lines, the chartView entry in `routing.groups`.

## Status rows (CHARTS_EXECUTION_STATUS.md, edited here)

- C1-028 Zoom in/out (+/-): BLOCKED → **VERIFIED †** (the chart's view is a stand-in inside the panel test; StockChart's half is a source check). Tests: `agentChartZoom.test.jsx` (13) + capreg `chartSetup.zoom`.
- C1-022 Arithmetic/log/percent: PARTIAL (SIMULATED) → **VERIFIED (SIMULATED outcome test)**. Tests: `boardArrangement.outcome.test.jsx` C1-022 ×3 (percent, held-out phrasing; log; arithmetic).
- Counts updated from the two rows (C1 Scale, C1 View, C1 all, Total 245 / PARTIAL 10 / BLOCKED 42, Combined counts). "The number" headline is left for the merge recount.

## Requests to try live (a chart open on /charts)

1. "zoom in on this chart": fewer, wider bars, the same as one press of +. Then "undo": the old window is back.
2. "zoom out a lot": three presses of -.
3. Press + many times until it stops, then "zoom in": "already zoomed in as far as it goes", nothing moves.
4. Zoom, then scroll the chart by hand, then "undo": it refuses (the view has changed since).
5. With two charts, "zoom the AMD chart out": only that chart moves.

## Known limits

- No fast path: the model passes the direction and steps.
- A live intraday bar that lands during the read-back wait does not change the width, so it does not break the read-back (unlike a step).
- On master's server (MAX_GROUPS 24) chartView is reachable by its own words only (see Routing).
- C1-026 price-axis compress: still BLOCKED.

## Merge notes

- Count pins, golden, parity, capreg coverage + lock and SAT-1 conflict with every PR that adds a capability or group: regenerate on the merged tree.
- The capreg corpus inserts one intent after `chartSetup.autoScale`, shifting later finalState slices (harmless).
- `discovery.js` charts `caps` / `canDo` / `known` lines: keep both sides.
- `agentChartViewNudges.test.jsx` pins ChartPane's view-op allow-list literally; it now ends `'autoScale', 'zoom'`.
