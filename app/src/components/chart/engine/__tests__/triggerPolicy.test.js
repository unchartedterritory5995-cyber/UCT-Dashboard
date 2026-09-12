import { describe, it, expect } from 'vitest'
import {
  TRIGGER_POLICIES, DEFAULT_POLICY, BOOLEAN_MIDPOINT,
  exposedPolicies, compilePolicy, policyOf,
} from '../triggerPolicy'
import { COND_TRUE, COND_FALSE, COND_UNKNOWN } from '../conditions'

// ⭐ A MIRROR, DECLARED AS ONE. This is `api/services/alert_conditions.check_condition`
// re-expressed in JS so the edge semantics can be exercised against a column in a
// unit test. It is NOT the authority and nothing ships against it — the Python
// function is the authority, its oracles are 5,040 recorded pairs plus 691,195
// frozen fires, and `triggerPolicy.parity.py` runs THAT function over these same
// vectors. What this mirror proves is the only thing this module decides: that
// `cross_above` @ 0.5 is the right NAME for "Becomes True".
const checkCondition = (condition, current, prev, threshold) => {
  if (current === null) return false
  if (condition === 'cross_above') return prev !== null && prev <= threshold && current > threshold
  if (condition === 'cross_below') return prev !== null && prev >= threshold && current < threshold
  return false
}

/** Fire the compiled policy across a condition column, the way the closed lane does. */
const firesOn = (policyId, column) => {
  const { condition, threshold } = compilePolicy(policyId)
  const out = []
  for (let i = 0; i < column.length; i += 1) {
    const cur = column[i] === COND_UNKNOWN ? null : column[i]
    const prev = i === 0 || column[i - 1] === COND_UNKNOWN ? null : column[i - 1]
    if (checkCondition(condition, cur, prev, threshold)) out.push(i)
  }
  return out
}

describe('the vocabulary', () => {
  it('⭐ ONE policy is exposed today, and it is the default', () => {
    expect(exposedPolicies().map((p) => p.id)).toEqual(['becomes_true'])
    expect(TRIGGER_POLICIES[DEFAULT_POLICY].exposed).toBe(true)
  })

  it('⛔ every declared policy compiles to a condition the SHIPPED evaluator knows', () => {
    // The four the evaluator implements for a threshold comparison. A policy
    // compiling to anything else is an alert row the engine answers `False` to
    // forever — offered, armed, and structurally unable to fire.
    const KNOWN = ['above', 'below', 'cross_above', 'cross_below']
    for (const p of Object.values(TRIGGER_POLICIES)) {
      expect(KNOWN).toContain(p.condition)
    }
  })

  it('⭐ every policy has a member-facing label and blurb, and neither mentions 0.5', () => {
    for (const p of Object.values(TRIGGER_POLICIES)) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.blurb.length).toBeGreaterThan(0)
      expect(`${p.label} ${p.blurb}`).not.toMatch(/0\.5|threshold|cross_/)
    }
  })

  it('⛔ an undeclared policy compiles to NULL rather than a guess', () => {
    expect(compilePolicy('while_true')).toBe(null)
    expect(compilePolicy('every_true_bar')).toBe(null)
    expect(compilePolicy(undefined)).toBe(null)
  })

  it('⭐ becomes_true is cross_above at the midpoint', () => {
    expect(compilePolicy('becomes_true')).toEqual({ condition: 'cross_above', threshold: 0.5 })
    expect(BOOLEAN_MIDPOINT).toBe(0.5)
    // …and the midpoint genuinely splits the encoding it is asked about.
    expect(COND_FALSE).toBeLessThan(BOOLEAN_MIDPOINT)
    expect(COND_TRUE).toBeGreaterThan(BOOLEAN_MIDPOINT)
  })
})

