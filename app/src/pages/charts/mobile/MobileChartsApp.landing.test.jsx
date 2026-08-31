/* CHARTS-BINDS-THE-CHART — the hydration-ordering rail, ported forward.
 *
 * The tab-strip era's `MobileWorkspace` once seeded its landing tab with a
 * `useState` INITIALIZER, which ran before `usePreferences` resolved
 * `charts_workspace_layout` — so /charts opened on whatever widget happened to
 * sit first (measured 2026-08-09: Themes). The fix was DERIVE, THEN DEFAULT:
 * recompute from `widgets` every render.
 *
 * `MobileChartsApp` (the chart-first phone shell) inherits that obligation: it
 * binds the FIRST chart widget of the saved layout, and `widgets` still arrives
 * EMPTY on first render. Every test below renders EMPTY FIRST and then
 * hydrates — the cold order — plus a warm control, exactly like the original
 * rail. The sheets (timeframe, more/widgets, symbol search) are exercised
 * through the same cold-hydrated board.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { forwardRef } from 'react'
import MobileChartsApp, { chartWidgetIndex } from './MobileChartsApp'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'

// The chart engine. The shell composes ChartPane directly; the props it passes
// (sym / tf / chartId / density / showTfBar) ARE the binding under test, so the
// mock surfaces them as data- attributes.
vi.mock('../../../components/chart/pane/ChartPane', () => ({
  default: forwardRef(function ChartPaneMock({ sym, tf, chartId, density, showTfBar, stockChartProps }, ref) {
    void ref
    return (
      <div
        data-testid="chart-pane"
        data-sym={sym}
        data-tf={tf}
        data-chartid={chartId}
        data-density={density}
        data-showtfbar={String(showTfBar)}
        data-golive={String(!!stockChartProps?.showGoLive)}
        data-cleancanvas={String(
          stockChartProps?.verticalLegend === false
          && stockChartProps?.alwaysShowLegend === false
          && stockChartProps?.showRangeSelector === false,
        )}
      />
    )
  }),
}))

// Widget pages render through the real WidgetHost in production; here the body
// is what identifies which widget a full-screen page opened.
vi.mock('../WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`widget-body-${widget.type}`}>{widget.type}</div>,
}))

// Network-backed hooks off the path under test.
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useBreadthSymbols', () => ({ default: () => new Map() }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
const createAlert = vi.fn(() => Promise.resolve({}))
const deleteAlert = vi.fn(() => Promise.resolve({}))
let mockActiveAlerts = []
vi.mock('../../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert, deleteAlert, getAlertsForSym: () => mockActiveAlerts }),
}))

// The shape ChartsWorkspace hands down once prefs resolve — Themes FIRST, the
// arrangement that produced the original measured defect.
const HYDRATED = [
  { id: 'w-themes', type: 'themes', color: 'B', opts: {} },
  { id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D' } },
  { id: 'w-watch', type: 'watchlist', color: 'A', opts: {} },
]

function makeHandlers() {
  return {
    onRemove: vi.fn(),
    onColorChange: vi.fn(),
    onOptsChange: vi.fn(),
    onAddWidget: vi.fn(),
  }
}

function renderApp(widgets, handlers = makeHandlers(), ctx = {}, extraProps = {}) {
  const value = {
    ...WORKSPACE_FALLBACK,
    groupSyms: { A: 'NVDA', B: null, C: null, D: null },
    setGroupSym: vi.fn(),
    ...ctx,
  }
  const ui = (w, syms) => (
    <WorkspaceContext.Provider value={syms ? { ...value, groupSyms: { ...value.groupSyms, ...syms } } : value}>
      <MobileChartsApp widgets={w} {...handlers} {...extraProps} />
    </WorkspaceContext.Provider>
  )
  const utils = render(ui(widgets))
  // rerenderWith(widgets, symsPatch?) — symsPatch simulates a color-group
  // publish (a watchlist row tap, a voice retarget) landing from the provider.
  return { ...utils, rerenderWith: (w, syms) => utils.rerender(ui(w, syms)), handlers, value }
}

beforeEach(() => {
  localStorage.clear()
  mockActiveAlerts = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('chartWidgetIndex — the binding rule, stated once', () => {
  test('picks the first chart wherever it sits', () => {
    expect(chartWidgetIndex(HYDRATED)).toBe(HYDRATED.findIndex((w) => w.type === 'chart'))
  })
  test('-1 when the layout has no chart', () => {
    expect(chartWidgetIndex([{ id: 'a', type: 'themes' }])).toBe(-1)
  })
  test('survives an empty or absent list', () => {
    expect(chartWidgetIndex([])).toBe(-1)
    expect(chartWidgetIndex(undefined)).toBe(-1)
  })
})

describe('COLD prefs — widgets arrive AFTER the first render', () => {
  test('binds the chart widget once it lands, not whatever is first', () => {
    const { rerenderWith } = renderApp([])
    // CONTROL: the pre-hydration render genuinely has no chart to bind.
    expect(screen.queryByTestId('chart-pane')).toBeNull()

    rerenderWith(HYDRATED)
    const pane = screen.getByTestId('chart-pane')
    expect(pane).toHaveAttribute('data-sym', 'NVDA')       // group A, the chart's color
    expect(pane).toHaveAttribute('data-tf', 'D')           // the chart WIDGET's tf
    expect(pane).toHaveAttribute('data-chartid', 'w-chart') // alert scoping = widget id
    // The pane renders chrome-less — the shell owns the phone chrome.
    expect(pane).toHaveAttribute('data-density', 'mini')
    expect(pane).toHaveAttribute('data-showtfbar', 'false')
    // No widget page is open — the chart IS the landing screen.
    expect(screen.queryByTestId('widget-body-themes')).toBeNull()
  })

  test('a layout WITHOUT a chart offers the one-tap restore instead of a blank screen', async () => {
    const user = userEvent.setup()
    const { rerenderWith, handlers } = renderApp([])
    rerenderWith([HYDRATED[0], HYDRATED[2]]) // themes + watchlist, no chart
    expect(screen.queryByTestId('chart-pane')).toBeNull()
    await user.click(screen.getByRole('button', { name: /open a chart/i }))
    expect(handlers.onAddWidget).toHaveBeenCalledWith('chart')
  })
})

describe('the thumb toolbar drives the chart widget through the SAME persistence desktop uses', () => {
  test('timeframe sheet: picking 1h writes tf "60" onto the chart widget', async () => {
    const user = userEvent.setup()
    const { rerenderWith, handlers } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /timeframe/i }))
    await user.click(await screen.findByRole('option', { name: '1h' }))
    expect(handlers.onOptsChange).toHaveBeenCalledWith('w-chart', { tf: '60' })
  })

  test('more sheet: the layout’s other widgets open as full-screen pages over the chart, and back returns', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: /^open theme tracker/i }))

    // The page is OVER the chart — the chart stays mounted (returning is free).
    expect(screen.getByTestId('widget-body-themes')).toBeInTheDocument()
    expect(screen.getByTestId('chart-pane')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chart$/i }))
    expect(screen.queryByTestId('widget-body-themes')).toBeNull()
  })

  test('symbol sheet: tapping the strip opens search; picking a row routes through the color group', async () => {
    const user = userEvent.setup()
    const { rerenderWith, value } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /change symbol/i }))
    // Popular rows render immediately (no network needed on an empty query).
    await user.click(await screen.findByRole('button', { name: /SPDR S&P 500/i }))
    expect(value.setGroupSym).toHaveBeenCalledWith('A', 'SPY')
    // Committed picks land in the recents rail for next time.
    expect(JSON.parse(localStorage.getItem('uct.charts.mobileRecents'))).toContain('SPY')
  })
})

describe('the ★ watchlist button — the scan→tap→chart loop, one tap away', () => {
  test('opens the layout’s watchlist widget as a full-screen page', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: 'Watchlist' }))
    expect(screen.getByTestId('widget-body-watchlist')).toBeInTheDocument()
    // The chart stays mounted beneath — back is free.
    expect(screen.getByTestId('chart-pane')).toBeInTheDocument()
  })

  test('with no watchlist widget saved: adds one and opens it the moment it hydrates', async () => {
    const user = userEvent.setup()
    const noWatch = [HYDRATED[0], HYDRATED[1]] // themes + chart only
    const { rerenderWith, handlers } = renderApp([])
    rerenderWith(noWatch)

    await user.click(screen.getByRole('button', { name: 'Watchlist' }))
    expect(handlers.onAddWidget).toHaveBeenCalledWith('watchlist')
    expect(screen.queryByTestId('widget-body-watchlist')).toBeNull()

    // The layout save round-trips and the new widget lands.
    rerenderWith([...noWatch, { id: 'w-new-watch', type: 'watchlist', color: 'A', opts: {} }])
    expect(screen.getByTestId('widget-body-watchlist')).toBeInTheDocument()
  })
})

describe('the tap-to-chart loop — a page that retargets the chart hands you back to it', () => {
  test('watchlist row tap (group A publish) closes the page and the chart shows the pick', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: 'Watchlist' }))
    expect(screen.getByTestId('widget-body-watchlist')).toBeInTheDocument()

    // The watchlist widget shares the chart's group (A): a row tap publishes a
    // new symbol there. Simulated as the provider value updating.
    rerenderWith(HYDRATED, { A: 'AAPL' })
    expect(screen.queryByTestId('widget-body-watchlist')).toBeNull()
    expect(screen.getByTestId('chart-pane')).toHaveAttribute('data-sym', 'AAPL')
  })

  test('a page on a DIFFERENT color group stays open — it cannot have moved the chart', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)

    // Themes is on group B (see HYDRATED); open it via the More sheet.
    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: /^open theme tracker/i }))
    expect(screen.getByTestId('widget-body-themes')).toBeInTheDocument()

    // Its group publishes — the CHART's group (A) is untouched, so no bounce.
    rerenderWith(HYDRATED, { B: 'XLE' })
    expect(screen.getByTestId('widget-body-themes')).toBeInTheDocument()
  })

  test('the page header’s trash removes the widget from the layout and returns to the chart', async () => {
    const user = userEvent.setup()
    const { rerenderWith, handlers } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: 'Watchlist' }))
    await user.click(screen.getByRole('button', { name: /remove watchlist from layout/i }))
    expect(handlers.onRemove).toHaveBeenCalledWith('w-watch')
    expect(screen.queryByTestId('widget-body-watchlist')).toBeNull()
  })
})

describe('price alert from the chart', () => {
  test('More → Set price alert → typed price + "Alert above" reaches createAlert', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: /set price alert/i }))

    const input = await screen.findByRole('textbox', { name: /alert price/i })
    await user.type(input, '250.50')
    await user.click(screen.getByRole('button', { name: /alert above/i }))
    expect(createAlert).toHaveBeenCalledWith('NVDA', 250.5, 'above')
  })

  test('an unparseable price cannot fire — both commit buttons stay disabled', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)
    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: /set price alert/i }))
    expect(screen.getByRole('button', { name: /alert above/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /alert below/i })).toBeDisabled()
  })
})

describe('TABLET (two-pane): the page docks beside the chart instead of covering it', () => {
  test('cold-hydrating a layout with a watchlist auto-docks it as the companion panel', () => {
    const { rerenderWith } = renderApp([], makeHandlers(), {}, { tablet: true })
    rerenderWith(HYDRATED)

    // Both panes at once — and the phone chrome is absent: no back button,
    // a Close ✕ instead.
    expect(screen.getByTestId('mobile-charts-app')).toHaveAttribute('data-shell-mode', 'tablet')
    expect(screen.getByTestId('chart-pane')).toBeInTheDocument()
    expect(screen.getByTestId('widget-body-watchlist')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^chart$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /close panel/i })).toBeInTheDocument()
  })

  test('a same-group publish retargets the chart BESIDE the panel — no phone bounce', () => {
    const { rerenderWith } = renderApp([], makeHandlers(), {}, { tablet: true })
    rerenderWith(HYDRATED)
    expect(screen.getByTestId('widget-body-watchlist')).toBeInTheDocument()

    rerenderWith(HYDRATED, { A: 'AAPL' })
    // Chart follows the tap; the docked panel STAYS (it never covered the chart).
    expect(screen.getByTestId('chart-pane')).toHaveAttribute('data-sym', 'AAPL')
    expect(screen.getByTestId('widget-body-watchlist')).toBeInTheDocument()
  })

  test('closing the panel sticks (auto-dock is once), and ★ reopens it', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([], makeHandlers(), {}, { tablet: true })
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /close panel/i }))
    expect(screen.queryByTestId('widget-body-watchlist')).toBeNull()
    // A later hydration tick must not force it back open.
    rerenderWith([...HYDRATED])
    expect(screen.queryByTestId('widget-body-watchlist')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Watchlist' }))
    expect(screen.getByTestId('widget-body-watchlist')).toBeInTheDocument()
  })
})

describe('WARM prefs — the path that always looked fine', () => {
  test('still binds the chart when widgets are present at first render', () => {
    renderApp(HYDRATED)
    expect(screen.getByTestId('chart-pane')).toHaveAttribute('data-chartid', 'w-chart')
  })
})

describe('Phase 8 — the feel layer wires', () => {
  test('the shell asks its chart for the back-to-live chip', () => {
    renderApp(HYDRATED)
    expect(screen.getByTestId('chart-pane')).toHaveAttribute('data-golive', 'true')
  })

  test('Phase 10: the shell takes back the desktop canvas furniture', () => {
    // ChartPane force-enables verticalLegend / alwaysShowLegend /
    // showRangeSelector for the desktop workspace; the shell's overrides ride
    // stockChartProps (spread AFTER them). Legend = crosshair inspection tool;
    // range bar stays desktop.
    renderApp(HYDRATED)
    expect(screen.getByTestId('chart-pane')).toHaveAttribute('data-cleancanvas', 'true')
  })

  test('the ƒx button carries the widget settings\' live-overlay count', () => {
    // All four positional slots stated explicitly (cs.overlays merges by
    // index over the defaults), so the count is deterministic: 2. The badge is
    // visual-only — the accessible name stays the stable "Indicators".
    const stored = { overlays: [{ enabled: true }, { enabled: true }, { enabled: false }, { enabled: false }] }
    renderApp([{ id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D', settings: stored } }])
    expect(screen.getByRole('button', { name: 'Indicators' })).toHaveTextContent('2')
  })

  test('…and library indicators count too (instance existence IS enabled)', () => {
    const stored = {
      // settingsVersion 2 = the instance model; an unstamped blob runs the
      // legacy v1 fold, which rebuilds instances from `indicators` and drops
      // these.
      settingsVersion: 2,
      overlays: [{ enabled: true }, { enabled: false }, { enabled: false }, { enabled: false }],
      indicatorInstances: [{ id: 'i1', key: 'rsi' }, { id: 'i2', key: 'macd' }],
    }
    renderApp([{ id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D', settings: stored } }])
    expect(screen.getByRole('button', { name: 'Indicators' })).toHaveTextContent('3')
  })

  test('More → Share chart image exists and closes the sheet on tap', async () => {
    const user = userEvent.setup()
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: /share chart image/i }))
    // The sheet closed; with no live chart behind the mock the handler
    // resolves to "no snapshot" and does nothing further.
    expect(screen.queryByRole('button', { name: /share chart image/i })).toBeNull()
  })
})

describe('Phase 9 — alert management + add-widget feedback', () => {
  test('the alert sheet lists the symbol\'s active alerts and deletes one', async () => {
    const user = userEvent.setup()
    mockActiveAlerts = [
      { id: 71, sym: 'NVDA', target_price: 250.5, direction: 'above', is_active: 1 },
      { id: 72, sym: 'NVDA', target_price: 180, direction: 'below', is_active: 1 },
    ]
    const { rerenderWith } = renderApp([])
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: /set price alert/i }))
    expect(await screen.findByText('Active alerts on NVDA')).toBeInTheDocument()
    expect(screen.getByText('250.50')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /delete below alert at 180/i }))
    expect(deleteAlert).toHaveBeenCalledWith(72)
  })

  test('Add widget closes the sheet and opens the new widget once it hydrates', async () => {
    const user = userEvent.setup()
    const handlers = makeHandlers()
    const { rerenderWith } = renderApp([], handlers)
    rerenderWith(HYDRATED)

    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: 'Add Scanner' }))
    expect(handlers.onAddWidget).toHaveBeenCalledWith('scanner')
    // Sheet closed immediately; nothing to show until the layout hydrates.
    expect(screen.queryByRole('button', { name: 'Add Scanner' })).toBeNull()
    expect(screen.queryByTestId('widget-body-scanner')).toBeNull()

    // The save path lands the new widget → the page opens on it, unprompted.
    rerenderWith([...HYDRATED, { id: 'w-scr', type: 'scanner', color: 'A', opts: {} }])
    expect(screen.getByTestId('widget-body-scanner')).toBeInTheDocument()
  })
})
