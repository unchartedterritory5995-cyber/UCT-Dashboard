// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.g5PaintWithheldByName.test.js
//
// ─── G5 — A PAINT WITHHELD BY NAME GRADES INCONCLUSIVE, AS A PLOT DOES ─────────
//
// Coordinator ruling 2026-11-15 (triage s245-bugs-1115, group G5):
//   - a paint withheld BY NAME (it carries a reason) grades INCONCLUSIVE, consistent
//     with a plot withheld by name;
//   - a paint our side did not draw and NOTHING names (`notDrawn`) still grades
//     DIFFERS where TradingView painted a bar.
//
// ⚰️ Two faults, both in the harness:
//   1. `paintColours.gradePaints` read only the translator's `t.withheld`. A paint whose
//      colour reads a column the BIND refused (another symbol it cannot serve) is named
//      on the member's disclosure strip, yet it was graded `notDrawn` ("our door carried
//      nothing for it"): the wrong label, and the name lost.
//   2. `compare.mjs::comparePaints` counted `withheld` as DIFFERS when TradingView painted,
//      so such a capture stayed DIVERGE while its plots, refused by the same name, read
//      INCONCLUSIVE.
//
// The synthetic capture below borrows a committed capture's BARS and nothing else; its
// script and its paint record are written here, so no licence-held content is involved.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { loadCapture, HARNESS_DIR } from './harness'
import { runOurSide } from './ourSide'
import { gradePaints, bindWithheldPaintsOf, paintStripName } from './paintColours'
import { comparePaints } from '../../../../../../../tools/vendor_harness/compare.mjs'

const row = (state, extra = {}) => ({ id: `plot_${state}`, kind: 'bgcolor', title: null, state, ...extra })

describe('G5 — what a withheld paint means for the verdict (comparePaints)', () => {
  it('⭐ withheld WITH a reason, where TradingView painted: INCONCLUSIVE, and the reason is said', () => {
    const v = comparePaints({ rows: [row('withheld', { displayed: true, reason: '`bgcolor` (line 4) is not drawn: its colour reads `ADVN`' })], unpaired: [] })
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.withheld).toBe(1)
    expect(v.reason).toContain('withheld by name')
    expect(v.reason).toContain('its colour reads `ADVN`')
    expect(v.rows[0]).toMatchObject({ state: 'withheld', reason: expect.stringContaining('ADVN') })
  })

  it('beside agreeing paints it is still INCONCLUSIVE; beside a differing one the capture DIVERGEs', () => {
    expect(comparePaints({ rows: [row('agree'), row('withheld', { displayed: true, reason: 'x' })], unpaired: [] }).verdict).toBe('INCONCLUSIVE')
    expect(comparePaints({ rows: [row('differ'), row('withheld', { displayed: true, reason: 'x' })], unpaired: [] }).verdict).toBe('DIVERGE')
  })

  it('⛔ CONTROL — withheld with NO reason is not "by name": DIFFERS (fail closed)', () => {
    expect(comparePaints({ rows: [row('withheld', { displayed: true })], unpaired: [] }).verdict).toBe('DIVERGE')
    expect(comparePaints({ rows: [row('withheld', { displayed: true, reason: '  ' })], unpaired: [] }).verdict).toBe('DIVERGE')
  })

  it('⛔ CONTROL — an unnamed `notDrawn` where TradingView painted still DIFFERS', () => {
    expect(comparePaints({ rows: [row('notDrawn', { vendorPainted: 5 })], unpaired: [] }).verdict).toBe('DIVERGE')
  })

  it('a withheld paint TradingView does not draw either is counted, not graded', () => {
    const v = comparePaints({ rows: [row('agree'), row('withheld', { displayed: false, reason: 'x' })], unpaired: [] })
    expect(v.verdict).toBe('MATCH')
    expect(v.undrawn).toBe(1)
  })
})

