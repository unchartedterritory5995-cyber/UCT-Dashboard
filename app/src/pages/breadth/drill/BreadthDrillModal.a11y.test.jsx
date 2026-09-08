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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import BreadthDrillModal, { WIDGET_MENU_SELECTOR } from './BreadthDrillModal'

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

describe('Escape does not close the drill out from under an open widget menu', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const HEADER = resolve(HERE, '../../charts/WidgetHeader.jsx')
  /** Every portaled menu WidgetHeader can put above this modal, read from source. */
  const headerMenuAttrs = () => {
    const src = readFileSync(HEADER, 'utf8')
    return [...new Set((src.match(/data-[a-z]+(?:-[a-z]+)*-menu/g) || []))]
  }

  it('CONTROL — WidgetHeader really does declare portaled menus', () => {
    expect(headerMenuAttrs().length, 'no data-*-menu found; re-derive this rail').toBeGreaterThan(0)
  })

  it('the selector covers EVERY menu WidgetHeader declares', () => {
    const missing = headerMenuAttrs().filter(a => !WIDGET_MENU_SELECTOR.includes(a))
    expect(missing, 'a menu was added to WidgetHeader and Escape will close the whole '
      + 'drill when it is open — add it to WIDGET_MENU_SELECTOR').toEqual([])
  })

  it('Escape is IGNORED while a widget menu is in the DOM', () => {
    const onClose = vi.fn()
    open({ onClose })
    const menu = document.createElement('div')
    menu.setAttribute('data-wtab-add-menu', '')
    document.body.appendChild(menu)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose, 'the menu owns this Escape; the drill must survive it').not.toHaveBeenCalled()
    menu.remove()
  })

  it('and closes again the moment the menu is gone', () => {
    const onClose = vi.fn()
    open({ onClose })
    const menu = document.createElement('div')
    menu.setAttribute('data-wtab-add-menu', '')
    document.body.appendChild(menu)
    fireEvent.keyDown(window, { key: 'Escape' })
    menu.remove()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
