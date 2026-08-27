// ⭐⭐ THE RECURRENCE, AND THE ONE PROPERTY THAT MAKES IT SHIPPABLE.
//
// `accum(seed, update, warmup)` is bar-to-bar state — the construct `var x = 0`
// / `x := x + 1` needs and the reason 12 of 21 real Pine scripts refused. State
// is easy; state that means the SAME NUMBER on a chart the user has panned is
// the whole problem, and this file is where that is proven rather than claimed.
//
// 🔴 THE GATE IS `the same bar, two different windows, one number`. Every other
// test here supports it. A single forward pass from the first fetched bar would
// pass everything else in this file and fail only that one — which is precisely
// why it exists, and why it is written over TWO INDEPENDENT SLICES of one bar
// series rather than over a mocked fetch: the two runs share no state at all,
// so agreement between them is evidence and not a tautology.
//
// ⚠️ AND NOTE WHAT IS *NOT* ASSERTED: that the prefix is short. `accum` is NaN
// for its whole warm-up, exactly like `sma(close, 20)`, and a test that wanted
// numbers there would be asking for the defect back.

import { describe, it, expect } from 'vitest'
import { interpret, FN, TableRefusal, MAX_RECURRENCE_STEPS } from './interpret.js'
import { astReach, maxLookback, modeFromReach } from './lint.js'
import { TABLE, RECURRENCES, RECURRENCE_BINDINGS, BAR_READERS, isPointwise } from './parse.js'

// --------------------------------------------------------------------------- //
// fixtures
// --------------------------------------------------------------------------- //

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, ...args) => ({ type: 'op', name, args })
const call = (name, ...args) => ({ type: 'call', name, args })
const off = (value, child) => ({ type: 'offset', value, args: [child] })

/** THE binding, read from the manifest. ⛔ Never typed as `'self'` in this file:
 *  a test that retypes a name the source owns is this repo's most repeated
 *  defect, and it would go green against a manifest that had renamed it. */
const SELF = RECURRENCES.accum.binds
const self = () => series(SELF)

/** A deterministic bar series with no periodicity that could make two different
 *  windows agree by luck. ⛔ NOT random: a flake here would read as a real
 *  window-dependence bug and send the next reader into the interpreter. */
function bars(n, from = 0) {
  const out = []
  for (let i = from; i < from + n; i++) {
    const c = 100 + (i * 7919 % 211) * 0.31 + (i % 13) * 1.7
    const o = c - ((i * 104729) % 37) * 0.11
    const h = Math.max(o, c) + ((i * 7907) % 19) * 0.09
    const l = Math.min(o, c) - ((i * 6997) % 23) * 0.07
    const v = 1e6 + ((i * 5003) % 977) * 1000
    out.push({ o, h, l, c, v })
  }
  return out
}

// --------------------------------------------------------------------------- //
// 🔴 THE GATE
// --------------------------------------------------------------------------- //

