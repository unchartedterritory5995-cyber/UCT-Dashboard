// TERM-021 read-new, through the REAL workspace: a board change (open a layout
// template, New Layout, UCT Default) is ONE document write while the store is
// armed, and exactly the per-key writes it always was while it is dark.
//
// Same mock shape as VersionHistory.workspace.test.jsx (heavy children stubbed,
// prefs + layouts hooks controlled). NOT mocked: commitBoard, the recorder, the
// fetches it makes, and the board state it switches.
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
const setPrefMerged = vi.fn()
let mockPrefs = {}
const refreshPreferences = vi.fn()
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: (...a) => refreshPreferences(...a),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))

const SCANNER_LAYOUT = { widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 }
const PREBUILT = { id: 7, name: 'Scanner', scope: 'global', layout: SCANNER_LAYOUT }
const COLS = { order: ['sym', 'chg'], widths: { sym: 80 } }
const PERSONAL = {
  id: 9, name: 'Mine', scope: 'user',
  layout: { ...SCANNER_LAYOUT, chartSettings: { settingsVersion: 2, chartType: 'bars' }, watchlistColumns: COLS },
}
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [PREBUILT], mine: [PERSONAL], isLoading: false,
    saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import ChartsWorkspace, { serializeLayout, uctDefaultChartSettings } from './ChartsWorkspace'
import { WORKSPACE_DOC_URL } from './VersionHistory'
import { BOARD_APPLY_URL } from './boardDocument'
import { __setWorkspaceDocStampForTests } from '../../lib/workspaceDoc'
import { WATCHLIST_DEFAULTS } from '../watchlist/watchlistSettings'
import { themeTrackerDefaultsForTheme } from '../theme-tracker/themeTrackerSettings'
import { fundamentalsDefaultsForTheme } from './widgets/fundamentalsSettings'
import { breadthDefaultsForTheme } from './widgets/breadthWidgetSettings'

