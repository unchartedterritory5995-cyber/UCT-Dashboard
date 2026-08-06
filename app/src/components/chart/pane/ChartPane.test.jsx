import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

// Same mock surface as the ChartWidget header rail (Task 1), re-based to this
// directory. Every path below resolves to the SAME module the widget rail mocks,
// so the two files describe one component tree from two entry points.
// `stockChartSpy` captures every prop StockChart is rendered with, so tests can
// assert on `settingsOverride` reaching the ACTUAL CHART, not just the chrome
// around it (the whole point of the settings-resolution fix). Declared via
// vi.hoisted so it's initialized before vi.mock's hoisted factory runs.
const { stockChartSpy } = vi.hoisted(() => ({ stockChartSpy: vi.fn() }))
vi.mock('../../StockChart', () => ({
  default: (props) => {
    stockChartSpy(props)
    return <div><span data-testid="chart-sym">{props.sym}</span></div>
  },
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
// Mutable so individual tests can shape `prefs` (in particular
// `charts_workspace_layout`) without re-mocking the module — mirrors the
// pattern in useChartSurfaceSettings.test.js. Reset to `{}` in beforeEach so
// pre-existing tests (which never touch this) see the same empty prefs as
// before.
let mockPrefs = {}
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref: () => {}, loading: false }),
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

beforeEach(() => {
  mockPrefs = {}
  stockChartSpy.mockClear()
})

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

// --- Owner-feedback Defect 2: density="mini" ---
// mini is for ~320px-tall popups (the Options Flow contract chart): only the
// timeframe bar and the chart render — no identity row (so no company name/
// logo/day-change/session toggle/clock), no meta row, no settings gear.
test('density="mini" renders the timeframe bar and the chart, but no identity row, meta row, clock, or gear', () => {
  render(<ChartPane sym="NVDA" tf="D" density="mini" onTfChange={() => {}} />)
  // Still there: the TF bar and the chart itself.
  expect(screen.getByRole('button', { name: '1D' })).toBeTruthy()
  expect(screen.getByTestId('chart-sym').textContent).toBe('NVDA')
  // Gone: identity row (the ticker/company label + its search affordance),
  // meta row, market clock, settings gear.
  expect(screen.queryByTestId('sym-label')).toBeNull()
  expect(screen.queryByText('Market Cap')).toBeNull()
  expect(screen.queryByTestId('market-clock')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Chart settings' })).toBeNull()
})

test('density="mini" fetches fundamentals with enabled=false (it never renders the meta row that needs them)', () => {
  useFundamentalSnapshot.mockClear()
  render(<ChartPane sym="NVDA" tf="D" density="mini" onTfChange={() => {}} />)
  expect(useFundamentalSnapshot).toHaveBeenCalledWith('NVDA', false)
})

// --- Owner-feedback Defect 1: the settings gear must not lie about being live ---
// A surface that IS the user's one chart (stored=null, no onStore) now reads
// its settings from the /charts workspace layout, so an edit made through this
// popup's gear would write the lower-priority global chart_settings pref and
// visibly do nothing. Hide the gear there; keep it wherever a real write sink
// exists (onStore, i.e. a /charts widget/tab).
test('stored={null} with no onStore renders no settings gear (a write here would silently no-op)', () => {
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} stored={null} />)
  expect(screen.queryByRole('button', { name: 'Chart settings' })).toBeNull()
})

test('onStore supplied (a /charts widget/tab) still renders the settings gear', () => {
  const onStore = vi.fn()
  render(
    <ChartPane
      sym="NVDA" tf="D"
      onSymbolChange={() => {}} onTfChange={() => {}}
      stored={null} onStore={onStore}
    />,
  )
  expect(screen.getByRole('button', { name: 'Chart settings' })).toBeTruthy()
})

// --- The chart-pane phase: the resolved settings must reach the CHART, not
// just the chrome around it. --------------------------------------------------
// Before this fix, ChartPane always passed `settingsOverride={stored || null}`
// to StockChart — on an own-chart surface (stored=null, no onStore, every
// popup) that is unconditionally null, so StockChart built its base from the
// untouched `chart_settings` seed even though the chrome (identity row/meta
// colors, via `cs`) already resolved from the /charts workspace layout. This
// is the whole point of the task: without it, the ACTUAL CHART — candles, MA
// overlays, background, watermark — renders the wrong (default) look while
// everything around it looks correct.
test('own-chart surface (stored=null, no onStore): StockChart receives settingsOverride equal to the workspace chart widget\'s blob', () => {
  mockPrefs = {
    chart_settings: { background: '#111111' },
    charts_workspace_layout: {
      widgets: [
        { id: 'w-watch', type: 'watchlist', opts: {} },
        { id: 'w-chart', type: 'chart', opts: { settings: { background: '#abc123', preset: 'custom' } } },
      ],
    },
  }
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  expect(stockChartSpy).toHaveBeenCalled()
  const lastCall = stockChartSpy.mock.calls.at(-1)[0]
  expect(lastCall.settingsOverride).toEqual({ background: '#abc123', preset: 'custom' })
})

test('own-chart surface with no distinctive workspace settings: StockChart receives settingsOverride=null (its own chart_settings-seeded base is already correct)', () => {
  mockPrefs = { chart_settings: { background: '#111111' } }
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  const lastCall = stockChartSpy.mock.calls.at(-1)[0]
  expect(lastCall.settingsOverride).toBeNull()
})

// --- /charts is unaffected: a widget/tab surface (stored + onStore) keeps
// getting exactly its own `stored` blob, ignoring the workspace layout
// entirely — even when that layout would otherwise resolve to something else.
test('/charts widget surface (stored + onStore): StockChart still receives the stored blob, workspace layout ignored', () => {
  mockPrefs = {
    chart_settings: { background: '#111111' },
    charts_workspace_layout: {
      widgets: [{ id: 'w-chart', type: 'chart', opts: { settings: { background: '#should-not-be-used' } } }],
    },
  }
  const onStore = vi.fn()
  const storedBlob = { background: '#mywidget' }
  render(
    <ChartPane
      sym="NVDA" tf="D"
      onSymbolChange={() => {}} onTfChange={() => {}}
      stored={storedBlob} onStore={onStore}
    />,
  )
  const lastCall = stockChartSpy.mock.calls.at(-1)[0]
  expect(lastCall.settingsOverride).toBe(storedBlob)
})