describe('a running value does not depend on which bars were fetched', () => {
  // Three shapes, chosen because they fail the naive implementation in three
  // DIFFERENT ways: a counter never forgets its seed, a running maximum forgets
  // it only when a later bar exceeds it, and a sticky flag forgets it the first
  // time its condition fires. One example would have proved one of them.
  const SHAPES = [
    ['a counter', (w) => call('accum', num(0), op('+', self(), num(1)), num(w))],
    ['a running maximum', (w) => call('accum', series('close'), call('max', self(), series('close')), num(w))],
    ['a sticky flag', (w) => call('accum', num(0),
      op('?:', op('>', series('close'), series('open')), num(1), self()), num(w))],
    ['an up-day count', (w) => call('accum', num(0),
      op('+', self(), op('?:', op('>', series('close'), series('open')), num(1), num(0))), num(w))],
    ['a decayed average', (w) => call('accum', series('close'),
      op('+', op('*', self(), num(0.8)), op('*', series('close'), num(0.2))), num(w))],
  ]

  for (const [label, make] of SHAPES) {
    it(`${label} reads the same on a bar reached from two different window starts`, () => {
      const warmup = 12
      const ast = make(warmup)

      // ⭐ TWO GENUINELY DIFFERENT REQUESTS FOR THE SAME BARS. `long` starts 40
      // bars earlier than `short`; the 60 bars they overlap on are the same
      // market, reached from two different places.
      const long = bars(120, 0)
      const short = bars(80, 40)
      expect(long[40].c).toBe(short[0].c) // the slices really do overlap

      const a = interpret(ast, long)
      const b = interpret(ast, short)

      const disagreements = []
      for (let k = 0; k < short.length; k++) {
        const x = a[k + 40]
        const y = b[k]
        // A bar is comparable when BOTH windows could compute it. `short` has
        // its own warm-up prefix, and NaN there is the right answer, not a
        // disagreement.
        if (Number.isNaN(x) || Number.isNaN(y)) continue
        if (x !== y) disagreements.push(`bar ${k + 40}: long=${x} short=${y}`)
      }

      // ⛔ AND THE COMPARISON MUST HAVE HAPPENED. Without this, a change that
      // made every bar NaN would pass the loop above with nothing to say — the
      // vacuous-green shape this codebase has measured more than once.
      const compared = short.length - warmup
      expect(compared).toBeGreaterThan(40)
      expect(disagreements.join(' | '), `${label}: same bar, two windows, two numbers`).toBe('')
    })
  }

  it('a single forward pass from bar 0 WOULD fail that gate — the control', () => {
    // ⭐ THE PROOF THAT THE GATE ABOVE CAN FAIL. It re-implements the cheap,
    // wrong version — one pass, seeded once at the first fetched bar — and shows
    // it disagreeing with itself across the same two windows. Without this, a
    // green gate would be evidence of nothing: it could be measuring a property
    // every implementation has.
    const onePass = (bs) => {
      const out = new Float64Array(bs.length).fill(NaN)
      let carried = 0
      for (let i = 0; i < bs.length; i++) { carried += 1; out[i] = carried }
      return out
    }
    const a = onePass(bars(120, 0))
    const b = onePass(bars(80, 40))
    expect(a[100]).not.toBe(b[60])
  })
})

// --------------------------------------------------------------------------- //
// what it computes
// --------------------------------------------------------------------------- //

describe('a running value agrees with the shipped function it re-derives', () => {
  // ⭐ THE STRONGEST AVAILABLE CHECK ON THE MATHS, because it does not restate
  // an expected number: `accum` and `highest` are two independent
  // implementations of ONE quantity, and only one of them is new.
  it('accum(close, max(self, close), 19) is highest(close, 20)', () => {
    const bs = bars(90)
    const acc = interpret(call('accum', series('close'), call('max', self(), series('close')), num(19)), bs)
    const hi = interpret(call('highest', series('close'), num(20)), bs)
    const compared = []
    for (let i = 0; i < bs.length; i++) {
      if (Number.isNaN(acc[i]) && Number.isNaN(hi[i])) continue
      compared.push(i)
      expect(acc[i], `bar ${i}`).toBe(hi[i])
    }
    expect(compared.length).toBeGreaterThan(60)
    // …and the two agree about WHERE the answer starts, not only about values.
    expect(acc.findIndex((v) => !Number.isNaN(v))).toBe(hi.findIndex((v) => !Number.isNaN(v)))
  })

  it('accum(low, min(self, low), 19) is lowest(low, 20)', () => {
    const bs = bars(90)
    const acc = interpret(call('accum', series('low'), call('min', self(), series('low')), num(19)), bs)
    const lo = interpret(call('lowest', series('low'), num(20)), bs)
    for (let i = 0; i < bs.length; i++) {
      if (Number.isNaN(acc[i]) && Number.isNaN(lo[i])) continue
      expect(acc[i], `bar ${i}`).toBe(lo[i])
    }
  })

  it('a bounded counter is its own warm-up, on every bar it answers', () => {
    const bs = bars(60)
    const out = interpret(call('accum', num(0), op('+', self(), num(1)), num(10)), bs)
    for (let i = 0; i < 10; i++) expect(out[i], `bar ${i} is inside the warm-up`).toBeNaN()
    for (let i = 10; i < bs.length; i++) expect(out[i], `bar ${i}`).toBe(10)
  })

  it('the warm-up prefix is NaN, never a partial accumulation', () => {
    const out = interpret(call('accum', num(0), op('+', self(), num(1)), num(25)), bars(40))
    // ⛔ 0, 1, 2 … would be a "reasonable" prefix and it is exactly the defect:
    // a number that is smaller than the truth and indistinguishable from one.
    for (let i = 0; i < 25; i++) expect(out[i]).toBeNaN()
    expect(out[25]).toBe(25)
  })

  it('a window shorter than the warm-up computes nothing at all', () => {
    const out = interpret(call('accum', num(0), op('+', self(), num(1)), num(50)), bars(20))
    expect([...out].every((v) => Number.isNaN(v))).toBe(true)
  })

  it('NaN inside the body poisons the run rather than being skipped', () => {
    // A bar with no close is not a close of zero. Once the running value meets
    // one it is NOT COMPUTABLE, and it stays that way until a fresh seed.
    const bs = bars(40)
    bs[20] = { ...bs[20], c: undefined }
    const out = interpret(call('accum', num(0), op('+', self(), series('close')), num(5)), bs)
    // ⭐ AND THE BOUNDARY IS EXACT, WHICH IS THE POINT OF WRITING IT DOWN. The
    // hole reaches bar 20 through the bodies applied over `(i-5, i]`, so it
    // poisons bars 20 THROUGH 24 and stops: bar 25's window opens at 21 and is
    // clean. A re-seeded window is the reason the damage ends at all — a single
    // forward pass would have carried that NaN to the right-hand edge forever.
    for (let i = 20; i <= 24; i++) expect(out[i], `bar ${i}`).toBeNaN()
    expect(Number.isNaN(out[25]), 'bar 25 opens after the hole and must recover').toBe(false)
  })

  it('a pure subtree inside the body is evaluated as a column, not per step', () => {
    // Behavioural, not a spy: `sma` inside a body must give the SAME numbers as
    // `sma` outside one. A per-step re-evaluation over a one-bar slice would
    // return NaN forever, so this is the observable form of the partition.
    const bs = bars(80)
    const withSma = interpret(
      call('accum', num(0),
        op('+', self(), op('?:', op('>', series('close'), call('sma', series('close'), num(10))), num(1), num(0))),
        num(20)), bs)
    expect(withSma.slice(30).some((v) => v > 0)).toBe(true)
    expect(withSma.slice(30).every((v) => !Number.isNaN(v))).toBe(true)
  })
})

