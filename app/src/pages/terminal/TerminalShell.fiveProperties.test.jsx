// X-11 / V22 — the five terminal-grade properties, walked ON /terminal.
//
// The 2026-09-24 "5/5 PASS" walk (10-roadmap/evidence/2026-09-24-day7-walkthrough/) ran the
// roadmap's integrator checklist (2026-09-23-one-week-execution-roadmap.md §5, "What the
// integrator actually checks per surface") on /dashboard, /charts, /research and /screener.
// This file runs the SAME five checks, one concrete action each, against the real
// TerminalShell (jsdom). What is real and what is stood in for is said per property:
//
//   1. One context   "Load a symbol on Surface A; open Surface B in the same session; confirm B
//                    already shows it, with no re-entry." Real: the command line, the shell's
//                    channel model and the shared `charts_workspace_groups` preference /charts
//                    reads (pages/charts/ChartsWorkspace.jsx). Proxy: /charts itself is not
//                    mounted; its side of the contract is that preference, asserted both ways.
//   2. Provenance    "Click any computed number; confirm a citation resolves to a real, specific
//                    source, not a generic badge." Real: GradePanel (GRADE) and the shell's
//                    PanelProvenance header, the disclosure clicked open. Stood in: the network
//                    answer (`jsonFetcher` returns grade_ticker's shape).
//   3. Addressable   "Save a view; close the tab; open the saved view's link/name directly;
//                    confirm it is the same state, not a fresh default." Real: the Boards sheet's
//                    Save and Share, `B:<slug>` through `?cmd=`, `?board=` and `?cmd=`. "Close the
//                    tab" is an unmount plus cleared session/local storage; the member's saved
//                    preferences (server side) are kept, as a real reload keeps them.
//   4. Keyboard-fast "Complete the surface's one primary action without touching the mouse."
//                    Real: the app-wide CommandPalette mount that owns the backtick key, the
//                    shortcut registry, the command line. A capture listener counts every pointer
//                    event in the walk and must read zero.
//   5. Resilient     "Force one panel's data call to fail; confirm the rest of the layout survives,
//                    with a visible error only in that one panel." Real: two GradePanels, one
//                    whose /api/terminal/grade read answers 500; plus a panel that throws in
//                    render (the V22 rail's case) on the same board.
//
// Not measured here (jsdom computes no layout): pixel geometry, real focus rings, a real
// network. Those were what the 2026-09-24 Playwright walk added; see the dated record
// docs/terminal-research/10-roadmap/evidence/2026-10-10-terminal-five-properties/.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, within, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set(), writes: [] }))
// Per-symbol answers for GRADE's one read; anything else is a fake 500.
const net = vi.hoisted(() => ({ grade: {} }))

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

vi.mock('../../utils/jsonFetcher', () => ({
  default: vi.fn((url) => {
    const m = /^\/api\/terminal\/grade\/([^/?]+)/.exec(String(url))
    if (m) {
      const answer = net.grade[decodeURIComponent(m[1])]
      if (answer && answer.status) return Promise.reject(Object.assign(new Error('HTTP ' + answer.status), { status: answer.status }))
      if (answer) return Promise.resolve(answer)
      return Promise.reject(Object.assign(new Error('HTTP 500'), { status: 500 }))
    }
    return Promise.resolve({})
  }),
}))

