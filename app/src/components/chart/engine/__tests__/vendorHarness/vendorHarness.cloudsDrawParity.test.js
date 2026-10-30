// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.cloudsDrawParity.test.js
//
// ─── ⭐⭐ UNCHARTED CLOUDS, DRAWN — what the chart PAINTS vs what TradingView paints ─
//
// The values rail answers "are the numbers right". This one answers the question a
// member actually sees: run `tests/fixtures/member/uncharted-clouds.pine` through
// the REAL member door (`memberPaneDefinition` → install), the REAL binder, and the
// REAL fill primitive's draw, over each capture's own bars, and compare what lands
// on the canvas with TradingView's own record of the same script on the same bars:
//
//   • every plot value (2 MAs + 21 layers) within 1e-9 relative, every bar;
//   • every band's per-bar colour — hue AND alpha byte, EXACT — read off the
//     recorded `fillStyle` of the polygon that covers that bar;
//   • the two MA lines' colour, alpha byte and line width.
//
// ⚰️ WHY IT EXISTS. Every number matched TradingView to 6.6e-16 and the chart was
// still wrong: all twenty bands painted fully OPAQUE (the member door wrote the
// band opacity onto `plots[].fillOpacity`; the per-bar colour path read a
// `fill.opacity` nobody writes), ten of them a byte or two off besides (the
// transparency was truncated to a whole percent before painting), and both MAs
// drew 1 px where the script says `linewidth = 2`. A values rail cannot see any of
// that; only the paint can.
//
// ⭐ WARM, NOT COLD. Each capture's window starts mid-history, so the EMAs need the
// bars before it: `warmBarsSupply` proves a committed capture of the same symbol and
// timeframe agrees with the window bar for bar on OHLCV and prepends its prehistory
// (A: `vw-bool-cast-spy-1d-2026-09-28.json`, from the listing; D: a 4H capture).
// The run covers prehistory + window; only the window is graded, and the
// prehistory is drawn OFF-SCREEN (its x is null) so no polygon spans the seam.
//
// ⛔ THE CONTROLS ARE THE PRE-FIX READERS, kept reachable here on purpose: the
// band colours as the paint reader resolves them (no band opacity — what the
// chart drew before this fix) and the alpha a truncated transparency gives. Each
// must DISAGREE with TradingView, or agreeing with TradingView proves nothing.
import { describe, it, expect, afterAll } from 'vitest'
import path from 'node:path'

import { paintColoursFor } from '../../binder'
import { bindingKey } from '../../pool'
import { unpackVendorColor, wholeTransparency } from '../../colorInt'
import { REF, runCloudsCapture, tvColumns, cssToRgba, fmt, uninstallHarness } from './cloudsDraw'

const CAPTURES = [
  { id: 'A', name: 'clouds-volume-spy-1d-250' },
  { id: 'D', name: 'clouds-volume-spy-4h-300' },
]

/** Everything one capture needs, run ONCE (the binder pass over ~8.5k bars is the
 *  expensive part) — `cloudsDraw.runCloudsCapture`, the runner set E shares. */
const RUNS = new Map()
const runOf = (c) => {
  if (!RUNS.has(c.id)) RUNS.set(c.id, runCloudsCapture({ dir: path.join(REF, c.id), name: c.name }))
  return RUNS.get(c.id)
}

afterAll(() => uninstallHarness())

