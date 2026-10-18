// The screener's chart is the /charts Chart widget (owner, 2026-10-18). WidgetHost and the phone
// shell are stubbed so these tests read exactly what the host hands them: the widget, the
// workspace (colour group A) and the host overlay (pivot line, no scan pause).
import { render, screen, act } from '@testing-library/react'
import { useContext } from 'react'
import { vi, expect, test, beforeEach, afterEach, describe } from 'vitest'

const H = vi.hoisted(() => ({ prefs: {}, loading: false, setPrefMerged: null, own: null, host: null, phone: null }))
vi.mock('../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: H.prefs, setPrefMerged: H.setPrefMerged, loading: H.loading }),
}))
vi.mock('../../../../components/chart/pane/useChartSurfaceSettings', () => ({
  default: () => ({ ownChartSource: H.own, cs: {}, theme: 'default' }),
}))
vi.mock('../../../charts/WidgetHost', async () => {
  const { WorkspaceContext } = await import('../../../charts/WorkspaceContext')
  const { ChartHostOverlayContext } = await import('../../../charts/widgets/chartHostOverlay')
  function WidgetHost(props) {
    H.host = { props, ws: useContext(WorkspaceContext), overlay: useContext(ChartHostOverlayContext) }
    return <div data-testid="widget-host" data-sym={H.host.ws.groupSyms.A} />
  }
  return { default: WidgetHost }
})
vi.mock('../../../charts/mobile/MobileChartsApp', async () => {
  const { WorkspaceContext } = await import('../../../charts/WorkspaceContext')
  function MobileChartsApp(props) {
    H.phone = { props, ws: useContext(WorkspaceContext) }
    return <div data-testid="mobile-charts-app" />
  }
  return { default: MobileChartsApp }
})
import ScreenerChartWidget from '../ScreenerChartWidget'
import { SCREENER_CHART_PREF, SCREENER_CHART_ID, parseScreenerWidgets } from '../screenerChartPrefs'

beforeEach(() => {
  H.prefs = {}; H.loading = false; H.own = null; H.host = null; H.phone = null
  // setPrefMerged(key, updater): record what the updater would write.
  H.saved = []
  H.setPrefMerged = vi.fn((key, updater) => { H.saved.push([key, updater(undefined)]) })
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers() })

const LINES = [{ price: 988, color: '#dcbb5e', title: 'Flat base pivot' }]

