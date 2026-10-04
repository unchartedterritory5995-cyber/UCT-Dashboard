// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt8Followups.test.js
//
// ─── ⭐⭐ RT8 (step 87) — RT6's AND GT's OPEN ITEMS, GRADED ─────────────────────
//
// Evidence, never mixed, stated per block:
//   · trend-targets-algoalpha RDDT 1D (from the listing): the harness's own grade.
//   · inside-bar-range SPY 1D (NOT from the listing): our run on the capture's bars,
//     with and without ONE synthetic bar before the window — the divergence is the
//     bar the window does not hold (the off-listing rule), and nothing else.
//   · runtime FILLS: the per-bar fill colour TradingView records (the `fill_0`
//     colorer) against the colour column our run draws the band with. A script is
//     put through the runtime door's FALLBACK by handing the door its own host
//     translation marked refused (`forcedRuntime`): the door, the run and the
//     renderer's colour reader are the member's; only the host verdict is forced,
//     because no corpus script that reaches the runtime lane today writes a fill.
//   · per-bar SHAPE colour: no capture of a runtime document records one, so it
//     stays withheld by name (queued: capture-queue-2026-10-03-rt8-runtime-followups.md).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR, REPO, withDoorState } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { columnColorsForPlot, packedPointColour, bindingKey } from '../../pool'
import { paintColoursFor } from '../../binder'
import { validateDefinition } from '../../defSchema'
import { vendorPlotRoles, vendorColorsFor, normalizeColor, coloursAgree, NO_COLOUR } from '../../../../../../../tools/vendor_harness/compare.mjs'

const CORPUS = path.join(REPO, 'corpus', 'committed')
const corpus = (slug) => {
  const f = fs.readdirSync(CORPUS).find((x) => x.split('__')[0] === slug)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}
const cap = (id) => {
  const c = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
  expect(c, id).toBeTruthy()
  return c
}
const T = 600000

/** The member door's runtime FALLBACK for a script the host lane translates: the
 *  same door call, handed its own host translation marked refused. */
function forcedRuntime(source, id = 'u_rt8forced0001') {
  return withDoorState('runtime', () => {
    const host = memberPaneDefinition({ source, id })
    const refused = { ...host.translation, ok: false, refusals: [{ guard: 'rt8:forced', message: 'forced to the runtime lane for grading' }] }
    return memberPaneDefinition({ source, id, translation: refused })
  })
}

/** Each drawn band's colour per bar, as the renderer reads it (`fillColours`). */
function bandColours(d, cols) {
  return (d.definition.plots || []).filter((p) => p.fill).map((p) => {
    const cc = columnColorsForPlot(p.fill)
    expect(cc && cc.packed, `${p.key}: the band reads a packed colour column`).toBeTruthy()
    return { plot: p, colours: Array.from(cols[cc.key]).map((c) => {
      const hex = packedPointColour(cc.packed, c)
      return hex ? normalizeColor(hex) : NO_COLOUR
    }) }
  })
}

describe('RT8 item 4a — trend-targets-algoalpha RDDT: the run that starts at the listing matches', () => {
  it('MATCH, every plot, Baseline included (the wma warm-up seed defect is gone)', () => {
    const v = withDoorState('runtime', () => gradeCapture(cap('trend-targets-algoalpha-rddt-1d-2026-10-02')).verdict)
    expect(v.verdict, v.reason).toBe('MATCH')
    const base = v.plots.find((p) => p.title === 'Baseline')
    expect(base.verdict).toBe('MATCH')
    expect(base.stats.steady.compared).toBeGreaterThan(400)
    expect(base.stats.naMismatches).toBe(0)
  }, T)
})