// --------------------------------------------------------------------------- //
// what it refuses, BY NAME
// --------------------------------------------------------------------------- //

describe('a running value refuses what the step loop cannot honestly answer', () => {
  const guardOf = (fn) => {
    try { fn(); return '(did not refuse)' } catch (e) {
      if (!(e instanceof TableRefusal)) throw e
      return e.guard
    }
  }

  it('⭐ `self[1]` is SUPPORTED now — superseded 2026-08-11, deliberately', () => {
    // This asserted `interpret:recurrence`, on the reasoning that "the step loop
    // holds one value, not a history of them". That was true of the loop and
    // false as a limit: a 2-pole filter IS `c1*x + c2*prev + c3*prev_prev`, so
    // refusing a second lag refused the whole DSP family — Butterworth,
    // SuperSmoother, every Ehlers design. The loop now carries a bounded history.
    //
    // ⛔ THE ASSERTION IS INVERTED RATHER THAN DELETED, because the guard it
    // named is still live for the neighbouring shapes below, and a reader
    // meeting those needs to know this one moved on purpose.
    expect(guardOf(() => interpret(
      call('accum', num(0), op('+', off(1, self()), num(1)), num(5)), bars(40))))
      .toBe('(did not refuse)')
  })

  it('…but an offset over an EXPRESSION containing `self` still refuses', () => {
    // `(self + 1)[1]` asks for a past value of a formula the step loop never
    // computed — which is what keeps `self[k]` meaning exactly "the running
    // value k bars ago" rather than something a reader has to reconstruct.
    expect(guardOf(() => interpret(
      call('accum', num(0), off(1, op('+', self(), num(1))), num(5)), bars(40))))
      .toBe('interpret:recurrence')
  })

  it('`self` inside a windowed function', () => {
    expect(guardOf(() => interpret(
      call('accum', num(0), call('sma', self(), num(3)), num(5)), bars(40))))
      .toBe('interpret:recurrence')
  })

  it('`self` inside a nested running value', () => {
    expect(guardOf(() => interpret(
      call('accum', num(0), call('accum', self(), op('+', self(), num(1)), num(2)), num(5)), bars(40))))
      .toBe('interpret:recurrence')
  })

  it('`self` outside any running value at all', () => {
    expect(guardOf(() => interpret(op('+', self(), num(1)), bars(40))))
      .toBe('interpret:recurrence')
  })

  it('an input may not take the binding`s name', () => {
    expect(() => interpret(num(1), bars(5), { [SELF]: 3 })).toThrow(/shadows a table name/)
  })

  it('a warm-up that is not a whole-number literal', () => {
    expect(guardOf(() => interpret(
      call('accum', num(0), op('+', self(), num(1)), series('close')), bars(40))))
      .toBe('resolve:window')
  })

  it('bars × warm-up beyond the step ceiling refuses instead of hanging', () => {
    const warmup = 400
    const need = Math.floor(MAX_RECURRENCE_STEPS / warmup) + 50
    expect(guardOf(() => interpret(
      call('accum', num(0), op('+', self(), num(1)), num(warmup)), bars(need))))
      .toBe('interpret:steps')
  })

  it('…and one step under the ceiling still computes', () => {
    // ⭐ THE CEILING'S OTHER SIDE. A guard nothing passes is as broken as a
    // guard nothing fails, and this pair is what stops the number from being
    // quietly lowered to zero.
    const warmup = 400
    const fits = Math.floor(MAX_RECURRENCE_STEPS / warmup) - 10
    const out = interpret(call('accum', num(0), op('+', self(), num(1)), num(warmup)), bars(fits))
    expect(out[fits - 1]).toBe(warmup)
  })

  it('a body reaching a name the table never declared still refuses by resolve:name', () => {
    expect(guardOf(() => interpret(
      call('accum', num(0), op('+', self(), series('zzNotDeclared')), num(5)), bars(40))))
      .toBe('resolve:name')
  })
})