describe('desktop: the /charts Chart widget', () => {
  test('renders the chart widget on colour group A, with the selected stock in group A', () => {
    render(<ScreenerChartWidget sym="MU" />)
    expect(H.host.props.widget).toMatchObject({ id: SCREENER_CHART_ID, type: 'chart', color: 'A' })
    expect(screen.getByTestId('widget-host')).toHaveAttribute('data-sym', 'MU')
  })

  test('a new selection moves group A', () => {
    const { rerender } = render(<ScreenerChartWidget sym="MU" />)
    rerender(<ScreenerChartWidget sym="ECO" />)
    expect(H.host.ws.groupSyms.A).toBe('ECO')
  })

  test('a member who never opened it starts from their own /charts chart', () => {
    H.own = { chartType: 'candles', marker: 'own' }
    render(<ScreenerChartWidget sym="MU" />)
    expect(H.host.props.widget.opts.settings).toEqual(H.own)
  })

  test('the saved screener chart wins over the seed', () => {
    H.own = { marker: 'own' }
    H.prefs = { [SCREENER_CHART_PREF]: JSON.stringify({ opts: { tf: '60', settings: { marker: 'saved' } } }) }
    render(<ScreenerChartWidget sym="MU" />)
    expect(H.host.props.widget.opts).toEqual({ tf: '60', settings: { marker: 'saved' } })
  })

  test('the pivot line is offered for the stock on show only, and the scan pause is off', () => {
    render(<ScreenerChartWidget sym="MU" priceLines={LINES} />)
    expect(H.host.overlay.priceLinesFor('MU')).toEqual(LINES)
    expect(H.host.overlay.priceLinesFor('ECO')).toBeNull()
    expect(H.host.overlay.symbolDebounceMs).toBe(0)
  })

  test('a change in the widget is saved (debounced); opening it saves nothing', () => {
    render(<ScreenerChartWidget sym="MU" />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(H.setPrefMerged).not.toHaveBeenCalled()
    act(() => { H.host.props.onOptsChange({ tf: 'W' }) })
    act(() => { vi.advanceTimersByTime(499) })
    expect(H.setPrefMerged).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(H.saved).toEqual([[SCREENER_CHART_PREF, JSON.stringify({ opts: { tf: 'W' }, extras: [] })]])
  })

  test('a widget swap keeps it a chart', () => {
    render(<ScreenerChartWidget sym="MU" />)
    act(() => { H.host.props.onReplaceWidget(SCREENER_CHART_ID, { type: 'watchlist', opts: { x: 1 } }) })
    expect(H.host.props.widget.type).toBe('chart')
    act(() => { H.host.props.onReplaceWidget(SCREENER_CHART_ID, { type: 'chart', opts: { tf: 'M' } }) })
    expect(H.host.props.widget.opts).toEqual({ tf: 'M' })
  })

  test('mounted before preferences answered: seeds again from them, without saving', () => {
    H.loading = true
    const { rerender } = render(<ScreenerChartWidget sym="MU" />)
    H.loading = false
    H.prefs = { [SCREENER_CHART_PREF]: JSON.stringify({ opts: { tf: '5' } }) }
    rerender(<ScreenerChartWidget sym="MU" />)
    expect(H.host.props.widget.opts).toEqual({ tf: '5' })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(H.setPrefMerged).not.toHaveBeenCalled()
  })

  test('CONTROL: a change made before preferences answered is not overwritten by the late seed', () => {
    H.loading = true
    const { rerender } = render(<ScreenerChartWidget sym="MU" />)
    act(() => { H.host.props.onOptsChange({ tf: 'W' }) })
    H.loading = false
    H.prefs = { [SCREENER_CHART_PREF]: JSON.stringify({ opts: { tf: '5' } }) }
    rerender(<ScreenerChartWidget sym="MU" />)
    expect(H.host.props.widget.opts).toEqual({ tf: 'W' })
  })
})

describe('phone: the /charts phone chart', () => {
  test('the phone sheet hosts MobileChartsApp bound to the same chart, not the desktop widget', () => {
    render(<ScreenerChartWidget sym="MU" phone />)
    expect(screen.queryByTestId('widget-host')).toBeNull()
    expect(H.phone.props.widgets[0]).toMatchObject({ id: SCREENER_CHART_ID, type: 'chart', color: 'A' })
    expect(H.phone.ws.groupSyms.A).toBe('MU')
  })

  test('★ / Tools add a widget on group A, a page can be removed, the chart cannot', () => {
    render(<ScreenerChartWidget sym="MU" phone />)
    act(() => { H.phone.props.onAddWidget('watchlist') })
    act(() => { H.phone.props.onAddWidget('chart') })
    expect(H.phone.props.widgets.map(w => w.type)).toEqual(['chart', 'watchlist'])
    expect(H.phone.props.widgets[1].color).toBe('A')
    const added = H.phone.props.widgets[1].id
    act(() => { H.phone.props.onRemove(SCREENER_CHART_ID) })
    expect(H.phone.props.widgets).toHaveLength(2)
    act(() => { H.phone.props.onRemove(added) })
    expect(H.phone.props.widgets.map(w => w.type)).toEqual(['chart'])
  })

  test('a phone chart change and an added widget are saved', () => {
    render(<ScreenerChartWidget sym="MU" phone />)
    act(() => { H.phone.props.onOptsChange(SCREENER_CHART_ID, { tf: 'D' }) })
    act(() => { H.phone.props.onAddWidget('news') })
    act(() => { vi.advanceTimersByTime(500) })
    const saved = JSON.parse(H.saved.at(-1)[1])
    expect(saved.opts).toEqual({ tf: 'D' })
    expect(saved.extras.map(w => w.type)).toEqual(['news'])
  })
})

describe('parseScreenerWidgets', () => {
  test('a corrupt pref opens the seeded chart', () => {
    expect(parseScreenerWidgets('{nope', { settings: { a: 1 } })).toEqual([
      { id: SCREENER_CHART_ID, type: 'chart', color: 'A', opts: { settings: { a: 1 } } },
    ])
  })
  test('stored extras can never be a chart, the chart id, or off group A', () => {
    const raw = JSON.stringify({ opts: {}, extras: [
      { id: 'x1', type: 'chart' }, { id: SCREENER_CHART_ID, type: 'watchlist' },
      { id: 'w1', type: 'watchlist', color: 'C', opts: { a: 1 } }, { type: 'news' },
    ] })
    const out = parseScreenerWidgets(raw)
    expect(out.slice(1)).toEqual([{ id: 'w1', type: 'watchlist', color: 'A', opts: { a: 1 } }])
  })
})
