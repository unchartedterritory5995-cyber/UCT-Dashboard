// app/src/components/chart/engine/ast/colorNewOverRule.test.js
//
// ─── F9 — `color.new(<a per-bar colour rule>, t)` IS THAT RULE AT ONE ALPHA ────
//
// The rule is `pine.js::colorNewOverRule`; its vendor rail is
// `vendorHarness.f9Divergences.test.js` (CAP4 `vw-rt8-runtime-followups` S03:
// TradingView `#2962ff99` / `#ff980099` per bar, this door drew the pane's gold on
// 636 of 636 bars). This file pins the SHAPE the translator writes and each
// decline beside it: a colour carried where Pine's rule is not witnessed would be
// a colour drawn wrong.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const LF = String.fromCharCode(10)
const src = (...lines) => ['//@version=6', 'indicator("f9")', ...lines].join(LF) + LF
const pres = (...lines) => translatePine(src(...lines), {}).outputs[0].presentation

describe('F9 — color.new over a two-colour test', () => {
  it('⭐ S03\'s shape: the test is carried, both colours plain, the alpha is 1 - t/100', () => {
    const p = pres('plotshape(true, "S03", shape.square, location.top, color = color.new(close > open ? color.blue : color.orange, 40))')
    expect(p.colorDynamic).toBeUndefined()
    expect(p.colorCondition.formula).toBe('close > open')
    expect(p).toMatchObject({ colorUp: '#2962FF', colorDown: '#FF9800', opacity: 0.6 })
  })

  it('the same on a plot, and with Pine\'s own argument names', () => {
    const p = pres('plot(close, color = color.new(transp = 25, color = close > open ? color.lime : color.red))')
    expect(p.colorCondition.formula).toBe('close > open')
    expect(p).toMatchObject({ colorUp: '#00E676', colorDown: '#F23645', opacity: 0.75 })
  })

  it('a NAME bound to the test is followed', () => {
    const p = pres('c = close > open ? color.blue : color.orange', 'plot(close, color = color.new(c, 40))')
    expect(p).toMatchObject({ colorUp: '#2962FF', colorDown: '#FF9800', opacity: 0.6 })
  })

  it('color.new REPLACES each leaf\'s own alpha (Pine\'s rule, as on a static colour)', () => {
    const p = pres('plot(close, color = color.new(close > open ? color.new(color.blue, 90) : color.orange, 40))')
    expect(p).toMatchObject({ colorUp: '#2962FF', colorDown: '#FF9800', opacity: 0.6 })
  })

  it('a fractional transparency is held whole, truncated (C29)', () => {
    expect(pres('plot(close, color = color.new(close > open ? color.blue : color.orange, 40.9))').opacity).toBe(0.6)
  })
})

describe('F9 — color.new over an n-way chain', () => {
  it('the palette is plain colours and the one alpha rides the plot', () => {
    const p = pres('plot(close, color = color.new(close > open ? color.green : close < open ? color.red : color.gray, 40))')
    expect(p.colorDynamic).toBeUndefined()
    expect(p.colorPalette).toEqual(['#4CAF50', '#F23645', '#787B86'])
    expect(p.opacity).toBe(0.6)
    expect(p.colorIndex.formula).toMatch(/close > open/)
  })

  it('leaves that disagreed on alpha are one alpha after color.new', () => {
    const p = pres('plot(close, color = color.new(close > open ? color.green : close < open ? color.new(color.red, 70) : color.gray, 20))')
    expect(p.colorPalette).toEqual(['#4CAF50', '#F23645', '#787B86'])
    expect(p.opacity).toBe(0.8)
  })
})

describe('F9 — what stays declined (`colorDynamic`), by rule', () => {
  it('⛔ an `na` leaf: color.new(na, t) is black at t (RT9), never witnessed inside a test', () => {
    const p = pres('plot(close, color = color.new(close > open ? color.blue : na, 40))')
    expect(p.colorDynamic).toBe(true)
    expect(p.colorIndex).toBeUndefined()
    expect(p.colorCondition).toBeUndefined()
  })

  it('⛔ a per-bar transparency', () => {
    const p = pres('plot(close, color = color.new(close > open ? color.blue : color.orange, close % 100))')
    expect(p.colorDynamic).toBe(true)
  })

  it('⛔ a base that is not a rule this door reads (a `var` colour reassigned per bar)', () => {
    const p = pres('var color c = color.white', 'if close > open', '    c := color.lime', 'plot(close, color = color.new(c, 40))')
    expect(p.colorDynamic).toBe(true)
  })

  it('control: a static base keeps the static path (colour + opacity, no rule)', () => {
    const p = pres('plot(close, color = color.new(color.red, 40))')
    expect(p).toMatchObject({ color: '#F23645', opacity: 0.6 })
    expect(p.colorCondition).toBeUndefined()
  })
})
