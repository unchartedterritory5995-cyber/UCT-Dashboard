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
import { gradePaints, vendorPaints } from './paintColours'

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

  // ⭐ THE PINNED GRADE, per capture: `id state agreeing/compared painted=N`, where N is
  // the bars TradingView shaded or recoloured. `naBoth` / `hiddenBoth` / `withheld` /
  // `notDrawn` / `refused` are described in `paintColours.js`.
  const PINNED = {
    'artemis-oscillator-pro-rddt-1d-2026-09-28.json': ['plot_32 naBoth 632/632 painted=0'],
    // ⭐ H6 (step 90) re-pinned: plot_8 / plot_11 are the OBV bar colour
    // (`obvOnOff and ta.obv > obvEMA ? … : na`). `ta.obv` is now served on the host lane
    // and RDDT starts at the listing, so the paint's condition COMPUTES: both sides draw
    // nothing at the default (obvOnOff false) and the grade reads `agree`, where it read
    // `naBoth` (our condition column was absent). Nothing drawn changed.
    'atr-support-and-resistance-rddt-1d-2026-09-28.json': [
      'plot_0 agree 632/632 painted=25', 'plot_3 hiddenBoth', 'plot_8 agree 632/632 painted=0', 'plot_11 agree 632/632 painted=0'],
    'atr-trailing-stoploss-rddt-1d-2026-09-27.json': ['plot_0 agree 631/631 painted=631'],
    // ⚠️ plot_14 / 16 / 17: the door carries the paint, but its condition column does
    // not compute (`computeFor` answers no column), so nothing is drawn. At the
    // script's defaults TradingView draws nothing there either (every bar `na`), so
    // the picture agrees; with the member's toggle ON it would not — counted, not hidden.
    'btc-charlie-trader-xo-macro-trend-scanner-rddt-1d-2026-09-30.json': [
      'plot_14 notDrawn', 'plot_15 agree 634/634 painted=0', 'plot_16 notDrawn', 'plot_17 notDrawn',
      'plot_6 agree 634/634 painted=8', 'plot_7 agree 634/634 painted=9',
      'plot_10 agree 634/634 painted=349', 'plot_11 agree 634/634 painted=244'],
    'elliott-wave-3-finder-v2-rddt-1d-2026-09-28.json': ['plot_2 agree 632/632 painted=65', 'plot_3 agree 632/632 painted=44'],
    'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json': ['plot_8 agree 632/632 painted=632', 'plot_9 agree 632/632 painted=0'],
    'fibonacci-pivot-points-cc-rddt-1d-2026-09-28.json': ['plot_2 agree 632/632 painted=632'],
    'fvg-trend-rddt-1d-2026-09-27.json': ['refused pine:state'],
    // its colour is a ternary CHOOSING between two `color.from_gradient`s; one gradient is
    // carried (C37), a choice between two is not — withheld by name, nothing drawn
    'heat-map-seasons-rddt-1d-2026-09-28.json': ['plot_0 withheld'],
    'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-rddt-1d-2026-09-28.json': ['refused pine:state'],
    'mcclellan-indicators-rddt-1d-2026-09-28.json': ['plot_4 naBoth 632/632 painted=0', 'plot_15 naBoth 632/632 painted=0'],
    'vw-deadband-ticks-aapl-1d-2026-09-28.json': ['refused pine:state'],
    'vw-deadband-ticks-brk-a-1d-2026-09-28.json': ['refused pine:state'],
    'vw-deadband-ticks-spy-1d-2026-09-28.json': ['refused pine:state'],
  }
  const lines = (g) => {
    if (g.refused) return [`refused ${(/\((pine:[^)]+)\)/.exec(g.refused) || [])[1] || g.refused}`]
    return g.rows.map((r) => (r.compared === undefined ? `${r.id} ${r.state}`
      : `${r.id} ${r.state} ${r.compared - r.differ}/${r.compared} painted=${r.vendorPainted}`))
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
    const differing = Object.keys(PINNED).flatMap((f) => gradeOf(f).rows
      .filter((r) => r.state === 'differ' || r.state === 'naDiffers' || r.state === 'titleMismatch')
      .map((r) => `${f} ${r.id}`))
    expect(differing).toEqual([])
    // non-vacuity: bars TradingView actually painted were compared and agreed
    const painted = Object.keys(PINNED).flatMap((f) => gradeOf(f).rows)
      .filter((r) => r.state === 'agree').reduce((n, r) => n + r.vendorPainted, 0)
    expect(painted).toBeGreaterThan(2000)
  }, 600000)

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
        console.log(f, JSON.stringify({ refused: g.refused || null, unpaired: g.unpaired, rows: g.rows }, null, 0))
      }
    }, 600000)
  }
})
