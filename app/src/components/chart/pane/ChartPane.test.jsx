import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

// Same mock surface as the ChartWidget header rail (Task 1), re-based to this
// directory. Every path below resolves to the SAME module the widget rail mocks,
// so the two files describe one component tree from two entry points.
vi.mock('../../StockChart', () => ({
  default: ({ sym }) => <div><span data-testid="chart-sym">{sym}</span></div>,
}))
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef(({ displayLabel }, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <span data-testid="sym-label">{displayLabel}</span>
    }),
  }
})
vi.mock('../ChartSettingsModal', () => ({
  default: ({ open }) => (open ? <div data-testid="settings-modal" /> : null),
}))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({
  default: () => <span data-testid="market-clock">clock</span>,
}))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({
  default: ({ sym }) => <span data-testid="day-gain">{sym}</span>,
}))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({
  default: () => <div data-testid="tf-menu" />,
}))
vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }),
}))
// Real-shaped fundamentals so the meta row renders VALUES, not em-dashes.
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({
  default: () => ({
    data: { metrics: { market_cap: '$1.2T' }, next_earnings: '2026-08-28', composite: 61 },
    isLoading: false,
  }),
}))
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
}))
vi.mock('../../../hooks/useThemeIndexBars', () => ({
  default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }),
}))
// null meta => the header label falls back to the raw ticker, so the identity
// label is assertable as "NVDA" in either the search or the static branch.
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: false, isPremarket: false, isExtended: false }),
}))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

import ChartPane from './ChartPane'

test('renders identity, timeframe bar and chart from props alone', () => {
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('NVDA')
  expect(screen.getByRole('button', { name: '1D' })).toBeTruthy()
  expect(screen.getByText('Market Cap')).toBeTruthy()
})

test('density="compact" drops the meta row and the session toggle, keeps identity + timeframes', () => {
  render(<ChartPane sym="NVDA" tf="D" density="compact" onTfChange={() => {}} />)
  expect(screen.queryByText('Market Cap')).toBeNull()
  expect(screen.queryByRole('group', { name: 'Chart session view' })).toBeNull()
  expect(screen.getByTestId('sym-label')).toBeTruthy()
  expect(screen.getByRole('button', { name: '1D' })).toBeTruthy()
})

test('omitting onSymbolChange renders a static, non-interactive label', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} />)
  expect(screen.getByTestId('sym-label')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /NVDA/ })).toBeNull()
})
