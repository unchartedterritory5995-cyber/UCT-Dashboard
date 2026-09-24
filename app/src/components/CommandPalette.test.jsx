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
  return <div data-testid="route-spy">{location.pathname}{location.search}</div>
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

    // The debounce contract holds for BOTH searches the keystroke feeds: one
    // ticker request and one note-title request, each for the FINAL query.
    const urls = () => global.fetch.mock.calls.map((c) => String(c[0]))
    await waitFor(() => expect(urls().filter((u) => u.startsWith('/api/ticker-search'))).toHaveLength(1))
    expect(urls().filter((u) => u.startsWith('/api/ticker-search'))[0]).toContain('q=AAPL')
    expect(urls().filter((u) => u.startsWith('/api/j2/notes/switcher'))).toEqual(
      ['/api/j2/notes/switcher?q=AAPL&limit=8'],
    )
    expect(global.fetch).toHaveBeenCalledTimes(2)
    await screen.findByText('Apple Inc.')
  })

  // Search/Command Convergence V1's Phase A (2026-09-06) confirmed this was
  // a real, pre-existing bug: a non-2xx JSON error body (e.g. a 402
  // paywall shape, `{"detail": "..."}`) is a truthy object, so a bare
  // `fetch(url).then(r => r.json())` treated it as valid search results.
  // Now routed through the shared `jsonFetcher`, which throws on !r.ok so
  // the existing AbortError-aware catch handler surfaces it as a real
  // error state instead of a malformed/empty results list.
  it('a non-2xx ticker-search response reads as an error, not empty/malformed results', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).startsWith('/api/ticker-search')) {
        return Promise.resolve({ ok: false, status: 402, json: () => Promise.resolve({ detail: 'payment required' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await screen.findByText(/search is briefly unavailable/i)
    expect(screen.queryByText('payment required')).not.toBeInTheDocument()
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

  it('Enter on a typed symbol lands on it — asked at once, before the debounce, and landing as soon as BOTH answers are in (R1-N2, R23-N4)', async () => {
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

  // Search / Command Convergence V1 — the palette's own documented gap
  // ("navigation only") for the single highest-value CONTINUE destination.
  // Strictly additive: bare Enter/click above is completely unchanged.
  describe('Ctrl/Cmd+Enter and Ctrl/Cmd+click open canonical Ask AI', () => {
    it('Ctrl+Enter on the typed value opens /research/:sym?section=ai, not Research', async () => {
      renderPalette()
      act(() => pressCtrlK())
      const input = await screen.findByRole('combobox')
      fireEvent.change(input, { target: { value: 'nvda' } })
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA?section=ai'))
    })

    it('Ctrl+Enter on an arrow-selected row opens that row\'s Ask AI, not the typed value\'s', async () => {
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
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
      await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/APPS?section=ai'))
    })

    it('Ctrl+click a result opens Ask AI for that symbol, not Research', async () => {
      searchResults = [{ ticker: 'MSFT', name: 'Microsoft Corp' }]
      renderPalette()
      act(() => pressCtrlK())
      const input = await screen.findByRole('combobox')
      fireEvent.change(input, { target: { value: 'MSFT' } })
      const row = await screen.findByText('Microsoft Corp')
      fireEvent.click(row, { ctrlKey: true })
      await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/MSFT?section=ai'))
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
    })

    it('bare Enter and bare click are unaffected — still Research, no ?section=ai', async () => {
      searchResults = [{ ticker: 'MSFT', name: 'Microsoft Corp' }]
      renderPalette()
      act(() => pressCtrlK())
      const input = await screen.findByRole('combobox')
      fireEvent.change(input, { target: { value: 'MSFT' } })
      const row = await screen.findByText('Microsoft Corp')
      fireEvent.click(row)
      await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/MSFT'))
      expect(screen.getByTestId('route-spy')).not.toHaveTextContent('section=ai')
    })

    it('Ctrl+Enter on a highlighted Wave B notebook command falls back to its normal action, not a broken /research/undefined?section=ai', async () => {
      renderPalette()
      act(() => pressCtrlK())
      const input = await screen.findByRole('combobox')
      fireEvent.change(input, { target: { value: 'trash' } })
      await screen.findByText('Open Trash')
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
      await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/journal/notebook'))
      expect(screen.getByTestId('route-spy')).not.toHaveTextContent('undefined')
    })
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

  it('Enter on a plain ticker query with no notebook match still opens the typed symbol (R1-N2 / R23-N4: after both answers, bounded)', async () => {
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

describe('CommandPalette — quick switcher over ALL notes (Notebook 10/10 wave 5)', () => {
  // One fetch double for both searches the palette runs, routed by URL, so a
  // test states what EACH index answers rather than what "fetch" answers.
  function routeFetch({ tickers = [], notes = [], notesStatus = 200 } = {}) {
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/ticker-search')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: tickers }) })
      }
      if (u.startsWith('/api/j2/notes/switcher')) {
        return Promise.resolve({
          ok: notesStatus < 400,
          status: notesStatus,
          json: () => Promise.resolve(notesStatus < 400 ? { notes, hasMore: false } : { detail: 'x' }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
    })
  }
  // `strong` / `exact` are the SERVER's placement flags (review S3) — the
  // palette reads them, never the tier number, so every fixture states them.
  const note = (over) => ({
    id: 'n1', title: 'Q3 NVDA thesis', folderId: 'f1', folderPath: 'Research / Semis',
    ticker: 'NVDA', updatedAt: '2026-09-01T00:00:00Z', isRecent: false, isFavorite: false,
    matchTier: 2, strong: true, exact: false, ...over,
  })

  it('finds a note by title and shows WHERE it lives (folder and ticker)', async () => {
    routeFetch({ notes: [note()] })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'q3 nvda' } })
    const option = await screen.findByRole('option', { name: /Note: Q3 NVDA thesis/ })
    expect(option.textContent).toContain('Research / Semis · $NVDA')
  })

  it("names an unfiled note's location instead of leaving it blank", async () => {
    routeFetch({ notes: [note({ folderId: null, folderPath: null, ticker: null })] })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'q3 nvda' } })
    const option = await screen.findByRole('option', { name: /Note: Q3 NVDA thesis/ })
    expect(option.textContent).toContain('Unfiled')
  })

  it('bolds the part of the title that matched', async () => {
    routeFetch({ notes: [note({ title: 'Semis rotation' })] })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'rotation' } })
    const option = await screen.findByRole('option', { name: /Note: Semis rotation/ })
    expect(option.querySelector('strong')?.textContent).toBe('rotation')
  })

  it('clicking a note opens it in the Notebook', async () => {
    routeFetch({ notes: [note({ id: 'abc' })] })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'q3 nvda' } })
    fireEvent.click(await screen.findByRole('option', { name: /Note: Q3 NVDA thesis/ }))
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/journal/notebook?note=abc'))
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('keyboard-first: a strong title match for a note-shaped query is highlighted, and Enter opens it', async () => {
    routeFetch({ notes: [note({ id: 'k1', title: 'Earnings recap', matchTier: 1, ticker: null })] })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'earnings rec' } })
    const option = await screen.findByRole('option', { name: /Note: Earnings recap/ })
    expect(option).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/journal/notebook?note=k1'))
  })

  it('⛔ a note NEVER steals Enter from a ticker-shaped query — "nvda" + Enter still opens NVDA research', async () => {
    // The palette's first job is securities. A note called "NVDA" is an EXACT
    // title match, and it must still sit BELOW the ticker rows.
    routeFetch({
      tickers: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }],
      notes: [note({ id: 'n9', title: 'NVDA', matchTier: 0, exact: true })],
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'nvda' } })
    await screen.findByRole('option', { name: /Note: NVDA/ })
    await screen.findByText('NVIDIA Corp')
    const options = screen.getAllByRole('option')
    expect(options[0].textContent).toContain('NVIDIA Corp')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA'))
  })

  it('⛔ …and still when the NOTES answer first and the ticker search has not answered at all', async () => {
    // The race the placement rule exists for: an exact-title note arrives
    // while the ticker index is still thinking. The typed "Go to NVDA" row
    // must stay on top, or Enter's destination depends on network timing.
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/ticker-search')) return new Promise(() => {}) // never answers
      if (u.startsWith('/api/j2/notes/switcher')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [note({ id: 'n9', title: 'NVDA', matchTier: 0, exact: true })] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'nvda' } })
    await screen.findByRole('option', { name: /Note: NVDA/ })
    expect(screen.getAllByRole('option')[0].textContent).toContain('Go to NVDA')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA'))
  })

  it('a note already listed as a Recent (typed "recent") is not listed twice', async () => {
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.includes('/notes/recents')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [{ id: 'r1', title: 'Recent ideas' }] }) })
      }
      if (u.includes('/notes/favorites')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
      }
      if (u.startsWith('/api/j2/notes/switcher')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [note({ id: 'r1', title: 'Recent ideas', matchTier: 1 })] }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'recent' } })
    await screen.findByText('Recent ideas')
    await waitFor(() => expect(global.fetch.mock.calls.some((c) => String(c[0]).startsWith('/api/j2/notes/switcher'))).toBe(true))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    // By OPTION, not by text: the switcher bolds the matched part, so its row's
    // title is split across nodes and a getAllByText count cannot see it --
    // which is exactly how this assertion first passed with the dedupe removed.
    expect(screen.getAllByRole('option', { name: /Recent ideas/ })).toHaveLength(1)
  })

  it('a note-search outage says so, and the securities that did answer still show', async () => {
    routeFetch({ tickers: [{ ticker: 'AAPL', name: 'Apple Inc.' }], notesStatus: 500 })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'AAPL' } })
    await screen.findByText('Apple Inc.')
    await screen.findByText(/note search is briefly unavailable/i)
  })

  it('every row kind has a real accessible name — never "undefined. Enter for Research"', async () => {
    routeFetch({ notes: [note({ title: 'Trash talk', matchTier: 1 })] })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'trash' } })
    await screen.findByRole('option', { name: /Note: Trash talk/ })
    expect(screen.getByRole('option', { name: 'Open Trash' })).toBeInTheDocument()
    for (const opt of screen.getAllByRole('option')) {
      expect(opt.getAttribute('aria-label') || '').not.toMatch(/undefined/)
    }
  })

  it('arrow keys keep the highlighted row scrolled into view', async () => {
    const spy = vi.fn()
    const had = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = spy
    try {
      routeFetch({ notes: [note({ id: 'a', title: 'Plan A', matchTier: 1 }), note({ id: 'b', title: 'Plan B', matchTier: 1 })] })
      renderPalette()
      act(() => pressCtrlK())
      const input = await screen.findByRole('combobox')
      fireEvent.change(input, { target: { value: 'plan ' } })
      await screen.findByRole('option', { name: /Note: Plan B/ })
      spy.mockClear()
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      await waitFor(() => expect(spy).toHaveBeenCalledWith({ block: 'nearest' }))
    } finally {
      Element.prototype.scrollIntoView = had
    }
  })

  it('S5: a short title the ticker search has NO exact ticker for — "plan" + Enter opens the note', async () => {
    routeFetch({
      tickers: [{ ticker: 'PLNT', name: 'Planet Fitness' }],
      notes: [note({ id: 'p1', title: 'Plan', matchTier: 0, exact: true, ticker: null })],
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'plan' } })
    await screen.findByText('Planet Fitness')
    await waitFor(() => expect(screen.getAllByRole('option')[0].getAttribute('aria-label')).toMatch(/Note: Plan/))
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/journal/notebook?note=p1'))
  })

  // Controller item 8 (the live walk): `/api/ticker-search` answers "plan" with
  // Anaplan's DELISTED PLAN first. A delisted exact ticker must not take Enter
  // from the member's own note titled "Plan"; a LIVE exact ticker still does.
  it('item 8: an exact note title beats a DELISTED exact ticker — "plan" + Enter opens the note', async () => {
    routeFetch({
      tickers: [{ ticker: 'PLAN', name: 'Anaplan, Inc.', type: 'delisted', delisted: true, delisted_date: '2022-06-23' }],
      notes: [note({ id: 'p1', title: 'Plan', matchTier: 0, exact: true, ticker: null })],
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'plan' } })
    await screen.findByText('Anaplan, Inc.')
    await waitFor(() => expect(screen.getAllByRole('option')[0].getAttribute('aria-label')).toMatch(/Note: Plan/))
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/journal/notebook?note=p1'))
  })

  it('item 8 control: a LIVE exact ticker still leads — "nvda" + Enter opens NVDA research, not the note "NVDA"', async () => {
    routeFetch({
      tickers: [{ ticker: 'NVDA', name: 'NVIDIA Corporation' }],
      notes: [note({ id: 'n9', title: 'NVDA', matchTier: 0, exact: true, ticker: 'NVDA' })],
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'nvda' } })
    await screen.findByText('NVIDIA Corporation')
    await screen.findByRole('option', { name: /Note: NVDA/ })
    expect(screen.getAllByRole('option')[0].getAttribute('aria-label')).toMatch(/^NVDA — NVIDIA/)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA'))
  })

  it('N1: once the server says no note can match, typing onto that query stops asking — a backspace asks again', async () => {
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/ticker-search')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) })
      }
      if (u.startsWith('/api/j2/notes/switcher')) {
        const q = new URL(u, 'http://x').searchParams.get('q')
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ notes: [], hasMore: false, prefixExhausted: q === 'zzzz' }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
    })
    const asked = (prefix) => global.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix))
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'zzzz' } })
    await waitFor(() => expect(asked('/api/j2/notes/switcher?q=zzzz&')).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    fireEvent.change(input, { target: { value: 'zzzzq' } })
    // The ticker search for the longer query DID run, so the debounce elapsed…
    await waitFor(() => expect(asked('/api/ticker-search?q=zzzzq')).toHaveLength(1))
    // …and the notes index was not asked.
    expect(asked('/api/j2/notes/switcher?q=zzzzq')).toHaveLength(0)
    fireEvent.change(input, { target: { value: 'zzz' } })
    await waitFor(() => expect(asked('/api/j2/notes/switcher?q=zzz&')).toHaveLength(1))
  })

  it('the help screen documents that a note title opens the note', async () => {
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: '?' } })
    await screen.findByText(/part of a note.s title to open that note/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('CommandPalette — touch tier', () => {
  it('every result row is a finger target at the touch tier (<=1024px), not only on a phone', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'src/components/CommandPalette.module.css'), 'utf8')
    const touch = /@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/.exec(css.replace(/\r\n/g, '\n'))
    expect(touch, 'a max-width:1024px block must exist').not.toBeNull()
    expect(touch[1]).toMatch(/\.resultRow\s*\{[^}]*min-height:\s*var\(--tap-min/)
  })
})