const CHART_BOARD = JSON.stringify({ widgets: [{ id: 'c1', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 })
const BOARD_KEYS = new Set([
  'aisearch_settings', 'breadth_widget_settings', 'chart_settings', 'charts_active_template', 'charts_merged',
  'charts_theme', 'charts_vol_pane_pct', 'charts_workspace_groups', 'charts_workspace_layout',
  'fundamentals_settings', 'theme_tracker_settings', 'watchlist_columns', 'watchlist_settings',
])
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const boardWrites = () => setPref.mock.calls.filter(([k]) => BOARD_KEYS.has(k))
const docCalls = () => (global.fetch?.mock?.calls || []).filter(([u]) => String(u).startsWith(WORKSPACE_DOC_URL))
const applyPosts = () => (global.fetch?.mock?.calls || []).filter(([u, i]) => String(u) === BOARD_APPLY_URL && i?.method === 'POST')

async function flush() {
  await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })
}
function renderWS(search = '') {
  window.history.replaceState({}, '', `/charts${search}`)
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
function openLayoutsMenu() {
  const header = document.querySelector('header')
  const trigger = within(header).getAllByRole('button').find(b => /^Layouts/.test(b.textContent))
  act(() => { fireEvent.click(trigger) })
}
function armedServer({ apply = () => res(200, { version: 4, appended: true, complete: true, prefs_failed: [] }) } = {}) {
  return vi.fn(async (url, init) => {
    const u = String(url)
    const method = (init?.method || 'GET').toUpperCase()
    if (method === 'GET' && u === `${WORKSPACE_DOC_URL}?board=charts`) return res(200, { board: 'charts', version: 3, doc: {} })
    if (method === 'POST' && u === BOARD_APPLY_URL) return apply(JSON.parse(init.body))
    return res(404, {})
  })
}

beforeEach(() => {
  setPref.mockReset()
  setPrefMerged.mockReset()
  refreshPreferences.mockReset()
  mockPrefs = { charts_workspace_layout: CHART_BOARD }
  localStorage.clear()
  __setWorkspaceDocStampForTests(null)
})
afterEach(() => {
  vi.useRealTimers()
  delete global.fetch
  __setWorkspaceDocStampForTests(null)
  window.history.replaceState({}, '', '/')
})

// ── DARK: byte-identical to before ────────────────────────────────────────────
describe('DARK (no X-Workspace-Doc on the preferences read): the per-key writes, unchanged', () => {
  test('a prebuilt template: the same nine writes, in the same order, with the same values, synchronously — and no document request', async () => {
    global.fetch = vi.fn(async () => res(404, {}))
    localStorage.setItem('uct.watchlist.cols', JSON.stringify(COLS))
    renderWS('?openLayout=7')
    // Synchronous, as before: the board and the writes land in the same tick.
    expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
    expect(boardWrites()).toEqual([
      ['charts_workspace_layout', serializeLayout(SCANNER_LAYOUT)],
      ['watchlist_settings', JSON.stringify(WATCHLIST_DEFAULTS)],
      ['theme_tracker_settings', JSON.stringify(themeTrackerDefaultsForTheme(undefined))],
      ['fundamentals_settings', JSON.stringify(fundamentalsDefaultsForTheme(undefined))],
      ['breadth_widget_settings', JSON.stringify(breadthDefaultsForTheme(undefined))],
      ['chart_settings', uctDefaultChartSettings()],
      ['charts_theme', 'default'],
      ['charts_vol_pane_pct', ''],
      ['charts_active_template', JSON.stringify({ id: 7, name: 'Scanner', scope: 'global' })],
    ])
    expect(localStorage.getItem('uct.watchlist.cols')).toBeNull()   // a prebuilt wipes columns, as before
    await flush()
    expect(docCalls()).toEqual([])
    expect(setPrefMerged).not.toHaveBeenCalled()                    // no column fold while dark
  })

  test('a personal template: its chart settings object is handed to setPref as-is, its columns go to localStorage', () => {
    global.fetch = vi.fn(async () => res(404, {}))
    renderWS('?openLayout=9')
    const w = boardWrites()
    expect(w.map(([k]) => k)).toEqual([
      'charts_workspace_layout', 'watchlist_settings', 'theme_tracker_settings', 'fundamentals_settings',
      'breadth_widget_settings', 'chart_settings', 'charts_active_template',
    ])
    expect(w[5][1]).toEqual({ settingsVersion: 2, chartType: 'bars' })
    expect(JSON.parse(localStorage.getItem('uct.watchlist.cols'))).toEqual(COLS)
  })

  test('New Layout: the same ten writes as before, groups included', () => {
    global.fetch = vi.fn(async () => res(404, {}))
    renderWS()
    openLayoutsMenu()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'New Layout' })) })
    expect(boardWrites().map(([k]) => k)).toEqual([
      'charts_workspace_layout', 'charts_workspace_groups', 'chart_settings', 'watchlist_settings',
      'theme_tracker_settings', 'fundamentals_settings', 'breadth_widget_settings', 'charts_theme',
      'charts_active_template',
    ])
    expect(boardWrites()[8][1]).toBe('null')
  })

  test('UCT Default: the same writes as before', () => {
    global.fetch = vi.fn(async () => res(404, {}))
    renderWS()
    openLayoutsMenu()
    act(() => { fireEvent.click(screen.getByRole('button', { name: /^Open Layout/ })) })
    // The Layouts menu's entry, not the Layout Dock's pill of the same name.
    const entry = screen.getAllByRole('button', { name: 'UCT Default' }).find(b => /addMenuItem/.test(b.className))
    act(() => { fireEvent.click(entry) })
    expect(boardWrites().map(([k]) => k)).toEqual([
      'charts_workspace_layout', 'chart_settings', 'watchlist_settings', 'theme_tracker_settings',
      'fundamentals_settings', 'breadth_widget_settings', 'charts_theme', 'charts_vol_pane_pct',
      'charts_active_template',
    ])
  })
})

