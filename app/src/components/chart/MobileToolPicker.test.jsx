// @vitest-environment jsdom
/* MOB-04 — every drawing tool is reachable WITHOUT a gesture.
 *
 * The defect was never "a tool is missing". All 18 shipped and all 18 worked —
 * inside a scroll rail with no scrollbar and no fade, about three tiles wide at
 * 390px. Fifteen of them were reachable only by a swipe the interface never
 * mentions. So these cases are about REACH, and the acceptance number is derived
 * from the roster rather than typed: this study got that count wrong twice.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import MobileToolPicker, { filterTools, pushRecent, rememberRecent, readRecents } from './MobileToolPicker'
import { DRAW_TOOLS } from './MobileDrawBar'

beforeEach(() => { cleanup(); localStorage.clear() })

const open = (props = {}) => {
  const onPick = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <MobileToolPicker open onClose={onClose} tools={DRAW_TOOLS} activeTool={null} onPick={onPick} {...props} />,
  )
  return { ...view, onPick, onClose }
}
const gridTiles = () => within(screen.getByTestId('tool-grid')).getAllByRole('button')

describe('reach — the acceptance criterion, derived not typed', () => {
  it('the grid offers EVERY tool in the roster', () => {
    open()
    expect(gridTiles()).toHaveLength(DRAW_TOOLS.length)
  })

  it('every tool is reachable by its accessible LABEL', () => {
    open()
    for (const t of DRAW_TOOLS) {
      expect(screen.getAllByLabelText(t.label).length,
        `"${t.label}" is not reachable from the all-tools sheet`).toBeGreaterThan(0)
    }
  })

  it('picking a tool arms it and closes the sheet — two interactions from the chart', () => {
    const { onPick, onClose } = open()
    fireEvent.click(screen.getAllByLabelText('Pitchfork')[0])
    expect(onPick).toHaveBeenCalledWith('pitchfork')
    expect(onClose).toHaveBeenCalled()
  })

  it('the ARMED tool is shown as pressed, so the sheet reflects the chart', () => {
    open({ activeTool: 'fib' })
    const fib = screen.getAllByLabelText('Fib')[0]
    expect(fib.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByLabelText('Trend')[0].getAttribute('aria-pressed')).toBe('false')
  })
})

describe('search — for the tools a swipe buries', () => {
  it('narrows to a match on the visible label', () => {
    open()
    fireEvent.change(screen.getByLabelText('Search drawing tools'), { target: { value: 'pitch' } })
    expect(gridTiles()).toHaveLength(1)
    expect(gridTiles()[0].getAttribute('aria-label')).toBe('Pitchfork')
  })

  it('matches the id a user cannot see, and ignores spacing', () => {
    // "H Ray" is `hray`; a user typing either must find it.
    expect(filterTools(DRAW_TOOLS, 'hray').map((t) => t.id)).toContain('hray')
    expect(filterTools(DRAW_TOOLS, 'h ray').map((t) => t.id)).toContain('hray')
    expect(filterTools(DRAW_TOOLS, 'H RAY').map((t) => t.id)).toContain('hray')
  })

  it('a query matching nothing says so — and is NOT a dead end', () => {
    /* ⛔ THIS EXPECTATION CHANGED DELIBERATELY. It used to assert the grid was
       ABSENT on no-match: the user was told "No tool matches", handed an empty
       screen, and had to clear the box before they could do anything — a
       punishment for asking. The message is still there (silence would be
       worse), but the roster now stays underneath it, so the worst case costs a
       scroll instead of a retype. */
    open()
    fireEvent.change(screen.getByLabelText('Search drawing tools'), { target: { value: 'zzzz' } })
    expect(screen.getByText(/No tool matches/)).toBeTruthy()
    const grid = screen.getByTestId('tool-grid')
    expect(grid.children.length).toBe(DRAW_TOOLS.length)
  })

  it('an empty query shows everything back', () => {
    open()
    const box = screen.getByLabelText('Search drawing tools')
    fireEvent.change(box, { target: { value: 'fib' } })
    expect(gridTiles().length).toBeLessThan(DRAW_TOOLS.length)
    fireEvent.change(box, { target: { value: '' } })
    expect(gridTiles()).toHaveLength(DRAW_TOOLS.length)
  })
})

describe('recency — pays for itself, unlike favourites', () => {
  it('is most-recent-first, de-duplicated and capped', () => {
    let l = []
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) l = pushRecent(l, id)
    expect(l).toEqual(['f', 'e', 'd', 'c', 'b'])          // capped at 5
    l = pushRecent(l, 'c')
    expect(l).toEqual(['c', 'f', 'e', 'd', 'b'])          // moved, not duplicated
    expect(new Set(l).size).toBe(l.length)
  })

  it('a picked tool is remembered and appears under Recent next time', () => {
    const first = open()
    fireEvent.click(screen.getAllByLabelText('Cup')[0])
    expect(readRecents()).toContain('cup')
    first.unmount()

    open()
    expect(screen.getByText('Recent')).toBeTruthy()
    // Cup now appears TWICE — once under Recent, once in the full grid — which
    // is the point of the row, and is why every lookup here is `getAllBy`.
    expect(screen.getAllByLabelText('Cup')).toHaveLength(2)
  })

  it('Recent is hidden while searching — the user already knows what they want', () => {
    rememberRecent('cup')
    open()
    expect(screen.getByText('Recent')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search drawing tools'), { target: { value: 'fib' } })
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('a corrupt recents entry degrades to no Recent row, never a crash', () => {
    localStorage.setItem('uct.draw.recentTools', '{not json')
    expect(readRecents()).toEqual([])
    open()
    expect(screen.queryByText('Recent')).toBeNull()
    expect(gridTiles()).toHaveLength(DRAW_TOOLS.length)
  })

  it('a remembered id that is no longer a tool is dropped, not rendered blank', () => {
    // The roster changes; a stale recency entry must not paint an empty tile.
    localStorage.setItem('uct.draw.recentTools', JSON.stringify(['retired-tool', 'cup']))
    open()
    const recentRow = screen.getByText('Recent').nextSibling
    expect(within(recentRow).getAllByRole('button')).toHaveLength(1)
  })
})
