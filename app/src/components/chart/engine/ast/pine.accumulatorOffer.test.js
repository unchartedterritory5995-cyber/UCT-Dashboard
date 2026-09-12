// ─── ⛔⛔ R-A2 — THE ACCUMULATOR REFUSAL NAMES THE BOUNDED FORM ───────────────
//
// Owner ruling R-A2 (2026-09-12) asked for an unbounded `var` accumulator to FOLD in the
// host lane, anchored at the fetch window's start, and set a stop condition: build it
// only if `maxLookback` stays a plan-time constant and the repaint verdict stays
// decidable before the tree runs.
//
// ⛔⛔ THE STOP CONDITION FIRED, AND THE MEASUREMENT IS THE REASON. Taken against this
// engine's own already-shipped unbounded accumulator:
//
//     cum(volume)            maxLookback = 0      repaint = repaints
//                                                 "unanalysable: `cum` declares a window
//                                                  this linter cannot bound"
//     accum(0, volume, 250)  maxLookback = 250    repaint = non-repainting, back 250
//     highest(volume, 250)   maxLookback = 250    repaint = non-repainting, back 250
//     highest(volume, 5000)  maxLookback = 5000   repaint = non-repainting, back 5000
//
// An unbounded form is undecidable in BOTH dimensions today, and it under-claims its
// lookback as 0 — which `maxLookback`'s own comment calls the one direction a budget
// must never fail in, because it hands back numbers computed from bars never fetched. A
// STATED window is fully decidable. So the only decidable fold is one that picks the
// member's window for them, which is the exact trade the `cum` ruling refuses.
//
// ⭐ The pre-authorised fallback was the hand-back, and this is it: the refusal stands
// and NAMES the bounded call, with the window left where it belongs.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const H = '//@version=6\nindicator("t")\n'
const REPO = path.resolve(process.cwd(), '..')
const host = (body) => {
  const r = translatePine(`${H}${body}\n`, { strict: true })
  const x = (r.refusals || [])[0] || {}
  return { ok: !!r.ok, guard: x.guard || null, message: String(x.message || '') }
}

describe('an unbounded accumulator refuses, and the refusal names the bounded form', () => {
  it('⭐ a running SUM is told about `cumFrom`', () => {
    const r = host('var float s = 0.0\nif bar_index > 0\n    s := s + volume\nplot(s)')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:state')
    expect(r.message).toContain('cumFrom')
    expect(r.message).toContain('BOUNDED FORM')
  })

  it('⭐ and the member is told WHY a window is the point, not just that one is needed', () => {
    const r = host('var float s = 0.0\nif bar_index > 0\n    s := s + volume\nplot(s)')
    // The sentence has to carry the reason: an all-time value moves with the fetch.
    expect(r.message).toMatch(/same tomorrow/)
    expect(r.message).toMatch(/however many bars were fetched/)
  })

  it('⛔ CONTROL: a NON-monotone accumulator refuses with NO offer', () => {
    // `x := x * y` has no bounded equivalent in this table, so naming one would be an
    // offer that does not work — worse than silence. This is the creep guard: the day
    // somebody widens the detector, this goes red.
    const r = host('var float m = 1.0\nif bar_index > 0\n    m := m * volume\nplot(m)')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:state')
    expect(r.message).not.toContain('BOUNDED FORM')
  })

  it('⛔ CONTROL: `max(self, self)` is not a fold over an operand and gets no offer', () => {
    // Two self operands is not "the highest of this series"; it is a no-op the member
    // probably did not mean, and `highest` would be the wrong sentence for it.
    const r = host('var float m = na\nif bar_index > 0\n    m := math.max(m, m)\nplot(m)')
    expect(r.message).not.toContain('BOUNDED FORM')
  })

  it('⭐⭐ the real member script gets it, through an `na`-guarded ternary', () => {
    // `uncharted-volume.pine:292` is
    //   priorMaxAllTimeDaily := na(priorMaxAllTimeDaily) ? volD[1] : math.max(…, volD[1])
    // so the fold sits one level below a conditional. A shape match missed it; the walk
    // finds it. Without this the one script this ruling is about would get no offer.
    const src = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-volume.pine'), 'utf8')
    const r = translatePine(src, { strict: true })
    const x = (r.refusals || [])[0] || {}
    expect(r.ok).toBe(false)
    expect(x.guard).toBe('pine:state')
    expect(x.line).toBe(284)
    expect(String(x.message)).toContain('highest(<that value>, <bars>)')
  })
})

// ─── ⚠️⚠️ THE FINDING THIS RULING UNCOVERED, PINNED SO IT CANNOT BE LOST ──────
//
// A BARE monotone max/min accumulator does NOT refuse — it folds, to a 250-bar rolling
// window, and has done since the convergence gate shipped. `forgetsItsSeed` admits
// `min`/`max` against a self-free operand because they "forget once that operand
// dominates", which is true about the SEED and silent about the WINDOW: `accum` re-seeds
// `PINE_STATE_WARMUP` bars back, so the column answers "the highest of the last 250
// bars" to a member who wrote "the highest ever".
//
// ⛔ THAT IS THE SAME DEFECT THE CONVERGENCE GATE WAS BUILT FOR — its own comment cites
// "a 250-bar ROLLING SUM presented as OBV, on every bar, drawing a line nobody would
// question". The gate caught `+` and admitted `max`/`min`.
//
// ⚠️ NOT CHANGED HERE. Refusing it would be member-visible on every shipped definition
// that uses the shape, so it is the owner's call, routed with this measurement. These
// tests PIN the current behaviour so the decision is made deliberately rather than
// discovered later.
describe('⚠️ ROUTED: a bare monotone accumulator folds to a ROLLING window today', () => {
  it('pins it — `max` folds to accum(…, 250), not to an all-time high', () => {
    const r = translatePine(`${H}var float m = na\nif bar_index > 0\n    m := math.max(m, volume)\nplot(m)\n`,
      { strict: true })
    expect(r.ok).toBe(true)
    const out = (r.outputs || []).find((o) => o.refusal === null)
    expect(out.formula).toBe('accum(0 / 0, barindex > 0 ? max(self, volume) : self, 250)')
    // ⛔ THE NUMBER IS THE POINT: 250 is a window, and the member asked for all of time.
    expect(out.formula).toContain('250')
  })

  it('pins `min` the same way', () => {
    const r = translatePine(`${H}var float m = na\nif bar_index > 0\n    m := math.min(m, volume)\nplot(m)\n`,
      { strict: true })
    expect(r.ok).toBe(true)
    const out = (r.outputs || []).find((o) => o.refusal === null)
    expect(out.formula).toBe('accum(0 / 0, barindex > 0 ? min(self, volume) : self, 250)')
  })
})