// ── ARMED: one document write ─────────────────────────────────────────────────
describe('ARMED: a board change is ONE compare-and-set document write', () => {
  test('a prebuilt template: ONE apply POST carrying every key, NO per-key writes; the board switches after it lands', async () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = armedServer()
    refreshPreferences.mockResolvedValue({ charts_workspace_layout: serializeLayout(SCANNER_LAYOUT) })
    localStorage.setItem('uct.watchlist.cols', JSON.stringify(COLS))
    renderWS('?openLayout=7')
    // Nothing moves until the server has it.
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    await flush()
    expect(applyPosts()).toHaveLength(1)
    const body = JSON.parse(applyPosts()[0][1].body)
    expect(body.base_version).toBe(3)
    expect(body.prefs).toEqual({
      charts_workspace_layout: serializeLayout(SCANNER_LAYOUT),
      watchlist_settings: JSON.stringify(WATCHLIST_DEFAULTS),
      theme_tracker_settings: JSON.stringify(themeTrackerDefaultsForTheme(undefined)),
      fundamentals_settings: JSON.stringify(fundamentalsDefaultsForTheme(undefined)),
      breadth_widget_settings: JSON.stringify(breadthDefaultsForTheme(undefined)),
      watchlist_columns: '',
      chart_settings: uctDefaultChartSettings(),
      charts_theme: 'default',
      charts_vol_pane_pct: '',
      charts_active_template: JSON.stringify({ id: 7, name: 'Scanner', scope: 'global' }),
    })
    expect(boardWrites()).toEqual([])                         // not one per-key write
    expect(refreshPreferences).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
    expect(localStorage.getItem('uct.watchlist.cols')).toBeNull()   // the localStorage half follows the commit
  })

  test('a personal template carries its columns INTO the document, and they reach localStorage after the commit', async () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = armedServer()
    refreshPreferences.mockResolvedValue({})
    renderWS('?openLayout=9')
    await flush()
    const prefs = JSON.parse(applyPosts()[0][1].body).prefs
    expect(prefs.watchlist_columns).toBe(JSON.stringify(COLS))
    expect(prefs.chart_settings).toBe(JSON.stringify({ settingsVersion: 2, chartType: 'bars' }))
    expect(JSON.parse(localStorage.getItem('uct.watchlist.cols'))).toEqual(COLS)
  })

  test('409 (stale base): nothing applied, nothing retried, no per-key fallback — the board re-reads and the member is told', async () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = armedServer({ apply: () => res(409, { detail: { error: 'version_conflict', base_version: 3, head_version: 4 } }) })
    refreshPreferences.mockResolvedValue({ charts_workspace_layout: CHART_BOARD })
    localStorage.setItem('uct.watchlist.cols', JSON.stringify(COLS))
    renderWS('?openLayout=7')
    await flush()
    expect(applyPosts()).toHaveLength(1)
    expect(boardWrites()).toEqual([])
    expect(refreshPreferences).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    expect(screen.queryByTestId('body-scanner')).toBeNull()
    expect(JSON.parse(localStorage.getItem('uct.watchlist.cols'))).toEqual(COLS)
    expect(screen.getByTestId('workspace-notice').textContent).toContain(
      'Your board changed in another tab or window before this could be applied, so nothing was changed. Try again.')
  })

  test('a failed apply (network) half-applies NOTHING: no per-key write, no board switch, localStorage untouched', async () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = armedServer({ apply: () => { throw new TypeError('network down mid-apply') } })
    localStorage.setItem('uct.watchlist.cols', JSON.stringify(COLS))
    renderWS('?openLayout=7')
    await flush()
    expect(boardWrites()).toEqual([])
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('uct.watchlist.cols'))).toEqual(COLS)
    expect(screen.getByTestId('workspace-notice').textContent).toContain('your board was not changed')
  })

  test('the store went dark mid-session (404): the per-key path, which is correct dark', async () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = vi.fn(async () => res(404, { detail: 'Not Found' }))
    renderWS('?openLayout=7')
    await flush()
    expect(applyPosts()).toEqual([])
    expect(boardWrites().map(([k]) => k)[0]).toBe('charts_workspace_layout')
    expect(boardWrites()).toHaveLength(9)
    expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  })

  test('New Layout is one write too, and the linked symbols come back with it', async () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = armedServer()
    refreshPreferences.mockResolvedValue({})
    renderWS()
    openLayoutsMenu()
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'New Layout' })) })
    await flush()
    const prefs = JSON.parse(applyPosts()[0][1].body).prefs
    expect(prefs.charts_workspace_groups).toBe(JSON.stringify({ A: null, B: null, C: null, D: null }))
    expect(prefs.charts_active_template).toBe('null')
    expect(boardWrites()).toEqual([])
  })

  test('the automatic save waits while a one-write change is in flight (it would move the head under it)', async () => {
    __setWorkspaceDocStampForTests('document; v=3')
    let release
    const gate = new Promise(r => { release = r })
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      if ((init?.method || 'GET') === 'GET' && u === `${WORKSPACE_DOC_URL}?board=charts`) { await gate; return res(200, { version: 3 }) }
      if (u === BOARD_APPLY_URL) return res(200, { version: 4, appended: true, complete: true })
      return res(404, {})
    })
    refreshPreferences.mockResolvedValue({})
    vi.useFakeTimers()
    renderWS('?openLayout=7')
    act(() => { screen.getByTestId('rgl-fire-change').click() })
    act(() => { vi.advanceTimersByTime(600) })
    expect(boardWrites()).toEqual([])
    release()
    await flush()
    expect(applyPosts()).toHaveLength(1)
  })
})

