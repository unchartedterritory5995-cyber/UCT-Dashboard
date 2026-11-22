// app/src/components/chart/builder/memberPane/w4PaintTypingPane.test.js
//
// W4-T12 - the member pane carries a per-bar colour the front end can now prove is a colour.
// On master each of these shapes DECLINED the whole document (`runtime:colour`, or
// `runtime:withheld-all` for a plot `color =`); with the colour proven they are served from the
// same run as the value. The controls decline exactly as master does.
import { describe, it, expect, vi } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const ACC = 'var float acc = 0.0\nacc += close\n'
const door = (body, id) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  return memberPaneDefinition({ source: H + body, id: `u_w4t12_${id}`, name: 'T' })
}

describe('W4-T12 - the pane draws a proven per-bar colour', () => {
  it('a bgcolor over a colour switch is a carried paint', () => {
    const d = door(`${ACC}m = input.string("a", "m", options = ["a", "b"])\nc = switch m\n    "a" => color.red\n    => color.green\nbgcolor(c)\nplot(acc, "acc")\n`, 'sw')
    expect(d.ok, JSON.stringify(d.runtimeDeclined)).toBe(true)
    expect(d.definition.paints.map((p) => p.kind)).toEqual(['bgcolor'])
    expect(d.definition.paints[0].colorMode).toMatch(/^column:/)
  })

  it('a plot `color =` over a colour switch rides a colour column', () => {
    const d = door(`${ACC}c = switch\n    close > open => color.red\n    => color.green\nplot(acc, "acc", color = c)\n`, 'plotcol')
    expect(d.ok, JSON.stringify(d.runtimeDeclined)).toBe(true)
    expect(d.definition.plots.find((p) => p.label === 'acc').colorMode).toMatch(/^column:/)
  })

  it('a barcolor over a colour function with an `na` arm is a carried paint', () => {
    const d = door(`${ACC}f(x) => x > open ? color.red : na\nbarcolor(f(close))\nplot(acc, "acc")\n`, 'udf')
    expect(d.ok, JSON.stringify(d.runtimeDeclined)).toBe(true)
    expect(d.definition.paints.map((p) => p.kind)).toEqual(['barcolor'])
  })

  it('CONTROL - a numeric switch is still declined by name', () => {
    const d = door(`${ACC}c = switch\n    close > open => close\n    => open\nbgcolor(c)\nplot(acc, "acc")\n`, 'num')
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined.code).toBe('runtime:colour')
  })
})
