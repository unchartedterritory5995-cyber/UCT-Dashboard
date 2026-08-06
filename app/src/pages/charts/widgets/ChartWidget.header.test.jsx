import { render, screen, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// Same mock surface as ChartWidget.test.jsx, EXCEPT: the clock, day gain,
// timeframe menu and fundamentals are left real (or given real data) because
// they are exactly what this file exists to pin.
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym }) => <div><span data-testid="chart-sym">{sym}</span></div>,
}))
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef(({ displayLabel }, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <span data-testid="sym-label">{displayLabel}</span>
    }),
  }
})
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({
  default: ({ open }) => (open ? <div data-testid="settings-modal" /> : null),
}))
vi.mock('./ChartMarketClock', () => ({ default: () => <span data-testid="market-clock">clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: ({ sym }) => <span data-testid="day-gain">{sym}</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => <div data-testid="tf-menu" /> }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
// Real-shaped fundamentals so the meta row renders VALUES, not em-dashes.
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({
  default: () => ({
    data: { metrics: { market_cap: '$1.2T' }, next_earnings: '2026-08-28', composite: 61 },
    isLoading: false,
  }),
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
// Configurable mock — a mutable `vi.fn()` so individual tests can override the
// return value (e.g. to exercise the theme-index branches) without disturbing
// every other test's default `isIndex: false` shape. Reset in beforeEach.
vi.mock('../../../hooks/useThemeIndexBars', () => ({
  default: vi.fn(() => ({ isIndex: false, bars: null, name: null, sector: null, loading: false })),
}))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: 'SPDR S&P 500 ETF Trust' }) }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
// Deterministic session so the extended-hours button label is stable.
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

import ChartWidget from './ChartWidget'
import useThemeIndexBars from '../../../hooks/useThemeIndexBars'

beforeEach(() => {
  useThemeIndexBars.mockReturnValue({ isIndex: false, bars: null, name: null, sector: null, loading: false })
})

function Wrap({ opts = {}, onOptsChange = () => {} }) {
  const [groupSyms, setGroupSyms] = useState({ A: 'SPY', B: null, C: null, D: null })
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return (
    <WorkspaceContext.Provider value={value}>
      <ChartWidget color="A" opts={opts} onOptsChange={onOptsChange} />
    </WorkspaceContext.Provider>
  )
}

// ── Meta row ───────────────────────────────────────────────────────────────
test('meta row renders market cap, next earnings and UCT rating', () => {
  render(<Wrap />)
  expect(screen.getByText('Market Cap')).toBeTruthy()
  expect(screen.getByText('$1.2T')).toBeTruthy()
  expect(screen.getByText('Next Earnings')).toBeTruthy()
  expect(screen.getByText('8/28/2026')).toBeTruthy()   // ISO -> M/D/YYYY
  expect(screen.getByText('UCT Rating')).toBeTruthy()
  expect(screen.getByText('61')).toBeTruthy()
})

test('meta row is hidden entirely when all three items are toggled off', () => {
  render(<Wrap opts={{ settings: { header: { showMarketCap: false, showNextEarnings: false, showUctRating: false } } }} />)
  expect(screen.queryByText('Market Cap')).toBeNull()
  expect(screen.queryByText('Next Earnings')).toBeNull()
  expect(screen.queryByText('UCT Rating')).toBeNull()
})

// ── Identity row ───────────────────────────────────────────────────────────
test('identity row shows the company name, the day gain and the market clock', () => {
  render(<Wrap />)
  expect(screen.getByTestId('sym-label').textContent).toBe('SPDR S&P 500 ETF Trust')
  expect(screen.getByTestId('day-gain').textContent).toBe('SPY')
  expect(screen.getByTestId('market-clock')).toBeTruthy()
})

test('titleMode "both" renders TICKER (Company)', () => {
  render(<Wrap opts={{ settings: { header: { titleMode: 'both' } } }} />)
  expect(screen.getByTestId('sym-label').textContent).toBe('SPY (SPDR S&P 500 ETF Trust)')
})

// ── Identity row — theme-index day-change branch ───────────────────────────
// Every other test in this file mocks useThemeIndexBars to isIndex:false, so
// the `showChange={hdr.showChange && !(themeIdx.isIndex && !idxGain)}` guard on
// ChartWidget's ChartIdentityRow call site has zero coverage without these two.
// This first case is the one that must die if the guard is dropped to a bare
// `hdr.showChange` — see the reviewer's mutation in the report.
test('a theme index without a computed gain renders no day-change at all', () => {
  useThemeIndexBars.mockReturnValue({ isIndex: true, bars: null, name: 'AI Infrastructure', loading: false })
  render(<Wrap />)
  expect(screen.queryByTestId('day-gain')).toBeNull()
})

test('a theme index with a computed gain renders the inline formatted span, not ChartDayGain', () => {
  useThemeIndexBars.mockReturnValue({
    isIndex: true,
    // idxGain is derived from the last two bars' close (see ChartWidget's
    // idxGain useMemo): abs = 105-100 = 5, pct = 5/100*100 = 5.00%.
    bars: [{ c: 100 }, { c: 105 }],
    name: 'AI Infrastructure',
    loading: false,
  })
  render(<Wrap />)
  expect(screen.getByText('+5.00 (+5.00%)')).toBeTruthy()
  expect(screen.queryByTestId('day-gain')).toBeNull()
})

// ── Session toggle ─────────────────────────────────────────────────────────
test('on a daily timeframe the session toggle offers Regular Hours + the post-market include', () => {
  render(<Wrap opts={{ tf: 'D' }} />)
  const group = screen.getByRole('group', { name: 'Chart session view' })
  expect(within(group).getByText('Regular Hours')).toBeTruthy()
  expect(within(group).getByText('Include post-market')).toBeTruthy()
})

test('on an intraday timeframe the toggle switches to Regular / Extended Hours', () => {
  render(<Wrap opts={{ tf: '5' }} />)
  const group = screen.getByRole('group', { name: 'Chart extended hours' })
  expect(within(group).getByText('Regular Hours')).toBeTruthy()
  expect(within(group).getByText('Extended Hours')).toBeTruthy()
  expect(screen.queryByRole('group', { name: 'Chart session view' })).toBeNull()
})

// ── Timeframe bar ──────────────────────────────────────────────────────────
test('the timeframe bar renders every favorited interval', () => {
  render(<Wrap opts={{ tf: 'D' }} />)
  for (const label of ['1m', '5m', '15m', '30m', '1h', '1D', '1W', '1M']) {
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
  }
})

test('clicking a timeframe button reports the new code to the host', () => {
  const onOptsChange = vi.fn()
  render(<Wrap opts={{ tf: 'D' }} onOptsChange={onOptsChange} />)
  fireEvent.click(screen.getByRole('button', { name: '1W' }))
  expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ tf: 'W' }))
})

test('the more-timeframes chevron opens the timeframe menu', () => {
  render(<Wrap opts={{ tf: 'D' }} />)
  expect(screen.queryByTestId('tf-menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'More timeframes' }))
  expect(screen.getByTestId('tf-menu')).toBeTruthy()
})

// ── Settings gear ──────────────────────────────────────────────────────────
test('the gear opens the chart settings modal', () => {
  render(<Wrap />)
  expect(screen.queryByTestId('settings-modal')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Chart settings' }))
  expect(screen.getByTestId('settings-modal')).toBeTruthy()
})
