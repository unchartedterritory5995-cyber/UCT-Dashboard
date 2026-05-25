import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Mock widget components so we don't bring in real widget internals.
vi.mock('./widgets/ChartWidget', () => ({ default: () => <div data-testid="body-chart">CHART</div> }))
vi.mock('./widgets/WatchlistWidget', () => ({ default: () => <div data-testid="body-watchlist">WATCHLIST</div> }))
vi.mock('./widgets/ThemesWidget', () => ({ default: () => <div data-testid="body-themes">THEMES</div> }))
vi.mock('./widgets/ScannerWidget', () => ({ default: () => <div data-testid="body-scanner">SCANNER</div> }))
vi.mock('./widgets/MobileChartFallback', () => ({ default: () => <div data-testid="mobile-fallback">MOBILE</div> }))

// Mock react-grid-layout — render children directly so we can assert
// what's in the DOM. The library's drag/resize behavior is its own
// concern; integration is verified in T15 manual smoke.
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
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('seeds 3 default widgets on first visit (no saved layout)', () => {
  renderWS()
  // Default layout: Watchlist + Chart + Themes
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-themes')).toBeInTheDocument()
  expect(screen.queryByTestId('body-scanner')).not.toBeInTheDocument()
})

test('restores saved layout from preferences', () => {
  mockPrefs = {
    charts_workspace_layout: JSON.stringify({
      widgets: [
        { id: 's1', type: 'scanner', color: 'C', x: 0, y: 0, w: 6, h: 6, opts: {} },
      ],
      cols: 12,
      rowHeight: 40,
    }),
  }
  renderWS()
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  expect(screen.queryByTestId('body-chart')).not.toBeInTheDocument()
})

test('renders MobileChartFallback when useMediaQuery indicates mobile', () => {
  mqMatches = true
  renderWS()
  expect(screen.getByTestId('mobile-fallback')).toBeInTheDocument()
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

test('+ Add Widget toolbar button is present', () => {
  renderWS()
  expect(screen.getByRole('button', { name: /\+ add widget/i })).toBeInTheDocument()
})

test('Reset layout button is present', () => {
  renderWS()
  expect(screen.getByRole('button', { name: /reset layout/i })).toBeInTheDocument()
})

test('corrupted preferences blob falls back to default layout', () => {
  mockPrefs = { charts_workspace_layout: '{not valid json' }
  renderWS()
  // Default layout still loads
  expect(screen.getByTestId('body-chart')).toBeInTheDocument()
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()
})