describe('G5 — which paints the bind withheld BY NAME (bindWithheldPaintsOf)', () => {
  const def = { paints: [
    { kind: 'bgcolor', line: 4, colorMode: 'column:h1' },
    { kind: 'bgcolor', line: 5, colorMode: 'column:h2' },
    { kind: 'barcolor', line: 6, colorMode: '#ff0000' },
  ] }
  const err = { guard: 'pine:request', code: 'other-symbol:bare', message: 'This indicator reads `ADVN`: …' }
  const said = (line) => ({ code: 'other-symbol:bare', reason: `${paintStripName('bgcolor', line)} is not drawn: its colour reads \`ADVN\`` })

  it('⭐ a refused colour column AND a strip notice naming the paint: withheld, with the strip\'s reason', () => {
    expect(bindWithheldPaintsOf(def, { columnErrors: { h1: err }, notices: [said(4)] }))
      .toEqual([{ kind: 'bgcolor', line: 4, code: 'other-symbol:bare', reason: said(4).reason }])
  })

  it('⛔ fail closed — a refused column the strip does not name, or a notice naming ANOTHER paint, is not "by name"', () => {
    expect(bindWithheldPaintsOf(def, { columnErrors: { h1: err }, notices: [] })).toEqual([])
    expect(bindWithheldPaintsOf(def, { columnErrors: { h1: err }, notices: [said(5)] })).toEqual([])
    // `(line 4)` must not match `(line 41)`
    expect(bindWithheldPaintsOf({ paints: [{ kind: 'bgcolor', line: 41, colorMode: 'column:h1' }] },
      { columnErrors: { h1: err }, notices: [said(4)] })).toEqual([])
  })

  it('⛔ fail closed — a notice with no refused column, or a paint whose colour reads no column, names nothing', () => {
    expect(bindWithheldPaintsOf(def, { columnErrors: {}, notices: [said(4)] })).toEqual([])
    expect(bindWithheldPaintsOf(def, { columnErrors: { h1: err, h2: err }, notices: [{ reason: '`barcolor` (line 6) is not drawn' }] })).toEqual([])
  })
})

// ── the real member door, over a synthetic capture ────────────────────────────
// A script whose `bgcolor` reads a symbol no binding serves. TradingView (as far as this
// record says) shades every bar; our bind refuses the read by name (engine 56, #1264).
const SOURCE = [
  '//@version=5',
  'indicator("G5 paint reads a refused symbol")',
  'adv = request.security("ADVN", timeframe.period, close)',
  'plot(close, "Close")',
  'bgcolor(adv > 0 ? color.new(color.green, 80) : na, title = "Breadth Shading")',
].join('\n')

function syntheticCapture() {
  // the BARS of a committed RDDT 1D capture from the listing; everything else is ours
  const { capture: base } = loadCapture(path.join(HARNESS_DIR, 'rate-of-change-rddt-1d-2026-11-15.json'))
  const rows = base.bars.rows
  return {
    ...base,
    id: 'g5-synthetic-paint-reads-refused-symbol',
    source: { text: SOURCE },
    study: {
      title: 'G5', plots: [
        { id: 'plot_0', type: 'line', title: 'Close' },
        { id: 'plot_1', type: 'bg_colorer', palette: 'palette_0', title: 'Breadth Shading' },
      ],
      styleState: { plot_0: { color: '#2962ff', display: 4294967295 }, plot_1: { display: 4294967295, transparency: 80 } },
      palettes: { palette_0: { valToIndex: { 0: 0 }, colors: { 0: { color: '#4CAF50' } } } },
    },
    plotValues: { fields: ['time', 'plot_0', 'plot_1'], rows: rows.map((r) => [r[0], r[4], 0]) },
    objects: undefined,
  }
}

describe('G5 — the member door, end to end (needs the bind-time refusal of #1264)', () => {
  it('⭐ the paint reading the refused symbol is withheld BY NAME, with the strip\'s reason, and grades INCONCLUSIVE', () => {
    const capture = syntheticCapture()
    const ours = runOurSide(capture)
    expect(ours.ok).toBe(true)
    // non-vacuity: the vendor record shades bars, and our binder drew nothing for the paint
    const drawn = (ours.paints || []).find((p) => p.kind === 'bgcolor')
    expect(drawn && Array.isArray(drawn.colors) && drawn.colors.some((c) => c)).toBeFalsy()
    const grade = gradePaints(capture, ours)
    expect(grade.rows).toHaveLength(1)
    expect(grade.rows[0]).toMatchObject({ state: 'withheld', by: 'bind', reason: expect.stringMatching(/^`bgcolor` \(line \d+\) is not drawn: .*ADVN/) })
    const v = comparePaints(grade)
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toContain('ADVN')
  }, 120000)

  it('⛔ CONTROL — with the bind\'s list ignored, the same paint is the unnamed `notDrawn` and DIVERGEs', () => {
    const capture = syntheticCapture()
    const ours = { ...runOurSide(capture), bindWithheldPaints: [] }
    const grade = gradePaints(capture, ours)
    expect(grade.rows[0]).toMatchObject({ state: 'notDrawn' })
    expect(grade.rows[0].vendorPainted).toBeGreaterThan(0)
    expect(comparePaints(grade).verdict).toBe('DIVERGE')
  }, 120000)
})
