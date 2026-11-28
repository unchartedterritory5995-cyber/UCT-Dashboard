// ⭐⭐ (2026-11-28, zero-network plan 1.4) THE PANE WARMS THE TYPED TEXT'S LIKELIEST COMPLETIONS. The symbol search reports
// them on every keystroke (SymbolSearch onTypedCandidates); the pane warms all of them (prefetch warmTypedCandidates) and
// gives the TOP one to its typed slot (the typed warm: linked charts, the hidden pane), the pool FIRST so its entry keeps
// the top candidate's fetch alive when the typed slot moves on. The same text told again (the search's own exact match)
// is one intent, not a second warm.
import { render, screen, cleanup } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'

const search = { props: [] }
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((p, ref) => { search.props.push(p); useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
const storeWarm = vi.fn()
const legacyWarm = vi.fn()
const lakeJoined = vi.fn(() => Promise.resolve(false))
const heldRows = vi.fn(() => 0)
const poolWarm = vi.fn()
vi.mock('../../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), warmTypedSymbol: (...a) => storeWarm(...a), warmTypedCandidates: (...a) => poolWarm(...a), lakeJoined: (...a) => lakeJoined(...a), heldRows: (...a) => heldRows(...a) }))
vi.mock('../../../utils/prefetchBars', async (orig) => ({ ...(await orig()), warmTypedSymbol: (...a) => legacyWarm(...a) }))
vi.mock('../barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../../StockChart', () => ({ default: () => <div data-testid="chart" /> }))
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

import ChartPane from './ChartPane'

const chartSearch = () => [...search.props].reverse().find((p) => typeof p.onTypedCandidates === 'function')
beforeEach(() => { search.props.length = 0; storeWarm.mockReset(); poolWarm.mockReset(); legacyWarm.mockReset() })
afterEach(() => { cleanup() })

test('every candidate list is warmed as a pool, the pool before the typed slot, and the top one takes the typed slot', async () => {
  const { COVER_ROWS } = await import('../../../data/barStore/coverRows')
  const seq = []
  poolWarm.mockImplementation((syms) => { seq.push(`pool:${syms.join(',')}`) })
  storeWarm.mockImplementation((s) => { seq.push(`typed:${s}`) })
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['AMZN', 'AMD', 'AMAT'])
  expect(seq).toEqual(['pool:AMZN,AMD,AMAT', 'typed:AMZN'])
  expect(poolWarm).toHaveBeenCalledWith(['AMZN', 'AMD', 'AMAT'], 'D')
  expect(storeWarm).toHaveBeenCalledWith('AMZN', 'D', expect.objectContaining({ cover: COVER_ROWS }))
})

test('the same top candidate is one intent: a new list re-warms the pool, the typed slot is not told again', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['CRBG', 'CRBN'])
  chartSearch().onTypedCandidates(['CRBG'])
  chartSearch().onTypedIntent('CRBG')            // the search's own exact match of the same text
  expect(poolWarm).toHaveBeenCalledTimes(2)
  expect(storeWarm).toHaveBeenCalledTimes(1)
  chartSearch().onTypedCandidates(['CRM', 'CRWD'])
  expect(storeWarm).toHaveBeenCalledTimes(2)
  expect(storeWarm).toHaveBeenLastCalledWith('CRM', 'D', expect.anything())
})

// (review of #2979) the same text re-typed after a TIMEFRAME change is a new key: warmed again, on the new timeframe
test('a re-type after a timeframe change warms the typed slot again, on the new timeframe', () => {
  const view = render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['AMZN'])
  chartSearch().onTypedIntent('AMZN')
  view.rerender(<ChartPane sym="NVDA" tf="5" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['AMZN'])
  chartSearch().onTypedIntent('AMZN')
  expect(storeWarm.mock.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(['AMZN D', 'AMZN 5'])
})

test('CONTROL: other text told through onTypedIntent still takes the typed slot', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['AMZN'])
  chartSearch().onTypedIntent('AMD')
  expect(storeWarm.mock.calls.map((c) => c[0])).toEqual(['AMZN', 'AMD'])
})
