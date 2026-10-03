// app/src/components/NavBar.rovingNav.test.jsx
//
// Wave 13, lane 13Q-4. The click-budget instrument (13Q-2/13Q-3) found that
// reaching anything behind NAV_ITEMS (~19 links) costs a full forward Tab
// walk through every one of them one at a time, because the list was never
// compacted into a single Tab stop (docs/notebook/wave13-13q2.md §4). This
// file proves the roving-tabindex fix AGAINST THE REAL COMPONENT (not just
// useRovingTabIndex's own generic stand-in in useRovingTabIndex.test.jsx):
// one Tab stop, Arrow keys (Up/Down -- NavBar is a VERTICAL rail) + Home/End
// move focus, Enter still navigates, and focus lands on the current route's
// item when tabbing in -- all WITHOUT NAV_ITEMS, routes, labels or order
// changing (NavBar.test.jsx already pins those; this file does not repeat
// them).
//
// Queried by `[data-roving-item]` (the attribute this lane adds) rather than
// by accessible name, deliberately: the default (free-tier) render has most
// NAV_ITEMS as the LOCKED `/subscribe` variant (a different accessible name,
// "<label> — unlock with Pro"), and the roving group spans BOTH variants —
// proving that directly, with the real component's real markup, is a
// stronger rail than asserting only the paid branch.
import { describe, it, expect } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test-utils'
import NavBar, { NAV_ITEMS } from './NavBar'

function rovingItems(container) {
  return Array.from(container.querySelectorAll('[data-roving-item]'))
}

describe('NavBar -- roving tabindex over NAV_ITEMS (13Q-4)', () => {
  it('is ONE tab stop over every rendered NAV_ITEMS entry, in NAV_ITEMS order', () => {
    const { container } = renderWithProviders(<NavBar />)
    const items = rovingItems(container)
    // `/community` is dark-launch-gated (NavBar.jsx: hidden until the
    // community-status poll resolves `enabled`, which never settles in this
    // test's unmocked fetch) -- pre-existing, unrelated to this lane, and the
    // reason the rendered set can be one entry short of the full NAV_ITEMS
    // array. The order check over whatever DID render is the load-bearing
    // assertion.
    const expected = NAV_ITEMS.map((i) => i.to).filter((to) => to !== '/community')
    expect(items.map((n) => n.getAttribute('data-roving-item'))).toEqual(expected)
    expect(items.filter((n) => n.tabIndex === 0)).toHaveLength(1)
    expect(items.filter((n) => n.tabIndex === -1)).toHaveLength(items.length - 1)
  })

  it('focus lands on the CURRENT ROUTE item when tabbing in (not just the first)', () => {
    // Morning Wire is the one free-tier route that renders as a real NavLink
    // (and so is the only one that can carry aria-current) without needing a
    // paid-state mock.
    const { container } = renderWithProviders(<NavBar />, { route: '/morning-wire' })
    const items = rovingItems(container)
    const active = items.find((n) => n.getAttribute('data-roving-item') === '/morning-wire')
    expect(active.tabIndex).toBe(0)
    expect(items.filter((n) => n.tabIndex === 0)).toHaveLength(1)
  })

  it('ArrowDown moves focus to the next NAV_ITEMS link, in NAV_ITEMS order', () => {
    const { container } = renderWithProviders(<NavBar />, { route: '/calendar' })
    const items = rovingItems(container)
    items[0].focus()
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    expect(items[1].tabIndex).toBe(0)
    expect(items[0].tabIndex).toBe(-1)
  })

  it('ArrowUp from the first item wraps to the last NAV_ITEMS item (Support)', () => {
    const { container } = renderWithProviders(<NavBar />, { route: '/calendar' })
    const items = rovingItems(container)
    items[0].focus()
    fireEvent.keyDown(items[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[items.length - 1])
    expect(items[items.length - 1].getAttribute('data-roving-item')).toBe('/support')
  })

  it('Home/End jump to the first/last NAV_ITEMS item', () => {
    const { container } = renderWithProviders(<NavBar />, { route: '/calendar' })
    const items = rovingItems(container)
    items[3].focus()
    fireEvent.keyDown(items[3], { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(document.activeElement, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('arrow keys elsewhere in the same <nav> (the Search button) are a no-op', () => {
    const { getByLabelText } = renderWithProviders(<NavBar />, { route: '/calendar' })
    const search = getByLabelText('Search — Ctrl+K')
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(search)
  })

  it('Enter still navigates -- the roving handler never intercepts it', () => {
    const { container } = renderWithProviders(<NavBar />, { route: '/calendar' })
    const first = rovingItems(container)[0]
    first.focus()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    fireEvent(first, event)
    expect(event.defaultPrevented).toBe(false)
    expect(first.tagName).toBe('A')
    expect(first).toHaveAttribute('href')
  })
})
