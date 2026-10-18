// The chart pane's render budget on price ticks (S5), arrow keys from the pane (B7) and its busy
// state. The chart below the pane's header is the /charts Chart widget (ScreenerChartWidget, see
// ScreenerChartWidget.test.jsx), which owns its own loading, error and fetch behaviour; the old
// Focus-only chart's B4 loading/Retry and Perf 2 settle-gate tests went with that chart.
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, expect, test, beforeEach } from 'vitest'

const chart = vi.hoisted(() => ({ renders: 0 }))
vi.mock('../ScreenerChartWidget', () => ({
  default: function ScreenerChartWidget(props) { chart.renders += 1; return <div data-testid="stockchart" data-sym={props.sym} /> },
}))
import ChartPane from '../ChartPane'

const row = { ticker: 'MU', company: 'Micron Technology', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, adr_pct: 3.1 }
const why = { items: [], more: 0 }
const onFlag = vi.fn(), onWatch = vi.fn(), onOpenFilters = vi.fn()
const pane = (props = {}) => <ChartPane row={row} why={why} onFlag={onFlag} onWatch={onWatch} onOpenFilters={onOpenFilters} {...props} />

beforeEach(() => { chart.renders = 0 })

// ── S5 ──
test('S5: live price ticks repaint the header but never re-render the chart', () => {
  const { rerender } = render(pane({ livePx: 960, liveChg: 0.4 }))
  const before = chart.renders
  for (let i = 1; i <= 8; i++) rerender(pane({ livePx: 960 + i, liveChg: 0.4 + i / 10 }))
  expect(screen.getByText('968.00')).toBeInTheDocument()
  expect(chart.renders).toBe(before)
})
test('S5: an unchanged pane (same props) does not re-render the chart', () => {
  const props = { livePx: 960, liveChg: 0.4 }
  const { rerender } = render(pane(props))
  const before = chart.renders
  rerender(pane(props))
  rerender(pane(props))
  expect(chart.renders).toBe(before)
})
test('CONTROL: a new stock does re-render the chart', () => {
  const { rerender } = render(pane())
  const before = chart.renders
  rerender(pane({ row: { ...row, ticker: 'ECO' } }))
  expect(chart.renders).toBe(before + 1)
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
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

test('5: a busy pane is dimmed and says so', () => {
  render(pane({ busy: true }))
  const p = screen.getByTestId('focus-chart-pane')
  expect(p.className).toMatch(/paneBusy/)
  expect(p).toHaveAttribute('aria-busy', 'true')
})
