// app/src/components/chart/engine/ast/pine.implicitBoolCast.test.js
//
// ─── ⭐⭐ A NUMBER IN A BOOL CONTEXT, BY PINE VERSION ────────────────────────
//
// TradingView's v6 migration guide, verbatim: "In Pine v5, values of "int" and
// "float" types can be implicitly cast to "bool" when an expression or function
// requires a boolean value. In such cases, `na`, `0`, or `0.0` are considered
// `false`, and any other value is considered `true`." — and in v6 a script "must
// explicitly cast a numeric value". The rule lives at `implicitBoolCast` in
// pine.js; its evidence status there is DOCUMENTED, NOT CAPTURED (the probe that
// would settle it is queued in docs/pine/capture-queue-2026-09-28.md).
//
// ⛔ THE ZERO BAR AND THE NA BAR ARE BOTH THE RAIL. A rail that only checked `na`
// would pass against `not na(x)` — which calls 0 TRUE — and one that only checked
// 0 would pass against the bare `&&` the door used to emit, which propagates `na`.
// Each fixture below walks all three values the cast distinguishes.
import { describe, it, expect } from 'vitest'
import { translatePine, conditionKindOf, implicitBoolCast, implicitBoolCastApplies, conditionNeverNa } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

/** close walks NaN → 0 → nonzero; open is a fixed nonzero so `close - open`
 *  is also na / nonzero / nonzero and `close * 1` is na / 0 / nonzero. */
const BARS = [
  { t: 20260101, o: 1, h: 9, l: 0, c: NaN, v: 1 },
  { t: 20260102, o: 1, h: 9, l: 0, c: 0, v: 1 },
  { t: 20260103, o: 1, h: 9, l: 0, c: 5, v: 1 },
]
const HEAD = { 4: '//@version=4\nstudy("t")\n', 5: '//@version=5\nindicator("t")\n', 6: '//@version=6\nindicator("t")\n' }
const NL = String.fromCharCode(10)
const tr = (v, body, opts = {}) => translatePine(`${HEAD[v] || ''}${body}\n`, { strict: true, ...opts })
const formulaOf = (t) => {
  expect(t.refusal, t.refusal && t.refusal.message).toBe(null)
  return t.outputs[t.selected].formula
}
const col = (f) => Array.from(interpret(parseFormula(f).ast, BARS, {}))
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) ? Number.isNaN(b[i]) : x === b[i]))

