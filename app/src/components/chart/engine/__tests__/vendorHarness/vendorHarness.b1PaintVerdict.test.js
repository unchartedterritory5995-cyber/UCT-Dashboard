// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b1PaintVerdict.test.js
//
// ─── B1 (step 61) — paints JOIN the harness verdict, as C44 joined object colour ──
//
// Integrator ruling 2026-10-02: a capture whose `bgcolor` / `barcolor` differs from
// TradingView's — or that the door withholds by name — grades DIVERGE, ON by
// default. `verdictWithoutPaints` is the verdict exactly as it was before, so both
// numbers are read from one run; `VENDOR_HARNESS_PAINTS=0` (or `{paints: false}`)
// reproduces the old record byte for byte.
//
// ⭐ The state table lives ONCE, in `compare.mjs::comparePaints`; this rail pins
// what each state means, end to end on the real captures, and the option.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, paintsGraded, HARNESS_DIR } from './harness'
import { comparePaints, compareCapture, renderSummary } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { runOurSide } from './ourSide'

const load = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const HEAT = 'heat-map-seasons-rddt-1d-2026-09-28'
const ELLIOTT = 'elliott-wave-3-finder-v2-rddt-1d-2026-09-28'
const BTC = 'btc-charlie-trader-xo-macro-trend-scanner-rddt-1d-2026-09-30'

const row = (state, extra = {}) => ({ id: `plot_${state}`, kind: 'bgcolor', title: null, state, ...extra })

describe('B1 — what each paint state means for the verdict (comparePaints)', () => {
  it('agree / naBoth / hiddenBoth agree; differ / naDiffers / titleMismatch / hiddenVendorOnly / hiddenOursOnly differ', () => {
    for (const s of ['agree', 'naBoth', 'hiddenBoth']) {
      expect(comparePaints({ rows: [row(s)], unpaired: [] }).verdict, s).toBe('MATCH')
    }
    for (const s of ['differ', 'naDiffers', 'titleMismatch', 'hiddenVendorOnly', 'hiddenOursOnly']) {
      expect(comparePaints({ rows: [row('agree'), row(s)], unpaired: [] }).verdict, s).toBe('DIVERGE')
    }
  })

  it('⭐ a WITHHELD paint is a gap — DIVERGE — unless TradingView does not draw it either', () => {
    const shown = comparePaints({ rows: [row('withheld', { displayed: true, reason: 'x' })], unpaired: [] })
    expect(shown.verdict).toBe('DIVERGE')
    expect(shown.reason).toContain('withheld')
    const hidden = comparePaints({ rows: [row('withheld', { displayed: false, reason: 'x' })], unpaired: [] })
    expect(hidden.verdict).toBe(null)
    expect(hidden.undrawn).toBe(1)
  })

  it('⭐ notDrawn: DIVERGE where TradingView painted a bar; counted, NOT graded, where it painted none', () => {
    expect(comparePaints({ rows: [row('notDrawn', { vendorPainted: 3 })], unpaired: [] }).verdict).toBe('DIVERGE')
    const none = comparePaints({ rows: [row('agree'), row('notDrawn', { vendorPainted: 0 })], unpaired: [] })
    expect(none.verdict).toBe('MATCH')
    expect(none.undrawn).toBe(1)
    expect(none.reason).toContain('neither side draws not graded (plot_notDrawn)')
  })

  it('an unpaired count is DIVERGE; an unreadable capture is not graded; nothing on either side is no row', () => {
    const up = comparePaints({ rows: [], unpaired: [{ kind: 'bgcolor', vendor: 1, ours: 0 }] })
    expect(up.verdict).toBe('DIVERGE')
    expect(up.reason).toContain('bgcolor: TradingView 1, ours 0')
    expect(comparePaints({ rows: [row('vendorUnreadable')], unpaired: [] }).verdict).toBe(null)
    expect(comparePaints({ rows: [], unpaired: [] })).toBe(null)
    expect(comparePaints({ rows: [], unpaired: [], refused: 'x' })).toBe(null)
    expect(comparePaints(null)).toBe(null)
  })

  it('⛔ FAIL CLOSED — a state the table does not name throws, never reads as agreeing', () => {
    expect(() => comparePaints({ rows: [row('somethingNew')], unpaired: [] })).toThrow(/unknown paint state/)
  })
})

