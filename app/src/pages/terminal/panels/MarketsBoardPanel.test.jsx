// MKTS: the markets board (index funds, volatility, Treasury yields, Bitcoin). Rails:
//   * loading, a failed read (error with Retry), signed out, a snapshot with no price at all: none
//     is drawn as a flat market;
//   * each group carries its own as-of: the snapshot the time this screen read it, the yields the
//     curve's date, Bitcoin the quote's own time; the header reports one of them;
//   * a leg with no price is named in words and never drawn as 0; a source that does not answer
//     says so in its own group while the other groups still draw;
//   * the snapshot is read again every 30 seconds; the yields are not polled faster than RATES;
//   * funds are symbol links, the yields rows open RATES, `BTC` is never a link (only BTCUSD is);
//   * the board never says "live"; no hard-coded color; axe.
// Every number is invented; the fixtures are the routes' real shapes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { useEffect } from 'react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import MarketsBoardPanel from './MarketsBoardPanel'
import { MKTS_CODE, MKTS_RATES_HELD_POLL_MS, MKTS_RATES_WARMING_POLL_MS, MKTS_SNAPSHOT_SOURCE } from './marketsBoardModel'
import { RATES_URL, SOURCE as RATES_SOURCE } from './ratesModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SNAP_URL = '/api/snapshot'
const PAIRS_URL = '/api/crypto/pairs'
const QUOTE_URL = '/api/crypto/quote/BTCUSD'
const DASH = '—'
/** The instant every read in this file "arrives" (2:32 PM New York time). */
const NOW = '2026-11-19T19:32:00.000Z'

