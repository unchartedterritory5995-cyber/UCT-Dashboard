// app/src/components/chart/engine/ast/pine.obvAverage.test.js
//
// ─── ⭐⭐ THE BASELINE CANCELS, SO OBV-AGAINST-ITS-OWN-AVERAGE IS SAYABLE ─────
//
// `_functions_excluded.obv` stands: OBV is cumulative from the first bar and `obvN`
// is its only bounded form. The LEVEL has no absolute seed, so this engine cannot
// say what OBV IS — it can say how much OBV has CHANGED over k bars, which is
// `obvN(k)`, and an average of OBV over its own window is made of nothing else:
//
//     obv - sma(obv, n) = (1/n) · Σ(i=0..n-1) (obv - obv[i])
//                       = (1/n) · Σ(i=1..n-1) obvN(i)
//
// Every surviving term is a DIFFERENCE, so whatever the unknown baseline is it
// sits on both sides and disappears. n > 0, so multiplying through cannot flip
// the comparison.
//
// ⛔⛔ AND THAT IS MEASURED HERE, NOT ARGUED. The reference OBV below is built at
// THREE different baselines — zero, a million, and a negative number — and the
// engine's answer must match all three on every bar. A rule that had leaked the
// level rather than the differences would agree with exactly one of them.

import { describe, it, expect } from 'vitest'
import { translatePine, PINE_OBV_WINDOW_MAX } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret, maxLookback } from './interpret.js'
import table from './closedTable.json'

/** Closes that move BOTH ways and sometimes not at all — the flat bars exercise
 *  OBV's tie rule, which adds nothing on an unchanged close. */
const BARS = (() => {
  let px = 100
  const out = []
  for (let i = 0; i < 240; i++) {
    const move = i % 11 === 0 ? 0 : Math.sin(i / 4.1) + 0.4 * Math.sin(i / 1.3)
    px = Math.max(5, px + move)
    out.push({ t: 20260101 + i, o: px, h: px + 1, l: px - 1, c: px, v: 500 + ((i * 37) % 900) })
  }
  return out
})()

/** On-balance volume from its definition, seeded wherever the caller likes. */
function obvAt(baseline) {
  const out = [baseline]
  for (let i = 1; i < BARS.length; i++) {
    const v = BARS[i].v
    const prev = out[i - 1]
    out.push(BARS[i].c > BARS[i - 1].c ? prev + v : BARS[i].c < BARS[i - 1].c ? prev - v : prev)
  }
  return out
}

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length

const SRC = (body) => ['//@version=6', 'indicator("s")', 'plot(' + body + ' ? 1 : 0)', ''].join('\n')

function column(src) {
  const out = translatePine(src)
  expect(out.ok, out.ok ? '' : out.refusal.guard + ': ' + out.refusal.message).toBe(true)
  const parsed = parseFormula(out.outputs[out.selected].formula)
  expect(parsed.ok).toBe(true)
  return { values: interpret(parsed.ast, BARS, {}), ast: parsed.ast }
}

const BASELINES = [0, 1000000, -523117]

