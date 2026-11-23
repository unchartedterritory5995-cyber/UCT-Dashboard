// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b1Paints.test.js
//
// ─── B1 — `bgcolor` / `barcolor` against TradingView's own record ──────────────
//
// Every committed capture whose script calls `bgcolor(…)` or `barcolor(…)` records
// each call as a plot (`bg_colorer` / `bar_colorer`) with the bar's colour per row.
// This rail grades the member door's paints against those rows, bar for bar
// (`paintColours.js`), and pins the outcome per capture — so a change that moves a
// single bar's shading, or that starts drawing a paint the door withholds, goes red.
//
// ⛔ WHAT IS WITNESSED HERE, AND WHAT IS NOT. Witnessed: which colour each bar takes
// (static, two-colour, chain, `na`-gated, palette-less, `display.none`, `transp`).
// NOT witnessed by any capture: where the shading is DRAWN (TradingView's pixels are
// not in a capture) — that is Pine's documented placement (the script's pane;
// `barcolor` on the chart's own bars), built by construction and railed in
// `paintRender.test.js`; and `offset` / `show_last` / a v3-v4 `bgcolor` with no
// `transp`, which the door withholds by name (probe: vw-bgcolor-barcolor.pine).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'
import { gradePaints, vendorPaints, paintWarmupOf, PAINT_WARMUP_FLOOR } from './paintColours'
import { warmBarsSupply, compareWarmSuppliers } from './ourSide'

const DIR = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness')

const captures = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ f, loaded: loadCapture(path.join(DIR, f)) }))
  .filter(({ loaded }) => loaded.capture && vendorPaints(loaded.capture).length > 0)

const gradeOf = (() => {
  const memo = new Map()
  return (f) => {
    if (!memo.has(f)) {
      const { capture } = captures.find((c) => c.f === f).loaded
      memo.set(f, gradePaints(capture, runOurSide(capture)))
    }
    return memo.get(f)
  }
})()

const summary = (g) => g.rows.map((r) => `${r.id} ${r.kind} ${r.state}${r.compared !== undefined ? ` ${r.compared - r.differ}/${r.compared}` : ''}`)

