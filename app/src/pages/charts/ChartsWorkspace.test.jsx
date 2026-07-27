import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock the widget host + heavy children so we don't bring in real widget
// internals. WidgetHost surfaces the widget type so tests can assert which
// widgets are on the board.
vi.mock('./WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`body-${widget.type}`}>{widget.type}</div>,
}))
vi.mock('./widgets/MobileWorkspace', () => ({ default: () => <div data-testid="mobile-workspace">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))

// Mock react-grid-layout — render children directly so we can assert
// what's in the DOM. The library's drag/resize behavior is its own
// concern; integration is verified in manual smoke.
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, onLayoutChange }) => (
    <div data-testid="rgl-responsive">
      <button data-testid="rgl-fire-change" onClick={() => onLayoutChange && onLayoutChange([{ i: 'fake', x: 0, y: 0, w: 6, h: 6 }])}>fire</button>
      {children}
    </div>
  ),
  WidthProvider: (C) => C,
}))

// Mock usePreferences — control returned prefs, capture setPref calls.
// (useMultiChartState consumes the same mock, so seeding `multichart_state`
// here drives the grid mode through the REAL hook.)
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  // Named export used by ChartsWorkspace to read chart_settings when saving a
  // template — mirror the real parse-defensively implementation.
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

// Mock useMediaQuery — default desktop (false); individual tests override.
let mqMatches = false
vi.mock('../../hooks/useMediaQuery', () => ({
  default: () => mqMatches,
}))

// Mock useAuth — ChartsWorkspace reads user.role for the admin-only bits.
let mockUser = { id: 1, role: 'user' }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// Mock useChartLayouts — named layout templates (prebuilt + personal). The
// "default template applies on first visit" behavior gates on isLoading.
let mockLayouts = { global: [], mine: [], isLoading: false, saveLayout: vi.fn(async () => ({})), deleteLayout: vi.fn(async () => {}) }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: mockLayouts.global,
    mine: mockLayouts.mine,
    isLoading: mockLayouts.isLoading,
    saveLayout: (...args) => mockLayouts.saveLayout(...args),
    deleteLayout: (...args) => mockLayouts.deleteLayout(...args),
    refresh: () => {},
  }),
}))

import ChartsWorkspace from './ChartsWorkspace'

