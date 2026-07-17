import { render, screen, act } from '@testing-library/react'
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
let mockLayouts = { global: [], mine: [], isLoading: false }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: mockLayouts.global,
    mine: mockLayouts.mine,
    isLoading: mockLayouts.isLoading,
    saveLayout: async () => ({}),
    deleteLayout: async () => {},
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
  mockLayouts = { global: [], mine: [], isLoading: false }
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

test('first visit (no saved layout) applies the classic starter arrangement once prefs + templates settle', () => {
  renderWS()
  // No "chart" template exists → falls back to STARTER_LAYOUT: watchlist + chart + themes.
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-themes')).toBeInTheDocument()
  expect(screen.queryByTestId('body-scanner')).not.toBeInTheDocument()
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

test('Open-layout dropdown contains the Multi Chart flyout row', () => {
  renderWS()
  act(() => { screen.getByRole('button', { name: /open layout/i }).click() })
  const row = screen.getByRole('button', { name: /Multi Chart/ })
  expect(row).toBeInTheDocument()
  // The flyout (MultiChartMenu) opens from the row.
  expect(screen.queryByTestId('multichart-menu')).not.toBeInTheDocument()
  act(() => { row.click() })
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
  // The Open-layout dropdown (host of the Multi Chart flyout) stays available.
  expect(screen.getByRole('button', { name: /open layout/i })).toBeInTheDocument()
})
