// app/src/components/chart/engine/ast/pine.runLength.test.js
//
// ─── ⭐⭐ A RUN-LENGTH COUNTER IS A BOUNDED QUESTION IN UNBOUNDED CLOTHES ─────
//
// `var int n = 0` + `n := cond ? n + 1 : 0` is how published Pine spells "how
// many bars in a row". It refuses at `pine:state` and that refusal is CORRECT:
// the update arm `self + 1` never forgets its seed, so folding it into `accum`
// would draw a rolling window over the warm-up rather than a counter.
//
// ⭐ BUT THE COUNTER IS NEVER OBSERVED UNBOUNDED. Compared against a whole
// number K only the last K bars can decide it, and that comparison is what every
// script actually writes. This file pins the identity
//
//     n >= K   ⟺   cond and cond[1] and … and cond[K-1]
//
// ⛔⛔ AND IT MEASURES IT RATHER THAN ASSERTING IT. The tests below simulate the
// Pine recurrence bar by bar over a real series and compare it against the
// INTERPRETED tree this engine ships. A test that only read the printed formula
// string would pass for a translator that emitted a plausible-looking
// conjunction of the WRONG LENGTH — exactly the look-alike this table refuses
// everywhere else.

import { describe, it, expect } from 'vitest'
import { translatePine, PINE_RUN_LENGTH_MAX } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret, maxLookback } from './interpret.js'

/** A deliberately STREAKY series — a slow swing with a smaller wiggle riding it,
 *  so long runs occur in BOTH directions.
 *
 *  ⚰️ THE FIRST DRAFT WAS A FAST ALTERNATION AND ITS LONGEST UP-RUN WAS TWO, so
 *  the `cond ? 0 : n + 1` case agreed with the counter on every bar while neither
 *  of them ever fired — a green test over an empty set. The `fired > 0` guard
 *  below is what caught it, which is the only reason it is written that way.
 *  Measured on this series: 110 bars reach a down-run of 3, 86 reach 7, and 123
 *  reach an up-run of 3. */
const BARS = (() => {
  let px = 100
  const out = []
  for (let i = 0; i < 260; i++) {
    px = Math.max(5, px + Math.sin(i / 6.3) + 0.28 * Math.sin(i / 1.7))
    out.push({ t: 20260101 + i, o: px, h: px + 1, l: px - 1, c: px, v: 1000 + i })
  }
  return out
})()

/** The Pine recurrence, run by hand: `x[t] = c[t] ? x[t-1] + 1 : 0`. */
function simulate(condOf, seed = 0) {
  let prev = seed
  return BARS.map((_, i) => { prev = condOf(i) ? prev + 1 : 0; return prev })
}

const SRC = (seed, cmp) => [
  '//@version=6',
  'indicator("s")',
  'var int downRun = ' + seed,
  'downRun := close < close[1] ? downRun + 1 : 0',
  'plot(' + cmp + ' ? 1 : 0)',
  '',
].join('\n')

function column(src) {
  const out = translatePine(src)
  expect(out.ok, out.ok ? '' : out.refusal.guard + ': ' + out.refusal.message).toBe(true)
  const parsed = parseFormula(out.outputs[out.selected].formula)
  expect(parsed.ok).toBe(true)
  return { values: interpret(parsed.ast, BARS, {}), ast: parsed.ast }
}

/** `close < close[1]`, the condition every fixture here counts. */
const downBar = (i) => (i >= 1 ? BARS[i].c < BARS[i - 1].c : false)

