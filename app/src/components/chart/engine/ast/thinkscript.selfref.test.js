import { describe, it, expect } from 'vitest'

import { translateThinkScript, TS_STATE_WARMUP } from './thinkscript.js'
import { translatePine, printFormula } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'
import TABLE from './closedTable.json'

/**
 * thinkScript's PLAIN self-reference — `def x = if IsNaN(x[1]) then seed else f(x[1])`.
 *
 * ⚰️ `CompoundValue` TRANSLATED AND THE PLAIN SPELLING OF THE SAME RECURRENCE DID
 * NOT. Only `CompoundValue` ever set `buildingRecurrence`, so a plain `def` that
 * read its own previous bar walked back into the binding being resolved and
 * refused as a seedless recursion — even when the script stated its seed one
 * token away. It is the commonest stateful shape thinkorswim members write.
 *
 * ⭐ ONE RULE, BOTH LANES. The shape detector (`seedAndUpdateOf`) and the
 * convergence gate (`forgetsItsSeed`) are IMPORTED from `pine.js`, which needed
 * them first. Pine's `na(x[1]) ? … : …` and this `if IsNaN(x[1]) then …` are the
 * same canonical tree, so a second copy is how two translators come to disagree
 * about one engine function.
 */
describe('a plain self-referencing `def`', () => {
  const spec = TABLE.functions.accum
  const one = (src) => {
    const out = translateThinkScript(src)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    return out.outputs.find((o) => !o.refusal)
  }
  const refusalOf = (src) => {
    const out = translateThinkScript(src)
    const r = out.refusal || (out.outputs || []).map((o) => o.refusal).find(Boolean)
    expect(r, 'expected a refusal').toBeTruthy()
    return r
  }

  it('⭐⭐ becomes an accumulator, seeded from the `IsNaN` arm', () => {
    const row = one('def s = if IsNaN(s[1]) then close else (s[1] + close) / 2;\nplot p = s;\n')
    expect(row.formula).toBe(`accum(close, (${spec.recurrence.binds} + close) / 2, ${TS_STATE_WARMUP})`)
  })

  it('⭐⭐ and it is the SAME TREE Pine produces for the same recurrence', () => {
    // ⛔⛔ THE POINT OF SHARING THE DETECTOR, ASSERTED rather than described. Two
    // dialects, one engine function; if these ever diverge, one of them is
    // translating a member's indicator into something the other calls different.
    const ts = one('def s = if IsNaN(s[1]) then close else (s[1] + close) / 2;\nplot p = s;\n')
    const pine = translatePine(
      '//@version=5\nindicator("t")\ns = na(s[1]) ? close : (s[1] + close) / 2\nplot(s)\n')
    expect(pine.refusal).toBe(null)
    expect(ts.formula).toBe(pine.outputs.find((o) => !o.refusal).formula)
  })

  it('⭐ a trailing-stop shape — `self` in the CONDITION, self-free arms', () => {
    const row = one('def st = if IsNaN(st[1]) then close else if close < st[1] then high else low;\n'
      + 'plot p = st;\n')
    expect(row.formula)
      .toBe(`accum(close, close < ${spec.recurrence.binds} ? high : low, ${TS_STATE_WARMUP})`)
  })

  it('⭐⭐ and the NUMBER is the running recurrence, not the seed repeated', () => {
    // Alternating 10/30 closes settle this exact recurrence into a two-cycle:
    //   x_hi = (x_lo + 30) / 2 · x_lo = (x_hi + 10) / 2  ⇒  70/3 and 50/3.
    const row = one('def s = if IsNaN(s[1]) then close else (s[1] + close) / 2;\nplot p = s;\n')
    const closes = Array.from({ length: TS_STATE_WARMUP + 4 },
      (_, i) => (i % 2 === 0 ? 10 : 30))
    const col = interpret(row.ast, closes.map((c, i) => (
      { t: 20260101 + i, o: c, h: c, l: c, c, v: 100 })))
    const last = col.length - 1
    expect(col[last]).toBeCloseTo(70 / 3, 6)
    expect(col[last - 1]).toBeCloseTo(50 / 3, 6)
    expect(Number.isNaN(col[0]), 'the warm-up prefix is not computable').toBe(true)
  })

  // ─── what must still refuse ───────────────────────────────────────────────

  it('⛔ one that never FORGETS its seed refuses — the convergence gate', () => {
    const r = refusalOf('def v = if IsNaN(v[1]) then 0 else v[1] + volume;\nplot p = v;\n')
    expect(r.guard).toBe('thinkscript:state')
    expect(r.message).toMatch(/rolling window/)
  })

  it('⛔ a SEEDLESS one refuses, naming both constructs that would supply a seed', () => {
    const r = refusalOf('def st = if close < st[1] then high else low;\nplot p = st;\n')
    expect(r.guard).toBe('thinkscript:state')
    expect(r.message).toMatch(/IsNaN/)
    expect(r.message).toMatch(/CompoundValue/)
  })

  it('⛔⛔ …and the SEEDLESS refusal is MEASURED, not cautious — the adversarial rail', () => {
    // 🔴🔴 THIS IS THE TEST THAT STOPS THE NEXT READER RE-DERIVING A WRONG
    // WIDENING, INCLUDING ME. The argument is seductive: when `self` appears only
    // in a ternary's CONDITION it never flows into the produced value, so surely
    // any seed gives the same column — and the note on the seedless refusal even
    // records a measurement that looks like proof (`accum(0/0, close < self ?
    // high : low, 250)` matching the zero-seeded form on all 579 bars).
    //
    // ⛔ IT IS A PROPERTY OF THAT FORMULA, NOT OF THAT SHAPE. The branch chains
    // coalesce only because `high` and `low` sit within a bar's range of each
    // other. Pull the arms apart and they never meet.
    const n = TS_STATE_WARMUP + 350
    const bars = []
    let p = 100
    for (let i = 0; i < n; i += 1) {
      p += ((i * 37) % 11) - 5 + Math.sin(i / 7) * 2
      bars.push({ t: 20240101 + i, o: p, h: p + 1.5, l: p - 1.5, c: p, v: 1000 })
    }
    const run = (seed, body) => {
      const r = parseFormula(`accum(${seed}, ${body}, ${TS_STATE_WARMUP})`)
      expect(r.ok, r.error).toBe(true)
      return interpret(r.ast, bars)
    }
    const disagreements = (body, a, b) => {
      const x = run(a, body)
      const y = run(b, body)
      let d = 0
      for (let i = 0; i < x.length; i += 1) {
        const both = Number.isNaN(x[i]) && Number.isNaN(y[i])
        if (!both && !(Math.abs(x[i] - y[i]) < 1e-9)) d += 1
      }
      return d
    }
    const arms = 'close < self ? high : low'
    const far = 'close < self ? 0 : 1000000'
    const latch = 'self > 0.5 ? 1 : (close > open ? 1 : 0)'
    // ⭐ THE INSTANCE THE OLD NOTE MEASURED — genuinely seed-independent here.
    expect(disagreements(arms, '0 / 0', '1000000')).toBe(0)
    // 🔴 THE SAME SHAPE, ARMS PULLED APART — every computable bar disagrees.
    expect(disagreements(far, '0 / 0', '1000000')).toBe(350)
    expect(disagreements(latch, '0 / 0', '1000000')).toBe(350)
    // ⛔ SO THERE IS NO SEED THIS TRANSLATOR MAY INVENT, and the refusal above is
    // the correct answer rather than a gap waiting to be closed.
  })

  it('⭐ `CompoundValue` is untouched — a nested accumulator binds its OWN `self`', () => {
    // ⛔⛔ THE FREE-vs-PRESENT DISTINCTION, AND IT IS A WRONG COLUMN IF MISSED.
    // A tree that merely MENTIONS `self` may have had it bound by an inner
    // accumulator. Asking the undistinguishing question built
    // `accum(seed, accum(…), 250)` — an outer body that never reads its own
    // state, drawn without complaint. This case caught it.
    const row = one('def c = CompoundValue(1, if close > open then close else c[1], 0);\nplot p = c;\n')
    expect(row.formula)
      .toBe(`accum(0, close > open ? close : ${spec.recurrence.binds}, ${TS_STATE_WARMUP})`)
    expect(printFormula(row.ast).match(/accum\(/g), 'exactly one accumulator').toHaveLength(1)
  })

  it('⭐ an ordinary `def` is untouched', () => {
    expect(one('def y = close * 2;\nplot p = y;\n').formula).toBe('close * 2')
  })
})

/**
 * `HL2` / `HLC3` / `OHLC4` — one identity, two manuals, and two answers until now.
 */
describe('thinkorswim`s derived price series expand', () => {
  const one = (src) => {
    const out = translateThinkScript(src)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    return out.outputs.find((o) => !o.refusal)
  }

  it('⭐⭐ HL2, HLC3 and OHLC4 expand to their published arithmetic', () => {
    // ⚰️ THEY SAT IN "price series this engine keeps no field for" and refused at
    // `thinkscript:builtin`, while the Pine door expanded the identical names all
    // along. thinkorswim's Constants page defines HL2 as `(high + low) / 2`,
    // exactly as Pine's reference does.
    expect(one('plot p = HL2;\n').formula).toBe('(high + low) / 2')
    expect(one('plot p = HLC3;\n').formula).toBe('(high + low + close) / 3')
    expect(one('plot p = OHLC4;\n').formula).toBe('(open + high + low + close) / 4')
  })

  it('⭐⭐ …and they are the SAME TREE the Pine door produces', () => {
    for (const name of ['hl2', 'hlc3', 'ohlc4']) {
      const ts = one(`plot p = ${name.toUpperCase()};\n`)
      const pine = translatePine(`//@version=5\nindicator("t")\nplot(${name})\n`)
      expect(pine.refusal, name).toBe(null)
      expect(ts.formula, name).toBe(pine.outputs.find((o) => !o.refusal).formula)
    }
  })

  it('⛔ the rest of the set still refuses BY NAME — the honest half', () => {
    // ⭐ THE CONTROL. Without it this change would look identical to one that
    // stopped refusing unknown price series altogether. `vwap`, `bid`, `ask` and
    // the others are not derivable from a bar's five fields at all.
    for (const name of ['VWAP', 'BID', 'ASK', 'IMP_VOLATILITY', 'OPEN_INTEREST']) {
      const out = translateThinkScript(`plot p = ${name};\n`)
      const r = out.refusal || (out.outputs || []).map((o) => o.refusal).find(Boolean)
      expect(r && r.guard, name).toBe('thinkscript:builtin')
    }
  })
})
