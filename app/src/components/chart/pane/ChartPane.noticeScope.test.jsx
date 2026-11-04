// app/src/components/chart/pane/ChartPane.noticeScope.test.jsx
//
// ⭐⭐ ONE PANE, ONE NOTICE SCOPE — FOR ITS BINDER AND FOR ITS STRIP.
//
// The bind-time notice stores are keyed by (scope, instance id) so a grid cell or
// a seeded widget drawing the same instance id on another symbol / timeframe never
// puts its notes in this pane's strip (`engine/__tests__/noticeScope.test.jsx`
// drives the binders). This file pins the WIRING the scope depends on: ChartPane
// hands StockChart (whose binder publishes under it) and its own
// AttachedPineDisclosures (which reads it) the SAME id, and two panes get two ids.
// The mock surface is ChartPane.test.jsx's, copied, so the pane renders as it does there.
import { render, screen, act, cleanup } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

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
import { setRuntimeErrorNotice, resetRuntimeErrorNotices } from '../engine/runtimeErrorNotice'

beforeEach(() => { mockPrefs = {}; stockChartSpy.mockClear(); resetRuntimeErrorNotices() })
afterEach(() => { cleanup(); resetRuntimeErrorNotices() })

const SAME_INSTANCE = { indicatorInstances: [{ instanceId: 'shared-1', defId: 'u_not_installed' }] }
const scopeOf = (sym) => {
  const calls = stockChartSpy.mock.calls.map(([p]) => p).filter((p) => p.sym === sym)
  return calls.length ? calls[calls.length - 1].noticeScope : undefined
}

test('two panes: each StockChart gets a non-empty notice scope, and they differ', () => {
  render(<>
    <ChartPane sym="NVDA" tf="D" onTfChange={() => {}} stored={SAME_INSTANCE} onStore={() => {}} />
    <ChartPane sym="AAPL" tf="60" onTfChange={() => {}} stored={SAME_INSTANCE} onStore={() => {}} />
  </>)
  const a = scopeOf('NVDA')
  const b = scopeOf('AAPL')
  expect(typeof a).toBe('string')
  expect(a.length).toBeGreaterThan(0)
  expect(typeof b).toBe('string')
  expect(a).not.toBe(b)
})

test('⛔ a note published under one pane scope shows in THAT pane strip only, though both list the instance', () => {
  render(<>
    <div data-testid="pane-a"><ChartPane sym="NVDA" tf="D" onTfChange={() => {}} stored={SAME_INSTANCE} onStore={() => {}} /></div>
    <div data-testid="pane-b"><ChartPane sym="AAPL" tf="60" onTfChange={() => {}} stored={SAME_INSTANCE} onStore={() => {}} /></div>
  </>)
  const strips = () => ({
    a: screen.getByTestId('pane-a').querySelector('[data-testid="pine-attached-disclosures"]'),
    b: screen.getByTestId('pane-b').querySelector('[data-testid="pine-attached-disclosures"]'),
  })
  expect(strips()).toEqual({ a: null, b: null })
  act(() => { setRuntimeErrorNotice('shared-1', 'stopped on chart A', scopeOf('NVDA')) })
  expect(strips().a && strips().a.textContent).toContain('stopped on chart A')
  expect(strips().b).toBeNull()
  act(() => { setRuntimeErrorNotice('shared-1', null, scopeOf('NVDA')) })
  expect(strips()).toEqual({ a: null, b: null })
})

test('StockChart hands its notice scope to the binder it creates (source rail: jsdom has no chart to bind)', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
  const creates = src.match(/createBinder\(\{ chart[^}]*\}\)/g) || []
  expect(creates.length).toBe(1)
  expect(creates[0]).toMatch(/scope:\s*binderNoticeScope/)
  expect(src).toMatch(/const binderNoticeScope = typeof noticeScope === 'string' && noticeScope \? noticeScope : ownNoticeScope/)
})
