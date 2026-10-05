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
import { warmBarsSupply } from './ourSide'

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
    'artemis-oscillator-pro-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_32 naBoth 1800/1800 painted=0'],
    'atr-stepped-pdf-ma-loxx-rddt-1d-2026-10-03.json': ['refused pine:block'],
    // plot_8 / plot_11 are the OBV bar colour (`obvOnOff and ta.obv > obvEMA ? … : na`).
    // ⚰️ RE-MEASURED at the H7 x wave-17 merge (2026-10-04): WAS `naBoth` (our condition
    // column absent). H6 serves `ta.obv` on the host lane and both runs read from the
    // listing (RDDT bar 0; SPY warm, listing=on), so the condition COMPUTES: both sides
    // draw nothing at the default (obvOnOff false) and the grade reads `agree`. Nothing
    // drawn changed. The same grade with the wave-17 tip's own engine files (so not H7/F7).
    'atr-support-and-resistance-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_0 agree 632/632 painted=25', 'plot_3 hiddenBoth', 'plot_8 agree 632/632 painted=0', 'plot_11 agree 632/632 painted=0'],
    'atr-support-and-resistance-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=73', 'plot_3 hiddenBoth', 'plot_8 agree 1800/1800 painted=0', 'plot_11 agree 1800/1800 painted=0'],
    'atr-trailing-stop-by-ceyhun-rddt-1d-2026-10-02.json': ['supply bar0 warmup=0', 'plot_5 agree 636/636 painted=636'],
    // ⭐ lane B1P's finding (2026-10-04): its 1088 differing bars were NULL paints — the
    // listing-only pass (`interpret.js` `listingPass`) never ran on a capture that is not
    // `startsAtBar0`. Replayed over the listing supplier with the supplier's own
    // `historyFromListing`, it agrees on every bar.
    'atr-trailing-stop-by-ceyhun-spy-1d-2026-10-02.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_5 agree 1800/1800 painted=1800'],
    'atr-trailing-stoploss-rddt-1d-2026-09-27.json': ['supply bar0 warmup=0', 'plot_0 agree 631/631 painted=631'],
    'atr-trailing-stoploss-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=1800'],
    // ⚠️ plot_14 / 16 / 17: the door carries the paint, but its condition column does
    // not compute (`computeFor` answers no column), so nothing is drawn. At the
    // script's defaults TradingView draws nothing there either (every bar `na`), so
    // the picture agrees; with the member's toggle ON it would not — counted, not hidden.
    'btc-charlie-trader-xo-macro-trend-scanner-rddt-1d-2026-09-30.json': ['supply bar0 warmup=0', 'plot_14 notDrawn', 'plot_15 agree 634/634 painted=0', 'plot_16 notDrawn', 'plot_17 notDrawn', 'plot_6 agree 634/634 painted=8', 'plot_7 agree 634/634 painted=9', 'plot_10 agree 634/634 painted=349', 'plot_11 agree 634/634 painted=244'],
    'btc-charlie-trader-xo-macro-trend-scanner-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_14 notDrawn', 'plot_15 agree 1800/1800 painted=0', 'plot_16 notDrawn', 'plot_17 notDrawn', 'plot_6 agree 1800/1800 painted=25', 'plot_7 agree 1800/1800 painted=24', 'plot_10 agree 1800/1800 painted=1286', 'plot_11 agree 1800/1800 painted=465'],
    'deadband-hysteresis-filter-backquant-rddt-1d-2026-10-03.json': ['refused pine:state'],
    'elliott-wave-3-finder-v2-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_2 agree 632/632 painted=65', 'plot_3 agree 632/632 painted=44'],
    'elliott-wave-3-finder-v2-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_2 agree 1800/1800 painted=140', 'plot_3 agree 1800/1800 painted=117'],
    'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_8 agree 632/632 painted=632', 'plot_9 agree 632/632 painted=0'],
    'ema-ribbon-trend-filter-strixedge-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_8 agree 1800/1800 painted=1800', 'plot_9 agree 1800/1800 painted=0'],
    'fibonacci-pivot-points-cc-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_2 agree 632/632 painted=632'],
    'fibonacci-pivot-points-cc-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_2 agree 1800/1800 painted=1800'],
    'fvg-trend-rddt-1d-2026-09-27.json': ['refused pine:state'],
    // its colour is a ternary CHOOSING between two `color.from_gradient`s; one gradient is
    // carried (C37), a choice between two is not — withheld by name, nothing drawn
    'heat-map-seasons-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_0 withheld'],
    'heat-map-seasons-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_0 withheld'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-09-28.json': ['refused pine:state'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-spy-1d-2026-10-03.json': ['refused pine:state'],
    'kalman-price-filter-backquant-rddt-1d-2026-10-03.json': ['refused pine:block'],
    'artemis-oscillator-pro-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_32 naBoth 632/632 painted=0'],
    'mcclellan-indicators-rddt-1d-2026-09-28.json': ['supply bar0 warmup=0', 'plot_4 naBoth 632/632 painted=0', 'plot_15 naBoth 632/632 painted=0'],
    'mcclellan-indicators-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_4 naBoth 1800/1800 painted=0', 'plot_15 naBoth 1800/1800 painted=0'],
    'renko-candles-overlay-rddt-1d-2026-10-03.json': ['refused pine:collection'],
    'renko-candles-overlay-spy-1d-2026-10-03.json': ['refused pine:collection'],
    'supertrend-strategy-rddt-1d-2026-10-02.json': ['supply bar0 warmup=0', 'plot_9 withheld'],
    'supertrend-strategy-spy-1d-2026-10-02.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 notReplayed', 'plot_9 withheld'],
    'trend-targets-algoalpha-rddt-1d-2026-10-02.json': ['refused pine:state'],
    'trend-targets-algoalpha-spy-1d-2026-10-02.json': ['refused pine:state'],
    'vw-bgcolor-barcolor-spy-1d-2026-10-02.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=975', 'plot_1 agree 1800/1800 painted=975', 'plot_4 agree 1800/1800 painted=1800', 'plot_2 agree 1800/1800 painted=975', 'plot_3 withheld', 'plot_5 agree 1800/1800 painted=1800', 'plot_6 agree 1800/1800 painted=975'],
    'vw-bgcolor-v4-default-spy-1d-2026-10-02.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_0 agree 1800/1800 painted=1800', 'plot_1 agree 1800/1800 painted=1800', 'plot_2 agree 1800/1800 painted=975'],
    'vw-deadband-ticks-aapl-1d-2026-09-28.json': ['refused pine:state'],
    'vw-deadband-ticks-brk-a-1d-2026-09-28.json': ['refused pine:state'],
    'vw-deadband-ticks-spy-1d-2026-09-28.json': ['refused pine:state'],
    'vw-rt6-runtime-colour-rddt-1d-2026-10-03.json': ['supply bar0 warmup=0', 'plot_13 agree 636/636 painted=308', 'plot_12 withheld'],
    'vw-rt6-runtime-colour-spy-1d-2026-10-03.json': ['supply warm vw-clock-close-tfchange-spy-1d-2026-09-28.json 6677 listing=on', 'plot_13 agree 1800/1800 painted=975', 'plot_12 withheld'],
    'wyckoff-accumulation-distribution-rddt-1d-2026-10-02.json': ['refused pine:state'],
    'wyckoff-accumulation-distribution-spy-1d-2026-10-02.json': ['refused pine:state'],
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
    // measured cold: 35 bars differ, every one inside the warm-up — counted apart,
    // never as agreeing, and never in the graded count. ⚰️ RE-MEASURED at the H7 x
    // wave-17 merge: WAS 15. The same 35 with the wave-17 tip's own engine files, so the
    // move is wave 17's (not H7 / F7); the graded bars still all agree.
    expect(row.warmup).toEqual({ bars: PAINT_WARMUP_FLOOR, compared: PAINT_WARMUP_FLOOR, differ: 35 })
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
