# W4-T13 plotcandle / plotbar from the run: evidence

Branch `feat/pine-w4-t13-candle` (desktop, builder session W4-T13b), stacked on W4-T12
(`origin/feat/pine-w4-t12-paint` `f8ddebfa76`, READY). Code tip tested: `eab79680d9` (the evidence commit on top is docs only).
Base for measure-pair and tested-on-master: `f8ddebfa76`. The owner delegated the ownership ruling: both the renderer part and
the W4 side are built in this lane. Spike: `origin/spike/pine-w4-t13-candle` (`a561fc12ba`).

## What changed
Renderer (a candle row drawn from FOUR computed columns of a document):
- `engine/defSchema.js`: plot styles `candles` / `ohlcBars`; `plots[].ohlc = {open, high, low}` (the row's own column is the
  close) and `plots[].ohlcColors = {body, wick, border}` (bar: `{body}`), checked by `validateOhlc` (required on those styles,
  forbidden on others, references must resolve). Server mirror `api/services/presentation_schema.py` `_check_ohlc`; the shared
  fixture `tests/fixtures/ast/p2_presentation_schema.json` (vocab + 7 cases) holds browser and server equal.
- `engine/binder.js`: `computedOhlcPayload` builds the existing OHLC payload from the columns, with per-point `color` /
  `wickColor` / `borderColor` from packed colour columns (`na` = the transparent entry), memoised on every column identity;
  `toOhlcPoints` hands the colours to the series. A non-finite open/high/low/close is whitespace (the candle is hidden).
  Library check: `lightweight-charts@5.2.0` typings give `CandlestickData.color/borderColor/wickColor` and `BarData.color`
  (per-point colours beat series options). The render rail asserts the payload handed to the series and that
  `borderVisible` / `wickVisible` are not switched off. No browser was needed or opened.