const SNAP = {
  etfs: {
    SPY: { price: '645.12', chg: '+0.43%', css: 'pos' }, QQQ: { price: '560.40', chg: '-0.21%', css: 'neg' },
    IWM: { price: '231.07', chg: '0.00%', css: '' }, DIA: { price: '448.90', chg: '+0.10%', css: 'pos' },
    VIX: { price: '17.20', chg: '-3.10%', css: 'neg' },
  },
  futures: { BTC: { price: '67,123.45', chg: '-1.20%', css: 'neg' } },
}
const DASHES = {
  etfs: Object.fromEntries(['SPY', 'QQQ', 'IWM', 'DIA', 'VIX'].map((s) => [s, { price: DASH, chg: DASH }])),
  futures: { BTC: { price: DASH, chg: DASH } },
}
const H = (d1) => ({ d1, w1: null, m1: null, m3: null, y1: null })
const mat = (key, label, y, d1) => ({ key, label, months: 1, yield: y, was: H(null), change_bp: H(d1) })
const CURVE = {
  status: 'ok', as_of: '2026-11-17', read_at: '2026-11-17T23:20:04+00:00', basis: 'end_of_day', source: RATES_SOURCE, check: null,
  maturities: [mat('1m', '1-month', 4.4, 1), mat('3m', '3-month', 4.3, -1), mat('2y', '2-year', 3.7, 0), mat('10y', '10-year', 4.12, 7), mat('30y', '30-year', 4.7, null)],
  spreads: [], history: { dates: [] },
}
const PAIRS = { pairs: [{ symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD' }], source: 'FMP' }
const QUOTE = { symbol: 'BTCUSD', name: 'Bitcoin', price: 67250.5, change_pct: 1.234, as_of: Date.UTC(2026, 10, 19, 19, 30) / 1000, source: 'FMP', state: 'fresh' }

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each route its body (an Error is thrown, PENDING never answers); anything else is a 404,
 *  which is what the crypto routes answer while they are switched off. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.reject(fail(404))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
/** The snapshot and the curve answer; Bitcoin's quote route is off. */
const BASE = { [SNAP_URL]: SNAP, [RATES_URL]: CURVE }
/** Everything answers, the quote route included. */
const FULL = { ...BASE, [PAIRS_URL]: PAIRS, [QUOTE_URL]: QUOTE }
const calls = () => jsonFetcher.mock.calls.map(([url]) => url)
const timesAsked = (url) => calls().filter((u) => u === url).length

let revalidateAll = async () => {}
function Revalidator() {
  const { mutate } = useSWRConfig()
  useEffect(() => { revalidateAll = () => mutate(() => true) }, [mutate])
  return null
}

function renderPanel({ setFreshness = vi.fn(), open = vi.fn(), run = vi.fn(), code = null } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Revalidator />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><MarketsBoardPanel /></TerminalPanelContext.Provider>
            : <MarketsBoardPanel />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, open, run, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-mkts')
const text = (id) => screen.getByTestId(id).textContent
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
const rateRows = () => screen.getAllByTestId('terminal-mkts-rate')

beforeEach(() => {
  jsonFetcher.mockReset()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) })           // only the clock: timers stay real
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('MKTS states', () => {
  it('shows a loading skeleton while the snapshot is read, and again while only the yields are still out', async () => {
    serve({ [SNAP_URL]: PENDING, [RATES_URL]: PENDING })
    renderPanel()
    expect(MKTS_CODE).toBe('MKTS')
    expect(screen.getByTestId('terminal-mkts-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-mkts')).toBeNull()
    cleanup()
    serve({ [SNAP_URL]: fail(500), [RATES_URL]: PENDING })
    renderPanel()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('terminal-mkts-loading')).toBeTruthy()       // not an error yet: one source may still answer
    expect(screen.queryByTestId('terminal-mkts-error')).toBeNull()
  })

  it('every read failing is an error with Retry, never an empty or flat board', async () => {
    serve({ [SNAP_URL]: fail(500), [RATES_URL]: fail(500) })
    const { setFreshness } = renderPanel({ code: 'MKTS' })
    const err = await screen.findByTestId('terminal-mkts-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The markets board could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no prices. Retry, or run MKTS again.')
    expect(screen.queryByTestId('terminal-mkts-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve(BASE)
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-mkts-table')).toBeTruthy()
    expect(rateRows()).toHaveLength(4)
    expect(root().getAttribute('data-state')).toBe('ok')
  })

  it('signed out says so for the whole board; a timeout says so and can be retried', async () => {
    serve({ [SNAP_URL]: fail(401), [RATES_URL]: fail(401) })
    renderPanel()
    const out = await screen.findByTestId('terminal-mkts-error')
    expect(out.getAttribute('data-kind')).toBe('locked')
    expect(out.textContent).toContain('You are signed out, so the markets board cannot be read. Sign in again.')
    expect(within(out).queryByRole('button')).toBeNull()
    cleanup()
    serve({ [SNAP_URL]: fail(0, { timedOut: true }), [RATES_URL]: fail(500) })
    renderPanel()
    const slow = await screen.findByTestId('terminal-mkts-error')
    expect(slow.getAttribute('data-kind')).toBe('error')
    expect(slow.textContent).toContain('The markets board did not answer within 30 seconds.')
    expect(within(slow).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('an answer that is not the snapshot\'s shape is a failed read, not an empty board', async () => {
    serve({ [SNAP_URL]: { detail: 'nope' }, [RATES_URL]: fail(500) })
    renderPanel()
    const err = await screen.findByTestId('terminal-mkts-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The markets board could not be read just now.')
    expect(screen.queryByTestId('terminal-mkts-none')).toBeNull()
  })

  it('a snapshot with no price at all, and nothing else to show, says so: a missing read, not a flat market', async () => {
    serve({ [SNAP_URL]: DASHES, [RATES_URL]: fail(402) })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-mkts-none')
    expect(root().getAttribute('data-state')).toBe('none')
    expect(box.getAttribute('data-kind')).toBe('empty')
    expect(box.textContent).toContain('The market snapshot came back with no prices.')
    expect(box.textContent).toContain('Not one index fund, VIX or Bitcoin price was in this read. That is a missing read, not a flat market.')
    expect(screen.queryByTestId('terminal-mkts-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve(BASE)
    fireEvent.click(within(box).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-mkts-group-funds')).toBeTruthy()
  })
})

describe('MKTS the board', () => {
  it('reads the snapshot, the Treasury curve and the list of pairs, each once, and nothing else', async () => {
    serve(BASE)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect([...new Set(calls())].sort()).toEqual([PAIRS_URL, RATES_URL, SNAP_URL].sort())
    expect([timesAsked(SNAP_URL), timesAsked(RATES_URL), timesAsked(PAIRS_URL)]).toEqual([1, 1, 1])
    expect(timesAsked(QUOTE_URL)).toBe(0)               // the quote route is off (404): its quote is never asked for
  })

  it('draws only the groups the data has, in order, each with its own as-of', async () => {
    serve(BASE)
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(root().getAttribute('data-state')).toBe('ok')
    expect([...screen.getByTestId('terminal-mkts-table').querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Market', 'Last', 'Change'])
    expect([...screen.getByTestId('terminal-mkts-table').querySelectorAll('tbody')].map((b) => b.getAttribute('data-testid')))
      .toEqual(['terminal-mkts-group-funds', 'terminal-mkts-group-vol', 'terminal-mkts-group-rates', 'terminal-mkts-group-crypto'])
    expect(text('terminal-mkts-head-funds')).toBe('Index funds (prices read 2:32 PM ET)')
    expect(text('terminal-mkts-head-vol')).toBe('Volatility (prices read 2:32 PM ET)')
    expect(text('terminal-mkts-head-rates')).toBe('Rates (as of Nov 17, 2026, a daily figure)')
    expect(text('terminal-mkts-head-crypto')).toBe('Crypto (Source: Yahoo Finance, prices read 2:32 PM ET)')
    // the header reports the snapshot: its source and the instant this screen read it
    expect(lastReport(setFreshness)).toEqual({ source: MKTS_SNAPSHOT_SOURCE, observedAt: NOW, age: { asOfDate: 'Nov 19, 2:32 PM ET' } })
    // no commodities, futures or dollar group: the data holds none
    expect(root().textContent).not.toMatch(/Commodities|Gold|Crude|Dollar index/)
  })

  it('each fund: its ticker and name, the last price and the day\'s percent change as the source gave them', async () => {
    serve(BASE)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    const row = (sym) => {
      const tr = screen.getByTestId(`terminal-mkts-row-${sym}`)
      return [tr.querySelector('th').textContent, text(`terminal-mkts-row-${sym}-last`), text(`terminal-mkts-row-${sym}-chg`), tr.getAttribute('data-priced')]
    }
    expect(row('SPY')).toEqual(['SPY S&P 500 ETF', '645.12', '+0.43%', 'yes'])
    expect(row('QQQ')).toEqual(['QQQ Nasdaq 100 ETF', '560.40', '-0.21%', 'yes'])
    expect(row('IWM')).toEqual(['IWM Russell 2000 ETF', '231.07', '0.00%', 'yes'])
    expect(row('DIA')).toEqual(['DIA Dow 30 ETF', '448.90', '+0.10%', 'yes'])
    expect(row('VIX')).toEqual(['VIX, the volatility index', '17.20', '-3.10%', 'yes'])
    expect(row('BTC')).toEqual(['Bitcoin', '67,123.45', '-1.20%', 'yes'])
    expect([...screen.getByTestId('terminal-mkts-group-funds').querySelectorAll('tr[data-priced]')].map((tr) => tr.getAttribute('data-testid')))
      .toEqual(['SPY', 'QQQ', 'IWM', 'DIA'].map((s) => `terminal-mkts-row-${s}`))
  })

  it('green and red follow the sign of a price change; a flat change and a yield change carry neither', async () => {
    serve(BASE)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    const span = (id) => screen.getByTestId(id).querySelector('span')
    expect(span('terminal-mkts-row-SPY-chg').className).toMatch(/up/)
    expect(span('terminal-mkts-row-QQQ-chg').className).toMatch(/down/)
    expect(span('terminal-mkts-row-IWM-chg').className || '').not.toMatch(/up|down/)
    for (const tr of rateRows()) expect(within(tr).getByTestId('terminal-mkts-rate-chg').querySelector('span').className || '').not.toMatch(/up|down/)
  })

  it('the yields rows: maturity, yield and the day\'s change in basis points; no figure reads n/a', async () => {
    serve(BASE)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(rateRows().map((tr) => [tr.getAttribute('data-key'), tr.querySelector('th').textContent,
      within(tr).getByTestId('terminal-mkts-rate-yield').textContent, within(tr).getByTestId('terminal-mkts-rate-chg').textContent])).toEqual([
      ['3m', '3-month Treasury', '4.30%', '-1 bp'], ['2y', '2-year Treasury', '3.70%', '0 bp'], ['10y', '10-year Treasury', '4.12%', '+7 bp'],
      ['30y', '30-year Treasury', '4.70%', 'n/a'],
    ])
  })

  it('a leg with no price is named in words above the table and in its own row, never drawn as 0', async () => {
    serve({ ...BASE, [SNAP_URL]: { etfs: { ...SNAP.etfs, IWM: { price: DASH, chg: DASH }, VIX: { price: '0', chg: '0.00%' } }, futures: SNAP.futures } })
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(root().getAttribute('data-state')).toBe('ok')
    expect(text('terminal-mkts-missing')).toBe('No price for IWM and VIX in this read. That is a missing price, not a zero.')
    for (const sym of ['IWM', 'VIX']) {
      const tr = screen.getByTestId(`terminal-mkts-row-${sym}`)
      expect(tr.getAttribute('data-priced')).toBe('no')
      expect(tr.querySelector('td').textContent).toBe('No price right now')
      expect(screen.queryByTestId(`terminal-mkts-row-${sym}-last`)).toBeNull()
      expect([...tr.querySelectorAll('td')].map((td) => td.textContent).join('')).not.toMatch(/\d/)
    }
    expect(text('terminal-mkts-row-SPY-last')).toBe('645.12')
    expect(screen.getByTestId('terminal-mkts-table').textContent).not.toContain(DASH)
  })

  it('a price with no change says n/a for the change', async () => {
    serve({ ...BASE, [SNAP_URL]: { etfs: { ...SNAP.etfs, DIA: { price: '448.90', chg: DASH } }, futures: SNAP.futures } })
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(text('terminal-mkts-row-DIA-last')).toBe('448.90')
    expect(text('terminal-mkts-row-DIA-chg')).toBe('n/a')
    expect(screen.queryByTestId('terminal-mkts-missing')).toBeNull()
  })

  it('says what each column is and is not, and never says "live"', async () => {
    serve(FULL)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    const method = text('terminal-mkts-method')
    expect(method).toContain('Each fund\'s price is the fund\'s own, not the index level it tracks.')
    expect(method).toContain('the snapshot carries no change in points and no time of its own, so its as-of is when this screen read it')
    expect(method).toContain('This board has no index futures, gold, oil or dollar rows: those prices are not in the data it reads.')
    expect(method).toContain('a yield change carries no color')
    expect(root().textContent).not.toMatch(/\blive\b|real[- ]time/i)
    expect(root().textContent).not.toMatch(/—|–/)
  })
})

describe('MKTS a source that does not answer says so', () => {
  it('the snapshot failing leaves the yields on screen, says which prices are missing, and Retry asks again', async () => {
    serve({ [SNAP_URL]: fail(503), [RATES_URL]: CURVE })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(root().getAttribute('data-state')).toBe('partial')
    expect(text('terminal-mkts-snapshot-failed')).toContain('Index fund, VIX and Bitcoin prices could not be read just now. That is not the same as no prices.')
    expect(screen.queryByTestId('terminal-mkts-group-funds')).toBeNull()
    expect(screen.queryByTestId('terminal-mkts-group-vol')).toBeNull()
    expect(screen.queryByTestId('terminal-mkts-group-crypto')).toBeNull()
    expect(rateRows()).toHaveLength(4)
    // the header reports the curve, with the curve's own date
    expect(lastReport(setFreshness)).toEqual({ source: RATES_SOURCE, age: { asOfDate: '2026-11-17' } })
    serve(BASE)
    fireEvent.click(screen.getByTestId('terminal-mkts-snapshot-retry'))
    expect(await screen.findByTestId('terminal-mkts-group-funds')).toBeTruthy()
    expect(screen.queryByTestId('terminal-mkts-snapshot-failed')).toBeNull()
    expect(root().getAttribute('data-state')).toBe('ok')
  })

  it('a snapshot with no price at all still shows the yields and says the prices are missing', async () => {
    serve({ [SNAP_URL]: DASHES, [RATES_URL]: CURVE })
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(root().getAttribute('data-state')).toBe('partial')
    expect(text('terminal-mkts-snapshot-failed')).toContain('The market snapshot came back with no index fund, VIX or Bitcoin price. That is not the same as no prices.')
    expect(screen.queryByTestId('terminal-mkts-group-funds')).toBeNull()
    expect(rateRows()).toHaveLength(4)
  })

  it('the yields: loading, a failed read with Retry, no paid plan and signed out each say so in the Rates group', async () => {
    serve({ [SNAP_URL]: SNAP, [RATES_URL]: PENDING })
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(text('terminal-mkts-rates-loading')).toBe('Loading Treasury yields.')
    expect(text('terminal-mkts-head-rates')).toBe('Rates')                 // no as-of without a curve
    expect(text('terminal-mkts-row-SPY-last')).toBe('645.12')
    cleanup()

    serve({ [SNAP_URL]: SNAP, [RATES_URL]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-mkts-rates-error')
    expect(text('terminal-mkts-rates-error')).toContain('Treasury yields could not be read just now.')
    expect(screen.queryAllByTestId('terminal-mkts-rate')).toHaveLength(0)
    expect(root().getAttribute('data-state')).toBe('ok')
    serve(BASE)
    fireEvent.click(screen.getByTestId('terminal-mkts-rates-retry'))
    expect(await screen.findAllByTestId('terminal-mkts-rate')).toHaveLength(4)
    cleanup()

    for (const [err, words] of [[fail(402), 'Treasury yields needs a paid plan.'], [fail(404), 'Treasury yields is not switched on for this server yet.']]) {
      serve({ [SNAP_URL]: SNAP, [RATES_URL]: err })
      renderPanel()
      await screen.findByTestId('terminal-mkts-rates-error')
      expect(text('terminal-mkts-rates-error').trim(), words).toBe(words)
      expect(screen.queryByTestId('terminal-mkts-rates-retry')).toBeNull()
      expect(text('terminal-mkts-row-SPY-last')).toBe('645.12')
      cleanup()
    }
  })

  it('the yields still being built by the server say so and fill in on their own', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async (url) => {
      if (url === SNAP_URL) return SNAP
      if (url !== RATES_URL) throw fail(404)
      n += 1
      return n === 1 ? { status: 'computing' } : CURVE
    })
    renderPanel()
    const working = await screen.findByTestId('terminal-mkts-rates-computing')
    expect(working.textContent).toBe('The server is reading Treasury yields from the Treasury\'s website. This fills in on its own; that is not the same as no figures.')
    expect(MKTS_RATES_WARMING_POLL_MS).toBe(3000)
    expect(MKTS_RATES_HELD_POLL_MS).toBe(30 * 60 * 1000)
    // no click: the panel asks again by itself
    expect(await screen.findAllByTestId('terminal-mkts-rate', {}, { timeout: 6000 })).toHaveLength(4)
    expect(n).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('a Treasury website that refuses the server, and an answer that is not the curve, each say so', async () => {
    serve({ [SNAP_URL]: SNAP, [RATES_URL]: { status: 'unavailable', reason: 'refused', http_status: 403 } })
    renderPanel()
    await screen.findByTestId('terminal-mkts-rates-unavailable')
    expect(text('terminal-mkts-rates-unavailable')).toBe('Treasury yields are not available right now: the Treasury\'s website refused the server\'s request (it answered 403).')
    cleanup()
    serve({ [SNAP_URL]: SNAP, [RATES_URL]: { status: 'failed', reason: 'source', http_status: 503 } })
    renderPanel()
    await screen.findByTestId('terminal-mkts-rates-error')
    expect(text('terminal-mkts-rates-error')).toContain('Treasury yields could not be read just now.')
    expect(screen.getByTestId('terminal-mkts-rates-retry')).toBeTruthy()
    expect(screen.queryAllByTestId('terminal-mkts-rate')).toHaveLength(0)
  })

  it('a failed re-read of the snapshot keeps the last prices on screen and says how old they are', async () => {
    serve(BASE)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    serve({ [RATES_URL]: CURVE, [SNAP_URL]: fail(500) })
    await act(async () => { await revalidateAll() })
    const note = await screen.findByTestId('terminal-mkts-stale-read')
    expect(note.textContent).toBe('The market snapshot could not be read just now. Showing the last read: prices read 2:32 PM ET.')
    expect(text('terminal-mkts-row-SPY-last')).toBe('645.12')
    expect(screen.queryByTestId('terminal-mkts-snapshot-failed')).toBeNull()
  })
})

describe('MKTS Bitcoin', () => {
  it('with the quote route off it is the snapshot\'s price, in plain text: BTC alone is never a link', async () => {
    serve(BASE)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    const group = screen.getByTestId('terminal-mkts-group-crypto')
    expect(group.getAttribute('data-from')).toBe('snapshot')
    expect(within(group).queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('panel-symbol-BTC')).toBeNull()
    expect(screen.queryByTestId('panel-symbol-BTCUSD')).toBeNull()
    expect(screen.queryByTestId('terminal-mkts-btc-fallback')).toBeNull()
  })

  it('with the quote route on it is the quote\'s price with the quote\'s own time, linked as the BTCUSD pair', async () => {
    serve(FULL)
    const { run } = renderPanel()
    await screen.findByTestId('panel-symbol-BTCUSD')
    const group = screen.getByTestId('terminal-mkts-group-crypto')
    expect(group.getAttribute('data-from')).toBe('quote')
    expect(text('terminal-mkts-head-crypto')).toBe('Crypto (Source: FMP, price as of Nov 19, 2:30 PM ET)')
    expect(screen.getByTestId('terminal-mkts-row-BTC').querySelector('th').textContent).toBe('BTCUSD Bitcoin in US dollars')
    expect(text('terminal-mkts-row-BTC-last')).toBe('67,250.50')
    expect(text('terminal-mkts-row-BTC-chg')).toBe('+1.23%')
    expect(screen.getByTestId('terminal-mkts-row-BTC-chg').querySelector('span').className).toMatch(/up/)
    fireEvent.click(screen.getByTestId('panel-symbol-BTCUSD'))
    expect(run).toHaveBeenCalledWith('$BTCUSD')
    expect(timesAsked(QUOTE_URL)).toBe(1)
  })

  it('a quote the server is only holding says so; a quote with no time says it has none', async () => {
    serve({ ...FULL, [QUOTE_URL]: { ...QUOTE, state: 'stale' } })
    renderPanel()
    await screen.findByTestId('panel-symbol-BTCUSD')
    expect(text('terminal-mkts-head-crypto')).toBe('Crypto (Source: FMP, price as of Nov 19, 2:30 PM ET, the last price the server holds)')
    cleanup()
    serve({ ...FULL, [QUOTE_URL]: { ...QUOTE, as_of: null } })
    renderPanel()
    await screen.findByTestId('panel-symbol-BTCUSD')
    expect(text('terminal-mkts-head-crypto')).toBe('Crypto (Source: FMP, which sent no time for this price)')
  })

  it('a quote route that gives no price falls back to the snapshot\'s price and says so', async () => {
    for (const quote of [{ ...QUOTE, price: null, as_of: null, state: 'failed' }, fail(500)]) {
      serve({ ...FULL, [QUOTE_URL]: quote })
      renderPanel()
      const words = await screen.findByTestId('terminal-mkts-btc-fallback')
      expect(words.textContent).toBe('The FMP quote gave no price just now, so this is the snapshot\'s Bitcoin price.')
      expect(screen.getByTestId('terminal-mkts-group-crypto').getAttribute('data-from')).toBe('snapshot')
      expect(text('terminal-mkts-row-BTC-last')).toBe('67,123.45')
      expect(screen.queryByTestId('panel-symbol-BTCUSD')).toBeNull()
      cleanup()
    }
  })

  it('no Bitcoin price from either source says so in words, never a 0', async () => {
    serve({ ...BASE, [SNAP_URL]: { etfs: SNAP.etfs, futures: { BTC: { price: DASH, chg: DASH } } } })
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect(screen.getByTestId('terminal-mkts-group-crypto').getAttribute('data-from')).toBe('none')
    expect(text('terminal-mkts-btc-none')).toBe('No Bitcoin price right now. That is a missing price, not a zero.')
    expect(text('terminal-mkts-head-crypto')).toBe('Crypto')
    expect(screen.queryByTestId('terminal-mkts-row-BTC')).toBeNull()
    expect(text('terminal-mkts-missing')).toBe('No price for Bitcoin in this read. That is a missing price, not a zero.')
  })

  it('the quote alone answering still draws its row while the other sources say they did not answer', async () => {
    serve({ [SNAP_URL]: fail(500), [RATES_URL]: fail(500), [PAIRS_URL]: PAIRS, [QUOTE_URL]: QUOTE })
    renderPanel()
    await screen.findByTestId('panel-symbol-BTCUSD')
    expect(root().getAttribute('data-state')).toBe('partial')
    expect(text('terminal-mkts-row-BTC-last')).toBe('67,250.50')
    expect(text('terminal-mkts-snapshot-failed')).toContain('Index fund, VIX and Bitcoin prices could not be read just now.')
    expect(text('terminal-mkts-rates-error')).toContain('Treasury yields could not be read just now.')
    expect(screen.queryByTestId('terminal-mkts-error')).toBeNull()
  })
})

describe('MKTS links', () => {
  it('each fund opens as a symbol; VIX is not a link', async () => {
    serve(BASE)
    const { run } = renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    for (const sym of ['SPY', 'QQQ', 'IWM', 'DIA']) {
      fireEvent.click(screen.getByTestId(`panel-symbol-${sym}`))
      expect(run).toHaveBeenLastCalledWith(`$${sym}`)
    }
    expect(run).toHaveBeenCalledTimes(4)
    expect(within(screen.getByTestId('terminal-mkts-group-vol')).queryByRole('button')).toBeNull()
  })

  it('each yields row opens RATES, and the foot links open RATES and COT', async () => {
    serve(BASE)
    const { open } = renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    fireEvent.click(screen.getByRole('button', { name: '10-year Treasury, open Treasury yields (RATES)' }))
    expect(open).toHaveBeenLastCalledWith('RATES')
    expect(within(screen.getByTestId('terminal-mkts-group-rates')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(
      ['3-month', '2-year', '10-year', '30-year'].map((m) => `${m} Treasury, open Treasury yields (RATES)`))
    const links = within(screen.getByTestId('terminal-mkts-links'))
    fireEvent.click(links.getByRole('button', { name: 'Treasury yields (RATES)' }))
    expect(open).toHaveBeenLastCalledWith('RATES')
    fireEvent.click(links.getByRole('button', { name: 'Futures positioning (COT)' }))
    expect(open).toHaveBeenLastCalledWith('COT')
    expect(open).toHaveBeenCalledTimes(3)
  })
})

describe('MKTS polling', () => {
  it('reads the snapshot again every 30 seconds, and the yields no faster than every 30 minutes', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(NOW) })
    serve(BASE)
    renderPanel()
    await screen.findByTestId('terminal-mkts-table')
    expect([timesAsked(SNAP_URL), timesAsked(RATES_URL)]).toEqual([1, 1])
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000) })
    expect(timesAsked(SNAP_URL)).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(timesAsked(SNAP_URL)).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_500) })
    expect(timesAsked(SNAP_URL)).toBe(3)
    expect(timesAsked(RATES_URL)).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(MKTS_RATES_HELD_POLL_MS) })
    expect(timesAsked(RATES_URL)).toBe(2)
  })
})

describe('MKTS follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['MarketsBoardPanel.jsx', 'marketsBoardModel.js']) {
      const src = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, src).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('MKTS accessibility', () => {
  it('the whole board, a board with missing prices and failed sources, and the error state pass axe (WCAG A and AA)', async () => {
    vi.useRealTimers()
    serve(FULL)
    renderPanel({ code: 'MKTS' })
    await screen.findByTestId('panel-symbol-BTCUSD')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [SNAP_URL]: { etfs: { ...SNAP.etfs, IWM: { price: DASH, chg: DASH } }, futures: {} }, [RATES_URL]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-mkts-rates-error')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [SNAP_URL]: fail(500), [RATES_URL]: CURVE })
    renderPanel()
    await screen.findByTestId('terminal-mkts-snapshot-failed')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [SNAP_URL]: fail(500), [RATES_URL]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-mkts-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
