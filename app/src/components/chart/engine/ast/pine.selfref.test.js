import { describe, it, expect } from 'vitest'

import { translatePine, printFormula } from './pine.js'
import { interpret } from './interpret.js'
import TABLE from './closedTable.json'

/**
 * `x = na(x[1]) ? seed : f(x[1])` — Pine's SELF-REFERENCING ASSIGNMENT.
 *
 * ⚰️⚰️ THE ENGINE HAS HELD THIS SHAPE SINCE `accum` LANDED, AND THIS DOOR COULD
 * NOT REACH IT. `var s = 0.0` followed by `s := s + close` translated — measured —
 * but the form published Pine actually uses did not: a plain assignment whose
 * right-hand side reads its own previous bar. It refused at `pine:undefined`,
 * NAMING THE VARIABLE BEING DEFINED, because the binder never made the name
 * visible to its own RHS — a refusal that reads as though the member forgot to
 * declare something they had just written.
 *
 * ⭐ THIS IS THE COMMONEST STATEFUL IDIOM IN PUBLISHED PINE. Every hand-rolled
 * smoother, every trailing stop, every "hold the last value until X" line is
 * written this way — including the classic Heikin-Ashi open, which is what sent
 * me looking. It is one shape, and the engine already had the node for it.
 *
 * ⛔ ONE SHAPE ONLY, ON PURPOSE. `na(x[1]) ? SEED : UPDATE` is the documented
 * idiom and it states its own seed, which is what `accum` needs. A bare
 * `x = x[1] + 1` has NO seed — Pine starts it at `na` and it stays `na` forever —
 * so there is nothing honest to build, and it refuses by name.
 *
 * ⛔ AND IT GOES THROUGH THE SAME CONVERGENCE GATE as the `var` form, asked of
 * the UPDATE ARM alone. `forgetsItsSeed` decides that, and it is imported by both
 * translators, so relaxing it here would have been relaxing it for thinkScript too.
 */
describe('a plain self-referencing assignment', () => {
  const spec = TABLE.functions.accum
  const src = (b) => `//@version=2\nstudy("t")\n${b}\n`
  const only = (out) => {
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = out.outputs.find((o) => o.refusal === null)
    expect(row, 'no output translated').toBeTruthy()
    return row
  }
  /** ⚠️ `accum` RE-SEEDS `warmup` BARS BACK AND THE PREFIX IS NaN BY DESIGN, so a
   *  numeric check needs more bars than the warm-up, not three. My first attempt
   *  asserted on a 3-bar series and read NaN — the translation was already right
   *  and the fixture could not see it. */
  const bars = (closes) => closes.map((c, i) => (
    { t: 20260101 + i, o: c, h: c, l: c, c, v: 100 }))
  const warmup = 260

  it('⭐⭐ becomes an accumulator, seeded from the `na` arm', () => {
    const row = only(translatePine(src(
      'x = na(x[1]) ? close : (x[1] + close) / 2\nplot(x)')))
    expect(row.ast.type).toBe('call')
    expect(row.ast.name).toBe('accum')
    // ⭐ THE ARMS LAND IN THE RIGHT SLOTS, read off the TABLE's own `recurrence`
    // rather than typed here. The seed is the `na` arm; the body is the other one
    // with the self-read folded to `self`. Swap them and this goes red.
    expect(printFormula(row.ast.args[spec.recurrence.seed])).toBe('close')
    expect(printFormula(row.ast.args[spec.recurrence.body]))
      .toBe(`(${spec.recurrence.binds} + close) / 2`)
  })

  it('⭐⭐ and the NUMBER is the running recurrence, not the seed and not `close`', () => {
    // ⛔⛔ THE ARITHMETIC, NOT THE SHAPE. A translation that produced `accum` with
    // the wrong body — or that dropped the self-reference — still answers, and
    // still draws a plausible line. So: feed it an alternating 10/30 close and
    // check the two-cycle this exact recurrence settles into.
    //   x_hi = (x_lo + 30) / 2 · x_lo = (x_hi + 10) / 2  ⇒  x_hi = 70/3, x_lo = 50/3
    // Neither number is a close, neither is the seed, and neither survives a body
    // that forgot `self`.
    const row = only(translatePine(src(
      'x = na(x[1]) ? close : (x[1] + close) / 2\nplot(x)')))
    const closes = Array.from({ length: warmup + 4 }, (_, i) => (i % 2 === 0 ? 10 : 30))
    const col = interpret(row.ast, bars(closes))
    const last = col.length - 1
    expect(closes[last], 'the last bar closes high').toBe(30)
    expect(col[last]).toBeCloseTo(70 / 3, 6)
    expect(col[last - 1]).toBeCloseTo(50 / 3, 6)
    // ⭐ THE CONTROL AT THE OTHER END: the warm-up prefix is NOT computable, which
    // is `accum`'s stated contract. A fixture that only looked at the tail could
    // not tell a re-seeded accumulator from a forward pass off bar 0.
    expect(Number.isNaN(col[0])).toBe(true)
  })

  it('⭐ the classic Heikin-Ashi open translates', () => {
    // What sent me looking: `08-smoothed-heiken-ashi-candles` writes exactly this.
    const row = only(translatePine(src(
      'o = ema(open, 10)\nc = ema(close, 10)\n'
      + 'haclose = (o + c) / 2\n'
      + 'haopen = na(haopen[1]) ? (o + c) / 2 : (haopen[1] + haclose[1]) / 2\n'
      + 'plot(haopen)')))
    expect(row.ast.name).toBe('accum')
    expect(printFormula(row.ast.args[spec.recurrence.body]))
      .toContain(spec.recurrence.binds)
  })

  // ─── what must still refuse ───────────────────────────────────────────────

  it('⛔ a self-reference with NO seed refuses, naming the shape that would work', () => {
    // Pine starts `x` at `na` here and it stays `na` on every bar. There is no
    // seed to give `accum`, and inventing 0 would answer a question nobody asked
    // with a column that looks like a working counter.
    const out = translatePine(src('x = x[1] + 1\nplot(x)'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:state')
    expect(out.refusal.message, 'a refusal that names no unblocker is a dead end')
      .toMatch(/na\(x\[1\]\)/)
  })

  it('⛔ one that never FORGETS its seed still refuses — the convergence gate', () => {
    // ⛔⛔ UNCHANGED, AND IT IS THE REASON THIS IS SAFE. The accumulator re-seeds a
    // fixed number of bars back, so a true running total would silently become a
    // ROLLING sum over that window. This change must not route around it.
    const out = translatePine(src('x = na(x[1]) ? close : x[1] + close\nplot(x)'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:state')
    expect(out.refusal.message).toMatch(/rolling window/)
  })

  it('⛔ a first-bar test is NOT a recurrence — the update arm must read `self`', () => {
    // `na(x[1]) ? a : b` with a self-free `b` is a "is this the first bar" test.
    // Folding it into an accumulator would answer `b` forever and lose bar one.
    const out = translatePine(src('x = na(x[1]) ? open : close\nplot(x)'))
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:state')
  })

  it('⭐ a NON-self-referencing assignment is untouched', () => {
    // The control: the binder change must not alter ordinary names.
    expect(only(translatePine(src('y = close * 2\nplot(y)'))).formula).toBe('close * 2')
  })
})
