/**
 * CommandPalette — the global Ctrl/Cmd+K security search + navigate slice
 * (narrow S1+S2 authorization, 2026-09-03).
 *
 * Covers: hotkey open/close (incl. repeat-guard + Settings.jsx-style bubble
 * collision), Escape, focus management, debounce + stale-response guarding,
 * the zero-network-wait typed-Enter path vs. explicit arrow-navigation, and
 * click-to-select navigation into /research/:sym.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import CommandPalette from './CommandPalette'

function RouteSpy() {
  const location = useLocation()
  return <div data-testid="route-spy">{location.pathname}</div>
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <CommandPalette />
      <RouteSpy />
    </MemoryRouter>,
  )
}

function pressCtrlK(opts = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true, ...opts }))
}

let searchResults = []

beforeEach(() => {
  searchResults = []
  global.fetch = vi.fn((url) => {
    if (String(url).startsWith('/api/ticker-search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: searchResults }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CommandPalette — hotkey open/close', () => {
  it('renders nothing until the hotkey is pressed', () => {
    renderPalette()
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('Ctrl+K opens the dialog and focuses the search input', async () => {
    renderPalette()
    act(() => pressCtrlK())
    await screen.findByRole('dialog', { name: 'Command palette' })
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
  })

  it('pressing Ctrl+K again while open closes it', async () => {
    renderPalette()
    act(() => pressCtrlK())
    await screen.findByRole('dialog', { name: 'Command palette' })
    act(() => pressCtrlK())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull())
  })

  it('Escape closes it', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull())
  })

  it('a held-down key does not repeat-toggle open/close (e.repeat guard)', () => {
    renderPalette()
    act(() => pressCtrlK({ repeat: true }))
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('restores focus to the element that had it before the palette opened', async () => {
    renderPalette()
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()
    expect(opener).toHaveFocus()

    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(opener).toHaveFocus())
    document.body.removeChild(opener)
  })

  it('wins Ctrl+K over a page-scoped bubble-phase listener (the Settings.jsx collision)', async () => {
    renderPalette()
    const bubbleSpy = vi.fn()
    window.addEventListener('keydown', bubbleSpy)
    act(() => pressCtrlK())
    await screen.findByRole('dialog', { name: 'Command palette' })
    expect(bubbleSpy).not.toHaveBeenCalled()
    window.removeEventListener('keydown', bubbleSpy)
  })

  it('cleans up its listeners on unmount — a later Ctrl+K is a no-op, not a crash', () => {
    const { unmount } = renderPalette()
    unmount()
    expect(() => act(() => pressCtrlK())).not.toThrow()
  })
})

describe('CommandPalette — search + selection', () => {
  it('debounces rapid keystrokes into a single request for the final query', async () => {
    searchResults = [{ ticker: 'AAPL', name: 'Apple Inc.', type: 'stock', exchange: 'NASDAQ', entity_id: 'em_1' }]
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')

    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.change(input, { target: { value: 'AA' } })
    fireEvent.change(input, { target: { value: 'AAPL' } })

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch.mock.calls[0][0]).toContain('q=AAPL')
    await screen.findByText('Apple Inc.')
  })

  it('a stale response never overwrites a newer query\'s results', async () => {
    const resolvers = {}
    global.fetch = vi.fn((url) => {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return new Promise((resolve) => { resolvers[q] = resolve })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')

    fireEvent.change(input, { target: { value: 'AA' } })
    await act(async () => { await new Promise(r => setTimeout(r, 170)) })
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await act(async () => { await new Promise(r => setTimeout(r, 170)) })

    // The stale 'AA' request resolves AFTER 'AAPL' is already in flight.
    await act(async () => {
      resolvers['AA']?.({ ok: true, json: () => Promise.resolve({ results: [{ ticker: 'AAA', name: 'Stale Corp' }] }) })
      await new Promise(r => setTimeout(r, 10))
    })
    expect(screen.queryByText('Stale Corp')).toBeNull()

    await act(async () => {
      resolvers['AAPL']?.({ ok: true, json: () => Promise.resolve({ results: [{ ticker: 'AAPL', name: 'Apple Inc.' }] }) })
    })
    await screen.findByText('Apple Inc.')
  })

  it('Enter navigates to the typed value immediately, with zero network wait', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'nvda' } })
    // Fire Enter well before the 150ms debounce would even issue a request.
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA'))
  })

  it('explicit arrow-navigation overrides the typed value on Enter', async () => {
    searchResults = [
      { ticker: 'AAPL', name: 'Apple Inc.' },
      { ticker: 'APPS', name: 'Digital Turbine' },
    ]
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'APP' } })
    await screen.findByText('Digital Turbine')

    fireEvent.keyDown(input, { key: 'ArrowDown' }) // AAPL (idx 0) -> APPS (idx 1)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/APPS'))
  })

  it('clicking a result navigates into /research/:sym', async () => {
    searchResults = [{ ticker: 'MSFT', name: 'Microsoft Corp' }]
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'MSFT' } })
    const row = await screen.findByText('Microsoft Corp')
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/MSFT'))
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('shows an empty-state hint before typing, and a no-match note when nothing found', async () => {
    renderPalette()
    act(() => pressCtrlK())
    await screen.findByText(/type a ticker or company name/i)

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: '###' } })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // '###' fails TICKER_LIKE, so no synthetic row is appended either.
    await screen.findByText(/no matches for/i)
  })
})
