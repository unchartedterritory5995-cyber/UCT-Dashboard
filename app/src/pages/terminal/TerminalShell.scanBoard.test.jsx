// Scan-to-board (feature-gaps-2026-10-06 #9) at the SHELL: a list becomes a board of panels in one
// action — typed (`BOARD GP NVDA AMD …`), from the focused panel's list (MOST's published rows,
// the screener's `usePanelList`), from the list panels' own "Board of" control, from a watchlist
// — and it NEVER replaces the member's board without a way back. scanBoard.test.js proves the
// pure half. Same harness as TerminalBoards.test.jsx (preferences store, stubbed components over
// the REAL panels module).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set(), writes: [] }))
const net = vi.hoisted(() => ({ routes: {}, calls: [] }))

vi.mock('../../hooks/usePreferences', () => {
  const parsePref = (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  }
  const notify = () => store.listeners.forEach((f) => f())
  return {
    parsePref,
    default: function usePreferences() {
      const [, force] = useReducer((x) => x + 1, 0)
      useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])
      return {
        prefs: store.prefs,
        loading: false,
        setPref: (k, v) => { store.writes.push([k, v]); store.prefs = { ...store.prefs, [k]: v }; notify() },
        setPrefMerged: async (k, updater) => {
          const next = updater(parsePref(store.prefs[k], undefined))
          if (next === undefined) return
          const v = typeof next === 'string' ? next : JSON.stringify(next)
          store.writes.push([k, v]); store.prefs = { ...store.prefs, [k]: v }; notify()
        },
      }
    },
  }
})

// Every read the shell makes. A watchlist route answers from `net.routes`; anything else is {}.
vi.mock('../../utils/jsonFetcher', () => ({
  default: (url) => {
    net.calls.push(url)
    const hit = Object.keys(net.routes).find((k) => String(url).startsWith(k))
    if (!hit) return Promise.resolve({})
    const r = net.routes[hit]
    return r.status ? Promise.reject(Object.assign(new Error('x'), { status: r.status })) : Promise.resolve(r.body)
  },
}))

// The REAL panels module with stubbed components. MOST's stub publishes rows as the real panel
// does; the SCREENER's stub reports its results through the real `usePanelList` and renders the
// real shared "Board of" control, as ScannerShell does.
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const terminal = await import('../../components/terminal')
  const { BY_CODE } = await import('./functions')
  const screenerName = real.panelNameFor(BY_CODE.SCR.market)
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        let C
        if (name === 'Movers') {
          C = function MoversStub({ onRows }) {
            useEffect(() => { onRows?.(['$AMD', '$TSLA', '$AMD']) }, [onRows])
            return (
              <div data-testid="stub-Movers">
                <terminal.BoardFromList syms={['AMD', 'TSLA']} label="MOST gainers" testId="terminal-movers-board" />
              </div>
            )
          }
        } else if (name === screenerName) {
          C = function ScreenerStub() {
            const syms = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']
            terminal.usePanelList({ syms, label: 'screener results', total: 312 })
            return (
              <div data-testid="stub-Screener">
                <terminal.BoardFromList syms={syms} label="screener results" total={312} testId="screener-board-from-list" />
              </div>
            )
          }
        } else {
          C = function Stub({ sym }) { return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div> }
        }
        stubs.set(name, C)
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import { DEFAULT_LAYOUT, setCount as countOf } from './boardModel'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true }

function renderAt(url = '/terminal') {
  return render(
    <AuthContext.Provider value={OPEN}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="/terminal/calendar" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}
const click = async (id) => { await act(async () => { fireEvent.click(screen.getByTestId(id)) }) }

/** What the board shows: `CODE:SYM` per visible panel. */
function board() {
  const out = []
  for (let i = 0; i < 4; i += 1) {
    const p = screen.queryByTestId(`terminal-panel-${i}`)
    if (!p) break
    out.push(`${p.getAttribute('data-code')}:${p.querySelector('[data-testid^="stub-"]')?.textContent?.split(':')[1] || ''}`)
  }
  return out
}
const notice = () => screen.getByTestId('terminal-notice').textContent
const boardWrites = () => store.writes.filter(([k]) => k === 'terminal_boards')

// The member's own board: two panels, so "the way back" has something real to restore.
const MINE = countOf(DEFAULT_LAYOUT, 2)

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = { terminal_layout: JSON.stringify(MINE) }
  store.writes = []
  net.routes = {}
  net.calls = []
  setViewport(1400)
})
afterEach(() => cleanup())

