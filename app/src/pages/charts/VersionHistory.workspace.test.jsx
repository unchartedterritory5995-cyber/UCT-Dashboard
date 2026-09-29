// TERM-051 through the REAL workspace: the entry point in the Layouts menu, the
// board reloading after a restore, and the STATE-2 guard.
//
// Same mock shape as ChartsWorkspace.test.jsx (heavy children stubbed, prefs and
// layouts hooks controlled). What is NOT mocked is the path under test: the menu,
// the panel, the fetches it makes and the board state it reseeds.
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { vi } from 'vitest'
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
let mockPrefs = {}
const refreshPreferences = vi.fn()
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: (...a) => refreshPreferences(...a),
}))
let mqMatches = false
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => mqMatches }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [], mine: [], isLoading: false,
    saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import ChartsWorkspace, { isUnreadableStoredLayout } from './ChartsWorkspace'
import { WORKSPACE_DOC_URL } from './VersionHistory'

const CORRUPT = '{"widgets":[{"id":"c1","type":"chart"'   // a truncated write
const CHART_BOARD = JSON.stringify({ widgets: [{ id: 'c1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 })
const SCANNER_BOARD = JSON.stringify({ widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 })

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function renderWS() {
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
async function flush() {
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })
}
function openLayoutsMenu() {
  const header = document.querySelector('header')
  const trigger = within(header).getAllByRole('button').find(b => /^Layouts/.test(b.textContent))
  act(() => { fireEvent.click(trigger) })
}
const layoutWrites = () => setPref.mock.calls.filter(([k]) => k === 'charts_workspace_layout')

beforeEach(() => {
  setPref.mockReset()
  refreshPreferences.mockReset()
  mockPrefs = {}
  mqMatches = false
})
afterEach(() => {
  vi.useRealTimers()
  delete global.fetch
})

// ── STATE-2 ──────────────────────────────────────────────────────────────────
describe('STATE-2: a stored board that cannot be read is never autosaved over', () => {
  test('the predicate: unreadable is a PRESENT value parseLayout refuses; absent/empty/null are not', () => {
    expect(isUnreadableStoredLayout(CORRUPT)).toBe(true)
    expect(isUnreadableStoredLayout('{"cols":24}')).toBe(true)   // parses, is not a layout
    expect(isUnreadableStoredLayout(CHART_BOARD)).toBe(false)
    expect(isUnreadableStoredLayout(undefined)).toBe(false)
    expect(isUnreadableStoredLayout('')).toBe(false)
    expect(isUnreadableStoredLayout('null')).toBe(false)
  })

  test('corrupt stored layout: the default board shows, the debounce and the unmount flush both refuse, the member is told', () => {
    vi.useFakeTimers()
    mockPrefs = { charts_workspace_layout: CORRUPT }
    const { unmount } = renderWS()
    // The board still renders a default (there is nothing else to show)...
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    // ...and the member is told, in words.
    expect(screen.getByTestId('layout-held-notice').textContent).toBe(
      'Your saved board could not be read. A default board is showing instead. Your saved board has been kept as it was, and changes made here are not saved automatically until you open a layout or save this one.',
    )
    // The mount-time onLayoutChange that used to overwrite the original:
    act(() => { screen.getByTestId('rgl-fire-change').click() })
    act(() => { vi.advanceTimersByTime(600) })
    expect(layoutWrites()).toEqual([])
    // A second change, then leave before the debounce lands: the flush refuses too.
    act(() => { screen.getByTestId('rgl-fire-change').click() })
    unmount()
    expect(layoutWrites()).toEqual([])
  })

  test('CONTROL: the same gesture on a READABLE stored board does save (the test can tell the two apart)', () => {
    vi.useFakeTimers()
    mockPrefs = { charts_workspace_layout: CHART_BOARD }
    renderWS()
    expect(screen.queryByTestId('layout-held-notice')).toBeNull()
    act(() => { screen.getByTestId('rgl-fire-change').click() })
    act(() => { vi.advanceTimersByTime(600) })
    expect(layoutWrites()).toHaveLength(1)
  })

  test('a deliberate member action still writes: New Layout replaces the unreadable value', () => {
    mockPrefs = { charts_workspace_layout: CORRUPT }
    renderWS()
    openLayoutsMenu()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'New Layout' })) })
    expect(layoutWrites().map(([, v]) => JSON.parse(v).widgets)).toEqual([[]])
  })

  test('the held notice can be dismissed, and dismissing it does not lift the guard', () => {
    vi.useFakeTimers()
    mockPrefs = { charts_workspace_layout: CORRUPT }
    renderWS()
    act(() => { fireEvent.click(within(screen.getByTestId('layout-held-notice')).getByRole('button', { name: 'Dismiss' })) })
    expect(screen.queryByTestId('layout-held-notice')).toBeNull()
    act(() => { screen.getByTestId('rgl-fire-change').click() })
    act(() => { vi.advanceTimersByTime(600) })
    expect(layoutWrites()).toEqual([])
  })
})