describe('⭐⭐ obv against its own average, MEASURED at three baselines', () => {
  const CASES = [
    { body: 'ta.obv < ta.sma(ta.obv, 10)', n: 10, want: (o, s) => o < s },
    { body: 'ta.obv > ta.sma(ta.obv, 10)', n: 10, want: (o, s) => o > s },
    { body: 'ta.obv >= ta.sma(ta.obv, 20)', n: 20, want: (o, s) => o >= s },
    { body: 'ta.obv <= ta.sma(ta.obv, 5)', n: 5, want: (o, s) => o <= s },
    { body: 'ta.obv < ta.sma(ta.obv, 2)', n: 2, want: (o, s) => o < s },
    // ⭐ EITHER ORDER, and the operator must flip with it.
    { body: 'ta.sma(ta.obv, 10) > ta.obv', n: 10, want: (o, s) => o < s },
  ]

  for (const { body, n, want } of CASES) {
    it('⭐ `' + body + '` matches the definition at every baseline', () => {
      const { values, ast } = column(SRC(body))
      const warm = maxLookback(ast)
      expect(Number.isFinite(warm)).toBe(true)
      // n - 1 is the furthest `obvN` reaches back; anything else is an off-by-one.
      expect(warm).toBe(n - 1)
      let compared = 0
      for (const baseline of BASELINES) {
        const obv = obvAt(baseline)
        for (let i = warm; i < BARS.length; i++) {
          if (!Number.isFinite(values[i])) continue
          const sma = mean(obv.slice(i - n + 1, i + 1))
          expect(values[i] === 1,
            'baseline ' + baseline + ' bar ' + i + ': obv=' + obv[i] + ' sma=' + sma)
            .toBe(want(obv[i], sma))
          compared++
        }
      }
      // ⛔ NON-VACUITY: the loop ran, and the column is not constant.
      expect(compared).toBeGreaterThan(400)
      const fired = values.slice(warm).filter((v) => v === 1).length
      expect(fired, '`' + body + '` never fired').toBeGreaterThan(0)
      expect(fired, '`' + body + '` fired on every bar')
        .toBeLessThan(values.slice(warm).filter(Number.isFinite).length)
    })
  }

  it('⛔ THE CONTROL: an off-by-one reference DISAGREES, so agreement means something', () => {
    // ⚰️ Summing to n instead of n-1 is the mistake this rule is one keystroke
    // from; measured on this series it disagrees on real bars. Without this the
    // whole file could be comparing a wrong tree against a wrong reference.
    const { values, ast } = column(SRC('ta.obv < ta.sma(ta.obv, 10)'))
    const warm = maxLookback(ast)
    const obv = obvAt(0)
    let disagreements = 0
    for (let i = 10; i < BARS.length; i++) {
      if (!Number.isFinite(values[i])) continue
      let sum = 0
      for (let k = 1; k <= 10; k++) sum += obv[i] - obv[i - k]
      if ((values[i] === 1) !== (sum < 0)) disagreements++
    }
    expect(disagreements).toBeGreaterThan(0)
  })

  it('⭐ the window may be an input, because that is how members write it', () => {
    const src = ['//@version=6', 'indicator("s")', 'n = input.int(10, "OBV avg")',
      'plot(ta.obv < ta.sma(ta.obv, n) ? 1 : 0)', ''].join('\n')
    const { values, ast } = column(src)
    const warm = maxLookback(ast)
    const obv = obvAt(0)
    let compared = 0
    for (let i = warm; i < BARS.length; i++) {
      if (!Number.isFinite(values[i])) continue
      expect(values[i] === 1).toBe(obv[i] < mean(obv.slice(i - 9, i + 1)))
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

  it('⛔⛔ `ta.obv` ALONE IS STILL REFUSED — the level did not become sayable', () => {
    // ⚰️ THE CONTROL THAT MATTERS MOST. What this rule adds is a comparison whose
    // baseline cancels; if it had instead invented a seed for OBV, this would
    // translate and every column built on it would be wrong by a constant nobody
    // could see.
    expect(refusalOf(SRC('ta.obv > 1000')).guard).toBe('pine:function')
    expect(refusalOf(SRC('ta.obv > ta.sma(close, 10)')).guard).toBe('pine:function')
  })

  it('⛔ an EXPONENTIAL average leaves an infinite tail, and is refused', () => {
    // `ema` weights every bar back to the first, so `obv - ema(obv, n)` does not
    // telescope into a finite tree. Truncating one would answer a confident wrong
    // number; this is the `sma`/`ema` distinction the rule is built on.
    expect(refusalOf(SRC('ta.obv > ta.ema(ta.obv, 30)')).guard).toBe('pine:function')
    expect(refusalOf(SRC('ta.obv >= ta.highest(ta.obv, 50)')).guard).toBe('pine:function')
  })

  it('⛔ an average of something ELSE is not this rule', () => {
    expect(refusalOf(SRC('ta.obv > ta.sma(volume, 10)')).guard).toBe('pine:function')
  })

  it('⛔⛔ THE SMOOTHED LEVEL AS A VALUE IS STILL REFUSED, which the ruling says', () => {
    // ⚰️ `_functions_excluded.obv` already ruled on this shape by name: smoothing
    // a fetch-dependent level leaves it fetch-dependent, so `OBV20` is not
    // `obvN(20)` and pointing it there would be the MIN/lowest trap. What this
    // rule adds is a COMPARISON in which the level appears on both sides and
    // cancels — never the level itself. If these ever translate, the rule has
    // leaked past the identity it is allowed to claim.
    expect(refusalOf(SRC('ta.sma(ta.obv, 20) > 1000')).guard).toBe('pine:function')
    expect(refusalOf(SRC('ta.sma(ta.obv, 20) > ta.sma(ta.obv, 10)')).guard).toBe('pine:function')
  })

  it('⭐ the RULING names this door, so the table and the code are one authority', () => {
    // ⛔ READ, NOT RETYPED. A member who pastes bare `ta.obv` is handed
    // `_functions_excluded.obv`; if that sentence does not mention the comparison
    // the engine now serves, the table and the translator disagree about what is
    // sayable and the member is told less than is true.
    const ruling = table._functions_excluded.obv
    expect(ruling).toContain('sma(obv, n)')
    expect(ruling).toContain('cancels')
    // …and it must keep saying the VALUE is refused, or it has been softened into
    // agreeing with a rule that never claimed that much.
    expect(ruling).toContain('THE VALUE IS STILL REFUSED')
  })

  it('⛔ `sma(obv, 1)` is `obv`, so the comparison is a constant and is declined', () => {
    expect(refusalOf(SRC('ta.obv < ta.sma(ta.obv, 1)')).guard).toBe('pine:function')
  })

  it('⛔ past the expansion ceiling it declines rather than emitting a wall of nodes', () => {
    expect(refusalOf(SRC('ta.obv < ta.sma(ta.obv, ' + (PINE_OBV_WINDOW_MAX + 1) + ')')).guard)
      .toBe('pine:function')
    // …and one INSIDE the ceiling still translates, so it is a boundary and not
    // an off switch.
    const ok = translatePine(SRC('ta.obv < ta.sma(ta.obv, ' + PINE_OBV_WINDOW_MAX + ')'))
    expect(ok.ok, ok.ok ? '' : ok.refusal.message).toBe(true)
  })
})
