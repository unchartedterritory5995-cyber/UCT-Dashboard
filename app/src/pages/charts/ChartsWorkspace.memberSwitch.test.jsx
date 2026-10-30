// One board per member. Another tab signing in as B (AuthContext's cross-tab re-check publishes the new
// member through lib/prefsSession) left an open Charts workspace holding A's board as local state, latched
// so B's preferences never replaced it, and the next drag saved A's board into B's ACCOUNT. The workspace
// is keyed by the preferences session generation, and a save scheduled for A is dropped by its op.
//
// Same mock shape as boardDocument.workspace.test.jsx (heavy children stubbed, prefs hook controlled).
// The mocked prefs hook does not clear itself on a change of member, so each case sets `mockPrefs` to B's
// before publishing B, as the real hook's reset-and-read would.
import { render, screen, act } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`body-${widget.type}`}>{widget.type}</div>,
}))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, onLayoutChange }) => (
    <div data-testid="rgl-responsive">
      <button data-testid="rgl-fire-change" onClick={() => onLayoutChange && onLayoutChange([{ i: 'fake', x: 0, y: 0, w: 6, h: 6 }])}>fire</button>
      {children}
    </div>
  ),
  WidthProvider: (C) => C,
}))

const setPref = vi.fn()
const setPrefMerged = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: vi.fn(),
  whenWritesSettle: () => Promise.resolve(),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [], mine: [], isLoading: false,
    saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../lib/prefsSession'

const A_BOARD = JSON.stringify({ widgets: [{ id: 'a1', type: 'scanner', color: 'C', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 })
const B_BOARD = JSON.stringify({ widgets: [{ id: 'b1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 })
const layoutWrites = () => setPref.mock.calls.filter(([k]) => k === 'charts_workspace_layout').map(([, v]) => JSON.parse(v))
const types = (board) => board.widgets.map((w) => w.type)

function renderWS() {
  window.history.replaceState({}, '', '/charts')
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setPref.mockReset()
  setPrefMerged.mockReset()
  localStorage.clear()
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
  mockPrefs = { charts_workspace_layout: A_BOARD }
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
})
afterEach(() => {
  vi.useRealTimers()
  delete globalThis.fetch
  __resetPrefsSessionForTests()
  window.history.replaceState({}, '', '/')
})

describe('the Charts workspace across a change of member', () => {
  test('a save scheduled for A when B signs in is dropped: A\'s board is never written', () => {
    renderWS()
    expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
    act(() => { screen.getByTestId('rgl-fire-change').click() })      // A drags; the 500 ms save is pending
    mockPrefs = { charts_workspace_layout: B_BOARD }
    act(() => { publishPrefsUser('B') })                               // another tab signed in as B
    act(() => { vi.advanceTimersByTime(1000) })
    expect(layoutWrites().filter((b) => types(b).includes('scanner'))).toEqual([])
  })

  test('after B signs in the board is B\'s, and B\'s next drag saves B\'s board, never A\'s', () => {
    renderWS()
    expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
    mockPrefs = { charts_workspace_layout: B_BOARD }
    act(() => { publishPrefsUser('B') })
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()       // the stale board is gone
    expect(screen.queryByTestId('body-scanner')).toBeNull()
    act(() => { screen.getByTestId('rgl-fire-change').click() })
    act(() => { vi.advanceTimersByTime(1000) })
    const writes = layoutWrites()
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((b) => types(b).join() === 'chart')).toBe(true)
  })

  test('control: the same member\'s drag saves their board once the debounce elapses', () => {
    renderWS()
    act(() => { screen.getByTestId('rgl-fire-change').click() })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(layoutWrites().map(types)).toEqual([['scanner']])
  })

  test('control: the first answer of /me (no member before it) does not remount the board', () => {
    __resetPrefsSessionForTests()                                      // nothing published yet
    renderWS()
    const before = screen.getByTestId('rgl-responsive')
    act(() => { publishPrefsUser('A') })
    expect(screen.getByTestId('rgl-responsive')).toBe(before)
  })
})
