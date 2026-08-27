import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import BreadthWidget from './BreadthWidget'
import { customBreadthColors, mergeBreadthWidgetSettings } from './breadthWidgetSettings'

const mockData = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: () => ({ data: mockData(), mutate: vi.fn(), isValidating: false }),
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
  advancing: 3200, declining: 1400,
  up_from_open: 2600, down_from_open: 1900,
  up_on_volume: 1800, down_on_volume: 700,
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

test('renders the heatmap with grouped tier tiles from the live metric defs', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap />)
  expect(screen.getByText('Primary Breadth')).toBeInTheDocument()
  expect(screen.getByText('Up 4%+')).toBeInTheDocument()
  expect(screen.getByText('120')).toBeInTheDocument()             // up_4pct_today value
  expect(screen.getAllByText(/61\.0%/).length).toBeGreaterThan(0) // pct_above_50sma fmt
})

test('header reads "Breadth Monitor" with Heatmap ⇄ Ratio Bars view pills', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap />)
  expect(screen.getByText('Breadth Monitor')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^heatmap$/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^ratio bars$/i })).toBeInTheDocument()
})

test('the Internals group + its readings appear (advance/decline, from-open, on-volume)', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap />)
  expect(screen.getByText('Internals')).toBeInTheDocument()
  expect(screen.getByText('Advancing')).toBeInTheDocument()
  expect(screen.getByText('Up from Open')).toBeInTheDocument()
  expect(screen.getByText('Up on Volume')).toBeInTheDocument()
})

test('the Ratio Bars pill switches to split gauges (persisted via opts.view)', () => {
  mockData.mockReturnValue(ROWS)
  const onOpts = vi.fn()
  render(<Wrap onOpts={onOpts} />)
  fireEvent.click(screen.getByRole('button', { name: /^ratio bars$/i }))
  expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({ view: 'ratio' }))
  // The gauge for Advance / Decline renders with its raw counts.
  expect(screen.getByText('Advance / Decline')).toBeInTheDocument()
  expect(screen.getByText('3200')).toBeInTheDocument()
  expect(screen.getByText('1400')).toBeInTheDocument()
})

test('opts.view=ratio renders Ratio Bars on mount', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap initialOpts={{ view: 'ratio' }} />)
  expect(screen.getByText('New Highs / New Lows')).toBeInTheDocument()
  // Heatmap group headers are absent in ratio view.
  expect(screen.queryByText('Primary Breadth')).not.toBeInTheDocument()
})

test('footer shows a last-updated TIME (like the Scanner) + a refresh button', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap />)
  // No live row in the test → falls back to the fetch time, always a "… ET" time.
  expect(screen.getByText(/Updated .*ET/)).toBeInTheDocument()
  expect(screen.getByTitle('Refresh')).toBeInTheDocument()
})

test('the ✕ on a tile hides that reading through opts.hiddenMetrics', () => {
  mockData.mockReturnValue(ROWS)
  const onOpts = vi.fn()
  render(<Wrap onOpts={onOpts} />)
  fireEvent.click(screen.getByLabelText('Remove Up 4%+'))
  expect(onOpts).toHaveBeenCalledWith(
    expect.objectContaining({ hiddenMetrics: expect.arrayContaining(['up_4pct_today']) }),
  )
})

test('a hidden reading renders no tile', () => {
  mockData.mockReturnValue(ROWS)
  render(<Wrap initialOpts={{ hiddenMetrics: ['up_4pct_today'] }} />)
  expect(screen.queryByText('Up 4%+')).not.toBeInTheDocument()
})

test('the ＋ menu toggles a reading', () => {
  mockData.mockReturnValue(ROWS)
  const onOpts = vi.fn()
  render(<Wrap onOpts={onOpts} />)
  fireEvent.click(screen.getByLabelText('Add or remove readings'))
  const items = screen.getAllByRole('menuitemcheckbox', { name: /Up 4%/ })
  fireEvent.click(items[0])
  expect(onOpts).toHaveBeenCalledWith(
    expect.objectContaining({ hiddenMetrics: expect.arrayContaining(['up_4pct_today']) }),
  )
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

test('customBreadthColors derives severity shades from the two hues (both required)', () => {
  expect(customBreadthColors({ upColor: '', downColor: '' })).toBeNull()
  expect(customBreadthColors({ upColor: '#3b82f6', downColor: '' })).toBeNull()
  const c = customBreadthColors({ upColor: '#3b82f6', downColor: '#a855f7' })
  expect(c.viewPalette.tier.g3).toBe('#3b82f6')
  expect(c.viewPalette.tier.r3).toBe('#a855f7')
  expect(c.viewPalette.tier.g1).not.toBe(c.viewPalette.tier.g3)
  expect(c.tipColors[5]).toBe('#3b82f6')
  expect(c.tipColors[0]).toBe('#a855f7')
  expect(c.cellColors.g2).not.toBe(c.cellColors.g3)
  expect(c.viewPalette.tier.a).toBe('#fbbf24')
  expect(c.cellColors['']).toBe('#181818')
})

test('legacy single textColor migrates into headerColor + valueColor', () => {
  const m = mergeBreadthWidgetSettings({ textColor: '#ffffff' })
  expect(m.headerColor).toBe('#ffffff')
  expect(m.valueColor).toBe('#ffffff')
  expect(m.textColor).toBeUndefined()
  const d = mergeBreadthWidgetSettings({ textColor: '#e0dac8' })
  expect(d.headerColor).toBe('')
  expect(d.valueColor).toBe('')
})
