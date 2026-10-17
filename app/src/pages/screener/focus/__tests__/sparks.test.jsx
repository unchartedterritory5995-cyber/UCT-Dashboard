import { render, screen, waitFor } from '@testing-library/react'
import { vi, afterEach, beforeEach, expect, test } from 'vitest'
import ResultList from '../ResultList'
import { BATCH, _resetSparkCache } from '../useSparks'

const row = t => ({ ticker: t, price: 10, chg_pct_1d: 1, base_render: 'Flat Base', vol_ratio: 1 })
const props = rows => ({ rows, index: 0, onSelect: vi.fn(), onKeyDown: vi.fn(), livePrices: {}, radar: new Set(), sortLabel: 'RS rank', total: rows.length, hasMore: false, onLoadMore: vi.fn(), isLoading: false })
const answer = tickers => ({ ok: true, json: async () => ({ sessions: 63, sparks: Object.fromEntries(tickers.map(t => [t, { c: [1, 2, 3], asof: 20261015 }])) }) })
const asked = url => decodeURIComponent(new URL(url, 'http://x').searchParams.get('tickers')).split(',')

beforeEach(() => { _resetSparkCache() })
afterEach(() => { vi.unstubAllGlobals() })

test('each row draws its 3-month line once the closes arrive', async () => {
  const fetchMock = vi.fn(async url => answer(asked(url)))
  vi.stubGlobal('fetch', fetchMock)
  render(<ResultList {...props([row('AAA'), row('BBB')])} />)
  await waitFor(() => expect(screen.getByTestId('focus-row-AAA').querySelector('svg')).not.toBeNull())
  expect(screen.getByTestId('focus-row-BBB').querySelector('svg')).not.toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/screener\/sparks\?tickers=/)
})

test('a long list is asked for in batches the endpoint accepts', async () => {
  const fetchMock = vi.fn(async url => answer(asked(url)))
  vi.stubGlobal('fetch', fetchMock)
  const rows = Array.from({ length: BATCH + 5 }, (_, i) => row(`T${i}`))
  render(<ResultList {...props(rows)} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(asked(fetchMock.mock.calls[0][0])).toHaveLength(BATCH)
  expect(asked(fetchMock.mock.calls[1][0])).toHaveLength(5)
})

test('a failed answer draws no line and breaks nothing', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  render(<ResultList {...props([row('AAA')])} />)
  await new Promise(r => setTimeout(r, 0))
  expect(screen.getByTestId('focus-row-AAA')).toHaveTextContent('10.00')
  expect(screen.getByTestId('focus-row-AAA').querySelector('svg')).toBeNull()
})

test('names already answered are not asked for again', async () => {
  const fetchMock = vi.fn(async url => answer(asked(url)))
  vi.stubGlobal('fetch', fetchMock)
  const { rerender } = render(<ResultList {...props([row('AAA')])} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  rerender(<ResultList {...props([row('AAA'), row('BBB')])} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(asked(fetchMock.mock.calls[1][0])).toEqual(['BBB'])
})
