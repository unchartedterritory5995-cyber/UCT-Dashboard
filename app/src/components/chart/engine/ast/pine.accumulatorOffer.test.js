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

// ─── ⛔⛔ R-F — THE SHIPPED DEFECT, FIXED (owner ruling, 2026-09-12) ─────────
//
// ⚰️ A BARE MONOTONE max/min ACCUMULATOR USED TO FOLD, SILENTLY, TO A 250-BAR ROLLING
// WINDOW. `forgetsItsSeed`'s min/max arm read `withSelf.length === 1 && ok(withSelf[0],
// true)`, and `ok` returns TRUE for bare `self` — so `max(self, y)` was declared
// seed-forgetting when a running max never forgets: the seed stands until something
// exceeds it. A member who wrote "the highest ever" got "the highest of the last 250
// bars", with ok:true, no refusal, no disclosure and no window shown.
//
// ⛔ SECOND INSTANCE OF THE OBV CLASS. The convergence gate cites the first — "a 250-bar
// ROLLING SUM presented as OBV" — and caught `+` while this arm admitted min/max.
//
// ⭐⭐ AND IT WAS NOT HYPOTHETICAL. Removing the arm moved TWO committed corpus scripts
// out of the passing set, and both are TRAILING STOPS built on a running max:
//   atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine  `math.max(nz(Trail1[1],0), SC - SL1)`
//   supertrend-explorer__V4MsmtCeKs.pine          `max(up, up1)` / `min(dn, dn1)`
// They were passing ON the silent fold, so they were passing WRONG — a trailing stop
// computed over a rolling 250 bars is a stop in the wrong place. Correct losses.
describe('R-F — a bare monotone accumulator REFUSES, and says what to write instead', () => {
  const maxSrc = 'var float m = na\nif bar_index > 0\n    m := math.max(m, volume)\nplot(m)'
  const minSrc = 'var float m = na\nif bar_index > 0\n    m := math.min(m, volume)\nplot(m)'

  it('⛔ `max` refuses — it used to fold to accum(…, 250) with ok:true', () => {
    const r = host(maxSrc)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:state')
    expect(r.message).toContain('BOUNDED FORM')
    expect(r.message).toContain('highest(<that value>, <bars>)')
  })

  it('⛔ `min` likewise, and through the SAME door with the SAME wording', () => {
    const r = host(minSrc)
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:state')
    expect(r.message).toContain('lowest(<that value>, <bars>)')
    // One message, one door: the sentence a member reads here is the one Volume:284
    // reads, differing only in which bounded call it names.
    expect(r.message).toContain('Stating the window is what makes the answer the same tomorrow')
  })

  it('⭐ CONTROL: a CONTRACTING recurrence still folds to `accum` WITH its window', () => {
    // The family `forgetsItsSeed` exists to admit, and the one thing R-F must not break:
    // an EMA-shaped `self * k + x * (1-k)` really does forget its seed.
    const r = translatePine(`${H}var float e = 0.0\nif bar_index > 0\n    e := e * 0.9 + close * 0.1\nplot(e)\n`,
      { strict: true })
    expect(r.ok).toBe(true)
    const out = (r.outputs || []).find((o) => o.refusal === null)
    expect(out.formula).toBe('accum(0, barindex > 0 ? self * 0.9 + close * 0.1 : self, 250)')
    expect(out.formula).toContain('250')
  })

  it('⭐ CONTROL: an explicit-window call still translates untouched', () => {
    const r = translatePine(`${H}plot(ta.highest(volume, 2500))\n`, { strict: true })
    expect(r.ok).toBe(true)
    const out = (r.outputs || []).find((o) => o.refusal === null)
    expect(out.formula).toBe('highest(volume, 2500)')
  })

  it('⚠️ the DECAYING max is refused too — a named, deliberate over-refusal', () => {
    // `max(self * 0.9, close)` genuinely does forget, and it refuses now. The safe
    // direction: a refusal a member can read beats a plausible wrong number. One line
    // narrows it if a real script ever writes one — no corpus script does.
    const r = host('var float m = na\nif bar_index > 0\n    m := math.max(m * 0.9, close)\nplot(m)')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:state')
  })
})