function renderWS() {
  return render(
    <MemoryRouter>
      <ChartsWorkspace />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setPref.mockReset()
  mockPrefs = {}
  mqMatches = false
  mockUser = { id: 1, role: 'user' }
  mockLayouts = { global: [], mine: [], isLoading: false, saveLayout: vi.fn(async () => ({})), deleteLayout: vi.fn(async () => {}) }
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('renders the workspace header buttons', () => {
  renderWS()
  expect(screen.getByRole('button', { name: /\+ add widget/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /new layout/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /open layout/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /save layout/i })).toBeInTheDocument()
})

test('first visit (no saved layout) applies the frozen UCT Default arrangement once prefs + templates settle', () => {
  renderWS()
  // No "chart" template exists → falls back to UCT_DEFAULT_LAYOUT: themes + chart +
  // fundamentals + watchlist + aisearch (no scanner).
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-themes')).toBeInTheDocument()
  expect(screen.getByTestId('body-fundamentals')).toBeInTheDocument()
  expect(screen.getByTestId('body-aisearch')).toBeInTheDocument()
  expect(screen.queryByTestId('body-scanner')).not.toBeInTheDocument()
})

test('clicking "UCT Default" applies the frozen layout AND writes the frozen chart settings', () => {
  // Start from a corrupted/empty board, then open the locked default.
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  act(() => { screen.getByRole('button', { name: /open layout/i }).click() })
  act(() => { screen.getByRole('button', { name: /^UCT Default$/ }).click() })
  // Frozen arrangement is on the board.
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-fundamentals')).toBeInTheDocument()
  // The frozen chart_settings blob is persisted (header titleMode 'both').
  const chartSettingsSave = setPref.mock.calls.find(
    ([k, v]) => k === 'chart_settings' && typeof v === 'string' && v.includes('"titleMode":"both"'),
  )
  expect(chartSettingsSave).toBeTruthy()
})

test('Save-as-template captures the current chart settings into the saved template', () => {
  const cs = { chartType: 'candles', header: { titleMode: 'both' }, theme: 'dark' }
  mockPrefs = { chart_settings: JSON.stringify(cs) }
  renderWS()
  fireEvent.click(screen.getByRole('button', { name: /save layout/i }))
  fireEvent.change(screen.getByPlaceholderText(/template name/i), { target: { value: 'My Setup' } })
  fireEvent.click(screen.getByRole('button', { name: /^Save template$/ }))
  expect(mockLayouts.saveLayout).toHaveBeenCalledTimes(1)
  const payload = mockLayouts.saveLayout.mock.calls[0][0]
  expect(payload.name).toBe('My Setup')
  expect(payload.layout.chartSettings).toEqual(cs)  // chart settings snapshotted in
  expect(payload.groups).toBeNull()                 // tickers never baked in
})

test('opening a My-layouts template restores its saved chart settings (not leaked into the layout blob)', () => {
  const cs = { chartType: 'bars', header: { titleMode: 'company' }, theme: 'dark' }
  mockLayouts.mine = [{
    id: 42,
    name: 'My Setup',
    layout: {
      widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }],
      cols: 24,
      chartSettings: cs,
    },
  }]
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  act(() => { screen.getByRole('button', { name: /open layout/i }).click() })
  act(() => { screen.getByRole('button', { name: /^My Setup$/ }).click() })
  // Arrangement applied.
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  // Saved chart settings restored.
  const csCall = setPref.mock.calls.find(([k]) => k === 'chart_settings')
  expect(csCall).toBeTruthy()
  expect(csCall[1]).toEqual(cs)
  // chartSettings must NOT leak into the workspace-layout arrangement blob.
  const layoutCall = [...setPref.mock.calls].reverse().find(([k]) => k === 'charts_workspace_layout')
  expect(JSON.parse(layoutCall[1])).not.toHaveProperty('chartSettings')
})

test('Save current arrangement updates the open custom template in place (arrangement + chart settings)', async () => {
  const tpl = {
    id: 42, name: 'My Setup', scope: 'user',
    layout: { widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }], cols: 24 },
  }
  mockLayouts.mine = [tpl]
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }),
    chart_settings: JSON.stringify({ chartType: 'bars' }),
    charts_active_template: JSON.stringify({ id: 42, name: 'My Setup', scope: 'user' }),
  }
  renderWS()
  act(() => { screen.getByRole('button', { name: /save layout/i }).click() })
  await act(async () => { screen.getByRole('button', { name: /save current arrangement/i }).click() })
  expect(mockLayouts.saveLayout).toHaveBeenCalledTimes(1)
  const payload = mockLayouts.saveLayout.mock.calls[0][0]
  expect(payload.name).toBe('My Setup')
  expect(payload.scope).toBe('user')
  expect(payload.layout.chartSettings).toEqual({ chartType: 'bars' })
})

test('Save current arrangement does NOT touch any template when none is active', () => {
  mockLayouts.mine = [{ id: 42, name: 'My Setup', scope: 'user', layout: { widgets: [], cols: 24 } }]
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }),
    charts_active_template: 'null',
  }
  renderWS()
  act(() => { screen.getByRole('button', { name: /save layout/i }).click() })
  act(() => { screen.getByRole('button', { name: /save current arrangement/i }).click() })
  expect(mockLayouts.saveLayout).not.toHaveBeenCalled()
})

test('deleting a layout asks to confirm; Go back cancels without deleting', () => {
  mockLayouts.mine = [{ id: 42, name: 'My Setup', scope: 'user', layout: { widgets: [], cols: 24 } }]
  renderWS()
  act(() => { screen.getByRole('button', { name: /open layout/i }).click() })
  act(() => { screen.getByRole('button', { name: '✕' }).click() })
  expect(screen.getByText('Delete?')).toBeInTheDocument()
  act(() => { screen.getByRole('button', { name: /go back/i }).click() })
  expect(screen.queryByText('Delete?')).not.toBeInTheDocument()
  expect(mockLayouts.deleteLayout).not.toHaveBeenCalled()
})

