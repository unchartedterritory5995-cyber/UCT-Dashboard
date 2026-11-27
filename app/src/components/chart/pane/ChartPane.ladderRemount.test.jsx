// app/src/components/chart/pane/ChartPane.ladderRemount.test.jsx
//
// THE LADDER'S CLIP ANSWER SURVIVES A REMOUNT (2026-11-27, chart 2's paced mount on the owner's board). The one-row
// ladder's `isClipped` reads layout (`scrollWidth`) unless the row's signature (pane width, level, the row's and the
// timeframe strip's text / elements / classes: `rowFitSig`, no layout to compute) is the one it last read. That memory
// was the pane instance's, so every remount (a board return, a paced chart) forced a layout on a row identical in every
// part of the signature: about 6 ms of each pane mount, profiled. It is now kept per chart id beside `_ladderFits`.
//   R1 (red first) a remount of the same chart with the same header reads no layout
//   R2 a remount with another symbol (different text) reads again
//   R3 another chart id with the same header reads again (the answer is per chart)
//   R4 after the page's fonts finish loading (document.fonts 'loadingdone') a remount reads again
import { render, cleanup } from '@testing-library/react'
import { vi, test, expect, afterEach } from 'vitest'

const { fonts } = vi.hoisted(() => {
  const t = new EventTarget()
  Object.defineProperty(document, 'fonts', { configurable: true, value: t })
  return { fonts: t }
})

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
vi.mock('../../../hooks/useTickerMeta', () => ({ default: vi.fn(() => null) }))
vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: false, isPremarket: false, isExtended: false }),
}))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))


import ChartPane from './ChartPane'

const READS = { n: 0, on: false }
for (const p of ['scrollWidth', 'clientWidth']) {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, p)
  Object.defineProperty(Element.prototype, p, { configurable: true, get() { if (READS.on) READS.n++; return d.get.call(this) } })
}
afterEach(() => { cleanup(); READS.on = false; READS.n = 0 })

const noop = () => {}
const ONE_ROW = { identityDragClass: 'drag' }
function mountReads(props) {
  READS.n = 0
  READS.on = true
  const view = render(<ChartPane tf="D" onSymbolChange={noop} onTfChange={noop} slots={ONE_ROW} {...props} />)
  READS.on = false
  view.unmount()
  return READS.n
}

test('R1 (red first) a remount of the same chart with the same header reads no layout', () => {
  const first = mountReads({ chartId: 'r1-chart', sym: 'NVDA' })
  expect(first, 'NON-VACUITY: the first mount measures the header').toBeGreaterThan(0)
  expect(mountReads({ chartId: 'r1-chart', sym: 'NVDA' }), 'layout reads on a remount of an identical header').toBe(0)
})

test('R2 a remount with another symbol reads again', () => {
  mountReads({ chartId: 'r2-chart', sym: 'NVDA' })
  expect(mountReads({ chartId: 'r2-chart', sym: 'AMD' })).toBeGreaterThan(0)
})

test('R3 another chart id with the same header reads again', () => {
  mountReads({ chartId: 'r3-chart', sym: 'NVDA' })
  expect(mountReads({ chartId: 'r3-other', sym: 'NVDA' })).toBeGreaterThan(0)
})

test('R4 after the fonts finish loading a remount reads again', () => {
  mountReads({ chartId: 'r4-chart', sym: 'NVDA' })
  fonts.dispatchEvent(new Event('loadingdone'))
  expect(mountReads({ chartId: 'r4-chart', sym: 'NVDA' }), 'a fit measured before a font load reused after it').toBeGreaterThan(0)
})