// ── the entry point ──────────────────────────────────────────────────────────
describe('the Layouts menu entry', () => {
  test('store DARK (404): the Layouts menu shows NO version-history entry', async () => {
    const probe = vi.fn(async () => res(404, { detail: 'Not Found' }))
    global.fetch = probe
    mockPrefs = { charts_workspace_layout: CHART_BOARD }
    renderWS()
    openLayoutsMenu()
    await flush()
    // Non-vacuity: the entry asked the store and got its 404.
    expect(probe.mock.calls.some(([u]) => String(u).startsWith(`${WORKSPACE_DOC_URL}/versions?`))).toBe(true)
    expect(screen.getByRole('button', { name: 'New Layout' })).toBeInTheDocument()   // the menu IS open
    expect(screen.queryByRole('button', { name: /version history/i })).toBeNull()
  })
})

// ── the full restore, through the workspace ──────────────────────────────────
describe('restore through the workspace', () => {
  const VERSIONS = [
    { version: 2, source: 'mirror', created_at: 1790002000, tombstone: false, restored_from: null },
    { version: 1, source: 'migration', created_at: 1790001000, tombstone: false, restored_from: null },
  ]
  const DOCS = {
    2: { schema_version: 1, board: 'charts', prefs: { charts_workspace_layout: CHART_BOARD } },
    1: { schema_version: 1, board: 'charts', prefs: { charts_workspace_layout: SCANNER_BOARD } },
  }
  function armedFetch() {
    return vi.fn(async (url, init) => {
      const u = String(url)
      const method = (init?.method || 'GET').toUpperCase()
      if (method === 'GET' && u.startsWith(`${WORKSPACE_DOC_URL}/versions?`)) return res(200, { board: 'charts', versions: VERSIONS })
      const m = u.match(/\/versions\/(\d+)\?/)
      if (method === 'GET' && m) return res(200, { version: Number(m[1]), tombstone: false, doc: DOCS[Number(m[1])] })
      if (method === 'POST' && u === `${WORKSPACE_DOC_URL}/restore`) {
        const body = JSON.parse(init.body)
        return res(200, {
          board: 'charts', version: 3, appended: true, restored_from: body.version,
          prefs_written: ['charts_workspace_layout'], prefs_unchanged: [], prefs_failed: [],
          left_untouched: [], complete: true,
        })
      }
      return res(404, {})
    })
  }

  test('a restore reloads the board from the restored prefs, and the outcome outlives the panel', async () => {
    global.fetch = armedFetch()
    mockPrefs = { charts_workspace_layout: CHART_BOARD }
    refreshPreferences.mockResolvedValue({ theme: 'oled', charts_workspace_layout: SCANNER_BOARD })
    renderWS()
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()

    openLayoutsMenu()
    fireEvent.click(await screen.findByRole('button', { name: /version history/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Version 1,/ }))
    await within(dialog).findByText('Restoring version 1 changes: Board layout.')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Restore version 1' })) })
    await flush()

    // The restore route wrote user_preferences; the client RE-READ them...
    expect(refreshPreferences).toHaveBeenCalledTimes(1)
    // ...and the board is the restored one.
    expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
    expect(screen.queryByTestId('body-chart')).toBeNull()
    // The panel is gone; its outcome is still on screen, in words.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('workspace-notice').textContent).toBe('Restored version 1. Your board now matches it.')
    // Nothing on the client wrote the layout: the server's write-back is the only writer.
    expect(layoutWrites()).toEqual([])
  })

  test('a failed re-read says so instead of showing a board it could not confirm', async () => {
    global.fetch = armedFetch()
    mockPrefs = { charts_workspace_layout: CHART_BOARD }
    refreshPreferences.mockResolvedValue(null)
    renderWS()
    openLayoutsMenu()
    fireEvent.click(await screen.findByRole('button', { name: /version history/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Version 1,/ }))
    await within(dialog).findByText('Restoring version 1 changes: Board layout.')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Restore version 1' })) })
    await flush()
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-notice').textContent).toBe(
      'Version 1 was restored, but the board could not be reloaded. Reload the page to see it.',
    )
  })
})
