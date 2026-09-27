// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.liveCaptures.test.js
//
// ─── THE LIVE CAPTURES THAT MATCH TRADINGVIEW STAY MATCHING ───────────────────
//
// Captured on a live TradingView chart 2026-09-27 (owner's session, rig layout
// 01f1AcIj, NYSE:RDDT 1D, all 631 bars from the 2024-03-21 listing, so no
// warm-up excuse) through `tools/vendor_harness/tv_capture.js`, receipts
// verified by `verify_capture.mjs --assemble`. Graded through the MEMBER DOOR on
// the vendor's own bars — values, per-bar colours and drawing objects.
//
// ⭐ These agree with TradingView on every item. This rail makes that a
// regression pin against the VENDOR's numbers, not ours: a change that moves any
// value, colour or object away from what TradingView drew goes red here by name.
//
// ⭐ All five MATCH since the ATR seed (atrPine) and the palette landed together:
// Keltner's bands had diverged on a converging prefix from bar 19, and ATR
// Trailing Stoploss's line on its three-colour chain and its seed.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture } from './harness'
import { sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { vendorPlotRoles } from '../../../../../../../tools/vendor_harness/compare.mjs'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: not a capture — ${loaded.reason}`)
  return loaded.capture
}
const grade = (id) => gradeCapture(load(id)).verdict

describe('live TradingView captures — MATCH', () => {
  for (const id of [
    'atr-trailing-stoploss-rddt-1d-2026-09-27',
    'cumulative-volume-delta-rddt-1d-2026-09-27',
    'engulfingcandle-rddt-1d-2026-09-27',
    'keltner-channels-bands-rddt-1d-2026-09-27',
    'rvol-rddt-1d-2026-09-27',
  ]) {
    it(`⭐ ${id} matches TradingView on every plot, colour and object`, () => {
      expect(fs.existsSync(path.join(DIR, `${id}.json`)), 'capture file missing').toBe(true)
      const v = grade(id)
      const bad = (v.plots || []).filter((p) => p.verdict !== 'MATCH').map((p) => `${p.title}: ${p.verdict} ${p.reason}`)
      expect(bad, bad.join('\n')).toEqual([])
      if (v.objects) expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
      expect(v.verdict, v.reason).toBe('MATCH')
      // ⛔ NON-VACUITY: a MATCH over zero compared bars would be worthless.
      expect((v.plots || []).length).toBeGreaterThan(0)
      for (const p of v.plots) expect(p.stats.steady.compared, p.title).toBeGreaterThan(500)
    }, 60000)
  }

  // ⭐ PROBES — four-line scripts written to measure ONE vendor behaviour each,
  // captured on the same rig. They pin the rule, not an indicator.
  for (const id of [
    // The study store holds a row only where some plot is non-na: 315 of 631.
    // A missing row is TradingView saying na, and before the comparator read it
    // that way every other bar was a blank the harness could not grade.
    'probe-sparse-rows-rddt-1d-2026-09-27',
    // `plot`/`plotshape`/`plotchar` with no colour draw #2962FF at every version,
    // v3 at 35% transparency; the engine drew them in its own gold. And an
    // untitled marker is titled "Shapes"/"Chars", which the mapper did not know.
    'probe-default-colour-v3-rddt-1d-2026-09-27',
    'probe-default-colour-v4-rddt-1d-2026-09-27',
    'probe-default-colour-v6-rddt-1d-2026-09-27',
  ]) {
    it(`⭐ ${id}: every plot MATCHES, colour included`, () => {
      const v = grade(id)
      const bad = (v.plots || []).filter((p) => p.verdict !== 'MATCH').map((p) => `${p.title}: ${p.verdict} ${p.reason}`)
      expect(bad, bad.join('\n')).toEqual([])
      expect(v.verdict, v.reason).toBe('MATCH')
      expect((v.plots || []).length).toBeGreaterThan(0)
      for (const p of v.plots) {
        expect(p.stats.steady.compared, p.title).toBeGreaterThan(500)
        // ⛔ THE COLOUR IS WHAT THESE PROBES EXIST FOR — a MATCH that never
        // compared one would pin nothing.
        expect(p.stats.colorCompared, `${p.title}: no colour compared`).toBeGreaterThan(0)
        expect(p.stats.colorMismatches, p.title).toBe(0)
      }
    }, 60000)
  }

  it('⭐ ATR Trailing Stoploss: the three-colour line agrees bar for bar (palette), and so does the seed', () => {
    const line = grade('atr-trailing-stoploss-rddt-1d-2026-09-27').plots.find((p) => p.id === 'plot_1')
    expect(line.stats.colorCompared).toBeGreaterThan(500)
    expect(line.stats.colorMismatches).toBe(0)
    expect(line.stats.valueMismatches).toBe(0)
  }, 60000)
})

// ⛔ SYNTHETIC VARIANTS OF A LIVE CAPTURE live HERE, never under tests/fixtures/
// (that directory's rule: a number there was read off the vendor's own screen).
describe('comparator rules the live captures forced', () => {
  it('a colorer on a FILL is reported NOT COMPARED by name, never graded against a plot', () => {
    const roles = vendorPlotRoles(load('rvol-rddt-1d-2026-09-27'))
    const fillColorers = roles.notCompared.filter((r) => r.type === 'colorer')
    expect(fillColorers.length).toBeGreaterThan(0)
    for (const r of fillColorers) expect(r.why).toMatch(/^fill colour \(fill_\d+\)$/)
    expect(roles.colorers.every((r) => !/^fill_/.test(r.target))).toBe(true)
    // CONTROL — the plot colorer beside them is still graded
    expect(roles.colorers.map((r) => r.target)).toContain('plot_0')
  })

  it('a plot TradingView does not DISPLAY has its values graded and its colour not', () => {
    // A vendor that reported a DIFFERENT palette entry on every bar: rotate the
    // line's colorer index (plot_2 → plot_1) so colours disagree everywhere.
    const c = JSON.parse(JSON.stringify(load('atr-trailing-stoploss-rddt-1d-2026-09-27')))
    const col = c.plotValues.fields.indexOf('plot_2')
    expect(col).toBeGreaterThan(0)
    c.plotValues.rows.forEach((r) => { if (Number.isInteger(r[col])) r[col] = (r[col] + 1) % 3 })
    const visible = gradeCapture(sealCapture(c)).verdict.plots.find((p) => p.id === 'plot_1')
    // CONTROL — displayed, the rotated colours are seen as disagreements
    expect(visible.stats.colorMismatches).toBeGreaterThan(500)
    c.study.styleState.plot_1 = { ...(c.study.styleState.plot_1 || {}), display: 0 }
    const hidden = gradeCapture(sealCapture(c)).verdict.plots.find((p) => p.id === 'plot_1')
    expect(hidden.stats.colorMismatches).toBe(0)
    expect(hidden.verdict).toBe('MATCH')               // values still graded, and they agree
    // CONTROL — the VALUES of a hidden plot still count: one perturbed value DIVERGEs
    const t = c.bars.rows[300][0]
    const row = c.plotValues.rows.find((r) => r[0] === t)
    row[c.plotValues.fields.indexOf('plot_1')] += 1
    const moved = gradeCapture(sealCapture(c)).verdict.plots.find((p) => p.id === 'plot_1')
    expect(moved.verdict).toBe('DIVERGE')
    expect(moved.stats.firstDivergence).toMatchObject({ bar: 300, kind: 'value' })
  })
})