describe('B1 — paints graded against the captures that record them', () => {
  it('NON-VACUITY — the committed captures record paints, of both kinds', () => {
    const all = captures.flatMap(({ loaded }) => vendorPaints(loaded.capture))
    expect(captures.length).toBeGreaterThanOrEqual(10)
    expect(all.some((p) => p.kind === 'bgcolor')).toBe(true)
    expect(all.some((p) => p.kind === 'barcolor')).toBe(true)
  })

  // ⭐ THE PINNED GRADE, per capture: first which bars the paints were replayed over
  // (`supply warm <file> <bars> listing=on|off`, `supply bar0`, or `supply cold
  // warmup=<W>`), then `id state agreeing/compared painted=N`, where N is the bars
  // TradingView shaded or recoloured. A cold replay's first W bars are graded apart as
  // `warmup=<differ>/<compared>` and never counted as agreeing. `naBoth` / `hiddenBoth` /
  // `withheld` / `notDrawn` / `refused` are described in `paintColours.js`.
  const PINNED = {
    // ⭐ RC1 — every SPY 1D capture here starts mid-history (2019-08-06), so TradingView
    // computed it WARM. Its paints are replayed over SPY's own proved history from the
    // deepest committed listing capture (`supply warm <file> <bars> listing=on`), sliced
    // to the window. `notReplayed` = a proved supplier exists but the door draws no
    // paint to replay (folded to `na` or withheld), so there was nothing to warm.
    'artemis-oscillator-pro-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_32 naBoth 1800/1800 painted=0'],
    'atr-stepped-pdf-ma-loxx-rddt-1d-2026-10-03.json': ['refused pine:block'],
    // plot_8 / plot_11 are the OBV bar colour (`obvOnOff and ta.obv > obvEMA ? … : na`).
    // ⭐ W1 (2026-11-02): `ta.obv` is served on a pane (its published `cum` body), so the
    // door CARRIES these paints instead of folding them to `na`, and at the default
    // (obvOnOff false) they paint no bar, as TradingView paints none (`agree`, painted=0;
    // `naBoth` before W1).
    'atr-support-and-resistance-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_0 agree 632/632 painted=25', 'plot_3 hiddenBoth', 'plot_8 agree 632/632 painted=0', 'plot_11 agree 632/632 painted=0'],
    'atr-support-and-resistance-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=73', 'plot_3 hiddenBoth', 'plot_8 agree 1800/1800 painted=0', 'plot_11 agree 1800/1800 painted=0'],
    'atr-trailing-stop-by-ceyhun-rddt-1d-2026-10-02.json': ['supply bar0 warmup=0', 'plot_5 agree 636/636 painted=636'],
    // ⭐ lane B1P's finding (2026-10-04): its 1088 differing bars were NULL paints — the
    // listing-only pass (`interpret.js` `listingPass`) never ran on a capture that is not
    // `startsAtBar0`. Replayed over the listing supplier with the supplier's own
    // `historyFromListing`, it agrees on every bar.
    'atr-trailing-stop-by-ceyhun-spy-1d-2026-10-02.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_5 agree 1800/1800 painted=1800'],
    'atr-trailing-stoploss-rddt-1d-2026-09-27.json': ['supply bar0 warmup=0', 'plot_0 agree 631/631 painted=631'],
    'atr-trailing-stoploss-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=1800'],
    // ⚠️ plot_14 / 16 / 17: the door carries the paint, but its condition column does
    // not compute (`computeFor` answers no column), so nothing is drawn. At the
    // script's defaults TradingView draws nothing there either (every bar `na`), so
    // the picture agrees; with the member's toggle ON it would not — counted, not hidden.
    // ⭐ plot_15 (line 122): `maTypeChoice` is a LIVE dropdown knob now (`pine.js::
    // enumCompare`), so its colour no longer folds to `na` at the default — the paint
    // is carried, and on these bars its condition never holds, so it draws no bar.
    // TradingView paints none (painted=0 before): the same nothing, now `notDrawn`.
    'btc-charlie-trader-xo-macro-trend-scanner-rddt-1d-2026-09-30.json': ['supply bar0 warmup=0', 'plot_14 notDrawn', 'plot_15 notDrawn', 'plot_16 notDrawn', 'plot_17 notDrawn', 'plot_6 agree 634/634 painted=8', 'plot_7 agree 634/634 painted=9', 'plot_10 agree 634/634 painted=349', 'plot_11 agree 634/634 painted=244'],
    'btc-charlie-trader-xo-macro-trend-scanner-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_14 notDrawn', 'plot_15 notDrawn', 'plot_16 notDrawn', 'plot_17 notDrawn', 'plot_6 agree 1800/1800 painted=25', 'plot_7 agree 1800/1800 painted=24', 'plot_10 agree 1800/1800 painted=1286', 'plot_11 agree 1800/1800 painted=465'],
    'deadband-hysteresis-filter-backquant-rddt-1d-2026-10-03.json': ['refused pine:state'],
    'elliott-wave-3-finder-v2-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_2 agree 632/632 painted=65', 'plot_3 agree 632/632 painted=44'],
    'elliott-wave-3-finder-v2-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_2 agree 1800/1800 painted=140', 'plot_3 agree 1800/1800 painted=117'],
    'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_8 agree 632/632 painted=632', 'plot_9 agree 632/632 painted=0'],
    'ema-ribbon-trend-filter-strixedge-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_8 agree 1800/1800 painted=1800', 'plot_9 agree 1800/1800 painted=0'],
    'fibonacci-pivot-points-cc-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_2 agree 632/632 painted=632'],
    'fibonacci-pivot-points-cc-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_2 agree 1800/1800 painted=1800'],
    'fvg-trend-rddt-1d-2026-09-27.json': ['refused pine:state'],
    // its colour is a ternary CHOOSING between two `color.from_gradient`s; one gradient is
    // carried (C37), a choice between two is not — withheld by name, nothing drawn
    'heat-map-seasons-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_0 withheld'],
    'heat-map-seasons-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_0 withheld'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-09-28.json': ['refused pine:state'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-spy-1d-2026-10-03.json': ['refused pine:state'],
    'kalman-price-filter-backquant-rddt-1d-2026-10-03.json': ['refused pine:block'],
    'artemis-oscillator-pro-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_32 naBoth 632/632 painted=0'],
    'mcclellan-indicators-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_4 naBoth 632/632 painted=0', 'plot_15 naBoth 632/632 painted=0'],
    'mcclellan-indicators-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_4 naBoth 1800/1800 painted=0', 'plot_15 naBoth 1800/1800 painted=0'],
    'renko-candles-overlay-rddt-1d-2026-10-03.json': ['refused pine:collection'],
    'renko-candles-overlay-spy-1d-2026-10-03.json': ['refused pine:collection'],
    'renko-candles-overlay-crwv-1d-2026-11-16.json': ['refused pine:collection'],
    'supertrend-strategy-alab-1d-2026-11-17.json': ['supply bar0 warmup=0', 'plot_9 withheld'],
    // 2026-11-20 (PR #2146's rig run, Q-SU-7 / Q-SU-8): each chart scrolled back to its listing
    'supertrend-strategy-deep-aapl-1d-2026-11-19.json': ['supply bar0 warmup=0', 'plot_9 withheld'],
    'supertrend-strategy-deep-spy-1d-2026-11-19.json': ['supply bar0 warmup=0', 'plot_9 withheld'],
    'supertrend-strategy-rddt-1d-2026-10-02.json': ['supply bar0 warmup=0', 'plot_9 withheld'],
    'supertrend-strategy-rddt-1d-2026-11-17.json': ['supply bar0 warmup=0', 'plot_9 withheld'],
    'supertrend-strategy-is-rddt-1d-2026-11-18.json': ['supply bar0 warmup=0', 'plot_9 withheld'],
    'supertrend-strategy-spy-1d-2026-10-02.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_9 withheld'],
    'trend-targets-algoalpha-rddt-1d-2026-10-02.json': ['refused pine:state'],
    'trend-targets-algoalpha-spy-1d-2026-10-02.json': ['refused pine:state'],
    'vw-bgcolor-barcolor-spy-1d-2026-10-02.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=975', 'plot_1 agree 1800/1800 painted=975', 'plot_4 agree 1800/1800 painted=1800', 'plot_2 agree 1800/1800 painted=975', 'plot_3 withheld', 'plot_5 agree 1800/1800 painted=1800', 'plot_6 agree 1800/1800 painted=975'],
    'vw-bgcolor-v4-default-spy-1d-2026-10-02.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=1800', 'plot_1 agree 1800/1800 painted=1800', 'plot_2 agree 1800/1800 painted=975'],
    'vw-deadband-ticks-aapl-1d-2026-09-28.json': ['refused pine:state'],
    'vw-deadband-ticks-brk-a-1d-2026-09-28.json': ['refused pine:state'],
    'vw-deadband-ticks-spy-1d-2026-09-28.json': ['refused pine:state'],
    'vw-rt6-runtime-colour-rddt-1d-2026-10-03.json': ['supply bar0 warmup=0', 'plot_13 agree 636/636 painted=308', 'plot_12 withheld'],
    'vw-rt6-runtime-colour-spy-1d-2026-10-03.json': ['supply warm vw-object-gc-b-spy-1d-2026-09-28.json 6677 listing=on', 'plot_13 agree 1800/1800 painted=975', 'plot_12 withheld'],
    'wyckoff-accumulation-distribution-rddt-1d-2026-10-02.json': ['refused pine:state'],
    'wyckoff-accumulation-distribution-spy-1d-2026-10-02.json': ['refused pine:state'],
    // 2026-11-15 (S12, coordinator-authorised): the paints of every capture added by the S9-S12 capture
    // sessions, pinned as the grader reads them from each fixture (generated, not hand-written).
    'advanced-custom-multi-ma-signals-emasmavwmavwap-rddt-1d-2026-11-15.json': ['refused pine:request'],   // COND-TA (engine 58): its guards over named-argument inputs read as constant now, so the door reaches its request refusal
    'advanced-custom-multi-ma-signals-emasmavwmavwap-spy-1d-2026-11-15.json': ['refused pine:request'],
    'atr-god-strategy-by-tradesmart-rddt-1d-2026-11-15.json': ['refused pine:block'],
    'atr-god-strategy-by-tradesmart-spy-1d-2026-11-15.json': ['refused pine:block'],
    // U15 (2026-11-15): these five import a version on the deny list (fontilab/11,
    // loxxexpandedsourcetypes/4). With the registry empty the door named them `pine:module`;
    // it now names the deny list, which answers before the store is asked. Nothing was drawn
    // before and nothing is drawn now.
    'atr-trend-bands-misu-rddt-1d-2026-11-15.json': ['refused pine:library-denied'],
    'bolingger-bands-inside-bar-boxes-rddt-1d-2026-11-14.json': ['refused pine:reassign'],
    'bollinger-band-width-percentile-rddt-1d-2026-11-14.json': ['refused pine:collection'],
    'camarilla-rddt-1d-2026-11-14.json': ['refused pine:window'],
    'camarilla-spy-1d-2026-11-14.json': ['refused pine:window'],
    'cvd-cumulative-volume-delta-candles-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'cvd-cumulative-volume-delta-candles-spy-1d-2026-11-15.json': ['refused pine:module'],
    'cvd-cumulative-volume-delta-chart-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'cvd-cumulative-volume-delta-chart-spy-1d-2026-11-15.json': ['refused pine:module'],
    'delta-imbalance-map-joat-rddt-1d-2026-11-15.json': ['refused pine:reassign'],
    'delta-imbalance-map-joat-spy-1d-2026-11-15.json': ['refused pine:reassign'],
    'delta-volume-candles-lucf-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'delta-volume-candles-lucf-spy-1d-2026-11-15.json': ['refused pine:module'],
    'deviation-scaled-moving-average-w-dsl-loxx-rddt-1d-2026-11-15.json': ['refused pine:library-denied'],
    'deviation-scaled-moving-average-w-dsl-loxx-spy-1d-2026-11-15.json': ['refused pine:library-denied'],
    'ema-92150-vwap-macd-rsi-pro-v6-rddt-1d-2026-11-14.json': ['refused pine:state'],
    'fx-market-sessions-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor-rddt-1d-2026-11-14.json': ['refused pine:cycle'],
    'ict-institutional-order-flow-fadi-rddt-1d-2026-11-14.json': ['refused pine:objects-only'],
    'ict-killzone-index-version-rddt-1d-2026-11-14.json': ['refused pine:objects-only'],   // bt (Engine 66 (#1473)): its session translates now, so the door reaches the objects-only refusal
    'inside-bar-boxes-rddt-1d-2026-11-14.json': ['refused pine:reassign'],
    'kalman-psar-backquant-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'kernel-channel-backquant-rddt-1d-2026-11-14.json': ['refused pine:block'],
    'liquidity-engulfing-displacement-msf-rddt-1d-2026-11-15.json': ['refused pine:builtin'],
    'liquidity-engulfing-displacement-msf-spy-1d-2026-11-15.json': ['refused pine:builtin'],
    'machine-learning-lorentzian-classification-21f5ec-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'machine-learning-lorentzian-classification-5c7960-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'machine-learning-moving-average-backquant-rddt-1d-2026-11-14.json': ['refused pine:reassign'],
    'machine-learning-rsi-bullvision-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'multi-timeframe-trend-indicator-rddt-1d-2026-11-14.json': ['refused pine:request'],
    'multi-timeframe-trend-indicator-spy-1d-2026-11-14.json': ['refused pine:request'],
    'nonlinear-regression-zero-lag-moving-average-loxx-rddt-1d-2026-11-14.json': ['refused pine:block'],
    'one-sided-gaussian-support-resistance-rate-loxx-rddt-1d-2026-11-14.json': ['refused pine:block'],
    'open-interest-suite-aggregated-by-leviathan-rddt-1d-2026-11-15.json': ['refused pine:request'],
    'open-interest-suite-aggregated-by-leviathan-spy-1d-2026-11-15.json': ['refused pine:request'],
    'rate-of-change-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'rate-of-change-spy-1d-2026-11-15.json': ['refused pine:module'],
    'relative-volume-at-time-rddt-1d-2026-11-14.json': ['refused pine:text-value'],
    'relative-volume-at-time-spy-1d-2026-11-14.json': ['refused pine:text-value'],
    'session-hilo-rddt-1d-2026-11-14.json': ['supply bar0 warmup=0', 'plot_5 agree 666/666 painted=0'],
    // bt (Engine 66 (#1473)): its wrapping sessions translate now; every paint agrees with TradingView
    'sessions-rddt-1d-2026-11-14.json': ['supply bar0 warmup=0', 'plot_3 agree 666/666 painted=666', 'plot_7 agree 666/666 painted=666', 'plot_11 agree 666/666 painted=0', 'plot_15 naBoth 666/666 painted=0'],
    'smart-money-breakouts-chartprime-rddt-1d-2026-11-14.json': ['refused pine:reassign'],
    'smart-money-interest-index-algoalpha-rddt-1d-2026-11-14.json': ['supply bar0 warmup=0', 'plot_10 agree 666/666 painted=0'],
    'smoothed-gaussian-trend-filter-algoalpha-rddt-1d-2026-11-15.json': ['refused pine:state'],
    'smoothed-gaussian-trend-filter-algoalpha-spy-1d-2026-11-15.json': ['refused pine:state'],
    'smt-divergence-ict-killzones-rddt-1d-2026-11-15.json': ['refused pine:reassign'],
    'smt-divergence-ict-killzones-spy-1d-2026-11-15.json': ['refused pine:reassign'],
    'std-filtered-adaptive-exponential-hull-moving-average-loxx-rddt-1d-2026-11-15.json': ['refused pine:library-denied'],
    'std-filtered-adaptive-exponential-hull-moving-average-loxx-spy-1d-2026-11-15.json': ['refused pine:library-denied'],
    'supertrend-relative-volume-kernel-optimized-flux-charts-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'trailing-take-profit-trailing-stop-loss-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'visualizing-displacement-tfo-rddt-1d-2026-11-14.json': ['refused member door refused: this script declares nothing a chart can draw'],
    'volatility-coil-edge-bullbyte-rddt-1d-2026-11-14.json': ['refused pine:reassign'],
    'volatility-stop-mtf-rddt-1d-2026-11-15.json': ['refused pine:module'],
    'volatility-stop-mtf-spy-1d-2026-11-15.json': ['refused pine:module'],
    'volatility-trend-score-backquant-rddt-1d-2026-11-14.json': ['refused pine:type'],
    'volume-delta-hapharmonic-rddt-1d-2026-11-14.json': ['refused pine:type'],
    'volume-profile-auto-line-v2-rddt-1d-2026-11-14.json': ['refused pine:no-output'],
    'volume-spikes-growing-volume-signals-with-alerts-scanner-rddt-1d-2026-11-14.json': ['refused member door refused (budget:lookback): this script is not drawn: its plot `Volume Up Spike Marker` needs 1000 bars of history behind every bar, and one plot may reach back at most 960 here'],
    'volume-spikes-growing-volume-signals-with-alerts-scanner-spy-1d-2026-11-14.json': ['refused member door refused (budget:lookback): this script is not drawn: its plot `Volume Up Spike Marker` needs 1000 bars of history behind every bar, and one plot may reach back at most 960 here'],
    // ⭐⭐ e95 unit 2 (2026-11-22): its `[_, u, l] = ta.vwap(src, anchor, mult)` is Pine's anchored VWAP, which both lanes
    // carry now (was `pine:tuple`); the script translates, and its paint is withheld by name, never drawn unpinned
    'volume-suite-by-leviathan-rddt-1d-2026-11-15.json': ['supply bar0 warmup=0', 'plot_28 withheld'],
    'volume-suite-by-leviathan-spy-1d-2026-11-15.json': ['supply bar0 warmup=0', 'plot_28 withheld'],
    // ⭐ ENGINE 58 COLOURS (landing train 1): a v1-v3 `bgcolor` with no `transp` draws at 90 (S1), so the three
    // transparency probes' paint is drawn and agrees on all 666 bars (was withheld).
    'vw-cs1-transp-v1-rddt-1d-2026-11-14.json': ['supply bar0 warmup=0', 'plot_2 agree 666/666 painted=666'],
    'vw-cs1-transp-v2-rddt-1d-2026-11-14.json': ['supply bar0 warmup=0', 'plot_2 agree 666/666 painted=666'],
    'vw-cs1-transp-v3-rddt-1d-2026-11-14.json': ['supply bar0 warmup=0', 'plot_2 agree 666/666 painted=666'],
    // 2026-11-15 (S13-S20): the paints of the captures this PR adds, generated by the rail's own code.
    'artemis-oscillator-pro-rddt-1d-2026-11-15.json': ['supply bar0 warmup=0', 'plot_32 naBoth 666/666 painted=0'],
    'artemis-oscillator-pro-spy-1d-2026-11-15.json': ['supply bar0 warmup=0', 'plot_32 naBoth 8507/8507 painted=0'],
    'mid_engagement__20-mann-kendall-trend-significance-rddt-1d-2026-11-15.json': ['refused pine:reassign'],
    'mid_engagement__20-mann-kendall-trend-significance-spy-1d-2026-11-15.json': ['refused pine:reassign'],
    'vw-deadband-ticks-brk-a-1d-2026-11-15.json': ['refused pine:state'],
    // S28 x re-captures (#1373): the same four scripts as their 2026-09-28 / 10-02 / 10-03 pins above
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-11-15.json': ['refused pine:state'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-spy-1d-2026-11-15.json': ['refused pine:state'],
    'trend-targets-algoalpha-rddt-1d-2026-11-15.json': ['refused pine:state'],
    'trend-targets-algoalpha-spy-1d-2026-11-15.json': ['refused pine:state'],
    // 2026-11-17 (the e73 filing): the paints of the captures that PR adds, generated by the rail's own code.
    'bolingger-bands-inside-bar-boxes-rddt-1d-2026-11-17.json': ['refused pine:reassign'],
    'bolingger-bands-inside-bar-boxes-spy-1d-2026-11-17.json': ['refused pine:reassign'],
    'ema-92150-vwap-macd-rsi-pro-v6-rddt-1d-2026-11-17.json': ['refused pine:state'],
    'ema-92150-vwap-macd-rsi-pro-v6-spy-1d-2026-11-17.json': ['refused pine:state'],
    'fvg-trend-rddt-1d-2026-11-17.json': ['refused pine:state'],
    'fvg-trend-spy-1d-2026-11-17.json': ['refused pine:state'],
    'heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor-rddt-1d-2026-11-17.json': ['refused pine:cycle'],
    'heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor-spy-1d-2026-11-17.json': ['refused pine:cycle'],
    'inside-bar-boxes-rddt-1d-2026-11-17.json': ['refused pine:reassign'],
    'inside-bar-boxes-spy-1d-2026-11-17.json': ['refused pine:reassign'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-11-17.json': ['refused pine:state'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-spy-1d-2026-11-17.json': ['refused pine:state'],
    'machine-learning-moving-average-backquant-rddt-1d-2026-11-17.json': ['refused pine:reassign'],
    'machine-learning-moving-average-backquant-spy-1d-2026-11-17.json': ['refused pine:reassign'],
    'one-sided-gaussian-support-resistance-rate-loxx-rddt-1d-2026-11-17.json': ['refused pine:block'],
    'one-sided-gaussian-support-resistance-rate-loxx-spy-1d-2026-11-17.json': ['refused pine:block'],
    'trend-targets-algoalpha-rddt-1d-2026-11-17.json': ['refused pine:state'],
    'trend-targets-algoalpha-spy-1d-2026-11-17.json': ['refused pine:state'],
    'volatility-coil-edge-bullbyte-rddt-1d-2026-11-17.json': ['refused pine:reassign'],
    'volatility-coil-edge-bullbyte-spy-1d-2026-11-17.json': ['refused pine:reassign'],
  }
  const supplyLine = (s) => (s.kind === 'warm'
    ? (s.replayed ? `supply warm ${s.file} ${s.bars} listing=${s.historyFromListing ? 'on' : 'off'}`
      : `supply warm ${s.file} ${s.bars} notReplayed`)
    : `supply ${s.kind} warmup=${s.warmupBars}`)
  const lines = (g) => {
    if (g.refused) return [`refused ${(/\((pine:[^)]+)\)/.exec(g.refused) || [])[1] || g.refused}`]
    return [supplyLine(g.supply), ...g.rows.map((r) => (r.compared === undefined ? `${r.id} ${r.state}`
      : `${r.id} ${r.state} ${r.compared - r.differ}/${r.compared} painted=${r.vendorPainted}`
        + (r.warmup ? ` warmup=${r.warmup.differ}/${r.warmup.compared}` : '')))]
  }

  it('every capture that records a paint is pinned — none added or dropped silently', () => {
    expect(captures.map((c) => c.f).sort()).toEqual(Object.keys(PINNED).sort())
  })

  it.each(Object.keys(PINNED))('%s grades as pinned', (f) => {
    const g = gradeOf(f)
    expect(g.unpaired).toEqual([])
    expect(lines(g)).toEqual(PINNED[f])
  }, 120000)

  it('⛔ NO paint this door draws differs from TradingView on any bar', () => {
    // ⭐ RC1 — graded over EVERY capture that records a paint, read from the directory,
    // never over the pin list: a capture added without a pin must not be able to differ
    // unseen. (⚰️ This iterated `Object.keys(PINNED)`, so the six SPY captures and
    // ceyhun differed on 1,197 bars while this read green.)
    const graded = captures.map((c) => c.f)
    expect(graded.length).toBe(captures.length)
    const differing = graded.flatMap((f) => gradeOf(f).rows
      .filter((r) => r.state === 'differ' || r.state === 'naDiffers' || r.state === 'titleMismatch')
      .map((r) => `${f} ${r.id}`))
    expect(differing).toEqual([])
    // non-vacuity: bars TradingView actually painted were compared and agreed
    const painted = graded.flatMap((f) => gradeOf(f).rows)
      .filter((r) => r.state === 'agree').reduce((n, r) => n + r.vendorPainted, 0)
    expect(painted).toBeGreaterThan(2000)
  }, 900000)

  it('⭐ what the BINDER hands the chart is the graded colour (backgrounds and candle overrides)', () => {
    // a bgcolor: the background primitive is fed exactly the graded per-bar colours
    {
      const { capture } = captures.find((c) => c.f === 'elliott-wave-3-finder-v2-rddt-1d-2026-09-28.json').loaded
      const ours = runOurSide(capture)
      expect(ours.drawnPaints.backgrounds).toHaveLength(2)
      ours.drawnPaints.backgrounds.forEach((b, i) => expect(b.colors).toEqual(ours.paints[i].colors))
    }
    // a barcolor: the overrides handed to the host are the graded colours, by bar time
    {
      const { capture } = captures.find((c) => c.f === 'fibonacci-pivot-points-cc-rddt-1d-2026-09-28.json').loaded
      const ours = runOurSide(capture)
      const map = ours.drawnPaints.barColours
      expect(map && map.size).toBe(ours.bars.length)
      ours.bars.forEach((b, i) => expect(map.get(String(b.t))).toBe(ours.paints[0].colors[i]))
    }
  }, 120000)

  if (process.env.B1_PRINT === '1') {
    it('prints every capture\'s grade', () => {
      for (const { f } of captures) {
        const g = gradeOf(f)
        console.log(f, JSON.stringify({ refused: g.refused || null, unpaired: g.unpaired, supply: g.supply || null, rows: g.rows }, null, 0))
      }
    }, 600000)
  }
})

