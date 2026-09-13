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
import {
  LINE_DASH, DEFAULT_LINE_STYLE, dashFor, isLineStyle,
  ARROW_SIZES, DEFAULT_ARROW_SIZE, arrowSizeFor, arrowSizeName,
} from './drawingStyle'

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

describe('✅ the picker maps — fixed in Phase 1', () => {
  // SOURCE-READ, DELIBERATELY. The two maps live inside ChartDrawingOverlay.jsx
  // next to the menu that uses them, and importing the component to reach them
  // would pull React, portals and ColorPanel into a three-line assertion.
  const OVERLAY = fs.readFileSync(path.join(HERE, 'ChartDrawingOverlay.jsx'), 'utf8')

  it('✅ WAS: DRAW_STYLE_TO_NUM had no `dotted` key. NOW: all three', () => {
    // Without it, reopening the menu after choosing Dotted read the (wrongly)
    // stored 'dashed' back and highlighted Dashed — so the control looked inert
    // in both directions.
    const m = OVERLAY.match(/const DRAW_STYLE_TO_NUM = \{([^}]*)\}/)
    expect(m, 'DRAW_STYLE_TO_NUM has moved — this gate is reading nothing').toBeTruthy()
    for (const k of ['solid', 'dashed', 'dotted']) expect(m[1]).toContain(k)
  })

  it('✅ WAS: numToDrawStyle turned the dotted code (1) into "dashed". NOW: dotted', () => {
    const m = OVERLAY.match(/const NUM_TO_DRAW_STYLE = (\{[^}]*\})/)
    expect(m, 'NUM_TO_DRAW_STYLE has moved — this gate is reading nothing').toBeTruthy()
    const table = new Function('return ' + m[1])()
    expect(table[0]).toBe('solid')
    expect(table[1]).toBe('dotted')     // <- the bug, fixed
    expect(table[2]).toBe('dashed')
  })

  it('the two directions are inverses of each other', () => {
    const toNum = new Function('return ' + OVERLAY.match(/const DRAW_STYLE_TO_NUM = (\{[^}]*\})/)[1])()
    const toStr = new Function('return ' + OVERLAY.match(/const NUM_TO_DRAW_STYLE = (\{[^}]*\})/)[1])()
    for (const style of Object.keys(LINE_DASH)) {
      expect(toStr[toNum[style]]).toBe(style)
    }
  })

  it('every style the dash table knows has a numeric spelling', () => {
    // The guard against the ORIGINAL bug class: a style added to LINE_DASH and
    // forgotten in the picker maps is a failure here, not a silent fallback.
    const toNum = new Function('return ' + OVERLAY.match(/const DRAW_STYLE_TO_NUM = (\{[^}]*\})/)[1])()
    for (const style of Object.keys(LINE_DASH)) {
      expect(toNum[style], `LINE_DASH has '${style}' but the picker cannot express it`).toBeDefined()
    }
  })

  it('ColorPanel still offers three styles, with 1 meaning dotted', () => {
    const PANEL = fs.readFileSync(path.join(HERE, 'ColorPanel.jsx'), 'utf8')
    expect(PANEL).toContain("[[0, 'solid'], [2, 'dashed'], [1, 'dotted']]")
  })

  it('the renderer resolves its dash through the shared table', () => {
    expect(OVERLAY).toContain('dashFor(')
    expect(OVERLAY).not.toContain("=== 'dashed' ? [6, 4]")
  })

  it('⛔ the Chart Settings CROSSHAIR picker is untouched', () => {
    // It uses the same ColorPanel with the same numeric codes, but they go to
    // lightweight-charts' own LineStyle enum, where 1 has ALWAYS meant dotted and
    // has always worked. The two systems share a widget, not a mapping.
    const TB = fs.readFileSync(path.join(HERE, 'ChartToolbar.jsx'), 'utf8')
    expect(TB).toContain("{ value: 0, label: 'Solid' }")
    expect(TB).toContain("{ value: 2, label: 'Dashed' }")
    expect(TB).toContain("{ value: 3, label: 'Dotted' }")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('arrow sizes — three names, and Medium is the shipped one', () => {
  it('⛔ MEDIUM IS 10, WHICH IS WHAT renderArrow ALWAYS PASSED', () => {
    // If Medium were anything else, every arrow ever drawn would either change
    // size or match no entry in the picker. Both are wrong; 10 is neither.
    expect(ARROW_SIZES.medium).toBe(10)
    expect(DEFAULT_ARROW_SIZE).toBe(10)
  })

  it('offers exactly small / medium / large, ascending', () => {
    expect(Object.keys(ARROW_SIZES)).toEqual(['small', 'medium', 'large'])
    const v = Object.values(ARROW_SIZES)
    expect(v).toEqual([...v].sort((a, b) => a - b))
    expect(new Set(v).size).toBe(3)
  })

  it('a drawing that names no size is Medium — that is every legacy arrow', () => {
    for (const d of [null, undefined, {}, { arrowSize: null }, { arrowSize: undefined }]) {
      expect(arrowSizeFor(d)).toBe(10)
      expect(arrowSizeName(d)).toBe('medium')
    }
  })

  it('a nonsense size falls back rather than drawing a broken head', () => {
    for (const bad of [0, -4, NaN, Infinity, 'large', {}]) {
      expect(arrowSizeFor({ arrowSize: bad }), String(bad)).toBe(10)
    }
  })

  it('a stored size is used as-is, and names itself when it matches', () => {
    expect(arrowSizeFor({ arrowSize: ARROW_SIZES.large })).toBe(ARROW_SIZES.large)
    expect(arrowSizeName({ arrowSize: ARROW_SIZES.small })).toBe('small')
    // A size from a future build that is not one of ours still RENDERS…
    expect(arrowSizeFor({ arrowSize: 13 })).toBe(13)
    // …it just does not light up a button in the picker.
    expect(arrowSizeName({ arrowSize: 13 })).toBeNull()
  })

  it('the table is frozen', () => {
    expect(Object.isFrozen(ARROW_SIZES)).toBe(true)
  })
})
