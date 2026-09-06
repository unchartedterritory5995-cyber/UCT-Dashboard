/**
 * CommandPalette — the global Ctrl/Cmd+K security search + navigate slice
 * (narrow S1+S2 authorization, 2026-09-03).
 *
 * Covers: hotkey open/close (incl. repeat-guard + Settings.jsx-style bubble
 * collision), Escape, focus management, debounce + stale-response guarding,
 * the zero-network-wait typed-Enter path vs. explicit arrow-navigation, and
 * click-to-select navigation into /research/:sym.
 */
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import CommandPalette from './CommandPalette'

// 2026-09-03 discoverability slice: NavBar/MobileNav open the SAME palette
// via this exact ref shape (paletteRef.current.open()) — mirrors Layout.jsx.
function PaletteWithExternalTrigger() {
  const ref = useRef(null)
  return (
    <>
      <button onClick={() => ref.current?.open()}>external-open</button>
      <CommandPalette ref={ref} />
    </>
  )
}

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

describe('CommandPalette — visible-trigger open path (2026-09-03 discoverability slice)', () => {
  // NavBar/MobileNav call ref.current.open() exactly like this — proves the
  // SAME palette opens via a non-keyboard path, not a second implementation.
  it('opens via an external ref.current.open() call, focuses the input', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PaletteWithExternalTrigger />
        <RouteSpy />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('external-open'))
    await screen.findByRole('dialog', { name: 'Command palette' })
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
  })

  it('a second open() call while already open is a no-op, not a close', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PaletteWithExternalTrigger />
        <RouteSpy />
      </MemoryRouter>,
    )
    const trigger = screen.getByText('external-open')
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Command palette' })
    fireEvent.click(trigger)
    // Still open — a stray second click (e.g. a mis-click through the backdrop
    // area) must never silently close the palette out from under the user.
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })

  it('the Ctrl+K hotkey still opens it the same way after adding ref support', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PaletteWithExternalTrigger />
        <RouteSpy />
      </MemoryRouter>,
    )
    act(() => pressCtrlK())
    await screen.findByRole('dialog', { name: 'Command palette' })
  })
})

describe('CommandPalette — "?" in-box help mode (P10, IA §8.3/§17.4)', () => {
  it('typing "?" shows help instead of running it as a search query', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: '?' } })
    await screen.findByText(/global search/i)
    expect(screen.getByText(/reopen this from anywhere/i)).toBeInTheDocument()
    // '?' must never hit the network as if it were a ticker query.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('Enter on "?" does nothing — no navigation to /research/%3F', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: '?' } })
    await screen.findByText(/global search/i)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/dashboard')
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })

  it('the empty-state hint tells the user "?" is available', async () => {
    renderPalette()
    act(() => pressCtrlK())
    // The '?' sits inside its own <strong>, splitting the sentence across text
    // nodes — read the listbox's full textContent rather than match one node.
    const listbox = screen.getByRole('listbox', { name: 'Search results' })
    await waitFor(() => expect(listbox.textContent).toMatch(/type a ticker or company name.*\?.*for help/i))
  })
})

describe('CommandPalette — Wave B: Notebook joins the palette (§12-15)', () => {
  it('typing "trash" surfaces "Open Trash" and navigating to it goes to the Trash deep link', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'trash' } })
    const row = await screen.findByText('Open Trash')
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('route-spy'))
      .toHaveTextContent('/journal/notebook'))
  })

  it('typing "note" surfaces both "New Note" and "Open Notebook"', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'note' } })
    expect(await screen.findByText('New Note')).toBeInTheDocument()
    expect(screen.getByText('Open Notebook')).toBeInTheDocument()
  })

  it('clicking "New Note" navigates to the blank-note deep link', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'new note' } })
    const row = await screen.findByText('New Note')
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('route-spy'))
      .toHaveTextContent('/journal/notebook'))
  })

  it('a single character never matches a notebook command (avoids matching half the keyword list)', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'n' } })
    expect(screen.queryByText('New Note')).not.toBeInTheDocument()
    expect(screen.queryByText('Open Notebook')).not.toBeInTheDocument()
  })

  it('typing "?" (help mode) never fetches favorites/recents or shows notebook commands', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: '?' } })
    await screen.findByText(/global search/i)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByText('Open Notebook')).not.toBeInTheDocument()
  })

  it('typing "recent" fetches and lists recent notes, badged "Recent"', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/notes/recents')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'n1', title: 'Q3 Thesis' }] }) })
      }
      if (String(url).includes('/notes/favorites')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'recent' } })
    const row = await screen.findByText('Q3 Thesis')
    expect(row.closest('button').textContent).toContain('Recent')
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('route-spy'))
      .toHaveTextContent('/journal/notebook'))
  })

  it('typing "favorite" fetches and lists favorited notes, badged "Favorite"', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/notes/favorites')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'f1', title: 'Core Thesis' }] }) })
      }
      if (String(url).includes('/notes/recents')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'favorite' } })
    const row = await screen.findByText('Core Thesis')
    expect(row.closest('button').textContent).toContain('Favorite')
  })

  it('a note that is BOTH favorited and recent renders once, as Favorite (no duplicate row)', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/notes/favorites')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'dup1', title: 'Dual Note' }] }) })
      }
      if (String(url).includes('/notes/recents')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'dup1', title: 'Dual Note' }] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'recent' } })
    await screen.findByText('Dual Note')
    expect(screen.getAllByText('Dual Note')).toHaveLength(1)
  })

  it('Enter with NO arrow-navigation opens a matched notebook command directly -- found live: an earlier build ignored the highlighted row here and 404\'d to a literal ticker page instead', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    // "trash" itself is TICKER_LIKE and also matches "Open Trash" -- the
    // command (rendered first, highlighted by default) must win over the
    // ticker interpretation without requiring the user to arrow to it.
    fireEvent.change(input, { target: { value: 'trash' } })
    await screen.findByText('Open Trash')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy'))
      .toHaveTextContent('/journal/notebook'))
  })

  it('Enter still preserves zero-network-wait for a plain ticker query with no notebook match', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'nvda' } })
    // Fire Enter well before the 150ms debounce would even issue a request
    // -- the synthetic typed-ticker row is what's highlighted at index 0.
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA'))
  })

  it('arrow-navigating past a notebook command to the ticker fallback and pressing Enter opens THAT instead', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'trash' } })
    await screen.findByText('Open Trash')
    // "Open Trash" (idx 0) -> "Go to TRASH" ticker fallback (idx 1).
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/TRASH'))
  })
})
