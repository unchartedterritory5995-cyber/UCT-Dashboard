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
  default: forwardRef(function ChartPaneMock({ sym, tf, chartId, density, showTfBar }, ref) {
    void ref
    return (
      <div
        data-testid="chart-pane"
        data-sym={sym}
        data-tf={tf}
        data-chartid={chartId}
        data-density={density}
        data-showtfbar={String(showTfBar)}
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

function renderApp(widgets, handlers = makeHandlers(), ctx = {}) {
  const value = {
    ...WORKSPACE_FALLBACK,
    groupSyms: { A: 'NVDA', B: null, C: null, D: null },
    setGroupSym: vi.fn(),
    ...ctx,
  }
  const ui = (w) => (
    <WorkspaceContext.Provider value={value}>
      <MobileChartsApp widgets={w} {...handlers} />
    </WorkspaceContext.Provider>
  )
  const utils = render(ui(widgets))
  return { ...utils, rerenderWith: (w) => utils.rerender(ui(w)), handlers, value }
}

beforeEach(() => {
  localStorage.clear()
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

describe('WARM prefs — the path that always looked fine', () => {
  test('still binds the chart when widgets are present at first render', () => {
    renderApp(HYDRATED)
    expect(screen.getByTestId('chart-pane')).toHaveAttribute('data-chartid', 'w-chart')
  })
})