describe('CommandPalette — R1-N2: where Enter lands never depends on WHEN it is pressed', () => {
  const noteRow = (over) => ({
    id: 'p1', title: 'Plan', folderId: null, folderPath: null, ticker: null, updatedAt: '2026-09-01T00:00:00Z',
    isRecent: false, isFavorite: false, matchTier: 0, strong: true, exact: true, ...over,
  })
  function routeFetch({ tickers, notes, notesGate = null, tickersGate = null }) {
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/ticker-search')) {
        const answer = () => ({ ok: true, json: () => Promise.resolve({ results: tickers }) })
        return tickersGate ? tickersGate.then(answer) : Promise.resolve(answer())
      }
      if (u.startsWith('/api/j2/notes/switcher')) {
        const answer = () => ({ ok: true, json: () => Promise.resolve({ notes, hasMore: false }) })
        return notesGate ? notesGate.then(answer) : Promise.resolve(answer())
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [] }) })
    })
  }
  /** Press Enter FAST (before any answer) or SLOW (after both answered and
   *  rendered) and return where the palette went. */
  async function landingOf(timing, query, fixture) {
    routeFetch(fixture)
    const { unmount } = renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: query } })
    if (timing === 'slow') {
      await screen.findByRole('option', { name: new RegExp(`Note: ${fixture.notes[0].title}`) })
      await screen.findByText(fixture.tickers[0].name)
    }
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).not.toBe('/dashboard'))
    const where = screen.getByTestId('route-spy').textContent
    unmount()
    return where
  }

  it('a note-only short query ("plan": no ticker IS it) — fast and slow Enter both open the note', async () => {
    const fixture = { tickers: [{ ticker: 'PLNT', name: 'Planet Fitness' }], notes: [noteRow()] }
    const fast = await landingOf('fast', 'plan', fixture)
    const slow = await landingOf('slow', 'plan', fixture)
    expect(fast).toBe('/journal/notebook?note=p1')
    expect(slow).toBe(fast)
  })

  it('a ticker-match short query ("nvda", with a note titled NVDA) — fast and slow Enter both open the research page', async () => {
    const fixture = {
      tickers: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }],
      notes: [noteRow({ id: 'n9', title: 'NVDA', ticker: 'NVDA' })],
    }
    const fast = await landingOf('fast', 'nvda', fixture)
    const slow = await landingOf('slow', 'nvda', fixture)
    expect(fast).toBe('/research/NVDA')
    expect(slow).toBe(fast)
  })

  it('the member sees it is deciding — never an early landing — and the landing follows the answer', async () => {
    let release
    const notesGate = new Promise((r) => { release = r })
    routeFetch({ tickers: [], notes: [noteRow()], notesGate })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'plan' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('palette-enter-pending')).toHaveTextContent('Finding the best match for "plan"')
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true')
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/dashboard')   // not acted early
    await act(async () => { release() })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/journal/notebook?note=p1'))
  })

  it('the wait is bounded: a notes index that never answers still lets Enter land on the typed symbol', async () => {
    routeFetch({ tickers: [], notes: [noteRow()], notesGate: new Promise(() => {}) })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'plan' } })
    const pressed = Date.now()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/PLAN'), { timeout: 1500 })
    expect(Date.now() - pressed).toBeGreaterThanOrEqual(350)
  })

  it('typing on while it decides drops the pending Enter — the old query never lands', async () => {
    routeFetch({ tickers: [], notes: [noteRow()], notesGate: new Promise(() => {}) })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'plan' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'planx' } })
    await act(async () => { await new Promise((r) => setTimeout(r, 500)) })
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/dashboard')
    expect(screen.queryByTestId('palette-enter-pending')).toBeNull()
  })

  // ── R23-N4: "tsl" is no ticker, but begins several. Its top row is decided
  // by the TICKER answer too, so where Enter lands must not depend on which
  // request answers first. Round 3 went to /research/TSL when the notes
  // answered first and to /research/TSLA when the tickers did.
  const TSL = {
    tickers: [{ ticker: 'TSLA', name: 'Tesla Inc' }, { ticker: 'TSLL', name: 'Direxion Daily TSLA Bull' }],
    notes: [noteRow({ id: 't1', title: 'TSL setup notes', exact: false })],
  }
  function gate() {
    let release
    const promise = new Promise((r) => { release = r })
    return { promise, release }
  }
  /** Where Enter on `query` lands when the two answers arrive in `order`:
   *  'fast' (Enter before either), 'slow' (both rendered first),
   *  'tickers-first' / 'notes-first' (Enter after that one answered and
   *  rendered, the other released afterwards). */
  async function landingIn(order, query, fixture, { arrowDuringWait = 0 } = {}) {
    const notesGate = order === 'tickers-first' ? gate() : null
    const tickersGate = order === 'notes-first' ? gate() : null
    routeFetch({ ...fixture, notesGate: notesGate?.promise, tickersGate: tickersGate?.promise })
    const { unmount } = renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: query } })
    if (order === 'slow' || order === 'tickers-first') await screen.findByText(fixture.tickers[0].name)
    if (order === 'slow' || order === 'notes-first') {
      await screen.findByRole('option', { name: new RegExp(`Note: ${fixture.notes[0].title}`) })
    }
    fireEvent.keyDown(input, { key: 'Enter' })
    if (order === 'tickers-first' || order === 'notes-first') {
      // It must be WAITING for the other answer -- not landed on a guess.
      expect(screen.getByTestId('palette-enter-pending')).toBeInTheDocument()
      expect(screen.getByTestId('route-spy')).toHaveTextContent('/dashboard')
    }
    for (let i = 0; i < arrowDuringWait; i += 1) fireEvent.keyDown(input, { key: 'ArrowDown' })
    await act(async () => { notesGate?.release(); tickersGate?.release() })
    await waitFor(() => expect(screen.getByTestId('route-spy').textContent).not.toBe('/dashboard'))
    const where = screen.getByTestId('route-spy').textContent
    unmount()
    return where
  }

  it('"tsl" lands on the same row whichever answer comes first, and whenever Enter is pressed', async () => {
    const landings = {}
    for (const order of ['fast', 'slow', 'tickers-first', 'notes-first']) {
      landings[order] = await landingIn(order, 'tsl', TSL)
    }
    expect(landings).toEqual({
      fast: '/research/TSLA', slow: '/research/TSLA',
      'tickers-first': '/research/TSLA', 'notes-first': '/research/TSLA',
    })
  })

  it('R4-N1: the arrowed-to row is kept by IDENTITY — a late answer that reorders the rows cannot move the landing', async () => {
    // Tickers first: [TSLA, TSLL, Go to TSL]. Enter waits for the notes, and
    // ArrowDown picks TSLL (index 1). The notes then answer with a note TITLED
    // "TSL": the rule puts it on top, so index 1 becomes TSLA — a row the member
    // never highlighted. The landing must still be TSLL.
    const reorders = { ...TSL, notes: [noteRow({ id: 'x1', title: 'TSL', exact: true })] }
    expect(await landingIn('tickers-first', 'tsl', reorders, { arrowDuringWait: 1 })).toBe('/research/TSLL')
    // The other order: notes first ([Go to TSL, the note]), ArrowDown picks the
    // NOTE, then the tickers answer and push it to index 3.
    expect(await landingIn('notes-first', 'tsl', TSL, { arrowDuringWait: 1 })).toBe('/journal/notebook?note=t1')
  })

  it('R4-N2: a ticker search that FAILS never lands on the previous prefix\'s symbol — Enter opens the typed one', async () => {
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/ticker-search')) {
        const q = new URL(u, 'http://x').searchParams.get('q')
        if (q === 'ts') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({
            results: [{ ticker: 'TSLA', name: 'Tesla Inc' }, { ticker: 'TSM', name: 'Taiwan Semiconductor' }] }) })
        }
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ detail: 'boom' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ notes: [], hasMore: false }) })
    })
    renderPalette()
    act(() => pressCtrlK())
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'ts' } })
    await screen.findByText('Tesla Inc')                                     // the prefix answered
    fireEvent.change(input, { target: { value: 'tsl' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText(/Search is briefly unavailable — Enter still opens the typed symbol/)
    expect(screen.queryByText('Tesla Inc')).toBeNull()                       // no row from "ts" under "tsl"
    await waitFor(() => expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/TSL'), { timeout: 1500 })
    expect(screen.getByTestId('route-spy').textContent).toBe('/research/TSL')  // not TSLA
  })

  it('an arrow pressed during the wait is honoured: it lands on the highlighted row, not row 0', async () => {
    // Enter after the tickers rendered [TSLA, TSLL, Go to TSL]; one ArrowDown
    // while the notes answer is still out moves the highlight to TSLL.
    expect(await landingIn('tickers-first', 'tsl', TSL, { arrowDuringWait: 1 })).toBe('/research/TSLL')
    // Control: without the arrow the same wait lands on row 0.
    expect(await landingIn('tickers-first', 'tsl', TSL)).toBe('/research/TSLA')
  })
})
