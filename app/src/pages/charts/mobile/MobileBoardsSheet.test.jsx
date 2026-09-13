// @vitest-environment jsdom
/* The phone's Drawing Boards door — the last high-value orphaned mobile task.
 *
 * Boards ("tracings") are named overlay sheets of drawings spanning every
 * ticker. They are real, per-user, and they SYNC. The only surface that could
 * switch, name, add or delete one was `BoardsToolButton` inside `ChartToolbar`,
 * which is `display:none` on the phone shell — so a phone user drew onto
 * whichever board happened to be active, could not tell which, and could not
 * change it.
 *
 * ⛔ THE SHEET OWNS NO STATE. Every case below asserts against `drawingsStore`
 * itself, never against a local copy — a second authority over "which board am I
 * drawing on" is the worst thing in this codebase to duplicate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import * as drawingsStore from '../../../components/chart/drawingsStore'
import MobileBoardsSheet from './MobileBoardsSheet'

vi.mock('../../../components/mobile/haptics', () => ({ default: { tap: () => {} } }))

beforeEach(() => {
  cleanup()
  localStorage.clear()
  drawingsStore._reset()
})

const open = (props = {}) => {
  const onClose = vi.fn()
  const view = render(<MobileBoardsSheet open onClose={onClose} sym="AAPL" {...props} />)
  return { ...view, onClose }
}
const rows = () => screen.getAllByTestId('board-row')

describe('the door exists and reflects the store', () => {
  it('lists every board, with the ACTIVE one marked', () => {
    const b = drawingsStore.createTracing()
    open()
    expect(rows()).toHaveLength(drawingsStore.listTracings().length)
    const activeId = drawingsStore.getActiveTracingId()
    const pressed = screen.getAllByRole('button', { pressed: true })
    expect(pressed.length, 'no board is shown as active').toBeGreaterThan(0)
    expect(b).toBeTruthy()
  })

  it('tapping a board makes it the one you draw on — in the STORE', () => {
    const other = drawingsStore.createTracing({ name: 'Swing' })
    expect(drawingsStore.getActiveTracingId()).not.toBe(other)
    open()
    fireEvent.click(screen.getByLabelText('Draw on Swing'))
    expect(drawingsStore.getActiveTracingId(),
      'the sheet changed its own idea of active without telling the store').toBe(other)
  })

  it('⛔ switching does NOT close the sheet', () => {
    // Switching is usually the first of several moves; closing on the tap makes
    // every subsequent one a re-open. The desktop panel behaves the same way.
    drawingsStore.createTracing({ name: 'Swing' })
    const { onClose } = open()
    fireEvent.click(screen.getByLabelText('Draw on Swing'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows how much of each board is on THE SYMBOL YOU ARE LOOKING AT', () => {
    drawingsStore.subscribe('AAPL', () => {})
    drawingsStore.addDrawing('AAPL', { type: 'horizontal', points: [{ price: 5 }] })
    open()
    expect(screen.getByText(/1 on AAPL/)).toBeTruthy()
  })

  it('omits the per-symbol count when there is no symbol', () => {
    open({ sym: null })
    expect(screen.queryByText(/ on /)).toBeNull()
  })
})

describe('managing boards', () => {
  it('New board creates one AND switches to it — you made it to draw on it', () => {
    open()
    const before = drawingsStore.listTracings().length
    fireEvent.click(screen.getByLabelText('New board'))
    const after = drawingsStore.listTracings()
    expect(after).toHaveLength(before + 1)
    expect(drawingsStore.getActiveTracingId()).toBe(after[after.length - 1].id)
  })

  it('renaming writes through to the store', () => {
    const id = drawingsStore.createTracing({ name: 'Old' })
    open()
    fireEvent.click(screen.getByLabelText('Rename Old'))
    // The input answers to a DIFFERENT name than the button that opened it —
    // both being "Rename Old" made every lookup ambiguous.
    const input = screen.getByLabelText('New name for Old')
    fireEvent.change(input, { target: { value: 'Macro' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(drawingsStore.listTracings().find((t) => t.id === id).name).toBe('Macro')
  })

  it('hiding a board hides it on the CHART and keeps it in the manager', () => {
    // ⚠️ `createTracing` alone does NOT make a board visible — only
    // `setActiveTracing` does. So the board is activated (visible), then the
    // original is re-activated, leaving a VISIBLE NON-ACTIVE board, which is the
    // only state in which hiding means anything.
    const first = drawingsStore.getActiveTracingId()
    const id = drawingsStore.createTracing({ name: 'Swing' })
    drawingsStore.setActiveTracing(id)
    drawingsStore.setActiveTracing(first)
    expect(drawingsStore.getVisibleTracingIds()).toContain(id)

    open()
    fireEvent.click(screen.getByLabelText('Hide Swing'))
    expect(drawingsStore.getVisibleTracingIds()).not.toContain(id)
    expect(screen.getByLabelText('Show Swing'), 'the row vanished from the manager too').toBeTruthy()
  })

  it('⛔ the ACTIVE board offers NO visibility control — the store would refuse it', () => {
    // `setTracingVisible` force-adds `activeId` back (you must see what you draw
    // on). A control that silently does nothing is worse than no control.
    drawingsStore.createTracing({ name: 'Swing' })
    open()
    const activeLabel = drawingsStore.listTracings()
      .find((t) => t.id === drawingsStore.getActiveTracingId())
    const name = activeLabel.name || 'Board 1'
    expect(screen.queryByLabelText(`Hide ${name}`)).toBeNull()
    expect(screen.queryByLabelText(`Show ${name}`)).toBeNull()
  })

  it('⛔ delete takes TWO taps, and the first one does not delete', () => {
    // A destructive control one tap from a scrolling list, on a touch screen.
    const id = drawingsStore.createTracing({ name: 'Scratch' })
    open()
    fireEvent.click(screen.getByLabelText('Delete Scratch'))
    expect(drawingsStore.listTracings().some((t) => t.id === id),
      'the first tap deleted it').toBe(true)
    fireEvent.click(screen.getByLabelText('Confirm delete Scratch'))
    expect(drawingsStore.listTracings().some((t) => t.id === id)).toBe(false)
  })

  it('the confirm can be cancelled', () => {
    const id = drawingsStore.createTracing({ name: 'Scratch' })
    open()
    fireEvent.click(screen.getByLabelText('Delete Scratch'))
    fireEvent.click(screen.getByLabelText('Cancel delete'))
    expect(drawingsStore.listTracings().some((t) => t.id === id)).toBe(true)
    expect(screen.getByLabelText('Delete Scratch')).toBeTruthy()
  })

  it('⛔ the LAST board offers no delete at all — absent, not disabled', () => {
    // You must always have somewhere to draw. A disabled control invites the tap
    // and then refuses it; an absent one never raises the question.
    open()
    expect(drawingsStore.listTracings()).toHaveLength(1)
    expect(screen.queryByLabelText(/^Delete /)).toBeNull()
  })
})

describe('it presents the store, it does not copy it', () => {
  it('a board created ELSEWHERE appears without remounting the sheet', () => {
    // The sheet subscribes through useTracings/useSyncExternalStore. A local
    // snapshot would go stale the moment the desktop or a sync adopted a board.
    open()
    const before = rows().length
    // ⚠️ INSIDE `act`. `useSyncExternalStore` notifies synchronously but React
    // still needs a flush; without it this asserted on a DOM that had not
    // re-rendered yet and looked like a stale local copy.
    act(() => { drawingsStore.createTracing({ name: 'FromSync' }) })
    expect(rows()).toHaveLength(before + 1)
    // Name it precisely: a row carries several labels mentioning the board
    // (pick, rename, delete), so a loose regex matches more than one.
    expect(screen.getByLabelText('Draw on FromSync')).toBeTruthy()
  })
})