describe('v5: a numeric operand of and/or/not/?: is cast — na and 0 are false', () => {
  it('⭐⭐ `and`: na → false, 0 → false, nonzero → true', () => {
    const f = formulaOf(tr(5, 'plot(close and high > 0 ? 1 : 2)'))
    expect(f).toBe('close != 0 && high > 0 ? 1 : 2')
    expect(col(f)).toEqual([2, 2, 1])
  })

  it('⭐⭐ `not`: na → true (not false), 0 → true, nonzero → false', () => {
    const f = formulaOf(tr(5, 'plot(not close ? 1 : 2)'))
    expect(f).toBe('!(close != 0) ? 1 : 2')
    expect(col(f)).toEqual([1, 1, 2])
  })

  it('⭐⭐ `or` and a `?:` test take the same cast', () => {
    expect(col(formulaOf(tr(5, 'plot(close or low > 0 ? 1 : 2)')))).toEqual([2, 2, 1])
    const f = formulaOf(tr(5, 'plot(close ? 1 : 2)'))
    expect(f).toBe('close != 0 ? 1 : 2')
    expect(col(f)).toEqual([2, 2, 1])
  })

  it('⭐ an `if` chain folds to the same `?:` test, so it is cast too', () => {
    const f = formulaOf(tr(5, 'x = 0.0\nif close\n    x := 1\nelse\n    x := 2\nplot(x)'))
    expect(f).toMatch(/close != 0 \?/)
    expect(col(f)).toEqual([2, 2, 1])
  })

  it('⛔⛔ THE DISCRIMINATOR: the bare operator and `not na(x)` both give other answers', () => {
    // What the door emitted before — na PROPAGATES through `&&`.
    expect(same(col('close && high > 0 ? 1 : 2'), [NaN, 2, 1])).toBe(true)
    // The "plausible" reading pine.boolcast.test.js already rejects — 0 is TRUE.
    expect(col('!na(close) && high > 0 ? 1 : 2')).toEqual([2, 1, 1])
    // …and the cast is neither.
    expect(col('close != 0 && high > 0 ? 1 : 2')).toEqual([2, 2, 1])
  })

  it('⭐ a numeric CONSTANT folds to its truth value instead of printing `5 != 0`', () => {
    expect(formulaOf(tr(5, 'plot(5 and close > 0 ? 1 : 2)'))).toBe('close > 0 ? 1 : 2')
    // a fractional constant is true, and 0.0 is false — each then an identity
    expect(formulaOf(tr(5, 'plot(close > 0 and 0.5 ? 1 : 2)'))).toBe('close > 0 ? 1 : 2')
    expect(formulaOf(tr(5, 'plot(0.0 or close > 0 ? 1 : 2)'))).toBe('close > 0 ? 1 : 2')
  })

  it('⭐ a condition-role ARGUMENT is a bool context: `ta.valuewhen(pivot, …)` computes', () => {
    const f = formulaOf(tr(5, 'ph = ta.pivothigh(high, 2, 2)\nplot(ta.valuewhen(ph, high[2], 0))'))
    expect(f).toBe('valuewhenOccurrence(pivothigh(high, 2, 2)[2] != 0, high[2], 0)')
    // ⛔ The uncast tree is REFUSED at evaluation — `assertArgRoles` demands a 0/1
    // column — which is how a script that attached at the door still drew nothing.
    expect(() => col('valuewhenOccurrence(pivothigh(high, 2, 2)[2], high[2], 0)'))
      .toThrow(/condition argument must be a 0\/1 column/)
    expect(() => col(f)).not.toThrow()
  })

  it('⭐ an object guard is cast where it is WRAPPED — the `else` arm of `if <pivot>`', () => {
    // `if ph … else …`: the else arm's guard is `!(ph)`. Uncast, a pivot's `na`
    // made it `!na` = `na` = "did not fire" — the else arm never ran on the bars
    // where v5 runs it. The un-negated arm is left alone (value-neutral:
    // `evaluateObjects` already reads `na` and 0 as "did not fire").
    const body = 'ph = ta.pivothigh(high, 2, 2)\nif ph\n    label.new(bar_index, high, "H")\n'
      + 'else\n    label.new(bar_index, low, "L")\nplot(close)'
    const trees = (v) => JSON.stringify(translatePine(`${HEAD[v]}${body}\n`, { strict: true }).objects.trees)
    expect(trees(5)).toMatch(/"name":"!","args":\[\{"type":"op","name":"!=","args":\[\{"type":"offset"/)
    expect(trees(6)).not.toMatch(/"name":"!="/)
  })

  it('⭐ v4 `iff(cond, a, b)` casts its condition like the `?:` it expands to', () => {
    expect(formulaOf(tr(4, 'plot(iff(close, 1, 2))'))).toBe('close != 0 ? 1 : 2')
  })
})

describe('what is NOT cast', () => {
  it('⭐⭐ F2 — a BOOL operand of `and`/`or`/`not` that can be `na` is read AS A CONDITION (Q-NL), not cast as a number', () => {
    // ⚰️ This pinned "its warm-up `na` stays `na`". The Q-NL captures
    // (`rt3-na-logic` v5 / `-v4`, RDDT 1D) measured TradingView reading an `na`
    // operand of `and` / `or` / `not` as FALSE, the answer never `na` — so the
    // operand becomes `x != 0` (`interpret.js::pineBool` by construction).
    const f = formulaOf(tr(5, 'plot((close > open)[1] and high > low ? 1 : 2)'))
    expect(f).toBe('(close > open)[1] != 0 && high > low ? 1 : 2')
    // ⛔ a comparison can never be `na`, so it is untouched (its bytes kept)
    expect(formulaOf(tr(5, 'plot(close > open and high > low ? 1 : 2)'))).toBe('close > open && high > low ? 1 : 2')
    // ⛔ below v4 nothing is claimed
    expect(formulaOf(tr(3, 'plot((close > open)[1] and high > low ? 1 : 2)'))).not.toMatch(/!= 0/)
    // ⛔ and v6 is left as it was (a v6 bool is never `na`; measured: casting there moved
    // trend-duration-forecast-chartprime MATCH -> DIVERGE)
    expect(formulaOf(tr(6, 'plot((close > open)[1] and high > low ? 1 : 2)'))).toBe('(close > open)[1] && high > low ? 1 : 2')
  })

  it('⛔ a `var` bool accumulated through `self` stays a bool for the KIND (no number cast) and is read as a condition in `and`', () => {
    const f = formulaOf(tr(5, 'var f = false\nf := close > open ? true : f\nplot(f and high > low ? 1 : 2)'))
    expect(f).toMatch(/^accum\(0, close > open \? 1 : self, 250\) != 0 && high > low \? 1 : 2$/)
  })

  it('⭐ F2 — a member’s declared bool input is never `na`, so it is NOT re-read as a condition (no node growth)', () => {
    // MEASURED: wrapping every `jz or bz or zz` input knob put keltner-center-of-gravity
    // over the install door's node budget (MATCH -> refused). A declared input is a
    // number the member sets; only an operand that can be `na` is wrapped.
    const src = 'jz = input.bool(false, "a")' + NL + 'bz = input.bool(false, "b")' + NL
      + 'plot((jz or bz) ? close : open)'
    const f = formulaOf(tr(5, src, { declareInputs: 'all' }))
    expect(f).toBe('jz || bz ? close : open')
    expect(f).not.toMatch(/!= 0/)
    // the predicate itself, on the leaf shape the declare mode emits
    const leaf = { type: 'series', name: 'jz' }
    Object.defineProperty(leaf, 'inputName', { value: 'jz', enumerable: false })
    Object.defineProperty(leaf, 'inputDefault', { value: 0, enumerable: false })
    expect(conditionNeverNa(leaf)).toBe(true)
    expect(conditionNeverNa({ type: 'series', name: 'jz' })).toBe(false) // an undeclared series can be na
  })

  it('⛔⛔ v6 is UNCHANGED — TradingView refuses to compile it, so there is nothing to cast to', () => {
    const f5 = formulaOf(tr(5, 'plot(close and high > 0 ? 1 : 2)'))
    const f6 = formulaOf(tr(6, 'plot(close and high > 0 ? 1 : 2)'))
    expect(f6).toBe('close && high > 0 ? 1 : 2')
    expect(f6).not.toBe(f5)
    const v6arg = formulaOf(tr(6, 'ph = ta.pivothigh(high, 2, 2)\nplot(ta.valuewhen(ph, high[2], 0))'))
    expect(v6arg).not.toMatch(/!= 0/)
  })

  it('⛔ the formula box (no `//@version`) speaks OUR vocabulary and is never cast', () => {
    const t = translatePine('study("t")\nplot(close and high > 0 ? 1 : 2)\n', { strict: true })
    expect(t.version == null).toBe(true)
    expect(formulaOf(t)).not.toMatch(/!= 0/)
  })

  it('⛔ unary minus is not a bool context', () => {
    expect(formulaOf(tr(5, 'plot(-close)'))).toBe('-close')
  })
})

describe('the version gate and the kind classifier', () => {
  it('v1–v5 cast, v6 and the formula box do not', () => {
    expect([1, 2, 3, 4, 5].every(implicitBoolCastApplies)).toBe(true)
    expect([6, 7, null, undefined, NaN].some(implicitBoolCastApplies)).toBe(false)
  })

  it('a price, a timestamp and arithmetic are num; a comparison is bool; `self` and `na` are unknown', () => {
    const k = (f) => conditionKindOf(parseFormula(f).ast)
    expect(k('close')).toBe('num')
    expect(k('time')).toBe('num')
    expect(k('close - open')).toBe('num')
    expect(k('close > open')).toBe('bool')
    expect(k('!(close > open)')).toBe('bool')
    expect(k('close > open ? 1 : 0')).toBe('bool')
    expect(k('close > open ? close : 0 / 0')).toBe('num')
    expect(k('close > open ? 1 : 0 / 0')).toBe('bool')
    expect(k('0 / 0')).toBe('unknown')
    expect(k('self')).toBe('unknown')
    // the accum join: a body that can hand back a price is a number…
    expect(k('accum(0, close > open ? open : self, 250)')).toBe('num')
    // …one that only ever hands back 0/1 is a bool, whatever its 0 seed looks like
    expect(k('accum(0, close > open ? 1 : self, 250)')).toBe('bool')
  })

  it('the cast leaves everything but a proven number as the SAME object', () => {
    for (const f of ['close > open', 'self', '0 / 0']) {
      const tree = parseFormula(f).ast
      expect(implicitBoolCast(tree, 5).tree).toBe(tree)
    }
    const num = parseFormula('close').ast
    expect(implicitBoolCast(num, 6).tree).toBe(num)
    expect(implicitBoolCast(num, 5).cast).toBe(true)
  })
})

describe('the observer sees every bool context and steers none', () => {
  it('⭐ onCondition reports the site, the kind and whether it was cast', () => {
    const seen = []
    const t = tr(5, 'plot(close and high > 0 ? 1 : 2)', { onCondition: (s) => seen.push(s) })
    formulaOf(t)
    const sites = seen.map((s) => `${s.site}:${s.kind}:${s.cast}`)
    expect(sites).toContain('and:num:true')
    expect(sites).toContain('and:bool:false')
    expect(sites).toContain('ternary:bool:false')
    expect(seen.every((s) => s.version === 5 && Number.isInteger(s.line))).toBe(true)
  })

  it('⛔ the tree is identical with and without the observer', () => {
    const src = 'ph = ta.pivothigh(high, 2, 2)\nplot(not ph and close > 0 ? ta.valuewhen(ph, high, 0) : na)'
    expect(formulaOf(tr(5, src, { onCondition: () => {} }))).toBe(formulaOf(tr(5, src)))
  })
})
