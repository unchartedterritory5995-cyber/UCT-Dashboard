// What the scan board asks of the grid library, and what it does when the library reports a
// finished drag or resize. jsdom cannot drag, so the library is stood in for and its callbacks are
// called the way it calls them: (layout, oldItem, newItem).
import { render, waitFor, act, screen, fireEvent } from '@testing-library/react'
import { vi, afterEach, beforeEach, expect, test } from 'vitest'

const grid = vi.hoisted(() => ({ seen: vi.fn() }))
vi.mock('react-grid-layout', () => {
  const Grid = p => { grid.seen(p); return <div data-testid="grid">{p.children}</div> }
  return { default: Grid, WidthProvider: C => C }
})
vi.mock('react-grid-layout/css/styles.css', () => ({}))
import ScanBoard from '../ScanBoard'
import { sanitize, COLS, ROWS } from '../boardModel'

// the props the board last handed the grid
const P = () => grid.seen.mock.lastCall?.[0] ?? null
let heightSpy
beforeEach(() => { grid.seen.mockClear(); heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600) })
afterEach(() => { heightSpy.mockRestore() })

const DROP = { i: 'details', x: 0, y: 12, w: 7, h: 8 }
// a stand-in for the Charts board's drop rule: the dropped widget takes its box, the chart moves over
const repack = vi.fn((ws, id, rect) => ws.map(w => (w.id === id ? { ...w, ...rect } : w.id === 'chart' ? { ...w, x: 7 } : { ...w, x: 0 })))
const draw = (edit, api, extra = {}) => render(
  <ScanBoard board={{ ...sanitize(null), edit }} api={api} renderWidget={() => null} loadRepack={() => Promise.resolve(repack)} {...extra} />)

test('locked: the grid can be neither dragged nor resized, and the drop rule is never loaded', async () => {
  const loadRepack = vi.fn(() => Promise.resolve(repack))
  draw(false, { acceptArrangement: vi.fn() }, { loadRepack })
  await waitFor(() => expect(P()).not.toBeNull())
  expect([P().isDraggable, P().isResizable]).toEqual([false, false])
  expect(loadRepack).not.toHaveBeenCalled()
  expect([P().cols, P().maxRows, P().compactType, P().allowOverlap]).toEqual([COLS, ROWS, null, true])
  expect(P().layout.map(l => [l.i, l.x, l.y, l.w, l.h])).toEqual(sanitize(null).widgets.map(w => [w.id, w.x, w.y, w.w, w.h]))
})

test('Customize: the grid unlocks once the drop rule has loaded; a drag is a move, a corner drag is a resize', async () => {
  const api = { acceptArrangement: vi.fn(() => true), removeWidget: vi.fn() }
  const onRefused = vi.fn()
  draw(true, api, { onRefused })
  await waitFor(() => expect(P()?.isDraggable).toBe(true))
  expect(P().isResizable).toBe(true)
  const base = sanitize(null).widgets
  act(() => { P().onDragStart(); P().onDragStop([], null, DROP) })
  expect(repack).toHaveBeenLastCalledWith(base, 'details', { x: 0, y: 12, w: 7, h: 8 }, COLS, ROWS)
  expect(api.acceptArrangement).toHaveBeenLastCalledWith(expect.any(Array), 'details', true)
  act(() => { P().onResizeStart(); P().onResizeStop([], null, { ...DROP, w: 6 }) })
  expect(api.acceptArrangement).toHaveBeenLastCalledWith(expect.any(Array), 'details', false)
  expect(onRefused).not.toHaveBeenCalled()
})

test('a refused drop tells the member and hands the grid the stored layout back', async () => {
  const api = { acceptArrangement: vi.fn(() => false), removeWidget: vi.fn() }
  const onRefused = vi.fn()
  draw(true, api, { onRefused })
  await waitFor(() => expect(P()?.isDraggable).toBe(true))
  const before = P().layout
  act(() => { P().onDragStart(); P().onDragStop([], null, DROP) })
  expect(onRefused).toHaveBeenCalledTimes(1)
  // the same boxes, but not the same value: the library only takes a layout back when it differs
  expect(P().layout.map(l => [l.i, l.x, l.y, l.w, l.h])).toEqual(before.map(l => [l.i, l.x, l.y, l.w, l.h]))
  expect(P().layout).not.toEqual(before)
})