describe('what "Becomes True" actually fires on', () => {
  const F = COND_FALSE, T = COND_TRUE, U = COND_UNKNOWN

  it('⭐⭐ exactly the bars where false → true, and no others', () => {
    //         0  1  2  3  4  5  6  7
    const col = [F, F, T, T, T, F, T, F]
    expect(firesOn('becomes_true', col)).toEqual([2, 6])
  })

  it('⛔ a run of trues fires ONCE — the edge, not the state', () => {
    expect(firesOn('becomes_true', [F, T, T, T, T, T])).toEqual([1])
  })

  it('⛔ a column that is true from the very first bar never fires', () => {
    // `prev is not None` — there is no bar before bar 0 to have been false on.
    expect(firesOn('becomes_true', [T, T, T])).toEqual([])
  })

  it('⛔⛔ UNKNOWN → TRUE IS NOT AN EDGE, and that is the comparator’s doing', () => {
    // Warm-up is the ordinary shape of a condition column: `packColumn` writes
    // UNKNOWN below the lookback. If unknown counted as false, every alert armed
    // on an ema(200) condition would fire on its first computable bar, for every
    // symbol, on the day it was created.
    expect(firesOn('becomes_true', [U, U, U, T, T])).toEqual([])
    // …and once it is genuinely false first, the real edge still fires.
    expect(firesOn('becomes_true', [U, U, F, T, T])).toEqual([3])
  })

  it('⛔ a gap in the middle does not manufacture an edge on the far side', () => {
    expect(firesOn('becomes_true', [F, T, U, T, T])).toEqual([1])
  })

  it('⭐ becomes_false is the exact mirror on the same column', () => {
    const col = [F, F, T, T, T, F, T, F]
    expect(firesOn('becomes_false', col)).toEqual([5, 7])
  })

  it('⭐ a column that never changes never fires, either way', () => {
    expect(firesOn('becomes_true', [F, F, F, F])).toEqual([])
    expect(firesOn('becomes_false', [T, T, T, T])).toEqual([])
  })
})

describe('reading a stored alert row back', () => {
  it('⭐ a row written by a policy reads back as that policy', () => {
    const row = compilePolicy('becomes_true')
    expect(policyOf(row).id).toBe('becomes_true')
    expect(policyOf(compilePolicy('becomes_false')).id).toBe('becomes_false')
  })

  it('⛔⛔ the SAME comparator at another threshold is NOT a boolean policy', () => {
    // `rsi > 70` written by hand is `cross_above` @ 70. Labelling that "Becomes
    // True" would tell a member their threshold alert was a boolean edge.
    expect(policyOf({ condition: 'cross_above', threshold: 70 })).toBe(null)
    expect(policyOf({ condition: 'above', threshold: 0.5 })).toBe(null)
    expect(policyOf(null)).toBe(null)
  })

  it('⭐ a stringified threshold still reads back — rows come from JSON', () => {
    expect(policyOf({ condition: 'cross_above', threshold: '0.5' }).id).toBe('becomes_true')
  })
})

describe('the trap this module sits next to', () => {
  it('⛔⛔ COND_UNKNOWN IS 2 — NUMERICALLY ABOVE THE MIDPOINT', () => {
    // The CHART's column is `{0, 1, 2}`: 2 is a third symbol, not a magnitude.
    // The WIRE's column is `{0.0, 1.0, None}` — `ast_interpret` pads warmup with
    // NaN and `alert_user_series` maps NaN → None at the boundary, which is what
    // `prev is not None` is written against.
    //
    // So the two encodings are NOT interchangeable, and the failure is silent in
    // the dangerous direction: feed a chart column to the comparator unmapped and
    // `0 → 2` reads as a crossing of 0.5, firing every alert on its first warm bar.
    expect(COND_UNKNOWN).toBeGreaterThan(BOOLEAN_MIDPOINT)
    const raw = [COND_FALSE, COND_UNKNOWN, COND_TRUE]
    const unmapped = []
    for (let i = 1; i < raw.length; i += 1) {
      if (raw[i - 1] <= BOOLEAN_MIDPOINT && raw[i] > BOOLEAN_MIDPOINT) unmapped.push(i)
    }
    expect(unmapped).toEqual([1])                             // ⚠️ the phantom fire
    expect(firesOn('becomes_true', raw)).toEqual([])          // …absent once mapped
  })
})
