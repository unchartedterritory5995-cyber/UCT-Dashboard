# Evidence: W4-T17 probes and W4-T13 spike (2026-11-03)

Branch `docs/pine-w4-t17-t13-probes`. Docs and probes only: **no engine source edit, no
`SCRIPT_ENGINE_VERSION` bump needed**. Probe commit `b8715ef592` (tested tree); tested-on-master
`4ea661a8d8` (merge-base with origin/master at launch). A docs-only commit holding this file follows it.

## What was added

| file | what |
|---|---|
| `tools/visual_conformance/probes/vw-w4-int-div-window.pine` (+ `-v5`, `-v4`) | capture row **W4-D1**: `ta.wma(close, 9/2)` against `wma(close,4)` / `wma(close,5)`, `close[21/2+1]` against `close[10]`/`[11]`/`[12]`, with literal, const and `input.int` operands, plus the HMA and DPO bodies. 10 R rows + 5 C controls per version |
| `vw-w4-max-bars-back.pine` (= M1), `-m2` ... `-m5` | capture rows **M1-M5** (queue `capture-queue-2026-10-31-wsc-history.md` Q1). ONE ROW PER FILE: a Pine runtime error stops the script, so an erroring row would hide the rows after it. The error text and the bar it names are the reading |
| `app/src/components/chart/engine/__tests__/w4T17T13Probes.test.js` | 19 tests: probe well-formedness (version header, unique plot titles, never-compiled note), the "ours today" baseline of every D1 / M row, and the T13 spike measurements |

Capture chart: `AMEX:SPY 1D` (M5 needs more than 6,000 bars), then `NYSE:RDDT 1D` for D1. None of the
probes has been compiled on TradingView (no builder signs in); a line that fails to compile is itself a
reading. The shared W4 capture-queue doc is not created here (other W4 lanes add rows to it); the D1 row
for it: `W4-D1 | vw-w4-int-div-window.pine (+ -v5, -v4) | AMEX:SPY 1D, NYSE:RDDT 1D | pine:window, pine:offset-literal | hull-moving-average, detrended-price-oscillator, rsi-cyclic-smoothed | int/int as a window length or offset, per version and qualifier | T17`.

## T17: what the runtime lane does today (measured; the captures decide which are RIGHT)

D1, per row, runtime lane `buildRuntimeIr` (one row per script, controls build everywhere):

| row | v4 / v5 | v6 |
|---|---|---|
| R01 `wma(close, 9/2)` literal | builds (host folds to `wma(close,4)`, truncation) | refused `pine:window` (4.5) |
| R02 `close[21/2+1]` literal | refused `pine:offset-literal` | refused `pine:offset-literal` |
| R03 `wma(close, CLEN/2)` const | builds (folds to 4) | refused `pine:window` |
| R04 `close[CDLEN/2+1]` const | builds (folds to `close[11]`) | refused `pine:offset-literal` |
| R05-R08 `input.int` operand, HMA/DPO shapes | refused `pine:window` / `pine:offset-literal` | same |
| R09 `wma(close, 8/2)` exact | builds | builds |

Implication for building T17: v4/v5 already truncate a literal or const int quotient with **no capture
behind it**, so D1 may prove that fold right or wrong; it is a live risk until D1 lands. R02 shows the
offset reader does not fold `/` while the window reader does, so the two readers disagree today (one
authority needed when T17 builds).