describe('B1 — the verdict on the real captures', () => {
  it('⭐ heat-map-seasons — its withheld `barcolor` counts as a GAP in the verdict, named', () => {
    const { verdict } = gradeCapture(load(HEAT))
    expect(verdict.paints.verdict).toBe('DIVERGE')
    expect(verdict.paints.reason).toMatch(/barcolor plot_0 "Bar Color" withheld/)
    // it already diverged on its plots, so the overall verdict does not move
    expect(verdict.verdict).toBe('DIVERGE')
    expect(verdict.verdictWithoutPaints).toBe('DIVERGE')
  }, 120000)

  it('btc-charlie — three paints neither side draws are counted, not graded, and do not move a MATCH', () => {
    const { verdict } = gradeCapture(load(BTC))
    expect(verdict.paints.verdict).toBe('MATCH')
    expect(verdict.paints.undrawn).toBe(3)
    expect(verdict.verdict).toBe('MATCH')
    expect(verdict.verdictWithoutPaints).toBe('MATCH')
  }, 120000)

  it('⭐⭐ a paint that differs MOVES a MATCH to DIVERGE, and `verdictWithoutPaints` keeps the old one', () => {
    // elliott-wave grades MATCH with two agreeing paints; the same record with one
    // paint reported differing must flip — the join is real, not decorative.
    const capture = load(ELLIOTT)
    const ours = runOurSide(capture)
    const integrity = validateCapture(capture)
    const clean = compareCapture(capture, ours, { integrity, paints: { rows: [row('agree')], unpaired: [] } })
    expect(clean.verdict).toBe('MATCH')
    const moved = compareCapture(capture, ours, { integrity, paints: { rows: [row('agree'), row('differ')], unpaired: [] } })
    expect(moved.verdict).toBe('DIVERGE')
    expect(moved.verdictWithoutPaints).toBe('MATCH')
    expect(moved.reason).toMatch(/diverge/)
  }, 120000)
})

describe('B1 — the option: paints off is the verdict as it was, byte for byte', () => {
  it('ON by default; an explicit option wins over the environment; `VENDOR_HARNESS_PAINTS=0` turns a run off', () => {
    expect(paintsGraded()).toBe(true)
    expect(paintsGraded({ paints: false })).toBe(false)
    vi.stubEnv('VENDOR_HARNESS_PAINTS', '0')
    try {
      expect(paintsGraded()).toBe(false)
      expect(paintsGraded({ paints: true })).toBe(true)
    } finally {
      vi.stubEnv('VENDOR_HARNESS_PAINTS', '')
    }
    expect(paintsGraded()).toBe(true)
  })

  it('⭐ off reproduces the record without paints; on carries `verdictWithoutPaints` equal to it', () => {
    for (const id of [HEAT, ELLIOTT]) {
      const capture = load(id)
      const on = gradeCapture(capture).verdict
      const off = gradeCapture(capture, { paints: false }).verdict
      expect(off).not.toHaveProperty('paints')
      expect(off).not.toHaveProperty('verdictWithoutPaints')
      expect(on.verdictWithoutPaints, id).toBe(off.verdict)
      // everything but the paint row, the paint verdict and the reason is the old record
      const strip = ({ paints, verdictWithoutPaints, verdict, reason, ...rest }) => rest // eslint-disable-line no-unused-vars
      expect(strip(on), id).toEqual(strip(off))
    }
  }, 180000)

  it('the summary prints both totals and names every capture a paint moved', () => {
    const table = renderSummary([
      { id: 'a', verdict: 'DIVERGE', verdictWithoutPaints: 'MATCH', plots: [] },
      { id: 'b', verdict: 'MATCH', verdictWithoutPaints: 'MATCH', plots: [] },
      { id: 'c', verdict: 'INCONCLUSIVE', plots: [] },
    ])
    expect(table).toContain('TOTAL 3 captures — MATCH 1 · DIVERGE 1 · INCONCLUSIVE 1')
    expect(table).toContain('WITHOUT PAINTS (the verdict before B1; paints graded on 2 captures) — MATCH 2 · DIVERGE 0 · INCONCLUSIVE 1')
    expect(table).toContain('CHANGED BY PAINTS (1): a MATCH → DIVERGE')
  })
})