describe('⭐⭐ the run-length identity, MEASURED against the recurrence', () => {
  // ⛔ EVERY COMPARISON, because the split point is not the same for all four:
  // `>= K` and `< K` are decided by K bars, `> K` and `<= K` by K + 1. An
  // off-by-one here is a screen that fires a bar early on every symbol.
  const CASES = [
    { cmp: 'downRun >= 3', run: 3, want: (n, i) => n[i] >= 3 },
    { cmp: 'downRun > 3', run: 4, want: (n, i) => n[i] > 3 },
    { cmp: 'downRun < 3', run: 3, want: (n, i) => n[i] < 3 },
    { cmp: 'downRun <= 3', run: 4, want: (n, i) => n[i] <= 3 },
    { cmp: 'downRun >= 1', run: 1, want: (n, i) => n[i] >= 1 },
    { cmp: 'downRun >= 7', run: 7, want: (n, i) => n[i] >= 7 },
    // ⭐ EITHER ORDER. Members write the limit first as readily as last.
    { cmp: '3 <= downRun', run: 3, want: (n, i) => n[i] >= 3 },
    { cmp: '3 > downRun', run: 3, want: (n, i) => n[i] < 3 },
  ]

  for (const { cmp, run, want } of CASES) {
    it('⭐ `' + cmp + '` answers what the counter answers', () => {
      const { values, ast } = column(SRC(0, cmp))
      const counter = simulate(downBar)
      // ⛔ THE WARM-UP IS THIS TREE'S OWN, not a number typed here: the bars the
      // engine cannot answer are the ones the identity is silent about.
      const warm = maxLookback(ast)
      expect(Number.isFinite(warm)).toBe(true)
      // run - 1 offsets, plus the `close[1]` inside the condition.
      expect(warm).toBe(run)
      let compared = 0
      for (let i = warm; i < BARS.length; i++) {
        if (!Number.isFinite(values[i])) continue
        expect(values[i] === 1, 'bar ' + i + ': counter=' + counter[i] + ' tree=' + values[i])
          .toBe(want(counter, i))
        compared++
      }
      // ⛔ NON-VACUITY, TWICE: the loop must have run, and the answer must not be
      // constant — a tree that says 0 on every bar would satisfy an equality
      // check against a counter that also never fires.
      expect(compared).toBeGreaterThan(150)
      const fired = values.slice(warm).filter((v) => v === 1).length
      expect(fired, '`' + cmp + '` never fired').toBeGreaterThan(0)
      expect(fired, '`' + cmp + '` fired on every bar').toBeLessThan(compared)
    })
  }

  it('⛔ THE CONTROL: the comparison can FAIL, so agreement means something', () => {
    // ⚰️ Without this, a `simulate` that happened to mirror the translator's own
    // mistake would read as proof. Ask for the WRONG run length and the two must
    // disagree — if they cannot, this whole file is measuring nothing.
    const { values, ast } = column(SRC(0, 'downRun >= 3'))
    const counter = simulate(downBar)
    const warm = maxLookback(ast)
    let disagreements = 0
    for (let i = warm; i < BARS.length; i++) {
      if (!Number.isFinite(values[i])) continue
      if ((values[i] === 1) !== (counter[i] >= 4)) disagreements++
    }
    expect(disagreements).toBeGreaterThan(0)
  })

  it('⭐ the reset arm may come first — `cond ? 0 : n + 1` counts `not cond`', () => {
    const src = [
      '//@version=6',
      'indicator("s")',
      'var int upRun = 0',
      'upRun := close < close[1] ? 0 : upRun + 1',
      'plot(upRun >= 3 ? 1 : 0)',
      '',
    ].join('\n')
    const { values, ast } = column(src)
    const counter = simulate((i) => (i >= 1 ? !downBar(i) : false))
    const warm = maxLookback(ast)
    let compared = 0
    for (let i = warm; i < BARS.length; i++) {
      if (!Number.isFinite(values[i])) continue
      expect(values[i] === 1).toBe(counter[i] >= 3)
      compared++
    }
    expect(compared).toBeGreaterThan(150)
    expect(values.slice(warm).filter((v) => v === 1).length).toBeGreaterThan(0)
  })

  it('⭐ a POSITIVE seed is admitted, and answers the counter it seeded', () => {
    // ⛔ THE OTHER HALF OF THE SEED RULE. Without this the check could be
    // narrowed to `seedValue !== 0` and nothing would notice. A seed of 2 is
    // sound because it can only matter where the run reaches back past bar zero,
    // and there the counter is ALREADY over K — see `runLengthShape`.
    const { values, ast } = column(SRC(2, 'downRun >= 3'))
    const counter = simulate(downBar, 2)
    const warm = maxLookback(ast)
    let compared = 0
    for (let i = warm; i < BARS.length; i++) {
      if (!Number.isFinite(values[i])) continue
      expect(values[i] === 1).toBe(counter[i] >= 3)
      compared++
    }
    expect(compared).toBeGreaterThan(150)
    expect(values.slice(warm).filter((v) => v === 1).length).toBeGreaterThan(0)
  })

  it('⭐ the limit may be an input, because that is how every author writes it', () => {
    const src = [
      '//@version=6',
      'indicator("s")',
      'n = input.int(4, "Consecutive down closes")',
      'var int downRun = 0',
      'downRun := close < close[1] ? downRun + 1 : 0',
      'plot(downRun >= n ? 1 : 0)',
      '',
    ].join('\n')
    const { values, ast } = column(src)
    const counter = simulate(downBar)
    const warm = maxLookback(ast)
    let compared = 0
    for (let i = warm; i < BARS.length; i++) {
      if (!Number.isFinite(values[i])) continue
      expect(values[i] === 1).toBe(counter[i] >= 4)
      compared++
    }
    expect(compared).toBeGreaterThan(150)
  })
})

