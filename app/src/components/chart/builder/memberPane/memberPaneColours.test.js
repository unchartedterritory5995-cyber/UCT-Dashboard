// app/src/components/chart/builder/memberPane/memberPaneColours.test.js
//
// ─── A MEMBER'S PLOT WEARS THE AUTHOR'S COLOUR — CONDITIONAL AND TRANSPARENT ──
//
// ⚰️⚰️ MEASURED AGAINST TRADINGVIEW, 2026-09-27 (vendor harness, live captures on
// NYSE:RDDT 1D, `tests/fixtures/vendor/harness/`). Two projections dropped what
// the translator had already understood:
//
//   1. A plot coloured by a condition between two static colours
//      (`plot(x, color = x > 0 ? color.green : color.red)`) — `outputPresentation`
//      carries `colorUp`/`colorDown`/`colorCondition`, `BuilderSheet`'s own import
//      mints the condition column, and the MEMBER PANE did not, so it drew in the
//      pane's default gold: Cumulative Volume Delta's histogram `#ff5252ff` on
//      TradingView vs `#c9a84cff` here, 618/618 bars.
//   2. A plot's opacity (`color.rgb(r, g, b, 70)`, v4 `transp=`) reached the pane's
//      ROWS but `buildDefinition` never copied it into the saved plot, so every
//      transparent Pine plot drew opaque: RVOL's threshold `#ffffff4d` vs
//      `#ffffffff` on 631/631.
//
// ⭐ The live proof is `vendorHarness.liveCaptures.test.js`; this file pins the
// document shape so a regression is caught without a capture.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'

const build = (source) => memberPaneDefinition({ source, id: 'u_colours', name: 'colours' })

const COND = [
  '//@version=5',
  "indicator('cc')",
  'd = close - open',
  'plot(d, color = d > 0 ? color.green : color.red, style = plot.style_columns)',
  '',
].join('\n')

describe('a conditionally coloured PLOT draws per point', () => {
  it('⭐ carries colorMode column:<key> with both colours, and the column is a hidden derived row', () => {
    const d = build(COND)
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots[0]
    expect(plot.colorMode).toMatch(/^column:/)
    expect(plot.colorUp).toBe('#4CAF50')
    expect(plot.colorDown).toBe('#FF5252')
    const key = plot.colorMode.slice('column:'.length)
    const condPlot = d.definition.plots.find((p) => p.key === key)
    expect(condPlot, 'the condition column the plot names must exist in the document').toBeTruthy()
    expect(condPlot.hidden).toBe(true)
  })

  it('⛔ CONTROL — a statically coloured plot carries no per-point mode', () => {
    const d = build("//@version=5\nindicator('s')\nplot(close, color = color.red)\n")
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.plots[0].colorMode).toBeUndefined()
  })

  it('⭐ a plot and a fill coloured by ONE condition share ONE column', () => {
    const src = [
      '//@version=5',
      "indicator('share')",
      'f = ta.sma(close, 5)',
      's = ta.sma(close, 20)',
      'up = f > s',
      "a = plot(f, 'Fast', color = up ? color.green : color.red)",
      "b = plot(s, 'Slow')",
      'fill(a, b, color = up ? color.green : color.red)',
      '',
    ].join('\n')
    const d = build(src)
    expect(d.ok, d.reason).toBe(true)
    const withMode = d.definition.plots.filter((p) => p.colorMode)
    const fillModes = d.definition.plots.filter((p) => p.fill && p.fill.colorMode)
    expect(withMode.length).toBe(1)
    expect(fillModes.length).toBe(1)
    expect(fillModes[0].fill.colorMode).toBe(withMode[0].colorMode)
    expect(d.definition.plots.filter((p) => p.hidden && p.key === withMode[0].colorMode.slice(7)).length).toBe(1)
  })
})

describe("a plot's OPACITY reaches the saved document", () => {
  it('⭐ color.rgb(…, 70) becomes plots[].opacity 0.3', () => {
    const d = build("//@version=5\nindicator('o')\nplot(open, color = color.rgb(255, 255, 255, 70))\n")
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.plots[0].opacity).toBeCloseTo(0.3, 6)
  })

  it('⭐ the Pine v4 transp= argument becomes plots[].opacity', () => {
    const d = build("//@version=4\nstudy('t')\nplot(close, color = color.green, transp = 70)\n")
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.plots[0].opacity).toBeCloseTo(0.3, 6)
  })

  it('⛔ CONTROL — an opaque plot carries no opacity', () => {
    const d = build("//@version=5\nindicator('n')\nplot(close, color = color.red)\n")
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.plots[0].opacity).toBeUndefined()
  })
})

// ⚰️ MEASURED ON A LIVE CAPTURE (cc-yata, NYSE:RDDT 1D, 2026-09-27): the
// transparency hid behind a NAME. `S = input.color(color.new(#90EE90, 25))` then
// `color = S` carried the colour and dropped the alpha — Support and Resistance
// drew opaque where TradingView drew `#90ee90bf`. The same colour written inline
// always kept it; only the name, and the input's default, hid it.
describe('a transparency behind a NAME or an input default is carried', () => {
  const rowOf = (body) => {
    const d = build(`//@version=5\nindicator('t')\n${body}\n`)
    expect(d.ok, d.reason).toBe(true)
    return d.rows.filter((r) => !r.hidden)[0]
  }

  it('⭐ a name bound to input.color(color.new(c, 25)) draws at 75% opacity', () => {
    const r = rowOf("S = input.color(color.new(#90EE90, 25), title='s')\nplot(close, color = S)")
    expect(r.color).toBe('#90EE90')
    expect(r.opacity).toBeCloseTo(0.75, 10)
  })

  it('⭐ input.color(color.new(...)) written inline too', () => {
    expect(rowOf('plot(close, color = input.color(color.new(#90EE90, 25)))').opacity).toBeCloseTo(0.75, 10)
  })

  it('⭐ a name bound to color.new(c, 60) draws at 40% opacity', () => {
    const r = rowOf('C = color.new(color.red, 60)\nplot(close, color = C)')
    expect(r.color).toBe('#FF5252')
    expect(r.opacity).toBeCloseTo(0.4, 10)
  })

  it('⛔ CONTROL — an opaque colour behind a name or an input stays opaque', () => {
    expect(rowOf('C = color.red\nplot(close, color = C)').opacity).toBeUndefined()
    expect(rowOf("S = input.color(#90EE90, title='s')\nplot(close, color = S)").opacity).toBeUndefined()
  })
})
