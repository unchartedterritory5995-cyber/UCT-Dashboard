// app/src/pages/charts/createIndicatorTopBar.wire.test.jsx
//
// ─── 🔴 THE WIRE-CUT FOR THE TOP BAR'S "CREATE INDICATOR" ───────────────────────────
//
// `createIndicatorEntry.test.js` holds which chart is chosen and `CreateIndicatorTopBarButton.test.jsx` holds
// who sees the button. Both render their subject directly, so both stay green if the button is never mounted
// in the workspace, or is mounted and handed a press that reaches no chart (this repo's own lesson, written at
// the top of `builderDoor.wire.test.jsx`: both halves of a severed wire stay individually correct).
//
// ⭐ SO THIS FILE RENDERS THE PAGE AND PRESSES THE BUTTON. `<ChartsWorkspace/>` with nothing on the path under
// test mocked: `WidgetHost`, `ChartWidget`, `ChartPane`, `StockChart`, `ChartToolbar` and the Create Indicator
// panel are the shipped modules. The assertion is the PANEL'S OWN root (`data-testid="create-indicator"`),
// which nothing in this file writes or mocks. The stubs are the same ones `builderDoor.wire.test.jsx` carries
// (the canvas library, the realtime feeds, the network, the preference store, saved layouts, the viewport
// query, drag and resize), plus the account, which here is a real context because it IS on the path.

import { render, screen, within, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ─── the stubs, every one of them OFF the path under test ───────────────────

// The canvas library. `StockChart.smoke.test.jsx` carries the same double for
// the same reason: jsdom has no canvas and lightweight-charts draws into one.
// ⚠️ PROXIES, NOT LITERALS — the same decision `stockChartWiring.test.jsx`
// records. With REAL bars the component runs far more of itself (pattern
// overlays, callout overlays, range subscriptions) and reaches for another
// time-scale/series method each time; a hand-listed double is a list that goes
// stale and throws "is not a function" from a frame nobody was looking at. Only
// the members whose RETURN VALUE the component reads are spelled out.
vi.mock('lightweight-charts', () => {
  const noop = () => {}
  const withNoops = (base) => new Proxy(base, {
    get: (t, p) => (p in t ? t[p] : noop),
    has: () => true,
  })
  const priceScale = withNoops({ applyOptions: noop, width: () => 0, options: () => ({}) })
  const series = withNoops({
    setData: noop, update: noop, applyOptions: noop, options: () => ({}),
    priceScale: () => priceScale, createPriceLine: () => ({}),
    priceToCoordinate: () => 0, coordinateToPrice: () => 0,
    getPane: () => ({ getHeight: () => 300 }),
    dataByIndex: () => null, data: () => [],
  })
  const timeScale = withNoops({
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null,
    logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  })
  const chart = withNoops({
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    priceScale: () => priceScale, timeScale: () => timeScale, options: () => ({}),
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), paneIndex: () => 0 }],
    takeScreenshot: () => document.createElement('canvas'),
  })
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    BarSeries: 'BarSeries',
    createSeriesMarkers: () => withNoops({ setMarkers: noop }),
    createTextWatermark: () => withNoops({ applyOptions: noop }),
  }
})

// Realtime feeds — EventSource / WebSocket, which jsdom does not have.
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))

// Auth — a deep hook chain (useJ2ChartMarkers → useWatchlistAlerts) needs a
// provider, and `ChartsWorkspace` reads `user.role` for its admin-only chrome.
// ⭐ HERE THE ACCOUNT IS ON THE PATH: both the top bar's button and the chart's own toolbar ask whether this
// member may use Create Indicator (`useCreateIndicatorAccess`), the button through `useAuth()` and the toolbar
// through `useContext(AuthContext)`. So this is a REAL React context, and both read the same member. Which
// release the member holds is the one thing a test changes (`mockCohorts`).
let mockCohorts = []
vi.mock('../../context/AuthContext', async () => {
  const React = await import('react')
  // (the default value of a real context, read with no Provider above it; `cohorts` is read at each render)
  const member = { user: { id: 1, role: 'user' }, plan: 'paid', isPaid: true, loading: false, get cohorts() { return mockCohorts } }
  const AuthContext = React.createContext(member)
  return { useAuth: () => React.useContext(AuthContext), useIsPaid: () => true, AuthContext }
})

