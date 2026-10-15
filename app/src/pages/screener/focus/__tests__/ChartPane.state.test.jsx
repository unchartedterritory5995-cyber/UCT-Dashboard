// Task 5: the chart pane's own state (B4), its render budget on price ticks (S5), the settle gate
// on the live stream and side fetches (Perf 2), and arrow keys from the pane (B7).
import { render, screen, fireEvent, act } from '@testing-library/react'
import useSWR, { SWRConfig } from 'swr'
import { vi, expect, test, beforeEach, afterEach } from 'vitest'

const chart = vi.hoisted(() => ({ renders: 0, mounts: 0, props: null, keys: [] }))
vi.mock('../../../../components/StockChart', async () => {
  const React = await import('react')
  const note = props => { chart.renders += 1; chart.props = props }
  const mounted = () => { chart.mounts += 1 }
  function StockChart(props) {
    note(props)
    React.useEffect(mounted, [])
    // Stand-ins for the chart's own per-symbol fetches: one side fetch, one bars fetch.
    const ipo = useSWR(`/api/ticker-ipo/${props.sym}`, () => ({ list_date: '2001-01-01' }))
    const bars = useSWR(`/api/bars/${props.sym}?tf=${props.tf}`, () => ({ bars: [] }))
    const markers = useSWR(`/api/chart/markers/${props.sym}?days=36500`, () => ({ sym: props.sym }))
    return <div data-testid="stockchart" data-sym={props.sym} data-live={String(props.liveUpdates)} data-ipo={ipo.data?.list_date || ''} data-bars={bars.data ? 'y' : ''} data-markers={markers.data?.sym || ''} />
  }
  return { default: StockChart }
})
import ChartPane, { CHART_TIMEOUT_MS, SETTLE_MS } from '../ChartPane'

const row = { ticker: 'MU', company: 'Micron Technology', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, adr_pct: 3.1 }
const row2 = { ...row, ticker: 'ECO', company: 'Eco' }
const why = { items: [], more: 0 }
const onFlag = vi.fn(), onWatch = vi.fn(), onOpenFilters = vi.fn()
let fetched
// One app-level SWR config per test, identity-stable across rerenders as the app's is.
const record = useSWRNext => (key, fn, cfg) => useSWRNext(key, key ? (...a) => { fetched.push(key); return fn(...a) } : fn, cfg)
let swrValue
const wrap = node => <SWRConfig value={swrValue}>{node}</SWRConfig>
const pane = (props = {}) => wrap(<ChartPane row={row} why={why} onFlag={onFlag} onWatch={onWatch} onOpenFilters={onOpenFilters} {...props} />)

beforeEach(() => {
  chart.renders = 0; chart.mounts = 0; chart.props = null
  fetched = []
  swrValue = { provider: () => new Map(), dedupingInterval: 0, use: [record] }
  localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers() })
const drawn = n => act(() => { chart.props.onDrawnBarCount(n) })

// ── B4 ──
test('B4: a chart without candles says it is loading; candles clear it', () => {
  render(pane())
  expect(screen.getByRole('status')).toHaveTextContent('Loading chart…')
  drawn(0)
  expect(screen.getByRole('status')).toHaveTextContent('Loading chart…')
  drawn(126)
  expect(screen.queryByText('Loading chart…')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
test('B4: no candles within the timeout reads "Chart unavailable · Retry"; Retry asks again', () => {
  render(pane())
  act(() => { vi.advanceTimersByTime(CHART_TIMEOUT_MS - 1) })
  expect(screen.queryByRole('alert')).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Chart unavailable')
  expect(screen.queryByText('Loading chart…')).toBeNull()
  const mounts = chart.mounts
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  // a fresh chart is mounted and the pane is back to loading
  expect(chart.mounts).toBe(mounts + 1)
  expect(screen.getByRole('status')).toHaveTextContent('Loading chart…')
  drawn(50)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText('Loading chart…')).toBeNull()
})
test('B4: candles arriving after the timeout clear "unavailable"', () => {
  render(pane())
  act(() => { vi.advanceTimersByTime(CHART_TIMEOUT_MS) })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  drawn(10)
  expect(screen.queryByRole('alert')).toBeNull()
})
test('B4: the state is per stock and timeframe: a new stock or W starts loading again', () => {
  const { rerender } = render(pane())
  drawn(100)
  expect(screen.queryByText('Loading chart…')).toBeNull()
  rerender(pane({ row: row2 }))
  expect(screen.getByRole('status')).toHaveTextContent('Loading chart…')
  drawn(80)
  expect(screen.queryByText('Loading chart…')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'W' }))
  expect(screen.getByRole('status')).toHaveTextContent('Loading chart…')
  // the old stock's timeout never fires on the new one
  drawn(30)
  act(() => { vi.advanceTimersByTime(CHART_TIMEOUT_MS * 2) })
  expect(screen.queryByRole('alert')).toBeNull()
})

// ── S5 ──
test('S5: live price ticks repaint the header but never re-render the chart', () => {
  const { rerender } = render(pane({ livePx: 960, liveChg: 0.4 }))
  act(() => { vi.advanceTimersByTime(SETTLE_MS) })
  drawn(100)
  const before = chart.renders
  for (let i = 1; i <= 8; i++) rerender(pane({ livePx: 960 + i, liveChg: 0.4 + i / 10 }))
  expect(screen.getByText('968.00')).toBeInTheDocument()
  expect(chart.renders).toBe(before)
})
test('S5: an unchanged pane (same props) does not re-render at all', () => {
  const props = { livePx: 960, liveChg: 0.4 }
  const { rerender } = render(pane(props))
  act(() => { vi.advanceTimersByTime(SETTLE_MS) })
  const before = chart.renders
  rerender(pane(props))
  rerender(pane(props))
  expect(chart.renders).toBe(before)
})

