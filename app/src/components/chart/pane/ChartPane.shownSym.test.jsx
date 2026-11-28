// ⭐⭐ THE HEADER FOLLOWS THE CANDLES (2026-11-27, owner on production: typing BL over REZI, the first frame showed the
// header "BL" over REZI's chart and watermark for a frame). The pane's header shows the symbol the chart last DREW
// (StockChart onSymbolPainted), the chart itself gets the committed one; a chart that never draws the new symbol shows
// it in the header after SHOWN_FALLBACK_MS anyway.
import { render, screen, cleanup, act } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'

const search = { props: [] }
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((p, ref) => { search.props.push(p); useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
const storeWarm = vi.fn()
const legacyWarm = vi.fn()
const lakeJoined = vi.fn(() => Promise.resolve(false))
vi.mock('../../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), warmTypedSymbol: (...a) => storeWarm(...a), lakeJoined: (...a) => lakeJoined(...a) }))
vi.mock('../../../utils/prefetchBars', async (orig) => ({ ...(await orig()), warmTypedSymbol: (...a) => legacyWarm(...a) }))
vi.mock('../barStoreSwitch', () => ({ BARSTORE: true }))
const chart = vi.hoisted(() => ({ props: [] }))
vi.mock('../../StockChart', () => ({ default: (p) => { chart.props.push(p); return <div data-testid="chart" /> } }))
vi.mock('../ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => <span /> }))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({ default: () => <div /> }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

import ChartPane, { SHOWN_FALLBACK_MS } from './ChartPane'

const headerSym = () => [...search.props].reverse().find((p) => typeof p.onTypedIntent === 'function')?.sym
const lastChart = () => chart.props[chart.props.length - 1]

beforeEach(() => { search.props.length = 0; chart.props.length = 0; storeWarm.mockClear(); legacyWarm.mockClear() })
afterEach(() => { cleanup(); vi.useRealTimers() })

const pane = (sym) => <ChartPane sym={sym} tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} onTypedIntent={vi.fn()} />

test('a committed symbol the chart has not drawn yet: the chart gets it, the header keeps the symbol on screen', () => {
  const view = render(pane('REZI'))
  expect(headerSym()).toBe('REZI')
  view.rerender(pane('BL'))
  expect(lastChart().sym).toBe('BL')                           // the chart is asked for BL...
  expect(headerSym()).toBe('REZI')                             // ...and the header still names the candles on screen
})

test('the chart draws it: the header follows in the same render pass', () => {
  const view = render(pane('REZI'))
  view.rerender(pane('BL'))
  expect(headerSym()).toBe('REZI')
  act(() => { lastChart().onSymbolPainted('BL') })
  expect(headerSym()).toBe('BL')
})

test('a chart that never draws the committed symbol: the header shows it after SHOWN_FALLBACK_MS', () => {
  vi.useFakeTimers()
  const view = render(pane('REZI'))
  view.rerender(pane('ZZZQ'))
  expect(headerSym()).toBe('REZI')
  act(() => { vi.advanceTimersByTime(SHOWN_FALLBACK_MS - 10) })
  expect(headerSym()).toBe('REZI')
  act(() => { vi.advanceTimersByTime(20) })
  expect(headerSym()).toBe('ZZZQ')
})

test('control: a series that never paints through a pass (an economic id) is shown at once', () => {
  const view = render(pane('REZI'))
  view.rerender(pane('ECON:USCPI'))
  expect(headerSym()).toBe('ECON:USCPI')
})