describe('RT8 item 4b — inside-bar-range SPY bar 0 / bar 2: the off-listing rule, and nothing else', () => {
  const run = (prepend) => withDoorState('runtime', () => {
    const c = cap('inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat-spy-1d-2026-10-03')
    expect(c.history.startsAtBar0).toBe(false)
    const d = memberPaneDefinition({ source: corpus('inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat'), id: 'u_rt8insidebar1' })
    expect(d.lane).toBe('runtime')
    const bars = toProductBars(c)
    const bs = prepend ? [prepend, ...bars] : bars
    const cols = computeRuntimeColumns(d.definition, bs, { tf: 'D', newestBarIsForming: false, historyFromListing: false, symbol: { ticker: 'SPY', exchange: 'AMEX' } })
    const pcols = new Map(Object.keys(cols).map((k) => [bindingKey('rt8', k), cols[k]]))
    const off = prepend ? 1 : 0
    // TradingView's two bar_colorers, in source order (plot_0, plot_3): painted or not.
    const tvCols = c.study.plots.map((p, i) => ({ p, column: i + 1 })).filter((x) => x.p.type === 'bar_colorer').map((x) => x.column)
    const paints = (d.definition.paints || []).filter((p) => p.kind === 'barcolor')
    expect(paints.length).toBe(2)
    return paints.map((p, j) => {
      const ours = paintColoursFor(p, 'rt8', pcols, bs.length)
      const diffs = []
      c.plotValues.rows.forEach((r, i) => { if ((r[tvCols[j]] != null) !== (ours[i + off] != null)) diffs.push(i) })
      return diffs
    })
  })

  it('on the capture\'s own bars the two barcolors differ on bar 0 and bar 2 only', () => {
    expect(run(null)).toEqual([[0], [2]])
  }, T)

  it('⭐ with ONE bar before the window (any bar whose range contains bar 0\'s, high in [287.97, 293.62)), they agree on all 1,800', () => {
    // Bar 0 is an inside bar of the bar before the window (TradingView paints it
    // orange: `high[1] > high and low[1] < low` reads bar −1), which also sets
    // `mhigh = high[1]` — so bar 2's breakout (close 293.62 > mhigh, with bar 1's
    // close 287.97 not above it) is bar −1's too. The run cannot hold a bar the
    // window does not hand it: RT1 ruling R-W, not a run defect.
    expect(run({ t: '2019-08-05', o: 285, h: 290, l: 280, c: 286, v: 1e8 })).toEqual([[], []])
  }, T)
})

