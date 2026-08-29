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

/**
 * 🔴 THE SEEDLESS REFUSAL'S REMEDY, RUN RATHER THAN READ.
 *
 * `01-supertrend-mobius.ts` — a real Mobius script — writes
 * `def ST = if close < ST[1] then UP else DN;` and states no first-bar value. The
 * door refuses it, and that refusal is CORRECT and permanent: a seed this engine
 * picks is a number the member cannot see, and the widening that would let one be
 * assumed was disproved by counterexample (`close < self ? 0 : 1000000` differs on
 * 350 of 350 computable bars between a `0/0` seed and a `1000000` one).
 *
 * ⭐ BUT THE REFUSAL ALSO OFFERS TWO REMEDIES, AND AN OFFERED REMEDY IS A CLAIM
 * ABOUT A RUN. This lane has already shipped one refusal whose named remedy
 * returned the same refusal — a loop that read as help and cost a member an edit
 * to discover — and that sentence was corrected twice before the MECHANISM was.
 * So both remedies are executed here, on the corpus script's own body rather than
 * a reduction of it, and the assertion is that the whole SuperTrend comes out.
 *
 * ⛔⛔ THIS IS ALSO THE MEASURED ANSWER TO "does CompoundValue's explicit seed
 * form close `01`?" — asked directly of this lane. It does. `01` is therefore
 * blocked by exactly ONE thing, the absence of a published first-bar value in the
 * script as its author wrote it, and by nothing about `accum`, `hma`,
 * `AverageType.HULL`, `TrueRange` or the ternary. That is a far narrower fact
 * than "the script refuses", and it is the one worth writing down.
 */
describe('the seedless refusal names remedies that WORK', () => {
  const SUPERTREND = `input AtrMult = 1.0;
input nATR = 4;
input AvgType = AverageType.HULL;
def ATR = MovingAverage(AvgType, TrueRange(high, close, low), nATR);
def UP = HL2 + (AtrMult * ATR);
def DN = HL2 + (-AtrMult * ATR);
`
  // The seedless original, exactly as Mobius published the recurrence.
  const SEEDLESS = `${SUPERTREND}def ST = if close < ST[1] then UP else DN;
plot p = close > ST;
`
  it('⛔ the published script refuses, and says a first-bar value is what is missing', () => {
    const r = translateThinkScript(SEEDLESS).refusal
    expect(r.guard).toBe('thinkscript:state')
    expect(r.message).toContain('states a first-bar value')
    // ⭐ THE CONTROL that makes the two `it`s below mean anything: the refusal is
    // about the SEED and nothing else, so the remedies may change only that.
    expect(r.message).toContain('IsNaN')
    expect(r.message).toContain('CompoundValue')
  })

  // ⭐ ONE EXPECTED TREE FOR BOTH REMEDIES. thinkorswim's two spellings of "this
  // is where the value starts" mean the same recurrence, so they must produce the
  // same column — and asserting the FORMULA rather than merely `ok` is what makes
  // this a test of the maths instead of a test that something compiled.
  const WANT = 'close > accum((high + low) / 2 + -1 * hma(max(close[1], high) '
    + '- min(close[1], low), 4), close < self ? (high + low) / 2 + 1 * hma(max(close[1], '
    + 'high) - min(close[1], low), 4) : (high + low) / 2 + -1 * hma(max(close[1], high) '
    + `- min(close[1], low), 4), ${TS_STATE_WARMUP})`

  it('⭐ remedy 1 — `if IsNaN(ST[1]) then <first> else …` translates the whole study', () => {
    const out = translateThinkScript(`${SUPERTREND}`
      + 'def ST = if IsNaN(ST[1]) then DN else if close < ST[1] then UP else DN;\n'
      + 'plot p = close > ST;\n')
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.outputs.find((o) => !o.refusal).formula).toBe(WANT)
  })

  it('⭐ remedy 2 — `CompoundValue(1, …, DN)` translates it to the SAME tree', () => {
    const out = translateThinkScript(`${SUPERTREND}`
      + 'def ST = CompoundValue(1, if close < ST[1] then UP else DN, DN);\n'
      + 'plot p = close > ST;\n')
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.outputs.find((o) => !o.refusal).formula).toBe(WANT)
  })

  it('⛔⛔ a self-lag DEEPER than one bar still refuses, saying how deep it read', () => {
    // ⭐ THE OTHER TWO STATEFUL CORPUS SCRIPTS DIE HERE, NOT ON THE SEED, and the
    // distinction decides who can fix them. `17-compoundvalue` writes
    // `CompoundValue(2, x[1] + x[2], 1)` — seeded, explicitly, by its own author —
    // and `10-rsi-laguerre` reads `Go[1] … Go[4]`. Both STATE a first-bar value,
    // so no seeding remedy touches them: `closedTable`'s `accum` binds `self` at
    // ONE bar back (`recurrence.binds`), and a second bound lag is a MANIFEST
    // change, not a translator one. Recorded here so the next reader does not
    // spend a day re-deriving that these are the same wall as `01`. They are not.
    for (const [depth, src] of [
      [2, 'def x = CompoundValue(2, x[1] + x[2], 1);\nplot p = x > 0;\n'],
      [4, 'def g = CompoundValue(1, 0.5 * g[1] - 0.2 * g[4] + close, close);\nplot p = g > 0;\n'],
    ]) {
      const r = translateThinkScript(src).refusal
      expect(r.guard, `depth ${depth}`).toBe('thinkscript:state')
      expect(r.message, `depth ${depth}`).toContain('can only be read one bar back')
      expect(r.message, `depth ${depth}`).toContain(`${depth} bars back`)
    }
    // ⛔ AND THE CONTROL: one bar back WITH a seed is not refused for depth — it
    // is the shape the two `it`s above just translated. Without this line every
    // assertion here would pass against a door that refused every recurrence.
    expect(translateThinkScript('def x = CompoundValue(1, if IsNaN(x[1]) then close else '
      + '(x[1] + close) / 2, close);\nplot p = close > x;\n').refusal).toBe(null)
  })
})
