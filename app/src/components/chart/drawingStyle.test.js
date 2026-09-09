/* Line style — the dash table, and the two maps that still disagree with it.
 *
 * ⛔ HALF OF THIS FILE PINS A BUG ON PURPOSE. Phase 0 lands the dash TABLE and
 * wires the renderer to it; it deliberately does NOT fix the picker maps, so no
 * drawing can carry `lineStyle: 'dotted'` yet and the render path stays
 * byte-identical. The "as it ships" block below asserts the broken mapping in
 * so many words. Phase 1's fix therefore cannot be a quiet one-character edit:
 * it has to come here and delete tests that state the wrong behaviour, in a diff
 * that names what changed.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LINE_DASH, DEFAULT_LINE_STYLE, dashFor, isLineStyle } from './drawingStyle'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('the dash table', () => {
  it('knows all three styles the picker offers', () => {
    expect(Object.keys(LINE_DASH).sort()).toEqual(['dashed', 'dotted', 'solid'])
  })

  it('keeps the SHIPPED patterns for solid and dashed', () => {
    // ⛔ `[6, 4]` is the literal that has always been in the overlay's
    // `ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : [])`. Changing it
    // would restyle every dashed drawing every user already has.
    expect(LINE_DASH.solid).toEqual([])
    expect(LINE_DASH.dashed).toEqual([6, 4])
  })

  it('gives dotted a pattern that reads as dots, not short dashes', () => {
    const [on, off] = LINE_DASH.dotted
    expect(on).toBeLessThanOrEqual(LINE_DASH.dashed[0] / 2)
    expect(off).toBeGreaterThanOrEqual(on)
  })

  it('is frozen, entries included — one caller cannot restyle every chart', () => {
    expect(Object.isFrozen(LINE_DASH)).toBe(true)
    expect(Object.isFrozen(LINE_DASH.dashed)).toBe(true)
  })
})

describe('dashFor', () => {
  it('resolves each known style', () => {
    expect(dashFor('solid')).toEqual([])
    expect(dashFor('dashed')).toEqual([6, 4])
    expect(dashFor('dotted')).toEqual([2, 3])
  })

  it('falls back to solid for an unknown, missing or malformed style', () => {
    // A drawing written by a NEWER client must still render on an older one.
    // Throwing here would blank the whole overlay for one bad value.
    expect(DEFAULT_LINE_STYLE).toBe('solid')
    for (const bad of ['squiggly', undefined, null, '', 0, {}]) {
      expect(dashFor(bad)).toEqual([])
    }
  })

  it('returns a FRESH array each time, never the frozen table entry', () => {
    // `ctx.setLineDash` copies its argument, so handing out the shared frozen
    // array would be safe today — but a caller that scaled a pattern in place
    // would throw in strict mode and silently no-op otherwise.
    const a = dashFor('dashed'), b = dashFor('dashed')
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a).not.toBe(LINE_DASH.dashed)
    expect(() => a.push(1)).not.toThrow()
    expect(dashFor('dashed')).toEqual([6, 4])   // the table is unharmed
  })
})

describe('isLineStyle', () => {
  it('accepts the three real styles and rejects everything else', () => {
    expect(isLineStyle('solid')).toBe(true)
    expect(isLineStyle('dotted')).toBe(true)
    expect(isLineStyle('nope')).toBe(false)
  })

  it('is not fooled by inherited Object properties', () => {
    // `LINE_DASH['constructor']` is a function; a naive `in` check would call
    // it a valid line style and hand a function to setLineDash.
    expect(isLineStyle('constructor')).toBe(false)
    expect(isLineStyle('toString')).toBe(false)
  })
})

describe('⚠️ CHARACTERISATION — the picker maps as they ship (Phase 1 fixes these)', () => {
  // ⛔ SOURCE-READ, DELIBERATELY. The two maps live inside
  // ChartDrawingOverlay.jsx next to the menu that uses them, and importing the
  // component to reach them would pull React, portals and ColorPanel into a
  // three-line assertion. What matters is that the WRONG VALUES ARE WRITTEN
  // DOWN somewhere a Phase 1 diff has to touch.
  const OVERLAY = fs.readFileSync(path.join(HERE, 'ChartDrawingOverlay.jsx'), 'utf8')

  it('⚰️ DRAW_STYLE_TO_NUM has no `dotted` key, so the picker can never show it selected', () => {
    const m = OVERLAY.match(/const DRAW_STYLE_TO_NUM = \{([^}]*)\}/)
    expect(m, 'DRAW_STYLE_TO_NUM has moved — this gate is reading nothing').toBeTruthy()
    expect(m[1]).toContain('solid')
    expect(m[1]).toContain('dashed')
    expect(m[1]).not.toContain('dotted')
  })

  it('⚰️ numToDrawStyle maps the dotted code (1) to "dashed"', () => {
    const m = OVERLAY.match(/const numToDrawStyle = ([^\n]*)/)
    expect(m, 'numToDrawStyle has moved — this gate is reading nothing').toBeTruthy()
    // The shipped expression: `(n) => (n === 0 ? 'solid' : 'dashed')`.
    // Anything that is not 0 — including ColorPanel's dotted code, 1 — becomes
    // 'dashed'. Clicking Dotted stores Dashed, and reopening the menu then
    // highlights Dashed. The button is not dead; it writes the wrong value.
    const numToDrawStyle = new Function('return ' + m[1])()
    expect(numToDrawStyle(0)).toBe('solid')
    expect(numToDrawStyle(2)).toBe('dashed')
    expect(numToDrawStyle(1)).toBe('dashed')   // ← the bug, stated
  })

  it('ColorPanel still offers three styles, with 1 meaning dotted', () => {
    const PANEL = fs.readFileSync(path.join(HERE, 'ColorPanel.jsx'), 'utf8')
    expect(PANEL).toContain("[[0, 'solid'], [2, 'dashed'], [1, 'dotted']]")
  })

  it('the renderer resolves its dash through the shared table', () => {
    // Phase 0 DID land this half: the overlay no longer inlines
    // `d.lineStyle === 'dashed' ? [6, 4] : []`.
    expect(OVERLAY).toContain('dashFor(')
    expect(OVERLAY).not.toContain("=== 'dashed' ? [6, 4]")
  })
})
