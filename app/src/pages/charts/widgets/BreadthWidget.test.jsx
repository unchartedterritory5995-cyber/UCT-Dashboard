import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import BreadthWidget from './BreadthWidget'

const mockData = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: () => ({ data: mockData() }),
}))

const row = (date, score) => ({
  date,
  breadth_score: score,
  uct_exposure: 95,
  up_4pct_today: 120, down_4pct_today: 40,
  ratio_5day: 1.7, ratio_10day: 1.4,
  pct_above_5sma: 55, pct_above_10sma: 58, pct_above_20ema: 60,
  pct_above_40sma: 57, pct_above_50sma: 61, pct_above_100sma: 59, pct_above_200sma: 52,
  spy_above_10sma: 1, spy_above_20sma: 1, spy_above_50sma: 1, spy_above_200sma: 1,
  qqq_above_10sma: 1, qqq_above_20sma: 1, qqq_above_50sma: 1, qqq_above_200sma: 0,
  sp500_close: 6400, qqq_close: 590, spy_day_pct: 0.6, qqq_day_pct: 0.8,
  vix: 15.2, mcclellan_osc: 42,
  stage2_count: 900, stage4_count: 300,
  new_52w_highs: 180, new_52w_lows: 40, new_20d_highs: 400, new_20d_lows: 90,
  new_ath: 60, hvc_52w: 25, atr_ext_7: 12,
  cnn_fear_greed: 55, aaii_spread: 6.5, cboe_putcall: 0.85,
})

const ROWS = { rows: [row('2026-07-22', 72), row('2026-07-21', 70), row('2026-07-18', 68), row('2026-07-17', 66), row('2026-07-16', 64)] }

function Wrap({ initialOpts = {}, onOpts }) {
  const [opts, setOpts] = useState(initialOpts)
  const handle = (next) => { setOpts(next); onOpts?.(next) }
  return (
    <MemoryRouter>
      <BreadthWidget opts={opts} onOptsChange={handle} />
    </MemoryRouter>
  )
}

test('defaults to the heatmap view with tier tiles from live metric defs', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap />)
  // Group labels + a few metric tiles render with formatted values.
  expect(screen.getByText('Primary Breadth')).toBeInTheDocument()
  expect(screen.getByText('Up 4%+')).toBeInTheDocument()
  expect(screen.getByText('120')).toBeInTheDocument()          // up_4pct_today value
  expect(screen.getAllByText(/61\.0%/).length).toBeGreaterThan(0) // pct_above_50sma fmt
})

test('shows the as-of date from the newest row', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap />)
  expect(screen.getByText('2026-07-22')).toBeInTheDocument()
})

test('switching to Rings persists the choice through opts', () => {
  mockData.mockReturnValue(ROWS)
  const onOpts = vi.fn()
  render(<Wrap onOpts={onOpts} />)
  fireEvent.click(screen.getByRole('button', { name: /^rings$/i }))
  expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({ view: 'rings' }))
})

test('restores the persisted view from opts (rings on first render)', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap initialOpts={{ view: 'rings' }} />)
  // RingsView renders SVG rings — the heatmap group labels are gone.
  expect(screen.queryByText('Primary Breadth')).not.toBeInTheDocument()
})

test('shows loading state before data arrives', () => {
  mockData.mockReturnValue(undefined)
  render(<Wrap />)
  expect(screen.getByText(/loading breadth/i)).toBeInTheDocument()
})

test('has a settings gear', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap />)
  expect(screen.getByTitle('Breadth widget settings')).toBeInTheDocument()
})
