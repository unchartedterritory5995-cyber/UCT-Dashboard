// @vitest-environment jsdom
/* The recovery surface — tested for the ONE property it exists to have.
 *
 * ⛔ A HIDDEN OBJECT MUST STILL BE LISTED. Everything else here is convenience;
 * that is the load-bearing assertion, and it is what makes per-object Hide a
 * safe control to ship at all. The owner's instruction was explicit — do not
 * ship Hide by itself — and the reason is that an invisible, unselectable,
 * unlistable object is not hidden, it is lost, and on a phone (no right-click,
 * no docked panel, cheap mis-taps) it is lost for good.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import MobileObjectsSheet from './MobileObjectsSheet'

vi.mock('../../../components/mobile/haptics', () => ({ default: { tap: () => {} } }))

const DRAWINGS = [
  { id: 'd1', type: 'horizontal', points: [{ price: 114.26 }], color: '#f0b23a' },
  { id: 'd2', type: 'trendline', points: [{ price: 100 }, { price: 110 }], hidden: true },
  { id: 'd3', type: 'text', text: 'earnings gap', locked: true },
]

const mount = (over = {}) => {
  const props = {
    open: true, onClose: () => {}, sym: 'NVDA', drawings: DRAWINGS,
    onToggleHidden: vi.fn(), onToggleLocked: vi.fn(), onDelete: vi.fn(), onShowAll: vi.fn(),
    ...over,
  }
  render(<MobileObjectsSheet {...props} />)
  return props
}

beforeEach(() => cleanup())

describe('the objects sheet', () => {
  it('⛔ lists the HIDDEN object too — the whole point', () => {
    mount()
    expect(screen.getAllByTestId('object-row')).toHaveLength(3)
    const rows = screen.getAllByTestId('object-row')
    expect(within(rows[1]).getByText('Trendline')).toBeTruthy()
    expect(within(rows[1]).getByText('Hidden')).toBeTruthy()
  })

  it('names each object and the level it sits at', () => {
    mount()
    expect(screen.getByText('Horizontal Line')).toBeTruthy()
    expect(screen.getByText('114.26')).toBeTruthy()
    expect(screen.getByText('100 → 110')).toBeTruthy()
    expect(screen.getByText('earnings gap')).toBeTruthy()
  })

  it('says how many are hidden, in words, before you have to count rows', () => {
    mount()
    expect(screen.getByText('1 hidden object')).toBeTruthy()
  })

  it('pluralises, because "2 hidden object" reads as a bug', () => {
    mount({ drawings: [{ id: 'a', type: 'horizontal', hidden: true }, { id: 'b', type: 'hray', hidden: true }] })
    expect(screen.getByText('2 hidden objects')).toBeTruthy()
  })

  it('⭐ ONE TAP restores everything — you never have to find them individually', () => {
    const p = mount()
    fireEvent.click(screen.getByLabelText('Show all 1 hidden objects'))
    expect(p.onShowAll).toHaveBeenCalledTimes(1)
  })

  it('offers no recovery banner when nothing is hidden — no permanent clutter', () => {
    mount({ drawings: [DRAWINGS[0]] })
    expect(screen.queryByText(/hidden object/)).toBeNull()
  })

  it('restores one object from its own row', () => {
    const p = mount()
    fireEvent.click(screen.getByLabelText('Show Trendline'))
    expect(p.onToggleHidden).toHaveBeenCalledWith('d2', false)
  })

  it('hides a visible one', () => {
    const p = mount()
    fireEvent.click(screen.getByLabelText('Hide Horizontal Line'))
    expect(p.onToggleHidden).toHaveBeenCalledWith('d1', true)
  })

  it('surfaces LOCKED — the other way an object stops responding with no explanation', () => {
    const p = mount()
    expect(screen.getByText('Locked')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Unlock Text Note'))
    expect(p.onToggleLocked).toHaveBeenCalledWith('d3', false)
  })

  it('deletes from the row', () => {
    const p = mount()
    fireEvent.click(screen.getByLabelText('Delete Horizontal Line'))
    expect(p.onDelete).toHaveBeenCalledWith('d1')
  })

  it('says so plainly when the chart is empty', () => {
    mount({ drawings: [] })
    expect(screen.getByText(/Nothing drawn on NVDA yet/)).toBeTruthy()
    expect(screen.queryAllByTestId('object-row')).toHaveLength(0)
  })
})
