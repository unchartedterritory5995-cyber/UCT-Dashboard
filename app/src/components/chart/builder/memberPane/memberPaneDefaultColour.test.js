// app/src/components/chart/builder/memberPane/memberPaneDefaultColour.test.js
//
// ─── A PLOT THAT NAMES NO COLOUR WEARS TRADINGVIEW'S, NOT OURS ─────────────────
//
// ⚰️ MEASURED AGAINST TRADINGVIEW, 2026-09-27 (live captures on NYSE:RDDT 1D,
// `probe-default-colour-v{3,4,6}` and `probe-sparse-rows`): a `plot`, `plotshape`
// or `plotchar` with no colour draws #2962FF at every version, v3 at 35%
// transparency. The member pane handed such a row to the sheet colourless and the
// sheet painted it the engine's own gold — every bar of the sparse-rows probe
// diverged on colour alone.
//
// ⭐ The live proof is `vendorHarness.liveCaptures.test.js`; this pins the
// document shape, and what the default must NEVER overwrite.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import { DEFAULT_SERIES_COLOUR } from '../../engine/pinePalette'

const Q = String.fromCharCode(34)
const build = (version, body) => {
  const decl = version < 5 ? 'study' : 'indicator'
  const d = memberPaneDefinition({
    source: `//@version=${version}\n${decl}(${Q}t${Q})\n${body}\n`, id: 'u_default', name: 'default',
  })
  expect(d.ok, d.reason).toBe(true)
  return d.rows.filter((r) => !r.hidden)
}

describe('no colour at all is TradingView\'s default', () => {
  it('⭐ plot, plotshape and plotchar with no colour draw #2962FF, opaque, from v4 on', () => {
    for (const v of [4, 5, 6]) {
      const plots = build(v, `plot(close, ${Q}a${Q})\nplotshape(close > open, ${Q}b${Q})\nplotchar(close < open, ${Q}c${Q})`)
      expect(plots.map((p) => p.color), `v${v}`).toEqual([DEFAULT_SERIES_COLOUR, DEFAULT_SERIES_COLOUR, DEFAULT_SERIES_COLOUR])
      for (const p of plots) expect(p.opacity, `v${v}`).toBeUndefined()
    }
  })

  it('⭐ v3 draws it at 35% transparency', () => {
    const [p] = build(3, 'plot(close)')
    expect(p.color).toBe(DEFAULT_SERIES_COLOUR)
    expect(p.opacity).toBeCloseTo(0.65, 10)
  })

  it('⛔ v3 with the author\'s own transp keeps the author\'s transparency', () => {
    const [p] = build(3, 'plot(close, transp=80)')
    expect(p.color).toBe(DEFAULT_SERIES_COLOUR)
    expect(p.opacity).toBeCloseTo(0.2, 10)
  })

  it('⭐ …and it reaches the SAVED document, as the colour input\'s default', () => {
    const source = ['//@version=5', `indicator(${Q}t${Q})`, 'plot(close)', ''].join('\n')
    const d = memberPaneDefinition({ source, id: 'u_doc', name: 'doc' })
    expect(d.ok, d.reason).toBe(true)
    const ref = d.definition.plots[0].color
    const input = d.definition.inputs.find((i) => `$${i.key}` === ref)
    expect(input, `the plot's colour ${ref} names no input`).toBeTruthy()
    expect(input.default).toBe(DEFAULT_SERIES_COLOUR)
  })

  it('⛔ an explicit colour is never replaced — named or positional', () => {
    expect(build(5, 'plot(close, color = color.red)')[0].color).toBe('#FF5252')
    expect(build(5, `plot(close, ${Q}T${Q}, color.red)`)[0].color).toBe('#FF5252')
  })

  it('⛔ a CONDITIONAL colour is not painted over', () => {
    const [p] = build(5, 'plot(close, color = close > open ? color.green : color.red)')
    expect(p.colorMode).toMatch(/^column:/)
    expect(p.colorUp).toBe('#4CAF50')
  })

  it('⛔ a colour the translator could NOT carry stays uncarried, never guessed blue', () => {
    // A per-bar colour held in a variable the translator cannot fold: the author
    // said something, so the default does not apply.
    const [p] = build(5, 'var color c = na\nc := close > open ? color.lime : c\nplot(close, color = c)')
    expect(p.color).not.toBe(DEFAULT_SERIES_COLOUR)
  })
})
