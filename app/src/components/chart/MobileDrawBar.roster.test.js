/* The drawbar↔toolbar parity rail (wave 11).
 *
 * On the phone shell the desktop ChartToolbar is display:none and there is no
 * keyboard, so MobileDrawBar is the ONLY door to every drawing tool — a tool
 * missing from its roster is UNREACHABLE, not merely demoted. That is exactly
 * how `advance` (the UCT advance-% label, an owner-facing tool) and `cup`
 * shipped invisible for two waves: the roster was a hand-copy of the desktop
 * list with no rail, while the file's own header only pinned the GLYPHS as
 * shared. Set-equality here makes the next drift fail by name in either
 * direction — a tool added to desktop without a phone tile, or a phone tile
 * for a tool the overlay no longer arms.
 *
 * `eraser` is deliberately outside DRAW_TOOLS (the pinned tile in the side
 * cluster) and outside TOOLS (it never had a desktop button), so no exception
 * set is needed: the two arrays must simply name the same tools.
 */
import { describe, test, expect } from 'vitest'
import { DRAW_TOOLS } from './MobileDrawBar'
import { TOOLS, TOOL_ICONS } from './ChartToolbar'

const desktopIds = TOOLS.filter((t) => t !== 'sep').map((t) => t.id).sort()
const phoneIds = DRAW_TOOLS.map((t) => t.id).sort()

describe('MobileDrawBar roster parity', () => {
  test('the phone drawbar exposes exactly the desktop tool set', () => {
    expect(phoneIds).toEqual(desktopIds)
  })

  test('every phone tile has a real glyph (a missing key renders an empty button)', () => {
    const missing = DRAW_TOOLS.filter((t) => !TOOL_ICONS[t.id]).map((t) => t.id)
    expect(missing).toEqual([])
  })

  test('labels are non-empty and unique (they are the accessible names the rig arms by)', () => {
    const labels = DRAW_TOOLS.map((t) => t.label)
    expect(labels.every((l) => typeof l === 'string' && l.trim().length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
    // The walk arms "Trend" verbatim (tools/iphone_walk.py) — renaming it
    // breaks the standing eight-gate rail, so it fails here first, by name.
    expect(labels).toContain('Trend')
  })

  // Non-vacuity: the desktop list actually contains the two tools whose
  // absence this rail exists to prevent recurring.
  test('control: advance and cup are in both rosters', () => {
    expect(desktopIds).toEqual(expect.arrayContaining(['advance', 'cup']))
    expect(phoneIds).toEqual(expect.arrayContaining(['advance', 'cup']))
  })

  // ⚰️ `position` IS STILL IN BOTH ROSTERS AND THAT IS CORRECT. Phase 9 retired
  // the 3-point Position DRAWING; the button that shares its id opens the
  // Position CALCULATOR — a numeric panel plus entry/stop/target price lines,
  // which StockChart gates on this same `activeTool`. Removing the entry would
  // have deleted a live feature to retire a different one.
  test('the retired Position DRAWING keeps its tool id, because the calculator uses it', () => {
    expect(desktopIds).toContain('position')
    expect(phoneIds).toContain('position')
    const label = TOOLS.find((t) => t !== 'sep' && t.id === 'position').label
    expect(label).toContain('Position Calculator')
  })
})