describe('scan-to-board — a typed list', () => {
  it('opens one panel per name, says which names are not on screen, pages, and goes back', async () => {
    renderAt()
    const before = board()
    await type('BOARD GP NVDA AMD MSFT TSLA SMCI PLTR')
    expect(board()).toEqual(['GP:NVDA', 'GP:AMD', 'GP:MSFT', 'GP:TSLA'])
    // The panel limit is said, and the two names left off are NAMED (never silently dropped).
    expect(notice()).toMatch(/Names 1-4 of 6; a board shows 4 panels at a time\. Not on screen yet: SMCI, PLTR\./)
    expect(screen.getByTestId('terminal-boards-button')).toHaveTextContent('Board: GP · your list')

    await click('terminal-notice-board-next')
    expect(board()).toEqual(['GP:SMCI', 'GP:PLTR'])
    expect(notice()).toMatch(/Earlier pages: NVDA, AMD, MSFT, TSLA\./)
    await click('terminal-notice-board-prev')
    expect(board()).toEqual(['GP:NVDA', 'GP:AMD', 'GP:MSFT', 'GP:TSLA'])

    // ⭐ The way back: the member's OWN board, even after paging (not page 1 of the scan).
    await click('terminal-revert-layout')
    expect(board()).toEqual(before)
    expect(JSON.parse(store.prefs.terminal_layout).panels.slice(0, 2).map((p) => p.code))
      .toEqual(MINE.panels.slice(0, 2).map((p) => p.code))
    // Nothing reached the library: a scan board is saved only on request.
    expect(boardWrites()).toHaveLength(0)
  })

  it('the way back survives a reload of the tab (the revert memory is per tab, not in-memory only)', async () => {
    const first = renderAt()
    await type('BOARD DES NVDA AMD')
    expect(board()).toEqual(['DES:NVDA', 'DES:AMD'])
    first.unmount()
    renderAt()
    expect(board()).toEqual(['DES:NVDA', 'DES:AMD'])
    await click('terminal-revert-layout')
    expect(board().map((b) => b.split(':')[0])).toEqual(MINE.panels.slice(0, 2).map((p) => p.code))
  })

  it('"Save to my boards" writes the library through the existing terminal_boards path, and keeps the page buttons', async () => {
    renderAt()
    await type('BOARD GP NVDA AMD MSFT TSLA SMCI')
    expect(boardWrites()).toHaveLength(0)
    await click('terminal-notice-save-scan')
    expect(boardWrites()).toHaveLength(1)
    const lib = JSON.parse(store.prefs.terminal_boards)
    expect(lib.boards.map((b) => b.name)).toEqual(['GP · your list'])
    expect(lib.boards[0].layout.panels.slice(0, 4).map((p) => p.sym)).toEqual(['NVDA', 'AMD', 'MSFT', 'TSLA'])
    // No new preference key: only the two the terminal already owns (plus the groups) were written.
    expect([...new Set(store.writes.map(([k]) => k))].sort()).toEqual(['terminal_boards', 'terminal_layout'])
    expect(notice()).toMatch(/Saved as GP · your list/)
    expect(screen.getByTestId('terminal-notice-board-next')).toBeTruthy()
    expect(screen.getByTestId('terminal-notice-revert')).toBeTruthy()
  })

  it('a function that cannot fill a board is refused and the board is untouched', async () => {
    renderAt()
    const before = board()
    await type('BOARD CMP NVDA AMD')
    expect(notice()).toMatch(/outside the terminal/)
    await type('BOARD ERN NVDA AMD')
    expect(notice()).toMatch(/only once/)
    expect(board()).toEqual(before)
    expect(screen.queryByTestId('terminal-revert-layout')).toBe(null)
  })

  it('a link cannot build a board over the member\'s (BOARD runs from the command line)', async () => {
    renderAt('/terminal?cmd=BOARD%20GP%20NVDA%20AMD')
    expect(notice()).toMatch(/not from a link/)
    expect(board().map((b) => b.split(':')[0])).toEqual(MINE.panels.slice(0, 2).map((p) => p.code))
  })

  it('a pasted ticker list offers the board in one click', async () => {
    renderAt()
    await type('NVDA AMD MSFT')
    expect(notice()).toMatch(/BOARD GP NVDA AMD MSFT/)
    await click('terminal-notice-board-list')
    expect(board()).toEqual(['GP:NVDA', 'GP:AMD', 'GP:MSFT'])
  })
})

