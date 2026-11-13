// THE WIRES. `symbolResourceWarm.test.jsx` proves the warmer with stand-in resources; this file
// proves the two real header surfaces hold a resource while mounted, under THEIR OWN key, and
// that a member who then arrives on a warmed symbol sees the value on the first render: no
// blank frame, which is the whole point (measured before: header stats 240 to 540 ms after the
// candles, the split label 140 ms).
//
// Real SWR on the default cache, the real hooks, the real fetchers; only `fetch` is stood in.
// (The chart's own marker requests are covered where a chart is mounted:
// `components/StockChart.deskmarkers.test.jsx`.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, cleanup, waitFor } from '@testing-library/react'
import { cache as swrCache } from 'swr/_internal'
import { warmSymbolResources, __resetSymbolResourceWarm } from './symbolResourceWarm'
import useFundamentalSnapshot from '../hooks/useFundamentalSnapshot'
import { snapshotKey } from '../hooks/fundamentalSnapshotKey'
import useHeaderSnapshot from '../components/chart/pane/useHeaderSnapshot'
import AdjustmentLabel from '../components/chart/AdjustmentLabel'

vi.mock('../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: true, isPremarket: false, isExtended: false }),
}))

const NEAR = { priority: true }
let answers
let fetchSpy
const urls = () => fetchSpy.mock.calls.map((c) => String(c[0]))
const landed = (key) => waitFor(() => expect(swrCache.get(key)?.data).toBeDefined())

beforeEach(() => {
  __resetSymbolResourceWarm({ painted: true })
  answers = {}
  fetchSpy = vi.fn((url) => {
    const hit = answers[String(url)]
    return Promise.resolve(hit === undefined
      ? { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
      : { ok: true, status: 200, headers: { get: () => null }, json: async () => hit })
  })
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the chart header\'s stats (useHeaderSnapshot)', () => {
  it('⭐ while a header shows them, the rows ahead are asked for under the hook\'s own key, and arriving paints at once', async () => {
    answers['/api/research/snapshot/NVDA'] = { name: 'NVIDIA', composite: 91 }
    answers['/api/research/snapshot/AAPL'] = { name: 'Apple', composite: 77 }
    const seen = []
    const view = renderHook(({ sym }) => { const r = useHeaderSnapshot(sym, true); seen.push([sym, r.data]); return r },
      { initialProps: { sym: 'NVDA' } })
    await waitFor(() => expect(view.result.current.data).toEqual({ name: 'NVIDIA', composite: 91 }))

    expect(warmSymbolResources(['aapl'], 'D', NEAR), 'one resource is held: the snapshot').toBe(1)
    expect(urls()).toContain('/api/research/snapshot/AAPL')
    expect(snapshotKey('aapl')).toBe('/api/research/snapshot/AAPL')
    await landed('/api/research/snapshot/AAPL')

    const before = urls().length
    view.rerender({ sym: 'AAPL' })
    const first = seen.find(([sym]) => sym === 'AAPL')
    expect(first[1], 'the first render on the new symbol already has its stats').toEqual({ name: 'Apple', composite: 77 })
    await new Promise((r) => setTimeout(r, 80))
    expect(urls().length, 'and the arrival cost no second request').toBe(before)
  })

  it('what lands is what the hook\'s own fetcher would have produced (a paywalled answer stays absent)', async () => {
    answers['/api/research/snapshot/NVDA'] = { name: 'NVIDIA' }
    answers['/api/research/snapshot/AAPL'] = { paywalled: true }
    const view = renderHook(({ sym }) => useHeaderSnapshot(sym, true), { initialProps: { sym: 'NVDA' } })
    await waitFor(() => expect(view.result.current.data).toEqual({ name: 'NVIDIA' }))
    warmSymbolResources(['AAPL'], 'D', NEAR)
    await waitFor(() => expect(swrCache.get('/api/research/snapshot/AAPL')).toBeDefined())
    await waitFor(() => expect(swrCache.get('/api/research/snapshot/AAPL').data).toBeNull())
    view.rerender({ sym: 'AAPL' })
    expect(view.result.current.data).toBeNull()
  })

  it('⛔ a header that cannot show them (the hook disabled) holds nothing: no request for any row', async () => {
    const view = renderHook(({ on }) => useHeaderSnapshot('NVDA', on), { initialProps: { on: false } })
    expect(warmSymbolResources(['AAPL'], 'D', NEAR)).toBe(0)
    expect(urls()).toEqual([])
    view.rerender({ on: true })
    expect(warmSymbolResources(['AAPL'], 'D', NEAR), 'control: enabled, it is held').toBe(1)
    view.unmount()
    expect(warmSymbolResources(['MSFT'], 'D', NEAR), 'and released with the header').toBe(0)
  })

  it('the snapshot card on a page with no chart (the plain hook) holds nothing: only a chart header warms', async () => {
    answers['/api/research/snapshot/NVDA'] = { name: 'NVIDIA' }
    const view = renderHook(() => useFundamentalSnapshot('NVDA', true))
    await waitFor(() => expect(view.result.current.data).toEqual({ name: 'NVIDIA' }))
    expect(warmSymbolResources(['AAPL'], 'D', NEAR)).toBe(0)
    expect(urls()).toEqual(['/api/research/snapshot/NVDA'])
  })
})

describe('the split-adjustment label (AdjustmentLabel)', () => {
  const basis = (asOf) => ({ adjustment_basis: { splits: true, dividends: null, as_of: asOf, applied_by: 'vendor' } })

  it('⭐ the rows ahead are asked for at the LABEL\'s timeframe, and arriving shows the label at once', async () => {
    answers['/api/adjustment-basis/NVDA?tf=5'] = basis('2024-06-10')
    answers['/api/adjustment-basis/AAPL?tf=5'] = basis('2020-08-31')
    const view = render(<AdjustmentLabel sym="NVDA" tf="5" />)
    await screen.findByText('Split-adjusted · last split 2024-06-10')

    // the bars of the rows ahead may be warmed at any timeframe: the label asks at its own
    expect(warmSymbolResources(['AAPL'], 'W', NEAR)).toBe(1)
    expect(urls()).toContain('/api/adjustment-basis/AAPL?tf=5')
    await landed('/api/adjustment-basis/AAPL?tf=5')

    view.rerender(<AdjustmentLabel sym="AAPL" tf="5" />)
    // no await: the label is there in the same render as the symbol change
    expect(screen.getByTestId('adjustment-label').textContent).toBe('Split-adjusted · last split 2020-08-31')
  })

  it('a timeframe the label does not serve asks for no row either', () => {
    render(<AdjustmentLabel sym="NVDA" tf="240" />)
    expect(warmSymbolResources(['AAPL'], 'D', NEAR)).toBe(0)
    expect(urls()).toEqual([])
  })

  it('following the label to a new timeframe: the rows ahead are asked for at that one', async () => {
    answers['/api/adjustment-basis/NVDA?tf=D'] = basis('2024-06-10')
    answers['/api/adjustment-basis/NVDA?tf=W'] = basis('2024-06-10')
    const view = render(<AdjustmentLabel sym="NVDA" tf="D" />)
    view.rerender(<AdjustmentLabel sym="NVDA" tf="W" />)
    warmSymbolResources(['AAPL'], 'D', NEAR)
    expect(urls().filter((u) => u.includes('AAPL'))).toEqual(['/api/adjustment-basis/AAPL?tf=W'])
  })
})
