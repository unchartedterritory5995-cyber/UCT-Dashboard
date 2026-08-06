import { render, screen, fireEvent } from '@testing-library/react'
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
// Wrapped in vi.fn() (not just a plain factory) so Task-1's new tests can
// assert on the call arguments (the enabled/disabled flag) without changing
// what it returns for the three pre-existing tests below.
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({
  default: vi.fn(() => ({
    data: { metrics: { market_cap: '$1.2T' }, next_earnings: '2026-08-28', composite: 61 },
    isLoading: false,
  })),
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
import useFundamentalSnapshot from '../../../hooks/useFundamentalSnapshot'

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

// --- Fix 1: fundamentals fetch is gated to when ChartMetaRow can actually render ---
// (Whole-branch review Finding 1: a compact pane fired the /api/research/snapshot
// request — and its 5-min poll loop — for a meta row that `compact` drops entirely.
// useFundamentalSnapshot(sym, enabled) is the real hook signature; ChartPane must
// pass `enabled=false` whenever the meta row can't render.)
test('density="compact" fetches fundamentals with enabled=false (no fetch storm for a row it never renders)', () => {
  useFundamentalSnapshot.mockClear()
  render(<ChartPane sym="NVDA" tf="D" density="compact" onTfChange={() => {}} />)
  expect(useFundamentalSnapshot).toHaveBeenCalledWith('NVDA', false)
})

test('density="full" (the /charts default) still fetches fundamentals with enabled=true', () => {
  useFundamentalSnapshot.mockClear()
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  expect(useFundamentalSnapshot).toHaveBeenCalledWith('NVDA', true)
})

// --- Fix 2: showTfBar / tfCodes make the timeframe lock symmetric with the symbol lock ---
// (Finding 2: omitting onTfChange left a full row of clickable-but-dead TF buttons,
// and visibleTfs always derived from the user's global favorites with no way for a
// host — e.g. Journal locked to Daily/Weekly — to override them.)
test('showTfBar={false} renders no timeframe bar at all', () => {
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} showTfBar={false} />)
  expect(screen.queryByRole('button', { name: '1D' })).toBeNull()
  expect(screen.queryByRole('button', { name: '1W' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'More timeframes' })).toBeNull()
})

test('tfCodes overrides the user\'s favorites to render exactly those timeframes', () => {
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} tfCodes={['D', 'W']} />)
  expect(screen.getByRole('button', { name: '1D' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '1W' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '1m' })).toBeNull()
  expect(screen.queryByRole('button', { name: '1h' })).toBeNull()
  expect(screen.queryByRole('button', { name: '1M' })).toBeNull()
})

// --- Fix 3: a locked pane must not swallow letter hotkeys belonging to the host page ---
// (Finding 3: with no onSymbolChange, a letter keydown still called preventDefault()
// + stopPropagation() before hitting a null searchRef and no-opping.)
test('with no onSymbolChange, a letter keydown on the chart surface is not intercepted', () => {
  const { container } = render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} />)
  const chartFill = container.querySelector('[tabindex="0"]')
  expect(chartFill).toBeTruthy()
  const notPrevented = fireEvent.keyDown(chartFill, { key: 'n', code: 'KeyN' })
  expect(notPrevented).toBe(true)
})

test('tfCodes locks the timeframe set: no overflow chevron to escape through', async () => {
  render(<ChartPane sym="NVDA" tf="D" tfCodes={['D', 'W']} onTfChange={() => {}} />)
  expect(await screen.findByRole('button', { name: '1D' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1W' })).toBeInTheDocument()
  // The lock is only real if there is no second way in. Without the chevron the
  // full TF_MENU is unreachable, so a host offering Daily/Weekly cannot have a
  // user land on 5m.
  expect(screen.queryByRole('button', { name: 'More timeframes' })).toBeNull()
  expect(screen.queryByRole('button', { name: '5m' })).toBeNull()
})

test('without tfCodes the overflow chevron is still there', async () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} />)
  expect(await screen.findByRole('button', { name: 'More timeframes' })).toBeInTheDocument()
})