// ─── ⭐⭐ RC1 — the warm-bars supply and the warm-up it replaces ───────────────
describe('RC1 — paints replayed over the same series\' proved history', () => {
  const load = (f) => captures.find((c) => c.f === f).loaded.capture
  const STOPLOSS = 'atr-trailing-stoploss-spy-1d-2026-10-03.json'
  const CEYHUN = 'atr-trailing-stop-by-ceyhun-spy-1d-2026-10-02.json'
  // one window bar's volume moved by one share: the window is no longer provably the
  // supplier's series, so every supplier must be REFUSED by name
  const withVolumeOff = (cap, at) => ({
    ...cap,
    bars: { ...cap.bars, rows: cap.bars.rows.map((r, i) => (i === at ? [r[0], r[1], r[2], r[3], r[4], r[5] + 1] : r)) },
  })

  it('a SPY capture that does not start at the listing is replayed WARM, from a listing capture', () => {
    const s = warmBarsSupply(load(STOPLOSS))
    expect(s.kind).toBe('warm')
    expect(s.bars).toBeGreaterThan(6000)
    expect(s.historyFromListing).toBe(true)
    // a committed capture whose own newest bar was still forming when it was taken
    // disagrees on that bar, and is refused by name, never spliced
    for (const r of s.refused) expect(r).toMatch(/: bar \d+ (open|high|low|close|volume) [\d.]+ vs the capture's [\d.]+$/)
    expect(s.reason).toMatch(/every overlapping window bar equal on time\/open\/high\/low\/close\/volume/)
  })

  it('⛔ a tie between equally deep suppliers never goes to a later or unstamped capture', () => {
    const rows = new Array(10).fill(0)
    const s = (file, capturedAt) => ({ file, rows, capturedAt })
    const pick = (...c) => c.slice().sort(compareWarmSuppliers)[0].file
    const earliest = s('vw-object-gc-b-spy-1d-2026-09-28.json', '2026-09-29T01:00:00.000Z')
    // a later capture whose name sorts first does not take over (#1296 / #1307)
    expect(pick(s('3-level-zigzag-semafor-spy-1d-2026-11-14.json', '2026-11-15T03:00:00.000Z'), earliest)).toBe(earliest.file)
    // an UNSTAMPED one (missing or empty) sorts after every stamped one, whatever its name
    expect(pick(s('0-unstamped-spy-1d.json', undefined), earliest)).toBe(earliest.file)
    expect(pick(earliest, s('0-unstamped-spy-1d.json', ''))).toBe(earliest.file)
    // depth still wins first; between two unstamped, the name decides
    expect(pick(s('z-deeper.json', ''), { ...earliest, rows: rows.slice(1) })).toBe('z-deeper.json')
    expect(pick(s('b-un.json', ''), s('a-un.json', undefined))).toBe('a-un.json')
    // and the committed SPY 1D supplier is the earliest stamped one
    expect(warmBarsSupply(load(STOPLOSS)).file).toBe('vw-object-gc-b-spy-1d-2026-09-28.json')
  }, 120000)

  it('a capture that starts at the listing is never warmed (bar0)', () => {
    const s = warmBarsSupply(load('atr-trailing-stoploss-rddt-1d-2026-09-27.json'))
    expect(s.kind).toBe('bar0')
    expect(s.rows).toBe(null)
  })

  it('⛔ the OHLCV gate: one bar\'s volume off by one share REFUSES every supplier, by name', () => {
    const s = warmBarsSupply(withVolumeOff(load(STOPLOSS), 5))
    expect(s.kind).toBe('cold')
    expect(s.rows).toBe(null)
    expect(s.refused.length).toBeGreaterThanOrEqual(2)
    for (const r of s.refused) expect(r).toMatch(/: bar \d+ volume \d+ vs the capture's \d+$/)
    expect(s.reason).toMatch(/every candidate supplier was refused, cold replay/)
  })

  it('⛔ a refused supplier falls back to a COLD replay labelled as such, warm-up graded apart', () => {
    const cap = withVolumeOff(load(STOPLOSS), 5)
    const ours = runOurSide(cap)
    expect(ours.paintSupply.kind).toBe('cold')
    // never forced onto a short capture: the listing flag stays the capture's own
    expect(ours.paintSupply.historyFromListing).toBe(false)
    const g = gradePaints(cap, ours)
    expect(g.supply.warmupBars).toBe(PAINT_WARMUP_FLOOR)
    const row = g.rows.find((r) => r.id === 'plot_0')
    // measured cold: 30 bars differ, every one inside the warm-up — counted apart,
    // never as agreeing, and never in the graded count.
    // ⭐ 2026-11-09 — it was 15: the first 15 bars were DRAWN from the loaded count
    // `cum_1 < 16` (TradingView's count is past 16 there) and differed; now that guard
    // is a running-total threshold, withheld by name on its first 15 bars plus the
    // 15 its 15-bar reach carries (`running-total:early-bars`), so 30 are blank.
    expect(row.warmup).toEqual({ bars: PAINT_WARMUP_FLOOR, compared: PAINT_WARMUP_FLOOR, differ: 30 })
    expect(row.compared).toBe(cap.bars.rows.length - PAINT_WARMUP_FLOOR)
    expect(row.state).toBe('agree')
  }, 120000)

  it('the warm replay is SLICED to the window: one colour per window bar, overrides keyed by window bars', () => {
    const cap = load(STOPLOSS)
    const ours = runOurSide(cap)
    expect(ours.paintSupply.replayed).toBe(true)
    expect(ours.bars).toHaveLength(cap.bars.rows.length)
    for (const p of ours.paints) expect(p.colors).toHaveLength(cap.bars.rows.length)
    const keys = [...ours.drawnPaints.barColours.keys()]
    expect(keys).toEqual(ours.bars.map((b) => String(b.t)))
    ours.bars.forEach((b, i) => expect(ours.drawnPaints.barColours.get(String(b.t))).toBe(ours.paints[0].colors[i]))
  }, 120000)

  it('⭐ the listing flag is INHERITED from the supplier (ceyhun-spy, lane B1P)', () => {
    const ours = runOurSide(load(CEYHUN))
    expect(ours.paintSupply.historyFromListing).toBe(true)
    // the capture's own flag is untouched: only the replay over the listing series carries it
    expect(ours.ctx.historyFromListing).toBe(false)
    const g = gradeOf(CEYHUN)
    expect(g.rows.map((r) => `${r.id} ${r.state} ${r.compared - r.differ}/${r.compared}`)).toEqual(['plot_5 agree 1800/1800'])
  }, 120000)

  it('the warm-up region: a declared `warmup.bars` wins, else the floor; nothing for warm or bar0', () => {
    expect(paintWarmupOf({ history: { startsAtBar0: false } }, { kind: 'cold' })).toBe(PAINT_WARMUP_FLOOR)
    expect(paintWarmupOf({ history: { startsAtBar0: false }, warmup: { bars: 50 } }, { kind: 'cold' })).toBe(50)
    expect(paintWarmupOf({ history: { startsAtBar0: false } }, { kind: 'warm' })).toBe(0)
    expect(paintWarmupOf({ history: { startsAtBar0: true } }, null)).toBe(0)
    expect(PAINT_WARMUP_FLOOR).toBeGreaterThanOrEqual(200)
  })
})