M rows: M1 (`max_bars_back = 20`, `close[30]`) refused `runtime:directive` at build; M5 (`close[6000]`)
refused `runtime:directive`; M4 (`max_bars_back(x, 50)`) refused `runtime:directive`. M2 builds and the VM
stops on the first read past the buffer ("a history offset of 25 reaches past Pine's history buffer of 20
bars"). M3 builds and serves the 250-bar offset from the 5,000-bar default (bar 399 reads bar 150). Whether
TradingView draws M1, stops M2 the same way, auto-sizes M3 and stops at 5,000 in M5 is exactly what the
captures answer; M1 drawing would mean the build refusal over-refuses.

## T13 spike: can the member pane draw an OHLC row from the run?

**Answer: yes for rendering, no for feeding. T13 is an M task but needs one new carrier; it is not a
renderer task owned outside W4.** Measured (rails in `w4T17T13Probes.test.js`):

1. **The run cannot emit it:** `plotcandle(...)` / `plotbar(...)` are refused `runtime:presentation`
   (`pineRuntimeFrontend.js` `PRESENTATION_CALLS`, lowering at the `PRESENTATION_CALLS.has(word)` branch).
   The member document also names them undrawn (`memberPaneDefinition.js` `RUNTIME_UNDRAWN_KINDS`;
   `RUNTIME_ROW_KINDS` is `plot`, `plotshape`, `plotchar`).
2. **The run can compute the four columns:** four `plot()`s of o/h/l/c give four columns, and an `na` open
   is NaN on exactly that bar (hide rule input). The host lane already expands `plotcandle` into four
   outputs titled by role (`pine.plotcandle.test.js`).
3. **The renderer exists:** `pool.poolKey` maps style `candles` to a LightweightCharts `CandlestickSeries`
   and `ohlcBars` to `BarSeries` (`pool.js`, `OHLC_POOL_KEYS`); `binder.toOhlcPoints` draws
   `{time, open, high, low, close}` and turns a non-finite bar into whitespace (so `na` hides).
4. **The feed is the blocker:** the only way a binding becomes an OHLC payload is `binder.js`
   `ohlcBarsForPlot`, which reads a **symbol's cached bars** and only for a passthrough definition
   (`ohlcCapabilityOf`). A computed row is refused `NOT_PASSTHROUGH`; that gate exists because a moving
   average once drew QQQ's own bars (2026-09-13). So a computed row must not go through it.
5. **Colour carriers:** LWC 5.2.0 `CandlestickData` takes per-point `color`, `borderColor`, `wickColor`;
   `BarData` takes `color` only (no wick/border). `toOhlcPoints` emits none of them and
   `seriesOptionsForPlot` sets wick/border to follow the body.

What this implies for the T13 build (engine bump: yes, as the breakdown says):
- lower `plotcandle` / `plotbar` in the run to four output columns plus up to three colour columns
  (`color`, `wickcolor`, `bordercolor`), reusing `colorPacked` / `describeColour`;
- add `plotcandle`/`plotbar` to `RUNTIME_ROW_KINDS` and emit ONE definition plot with style
  `candles` / `ohlcBars` whose data is built from the four run columns, not from a symbol: a **second
  OHLC payload source in `binder.js`** (a new branch beside `ohlcBarsForPlot`, not a loosening of
  `ohlcCapabilityOf`), then extend `toOhlcPoints` for per-point colour/wick/border (bars: colour only);
- the `na` rule: a bar with any non-finite o/h/l/c is whitespace (already how `toOhlcPoints` behaves);
  W4-P1 must still show whether TradingView hides on an `na` open only or on any `na` role;
- legend: `valueAt` / `lastOhlcClose` already handle an OHLC payload;
- files beyond the breakdown's list: `binder.js` (new payload source, `toOhlcPoints`), `presentation.js`
  or `pool.js` only if the row cannot reuse the existing style names. The breakdown's file list names
  only `memberPaneDefinition.js` and the FE; the binder is a third file and T12 (colour carriers in
  `memberPaneDefinition.js`) must merge first or share the region.
- the acceptance still needs capture **W4-P1** (o/h/l/c and colour MATCH, `na` open hides).

## Checks

| check | command | result |
|---|---|---|
| new test file | `vitest run .../w4T17T13Probes.test.js --maxWorkers=2` | 19 passed (1 file) |
| fails when what it probes regresses (shown once) | `pool.js` `case 'candles'` returned `'line'` (mutated via python, restored byte-exact, `cmp` clean) | 1 failed: "the RENDERER exists..." (18 passed) |
| final-tip | `final-tip.sh pine-dsk-w4t17 w4t17-final tests/test_script_engine_version_gate.py` | gate pytest 46 passed (rc 0); version-gate pytest 6 passed; hygiene rc 0 (34685 tracked files, clean); chart+hooks vitest: Test Files 1 failed | 1334 passed | 27 skipped (1362), Tests 1 failed | 22379 passed | 118 skipped (22498). The one failed file is `src/hooks/pollingSites.rail.test.js`, the pre-existing desktop baseline failure, so 0 new failures. Tip `b8715ef592`. |
| hygiene | `python tools/check_repo_hygiene.py` | clean: 34664 tracked files, no oversized file, no `.env*` outside the allowlist, no line-ending flip |

Mutation table: the one mutation above (candles pool key) is killed by the renderer-exists test. The D1
and M baseline rows are refusal pins; they are expected to flip when T17 builds, with a capture cited.

Logs: `C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\runs\w4t17-final\` (gate.log, hyg.log, py.log, js.log).
