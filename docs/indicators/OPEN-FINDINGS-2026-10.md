# Open findings recorded during Batch 1 production acceptance and Batch 2 (October 2026)

Recorded, not fixed: each is outside Batch 2's scope (owner ruling: "Record, but do not expand
this batch to implement"). Dated 2026-10-08/09.

## 1. RSI with level lines cannot carry an alert (Indicators — existing limitation)

**Seen:** production, real model, 10-08. "Build me an RSI indicator with a moving average", then
"Alert me when the RSI crosses above 70" was refused at authoring time:

> Its sibling plot `levels` is refused by the alert lane (plot), and the lane admits a definition
> whole. This document declares several plots and carries no tree for this one …

**Why:** the alert lane admits a definition as a whole, and the horizontal-levels plot (`hlines`,
the 70/30 guide) has no formula tree, so any definition that draws level lines refuses every alert.

**Member impact:** the most natural RSI request ("RSI with overbought lines, and alert me at 70")
cannot be completed in one indicator, and the refusal is written in engine language (no
member-words mapping for this guard). The member can work around it only by removing the levels.

**Suggested direction (not done):** let the alert lane skip a plot that is presentation-only
(`style: 'hlines'`, no tree) instead of refusing the definition; and map the guard to member words.

## 2. The Save receipt covers chart content (Indicators — Batch 1)

The receipt card is placed at the chart's top-left inset. On the production drill board it sat over
the legend / top-left object table (the position-size calculator) until dismissed. A complete receipt
fades after 6 s; a partial one stays until dismissed — so the overlap persists exactly when the
member most needs to read both.

**Suggested direction (not done):** anchor the card where chart objects are not drawn (for example
bottom-centre above the time axis), or offset it below the legend block.

## 3. An output's label changed during a rename turn (Indicators — model behaviour + design)

Two separate effects, observed on 10-08 in production:

- **Model:** on "Okay, make the RSI length 28 and call it Momentum Pulse." the model renamed the
  *definition* correctly ("Momentum Pulse") but also relabelled the RSI *output* to "Momentum" — an
  unrequested `rename_output`. Nothing in the engine stops a model from relabelling an output the
  member did not name.
- **Design:** in a ONE-output definition the plot's label follows the definition's name (the legend
  chip shows the name cut to 12 characters), so renaming the indicator also renames that label.
  This is intended (`readback.outputNamer` / derived naming), but members may read it as unintended.

**Suggested direction (not done):** refuse (or drop) a `rename_output` whose new label the member
did not give in their own words on that turn, mirroring the member-name rule for definitions.

## 4. Shared-layout colour sinks still unchecked (chart / workspace owner)

From the 10-08 security hardening (handoff: `scratchpad/HANDOFF-chart-workspace-colour-sinks.md`):
`app/src/pages/charts/CompareSymbolsPanel.jsx` (compare-symbol colour dots, `style={{ background: s.color }}`)
and `app/src/components/chart/ChartToolbar.jsx` (drawing-toolbar colour swatch) write colours from
shared chart layouts into CSS without `objectColour.safeCssColour`. Privacy-beacon class (a CSS
`url()` fetch), no script execution. Owner: chart/workspace. The helper and test pattern exist
(`engine/objectColour.js`, `engine/__tests__/presentationColourSinks.test.jsx`).

## 5. Breadth's live-data flag (Breadth owner)