describe('⛔ what it still refuses, and each for its own reason', () => {
  const refusalOf = (src) => {
    const out = translatePine(src)
    expect(out.ok, 'expected a refusal, got a translation').toBe(false)
    return out.refusal
  }

  it('⛔⛔ A RUNNING TOTAL IS STILL A RUNNING TOTAL — the door did not widen', () => {
    // ⚰️ THE CONTROL THAT MATTERS MOST. Written as "any `var` + `:=` compared to
    // a number", this rule would have folded OBV-by-hand into a bounded
    // conjunction and answered a confident wrong column. The counter is
    // recognised by its SHAPE — `cond ? self + 1 : 0` — and by nothing else.
    const r = refusalOf([
      '//@version=6',
      'indicator("s")',
      'var float total = 0.0',
      'total := total + volume',
      'plot(total > 1000 ? 1 : 0)',
      '',
    ].join('\n'))
    expect(r.guard).toBe('pine:state')
  })

  it('⛔ an increment that is not ONE is not a run length', () => {
    expect(refusalOf(SRC(0, 'downRun >= 3').replace('downRun + 1', 'downRun + 2')).guard)
      .toBe('pine:state')
  })

  it('⛔ a reset to something other than ZERO is a different recurrence', () => {
    expect(refusalOf(SRC(0, 'downRun >= 3').replace(': 0', ': 1')).guard).toBe('pine:state')
  })

  it('⛔ a NEGATIVE seed could disagree on the first bar this tree can answer', () => {
    // Where the run reaches back past bar zero the counter reads `seed + t + 1`,
    // which a negative seed can hold UNDER K while K bars of `cond` are all true.
    // Declining is the honest answer; clamping would invent one.
    expect(refusalOf(SRC(-5, 'downRun >= 3')).guard).toBe('pine:state')
  })

  it('⛔ the counter bare, and against a SERIES, still refuse', () => {
    expect(refusalOf(SRC(0, 'close > downRun')).guard).toBe('pine:state')
    expect(refusalOf([
      '//@version=6',
      'indicator("s")',
      'var int downRun = 0',
      'downRun := close < close[1] ? downRun + 1 : 0',
      'plot(downRun > ta.sma(close, 5) ? 1 : 0)',
      '',
    ].join('\n')).guard).toBe('pine:state')
  })

  it('⛔ past the expansion ceiling it declines rather than emitting thousands of nodes', () => {
    expect(refusalOf(SRC(0, 'downRun >= ' + (PINE_RUN_LENGTH_MAX + 1))).guard).toBe('pine:state')
    // …and one INSIDE the ceiling still translates, so the ceiling is a boundary
    // rather than an off switch.
    const ok = translatePine(SRC(0, 'downRun >= ' + PINE_RUN_LENGTH_MAX))
    expect(ok.ok, ok.ok ? '' : ok.refusal.message).toBe(true)
  })

  it('⛔ `>= 0` is not a screen and is not pretended to be one', () => {
    // A run of zero bars is vacuously true; there is no conjunction to build and
    // nothing honest to answer, so it falls through to the ordinary refusal.
    expect(refusalOf(SRC(0, 'downRun >= 0')).guard).toBe('pine:state')
  })
})