// The preference store — this is where the member's SAVED BOARD comes from, so
// the stub seeds one chart widget and nothing else.
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

// Saved named layouts — a network read, and not what this file is about.
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [], isLoading: false, saveLayout: () => {}, deleteLayout: () => {}, refresh: () => {} }),
}))

// Viewport. `ChartsWorkspace` asks for `(max-width: 640px)`; every OTHER query
// in the tree keeps its desktop answer, so flipping this flips exactly the
// branch that chooses `MobileChartsApp`.
let phone = false
vi.mock('../../hooks/useMediaQuery', () => ({
  default: (q) => (String(q).includes('640') ? phone : false),
}))

// react-grid-layout's drag/resize. Children render straight through, which is
// the same double `ChartsWorkspace.test.jsx` uses.
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))

const ChartsWorkspace = (await import('./ChartsWorkspace')).default

/** The committed parity fixture — 200 synthetic daily bars, the same array
 *  `stockChartWiring.test.jsx` draws with. */
const BARS = (await import('../parityBars/ramp200.json')).default.bars

// ─── the member's saved board: one chart widget ─────────────────────────────
const ONE_CHART_BOARD = JSON.stringify({
  widgets: [{ id: 'w-chart', type: 'chart', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: { sym: 'AAPL', tf: 'D' } }],
  cols: 24,
})