describe('scan-to-board — the focused panel\'s list', () => {
  it('BOARD GP on MOST uses its published rows (repeats counted once, and said)', async () => {
    renderAt()
    await type('MOST')
    await type('BOARD GP')
    expect(board()).toEqual(['GP:AMD', 'GP:TSLA'])
    expect(notice()).toMatch(/Opened MOST as a board of GP: AMD, TSLA\./)
    expect(notice()).toMatch(/1 repeated name counted once \(AMD\)/)
  })

  it('MOST\'s own "Board of" control opens the rows as the picked function', async () => {
    renderAt()
    await type('MOST')
    fireEvent.change(screen.getByTestId('terminal-movers-board-code'), { target: { value: 'DES' } })
    await click('terminal-movers-board-open')
    expect(board()).toEqual(['DES:AMD', 'DES:TSLA'])
    expect(notice()).toMatch(/Opened MOST gainers as a board of DES/)
  })

  it('BOARD GP on the screener uses the results it published (and says only part was loaded)', async () => {
    renderAt()
    await type('SCR')
    await type('BOARD GP')
    expect(board()).toEqual(['GP:AAA', 'GP:BBB', 'GP:CCC', 'GP:DDD'])
    expect(notice()).toMatch(/Not on screen yet: EEE\./)
    expect(notice()).toMatch(/The list holds 312 in all; 5 were loaded/)
  })

  it('the screener\'s "Board of" control does the same in one click', async () => {
    renderAt()
    await type('SCR')
    await click('screener-board-from-list-open')
    expect(board()).toEqual(['GP:AAA', 'GP:BBB', 'GP:CCC', 'GP:DDD'])
  })

  it('a panel with no list says so and changes nothing', async () => {
    renderAt()
    await type('NVDA DES')
    const before = board()
    await type('BOARD GP')
    expect(notice()).toMatch(/shows no list of securities to open/)
    expect(board()).toEqual(before)
  })
})

describe('scan-to-board — a watchlist', () => {
  it('BOARD GP W:7 reads that list and opens it', async () => {
    net.routes['/api/watchlists/7'] = { body: { name: 'Semis', items: [{ sym: 'NVDA' }, { sym: 'AMD' }, { sym: 'AVGO' }] } }
    renderAt()
    await type('BOARD GP W:7')
    await act(async () => {})
    expect(net.calls).toContain('/api/watchlists/7?slim=1')
    expect(board()).toEqual(['GP:NVDA', 'GP:AMD', 'GP:AVGO'])
    expect(notice()).toMatch(/Opened watchlist Semis \(W:7\) as a board of GP/)
  })

  it('BOARD CN FLAGGED reads the flagged list', async () => {
    net.routes['/api/watchlists/flagged'] = { body: { items: [{ sym: 'TSLA' }] } }
    renderAt()
    await type('BOARD CN FLAGGED')
    await act(async () => {})
    expect(board()).toEqual(['CN:TSLA'])
  })

  it('a missing watchlist is said, and the board is untouched', async () => {
    net.routes['/api/watchlists/9'] = { status: 404 }
    renderAt()
    const before = board()
    await type('BOARD GP W:9')
    await act(async () => {})
    expect(notice()).toMatch(/no watchlist at W:9/)
    expect(board()).toEqual(before)
  })
})