test('confirming delete of the OPEN layout deletes it and falls back to UCT Default', async () => {
  mockLayouts.mine = [{
    id: 42, name: 'My Setup', scope: 'user',
    layout: { widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }], cols: 24 },
  }]
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({ widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }], cols: 24 }),
    charts_active_template: JSON.stringify({ id: 42, name: 'My Setup', scope: 'user' }),
  }
  renderWS()
  act(() => { screen.getByRole('button', { name: /open layout/i }).click() })
  act(() => { screen.getByRole('button', { name: '✕' }).click() })
  await act(async () => { screen.getByRole('button', { name: /^Yes$/ }).click() })
  expect(mockLayouts.deleteLayout).toHaveBeenCalledWith(42)
  // Fell back to UCT Default: frozen layout persisted + active template cleared.
  const layoutCall = [...setPref.mock.calls].reverse().find(([k]) => k === 'charts_workspace_layout')
  expect(JSON.parse(layoutCall[1]).widgets.some(w => w.type === 'chart')).toBe(true)
  const activeCall = [...setPref.mock.calls].reverse().find(([k]) => k === 'charts_active_template')
  expect(activeCall[1]).toBe('null')
})

test('first visit prefers a prebuilt template named "chart" over the starter fallback', () => {
  mockLayouts.global = [{
    id: 7,
    name: 'Chart',
    layout: {
      widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }],
      cols: 24,
    },
  }]
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
})

test('board stays empty while the layout templates are still loading', () => {
  mockLayouts.isLoading = true
  renderWS()
  // The default-template effect must not run before templates settle.
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
  expect(screen.queryByTestId('body-watchlist')).not.toBeInTheDocument()
  expect(screen.queryByTestId('body-themes')).not.toBeInTheDocument()
})

test('restores saved workspace layout from preferences', () => {
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({
      widgets: [
        { id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 6, h: 6, opts: {} },
      ],
      cols: 12, // legacy 12-col save — parseLayout migrates it to the 24-col grid
      rowHeight: 40,
    }),
  }
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
})

test('corrupted preferences blob falls back safely to the default (starter) layout', () => {
  mockPrefs = { charts_workspace_layout: '{not valid json' }
  renderWS()
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
})

test('renders MobileWorkspace (tabbed widget stack) when useMediaQuery indicates mobile', () => {
  mqMatches = true
  renderWS()
  expect(screen.getByTestId('mobile-workspace')).toBeInTheDocument()
  expect(screen.queryByTestId('rgl-responsive')).not.toBeInTheDocument()
})

test('debounced save fires setPref after layout change', () => {
  renderWS()
  act(() => { screen.getByTestId('rgl-fire-change').click() })
  // Debounce is 500ms — advance fake timers; setTimeout callback runs
  // synchronously inside act(), so setPref is already called when we assert.
  act(() => { vi.advanceTimersByTime(600) })
  expect(setPref).toHaveBeenCalledWith(
    'charts_workspace_layout',
    expect.stringContaining('widgets'),
  )
})

test('New Layout wipes the board to empty and persists the blank state', () => {
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({
      widgets: [{ id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 8, h: 10, opts: {} }],
      cols: 24,
    }),
  }
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  act(() => { screen.getByRole('button', { name: /new layout/i }).click() })
  expect(screen.queryByTestId('body-scanner')).not.toBeInTheDocument()
  expect(setPref).toHaveBeenCalledWith(
    'charts_workspace_layout',
    expect.stringContaining('"widgets":[]'),
  )
  // Color groups reset too.
  expect(setPref).toHaveBeenCalledWith(
    'charts_workspace_groups',
    JSON.stringify({ A: null, B: null, C: null, D: null }),
  )
})

test('Multi Chart is a top-level toolbar dropdown that opens the MultiChartMenu', () => {
  renderWS()
  // Multi Chart moved OUT of the Open-layout menu into its own header button.
  const btn = screen.getByRole('button', { name: /Multi Chart/ })
  expect(btn).toBeInTheDocument()
  expect(screen.queryByTestId('multichart-menu')).not.toBeInTheDocument()
  act(() => { btn.click() })
  expect(screen.getByTestId('multichart-menu')).toBeInTheDocument()
})