test('a drop that moves nothing asks the board for nothing', async () => {
  const api = { acceptArrangement: vi.fn(() => true), removeWidget: vi.fn() }
  const onRefused = vi.fn()
  draw(true, api, { onRefused, loadRepack: () => Promise.resolve(ws => ws.map(w => ({ ...w }))) })
  await waitFor(() => expect(P()?.isDraggable).toBe(true))
  act(() => { P().onDragStart(); P().onDragStop([], null, DROP) })
  expect(api.acceptArrangement).not.toHaveBeenCalled()
  expect(onRefused).not.toHaveBeenCalled()
})

// Customize by keyboard: the bar of each widget takes the arrow keys.
test('an arrow key on the bar of a widget moves it like a drag; Shift + arrow resizes it; what happened is said', async () => {
  const api = { acceptArrangement: vi.fn(() => true), removeWidget: vi.fn() }
  const onRefused = vi.fn()
  draw(true, api, { onRefused })
  await waitFor(() => expect(P()?.isDraggable).toBe(true))
  const base = sanitize(null).widgets
  const bar = screen.getByRole('group', { name: /^Results widget\. Arrow keys move it/ })
  expect(bar).toHaveAttribute('tabindex', '0')
  repack.mockClear()
  fireEvent.keyDown(bar, { key: 'ArrowLeft' })
  expect(repack).toHaveBeenLastCalledWith(base, 'results', { x: 0, y: 0, w: 7, h: 12 }, COLS, ROWS)
  expect(api.acceptArrangement).toHaveBeenLastCalledWith(expect.any(Array), 'results', true)
  expect(screen.getByTestId('board-said')).toHaveTextContent('Results moved left.')
  fireEvent.keyDown(bar, { key: 'ArrowDown', shiftKey: true })
  expect(repack).toHaveBeenLastCalledWith(base, 'results', { x: 17, y: 0, w: 7, h: 13 }, COLS, ROWS)
  expect(api.acceptArrangement).toHaveBeenLastCalledWith(expect.any(Array), 'results', false)
  expect(screen.getByTestId('board-said')).toHaveTextContent('Results is taller.')
  // nothing on that side: the board is not asked, and the member is told
  const calls = api.acceptArrangement.mock.calls.length
  fireEvent.keyDown(bar, { key: 'ArrowRight' })
  expect(api.acceptArrangement.mock.calls.length).toBe(calls)
  expect(screen.getByTestId('board-said')).toHaveTextContent('Nothing to the right of Results to trade places with.')
  // other keys, and keys pressed on the Remove button inside the bar, are left alone
  fireEvent.keyDown(bar, { key: 'a' })
  fireEvent.keyDown(screen.getByRole('button', { name: 'Remove Results' }), { key: 'ArrowLeft' })
  expect(api.acceptArrangement.mock.calls.length).toBe(calls)
  expect(onRefused).not.toHaveBeenCalled()
})

test('a keyboard move the board refuses says so, and a locked board has no bars to press', async () => {
  const api = { acceptArrangement: vi.fn(() => false), removeWidget: vi.fn() }
  const onRefused = vi.fn()
  const first = draw(true, api, { onRefused })
  await waitFor(() => expect(P()?.isDraggable).toBe(true))
  fireEvent.keyDown(screen.getByRole('group', { name: /^Chart widget/ }), { key: 'ArrowRight' })
  expect(onRefused).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('board-said')).toHaveTextContent('Not enough room to move Chart that way.')
  first.unmount()
  draw(false, api)
  await waitFor(() => expect(P()).not.toBeNull())
  expect(screen.queryByRole('group', { name: /widget\. Arrow keys/ })).toBeNull()
  expect(screen.queryByTestId('board-said')).toBeNull()
})
