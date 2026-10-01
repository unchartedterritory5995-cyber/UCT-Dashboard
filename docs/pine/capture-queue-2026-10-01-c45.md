# Capture queue — 2026-10-01 C45, what the wrong-value lane withholds or refuses and what would settle it

Branch `pine/c45-wrong-values`. Three new probes, for the parent session
to run on the live TradingView rig with `tools/vendor_harness/tv_capture.js` — same procedure as
`docs/pine/capture-queue-2026-09-28.md` (visibility gate, **Create new ▸ Indicator**, "Add to chart" binding
gate, `__uctVH.capture({...})`, chunks, `verify_capture.mjs --assemble`). ⚠️ None of the three has been compiled
on TradingView: if a row does not compile, the error names the line — split that row out and capture the rest.

The rules these would settle are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § C45.

## New probes

| id | probe | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-C45a | `tools/visual_conformance/probes/vw-arm-history.pine` | NYSE:RDDT 1D from the listing; AMEX:SPY 1D as a second witness | a `ta.*` call inside a TERNARY arm (and the same in an `if` block): does it run only on the bars its arm is taken, over a window of those executions? Rows `T*` (irregular test), `K*` (every other bar — a window over executions and one over bars differ on every bar), `I*` (the `if` block), `N*` (an `na` input), `G*` (the heat-map-seasons gauge as numbers) | OBJECT lane: a colour whose arm calls `ta.*` under a varying test is HELD by name (`fn:conditional-history`) — witnessed by heat-map-seasons (per-arm partial windows reproduce the vendor's colour on 632 / 632 bars; every-bar evaluation reads `#9fd974` where TradingView draws `#f3e841`). PLOT lane: the arm is evaluated on EVERY bar and served — ⚠️ a value not known to be TradingView's | the per-execution window rule as plotted numbers: serve it in both lanes, or withhold the plot by name. Until then the plot lane's every-bar value stands unwitnessed (decision 1 in § C45) |
| Q-C45b | `tools/visual_conformance/probes/vw-type-word-names.pine` | AMEX:SPY 1D | which TYPE WORDS compile as a variable name: `float`, `int`, `bool`, `string`, `line`, `label`, `box`, `table` (row per word; `color` is the control) | only `color` binds (`TYPE_WORDS_BINDABLE`; witnessed by heat-map-seasons). Every other word is refused `pine:statement` | each word that compiles joins the set; each that does not stays refused, with the compile error as the witness |

## One probe, five charts — where TradingView's bar 0 is

`tools/visual_conformance/probes/vw-bar-origin.pine`: `bar_index`, `last_bar_index`, `barstate.isfirst`, a `var`
counter, `bar_index % 3`, `bar_index > 100`, a distance. `history.startsAtBar0` is asserted by the capture tool
ONLY when the first loaded bar is the symbol's first bar on that timeframe.

| id | chart | why |
|---|---|---|
| Q-C45c | AMEX:SPY **1W** and **1M**, scrolled until `requestMoreData` stops growing | `bar_index` is served today only where the series starts at the listing, and the listing rule (`listingSeed.historyFromListingOf`) is DAILY only. The committed weekly captures print `bar_index` 0 on their first bar (`vw-object-gc-*-spy-1w`, `vw-clock-close-tfchange-spy-1w`: 1,758 weekly bars from 1993) but assert nothing about a listing, so a weekly or monthly chart that does hold every bar still withholds `bar_index` (`bar-index:window`). A capture that asserts it is the witness for extending the listing rule to W / M |
| Q-C45d | NYSE:RDDT **60** and **5**, scrolled until it stops growing; note the TradingView plan | what bar TradingView counts as 0 on an intraday chart. The committed captures show 0 on the first LOADED bar (`vw-bool-cast-spy-60`: 20,616 bars; `vw-bar-counters-rddt-5`: 20,052) — a number that depends on how much intraday history the plan loads. If so, an intraday `bar_index` is not one number at all and stays withheld for good; the capture says so in writing |
| Q-C45e | AMEX:SPY **1D**, the last 300 bars only (NOT scrolled) | `barstate.isfirst` is true on TradingView's bar 0, not on the first bar a chart happens to hold; the engine answers it on the window's first bar. Not changed by this lane (decision 4 in § C45): rows `O02`, `O05`, `O06` pin what TradingView prints on a window that starts mid-history |

## What is still withheld or refused, and why

| withheld / refused as | what is unknown, and what settles it |
|---|---|
| `bar-index:window` | where TradingView's bar 0 is, on any chart whose bars do not start at the daily listing. Nothing to capture for a daily chart (bars reaching the listing settle it); Q-C45c for weekly / monthly; Q-C45d says whether intraday can ever be served |
| `bar-index:early-bars` | `bar_index > N` on the bars where a longer history could change the answer. Same as above |
| a colour HELD `fn:conditional-history` (object lane) | the per-execution window, for more than the one witnessed shape — Q-C45a |
| `pine:statement` on `float = …`, `line = …` … | whether TradingView compiles the word as a name — Q-C45b |
| `geometry:lost` / `content:lost` (a withheld object) | not a capture question: the object's setter is one this chart cannot carry (`update:target`: a target read out of a list in a loop; a loop or helper that was not converted; `line.set_xloc` and the point setters). Building those is new Pine coverage — named in § C45, "left" |
| `withheld` at `assert_scannable` / alert arm | not a capture question: the server lanes hold date-keyed bars with no clock and no listing proof. A lane that carried a clock would lift the `time-*` half |
