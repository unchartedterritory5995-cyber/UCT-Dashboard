// The chart pane for a currency pair (BTCUSD, dark behind the server switch CRYPTO_BARS_ENABLED).
//   * a stock asks nothing about pairs and is drawn as ever: its timeframe, the session switch,
//     the market clock, the stock day change;
//   * BTCUSD with the switch off (404) is drawn exactly like any other symbol;
//   * BTCUSD the server admits: the chart is handed the daily timeframe for an intraday one (and
//     W or M as asked), no live ticks, the daily-only warm-up and the pair's name; the stock
//     session switch and the market clock are gone; no company lookup is made for it; the header
//     shows the price with the SOURCE and that source's own time, and never says "live";
//   * a compact pane does not read the quote at all.
// Every price here is invented.
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { vi, test, expect, beforeEach, afterEach } from 'vitest'
import { SWRConfig } from 'swr'

const { stockChartSpy, metaSpy } = vi.hoisted(() => ({ stockChartSpy: vi.fn(), metaSpy: vi.fn(() => null) }))
vi.mock('../../StockChart', () => ({ default: (props) => { stockChartSpy(props); return <span data-testid="chart-sym">{props.sym}</span> } }))
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span /> }) }
})
vi.mock('../ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => <span data-testid="market-clock" /> }))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => <span data-testid="stock-day-gain" /> }))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({ default: () => <div data-testid="tf-menu" /> }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: (sym) => metaSpy(sym) }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: null }) }))

import ChartPane from './ChartPane'

const PAIRS = { source: 'FMP', pairs: [{ symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD' }] }
const QUOTE = { symbol: 'BTCUSD', source: 'FMP', state: 'fresh', price: 41234.5, change_pct: 1.2, as_of: 1794657600 }
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const no = (status) => ({ ok: false, status, json: async () => ({}) })
let routes
let fetchMock
beforeEach(() => {
  stockChartSpy.mockClear(); metaSpy.mockClear()
  routes = {}
  fetchMock = vi.fn(async (url) => (url in routes ? (typeof routes[url] === 'number' ? no(routes[url]) : ok(routes[url])) : no(404)))
  globalThis.fetch = fetchMock
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const urls = () => fetchMock.mock.calls.map(([u]) => String(u))
const crypto = () => urls().filter((u) => u.startsWith('/api/crypto/'))
const draw = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <ChartPane tf="60" stored={{ indicatorInstances: [] }} onStore={() => {}} onTfChange={() => {}} {...props} />
  </SWRConfig>,
)
const chart = () => stockChartSpy.mock.calls.at(-1)[0]
const sessionSwitch = () => screen.queryByRole('button', { name: 'Regular Hours' })

test('a stock asks nothing about pairs and keeps its timeframe, session switch and clock', async () => {
  draw({ sym: 'NVDA' })
  await new Promise((r) => setTimeout(r, 30))
  expect(crypto()).toEqual([])
  expect(chart().tf).toBe('60')
  expect(chart().breadthSeries).toBeUndefined()
  expect(chart().liveUpdates).not.toBe(false)
  expect(sessionSwitch()).not.toBeNull()
  expect(screen.queryByTestId('market-clock')).not.toBeNull()
  expect(screen.queryByTestId('chart-source-note')).toBeNull()
  expect(metaSpy).toHaveBeenCalledWith('NVDA')
})

test('the fund BTC is a stock here', async () => {
  draw({ sym: 'BTC' })
  await new Promise((r) => setTimeout(r, 30))
  expect(crypto()).toEqual([])
  expect(chart().tf).toBe('60')
  expect(screen.queryByTestId('chart-source-note')).toBeNull()
})

test('BTCUSD with the switch off is drawn like any other symbol, and the quote is never read', async () => {
  routes['/api/crypto/pairs'] = 404
  draw({ sym: 'BTCUSD' })
  await waitFor(() => expect(crypto()).toEqual(['/api/crypto/pairs']))
  await new Promise((r) => setTimeout(r, 30))
  expect(crypto()).toEqual(['/api/crypto/pairs'])
  expect(chart().tf).toBe('60')
  expect(chart().breadthSeries).toBeUndefined()
  expect(chart().liveUpdates).not.toBe(false)
  expect(sessionSwitch()).not.toBeNull()
  expect(screen.queryByTestId('market-clock')).not.toBeNull()
  expect(screen.queryByTestId('chart-source-note')).toBeNull()
  expect(metaSpy).toHaveBeenCalledWith('BTCUSD')
})

test('an admitted pair: daily bars for an intraday pane, no live ticks, no stock session, no clock', async () => {
  routes['/api/crypto/pairs'] = PAIRS
  routes['/api/crypto/quote/BTCUSD'] = QUOTE
  draw({ sym: 'BTCUSD' })
  await waitFor(() => expect(chart().breadthSeries).toBe(true))
  expect(chart().tf).toBe('D')
  expect(chart().liveUpdates).toBe(false)
  expect(chart().watermarkName).toBe('Bitcoin')
  expect(chart().barsOverride).toBeUndefined()            // /api/bars serves it; nothing is handed in
  expect(sessionSwitch()).toBeNull()
  expect(screen.queryByTestId('market-clock')).toBeNull()
  expect(screen.queryByTestId('stock-day-gain')).toBeNull()
  expect(screen.queryByTestId('tf-menu')).toBeNull()      // the intraday menu is not offered
  expect(metaSpy.mock.calls.at(-1)).toEqual([null])       // no company lookup for a pair
})

test('an admitted pair on a weekly pane is weekly', async () => {
  routes['/api/crypto/pairs'] = PAIRS
  routes['/api/crypto/quote/BTCUSD'] = QUOTE
  draw({ sym: 'BTCUSD', tf: 'W' })
  await waitFor(() => expect(chart().breadthSeries).toBe(true))
  expect(chart().tf).toBe('W')
})

test('the header shows the price with its source and the source\'s own time, and never says live', async () => {
  routes['/api/crypto/pairs'] = PAIRS
  routes['/api/crypto/quote/BTCUSD'] = QUOTE
  draw({ sym: 'BTCUSD' })
  const note = await screen.findByTestId('chart-source-note')
  await waitFor(() => expect(note.textContent).toBe('41,234.50 +1.20% · FMP, Nov 14, 7:00 AM ET'))
  expect(note.getAttribute('title')).toBe('Source: FMP, price as of Nov 14, 7:00 AM ET. Daily, weekly and monthly bars only, with a bar for every day of the week. The price is read again every 30 seconds.')
  expect(`${note.textContent} ${note.getAttribute('title')}`).not.toMatch(/\blive\b|real.?time|streaming/i)
  expect(note.getAttribute('style') || '').not.toMatch(/color|#[0-9a-f]{3}/i)
})

test('before a price arrives, and when none does, the header names the source and draws no number', async () => {
  routes['/api/crypto/pairs'] = PAIRS
  routes['/api/crypto/quote/BTCUSD'] = { symbol: 'BTCUSD', source: 'FMP', state: 'failed', price: null }
  draw({ sym: 'BTCUSD' })
  const note = await screen.findByTestId('chart-source-note')
  await waitFor(() => expect(crypto()).toContain('/api/crypto/quote/BTCUSD'))
  await new Promise((r) => setTimeout(r, 30))
  expect(note.textContent).toBe('FMP daily bars')
  expect(note.getAttribute('title')).toContain('Source: FMP.')
})

test('a compact pane is still a pair chart but does not read the quote', async () => {
  routes['/api/crypto/pairs'] = PAIRS
  routes['/api/crypto/quote/BTCUSD'] = QUOTE
  draw({ sym: 'BTCUSD', density: 'compact' })
  await waitFor(() => expect(chart().breadthSeries).toBe(true))
  await new Promise((r) => setTimeout(r, 30))
  expect(chart().tf).toBe('D')
  expect(chart().liveUpdates).toBe(false)
  expect(crypto()).toEqual(['/api/crypto/pairs'])
})
