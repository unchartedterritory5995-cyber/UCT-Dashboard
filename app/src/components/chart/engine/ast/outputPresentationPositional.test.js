// app/src/components/chart/engine/ast/outputPresentationPositional.test.js
//
// ─── A POSITIONAL COLOUR, AND NO COLOUR AT ALL ────────────────────────────────
//
// ⚰️ Two presentation defects found against live TradingView captures
// (2026-09-27, NYSE:RDDT 1D), both drawing the WRONG colour with every value
// right:
//
//   1. `plot(close, "T", color.red)` — Pine's third positional parameter IS the
//      colour, and this door read NAMED arguments only. The colour was dropped.
//   2. `plot(close)` — no colour at all. TradingView draws #2962FF at v3, v4, v5
//      and v6 (v3 at 35% transparency); the engine drew its own gold. That one is
//      a RENDERING default, applied at the member door rather than here — see
//      `builder/memberPane/memberPaneDefaultColour.test.js`.
//
// ⭐ This file pins case 1, including what it must NOT do: index 5 is `transp` in
// v4 and `trackprice` in v5, so it is left alone.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'

const Q = String.fromCharCode(34)
const pres = (version, body) => {
  const decl = version < 5 ? 'study' : 'indicator'
  const r = translatePine(`//@version=${version}\n${decl}(${Q}t${Q})\n${body}\n`, { strict: false })
  expect(r.ok, `${body}: ${(r.refusal || {}).message}`).toBe(true)
  return (r.outputs || []).map((o) => o.presentation)
}

describe('a positional colour is the colour', () => {
  it('⭐ plot(series, title, COLOR, LINEWIDTH) carries both', () => {
    const [p] = pres(6, `plot(close, ${Q}T${Q}, color.red, 3)`)
    expect(p.color).toBe('#F23645')          // v6's red — the palette, per version
    expect(p.width).toBe(3)
  })

  it('⭐ plotshape(series, title, STYLE, LOCATION, COLOR) carries all three', () => {
    const [p] = pres(6, `plotshape(close > open, ${Q}S${Q}, shape.triangleup, location.belowbar, color.green)`)
    expect(p.color).toBe('#4CAF50')
    expect(p.marker.pineShape).toBe('shape.triangleup')
    expect(p.marker.position).toBe('belowBar')
  })

  it('⭐ plotchar(series, title, CHAR, LOCATION, COLOR) carries the colour', () => {
    const [p] = pres(5, `plotchar(close > open, ${Q}C${Q}, ${Q}x${Q}, location.top, color.orange)`)
    expect(p.color).toBe('#FF9800')
  })

  it('⛔ a NAMED argument wins over nothing — and the positional slot is not read twice', () => {
    const [p] = pres(6, `plot(close, ${Q}T${Q}, color=color.blue, linewidth=2)`)
    expect(p.color).toBe('#2962FF')
    expect(p.width).toBe(2)
  })

  it('⛔ index 5 is NOT mapped — v4 transp and v5 trackprice disagree there', () => {
    // A sixth positional must not become an opacity on v5 (it is trackprice).
    const [p] = pres(5, `plot(close, ${Q}T${Q}, color.red, 2, plot.style_line, true)`)
    expect(p.color).toBe('#FF5252')
    expect(p.opacity).toBeUndefined()
  })
})

describe('no colour at all is ABSENT in the translator', () => {
  it('⛔ the translator reports what the author wrote — a bare plot carries no colour', () => {
    // TradingView's default is a RENDERING rule, applied at the member door
    // (`builder/memberPane/memberPaneDefaultColour.test.js`); "absent is absent".
    const ps = pres(6, 'plot(close)\nplotshape(close > open)\nplotchar(close < open)')
    expect(ps).toHaveLength(3)
    for (const p of ps) expect(p.color).toBeUndefined()
  })
})
