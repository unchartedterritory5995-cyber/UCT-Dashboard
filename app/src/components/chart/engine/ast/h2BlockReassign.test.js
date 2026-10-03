import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

/**
 * ⭐⭐ H2 (step 69) — a BLOCK-VALUED REASSIGNMENT: `x := if …` and a subject-less
 * `x := switch`, at the top level and inside a helper.
 *
 *     londonLow := if londonSession          — sessions:41 (x8)
 *     _direction := switch                   — 3-level-zigzag-semafor:18, in zigzag()
 *
 * Both refused `pine:block` ("a Pine block spans several statements"): the value
 * readers existed for `x = if …` and `x = switch subject`, never for `:=`. Pine
 * defines each as the ternary chain it spells, so the rail is equality with that
 * chain written out — trees compared whole.
 */
const src = (body) => `//@version=5\nindicator("t")\n${body}\n`
const shapeOf = (out) => JSON.stringify({
  refusal: out.refusal && out.refusal.guard,
  outputs: (out.outputs || []).map((o) => ({ kind: o.kind, ast: o.ast || null, refusal: o.refusal && o.refusal.guard })),
})
const same = (block, ternary) => {
  const a = translatePine(src(block))
  const b = translatePine(src(ternary))
  expect(b.refusal, 'the written-out form must itself translate').toBe(null)
  expect(b.outputs.length).toBeGreaterThan(0)
  for (const o of b.outputs) expect(o.refusal, JSON.stringify(o.refusal)).toBe(null) // non-vacuity: a tree to compare
  expect(shapeOf(a)).toBe(shapeOf(b))
  return a
}
const guardOf = (body) => {
  const t = translatePine(src(body))
  return (t.refusal && t.refusal.guard) || ((t.outputs || []).find((o) => o.refusal) || {}).refusal?.guard || null
}

describe('H2 — `x := if …` is the ternary it spells', () => {
  it('⭐ top level, with an else', () => {
    same('float x = na\nx := if close > open\n    1\nelse\n    2\nplot(x)',
      'float x = na\nx := close > open ? 1 : 2\nplot(x)')
  })

  it('⭐ the sessions shape: a nested if, the name\'s own history, and its pre-assignment value', () => {
    same([
      'sess = close > open',
      'nb = close > close[1]',
      'float lo = na',
      'lo := if sess',
      '    if nb',
      '        low',
      '    else',
      '        math.min(lo[1], low)',
      'else',
      '    lo',
      'plot(lo)',
    ].join('\n'), [
      'sess = close > open',
      'nb = close > close[1]',
      'float lo = na',
      'lo := sess ? (nb ? low : math.min(lo[1], low)) : lo',
      'plot(lo)',
    ].join('\n'))
  })

  it('⭐ inside a helper', () => {
    same('f() =>\n    float x = na\n    x := if close > open\n        high\n    else\n        low\n    x\nplot(f())',
      'f() =>\n    float x = na\n    x := close > open ? high : low\n    x\nplot(f())')
  })
})

describe('H2 — a subject-less `x := switch` is the ternary chain it spells', () => {
  it('⭐ comparison arms read as they are; the bare arm is the last `else`', () => {
    same('float x = na\nx := switch\n    close > open => 1\n    close < open => -1\n    => 0\nplot(x)',
      'float x = na\nx := close > open ? 1 : close < open ? -1 : 0\nplot(x)')
  })

  it('⭐ no bare arm: the switch yields na', () => {
    same('float x = na\nx := switch\n    close > open => 1\nplot(x)',
      'float x = na\nx := close > open ? 1 : na\nplot(x)')
  })

  it('⭐ a condition that is not a comparison is read through nz — an na condition is false, not na', () => {
    same('up = close > open\nfloat x = na\nx := switch\n    up[1] and up => 1\n    => 0\nplot(x)',
      'up = close > open\nfloat x = na\nx := nz(up[1] and up) ? 1 : 0\nplot(x)')
  })

  it('⭐⭐ the 3-level-zigzag shape: inside a helper, reading its own previous value', () => {
    const body = (rhs) => [
      'zz() =>',
      '    bool u = close >= open',
      '    bool d = close <= open',
      `    int dir = na , dir := ${rhs}`,
      '    dir',
      'plot(zz())',
    ].join('\n')
    const out = same(
      body('switch\n        u[1] and d => -1\n        d[1] and u =>  1\n        => nz(dir[1])'),
      body('nz(u[1] and d) ? -1 : nz(d[1] and u) ? 1 : nz(dir[1])'))
    expect(JSON.stringify(out.outputs[0].ast)).toContain('accum')
  })

  it('⛔ the binding the reassignment replaces is the one its right side reads', () => {
    // `x` on the right is the value a moment ago (1), not the switch's own result
    same('x = 1.0\nx := switch\n    close > open => x + 1\n    => x\nplot(x)',
      'x = 1.0\nx := close > open ? x + 1 : x\nplot(x)')
  })
})

describe('H2 — what stays refused', () => {
  it('⛔ a switch WITH a subject in `:=` keeps its refusal (not this reader)', () => {
    expect(guardOf('m = "a"\nx = 0.0\nx := switch m\n    "a" => 1\n    => 2\nplot(x)')).toBe('pine:block')
  })

  it('⛔ an arm with a block beneath it keeps the refusal', () => {
    expect(guardOf('x = 0.0\nx := switch\n    close > open =>\n        1\n    => 2\nplot(x)')).toBe('pine:block')
  })

  it('⛔ a bare arm that is not last keeps the refusal', () => {
    expect(guardOf('x = 0.0\nx := switch\n    => 2\n    close > open => 1\nplot(x)')).toBe('pine:block')
  })

  it('⛔ a compound operator is not a block-valued reassignment', () => {
    expect(guardOf('x = 0.0\nx += if close > open\n    1\nelse\n    2\nplot(x)')).toBe('pine:block')
  })
})
