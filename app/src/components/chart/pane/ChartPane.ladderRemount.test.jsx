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
//   R5 (red first, review of #2873) the signature is the row's CONTENT, not its sizes: an equal-length symbol (NVDA ->
//      MSFT) on the same chart reads again
//   R6 (red first) an equal-length class swap or a different icon changes the signature (rowFitSig over real elements)
//   R7 (red first) a theme change (an attribute on <html>) reads again
//   R8 (red first, delta review of #2873) a digits-only tick in the identity row (the day gain, the clock's seconds, its
//      beat) reads no layout: every live digit is tabular-nums, so a digit never changes a width; a sign flip or a
//      longer value still reads
//   R9 a symbol differing only in a digit (its label is not tabular) on the same chart reads again (`sym` and the
//      header label are part of the signature)
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
// the identity row's live text (a price tick, the clock's seconds, its beat), changed between renders by R8
const { LIVE } = vi.hoisted(() => ({ LIVE: { gain: '+1.23 (0.45%)', clock: '10:00:05', beat: '1' } }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({
  default: () => <span data-testid="market-clock" data-beat={LIVE.beat}>{LIVE.clock}</span>,
}))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({
  default: () => <span data-testid="day-gain">{LIVE.gain}</span>,
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


import ChartPane, { rowFitSig } from './ChartPane'

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

test('R5 (red first) an equal-length symbol on the same chart reads again', () => {
  mountReads({ chartId: 'r5-chart', sym: 'NVDA' })
  expect(mountReads({ chartId: 'r5-chart', sym: 'MSFT' }), 'MSFT reused the fit measured on NVDA').toBeGreaterThan(0)
})

test('R6 (red first) an equal-length class swap or another icon changes the row signature', () => {
  const mk = (html) => { const el = document.createElement('div'); el.innerHTML = html; return el }
  expect(rowFitSig(mk('<span class="aa">NVDA</span>'))).not.toBe(rowFitSig(mk('<span class="bb">NVDA</span>')))
  // another icon: a different shape (path commands). A change in digits alone (a coordinate, a size attribute) reads as
  // the same width by design (every live digit in the header is tabular-nums; its geometry attributes are constant)
  expect(rowFitSig(mk('<svg><path d="M0 0L9 9"></path></svg>'))).not.toBe(rowFitSig(mk('<svg><path d="M0 0H9V9"></path></svg>')))
  expect(rowFitSig(mk('<span class="aa">NVDA</span>'))).toBe(rowFitSig(mk('<span class="aa">NVDA</span>')))
})

test('R7 (red first) a theme change reads again', async () => {
  mountReads({ chartId: 'r7-chart', sym: 'NVDA' })
  document.documentElement.dataset.theme = 'light'
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  expect(mountReads({ chartId: 'r7-chart', sym: 'NVDA' }), 'a fit measured under another theme reused').toBeGreaterThan(0)
  delete document.documentElement.dataset.theme
})


test('R8 (red first) a digits-only tick reads no layout; a sign flip or a longer value reads', () => {
  const props = { chartId: 'r8-chart', sym: 'NVDA', tf: 'D', onSymbolChange: noop, onTfChange: noop, slots: ONE_ROW }
  const view = render(<ChartPane {...props} />)
  const rerenderReads = () => { READS.n = 0; READS.on = true; view.rerender(<ChartPane {...props} />); READS.on = false; return READS.n }
  expect(rerenderReads(), 'NON-VACUITY: an unchanged render reads nothing').toBe(0)
  Object.assign(LIVE, { gain: '+1.24 (0.46%)', clock: '10:00:06', beat: '2' })
  expect(rerenderReads(), 'a digits-only tick (price, clock, beat) read layout').toBe(0)
  LIVE.gain = '-1.24 (0.46%)'
  expect(rerenderReads(), 'a sign flip').toBeGreaterThan(0)
  LIVE.gain = '-10.24 (0.46%)'
  expect(rerenderReads(), 'a longer value').toBeGreaterThan(0)
  view.unmount()
  Object.assign(LIVE, { gain: '+1.23 (0.45%)', clock: '10:00:05', beat: '1' })
})

test('R9 a symbol differing only in a digit reads again on the same chart', () => {
  mountReads({ chartId: 'r9-chart', sym: 'X1Y' })
  expect(mountReads({ chartId: 'r9-chart', sym: 'X2Y' }), 'X2Y reused the fit measured on X1Y').toBeGreaterThan(0)
})
