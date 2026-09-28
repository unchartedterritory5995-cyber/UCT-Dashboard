// app/src/components/chart/engine/ast/objectColourTransparency.test.js
//
// ─── AN OBJECT'S COLOUR CARRIES ITS TRANSPARENCY ──────────────────────────────
//
// ⚰️ MEASURED 2026-09-27 on master `9b28d4fa4`: every drawing object painted a
// transparent colour SOLID. `box.new(…, bgcolor = color.new(color.red, 80))` was
// emitted as `{c:'lit', hex:'#F23645'}` — the 80 was read, validated, and
// thrown away — so a zone the author drew at 20% opacity covered the candles
// under it. `color.rgb(r, g, b, t)`'s fourth argument went the same way. Only an
// 8-digit `#RRGGBBAA` literal survived, because it was never parsed at all.
//
// `staticColourOf` returns a 3-channel hex by design (plots carry their alpha
// separately, as `presentation.opacity`); the object lane has one string per
// colour and no opacity field, so it must fold the transparency into the hex.
// `colourTransparencyOf` already answers that number for exactly the colours
// `staticColourOf` folds — the fix composes the two, it computes nothing new.
import { describe, it, expect } from 'vitest'
import { translatePine, colourHexByName } from './pine'

const HEAD = `//@version=6
indicator("t", overlay=true)
`

function ops(body) {
  const t = translatePine(HEAD + body + 'plot(close)\n', { strict: true })
  expect(t.objectDiagnostics.droppedOps, JSON.stringify(t.objectDiagnostics)).toBe(0)
  return (t.objects && t.objects.ops) || []
}

const create = (all, family) => all.find((o) => o.k === 'create' && o.family === family)
const lit = (prop) => {
  expect(prop && prop.v, JSON.stringify(prop)).toBe('color')
  expect(prop.node.c, JSON.stringify(prop)).toBe('lit')
  return prop.node.hex
}

// ⭐ Built-in bases are ASKED of the palette authority, never typed — v6's
// `color.green` is #4CAF50, and a hand-typed hex would test the typist.
const RED = colourHexByName('color.red', 6)
const GREEN = colourHexByName('color.green', 6)
const BLUE = colourHexByName('color.blue', 6)

// Pine opacity byte for a transparency t (0-100): round((1 - t/100) * 255).
const byte = (t) => Math.round((1 - t / 100) * 255).toString(16).padStart(2, '0').toUpperCase()

describe('⭐ a transparent colour reaches the object as #RRGGBBAA', () => {
  const all = ops(`var box b = na
var label l = na
var table tb = table.new(position.top_right, 1, 1, bgcolor = color.new(color.blue, 70))
if barstate.islast
    b := box.new(bar_index - 5, high, bar_index, low, bgcolor = color.new(color.red, 80), border_color = color.rgb(0, 255, 0, 50))
    l := label.new(bar_index, high, "x", color = color.new(#2962FF, 90), textcolor = color.white)
`)

  it('box bgcolor = color.new(color.red, 80)', () => {
    expect(lit(create(all, 'box').props.bgcolor)).toBe(RED + byte(80))
  })
  it('box border_color = color.rgb(0, 255, 0, 50) — the FOURTH argument is carried', () => {
    expect(lit(create(all, 'box').props.border_color)).toBe('#00FF00' + byte(50))
  })
  it('label color = color.new(#2962FF, 90)', () => {
    expect(lit(create(all, 'label').props.color)).toBe('#2962FF' + byte(90))
  })
  it('table bgcolor = color.new(color.blue, 70)', () => {
    expect(lit(create(all, 'table').props.bgcolor)).toBe(BLUE + byte(70))
  })
  it('CONTROL: an opaque colour stays six digits — never a redundant FF byte', () => {
    expect(lit(create(all, 'label').props.textcolor)).toBe('#FFFFFF')
  })
})

describe('⛔ the controls that keep the fold honest', () => {
  it('an 8-digit literal is kept EXACTLY — no transparency round-trip drift', () => {
    // 0x81 → t 49 → re-encoded 0x82: a naive fold would move this byte.
    const all = ops(`var table tb = table.new(position.top_right, 2, 1)
if barstate.islast
    table.cell(tb, 0, 0, "a", bgcolor = #FF000080)
    table.cell(tb, 1, 0, "b", bgcolor = #FF000081)
`)
    const cells = all.filter((o) => o.k === 'cell')
    expect(cells.map((c) => lit(c.props.bgcolor))).toEqual(['#FF000080', '#FF000081'])
  })

  it('color.new SETS the transparency — it replaces a literal alpha, it does not stack', () => {
    const all = ops(`var box b = na
var box c = na
if barstate.islast
    b := box.new(bar_index - 5, high, bar_index, low, bgcolor = color.new(#FF000080, 0))
    c := box.new(bar_index - 5, high, bar_index, low, bgcolor = color.new(color.red, 0))
`)
    const boxes = all.filter((o) => o.k === 'create' && o.family === 'box')
    expect(boxes.map((b) => lit(b.props.bgcolor))).toEqual(['#FF0000', RED])
  })

  it('a name bound to a transparent colour carries it', () => {
    const all = ops(`zone = color.new(color.green, 60)
var box b = na
if barstate.islast
    b := box.new(bar_index - 5, high, bar_index, low, bgcolor = zone)
`)
    expect(lit(create(all, 'box').props.bgcolor)).toBe(GREEN + byte(60))
  })

  it('each arm of a conditional colour carries its own transparency', () => {
    const all = ops(`var box b = na
if barstate.islast
    b := box.new(bar_index - 5, high, bar_index, low, bgcolor = close > open ? color.new(color.green, 60) : color.red)
`)
    const node = create(all, 'box').props.bgcolor.node
    expect(node.c).toBe('if')
    expect(node.then).toEqual({ c: 'lit', hex: GREEN + byte(60) })
    expect(node.else).toEqual({ c: 'lit', hex: RED })
  })

  it('a linefill colour carries its transparency too', () => {
    const all = ops(`var line a = na
var line b = na
var linefill f = na
if barstate.islast
    a := line.new(bar_index - 5, high, bar_index, high)
    b := line.new(bar_index - 5, low, bar_index, low)
    f := linefill.new(a, b, color.new(color.blue, 85))
`)
    const lf = create(all, 'linefill')
    expect(lf, 'no linefill emitted').toBeTruthy()
    const c = lf.props.color
    const hex = c.v === 'color' ? c.node.hex : c.value
    expect(hex).toBe(BLUE + byte(85))
  })
})