// The REAL panels module with the REAL GradePanel; every other panel is a stub that prints
// its name and security (BOOM throws in render, the V22 case).
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const { default: GradePanel } = await import('./panels/GradePanel')
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (name === 'Grade') return GradePanel
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym }) {
          if (sym === 'BOOM') throw new Error(`stub ${name} blew up`)
          return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div>
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import CommandPalette from '../../components/CommandPalette'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import { DEFAULT_LAYOUT } from './boardModel'

const OPEN = { cohorts: ['terminal-next'], isPaid: true }

const GRADED = (symbol, verdict = 'GO') => ({
  available: true, ok: true, symbol, verdict, regime: 'GREEN', regime_note: 'Tape is healthy.',
  setup: 'VCP', grade: 'A', entry: 100, stop: 95, stop_pct: 5, size_pct: 20, account_risk_pct: 1,
  first_target: 110, basis: `VCP on ${symbol}, graded A.`, hard_flags: [],
  sources: ['regime classifier (GREEN)', 'pattern engine: VCP (conf 85)'], as_of: 1_790_000_000,
})

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

function renderAt(url, { palette = false } = {}) {
  return render(
    <AuthContext.Provider value={OPEN}>
      <MemoryRouter initialEntries={[url]}>
        {palette && <CommandPalette />}
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

/** A v2 board: `panels` is [code, channel, sym] triples; channel A..D or null (unlinked). */
function seed(panels, { focus = 0, groups } = {}) {
  store.prefs = {
    terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: panels.length, focus, closed: [],
      panels: panels.map(([code, channel, sym], i) => ({ id: `p${i + 1}`, code, channel, sym: channel ? null : sym, args: [] })) }),
    ...(groups ? { charts_workspace_groups: JSON.stringify(groups) } : {}),
  }
}

async function type(text, input = screen.getByTestId('terminal-command')) {
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

const panel = (i) => screen.getByTestId(`terminal-panel-${i}`)

/** "Close the tab": unmount, and drop everything a browser tab or profile would hold. The
 *  member's saved preferences (the server's `store.prefs`) survive, as a real reload keeps them. */
function closeTheTab() {
  cleanup()
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
}

beforeEach(() => {
  saveTiming.debounceMs = 0
  closeTheTab()
  store.prefs = {}
  store.writes = []
  net.grade = {}
  setViewport(1400)
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('property 1: one context, read everywhere, without re-entry', () => {
  it('a symbol loaded in one panel is already the symbol in its linked neighbour, and the shared group /charts reads carries it', async () => {
    seed([['GP', 'A'], ['FA', 'A'], ['CN', 'B']], { groups: { A: 'SPY', B: 'QQQ' } })
    renderAt('/terminal')
    // CONTROL: before, both group-A panels show SPY.
    expect(panel(0)).toHaveTextContent('Chart:SPY')
    expect(panel(1)).toHaveTextContent('Financials:SPY')
    await type('NVDA')                                      // Surface A: the focused panel
    expect(panel(0)).toHaveTextContent('Overview:NVDA')
    expect(panel(1)).toHaveTextContent('Financials:NVDA')  // Surface B: nothing re-typed
    expect(panel(2)).toHaveTextContent('News:QQQ')         // another group is left alone
    // The one context the rest of the app reads (ChartsWorkspace's link groups).
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual({ A: 'NVDA', B: 'QQQ' })
  })

  it('the other direction: a symbol loaded elsewhere (/charts group A) is what the terminal opens on', () => {
    seed([['GP', 'A'], ['FA', 'A']], { groups: { A: 'QQQ' } })
    renderAt('/terminal')
    expect(panel(0)).toHaveTextContent('Chart:QQQ')
    expect(panel(1)).toHaveTextContent('Financials:QQQ')
  })
})

describe('property 2: provenance on every number', () => {
  it('a computed verdict names its source and as-of in the panel header, and the disclosure opens to it', async () => {
    net.grade.NVDA = GRADED('NVDA')
    seed([['GRADE', null, 'NVDA']])
    renderAt('/terminal')
    expect(await within(panel(0)).findByTestId('terminal-grade-verdict')).toHaveTextContent('GO')
    const source = await within(panel(0)).findByTestId('terminal-panel-source-0')
    expect(source).toHaveTextContent('Source: Compass grade_ticker')
    // Click the citation: it resolves to the named source and an instant, not a bare badge.
    fireEvent.click(within(source).getByTestId('provenance-detail-toggle'))
    const detail = within(source).getByTestId('provenance-detail-panel')
    expect(detail).toHaveTextContent('Compass grade_ticker')
    expect(detail).toHaveTextContent('10:13:20 AM ET')        // as_of 1_790_000_000 s, on the ET clock
    // The body's own sources are listed too (what the verdict was computed from).
    expect(within(panel(0)).getByTestId('terminal-grade-sources')).toHaveTextContent('pattern engine: VCP')
  })

  it('CONTROL: a panel that has not landed data claims no source', async () => {
    net.grade.NVDA = { status: 500 }
    seed([['GRADE', null, 'NVDA']])
    renderAt('/terminal')
    await within(panel(0)).findByTestId('terminal-grade-error')
    expect(screen.queryByTestId('terminal-panel-source-0')).toBeNull()
  })
})

describe('property 3: saved things become names, and names are addresses', () => {
  it('Save a board; close the tab; B:<slug> opens the same board, not a fresh default', async () => {
    seed([['GP', 'A'], ['FA', 'A'], ['GRADE', null, 'AMD']], { groups: { A: 'NVDA' } })
    net.grade.AMD = GRADED('AMD', 'HOLD')
    renderAt('/terminal')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-boards-button')) })
    fireEvent.change(screen.getByTestId('terminal-board-name'), { target: { value: 'Walk board' } })
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-board-save')) })
    expect(screen.getByTestId('terminal-board-saved')).toHaveTextContent('B:walk-board')

    closeTheTab()
    // The working board moves on (one default panel, another symbol) before the name is used.
    store.prefs = { ...store.prefs, terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: 1 }),
      charts_workspace_groups: JSON.stringify({ A: 'TSLA' }) }
    renderAt('/terminal?cmd=B%3Awalk-board')
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('3')
    expect(panel(0)).toHaveTextContent('Chart:NVDA')
    expect(panel(1)).toHaveTextContent('Financials:NVDA')
    expect(await within(panel(2)).findByTestId('terminal-grade-verdict')).toHaveTextContent('AMD')
    expect(screen.getByTestId('terminal-boards-button')).toHaveTextContent('Walk board')
  })

  it('the share link opens the same board in a fresh session with nothing saved', async () => {
    seed([['GP', 'A'], ['FA', 'A']], { groups: { A: 'NVDA' } })
    renderAt('/terminal')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-boards-button')) })
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-share-current')) })
    const url = new URL(screen.getByRole('textbox', { name: 'Share link' }).value)
    expect(url.pathname).toBe('/terminal')
    expect(url.searchParams.get('board')).toBeTruthy()

    closeTheTab()
    store.prefs = {}                                      // another browser, nothing saved
    renderAt(`${url.pathname}${url.search}`)
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('2')
    expect(panel(0)).toHaveTextContent('Chart:NVDA')
    expect(panel(1)).toHaveTextContent('Financials:NVDA')
  })

  it("a single panel's view is an address too: its ?cmd= reopens it after the tab is closed", async () => {
    net.grade.MSFT = GRADED('MSFT')
    renderAt('/terminal')
    await type('MSFT GRADE')
    const where = screen.getByTestId('where').textContent
    expect(new URLSearchParams(where.split('?')[1]).get('cmd')).toBe('MSFT GRADE')

    closeTheTab()
    store.prefs = {}
    renderAt(where)
    expect(await within(panel(0)).findByTestId('terminal-grade-verdict')).toHaveTextContent('MSFT')
    expect(panel(0).getAttribute('data-code')).toBe('GRADE')
  })
})

describe('property 4: keyboard-fast', () => {
  it('backtick, a command, Enter, Alt+2, a command, Enter: the board is driven with zero pointer events', async () => {
    seed([['GP', null, 'SPY'], ['FA', null, 'SPY']])
    net.grade.NVDA = GRADED('NVDA')
    const pointer = []
    const count = (e) => pointer.push(e.type)
    const kinds = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']
    kinds.forEach((k) => document.addEventListener(k, count, true))
    try {
      renderAt('/terminal', { palette: true })
      // The shell focuses its command line on arrival; leave it first, as a member who was
      // elsewhere on the page would be (a blur is not a pointer event).
      act(() => { document.activeElement?.blur?.() })
      expect(document.activeElement).not.toBe(screen.getByTestId('terminal-command'))   // control
      // ` is the global terminal key, owned by the app-wide palette mount.
      await act(async () => { fireEvent.keyDown(window, { key: '`', code: 'Backquote' }) })
      const input = screen.getByTestId('terminal-command')
      expect(document.activeElement).toBe(input)
      await type('NVDA GRADE', document.activeElement)
      expect(await within(panel(0)).findByTestId('terminal-grade-verdict')).toHaveTextContent('NVDA')
      // Alt+2 moves to panel 2 from inside the command line; the next command lands there.
      await act(async () => { fireEvent.keyDown(document.activeElement, { key: '2', code: 'Digit2', altKey: true }) })
      expect(panel(1).dataset.focused).toBe('true')
      await type('AMD DES', document.activeElement)
      expect(panel(1)).toHaveTextContent('Overview:AMD')
      expect(panel(0).getAttribute('data-code')).toBe('GRADE')
      expect(pointer).toEqual([])
    } finally {
      kinds.forEach((k) => document.removeEventListener(k, count, true))
    }
  })
})

describe('property 5: panels are independent, and the board survives', () => {
  it("one panel's data call fails: only that panel says so; its neighbours render; the command line still drives", async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    net.grade.NVDA = GRADED('NVDA')
    net.grade.AMD = { status: 500 }
    seed([['GRADE', null, 'NVDA'], ['GRADE', null, 'AMD'], ['FA', null, 'BOOM'], ['DES', null, 'MSFT']], { focus: 3 })
    renderAt('/terminal')
    const failed = await within(panel(1)).findByTestId('terminal-grade-error')
    expect(failed).toHaveTextContent('Could not grade AMD just now.')
    expect(within(failed).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(await within(panel(0)).findByTestId('terminal-grade-verdict')).toHaveTextContent('NVDA')
    expect(within(panel(0)).queryByTestId('terminal-grade-error')).toBeNull()
    // A panel that throws in render is caught by its own boundary, not the board's.
    expect(within(panel(2)).getByTestId('terminal-panel-crashed')).toHaveTextContent('FA hit an error')
    expect(panel(3)).toHaveTextContent('Overview:MSFT')
    expect(screen.getAllByTestId('terminal-grade-error')).toHaveLength(1)
    expect(screen.getAllByTestId('terminal-panel-crashed')).toHaveLength(1)
    await type('TSLA')
    expect(panel(3)).toHaveTextContent('Overview:TSLA')
    // Retry re-reads: once the source answers, the failed panel recovers in place.
    net.grade.AMD = GRADED('AMD', 'HOLD')
    await act(async () => { fireEvent.click(within(panel(1)).getByRole('button', { name: 'Retry' })) })
    await waitFor(() => expect(within(panel(1)).getByTestId('terminal-grade-verdict')).toHaveTextContent('AMD'))
    quiet.mockRestore()
  })
})
