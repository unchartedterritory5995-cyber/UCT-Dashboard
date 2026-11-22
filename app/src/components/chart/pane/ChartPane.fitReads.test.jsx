// app/src/components/chart/pane/ChartPane.fitReads.test.jsx
//
// ─── THE HEADER'S FIT CHECKS READ LAYOUT ONLY WHEN THE ROW CAN HAVE CHANGED (2026-11-21) ───────────────────
//
// The header sheds timeframes / abbreviates / steps its one-row ladder when it is clipped, measured with
// `scrollWidth > clientWidth` in layout effects that run on EVERY ChartPane render. Each read after a commit is a
// forced layout of the page, and a switch commits ChartPane many times: the post-paint trace on the owner's board
// (2026-11-21) found 62-78 forced layouts from the ladder's `clipped` over 8 switches, inside the switch task.
// Now each check reads layout only when the row's text / elements / classes (`rowFitSig`), the pane width or its own
// steps moved since the last read. This file pins: a ChartPane render that changes nothing in the header reads no
// layout; a symbol change (different text) still reads. Mutation-proved: the signature check removed (one-row ladder
// and the identity row, each restored from a saved copy).
import { render, cleanup } from '@testing-library/react'
import { vi, test, expect, afterEach } from 'vitest'

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

// count layout reads of the two properties the fit checks use
const READS = { n: 0, on: false }
for (const p of ['scrollWidth', 'clientWidth']) {
  const d = Object.getOwnPropertyDescriptor(Element.prototype, p)
  Object.defineProperty(Element.prototype, p, { configurable: true, get() { if (READS.on) READS.n++; return d.get.call(this) } })
}
afterEach(() => { cleanup(); READS.on = false; READS.n = 0 })

const noop = () => {}
function readsOn(fn) { READS.n = 0; READS.on = true; fn(); READS.on = false; return READS.n }

for (const [label, slots] of [['the one-row ladder (/charts integrated header)', { identityDragClass: 'drag' }], ['the identity row (two-row header)', undefined]]) {
  test(`${label}: a render that changes nothing in the header reads no layout; a new symbol does`, () => {
    let view
    const first = readsOn(() => { view = render(<ChartPane sym="NVDA" tf="D" onSymbolChange={noop} onTfChange={noop} slots={slots} />) })
    expect(first, 'NON-VACUITY: the first render measures the header').toBeGreaterThan(0)
    // a host re-render with new callback identities only: the header shows exactly the same
    const same = readsOn(() => { view.rerender(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} slots={slots} />) })
    expect(same, 'layout reads on a render that changed nothing in the header').toBe(0)
    // CONTROL: a symbol switch changes the row's text, so the fit is measured again
    const switched = readsOn(() => { view.rerender(<ChartPane sym="AMD" tf="D" onSymbolChange={noop} onTfChange={noop} slots={slots} />) })
    expect(switched, 'a new symbol re-measures').toBeGreaterThan(0)
  })
}
