// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.w19r2GradientFill.test.js
//
// ─── ⭐⭐ W19-R2 — THE GRADIENT `fill` ON THE RUNTIME LANE, GRADED (Q-RT15d) ───
//
// Evidence: CAP5 `vw-rt15-gradient-fill-rddt-1d-2026-10-04` (NYSE:RDDT 1D from the
// listing, 636 bars; MATCH on its plots in both door states). TradingView records a
// gradient fill's two VALUES per bar as data plots targeting the fill (`plot_2` /
// `plot_3` → `fill_0`, `plot_5` / `plot_6` → `fill_1`, in argument order) and a
// per-bar TOP colour as the fill's colorer (`plot_7` → `fill_1`, palette lime@20 /
// orange@20); the round's screenshot reads the band shaded LINEARLY in price from
// the top colour to the bottom colour, clipped to the two plots.
//
// The probe is put through the runtime door's FALLBACK (`forcedRuntime`, RT8's
// method): its host translation is handed back marked refused, so the door, the
// run and the renderer's readers are the member's; only the host verdict is forced.
//
// ⛔ NOT IN THE CAPTURE, AND NOT CLAIMED: the bottom colour (no colorer records a
// constant one), which bar's colours shade the step between two bars, and the
// shade outside [bottom_value, top_value] — Q-W19R2c.
import { describe, it, expect } from 'vitest'

import { loadCapture, HARNESS_DIR, withDoorState } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { columnColorsForPlot, packedPointColour } from '../../pool'
import { validateDefinition } from '../../defSchema'
import { gradientSteps } from '../../fillPrimitive'
import { vendorPlotRoles, vendorColorsFor, normalizeColor, coloursAgree, NO_COLOUR } from '../../../../../../../tools/vendor_harness/compare.mjs'
import path from 'node:path'

const T = 600000
const ID = 'vw-rt15-gradient-fill-rddt-1d-2026-10-04'

function forcedRuntime(source, id = 'u_w19r2grad0001') {
  return withDoorState('runtime', () => {
    const host = memberPaneDefinition({ source, id })
    const refused = { ...host.translation, ok: false, refusals: [{ guard: 'w19r2:forced', message: 'forced to the runtime lane for grading' }] }
    return memberPaneDefinition({ source, id, translation: refused })
  })
}