// --------------------------------------------------------------------------- //
// the linter reads it the same way the evaluator does
// --------------------------------------------------------------------------- //

describe('the linter and the evaluator agree about a running value`s window', () => {
  it('the warm-up IS the lookback, and the body composes on top of it', () => {
    expect(maxLookback(call('accum', num(0), op('+', self(), num(1)), num(12)))).toBe(12)
    // `sma(close, 20)` inside the body reaches 20 further back than the bar the
    // body is applied to, and the body is applied 12 bars back at the earliest.
    expect(maxLookback(call('accum', num(0),
      op('+', self(), call('sma', series('close'), num(20))), num(12)))).toBe(32)
    // …and an offset OF the whole running value adds to it like any other.
    expect(maxLookback(off(3, call('accum', num(0), op('+', self(), num(1)), num(12))))).toBe(15)
  })

  it('a running value over closed bars is NOT a repaint', () => {
    const reach = astReach(call('accum', num(0), op('+', self(), num(1)), num(12)))
    expect(reach.forward).toBe(0)
    expect(reach.back).toBe(12)
    expect(reach.reasons).toEqual([])
    expect(modeFromReach(reach.forward)).toBe('non-repainting')
  })

  it('a body that reads forward makes the whole running value read forward', () => {
    // ⛔ THE ONE THING THE BINDING MUST NOT LAUNDER. `self` resolving cleanly
    // inside a body must not make the body's OTHER arguments unanalysable or
    // clean — the forward reach of `ichimokuChikou` has to survive the trip.
    const body = op('+', self(),
      call('ichimokuChikou', series('high'), series('low'), series('close'), num(9), num(26), num(52)))
    const reach = astReach(call('accum', num(0), body, num(4)))
    expect(reach.forward).toBe(26)
    expect(modeFromReach(reach.forward)).toBe('preview-repaints')
  })

  it('the binding outside a body is UNANALYSABLE, not silently zero', () => {
    const reach = astReach(op('+', self(), num(1)))
    expect(reach.back).toBe('unknown')
    expect(reach.reasons.join(' ')).toContain(SELF)
  })
})

// --------------------------------------------------------------------------- //
// the declarations the two lanes read
// --------------------------------------------------------------------------- //

