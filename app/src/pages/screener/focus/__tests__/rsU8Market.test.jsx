// RS screens, unit U8, item D2: the market caution line. The server names one of three states
// from SPY and QQQ daily closes and sends it inside the saved-screens payload as
// `rs_market: { state, text, asof }` (only while the RS screens are on). On a screen whose
// starter has `row`, a state that is not `normal` draws ONE gold line above the list, in the
// server's words, which the member can hide for today. Nothing new is asked of the server.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { marketLineOf, readMarketHidden, writeMarketHidden, RS_MARKET_HIDDEN_KEY } from '../rsMarket'
import { RS_NOTE_PREF } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { PLAIN_STARTERS } from './rsScreensFixture'

// The two sentences the server sends (tests/test_rs_screens_u8_market.py holds them there).
const CAUTION = { state: 'caution', text: 'Leadership reverses hardest in rebounds after bear markets. Treat these lists as watchlists.', asof: '2026-11-13' }
const PRESSURE = { state: 'pressure', text: 'Market under pressure. Build the watchlist; breakouts fail more often.', asof: '2026-11-13' }
const NORMAL = { state: 'normal', text: '', asof: '2026-11-13' }

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  // the first-visit line is another gold line; these tests are about this one
  net.prefs = { [RS_NOTE_PREF]: '1' }
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const rowsIn = () => waitFor(() => screen.getByTestId('focus-row-NVDA'))
const line = () => screen.queryByTestId('rs-market')
const openScreen = async name => {
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
}
const savedReads = () => fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/screener/saved-screens')).length

describe('what is drawn for a payload', () => {
  test('caution and pressure draw the server\'s words; the key names the state and its session', () => {
    expect(marketLineOf(CAUTION)).toEqual({ state: 'caution', text: CAUTION.text, key: 'caution|2026-11-13' })
    expect(marketLineOf(PRESSURE)).toEqual({ state: 'pressure', text: PRESSURE.text, key: 'pressure|2026-11-13' })
    expect(marketLineOf({ ...PRESSURE, asof: undefined }).key).toBe('pressure|')
    expect(marketLineOf({ ...CAUTION, text: `  ${CAUTION.text} ` }).text).toBe(CAUTION.text)
  })
  test.each([
    ['normal', NORMAL],
    ['normal, even with words', { ...NORMAL, text: 'All clear' }],
    ['no state claimed (null)', null],
    ['a payload without the key', undefined],
    ['a state this client does not know', { ...CAUTION, state: 'panic' }],
    ['a state with no words', { ...CAUTION, text: '' }],
    ['a state with blank words', { ...CAUTION, text: '   ' }],
    ['words that are not text', { ...CAUTION, text: 7 }],
    ['a bare string', 'caution'],
    ['a list', [CAUTION]],
  ])('%s draws nothing', (_n, m) => { expect(marketLineOf(m)).toBeNull() })
})

describe('on the page', () => {
  test('caution: one gold line above the list on an RS screen, in the server\'s words', async () => {
    net.market = CAUTION
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(line()).toBeInTheDocument())
    expect(line()).toHaveTextContent(CAUTION.text)
    expect(line()).toHaveAttribute('data-state', 'caution')
    expect(screen.getAllByTestId('rs-market')).toHaveLength(1)
    // above the list: it comes before the results in the page
    const list = await screen.findByRole('listbox')
    expect(line().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // the first-visit line's own gold-bar style
    expect(line().className).toMatch(/note/)
    // read from the payload the page already fetches: one read, and no other request for it
    expect(savedReads()).toBe(1)
    expect(fetch.mock.calls.map(([u]) => String(u)).filter(u => /market/i.test(u))).toEqual([])
  })

  test('pressure draws its own sentence', async () => {
    net.market = PRESSURE
    pin(['starter_rs_top_rating'])
    mount()
    await landedOn('Top RS Rating')
    await waitFor(() => expect(line()).toHaveTextContent(PRESSURE.text))
    expect(line()).toHaveAttribute('data-state', 'pressure')
  })

  test.each([
    ['a normal market', NORMAL],
    ['no state claimed', null],
    ['a payload without the key (the screens are off)', undefined],
    ['a state the client does not know', { state: 'panic', text: 'Run', asof: '2026-11-13' }],
  ])('%s draws no line', async (_n, market) => {
    net.market = market
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await rowsIn()
    expect(line()).toBeNull()
  })

  test('a screen without `row` never shows it, whatever the market', async () => {
    net.market = CAUTION
    pin([PLAIN_STARTERS[0].id])
    mount()
    await landedOn(PLAIN_STARTERS[0].name)
    await rowsIn()
    expect(line()).toBeNull()
    // and opening an RS screen from there shows it
    await openScreen('UCT RS Leaders')
    await waitFor(() => expect(line()).toBeInTheDocument())
  })

  test('it stays above an empty RS list too', async () => {
    net.market = PRESSURE
    net.rows = []
    pin(['starter_rs_nh_before_price'])
    mount()
    await landedOn('RS New High Before Price')
    await waitFor(() => expect(screen.getByTestId('rs-empty')).toBeInTheDocument())
    expect(line()).toHaveTextContent(PRESSURE.text)
  })
})

describe('"Hide for today"', () => {
  test('hides the line, on this screen and on the next RS screen, and sends nothing to the server', async () => {
    net.market = CAUTION
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(line()).toBeInTheDocument())
    const before = fetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Hide for today' }))
    expect(line()).toBeNull()
    expect(sessionStorage.getItem(RS_MARKET_HIDDEN_KEY)).toBe('caution|2026-11-13')
    expect(fetch.mock.calls.slice(before).filter(([, o]) => o?.method === 'POST' && !String(o.body || '').includes('"filters"'))).toEqual([])
    await openScreen('Top RS Rating')
    await landedOn('Top RS Rating')
    await rowsIn()
    expect(line()).toBeNull()
  })

  test('a page opened again in the same tab keeps it hidden', async () => {
    writeMarketHidden('caution|2026-11-13')
    net.market = CAUTION
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await rowsIn()
    expect(line()).toBeNull()
  })

  test('the next session\'s line shows again, and so does a market that changed state', async () => {
    writeMarketHidden('caution|2026-11-13')
    net.market = { ...CAUTION, asof: '2026-11-16' }
    pin(['starter_rs_leaders'])
    const first = mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(line()).toHaveTextContent(CAUTION.text))
    first.unmount()
    net.market = PRESSURE                       // same session, another state
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(line()).toHaveTextContent(PRESSURE.text))
  })

  test('what is kept is one short string in this tab\'s storage, and a storage that refuses is survived', () => {
    expect(readMarketHidden()).toBe('')
    writeMarketHidden('pressure|2026-11-13')
    expect(readMarketHidden()).toBe('pressure|2026-11-13')
    expect(localStorage.length).toBe(0)
    const real = Storage.prototype.setItem
    const realGet = Storage.prototype.getItem
    try {
      Storage.prototype.setItem = () => { throw new Error('denied') }
      Storage.prototype.getItem = () => { throw new Error('denied') }
      expect(() => writeMarketHidden('x')).not.toThrow()
      expect(readMarketHidden()).toBe('')
    } finally {
      Storage.prototype.setItem = real
      Storage.prototype.getItem = realGet
    }
  })
})
