// 🔴 THE ARGUMENT-ROLE RAIL.
//
// ⭐⭐ THIS FILE EXISTS BECAUSE THE THING IT MEASURES WAS ALREADY WRONG.
// `closedTable.json` declares what KIND each argument is — `["series", "series",
// "series", "int"]` — and never what ROLE it plays. Pine's
// `ta.stoch(source, high, low, length)` and this table's `stoch(h, l, c, n)`
// therefore have the same name, the same arity and the same argument kinds, and
// mapping them position-for-position produced a plausible number, a plausible
// English read-back and an answer WRONG BY 126 POINTS on a 0-100 oscillator.
//
// ⛔ NO STATIC CHECK COULD HAVE CAUGHT THAT, AND THAT IS THE POINT. The tree was
// canonical, the budget passed, the repaint linter said `non-repainting` and the
// sentence read perfectly. The only evidence that distinguishes a right
// permutation from a wrong one is the NUMBER, so this file computes Pine's own
// published definition independently and compares.
//
// ⛔ THE BARS ARE DELIBERATELY ASYMMETRIC. High, low and close are all different
// and none is a monotone function of another — on bars where `h == l == c` every
// permutation agrees and this whole file would pass vacuously.
//
// ⚠️ THE DEFAULT IS REFUSAL, SO THIS FILE IS SHORT BY DESIGN. A table function
// with more than one price argument and no entry in `PINE_CALL_SHAPES` refuses at
// `pine:role-order`; only the entries measured here are ever mapped. A function
// the indicator agent adds tomorrow lands in the refusing branch, not in a guess.

import { describe, it, expect } from 'vitest'
import { interpret } from './interpret.js'
import { parseFormula, TABLE } from './parse.js'
import { translatePine, PINE_INEXPRESSIBLE, PINE_CALL_SHAPES } from './pine.js'

const N = 60

/** Asymmetric bars. `(i % 5)` and `(i % 3)` push high and low around by
 *  different, non-monotone amounts, and the close wanders inside the range. */
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + Math.sin(i / 3) * 10 + i * 0.4
  return {
    t: i,
    o: base - 1,
    h: base + 3 + (i % 5),
    l: base - 4 - (i % 3),
    c: base + ((i % 7) - 3) * 0.5,
    v: 1000 + i * 13,
  }
})

const H = BARS.map((b) => b.h)
const L = BARS.map((b) => b.l)
const C = BARS.map((b) => b.c)

const BUDGET = { maxNodes: 512, maxLookback: 500, maxSeriesRefs: 64 }

/** Evaluate a UCT formula on those bars, through the shipped doors. */
function run(src) {
  const parsed = parseFormula(src)
  expect(parsed.ok, `${src} :: ${parsed.error}`).toBe(true)
  return interpret(parsed.ast, BARS, {}, BUDGET)
}

/** Translate Pine and evaluate whatever single output it offers. */
function runPine(script) {
  const out = translatePine(script)
  const chosen = out.outputs[out.selected]
  expect(chosen && chosen.formula, JSON.stringify(out.refusal)).toBeTruthy()
  return { formula: chosen.formula, values: run(chosen.formula) }
}

/** Largest absolute difference over the bars where BOTH are defined, and how
 *  many that was. ⛔ THE COUNT IS RETURNED SO A CASE CANNOT PASS ON ZERO
 *  COMPARISONS — a warmup that swallowed every bar would otherwise read as a
 *  perfect match. */
function agree(want, got) {
  let compared = 0
  let worst = 0
  for (let i = 0; i < N; i += 1) {
    const a = want[i]
    const b = got[i]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    compared += 1
    worst = Math.max(worst, Math.abs(a - b))
  }
  return { compared, worst }
}

const wrap = (title, body) => `//@version=5\nindicator("${title}")\nplot(${body})\n`

// --------------------------------------------------------------------------- //
// Pine's own published definitions, re-implemented here and nowhere else
// --------------------------------------------------------------------------- //

function rollingHiLo(n) {
  const hi = new Array(N).fill(NaN)
  const lo = new Array(N).fill(NaN)
  for (let i = n - 1; i < N; i += 1) {
    let a = -Infinity
    let b = Infinity
    for (let j = i - n + 1; j <= i; j += 1) { a = Math.max(a, H[j]); b = Math.min(b, L[j]) }
    hi[i] = a
    lo[i] = b
  }
  return { hi, lo }
}

/** `ta.stoch(source, high, low, length)`
 *  = 100 * (source - lowest(low, length)) / (highest(high, length) - lowest(low, length)) */
function pineStoch(source, n) {
  const { hi, lo } = rollingHiLo(n)
  return Array.from({ length: N }, (_, i) => (100 * (source[i] - lo[i])) / (hi[i] - lo[i]))
}

/** `ta.wpr(length)`
 *  = 100 * (close - highest(high, length)) / (highest(high, length) - lowest(low, length)) */
function pineWpr(n) {
  const { hi, lo } = rollingHiLo(n)
  return Array.from({ length: N }, (_, i) => (100 * (C[i] - hi[i])) / (hi[i] - lo[i]))
}

// --------------------------------------------------------------------------- //

