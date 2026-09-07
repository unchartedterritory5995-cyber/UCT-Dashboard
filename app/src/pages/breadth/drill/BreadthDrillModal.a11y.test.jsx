/* BREADTH-DRILL-MODAL — the dialog contract.
 *
 * `aria-modal="true"` tells assistive tech the rest of the page is inert. It does
 * NOT move focus, contain focus, or restore it — the browser does none of that for
 * a div. Before this, opening the drill left focus on the breadth cell behind the
 * overlay, so a screen reader announced nothing, Tab walked the page UNDERNEATH
 * the modal, and closing dropped focus at the top of the document.
 *
 * The role was also on the OVERLAY — the dimmed backdrop with click-to-close — so
 * the region announced as "dialog" was not the region the user could operate.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {} }),
}))
// The board is the widget machinery; this file is about the dialog shell around
// it. Two focusables stand in for everything the real board renders.
vi.mock('./BreadthDrillBoard', () => ({
  default: () => (
    <div data-testid="board">
      <button>board-first</button>
      <button>board-last</button>
    </div>
  ),
}))
vi.mock('../../charts/popout/PopoutWindow', () => ({ default: () => null }))
vi.mock('../../charts/popout/PopoutShell', () => ({ default: ({ children }) => children }))
vi.mock('../../charts/WidgetHost', () => ({ default: () => null }))

import BreadthDrillModal from './BreadthDrillModal'

const DRILL = { items: [{ t: 'AEHR', pct: 13.1 }], label: 'Up 4%+', date: '2026-09-04' }
const open = (props = {}) => render(<BreadthDrillModal drill={DRILL} onClose={() => {}} {...props} />)
const panel = () => screen.getByRole('dialog')
const focusables = () => Array.from(panel().querySelectorAll('button, [tabindex]:not([tabindex="-1"])'))

describe('CONTROL — the elements this rail reasons about exist', () => {
  it('renders a backdrop, a panel, and more than one focusable', () => {
    const { container } = open()
    expect(container.firstChild).toBeTruthy()
    expect(screen.getByTestId('board')).toBeTruthy()
    expect(focusables().length).toBeGreaterThan(1)
  })
})

describe('the dialog role is on the panel, not the backdrop', () => {
  it('exactly one element carries role=dialog', () => {
    const { container } = open()
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  })

  it('the backdrop is NOT the dialog, and the panel holds the content', () => {
    const { container } = open()
    const overlay = container.firstChild
    expect(overlay.getAttribute('role')).toBeNull()
    expect(overlay).not.toBe(panel())
    expect(overlay.contains(panel())).toBe(true)
    expect(panel().contains(screen.getByTestId('board'))).toBe(true)
  })

  it('is labelled by the cell it opened from', () => {
    open()
    expect(panel().getAttribute('aria-label')).toContain('Up 4%+')
    expect(panel().getAttribute('aria-modal')).toBe('true')
  })
})

describe('focus', () => {
  it('moves into the dialog on open', () => {
    open()
    expect(panel().contains(document.activeElement) || document.activeElement === panel()).toBe(true)
  })

  it('lands on the PANEL, not a button whose label would be announced instead', () => {
    open()
    expect(document.activeElement).toBe(panel())
  })

  it('returns to whatever opened the drill when it closes', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = open()
    expect(document.activeElement).not.toBe(opener)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('does not throw when the opener is gone by the time it closes', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = open()
    opener.remove()
    expect(() => unmount()).not.toThrow()
  })
})

describe('Tab is trapped inside the panel', () => {
  it('wraps from the last control back to the first', () => {
    open()
    const nodes = focusables()
    nodes[nodes.length - 1].focus()
    fireEvent.keyDown(panel(), { key: 'Tab' })
    expect(document.activeElement).toBe(nodes[0])
  })

  it('Shift+Tab from the first wraps to the last', () => {
    open()
    const nodes = focusables()
    nodes[0].focus()
    fireEvent.keyDown(panel(), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(nodes[nodes.length - 1])
  })

  it('Shift+Tab from the panel itself goes to the last control, not out of the page', () => {
    open()
    const nodes = focusables()
    panel().focus()
    fireEvent.keyDown(panel(), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(nodes[nodes.length - 1])
  })

  it('leaves a mid-list Tab to the browser', () => {
    open()
    const nodes = focusables()
    nodes[0].focus()
    fireEvent.keyDown(panel(), { key: 'Tab' })
    expect(document.activeElement).toBe(nodes[0])
  })

  it('a non-Tab key is not intercepted', () => {
    open()
    const nodes = focusables()
    nodes[0].focus()
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(nodes[0])
  })
})

describe('Escape still closes', () => {
  it('calls onClose', () => {
    const onClose = vi.fn()
    open({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
