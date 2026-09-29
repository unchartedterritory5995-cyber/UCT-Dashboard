// app/src/components/chart/engine/ast/pineColourNaSelector.test.js
//
// ─── OWNER RULING 2 (2026-09-28): AN `na` COLOUR CONDITION TAKES THE ELSE
// BRANCH — THE GRAPH LANE'S PALETTE INDEX ────────────────────────────────────
//
// Pine's `cond ? a : b` over colours is `b` when `cond` is `na`. A palette's
// index column is an ordinary `?:` tree, and this engine's `?:` answers NaN for
// a NaN test (`interpret.js::TERNARY`) — so every bar a selector was `na` got no
// palette entry and the binder drew the series colour, a colour neither the
// script nor TradingView chose. The index is built with each `na`-able selector
// read as `t != 0`, which is 0 for NaN by the comparison rule both kernels pin.
//
// The two-colour lane is the binder's (`binder.js::pointColour`, rail
// `dynamicColourColumn.test.js`); the runtime lane is the front end's
// (`runtime/__tests__/colourNaSelector.test.js`).
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { BINARY, TERNARY } from './interpret.js'

const V5 = '//@version=5\nindicator("t")\n'
const presOf = (src) => {
  const t = translatePine(V5 + src)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[0].presentation
}

// A `var bool` state that is `na` until the first rise or fall — the shape of
// Trend Duration Forecast's `trend`.
const STATE = 'var bool trend = na\nif ta.rising(close, 3)\n    trend := true\nif ta.falling(close, 3)\n    trend := false\n'

describe('a palette\'s `na` selector takes the else branch', () => {
  it('⭐⭐ a selector that can be `na` is read as `t != 0`, and only that one', () => {
    const p = presOf(`${STATE}plot(close, "a", trend ? color.green : close > open ? color.red : color.gray)\n`)
    expect(p.colorPalette.length).toBe(3)
    const f = p.colorIndex.formula
    expect(f).toMatch(/\) != 0 \? 0 : /)
    // ⛔ a comparison can never be `na` and keeps its text
    expect(f).toMatch(/: close > open \? 1 : 2$/)
    expect(f.match(/!= 0/g).length).toBe(1)
  })

  it('⛔ CONTROL: a chain made only of comparisons keeps its formula byte for byte', () => {
    const p = presOf('plot(close, "a", close > open ? color.green : close < open ? color.red : color.gray)\n')
    expect(p.colorIndex.formula).toBe('close > open ? 0 : close < open ? 1 : 2')
  })

  it('⭐ and the arithmetic is the shared rule, not a new one: `na != 0` is 0', () => {
    expect(TERNARY(BINARY['!='](NaN, 0), 0, 1)).toBe(1)
    expect(TERNARY(BINARY['!='](1, 0), 0, 1)).toBe(0)
    // ⛔ the bare ternary the index used to be answers NaN — no entry at all
    expect(Number.isNaN(TERNARY(NaN, 0, 1))).toBe(true)
  })
})