beforeEach(() => {
  mockPrefs = { charts_workspace_layout: ONE_CHART_BOARD, charts_workspace_groups: JSON.stringify({ A: 'AAPL' }) }
  phone = false
  // ⛔ THE BARS ARE NOT DECORATION — `StockChart` gates the whole drawing
  // toolbar on `showDrawingTools && bars?.length > 0`, so a member looking at an
  // empty chart has no Indicators button either. Serving the committed parity
  // fixture is what makes this a test of a MEMBER'S chart rather than of a
  // skeleton. Every other request answers `{}`.
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url || '')
    const body = u.includes('/api/bars/') ? { bars: BARS } : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const MEMBER_MAY = ['create-indicator']
const topBar = () => document.querySelector('header')
const door = () => within(topBar()).queryByRole('button', { name: 'Create indicator' })

describe('/charts: the top bar has a door to Create Indicator', () => {
  it('a member who may use it presses "Create indicator" in the top bar and the builder opens on the chart', async () => {
    mockCohorts = MEMBER_MAY
    const user = userEvent.setup()
    render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
    // the chart is up and has registered (its own settings gear is on screen)
    await screen.findByTitle('Chart settings', {}, { timeout: 15000 })
    expect(screen.queryByTestId('create-indicator')).toBeNull()             // nothing is open before the press

    const button = door()
    expect(button, 'the top bar holds no "Create indicator" button').not.toBeNull()
    await user.click(button)

    // 🔴 THE ASSERTION: the Create Indicator panel's OWN root, with its own request box, focused and ready
    const panel = await screen.findByTestId('create-indicator', {}, { timeout: 20000 })
    expect(panel).toBeInTheDocument()
    const box = await within(panel).findByTestId('create-indicator-input', {}, { timeout: 8000 })
    expect(box).toBeInTheDocument()
    // ONE press, ONE panel: a second press does not open a second one
    await user.click(door())
    expect(screen.getAllByTestId('create-indicator')).toHaveLength(1)
  }, 60000)

  it('with two charts it opens on the one the member last CLICKED, even after the pointer crossed the other', async () => {
    mockCohorts = MEMBER_MAY
    mockPrefs = {
      charts_workspace_layout: JSON.stringify({
        widgets: [
          { id: 'w-left', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 20, opts: { sym: 'AAPL', tf: 'D' } },
          { id: 'w-right', type: 'chart', color: 'B', x: 12, y: 0, w: 12, h: 20, opts: { sym: 'MSFT', tf: 'D' } },
        ],
        cols: 24,
      }),
      charts_workspace_groups: JSON.stringify({ A: 'AAPL', B: 'MSFT' }),
    }
    const user = userEvent.setup()
    render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
    await screen.findAllByTitle('Chart settings', {}, { timeout: 15000 }).then((gears) => expect(gears.length).toBe(2))
    const cell = (id) => document.querySelector(`[data-widget-id="${id}"]`)
    expect(cell('w-left')).not.toBeNull()
    expect(cell('w-right')).not.toBeNull()

    // the member works on the RIGHT chart (a press anywhere in its cell), then moves the pointer over the left one
    // on the way to the top bar: the left chart is now the last one hovered
    fireEvent.pointerDown(cell('w-right'))
    const leftGear = cell('w-left').querySelector('[title="Chart settings"]')
    fireEvent.pointerEnter(leftGear)
    fireEvent.pointerOver(leftGear)
    fireEvent.focusIn(leftGear)

    await user.click(door())
    const panel = await screen.findByTestId('create-indicator', {}, { timeout: 20000 })
    expect(cell('w-right').contains(panel), 'the builder opened on a chart the member was not working on').toBe(true)
    expect(cell('w-left').contains(panel)).toBe(false)
  }, 60000)

  it('with two charts and none clicked or hovered, it opens on the first in reading order', async () => {
    mockCohorts = MEMBER_MAY
    mockPrefs = {
      charts_workspace_layout: JSON.stringify({
        widgets: [
          // (saved in the opposite order: the answer follows the board's positions, never the saved or mount order)
          { id: 'w-right', type: 'chart', color: 'B', x: 12, y: 0, w: 12, h: 20, opts: { sym: 'MSFT', tf: 'D' } },
          { id: 'w-left', type: 'chart', color: 'A', x: 0, y: 0, w: 12, h: 20, opts: { sym: 'AAPL', tf: 'D' } },
        ],
        cols: 24,
      }),
      charts_workspace_groups: JSON.stringify({ A: 'AAPL', B: 'MSFT' }),
    }
    render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
    await screen.findAllByTitle('Chart settings', {}, { timeout: 15000 }).then((gears) => expect(gears.length).toBe(2))
    fireEvent.click(door())                                                 // (no pointer travel: nothing is hovered on the way)
    const panel = await screen.findByTestId('create-indicator', {}, { timeout: 20000 })
    expect(document.querySelector('[data-widget-id="w-left"]').contains(panel)).toBe(true)
  }, 60000)

  it('a board with no chart says so in one sentence and opens nothing', async () => {
    mockCohorts = MEMBER_MAY
    mockPrefs = {
      charts_workspace_layout: JSON.stringify({ widgets: [{ id: 'w-other', type: 'not-a-chart-widget', color: 'A', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24 }),
      charts_workspace_groups: JSON.stringify({ A: 'AAPL' }),
    }
    render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
    const button = await within(await screen.findByRole('banner', {}, { timeout: 15000 }).catch(() => topBar())).findByRole('button', { name: 'Create indicator' })
    expect(screen.queryByTitle('Chart settings')).toBeNull()                // (this board really has no chart)
    fireEvent.click(button)
    expect(await screen.findByText('Add a chart to this board first. Create indicator builds on a chart.')).toBeInTheDocument()
    expect(screen.queryByTestId('create-indicator')).toBeNull()
  }, 60000)

  it('it stands in the top bar itself, after Tools, and is not one of the menu buttons', async () => {
    mockCohorts = MEMBER_MAY
    render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
    await screen.findByTitle('Chart settings', {}, { timeout: 15000 })
    const button = door()
    expect(button.parentElement).toBe(topBar())                             // a direct child: the top bar's menu finder skips it
    expect(button.getAttribute('aria-haspopup')).toBeNull()
    const tools = within(topBar()).getByRole('button', { name: /^Tools/ })
    const addWidget = [...topBar().querySelectorAll('button')].find((b) => b.getAttribute('data-guide') === 'workspace.widgets')
    const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(after(addWidget, tools)).toBe(true)
    expect(after(tools, button)).toBe(true)                                 // Add widget, Tools, Create indicator
  }, 60000)

  it('CONTROL: a member who may not use Create Indicator has no such button, and the rest of the top bar is there', async () => {
    mockCohorts = []
    render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
    await screen.findByTitle('Chart settings', {}, { timeout: 15000 })
    expect(door()).toBeNull()
    expect(within(topBar()).getByRole('button', { name: /^Tools/ })).toBeInTheDocument()
  }, 60000)
})
