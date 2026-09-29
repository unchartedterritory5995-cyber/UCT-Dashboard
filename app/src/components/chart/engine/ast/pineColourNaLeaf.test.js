// app/src/components/chart/engine/ast/pineColourNaLeaf.test.js
//
// ─── `na` IS A COLOUR: THE ABSENT ONE — AND EACH PALETTE ENTRY KEEPS ITS ALPHA ─
//
// Measured against TradingView (vendor harness, NYSE:RDDT 1D, 2026-09-28):
//   · Ultimate Pivot Points' `x == nz(x[1]) ? color.new(c, 10) : na` lines drew
//     the pane's gold where TradingView drew c at 90% on the bars x repeats and
//     NOTHING on the rest (its colorer reads `null` there).
//   · Artemis' `plot(vpShow ? 50 : na, "VP Base", color = na)` drew a gold line
//     at 50 on 632/632 bars; TradingView's style colour is `rgba(0,0,0,0)`.
//   · Momentum Volatility Scanner's histogram mixes `color.new(#81C784, 40)`
//     with opaque colours and drew `#81c784ff` where TradingView drew
//     `#81c78499` on 532 bars — one opacity for the whole palette.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const V5 = '//@version=5\nindicator("t")\n'
const pres = (src, opts) => {
  const t = translatePine(src, opts)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[0].presentation
}

describe('`cond ? <colour> : na` is carried — `na` is a TRANSPARENT palette entry', () => {
  it('⭐ the Ultimate Pivot Points shape', () => {
    const p = pres(`${V5}plot(close, color = close > open ? color.new(color.green, 10) : na)\n`)
    expect(p.colorPalette).toEqual(['#4CAF50', 'rgba(0, 0, 0, 0)'])
    expect(p.colorIndex.formula).toBe('close > open ? 0 : 1')
    expect(p.opacity).toBeCloseTo(0.9, 10)
    expect(p.colorNaGated).toBeUndefined()
  })

  it('⛔ CONTROL — a rule of ONLY `na` leaves carries nothing (a hidden plot, not a colour rule)', () => {
    const p = pres(`${V5}plot(close, color = close > open ? na : na)\n`)
    expect(p.colorPalette).toBeUndefined()
    expect(p.colorNaGated).toBe(true)
  })

  it('⛔ R36 — the carried rule mints no parameter; the legacy two-colour rule still does', () => {
    const gate = translatePine(`${V5}th = input.float(1.5, "Gate")\nplot(close, color = close > th ? color.green : na)\n`, { strict: true, paramManifest: true })
    expect(gate.outputs[0].presentation.colorIndex.formula).toBe('close > 1.5 ? 0 : 1')
    expect(gate.inputParams || []).toEqual([])
    // CONTROL — the rule carried before this change keeps minting (its ids are pinned)
    const two = translatePine(`${V5}th = input.float(1.5, "Gate")\nplot(close, color = close > th ? color.green : color.red)\n`, { strict: true, paramManifest: true })
    expect((two.inputParams || []).map((x) => x.title || x.label)).toEqual(['Gate'])
  })
})

describe('`color = na` is a colour — drawn in nothing', () => {
  it('⭐ the Artemis VP Base shape: black at opacity 0, what TradingView stores', () => {
    expect(pres(`${V5}plot(close, color = na)\n`)).toMatchObject({ color: '#000000', opacity: 0 })
  })
  it('⛔ a `transp=` never makes the absent colour visible', () => {
    expect(pres('//@version=4\nstudy("t")\nplot(close, color = na, transp = 50)\n')).toMatchObject({ color: '#000000', opacity: 0 })
    // CONTROL — on a real colour the same `transp` still applies
    expect(pres('//@version=4\nstudy("t")\nplot(close, color = color.red, transp = 50)\n').opacity).toBeCloseTo(0.5, 10)
  })
})

describe('each palette entry keeps its own alpha when the entries disagree', () => {
  it('⭐ the Momentum Volatility Scanner shape: the 40%-transparent entry carries 0.6', () => {
    const p = pres(`${V5}weak = color.new(#81C784, 40)\nplot(close, color = close > open ? (close > close[1] ? #4CAF50 : weak) : #FF5252)\n`)
    expect(p.colorPalette).toEqual(['#4CAF50', 'rgba(129, 199, 132, 0.6)', '#FF5252'])
    expect(p.opacity).toBeUndefined()
  })
  it('⛔ CONTROL — entries that AGREE on an alpha keep riding the plot opacity, as before', () => {
    const p = pres(`${V5}plot(close, color = close > open ? (close > close[1] ? color.new(#4CAF50, 40) : color.new(#81C784, 40)) : color.new(#FF5252, 40))\n`)
    expect(p.colorPalette).toEqual(['#4CAF50', '#81C784', '#FF5252'])
    expect(p.opacity).toBeCloseTo(0.6, 10)
  })
})