describe('RT8 item 3 — a runtime document carries its fills, coloured by the run', () => {
  // atr-trailing-stop-by-ceyhun (v5) — `fill(TS1, TS2, Bull ? color.new(color.green, 90)
  // : color.new(color.red, 90))`, TS1 `display = display.none`. The runtime lane
  // declines the whole script for its InfoPanel label text (`str.tostring` over a
  // value: RT7's wall list), so the grade runs the script WITHOUT the InfoPanel —
  // every line above `//InfoPanel` byte for byte; nothing below it feeds a plot,
  // a paint or the fill.
  const atrSource = () => corpus('atr-trailing-stop-by-ceyhun').split('//InfoPanel')[0]

  it('⭐⭐ atr-trailing-stop RDDT: the band (on a display.none edge) agrees with TradingView\'s fill colour on every bar', () => {
    const c = cap('atr-trailing-stop-by-ceyhun-rddt-1d-2026-10-02')
    expect(c.history.startsAtBar0).toBe(true)
    const d = forcedRuntime(atrSource())
    expect(d.ok, JSON.stringify(d.runtimeDeclined || d.reason)).toBe(true)
    expect(d.lane).toBe('runtime')
    const bands = d.definition.plots.filter((p) => p.fill)
    expect(bands.length).toBe(1)
    // the edge the author hid is carried as a hidden anchor (it draws no line)
    const keys = [bands[0].key, bands[0].fill.with]
    expect(keys.some((k) => d.definition.plots.find((p) => p.key === k).hidden === true)).toBe(true)
    expect(d.notes.some((n) => /fill between two plots/.test(n.note))).toBe(false)
    // the document the member's chart would install is a valid one
    const vd = validateDefinition(d.definition)
    expect(vd.ok, JSON.stringify(vd.errors)).toBe(true)
    const cols = withDoorState('runtime', () => computeRuntimeColumns(d.definition, toProductBars(c), { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }))
    const ours = bandColours(d, cols)[0].colours
    const roles = vendorPlotRoles(c)
    const fillColorer = roles.notCompared.find((p) => p.type === 'colorer' && p.target === 'fill_0')
    const times = c.bars.rows.map((r) => r[0])
    const rowsByTime = new Map(c.plotValues.rows.map((r) => [String(r[0]), r]))
    const tv = vendorColorsFor(c, { id: 'fill_0' }, [fillColorer], rowsByTime, times)
    expect(tv.reason).toBe(null)
    let compared = 0
    const tally = new Map()
    tv.colors.forEach((want, i) => {
      if (want === undefined) return
      compared += 1
      expect(coloursAgree(ours[i], want), `bar ${i}: ours ${ours[i]} vs TradingView ${want}`).toBe(true)
      tally.set(want, (tally.get(want) || 0) + 1)
    })
    expect(compared).toBe(636)
    // ⛔ NON-VACUITY: both colours of the rule occur
    expect(tally.size).toBe(2)
    for (const n of tally.values()) expect(n).toBeGreaterThan(200)
  }, T)

  it('the band\'s edges are the script\'s: `Slow Trail` grades MATCH against the same capture', () => {
    const c = cap('atr-trailing-stop-by-ceyhun-rddt-1d-2026-10-02')
    const d = forcedRuntime(atrSource())
    const cols = withDoorState('runtime', () => computeRuntimeColumns(d.definition, toProductBars(c), { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }))
    const slow = d.rows.find((r) => r.label === 'Slow Trail')
    const roles = vendorPlotRoles(c)
    const vp = roles.value.find((p) => p.title === 'Slow Trail')
    const col = cols[slow.key]
    let compared = 0
    c.plotValues.rows.forEach((r, i) => {
      const want = r[vp.column]
      if (want == null) { expect(Number.isFinite(col[i]), `bar ${i}`).toBe(false); return }
      compared += 1
      expect(Math.abs(col[i] - want) / Math.max(1, Math.abs(want)), `bar ${i}`).toBeLessThan(1e-9)
    })
    expect(compared).toBeGreaterThan(600)
  }, T)

  it('donchian-channels (v6): seven constant-colour bands, each its literal colour on every bar (hand replay: `color.new(#808080, 85)` …)', () => {
    const src = corpus('donchian-channels')
    const d = forcedRuntime(src)
    expect(d.ok).toBe(true)
    const vd = validateDefinition(d.definition)
    expect(vd.ok, JSON.stringify(vd.errors)).toBe(true)
    const c = cap('donchian-channels-rddt-1d-2026-09-28')
    const cols = withDoorState('runtime', () => computeRuntimeColumns(d.definition, toProductBars(c), { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }))
    // in SOURCE order: a band's colour column is the run's output for its `fill(…)`,
    // and the run numbers its outputs in source order
    const outOf = (b) => d.definition.compute.outputs[columnColorsForPlot(b.plot.fill).key]
    const bands = bandColours(d, cols).sort((x, y) => outOf(x) - outOf(y))
    // the literal colour of each `fill(…)`, in source order, at Pine's alpha
    const want = [...src.matchAll(/^fill\([^\n]*color\s*=\s*color\.new\((#[0-9A-Fa-f]{6}),\s*(\d+)\)/gm)]
      .map((m) => normalizeColor(m[1]) .slice(0, 7) + Math.round(((100 - Number(m[2])) * 255) / 100).toString(16).padStart(2, '0'))
    expect(want.length).toBe(7)
    expect(bands.length).toBe(7)
    const got = bands.map((b) => [...new Set(b.colours)])
    got.forEach((g, i) => expect(g, `band ${i}`).toEqual([want[i]]))
  }, T)
})

describe('RT8 item 3 — what a runtime document still withholds about a fill, by name', () => {
  const v5 = (body) => `//@version=5\nindicator("rt8 fill rules", overlay = true)\n${body}`
  const base = 'a = plot(close, "A")\nb = plot(open, "B")\n'
  const doc = (src) => {
    const d = forcedRuntime(src)
    expect(d.ok, JSON.stringify(d.runtimeDeclined || d.reason)).toBe(true)
    return d
  }
  const named = (d, re) => d.notes.some((n) => re.test(n.note))
  const bands = (d) => d.definition.plots.filter((p) => p.fill).length

  it('a v5 fill with a per-bar colour is carried (control)', () => {
    const d = doc(v5(`${base}fill(a, b, close > open ? color.green : color.red)\n`))
    expect(bands(d)).toBe(1)
    expect(named(d, /not drawn/)).toBe(false)
  })
  it('a v4 fill is withheld: its `transp` rules have no capture here', () => {
    const d = doc(`//@version=4\nstudy("rt8 v4", overlay = true)\na = plot(close, "A")\nb = plot(open, "B")\nfill(a, b, color = color.red)\n`)
    expect(bands(d)).toBe(0)
    expect(named(d, /fill rules of a v4 script/)).toBe(true)
  })
  it('`show_last`, `fillgaps = true` and an unread `display` are withheld; `display.none` draws nothing and is not named', () => {
    let d = doc(v5(`${base}fill(a, b, color.red, show_last = 5)\n`))
    expect(bands(d)).toBe(0)
    expect(named(d, /show_last/)).toBe(true)
    d = doc(v5(`${base}fill(a, b, color.red, fillgaps = true)\n`))
    expect(bands(d)).toBe(0)
    expect(named(d, /fillgaps/)).toBe(true)
    d = doc(v5(`${base}fill(a, b, color.red, display = display.data_window)\n`))
    expect(bands(d)).toBe(0)
    expect(named(d, /display =/)).toBe(true)
    d = doc(v5(`${base}fill(a, b, color.red, display = display.none)\n`))
    expect(bands(d)).toBe(0)
    expect(named(d, /not drawn/)).toBe(false)
    d = doc(v5(`${base}fill(a, b, color.red, fillgaps = false)\n`))
    expect(bands(d)).toBe(1)
  })
  it('a fill whose edge is withheld (drawn with an `offset`) is withheld, naming the edge', () => {
    const d = doc(v5('a = plot(close, "A", offset = 2)\nb = plot(open, "B")\nfill(a, b, color.red)\n'))
    expect(bands(d)).toBe(0)
    expect(named(d, /its edge `A` is not drawn/)).toBe(true)
  })
  it('three bands over two rows: the third is withheld (a row carries one band)', () => {
    const d = doc(v5(`${base}fill(a, b, color.red)\nfill(a, b, color.blue)\nfill(a, b, color.green)\n`))
    expect(bands(d)).toBe(2)
    expect(named(d, /both of its edges already carry a band/)).toBe(true)
  })
})

describe('RT8 item 2 — a per-bar shape colour on a runtime document stays withheld by name', () => {
  it('a `plotshape` whose colour changes per bar is withheld with its sentence; a constant one is drawn', () => {
    const src = '//@version=5\nindicator("rt8 shape", overlay = true)\n'
      + 'plotshape(close > open, "S01 per-bar", shape.circle, location.belowbar, color = close > close[1] ? color.green : color.red)\n'
      + 'plotshape(close < open, "S02 constant", shape.square, location.abovebar, color = color.blue)\n'
    const d = forcedRuntime(src)
    expect(d.ok).toBe(true)
    expect(d.rows.map((r) => r.label)).toEqual(['S02 constant'])
    expect(d.withheld).toEqual(['S01 per-bar'])
    expect(d.notes.find((n) => n.name === 'S01 per-bar').note).toMatch(/a shape whose colour changes per bar is not carried by this lane yet/)
  })
})