// ── Perf 2 ──
test('Perf 2: the live stream opens only once the ticker has settled; the bars are asked at once', async () => {
  const { rerender } = render(pane())
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-live', 'false')
  await act(async () => {})
  expect(fetched).toContain('/api/bars/MU?tf=D')
  expect(fetched).not.toContain('/api/ticker-ipo/MU')
  act(() => { vi.advanceTimersByTime(SETTLE_MS - 10) })
  rerender(pane({ row: row2 }))       // stepped on before MU settled
  act(() => { vi.advanceTimersByTime(SETTLE_MS - 10) })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-live', 'false')
  await act(async () => {})
  expect(fetched).toContain('/api/bars/ECO?tf=D')
  act(() => { vi.advanceTimersByTime(10) })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-live', 'true')
  await act(async () => {})
  // only the stock the member stopped on asked for its side data
  expect(fetched).toContain('/api/ticker-ipo/ECO')
  expect(fetched).not.toContain('/api/ticker-ipo/MU')
})
test('Perf 2: a listing date this browser holds as final is never asked again', async () => {
  localStorage.setItem('tipo:MU', JSON.stringify({ t: Date.now(), d: { list_date: '1984-06-01', first_trade_final: true } }))
  localStorage.setItem('tipo:ECO', JSON.stringify({ t: Date.now(), d: { list_date: '1999-01-01', first_trade_final: false } }))
  const { rerender } = render(pane())
  act(() => { vi.advanceTimersByTime(SETTLE_MS) })
  await act(async () => {})
  expect(fetched).not.toContain('/api/ticker-ipo/MU')
  // a non-final date is still asked (the server may still correct it)
  rerender(pane({ row: row2 }))
  act(() => { vi.advanceTimersByTime(SETTLE_MS) })
  await act(async () => {})
  expect(fetched).toContain('/api/ticker-ipo/ECO')
})

test('Perf 2: a stock walked back to keeps its cached markers while unsettled, and asks for nothing', async () => {
  const row3 = { ...row, ticker: 'AAA', company: 'Aaa' }
  const { rerender } = render(pane())
  act(() => { vi.advanceTimersByTime(SETTLE_MS) })
  await act(async () => {})
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-markers', 'MU')
  rerender(pane({ row: row2 }))                      // ECO settles: the settled stock is now ECO
  act(() => { vi.advanceTimersByTime(SETTLE_MS) })
  await act(async () => {})
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-markers', 'ECO')
  rerender(pane({ row: row3 }))                      // AAA, unsettled, nothing cached: held, empty
  await act(async () => {})
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-markers', '')
  rerender(pane({ row }))                            // back to MU, unsettled: its cached markers, at once
  await act(async () => {})
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-live', 'false')
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-markers', 'MU')
  expect(fetched.filter(k => k.startsWith('/api/chart/markers/'))).toEqual(['/api/chart/markers/MU?days=36500', '/api/chart/markers/ECO?days=36500'])
})

// ── B7 ──
test('B7: ↑/↓ pressed in the pane are handed to the list; other keys and typing are not', () => {
  const onNavKey = vi.fn()
  render(pane({ onNavKey }))
  const paneEl = screen.getByTestId('focus-chart-pane')
  expect(paneEl).toHaveAttribute('tabindex', '-1')
  fireEvent.keyDown(screen.getByTestId('stockchart'), { key: 'ArrowDown' })
  fireEvent.keyDown(screen.getByRole('button', { name: 'Flag' }), { key: 'ArrowUp' })
  expect(onNavKey).toHaveBeenCalledTimes(2)
  expect(onNavKey.mock.calls[0][0].key).toBe('ArrowDown')
  fireEvent.keyDown(paneEl, { key: 'ArrowLeft' })
  fireEvent.keyDown(paneEl, { key: 'ArrowDown', ctrlKey: true })
  expect(onNavKey).toHaveBeenCalledTimes(2)
})

test('Minor 5: while busy, Flag and Add to watchlist are aria-disabled and dimmed, and keep focus', () => {
  const { rerender } = render(pane({ busy: true }))
  for (const name of ['Flag', 'Add to watchlist']) {
    const b = screen.getByRole('button', { name })
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b).not.toBeDisabled()
    expect(b.className).toMatch(/btnBusy/)
  }
  rerender(pane({ busy: false }))
  expect(screen.getByRole('button', { name: 'Flag' })).not.toHaveAttribute('aria-disabled')
})

test('3: Retry hands focus back to the list', () => {
  const onRefocus = vi.fn()
  render(pane({ onRefocus }))
  act(() => { vi.advanceTimersByTime(CHART_TIMEOUT_MS) })
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onRefocus).toHaveBeenCalledTimes(1)
})
test('6: behind "Chart unavailable" the chart is inert and hidden, so there is ONE Retry to reach', () => {
  render(pane())
  const layer = screen.getByTestId('pane-chart-layer')
  expect(layer).not.toHaveAttribute('inert')
  act(() => { vi.advanceTimersByTime(CHART_TIMEOUT_MS) })
  expect(layer).toHaveAttribute('inert')
  expect(layer).toHaveAttribute('aria-hidden', 'true')
  expect(layer.contains(screen.getByTestId('stockchart'))).toBe(true)
  drawn(5)
  expect(layer).not.toHaveAttribute('inert')
})
test('5: a busy pane is dimmed and says so', () => {
  render(pane({ busy: true }))
  const p = screen.getByTestId('focus-chart-pane')
  expect(p.className).toMatch(/paneBusy/)
  expect(p).toHaveAttribute('aria-busy', 'true')
})