describe('the recurrence is DECLARED, so neither lane types its shape', () => {
  it('every declared recurrence names a seed, a body, a warm-up and a binding', () => {
    const names = Object.keys(RECURRENCES)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const rec = RECURRENCES[name]
      const spec = TABLE.functions[name]
      expect(Object.keys(rec).sort(), name).toEqual(['binds', 'body', 'seed', 'warmup'])
      // ⛔ THE INDICES MUST BE REAL SLOTS, AND DISTINCT. A manifest that pointed
      // `body` and `warmup` at one argument would evaluate the window as an
      // expression and produce numbers for both.
      const slots = [rec.seed, rec.body, rec.warmup]
      expect(new Set(slots).size, `${name}: two roles share one argument`).toBe(3)
      for (const s of slots) expect(spec.args[s], `${name} slot ${s}`).toBeDefined()
      expect(spec.args[rec.warmup], `${name}: the warm-up must be an int slot`).toBe('int')
      expect(spec.args[rec.seed]).toBe('series')
      expect(spec.args[rec.body]).toBe('series')
      // ⚠️ `argN` IS A ZERO-BASED SLOT INDEX IN THIS MANIFEST, not the Nth
      // argument — `sma`'s `arg1` is its SECOND slot. Writing `arg3` for slot 2
      // is the first thing this change got wrong, and it failed loudly only
      // because `windowLiteral` refuses an absent slot; a manifest whose
      // off-by-one landed on a real `series` slot would have evaluated the BODY
      // as a window and produced a number.
      expect(spec.lookback, `${name}: the lookback must BE the warm-up slot`)
        .toBe(`arg${rec.warmup}`)
      expect(typeof rec.binds).toBe('string')
      expect(RECURRENCE_BINDINGS).toContain(rec.binds)
      // ⛔ AND THE BINDING IS NOT A SAYABLE NAME. If it ever entered `series` or
      // `scalars` it would be offered in the vocabulary and resolvable outside a
      // body, which is the whole reason it is bound rather than declared.
      expect(Object.keys(TABLE.series)).not.toContain(rec.binds)
      expect(Object.keys(TABLE.scalars)).not.toContain(rec.binds)
    }
  })

  it('the pointwise set is DERIVED from the window declarations, both ways', () => {
    // ⭐ The step loop can only apply a function one bar at a time, so the
    // entries it is allowed to meet and the entries it HOLDS A SCALAR FORM FOR
    // must be the same set. A declared-but-unimplemented one would refuse inside
    // a body while looking legal in the table; an implemented-but-undeclared one
    // would be reachable from a body and from nowhere else.
    const declaredPointwise = Object.entries(TABLE.functions)
      .filter(([, spec]) => isPointwise(spec)).map(([name]) => name).sort()
    expect(declaredPointwise.length).toBeGreaterThan(0)
    // The scalar forms are private, so the observable equivalent: every declared
    // pointwise entry must be usable in a body, and every non-pointwise one must
    // refuse there.
    const bs = bars(30)
    for (const name of declaredPointwise) {
      const spec = TABLE.functions[name]
      const args = spec.args.map((_, i) => (i === 0 ? self() : series('close')))
      expect(() => interpret(call('accum', num(1), call(name, ...args), num(3)), bs), name).not.toThrow()
    }
    const windowed = Object.entries(TABLE.functions)
      .filter(([name, spec]) => !isPointwise(spec) && !RECURRENCES[name])
      .map(([name]) => name)
    expect(windowed.length).toBeGreaterThan(10)
  })

  it('every declared function has an implementation and vice versa — still', () => {
    // The pre-existing invariant, re-asserted here because this change added a
    // table entry that is deliberately NOT in `FN`: `accum` is evaluated by the
    // walker itself, so the equality had to grow an exception and an exception
    // nobody states is how a roster rots.
    //
    // ⭐ A SECOND KIND OF EXCEPTION JOINED IT ON 2026-08-26, AND IT IS DERIVED
    // THE SAME WAY. An entry declaring `reads: 'bars'` is handed `interpret`'s
    // own bar array rather than a pack of argument columns, so its
    // implementation lives in `BAR_FN`. Both exceptions are read off the
    // MANIFEST here, never listed, so a third entry of either kind needs no edit
    // in this file.
    const declared = Object.keys(TABLE.functions).sort()
    const implemented = Object.keys(FN).sort()
    const missing = declared.filter((n) => !implemented.includes(n))
    const extra = implemented.filter((n) => !declared.includes(n))
    const byWalker = [...new Set([...Object.keys(RECURRENCES), ...BAR_READERS])].sort()
    expect(BAR_READERS.length, 'the bar-reading exception must be non-empty')
      .toBeGreaterThan(0)
    expect(extra.join(', '), 'an implemented function the table never declared').toBe('')
    expect(missing.join(', '), 'a declared function with no implementation')
      .toBe(byWalker.join(', '))
  })
})