W4 side:
- `pineRuntimeFrontend.js`: with `opts.plotColours` (the runtime pane's two doors only) `plotcandle` / `plotbar` emit four
  price outputs (`role`, `group`) plus colour outputs appended last. `emitColourField` is the one colour lowerer (a plot's
  `color =` uses it too; a bare `na` colour is allowed only for a candle). Unknown named argument, missing price, text or a
  colour as a price: refused by name. Without the opt-in (the live OBJECT door) `runtime:presentation` is unchanged.
- `memberPaneDefinition.js`: pairs host and run candles (count mismatch -> `runtime:output-map`), one row per candle, hidden
  columns for open/high/low and the colours. `runtimeCandlePresentation` withholds BY NAME: v<5, `show_last`, `display` other
  than all/pane, `force_overlay = true` over a non-overlay script, any colour the call did not write (TradingView default not
  captured), a colour the lane could not compute. `display.none` candles are skipped. The host hiding a bare-price candle
  (`passthrough`) is not an author hide: a candle that recolours the chart's own bars is drawn.
Master's answer at the live object door is unchanged. Scripts the HOST lane already accepts are drawn by it exactly as on base
(it draws a candle's four columns as lines); only the runtime fallback draws candles.

## Rails (red on base, green on tip)
Files: `builder/memberPane/w4T13CandlePane.test.js` (10), `engine/__tests__/w4T13CandleFrontend.test.js` (6), plus the shared
fixture cases in `__truth__/p2.policy.truth.test.js` and `tests/test_p2_truth_policy.py`. The reference formula is written in
the test (open when the bar closed up else na, high, running-minimum low, close; GREEN / BLUE / RED): o/h/l/c per bar,
body/wick/border colours, na open -> whitespace, na wick colour -> transparent, per-bar na border, plotbar body colour only.
Red on base (`pine-dsk-mpbase3` at `f8ddebfa76`, files copied in inside the mp3 job): `Tests 14 failed | 2 passed (16)` (the 2
are controls that hold on both). Log `runs/w4t13b/redbase.log`. Tip: all 16 pass.

## Mutations (`mutate.py`, byte-exact restores; log `runs/w4t13b/mut.log`; baseline 230 tests green on the 4 files)
All 21 KILLED: M1 swap high/low columns in the pane (the spec mutation) and M2 in the binder (both red on "a candle is drawn
from the run"), M3 na colour -> series colour, M4/M5/M6 wick/border/body colour not handed to the series, M7 memo ignores a moved
column, M8 na open drawn, M9 opt-in ignored (object door), M10 unknown argument no longer refuses, M11 roles swapped, M12 bare na
colour disallowed, M13 wick colour never lowered, M14 unwritten colour not withheld, M15 show_last, M16 force_overlay, M17 v4,
M18 display.none candle drawn, M19 bar given a wick part, M20 `validateOhlc` not run, and the Python mirror (`_check_ohlc`
call dropped) killed by `test_P2_presentation_server_agrees_with_the_browser_case_by_case[W4-T13 candles without ohlc]`.
No equivalent survivors.

## measure-pair (base `pine-dsk-mpbase3` switched to `f8ddebfa76` inside the job; HEAD asserted with a timestamp before and after each side)
Logs `runs/w4t13b/mp3-rt0.log`, `mp3-rt1.log`, `mp3.out`. Sides: tip `eab79680d9`, base `f8ddebfa76`; no HEAD mismatch.
Runtime lane 0: C18 audit 395 keys diff 0 (timing field only), probes 69 diff 0; harness `336 MATCH 93 DIVERGE 103
INCONCLUSIVE 140` on both sides, 0 changed; census 967 rows, 5 differ:
- `reference:uptrick-volatility-adjusted-trail`: INTENDED, attaches on the runtime lane (the spec's expected attach).
- `committed:multi-timeframe-trend-indicator`, `committed:volatility-coil-edge-bullbyte`,
  `reference:halftrend-longshort-signal-engine-bigbeluga`, `reference:market-structure-with-inducements-sweeps-luxalgo`: NOISE
  (host translate time budget / drawing-op drop counts; none uses plotcandle or plotbar; the multi-timeframe timeout row also
  flipped in T12's evidence).
Runtime lane 1: C18 audit diff 0, probes diff 0; harness `336 MATCH 111 DIVERGE 107 INCONCLUSIVE 118` on both sides, 0 changed;
census 967 rows, 16 differ. All but one use plotcandle/plotbar and are INTENDED (the first wall moved past `runtime:presentation`):
- ATTACH: `uptrick-volatility-adjusted-trail` (false -> true; the only attach flip, as the spec expects).
- Spec movers: `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` (peel 5 -> 7, now `runtime:function`),
  `volatility-trend-score-backquant` (peel 3 -> 1, runtime plots 2 -> 4; not attached, host wall `pine:type`).
- Moved to a later wall, not attached: `advanced-custom-multi-ma-signals` (reaches runtime, 8 plots), `kernel-channel-backquant`,
  `kalman-trend-levels-bigbeluga`, `triangular-hull-moving-average-volatility-bigbeluga`, `volume-suite-by-leviathan`,
  `adaptive-trend-following-suite-alpha-extract`, `heikin-ashi-supertrend`, `trend-speed-analyzer-zeiierman`,
  `neural-network-buy-and-sell-signals` (now `runtime:statement`, a ring-depth wall behind the candle), builtins
  `cumulative-volume-delta` and `volume-delta` (detail only), `open-interest` (same `runtime:request` wall, peel 3 -> 2).
- NOISE: `multi-timeframe-trend-indicator` (translate time budget).
0 unintended diffs. Object-door changes: none (C18 audit and probes diff 0 on both lanes).

## final-tip
FINAL_TIP_PLACEHOLDER

## Engine bump
Yes: door outcomes change on the runtime lane (a refusal becomes a served candle row). `SCRIPT_ENGINE_VERSION` NOT edited here.

## Open items
- W4-P1 capture (`docs/pine/capture-queue-2026-11-04-w4-t13.md`): acceptance on o/h/l/c and colour against TradingView is NOT done
  here (no captures allowed). Until then, a colour the call did not write stays withheld by name.
- Scripts the host lane already accepts still draw a candle as four lines (master behaviour); routing them to the runtime lane
  for candles is a separate ruling.
- The pane's per-plot Style colour/width controls exist for a candle row but do nothing (the run owns its colours).
No licence-held text is included.
