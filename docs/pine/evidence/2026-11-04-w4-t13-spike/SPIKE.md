# W4-T13 spike: can the member pane draw an OHLC row from the run?

Branch `spike/pine-w4-t13-candle` off origin/master 09453ca1a3. Docs and a probe only; no engine or app/src edit.
No licence-held text. Paths below are under `app/src/components/chart/` (abbrev `C/`).

## Answer: NO today. YES with a bounded renderer extension. Re-scope T13 to a renderer task.

The library series exists and is reachable. The data path is not: a candle row is fed only from a
symbol's own bars. Nothing can hand it four computed columns. So T13 cannot be built from W4
files alone (FE + memberPaneDefinition); it needs a binder/pool/presentation change first.

## Evidence

Series exists (the good news)
- `C/engine/pool.js:78-82` POOL_KEYS has `candlestick` and `bar`, OHLC_POOL_KEYS; `pool.js:143-149`
  `poolKey` maps style `candles` -> `candlestick`, `ohlcBars` -> `bar`.
- `C/engine/binder.js:170-171` creates LWC `CandlestickSeries` / `BarSeries`; `pool.js:699-722`
  gives options (up/down colour, wick, border follow body).

The feed is symbol-only (the blocker)
- `binder.js:1855-1872` `ohlcBarsForPlot` returns null unless the instance DECLARES a source input
  that parses to a `symbol`, `ohlcCapabilityOf` is ok (`C/engine/ohlcCapability.js:205-237`; first
  gate `outputIsSource` = `def.passthrough === true`, `:90`, `:210`), and the resolved style is OHLC.
  It returns `drawableOhlcBars(clippedBarsFor(entry.bars...))`, i.e. the secondary symbol's bars.
- `binder.js:1941-1950` `ohlcCapableFor` repeats the same symbol-source test, and it feeds the plan.
- `binder.js:2035-2041` + `:248-265` `toOhlcPoints` turns that payload into `{time, open, high, low,
  close}` ONLY. No per-point `color`, `borderColor`, `wickColor`. The comment at `:240-245` forbids
  colour threading by design.
- `binder.js:2031-2034` an OHLC payload is never displaced (`shift = 0`).
- A runtime row has none of this: `memberPaneDefinition.js:1406-1429` builds rows with `source: '0'`,
  `style: 'line'|p.style`, and no symbol source input, so `ohlcCapable` is false.

Probe (run from `app/`: `npx vite-node ../docs/pine/evidence/2026-11-04-w4-t13-spike/probe.mjs`):
```
member asks candles, ohlcCapable=false (runtime row today) -> def style line -> pool key line
member asks candles, ohlcCapable=true  (symbol passthrough) -> def style candles -> pool key candlestick
declared style candles, no instance override -> candlestick
```
Row 1: a runtime row asking for candles is clamped to a line. Row 3: a row that DECLARES `candles`
would plan a candlestick series, which the binder then has no payload for (scalar column) -> an
empty series. A build must close that edge (guard or payload), not rely on the clamp.

W4 side (all refuse today)
- `memberPaneDefinition.js:956` `RUNTIME_ROW_KINDS = {plot, plotshape, plotchar}`; `:964-972`
  `RUNTIME_UNDRAWN_KINDS` already tells the member `plotcandle: 'candles'`, `plotbar: 'bars'` are not drawn.
- `memberPaneDefinition.js:1016` `runtimeRowPresentation` (plot colour only; `runtimeRowColour` `:1037`
  refuses non-`plot` kinds); row loop `:1340-1395` maps host outputs to run outputs by kind ordinal.
- `ast/pineRuntimeFrontend.js:7019-7021` `PRESENTATION_CALLS = {plotcandle, plotbar, alert}`; refusal
  `:9710-9713` `runtime:presentation`. `RUNTIME_OUTPUT_CALLS` (`:353-356`) has no candle call.
- Host lane: `ast/pine.js:579-581` `MULTI_OUTPUT_CALLS` expands plotcandle/plotbar to four columns
  (open, high, low, close); `:29671` lists them in OUTPUT_PRESENTATION_CALLS; `REFUSALS
  ['pine:presentation-only']` (`:429`) refuses scripts whose four columns are the bare price series.
  The host lane also has no candle row.

## Conflict with T12 (origin/feat/pine-w4-t12-paint f8ddebfa76)
- T12 does NOT touch `memberPaneDefinition.js` (name-only diff: pineRuntimeFrontend.js plus tests/docs).
  The brief's `:1037-1085` expectation is wrong; no conflict there.
- T12 hunks in pineRuntimeFrontend.js: 2661, 7346-7363, 7628-7838, 9534, 9676-9760, 10098-10341. The
  T13 sites `:7019-7021` and `:9710` fall between hunks: no textual overlap, but `:9710` shifts by about
  +84 lines after T12 merges (hunk 9676 adds 3, 9760 adds 1, plus earlier +45/+16/+11/+5). Build on T12.

## If re-scoped: the renderer task (owned outside W4)
1. `engine/binder.js`: a new OHLC payload source built from FOUR computed columns of one instance
   (o/h/l/c, plus optional colour, wickcolor, bordercolor columns via the existing colour-column mechanism
   `columnColorsForPlot`, `pool.js:863`), alongside the symbol one (`ohlcBarsForPlot` `:1855`,
   `toOhlcPoints` `:248`, point build `:2035`, `hasData` `:1919-1923`, legend `valueAt` `:2573`).
   Emit LWC per-point `color`/`wickColor`/`borderColor`. Whitespace point when o/h/l/c is non-finite.
2. `engine/ohlcCapability.js` + `binder.js:1941`: capability true for a row that declares computed OHLC
   columns (new declared claim, not `passthrough`).
3. `engine/presentation.js` / `defSchema.js`: let a document row declare style `candles`/`ohlcBars` with
   column refs, and the per-point colour rule; keep the clamp for everything else.
4. `pool.js:699-722`: per-point colours must beat series options.

## If then built as T13 (W4 side)
- Row shape: one row `{style: 'candles'|'ohlcBars', ohlc: {o,h,l,c: output indices}, colourOutput?,
  wickOutput?, borderOutput?}` (names indicative until the renderer settles them).
- `na` open (or any of o/h/l/c) -> whitespace, so the candle is hidden (spec acceptance).
- Files: `pineRuntimeFrontend.js` (add the two calls to RUNTIME_OUTPUT_CALLS, remove from
  PRESENTATION_CALLS `:7019`, lower to four column outputs + colour outputs; refusal `:9710`),
  `memberPaneDefinition.js` (RUNTIME_ROW_KINDS `:956`, drop from RUNTIME_UNDRAWN_KINDS `:964-972`,
  `runtimeRowPresentation` `:1016`, row loop `:1340-1395`), host `pine.js:29671`/REFUSALS only if the
  host lane should also draw.
- Spec's rail/measure-pair (W4-BREAKDOWN T13): capture W4-P1 MATCH on o/h/l/c and colour; mutation swap
  high/low columns -> capture rail red. measure-pair first-wall movers:
  `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor`, `volatility-trend-score-backquant`,
  `uptrick-volatility-adjusted-trail` (attach expected: `uptrick-volatility-adjusted-trail`), both
  runtime lanes via `measure-pair.sh <out> tip:<wt> base:<base-wt> <0|1> 1`. Engine bump: yes.
- Unmeasured: whether LWC per-point wick/border colours behave on this version, and `plotbar`
  (BarSeries takes `color` only). Not probed (needs a browser).
