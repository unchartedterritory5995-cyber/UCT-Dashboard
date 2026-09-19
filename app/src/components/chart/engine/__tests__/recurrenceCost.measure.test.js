// app/src/components/chart/engine/__tests__/recurrenceCost.measure.test.js
//
// ─── C2A.5: WHAT A RECURRENCE STEP ACTUALLY COSTS ───────────────────────────
//
// A MEASUREMENT. The budget policy cannot be set without it.
//
// Two constants meet here and NEITHER is arbitrary:
//
//   `PINE_STATE_WARMUP = 250`   — one trading year. A translated Pine `var` is
//        bounded on purpose: Pine accumulates from the first bar the chart ever
//        loaded, and a value that depends on where a fetch happened to start
//        changes when a member pans. 250 is where the two agree for what real
//        scripts accumulate.
//   `MAX_RECURRENCE_STEPS = 1e6` — the work ceiling, checked as `bars × warmup`
//        where the bar count is finally known.
//
// ⛔ THEIR PRODUCT IS THE PROBLEM, AND NOBODY CHOSE IT. 250 × 5,000 = 1,250,000,
// so on the 5,000-bar window a chart loads, EVERY translated Pine `var` refuses —
// trailing stops, streaks, flip states, the whole class. The break-even is 4,000
// bars. That interaction is what this file measures, so that any change to either
// number is evidence-based rather than "make the failing script pass".
import { describe, it, expect } from 'vitest'
import { interpret, MAX_RECURRENCE_STEPS } from '../ast/interpret'
import { DEFAULT_BUDGET } from '../ast/budget'
import { fullBarsFor } from '../../../../utils/barsBackfill'

const bars = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1500000000 + i * 86400, o: 100, h: 101, l: 99, c: 100 + Math.sin(i / 7) * 5, v: 1000,
}))

const SERIES = (name) => ({ type: 'series', name })
const NUM = (v) => ({ type: 'num', value: v })

/** The shape a translated Pine `var` takes: `accum(seed, update, warmup)`. */
const accum = (warmup) => ({
  type: 'call',
  name: 'accum',
  args: [
    NUM(0),
    { type: 'op', name: '?:', args: [
      { type: 'op', name: '>', args: [SERIES('close'), SERIES('open')] },
      NUM(1),
      SERIES('self'),
    ] },
    NUM(warmup),
  ],
})

describe('C2A.5 — the real cost of a recurrence, per step', () => {
  it('ms against steps, below the ceiling', () => {
    const rows = []
    // Each pair is under 1e6 so it RUNS; the ratio is what extrapolates.
    for (const [n, warmup] of [[1000, 250], [2000, 250], [3000, 250], [3900, 250],
      [5000, 190], [2000, 480]]) {
      const steps = n * warmup
      const B = bars(n)
      const tree = accum(warmup)
      // One warm pass, then the measured one.
      try { interpret(tree, B, {}, DEFAULT_BUDGET) } catch { /* below-ceiling by construction */ }
      const t0 = Date.now()
      let ok = true
      try { interpret(tree, B, {}, DEFAULT_BUDGET) } catch { ok = false }
      const ms = Date.now() - t0
      rows.push({ n, warmup, steps, ms, ok, nsPerStep: steps ? (ms * 1e6) / steps : 0 })
    }
    const ran = rows.filter((r) => r.ok)
    const nsPerStep = ran.length
      ? ran.reduce((a, r) => a + r.nsPerStep, 0) / ran.length : 0
    const msFor = (steps) => Math.round((steps * nsPerStep) / 1e6)
    // eslint-disable-next-line no-console
    console.log('\n=== C2A.5 RECURRENCE COST ===\n'
      + rows.map((r) => `  ${String(r.n).padStart(5)} bars × ${String(r.warmup).padStart(3)} warmup `
        + `= ${String(r.steps).padStart(9)} steps  ${r.ok ? `${String(r.ms).padStart(4)}ms` : 'REFUSED'}`).join('\n')
      + `\n\n  mean ~${nsPerStep.toFixed(1)} ns/step`
      + `\n  current ceiling ${MAX_RECURRENCE_STEPS} steps  ~= ${msFor(MAX_RECURRENCE_STEPS)}ms`
      + `\n  a 5,000-bar chart with a 250 warmup = 1,250,000 steps ~= ${msFor(1250000)}ms`
      + `\n  break-even bar count at warmup 250 = ${Math.floor(MAX_RECURRENCE_STEPS / 250)} bars`)
    expect(ran.length).toBeGreaterThan(2)
    // ⚰⚰ THE INVARIANT HERE USED TO BE THE OPPOSITE, AND IT WAS THE DEFECT.
    // It read: *"the ceiling and the warm-up together put the break-even BELOW
    // the 5,000 bars a chart loads. That is the whole finding."* It was a true
    // measurement of a ceiling that was too low, written down as a policy — and
    // what it described in practice was `uncharted-volume-v2.pine` drawing `NaN`
    // in every dashboard cell on SPY 1D, the timeframe a chart opens on.
    //
    // ⭐ R-Q INVERTED IT ON A DERIVATION (`recurrenceSteps.measure.test.js`): the
    // break-even must sit ABOVE the deepest depth a member can pan to, or a real
    // script refuses on a real chart. At the deepest real warm-up of 250 that is
    // 48,000 bars, against `fullBarsFor('30')` = 32,000 and `fullBarsFor('D')` =
    // 12,500. Arithmetic rather than timing, so it still cannot flake.
    const breakEven = Math.floor(MAX_RECURRENCE_STEPS / 250)
    expect(breakEven).toBe(48000)
    expect(breakEven).toBeGreaterThan(fullBarsFor('30'))
    expect(breakEven).toBeGreaterThan(fullBarsFor('D'))
  })

  it('⛔ the ceiling refuses BEFORE running — the refusal is not the cost', () => {
    // ⛔ THE SHAPE IS DERIVED, not the `5,000 × 250` this used to spell. That
    // product is 1.25e6 — over the OLD ceiling and a twelfth of the derived one,
    // so after R-Q this case measured a column that RAN while asserting it had
    // refused. The warm-up is now the grammar's own maximum and the depth is
    // whatever passes the ceiling by one step.
    const warm = DEFAULT_BUDGET.maxLookback
    const n = Math.ceil(MAX_RECURRENCE_STEPS / warm) + 1
    const t0 = Date.now()
    let guard = null
    try { interpret(accum(warm), bars(n), {}, DEFAULT_BUDGET) } catch (e) { guard = e.guard }
    const ms = Date.now() - t0
    expect(guard).toBe('interpret:steps')
    // ⭐ AND IT REALLY DID NOT RUN. `n × warm` steps at the measured ns/step would
    // take seconds; a refusal raised from a multiplication takes none, and that is
    // the property that makes containment affordable.
    expect(ms).toBeLessThan(1500)
    // eslint-disable-next-line no-console
    console.log(`
  refusal at ${n} × ${warm} took ${ms}ms (it never ran)`)
  })
})