describe('⭐⭐ W19-R2 — the gradient fill, graded against CAP5 Q-RT15d', () => {
  const c = loadCapture(path.join(HARNESS_DIR, `${ID}.json`)).capture
  const source = c.source.text

  it('the door draws BOTH gradient bands, as a valid document', () => {
    expect(c.history.startsAtBar0).toBe(true)
    const d = forcedRuntime(source)
    expect(d.ok, JSON.stringify(d.runtimeDeclined || d.reason)).toBe(true)
    expect(d.lane).toBe('runtime')
    const bands = d.definition.plots.filter((p) => p.fill)
    expect(bands.length).toBe(2)
    for (const b of bands) expect(b.fill.gradient).toMatchObject({ top: expect.any(String), bottom: expect.any(String) })
    const vd = validateDefinition(d.definition)
    expect(vd.ok, JSON.stringify(vd.errors)).toBe(true)
    // ⛔ a gradient naming a column no plot declares is refused by the schema
    for (const k of ['top', 'bottom', 'bottomColorMode']) {
      const bad = JSON.parse(JSON.stringify(d.definition))
      const b = bad.plots.find((p) => p.fill && p.fill.gradient)
      b.fill.gradient[k] = k === 'bottomColorMode' ? 'column:nope' : 'nope'
      const v = validateDefinition(bad)
      expect(v.ok, k).toBe(false)
      expect(JSON.stringify(v.errors), k).toMatch(new RegExp(`gradient: ${k}`))
    }
  }, T)

  it('each band\'s top and bottom VALUES agree with TradingView\'s fill data plots on every bar', () => {
    const d = forcedRuntime(source)
    const cols = withDoorState('runtime', () => computeRuntimeColumns(d.definition, toProductBars(c), { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }))
    const outOf = (p) => d.definition.compute.outputs[columnColorsForPlot(p.fill).key]
    const bands = d.definition.plots.filter((p) => p.fill).sort((x, y) => outOf(x) - outOf(y))
    const fields = c.plotValues.fields
    const pairs = [['plot_2', 'plot_3'], ['plot_5', 'plot_6']]
    bands.forEach((b, k) => {
      const [tf, bf] = pairs[k].map((f) => fields.indexOf(f))
      let compared = 0
      c.plotValues.rows.forEach((r, i) => {
        for (const [col, want] of [[cols[b.fill.gradient.top], r[tf]], [cols[b.fill.gradient.bottom], r[bf]]]) {
          if (want == null) { expect(Number.isFinite(col[i]), `band ${k} bar ${i}`).toBe(false); continue }
          compared += 1
          expect(Math.abs(col[i] - want) / Math.max(1, Math.abs(want)), `band ${k} bar ${i}`).toBeLessThan(1e-9)
        }
      })
      expect(compared).toBeGreaterThan(1200)
    })
  }, T)

  it('G05\'s per-bar TOP colour agrees with TradingView\'s `fill_1` colorer on every bar, both colours occurring', () => {
    const d = forcedRuntime(source)
    const cols = withDoorState('runtime', () => computeRuntimeColumns(d.definition, toProductBars(c), { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }))
    const outOf = (p) => d.definition.compute.outputs[columnColorsForPlot(p.fill).key]
    const g05 = d.definition.plots.filter((p) => p.fill).sort((x, y) => outOf(x) - outOf(y))[1]
    const cc = columnColorsForPlot(g05.fill)
    const ours = Array.from(cols[cc.key]).map((v) => { const h = packedPointColour(cc.packed, v); return h ? normalizeColor(h) : NO_COLOUR })
    const roles = vendorPlotRoles(c)
    const colorer = roles.notCompared.find((p) => p.type === 'colorer' && p.target === 'fill_1')
    expect(colorer).toBeTruthy()
    const times = c.bars.rows.map((r) => r[0])
    const rowsByTime = new Map(c.plotValues.rows.map((r) => [String(r[0]), r]))
    const tv = vendorColorsFor(c, { id: 'fill_1' }, [colorer], rowsByTime, times)
    expect(tv.reason).toBe(null)
    const tally = new Map()
    let compared = 0
    tv.colors.forEach((want, i) => {
      if (want === undefined) return
      compared += 1
      expect(coloursAgree(ours[i], want), `bar ${i}: ours ${ours[i]} vs TradingView ${want}`).toBe(true)
      tally.set(want, (tally.get(want) || 0) + 1)
    })
    expect(compared).toBeGreaterThan(600)
    expect(tally.size).toBe(2)
    for (const n of tally.values()) expect(n).toBeGreaterThan(100)
  }, T)
})

describe('⭐ `gradientSteps` — the geometry the renderer draws, pure', () => {
  const times = [1, 2, 3, 4]
  const id = (v) => v
  const base = {
    upper: [10, 11, 12, 13], lower: [5, 5, 6, 6], times,
    colors: ['#00ff00', '#00ff01', '#00ff02', '#00ff03'],
    gradient: { top: [10, 11, 12, 13], bottom: [5, 5, 6, 6], bottomColors: ['#ff0000', '#ff0000', '#ff0000', '#ff0000'] },
    timeToX: id, priceToY: id,
  }
  it('one quad per step, clipped to the two edges, shaded from bar i\'s top value to its bottom value', () => {
    const s = gradientSteps(base)
    expect(s.length).toBe(3)
    expect(s[0]).toEqual({
      poly: [{ x: 1, y: 10 }, { x: 2, y: 11 }, { x: 2, y: 5 }, { x: 1, y: 5 }],
      y0: 11, y1: 5, c0: '#00ff01', c1: '#ff0000',
    })
  })
  it('⛔ an `na` value, edge or colour is a gap — the steps on either side of it are not drawn', () => {
    expect(gradientSteps({ ...base, upper: [10, NaN, 12, 13] }).length).toBe(1)
    expect(gradientSteps({ ...base, colors: ['#0f0', null, '#0f0', '#0f0'] }).length).toBe(2)
    expect(gradientSteps({ ...base, gradient: { ...base.gradient, bottomColors: [null, null, null, '#f00'] } }).length).toBe(1)
    expect(gradientSteps({ ...base, gradient: { ...base.gradient, top: [10, 11, NaN, 13] } }).length).toBe(2)
  })
  it('⛔ a declared gradient whose columns are missing draws NOTHING (never a flat band)', () => {
    expect(gradientSteps({ ...base, gradient: { missing: true } })).toEqual([])
  })
})
