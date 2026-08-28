import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'

/**
 * Pine names this engine answers WITHOUT growing its vocabulary.
 *
 * ⭐⭐ `BUILTIN_CALL_TREE` IS THE CHEAPEST DOOR IN THE PRODUCT. An entry there is
 * an exact IDENTITY written in the closed table's own terms, so it costs no new
 * function, no new manifest row, no new interpreter arm and — critically — no new
 * number for the two lanes to disagree about. `roc`, `avg` and `cross` were
 * already there; `iff` and `linreg` join them, and between them they moved the
 * community corpus 11/30 → 13/30.
 *
 * ⛔ AN IDENTITY IS A CLAIM, AND A CLAIM NEEDS A CHECK. Every case below asserts
 * a VALUE against an independently computed reference, not merely that a tree came
 * back. A rewrite that produced a plausible tree with the wrong arithmetic would
 * translate, lint, save, scan — and be wrong on every bar.
 */
describe('Pine names answered from vocabulary this table already holds', () => {
  const src = (body, v = 5) => `//@version=${v}\n${v < 4 ? 'study' : 'indicator'}("t")\n${body}\n`

  const treeOf = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const first = out.outputs.find((o) => o.refusal === null)
    expect(first, 'no output translated').toBeTruthy()
    return first.ast
  }

  const barsOf = (closes) => closes.map((c, i) => ({
    t: 20260801 + i, o: c, h: c, l: c, c, v: 1000,
  }))

  // ─── iff ────────────────────────────────────────────────────────────────────

  it("⭐ `iff` is Pine v3's ternary, and this table already declares the operator", () => {
    // ⛔ A SCRIPT WAS BEING REFUSED FOR ITS SPELLING. Pine v4 replaced `iff` with
    // `? :`, which this door has always taken — so a v3 script asking for a thing
    // we fully support was told we had no such function.
    const ast = treeOf(translatePine(src('plot(iff(close > open, high, low))', 3)))
    expect(ast).toEqual({
      type: 'op',
      name: '?:',
      args: [
        {
          type: 'op',
          name: '>',
          args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }],
        },
        { type: 'series', name: 'high' },
        { type: 'series', name: 'low' },
      ],
    })
  })

  it('…and it SELECTS, per bar — the value check, not only the shape', () => {
    const ast = treeOf(translatePine(src('plot(iff(close > 10, 1, 0))', 3)))
    // ⚠️ `Array.from`, because the interpreter returns a typed array — comparing
    // it to a plain one fails on the CONTAINER while the values are identical.
    expect(Array.from(interpret(ast, barsOf([5, 20, 8, 30])))).toEqual([0, 1, 0, 1])
  })

  it('⭐ `iff` and `? :` produce the SAME tree, so the two spellings cannot drift', () => {
    // One definition, or a member who imported a v3 script and a member who typed
    // the v4 form get two cache entries, two read-backs, and a "why are these
    // different?" nobody can answer from either.
    const viaIff = treeOf(translatePine(src('plot(iff(close > open, high, low))', 3)))
    const viaTernary = treeOf(translatePine(src('plot(close > open ? high : low)')))
    expect(viaIff).toEqual(viaTernary)
  })

  // ─── linreg ─────────────────────────────────────────────────────────────────

  /** A direct least-squares fit — the INDEPENDENT reference.
   *
   *  ⚠️ DELIBERATELY WRITTEN THE LONG WAY, from the normal equations, so it shares
   *  no algebra with the closed form the translator uses. Two derivations that
   *  agree are evidence; one derivation checked against itself is decoration. */
  const leastSquares = (closes, n, off) => {
    const w = closes.slice(-n)
    const xs = w.map((_, i) => i)
    const sx = xs.reduce((a, b) => a + b, 0)
    const sy = w.reduce((a, b) => a + b, 0)
    const sxx = xs.reduce((a, x) => a + x * x, 0)
    const sxy = xs.reduce((a, x, i) => a + x * w[i], 0)
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    const intercept = (sy - slope * sx) / n
    return intercept + slope * (n - 1 - off)
  }

  const CLOSES = [12, 15, 11, 19, 22, 18, 25, 31, 27, 33, 29, 41, 38, 44, 40, 52]

  it('⭐⭐ `ta.linreg` equals a least-squares fit computed independently', () => {
    for (const [n, off] of [[5, 0], [9, 0], [14, 0], [9, 3]]) {
      const ast = treeOf(translatePine(src(`plot(ta.linreg(close, ${n}, ${off}))`)))
      const col = interpret(ast, barsOf(CLOSES))
      expect(col[CLOSES.length - 1], `n=${n} off=${off}`)
        .toBeCloseTo(leastSquares(CLOSES, n, off), 9)
    }
  })

  it('…and on a perfect line it returns the line — the case with an answer by eye', () => {
    // ⭐ A REFERENCE THAT NEEDS NO REFERENCE. Fit a straight ramp and the
    // regression IS the ramp, so this case is right or wrong by inspection, which
    // the numeric comparison above can never be on its own.
    const ast = treeOf(translatePine(src('plot(ta.linreg(close, 5, 0))')))
    const col = interpret(ast, barsOf([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(col[7]).toBeCloseTo(8, 9)
    expect(col[6]).toBeCloseTo(7, 9)
  })

  it('⛔ and the SLOPE has a sign — a mirrored series leans the other way', () => {
    // ⛔⛔ THE CONTROL THAT CATCHES A REVERSED WEIGHTING. The closed form reads the
    // window's first moment out of `wma`, which only works because `wma` weights
    // the NEWEST bar heaviest. Weighted the other way every fit still returns a
    // plausible number — with the slope negated. A rising ramp must read ABOVE its
    // own mean at the current bar, and a falling one BELOW.
    const ast = treeOf(translatePine(src('plot(ta.linreg(close, 5, 0))')))
    const rising = interpret(ast, barsOf([1, 2, 3, 4, 5]))[4]
    const falling = interpret(ast, barsOf([5, 4, 3, 2, 1]))[4]
    expect(rising).toBeCloseTo(5, 9)
    expect(falling).toBeCloseTo(1, 9)
    expect(rising, 'the slope is mirrored — wma is being read oldest-heaviest')
      .toBeGreaterThan(falling)
  })

  it('⭐ it costs NO new vocabulary — the tree is `sum`, `wma` and arithmetic', () => {
    // ⛔ THIS IS THE PROPERTY THAT MAKES THE ENTRY CHEAP, so it is asserted rather
    // than assumed: a rewrite that quietly introduced a name the manifest does not
    // declare would be a second numeric surface wearing an identity's clothes.
    const ast = treeOf(translatePine(src('plot(ta.linreg(close, 9, 0))')))
    const called = new Set()
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'call') called.add(n.name)
      for (const a of n.args || []) walk(a)
    }
    walk(ast)
    expect([...called].sort()).toEqual(['sum', 'wma'])
  })

  it('⛔ a length under 2 has no line through it, and refuses by name', () => {
    for (const bad of ['1', '0']) {
      const out = translatePine(src(`plot(ta.linreg(close, ${bad}, 0))`))
      expect(out.refusal, bad).toBeTruthy()
      expect(out.refusal.guard, bad).toBe('pine:arity')
      expect(out.refusal.message, bad).toContain('at least 2')
    }
  })

  it('⛔ and a length that is not a plain number refuses — the constant must fold', () => {
    // The closed form's constant is a function of the length, so the length has to
    // be known when the tree is built. A runtime one would have to become a node,
    // and there is no node for it — so this refuses rather than inventing one.
    const out = translatePine(src('plot(ta.linreg(close, close > open ? 5 : 9, 0))'))
    expect(out.refusal).toBeTruthy()
  })
})
