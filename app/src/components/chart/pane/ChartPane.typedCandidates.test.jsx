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

// (mutant C5 of #2979 survived the test above: its onTypedIntent re-told the text, so a top that never reset on the
// timeframe change went unseen) a PREFIX several tickers share ('AM') reaches the pane through the candidate list ONLY
// (the search tells onTypedIntent on an exact or unique match): its top must take the typed slot again on the new
// timeframe, so the pool's remembered top resets on a timeframe change, not only on a symbol change
test('a prefix re-typed after a timeframe change, told only as candidates, warms its top again on the new timeframe', () => {
  const view = render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['AMZN', 'AMD', 'AMAT'])
  view.rerender(<ChartPane sym="NVDA" tf="5" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['AMZN', 'AMD', 'AMAT'])
  expect(storeWarm.mock.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(['AMZN D', 'AMZN 5'])
  expect(poolWarm.mock.calls.map((c) => c[1])).toEqual(['D', '5'])
})

// (2026-11-28, after #2947: charts at any date) a chart the date box sent to a past date reads, on intraday, the window
// ending there: the pane gives the pool THAT window (chart/viewWindow viewWindowOfMemberDate of the member's date), so
// the candidates are warmed at the key the press will read; at the present, or on D/W/M, no window
test('at a date, the pool is given the window the chart reads there (intraday); none at the present or on D', async () => {
  const { PaintMemberContext } = await import('../paintLog')
  const { noteMemberDate } = await import('../viewDate')
  const member = {}
  const pane = (tf) => (
    <PaintMemberContext.Provider value={member}><ChartPane sym="NVDA" tf={tf} onTfChange={() => {}} onSymbolChange={vi.fn()} /></PaintMemberContext.Provider>
  )
  const view = render(pane('5'))
  chartSearch().onTypedCandidates(['AMZN', 'AMD'])
  expect(poolWarm.mock.calls.at(-1)[2]?.viewWindow ?? null).toBe(null)          // at the present: the plain key
  noteMemberDate(member, { rightMs: Date.UTC(2026, 9, 15, 12), width: 120, offset: 0, tf: '5' })
  chartSearch().onTypedCandidates(['AMZN', 'AMD', 'AMAT'])
  const vw = poolWarm.mock.calls.at(-1)[2]?.viewWindow
  expect(vw && new Date(vw.to * 1000).toISOString().slice(0, 10)).toBe('2026-10-15')
  view.rerender(pane('D'))
  chartSearch().onTypedCandidates(['AMZN'])
  expect(poolWarm.mock.calls.at(-1)[2]?.viewWindow ?? null).toBe(null)          // D at a date reads the plain key
  noteMemberDate(member, null)
})

test('CONTROL: other text told through onTypedIntent still takes the typed slot', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} onSymbolChange={vi.fn()} />)
  chartSearch().onTypedCandidates(['AMZN'])
  chartSearch().onTypedIntent('AMD')
  expect(storeWarm.mock.calls.map((c) => c[0])).toEqual(['AMZN', 'AMD'])
})