On 10-08 evening the Breadth session found `BREADTH_LIVE_ENABLED=0` set on Railway `web` (all live
breadth off) and asked whether the Indicators session set it. **It did not** — the Indicators release
touched no Railway variable (one guarded push, and read-only reads of eight budget/cohort keys). The
notebook record on master (`docs/notebook/RESUME-2026-10-08.md`, commit `2bd0c37c30`, "10/08 incident
follow-up") shows `BREADTH_LIVE_ENABLED=0` already set during the 10-08 web-stall incident and
`BREADTH_EXCH_SYNC_ENABLED=0` set 18:33 CT as an incident lever. Owner: Breadth / the incident's session.

## 6. A saved indicator's other-symbol read is not fetched after a page reload — ✅ FIXED in Batch 2 hardening

**Seen:** local sandbox, 10-08, while accepting Batch 2. A saved status table on AAPL with an
"RS vs SPY" cell (`close / sym("SPY", close)`) showed the label and no value after a reload; the
backend log shows no `/api/bars/SPY` request at all. Switching the timeframe 1W → 1D fetched SPY
(`GET /api/bars/SPY?tf=D…`) and the cell appeared (0.440, coloured). Not Batch 2-specific: a plot
reading `sym()` takes the same path.

**Why (read from the code, not fixed):** `StockChart.jsx` calls
`useSecondarySources(_storedInstances, _defOf, resolvedTf, barCount, instFetcher, csView)`.
`_defOf` is a `useCallback(…, [])` (never changes identity) and `csView` does not change when
the member's saved definitions finish loading, so the needed-symbol set is computed once while
`_defOf` still answers null and is never recomputed. The neighbouring `useLowerTfSources` takes
`userDefsGeneration` for exactly this reason.

**Engine path verified:** through `objectReaderFor` with SPY supplied the cell reads the value
and its conditional colour; with SPY absent the cell is WITHHELD (the shipped `readUnknown`
rule), never "NaN" and never a state colour.

**Fixed (10-09):** StockChart passes `_otherSymbolsRevalidate = {csView, userDefsGeneration}` to
`useSecondarySources` and `useOtherSymbolExchanges`; verified in the sandbox (RS vs SPY 0.440 after
reload) and pinned by `engine/__tests__/secondarySourcesRevalidate.test.jsx`.

## 7. Authored and Pine-imported markers never drew on a live chart — ✅ FIXED in Batch 2 hardening

Found during Batch 2 browser acceptance (item 5, "big orange up arrows"). Two causes, both older
than Batch 2: (a) the binder draws `plots[].marker` only through an injected
`ctx.createSeriesMarkers`, and StockChart never injected it (unit tests use a fake); (b) on the
price pane an above/below glyph rode the plot's own 0/1 series, i.e. price ≈ 0 — 900 px below the
pane. Fixed: StockChart injects `createSeriesMarkers`; on pane 0 an `aboveBar`/`belowBar` glyph
rides the price series (other panes and `inBar` unchanged), cleared when its binding goes.
Pinned by `engine/__tests__/markerHost.test.js`. Pine `plotshape`/`plotchar` imports benefit too.

## 8. Inspector offered colour/width controls for hidden data columns — ✅ FIXED

A colour rule's hidden index column (`_c`, `_cs`) and table-only outputs carry their own
`$…Color`/`$…Width` inputs (built per row since the overnight colour rule). The binder never draws a
`hidden: true` plot, so these were controls with no effect ("hist colour rule …"). The Inspector now
omits inputs read only by hidden plots (`indicatorRegistry.hiddenPlotOnlyInputKeys`) and gives
hidden plots no style row. Stored definitions are unchanged.

## 9. Light chart themes render table plain text at low contrast (chart-theme owner)

On the "Paper" chart theme, table cells with no colour of their own (and the legend / OHLC labels)
use the theme's `textColor`, a pale grey on white. Batch 2's conditional cells fall back to the same
`chart.fg_color`, so they match the chart; the issue is the theme's text colour. Not changed.

## 10. `useFundamentalSources` has the same reload pattern as §6 (chart owner)

`StockChart.jsx` passes `csView` as its revalidate; a pinned `fund:` source whose definition loads
after the chart restores could be missed the same way. Not changed (chart-owner feature).

## 11. "Relative strength" with no benchmark named (Indicators — prompt, Batch 2)

The owner's acceptance sentence ("…RSI, trend direction, and relative strength…") names no
benchmark. The Phase 5 backstop refuses a change that reads a symbol the member did not name, so a
model that assumed SPY produced a hard refusal. Batch 2 adds a system-prompt rule: with no symbol
named, ask which one (`clarify`). Needs real-model confirmation.