describe('the argument roles this translator assumes are the roles the engine runs', () => {
  it('ta.stoch(source, high, low, len) permutes onto stoch(high, low, source, len)', () => {
    const { formula, values } = runPine(wrap('s', 'ta.stoch(close, high, low, 14)'))
    // The permutation, spelled out, so a change to it changes this line.
    expect(formula).toBe('stoch(high, low, close, 14)')
    const { compared, worst } = agree(pineStoch(C, 14), values)
    expect(compared).toBeGreaterThan(20)
    expect(worst).toBeLessThan(1e-9)
  })

  it('...and the VERBATIM order is wrong, which is why the permutation exists', () => {
    // ⭐⭐ THE CONTROL. Without this the case above is satisfiable by an engine
    // in which every permutation agrees, and the bug it was written for would
    // have been invisible. Measured: the verbatim order is out by ~126 on a
    // 0-100 oscillator.
    const verbatim = run('stoch(close, high, low, 14)')
    const { compared, worst } = agree(pineStoch(C, 14), verbatim)
    expect(compared).toBeGreaterThan(20)
    expect(worst).toBeGreaterThan(1)
  })

  it('ta.wpr(len) fills high, low and close and lands exactly on williamsR', () => {
    const { formula, values } = runPine(wrap('w', 'ta.wpr(14)'))
    expect(formula).toBe('williamsR(high, low, close, 14)')
    const { compared, worst } = agree(pineWpr(14), values)
    expect(compared).toBeGreaterThan(20)
    expect(worst).toBeLessThan(1e-9)
  })

  it('ta.crossover(a, b) keeps Pine order — a above b, never b above a', () => {
    const up = runPine(wrap('c', 'ta.crossover(close, ta.sma(close, 10))'))
    expect(up.formula).toBe('crossOver(close, sma(close, 10))')
    const down = run('crossOver(sma(close, 10), close)')
    // ⛔ THE CONTROL AGAIN: the two orders must actually differ on these bars, or
    // "we kept the order" is a claim nothing could falsify.
    const differs = up.values.some((v, i) => Number.isFinite(v)
      && Number.isFinite(down[i]) && v !== down[i])
    expect(differs).toBe(true)
    // And the mapped one is the one that fires when close crosses ABOVE the mean.
    const fired = []
    for (let i = 1; i < N; i += 1) if (up.values[i] === 1) fired.push(i)
    expect(fired.length).toBeGreaterThan(0)
    const mean = run('sma(close, 10)')
    for (const i of fired) {
      expect(C[i]).toBeGreaterThan(mean[i])
      expect(C[i - 1]).toBeLessThanOrEqual(mean[i - 1])
    }
  })

  it('math.min / math.max are order-insensitive, measured rather than assumed', () => {
    const a = run('min(close, open)')
    const b = run('min(open, close)')
    expect(a.length).toBe(b.length)
    let compared = 0
    for (let i = 0; i < N; i += 1) {
      if (!Number.isFinite(a[i])) continue
      compared += 1
      expect(a[i]).toBe(b[i])
    }
    expect(compared).toBeGreaterThan(20)
  })
})

describe('the fail-closed default', () => {
  it('every multi-series table function without a measured order REFUSES', () => {
    // ⭐ DERIVED FROM THE MANIFEST, so a function added tomorrow is covered.
    const measured = new Set(Object.values(PINE_CALL_SHAPES)
      .map((s) => s.table.toLowerCase().replace(/_/g, '')))
    const multi = Object.entries(TABLE.functions)
      .filter(([, spec]) => (spec.args || []).filter((a) => a === 'series').length > 1)
      .map(([key]) => key)
      .filter((key) => !measured.has(key.toLowerCase().replace(/_/g, '')))

    expect(multi.length).toBeGreaterThan(0)
    for (const key of multi) {
      const arity = TABLE.functions[key].args.length
      const args = Array.from({ length: arity }, (_, i) => (
        TABLE.functions[key].args[i] === 'int' ? '14' : 'close')).join(', ')
      const out = translatePine(wrap('m', `ta.${key}(${args})`))
      expect(out.ok, `ta.${key} translated without a measured argument order`).toBe(false)
      // ⭐ THE INVARIANT IS FAIL-CLOSED, NOT ONE GUARD NAME. A function this door
      // refuses for a MORE SPECIFIC published reason still satisfies it — and a
      // more specific reason is strictly better for the member.
      //
      // ⚰️ `valuewhen` IS THE CASE THAT FORCED THE DISTINCTION. It has two `series`
      // slots and no measured order, so it landed here and reported "this table
      // states what kind each argument is and never what role it plays" — a
      // sentence that is FALSE of it, since the manifest declares
      // `argRoles: [condition, source, period]`. Worse, it sent a reader to supply
      // a role order, and the positions line up perfectly: Pine's third argument
      // counts OCCURRENCES and this table's counts BARS, so the "fix" would have
      // built cleanly and answered a different number. It is in
      // `PINE_INEXPRESSIBLE` now and refuses by naming that difference.
      const inexpressible = Object.prototype.hasOwnProperty.call(PINE_INEXPRESSIBLE, key)
      expect(out.refusal.guard, `ta.${key}`)
        .toBe(inexpressible ? 'pine:function' : 'pine:role-order')
    }
    // ⛔ AND THE SPLIT IS NOT VACUOUS IN EITHER DIRECTION — a roster that swallowed
    // every multi-series name would make the fail-closed default untestable.
    expect(multi.some((k) => Object.prototype.hasOwnProperty.call(PINE_INEXPRESSIBLE, k)),
      'no multi-series name is on the inexpressible roster — this branch is dead').toBe(true)
    expect(multi.some((k) => !Object.prototype.hasOwnProperty.call(PINE_INEXPRESSIBLE, k)),
      'EVERY multi-series name is inexpressible — the role-order default is dead').toBe(true)
  })

  it('a shape that no longer fits the manifest refuses instead of filling what it can', () => {
    const shrunk = {
      ...TABLE,
      functions: { ...TABLE.functions, stoch: { args: ['series', 'int'], lookback: 'arg1', yields: 'num' } },
    }
    const out = translatePine(wrap('s', 'ta.stoch(close, high, low, 14)'), { table: shrunk })
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:role-order')
    expect(out.refusal.message).toContain('4 positions')
  })
})