describe.each(CAPTURES)('Uncharted Clouds drawn vs TradingView — capture $id ($name)', (capRef) => {
  /** TradingView's columns, derived from the capture's own plot list (never typed). */
  const tvOf = tvColumns

  it('NON-VACUITY — warm replay, 23 drawn values, 20 bands, 2 lines', () => {
    const r = runOf(capRef)
    expect(r.supply.kind, r.supply.reason).toBe('warm')
    expect(r.pre).toBeGreaterThan(100)
    expect(r.n).toBeGreaterThanOrEqual(250)
    const tv = tvOf(r)
    expect(tv.lines).toHaveLength(23)
    expect(r.owners).toHaveLength(20)
    expect(r.bands).toHaveLength(20)
    expect(r.lineSeries).toHaveLength(2)
  })

  it('every plot value within 1e-9 relative of TradingView, every bar of the window', () => {
    const r = runOf(capRef)
    const tv = tvOf(r)
    // ours, in TradingView's order: the two MAs, then the 21 layers (each band's
    // owner, then the last band's far edge).
    const drawnKeys = r.def.plots.filter((p) => !p.hidden).map((p) => p.key)
    const layerKeys = [...r.owners.map((p) => p.key), r.owners[r.owners.length - 1].fill.with]
    const keys = [...drawnKeys, ...layerKeys]
    expect(keys).toHaveLength(tv.lines.length)
    const bad = []
    keys.forEach((k, j) => {
      const ours = r.cols[k]
      const theirs = tv.col(tv.lines[j])
      for (let i = 0; i < r.n; i += 1) {
        const a = ours[i]
        const b = theirs[i]
        if (Number.isFinite(a) !== Number.isFinite(b)) { bad.push(`${k}~${tv.lines[j]} bar ${i}: ${a} vs ${b}`); continue }
        if (!Number.isFinite(b)) continue
        if (Math.abs(a - b) / Math.max(Math.abs(b), 1) > 1e-9) bad.push(`${k}~${tv.lines[j]} bar ${i}: ${a} vs ${b}`)
      }
    })
    expect(bad.slice(0, 10), `${bad.length} value(s) off`).toEqual([])
    // and the two LINES are drawn with those values (the series' own setData)
    r.lineSeries.forEach((s, j) => {
      const pts = r.setDataOf(s)
      const window = pts.slice(r.pre).map((p) => (p && Number.isFinite(p.value) ? p.value : NaN))
      const theirs = tv.col(tv.lines[j])
      const off = window.filter((v, i) => Number.isFinite(theirs[i])
        && !(Math.abs(v - theirs[i]) / Math.max(Math.abs(theirs[i]), 1) <= 1e-9)).length
      expect(off, `line ${j} drawn values off TradingView`).toBe(0)
    })
  })

  it('⭐⭐ every band, every bar: the PAINTED colour equals TradingView\'s — hue and alpha byte, exact', () => {
    const r = runOf(capRef)
    const tv = tvOf(r)
    const report = []
    let compared = 0
    r.bands.forEach((band, j) => {
      expect(band.twice, `band ${j}: a bar painted by two polygons`).toEqual([])
      const theirs = tv.col(tv.colourOf(`fill_${j}`))
      let off = 0
      let first = null
      for (let i = 0; i < r.n; i += 1) {
        if (!Number.isFinite(theirs[i])) continue
        compared += 1
        const t = unpackVendorColor(theirs[i])
        const o = cssToRgba(band.perBar[i])
        if (!o || o.hex !== t.hex || o.a !== t.alphaByte) {
          off += 1
          if (!first) first = `bar ${i}: ours ${band.perBar[i]} (${fmt(o)}) vs TradingView ${t.hex}/${t.alphaByte}`
        }
      }
      if (off) report.push(`band ${j}: ${off} bar(s) off — first ${first}`)
    })
    expect(compared).toBeGreaterThanOrEqual(20 * 250)
    expect(report).toEqual([])
  })

  it('the alpha ladder is the script\'s, derived: round((1 − (95 − 2.5k)/100) × 255)', () => {
    const r = runOf(capRef)
    const tv = tvOf(r)
    const want = r.bands.map((_, k) => Math.round((1 - (95 - 2.5 * k) / 100) * 255))
    const last = r.n - 1
    const tvBytes = r.bands.map((_, j) => unpackVendorColor(tv.col(tv.colourOf(`fill_${j}`))[last]).alphaByte)
    const ours = r.bands.map((b) => cssToRgba(b.perBar[last]).a)
    expect(tvBytes).toEqual(want)
    expect(ours).toEqual(want)
  })

  it('the MA lines: colour, alpha byte and line width equal TradingView\'s', () => {
    const r = runOf(capRef)
    const tv = tvOf(r)
    const styles = r.study.properties.styles
    r.lineSeries.forEach((s, j) => {
      const pid = tv.lines[j]
      const theirs = tv.col(tv.colourOf(pid)).filter(Number.isFinite).map((v) => {
        const u = unpackVendorColor(v)
        return `${u.hex}/${u.alphaByte}`
      })
      expect(new Set(theirs).size, `${pid}: TradingView's colour is constant`).toBe(1)
      expect(fmt(cssToRgba(s.__options.color)), `${pid} colour`).toBe(theirs[0])
      expect(s.__options.lineWidth, `${pid} linewidth`).toBe(styles[pid].linewidth)
    })
  })

  it('⛔ CONTROL — the PRE-FIX band reader (no band opacity) disagrees with TradingView on every band', () => {
    // `paintColoursFor(fill)` is the reader the bands went through before this fix:
    // the spec's colour rule with no `fillOpacity`. Kept reachable so agreeing with
    // TradingView above is a statement about the alpha, not about the hues.
    const r = runOf(capRef)
    const tv = tvOf(r)
    const colMap = new Map(Object.keys(r.colsAll).map((k) => [bindingKey('control', k), r.colsAll[k]]))
    let wrongBands = 0
    let hueAgree = 0
    r.owners.forEach((p, j) => {
      const pre = paintColoursFor(p.fill, 'control', colMap, r.bars.length) || []
      const theirs = tv.col(tv.colourOf(`fill_${j}`))
      let off = 0
      for (let i = 0; i < r.n; i += 1) {
        const o = cssToRgba(pre[i + r.pre])
        const t = unpackVendorColor(theirs[i])
        if (o && o.hex === t.hex) hueAgree += 1
        if (!o || o.a !== t.alphaByte) off += 1
      }
      if (off === r.n) wrongBands += 1
    })
    expect(hueAgree, 'the control must differ ONLY in alpha').toBe(20 * r.n)
    expect(wrongBands).toBe(20)
  })

  it('⛔ CONTROL — a TRUNCATED transparency puts half the ladder a byte or two off TradingView', () => {
    const r = runOf(capRef)
    const tv = tvOf(r)
    const last = r.n - 1
    const off = r.bands.filter((_, k) => {
      const truncated = Math.round((1 - wholeTransparency(95 - 2.5 * k) / 100) * 255)
      return truncated !== unpackVendorColor(tv.col(tv.colourOf(`fill_${k}`))[last]).alphaByte
    }).length
    expect(off).toBe(10)
  })
})
