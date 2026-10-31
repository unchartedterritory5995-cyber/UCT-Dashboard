// ⭐ thinkScript import gaps closed 2026-10-30: `Crosses(…)` and `WMA(…)`.
//
// Both are SPELLINGS of identities this translator already reaches, so the
// rails compare TREES against the existing spelling (hash equality) and then
// check the value against an independent computation on synthetic bars.
//   Crosses — /center/reference/thinkScript/Functions/Math---Trig/Crosses
//   WMA     — /center/reference/thinkScript/Functions/Tech-Analysis/WMA
import { describe, it, expect } from 'vitest'
import { translateThinkScript } from './thinkscript.js'
import { astHash } from './parse.js'
import { interpret } from './interpret.js'

const out = (src) => {
  const r = translateThinkScript(src)
  return r.outputs && r.outputs[0]
}
const ast = (src) => {
  const o = out(src)
  expect(o && o.ast, JSON.stringify(o && o.refusal)).toBeTruthy()
  return o.ast
}
const refusal = (src) => {
  const r = translateThinkScript(src)
  const o = r.outputs && r.outputs[0]
  return (o && o.refusal) || r.refusal
}

function synthBars(n = 120, seed = 3) {
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const bars = []
  let c = 50
  for (let i = 0; i < n; i++) {
    const o = c
    c = Math.max(5, c + (rnd() - 0.5) * 3)
    bars.push({ t: 1000000000 + i * 86400, o, h: Math.max(o, c) + rnd(), l: Math.min(o, c) - rnd(), c, v: 1000 })
  }
  return bars
}

describe('thinkScript Crosses(data1, data2, direction)', () => {
  it('⭐ each direction is the same tree as the human-readable crossing', () => {
    expect(astHash(ast('plot x = Crosses(close, Average(close, 10), CrossingDirection.ABOVE);')))
      .toBe(astHash(ast('plot x = close crosses above Average(close, 10);')))
    expect(astHash(ast('plot x = Crosses(close, Average(close, 10), CrossingDirection.BELOW);')))
      .toBe(astHash(ast('plot x = close crosses below Average(close, 10);')))
    expect(astHash(ast('plot x = Crosses(close, Average(close, 10), CrossingDirection.ANY);')))
      .toBe(astHash(ast('plot x = close crosses Average(close, 10);')))
  })

  it('the published default direction is ANY', () => {
    expect(astHash(ast('plot x = Crosses(close, Average(close, 10));')))
      .toBe(astHash(ast('plot x = close crosses Average(close, 10);')))
  })

  it('named arguments land in their slots', () => {
    expect(astHash(ast('plot x = Crosses(data2 = Average(close, 10), data1 = close, direction = CrossingDirection.ABOVE);')))
      .toBe(astHash(ast('plot x = close crosses above Average(close, 10);')))
  })

  it('⭐ ABOVE fires exactly where the page’s own example does: close > avg and close[1] <= avg[1]', () => {
    const bars = synthBars()
    const got = interpret(ast('plot x = Crosses(close, Average(close, 10), CrossingDirection.ABOVE);'), bars)
    const avg = bars.map((_, i) => (i < 9 ? NaN : bars.slice(i - 9, i + 1).reduce((s, b) => s + b.c, 0) / 10))
    let fired = 0
    for (let i = 10; i < bars.length; i++) {
      const want = bars[i].c > avg[i] && bars[i - 1].c <= avg[i - 1]
      expect(Boolean(got[i]), `bar ${i}`).toBe(want)
      if (want) fired++
    }
    expect(fired).toBeGreaterThan(0)   // non-vacuity
  })

  it('a direction that is not a literal CrossingDirection arm refuses, saying how to write it', () => {
    const r = refusal('input up = yes;\nplot x = Crosses(close, Average(close, 10), up);')
    expect(r.guard).toBe('thinkscript:enum-arm')
    expect(r.message).toMatch(/CrossingDirection\.ABOVE, CrossingDirection\.BELOW or CrossingDirection\.ANY/)
  })

  it('a missing data2 refuses by name', () => {
    const r = refusal('plot x = Crosses(close);')
    expect(r.guard).toBe('thinkscript:arity')
    expect(r.message).toMatch(/`data2` has no value/)
  })

  it('control: the infix `crosses` operator is untouched', () => {
    expect(out('plot x = close crosses above 5;').formula).toBe('crossOver(close, 5)')
  })
})

describe('thinkScript WMA(data, length)', () => {
  it('⭐ is the same tree as MovingAverage(AverageType.WEIGHTED, …)', () => {
    expect(astHash(ast('plot x = WMA(close, 20);')))
      .toBe(astHash(ast('plot x = MovingAverage(AverageType.WEIGHTED, close, 20);')))
    expect(out('plot x = WMA(close, 20);').formula).toBe('wma(close, 20)')
  })

  it('takes its OWN published default length, 9', () => {
    expect(out('plot x = WMA(close);').formula).toBe('wma(close, 9)')
  })

  it('weights the newest bar heaviest, as the page describes (independent check)', () => {
    const bars = synthBars()
    const got = interpret(ast('plot x = WMA(close, 5);'), bars)
    for (let i = 4; i < bars.length; i++) {
      let num = 0
      for (let j = 0; j < 5; j++) num += bars[i - j].c * (5 - j)
      expect(Math.abs(got[i] - num / 15), `bar ${i}`).toBeLessThan(1e-9)
    }
  })
})
