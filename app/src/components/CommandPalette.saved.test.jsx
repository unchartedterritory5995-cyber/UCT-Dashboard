/**
 * TERM-038 — saved things become names in the palette. Typing a chart layout's or a
 * watchlist's NAME lists it; choosing it opens the page door the address resolves to.
 * Asserted on rendered text and the route reached, never on internal state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import CommandPalette from './CommandPalette'
import { AuthContext } from '../context/AuthContext'

function RouteSpy() {
  const location = useLocation()
  return <div data-testid="route-spy">{location.pathname}{location.search}</div>
}

function renderPalette(auth) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CommandPalette />
        <RouteSpy />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

function openAndType(text) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
  })
  const input = screen.getByRole('combobox')
  fireEvent.change(input, { target: { value: text } })
  return input
}

const SAVED = {
  results: [
    { address: 'L:12', kind: 'layout', kind_label: 'Chart layout', name: 'Swing Board', to: '/charts?openLayout=12' },
    { address: 'W:w-abc', kind: 'watchlist', kind_label: 'Watchlist', name: 'Swing Names', to: '/charts?openWatchlist=user:w-abc' },
    { address: 'N:n1', kind: 'note', kind_label: 'Note', name: 'Swing plan', to: '/journal/notebook?note=n1' },
  ],
  unavailable: [],
}
let saved

beforeEach(() => {
  saved = SAVED
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/address/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(saved) })
    }
    if (u.startsWith('/api/ticker-search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
  })
})

afterEach(() => { vi.restoreAllMocks() })

const addressCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/address/search'))

describe('CommandPalette — saved things as names (TERM-038)', () => {
  it('typing a layout name lists it with its kind, and choosing it opens the layout', async () => {
    renderPalette({ addressSpaceEnabled: true })
    openAndType('swing')
    const row = await screen.findByRole('option', { name: 'Chart layout: Swing Board. Enter to open.' })
    expect(row.textContent).toContain('Swing Board')
    expect(row.textContent).toContain('Chart layout')
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe('/charts?openLayout=12'))
  })

  it('a watchlist opens through the shipped openWatchlist door', async () => {
    renderPalette({ addressSpaceEnabled: true })
    openAndType('swing')
    fireEvent.click(await screen.findByRole('option', { name: 'Watchlist: Swing Names. Enter to open.' }))
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).toBe('/charts?openWatchlist=user:w-abc'))
  })

  it('notes are left to the quick switcher, never listed twice', async () => {
    renderPalette({ addressSpaceEnabled: true })
    openAndType('swing')
    await screen.findByRole('option', { name: 'Chart layout: Swing Board. Enter to open.' })
    expect(screen.queryByRole('option', { name: /Note: Swing plan/ })).toBeNull()
  })

  it('saved rows sit below the typed ticker row, so a bare Enter is unchanged', async () => {
    renderPalette({ addressSpaceEnabled: true })
    openAndType('swing')
    await screen.findByRole('option', { name: 'Chart layout: Swing Board. Enter to open.' })
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toMatch(/Go to/)
  })

  it('an unreadable store says so in words', async () => {
    saved = { results: [], unavailable: ['layout'] }
    renderPalette({ addressSpaceEnabled: true })
    openAndType('swing')
    expect((await screen.findByTestId('palette-saved-error')).textContent).toMatch(/briefly unavailable/)
  })

  it('while dark it sends no address request at all', async () => {
    renderPalette({ addressSpaceEnabled: false })
    openAndType('swing')
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).startsWith('/api/ticker-search'))).toBe(true))
    expect(addressCalls()).toHaveLength(0)
    expect(screen.queryByText('Swing Board')).toBeNull()
  })
})