// ── the Watchlist-columns fold ────────────────────────────────────────────────
describe('the Watchlist columns fold into the document — non-destructively', () => {
  const RAW = JSON.stringify(COLS)

  test('ARMED, first load: localStorage columns are copied into the document; localStorage keeps them', () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = vi.fn(async () => res(404, {}))
    localStorage.setItem('uct.watchlist.cols', RAW)
    renderWS()
    expect(setPrefMerged).toHaveBeenCalledTimes(1)
    const [key, updater] = setPrefMerged.mock.calls[0]
    expect(key).toBe('watchlist_columns')
    expect(updater(undefined)).toBe(RAW)
    expect(localStorage.getItem('uct.watchlist.cols')).toBe(RAW)
  })

  test('ARMED, a new device: the document fills an empty localStorage', () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = vi.fn(async () => res(404, {}))
    mockPrefs = { charts_workspace_layout: CHART_BOARD, watchlist_columns: RAW }
    renderWS()
    expect(setPrefMerged).not.toHaveBeenCalled()
    expect(localStorage.getItem('uct.watchlist.cols')).toBe(RAW)
  })

  test('ARMED, both hold columns: the local copy is never overwritten from the document', () => {
    __setWorkspaceDocStampForTests('document; v=3')
    global.fetch = vi.fn(async () => res(404, {}))
    const local = JSON.stringify({ order: ['sym'] })
    mockPrefs = { charts_workspace_layout: CHART_BOARD, watchlist_columns: RAW }
    localStorage.setItem('uct.watchlist.cols', local)
    renderWS()
    expect(localStorage.getItem('uct.watchlist.cols')).toBe(local)
    expect(setPrefMerged.mock.calls[0][1]()).toBe(local)      // the local edit is what gets versioned
  })

  test('DARK: no fold at all — nothing written, nothing read into the document', () => {
    global.fetch = vi.fn(async () => res(404, {}))
    localStorage.setItem('uct.watchlist.cols', RAW)
    renderWS()
    expect(setPrefMerged).not.toHaveBeenCalled()
    expect(localStorage.getItem('uct.watchlist.cols')).toBe(RAW)
  })
})
