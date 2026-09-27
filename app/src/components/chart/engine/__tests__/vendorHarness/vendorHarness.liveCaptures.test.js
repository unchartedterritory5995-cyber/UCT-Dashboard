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
// ⭐ These three agree with TradingView on every item. This rail makes that a
// regression pin against the VENDOR's numbers, not ours: a change that moves any
// value, colour or object away from what TradingView drew goes red here by name.
//
// ⛔ The two captures that still DIVERGE (Keltner, ATR Trailing Stoploss — the
// ATR seed, and a three-colour chain) are asserted to DIVERGE for their KNOWN
// reason, so fixing them is visible (this file must then be updated to MATCH)
// and a new, different divergence is not mistaken for the known one.
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
    'cumulative-volume-delta-rddt-1d-2026-09-27',
    'engulfingcandle-rddt-1d-2026-09-27',
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
    }, 60000)
  }
})

describe('live TradingView captures — KNOWN divergences', () => {
  it('Keltner: every divergence is a CONVERGING value prefix (the ATR seed), never a colour', () => {
    const v = grade('keltner-channels-bands-rddt-1d-2026-09-27')
    const div = (v.plots || []).filter((p) => p.verdict === 'DIVERGE')
    expect(div.length).toBeGreaterThan(0)
    for (const p of div) expect(p.reason, p.title).toMatch(/CONVERGING PREFIX/)
    expect((v.plots || []).find((p) => p.title === 'Basis').verdict).toBe('MATCH')
  }, 60000)

  it('ATR Trailing Stoploss: the line is the only divergence (three-colour chain + ATR seed)', () => {
    const v = grade('atr-trailing-stoploss-rddt-1d-2026-09-27')
    const div = (v.plots || []).filter((p) => p.verdict === 'DIVERGE').map((p) => p.title)
    expect(div).toEqual(['ATR Trailing Stoploss'])
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
    const c = JSON.parse(JSON.stringify(load('atr-trailing-stoploss-rddt-1d-2026-09-27')))
    const visible = gradeCapture(c).verdict.plots.find((p) => p.id === 'plot_1')
    // CONTROL — displayed, its first divergence is the colour (gold vs #363a45)
    expect(visible.stats.firstDivergence.kind).toBe('color')
    c.study.styleState.plot_1 = { ...(c.study.styleState.plot_1 || {}), display: 0 }
    const hidden = gradeCapture(sealCapture(c)).verdict.plots.find((p) => p.id === 'plot_1')
    expect(hidden.stats.firstDivergence.kind).not.toBe('color')
    expect(hidden.verdict).toBe('DIVERGE')             // the ATR-seed VALUES still count
  })
})
