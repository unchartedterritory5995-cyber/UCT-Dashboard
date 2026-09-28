// app/src/components/chart/engine/ast/pineOffsetColour.test.js
//
// ─── A RIGHTWARD `offset = N` MOVES THE COLOUR WITH THE VALUE ────────────────
//
// The value's tree is `x[N]`. The colour rule beside it was the UNdisplaced
// `cond`, so bar j drew bar j-N's value in bar j's colour. TradingView keeps a
// plot's value and colour in one study-data row, keyed to the computing bar,
// and draws the row N bars right (vendor harness, 2026-09-28: TradingView
// exports the UNSHIFTED series — position-size-calculator's `offset = 20`).
// And the translator now SAYS the shift was an offset (`_treeShift`), because
// the tree cannot tell `plot(x, offset = N)` from `plot(x[N])`.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const V5 = '//@version=5\nindicator("t")\n'
const out0 = (src) => {
  const t = translatePine(src)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[0]
}

describe('a positive offset displaces the colour rule with the value', () => {
  it('⭐ two colours: the condition is read N bars back, like the value', () => {
    const o = out0(`${V5}plot(close, color = close > open ? #00FF00 : #FF0000, offset = 3)\n`)
    expect(o.formula).toBe('close[3]')
    expect(o.presentation.colorCondition.formula).toBe('(close > open)[3]')
  })
  it('⭐ a palette chain: the index is read N bars back', () => {
    const o = out0(`${V5}plot(close, color = close > open ? #00FF00 : close < open ? #FF0000 : #0000FF, offset = 3)\n`)
    expect(o.presentation.colorIndex.formula).toBe('(close > open ? 0 : close < open ? 1 : 2)[3]')
  })
  it('⛔ CONTROL — a NEGATIVE offset leaves both undisplaced (the renderer shifts the drawing)', () => {
    const o = out0(`${V5}plot(close, color = close > open ? #00FF00 : #FF0000, offset = -3)\n`)
    expect(o.formula).toBe('close')
    expect(o.presentation.colorCondition.formula).toBe('close > open')
    expect(o.displace).toBe(-3)
  })
})

describe('the row says which it was: `offset = N` or `x[N]`', () => {
  it('⭐ `_treeShift` is N for a positive offset — and invisible to the row\'s shape', () => {
    const o = out0(`${V5}plot(close, offset = 3)\n`)
    expect(o._treeShift).toBe(3)
    expect(Object.keys(o)).not.toContain('_treeShift')
  })
  it('⛔ CONTROL — the same tree written as `close[3]` carries no shift', () => {
    const o = out0(`${V5}plot(close[3])\n`)
    expect(o.formula).toBe('close[3]')
    expect(o._treeShift).toBeUndefined()
  })
})
