// A legend row's menu opens under the row, and beside it when there is no room under it.
//
// Measured 2026-11-16 on a 243px chart in a 560px window: the 418px menu of `EMA 9` was clamped
// up to y=134 and covered its own row at y=154. The popover's clamp is right to keep a menu on
// screen; what was missing is the choice to go BESIDE the row first.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MENU_EDGE, MENU_ROW_GAP, MENU_SIDE_GAP, menuAnchorWithRoom, rowMenuAnchor } from './legendMenuPlace'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (p) => readFileSync(join(SRC, p), 'utf8')
/** Source with comments removed: a marker must be found in CODE, never in the prose about it. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// The measured case: the row's box, the menu's size, the window.
const ROW = { left: 83, top: 154, right: 168, bottom: 168 }
const MENU_H = 418
const MENU_W = 214
const overlapsRow = (a, h, w, vh, row) => {
  const top = Math.min(a.y, vh - h - MENU_EDGE)            // the popover's own clamp
  return top < row.bottom && top + h > row.top && a.x < row.right && a.x + w > row.left
}

describe('where a legend row menu opens', () => {
  it('hangs under the row, from its left edge, and records where "beside" is', () => {
    const a = rowMenuAnchor(ROW)
    expect(a).toEqual({ x: 83, y: 168 + MENU_ROW_GAP, besideX: 168 + MENU_SIDE_GAP, rowTop: 154 })
  })

  it('stays under the row when the menu fits there (the same object, so a caller can tell)', () => {
    const a = rowMenuAnchor(ROW)
    expect(menuAnchorWithRoom(a, MENU_H, MENU_W, 1600, 900)).toBe(a)
    // exactly fitting still fits
    expect(menuAnchorWithRoom(a, 900 - MENU_EDGE - a.y, MENU_W, 1600, 900)).toBe(a)
  })

  it('⭐ moves beside the row when the clamp would otherwise cover it (the measured case)', () => {
    const a = rowMenuAnchor(ROW)
    // the defect, stated with the popover's own clamp: under the row, the menu covers the row
    expect(overlapsRow(a, MENU_H, MENU_W, 560, ROW)).toBe(true)
    const moved = menuAnchorWithRoom(a, MENU_H, MENU_W, 1600, 560)
    expect(moved).toEqual({ x: 174, y: 154 })
    expect(overlapsRow(moved, MENU_H, MENU_W, 560, ROW)).toBe(false)
    // one pixel of missing room is enough to move it
    expect(menuAnchorWithRoom(a, 560 - MENU_EDGE - a.y + 1, MENU_W, 1600, 560)).not.toBe(a)
  })

  it('is a no-op the second time: the moved anchor no longer says where "beside" is', () => {
    const moved = menuAnchorWithRoom(rowMenuAnchor(ROW), MENU_H, MENU_W, 1600, 560)
    expect(menuAnchorWithRoom(moved, MENU_H, MENU_W, 1600, 560)).toBe(moved)
  })

  it('leaves the anchor alone when there is no room beside the row either', () => {
    // a row at the right edge of a narrow window: the clamp keeps the menu on screen, as before
    const a = rowMenuAnchor({ left: 300, top: 154, right: 385, bottom: 168 })
    expect(menuAnchorWithRoom(a, MENU_H, MENU_W, 600, 560)).toBe(a)
    // exactly fitting beside does move
    expect(menuAnchorWithRoom(a, MENU_H, MENU_W, a.besideX + MENU_W + MENU_EDGE, 560)).not.toBe(a)
  })

  it('leaves a pointer anchor, a missing anchor and an unmeasured menu alone', () => {
    const pointer = { x: 10, y: 500 }
    expect(menuAnchorWithRoom(pointer, MENU_H, MENU_W, 1600, 560)).toBe(pointer)
    expect(menuAnchorWithRoom(null, MENU_H, MENU_W, 1600, 560)).toBeNull()
    const a = rowMenuAnchor(ROW)
    expect(menuAnchorWithRoom(a, 0, 0, 1600, 560)).toBe(a)
  })
})

describe('the wire: both row types build this anchor, and the chart applies the rule', () => {
  it('a legend row and an indicator chip anchor with rowMenuAnchor', () => {
    expect(code('components/chart/legend/LegendRow.jsx')).toMatch(/onOpen\(rowId, r \? rowMenuAnchor\(r\) : /)
    expect(code('components/chart/legend/IndicatorChip.jsx')).toMatch(/if \(r\) return rowMenuAnchor\(r\)/)
  })

  it('the chart measures the mounted menu before it is shown and moves the anchor', () => {
    const jsx = code('components/StockChart.jsx')
    // a LAYOUT effect: the popover positions itself in a passive effect, after this one
    const m = /useLayoutEffect\(\(\) => \{\s*const anchor = chipMenu\?\.anchor[\s\S]{0,700}?\}, \[chipMenu\]\)/.exec(jsx)
    expect(m, 'the placement effect is gone, or is no longer a layout effect keyed on the open menu').not.toBeNull()
    expect(m[0]).toMatch(/document\.querySelector\('\[role="menu"\]\[data-guide="chart\.chipMenu"\]'\)/)
    expect(m[0]).toMatch(/menuAnchorWithRoom\(anchor, el\.offsetHeight, el\.offsetWidth, window\.innerWidth, window\.innerHeight\)/)
    expect(m[0]).toMatch(/if \(next !== anchor\) setChipMenu\(/)
    // the selector names a real thing: every legend menu is opened with that guide name ...
    expect(jsx.match(/guide="chart\.chipMenu"/g).length).toBeGreaterThan(0)
    // ... and the popover puts the guide name and the menu role on the element it positions
    const pop = code('components/mobile/ContextPopover.jsx')
    expect(pop).toMatch(/role=\{children != null \? 'dialog' : 'menu'\}\s*data-guide=\{guide\}/)
  })

  it('the popover clamp this rule works around is the one the test models', () => {
    // `overlapsRow` above restates the clamp; this pins it to the source so the two cannot drift.
    const pop = code('components/mobile/ContextPopover.jsx')
    expect(pop).toMatch(/top: Math\.min\(anchor\.y, vh - h - 8\)/)
    expect(MENU_EDGE).toBe(8)
  })
})