test('grid mode renders MultiChartGrid when multichart_state has mode:"grid"', () => {
  mockPrefs = { multichart_state: JSON.stringify({ mode: 'grid' }) }
  renderWS()
  expect(screen.getByTestId('multichart-grid')).toBeInTheDocument()
  expect(screen.queryByTestId('rgl-responsive')).not.toBeInTheDocument()
  // Workspace-only toolbar buttons hide in grid mode; a Workspace exit shows.
  expect(screen.queryByRole('button', { name: /\+ add widget/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /save layout/i })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Workspace' })).toBeInTheDocument()
  // Open layout + Multi Chart stay available in grid mode (both are the entry
  // points that persist across modes).
  expect(screen.getByRole('button', { name: /open layout/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Multi Chart/ })).toBeInTheDocument()
})

// ── Pop-out ────────────────────────────────────────────────────────────────
// Widgets and whole boards open in their own OS windows so they can be dragged
// onto other monitors. They're portals owned by this tab, so the assertions
// below check the popped DOM in a SEPARATE document from the main board's.

/** Stand-in for the window `window.open` returns. */
function makeFakeWindow() {
  const doc = document.implementation.createHTMLDocument('popup')
  const listeners = {}
  return {
    document: doc,
    closed: false,
    KeyboardEvent: window.KeyboardEvent,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn) },
    close: vi.fn(function () { this.closed = true }),
    _fire: (t) => (listeners[t] || []).forEach(fn => fn()),
  }
}

function popped(fake, type) {
  return fake.document.querySelector(`[data-testid="body-${type}"]`)
}

test('popping out the layout empties the main board and moves the widgets into the window', () => {
  const fake = makeFakeWindow()
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
  try {
    renderWS()
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()

    act(() => { screen.getByRole('button', { name: /pop out layout/i }).click() })

    // Main goes back to a blank board, ready for the next layout.
    expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('body-watchlist')).not.toBeInTheDocument()
    // ...and the whole board is now living in the popped window.
    expect(popped(fake, 'chart')).toBeTruthy()
    expect(popped(fake, 'watchlist')).toBeTruthy()
    expect(popped(fake, 'themes')).toBeTruthy()
  } finally { openSpy.mockRestore() }
})

test('closing a popped-out layout docks its widgets back into the main board', () => {
  const fake = makeFakeWindow()
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
  try {
    renderWS()
    act(() => { screen.getByRole('button', { name: /pop out layout/i }).click() })
    expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()

    act(() => { fake._fire('beforeunload') })

    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  } finally { openSpy.mockRestore() }
})

test('a blocked popup leaves the board intact instead of losing the layout', () => {
  // window.open returns null when blocked. Without the dock-on-blocked path the
  // widgets would have been cleared off main with nowhere to have gone.
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
  try {
    renderWS()
    act(() => { screen.getByRole('button', { name: /pop out layout/i }).click() })

    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/blocked/i)
  } finally { openSpy.mockRestore() }
})

test('pop out layout is disabled while the board is empty', () => {
  mockPrefs = { charts_workspace_layout: JSON.stringify({ widgets: [], cols: 24 }) }
  renderWS()
  expect(screen.getByRole('button', { name: /pop out layout/i })).toBeDisabled()
})

test('a popped-out layout is not disturbed by opening a different layout on the main tab', () => {
  const fake = makeFakeWindow()
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
  try {
    renderWS()
    act(() => { screen.getByRole('button', { name: /pop out layout/i }).click() })
    expect(popped(fake, 'chart')).toBeTruthy()

    // Load a fresh layout into the now-blank main tab.
    act(() => { screen.getByRole('button', { name: /open layout/i }).click() })
    act(() => { screen.getByRole('button', { name: /^UCT Default$/ }).click() })

    // Main has its own board again...
    expect(screen.getByTestId('body-chart')).toBeInTheDocument()
    // ...and the board on the other monitor still stands.
    expect(popped(fake, 'chart')).toBeTruthy()
    expect(popped(fake, 'watchlist')).toBeTruthy()
  } finally { openSpy.mockRestore() }
})
