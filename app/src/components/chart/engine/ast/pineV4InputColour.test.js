// app/src/components/chart/engine/ast/pineV4InputColour.test.js
//
// ─── v4's `input(<colour>, type = input.color)` IS THE SAME PICKER AS v5's ────
//
// Before `input.color()` existed, a colour input was the generic `input()` whose
// default is a colour. The presentation lane already reads `input.color(c)` as
// its default `c` (the approximation `staticColourOf` documents: at default
// inputs, the colour the author chose); this reads the v4 spelling of the same
// call the same way. Measured against TradingView (vendor harness, RDDT 1D
// 2026-09-28): Liquidation Levels' ten lines, `color = c_x1` … `c_x5`, each
// `input(color.aqua, …, type = input.color)`, drew the pane's gold where
// TradingView drew aqua/lime/yellow/orange/red; with this, all ten MATCH.
//
// ⚠️ OWNER-RULING ADJACENT: `input.color` has no recorded ruling in the RUNTIME
// lane (PARITY-PROGRAMME.md). This touches only the PRESENTATION lane, which has
// read `input.color`'s default since R35c — it extends that existing reading to
// the v4 spelling and decides nothing new. Revert this file's commit alone if
// the ruling goes the other way.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const V4 = '//@version=4\nstudy("t")\n'
const pres = (src) => {
  const t = translatePine(src)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[0].presentation
}

describe('v4 generic input() with a colour default', () => {
  it('⭐ reads the default, as input.color does', () => {
    expect(pres(`${V4}c = input(color.aqua, title = "c", type = input.color)\nplot(close, color = c)\n`).color).toBe('#00BCD4')
    // the SAME answer the v5 spelling has always given
    expect(pres('//@version=5\nindicator("t")\nc = input.color(color.aqua, "c")\nplot(close, color = c)\n').color).toBe('#00BCD4')
  })
  it('its alpha comes through too', () => {
    expect(pres(`${V4}c = input(color.new(color.aqua, 40), type = input.color)\nplot(close, color = c)\n`).opacity).toBeCloseTo(0.6, 10)
  })
  it('⛔ CONTROL — an input whose default is NOT a colour is never read as one', () => {
    const p = pres(`${V4}plot(close, color = input(14))\n`)
    expect(p.color).toBeUndefined()
  })
})
