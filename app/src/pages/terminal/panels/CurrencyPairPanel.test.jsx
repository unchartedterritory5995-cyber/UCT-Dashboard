// A currency pair (BTCUSD) in a terminal panel: CurrencyPairPanel.jsx + currencyPairModel.js. Rails:
//   * GP is GP's own chart told to take no live ticks, on daily, weekly or monthly bars only; an
//     intraday timeframe draws the daily chart and says so; the header gets the newest bar's day;
//   * DES is the price: loading, a switched-off route (no Retry), a failed read (Retry), the
//     server still reading, and "FMP sent no price" are five different states, none of them 0;
//   * a field FMP did not send is left out; a held price after a failed read is marked;
//   * every other one-security function says in ONE sentence that it has nothing for a pair, and
//     financials, earnings, ownership and options each say why; the two that work are offered;
//   * the source and FMP's own time are on screen with the price, and nothing says "live";
//   * no hard-coded color, no fixed width a 390px phone could not hold, axe.
// Every price here is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import CurrencyPairPanel from './CurrencyPairPanel'
import {
  COMPANY_ONLY, OPTIONS_PANELS, PAIR_TF_NOTE, PAIR_VIEWS, newestBarDay, pairChartTf, pairDayNote, pairNewestBarUrl,
  pairSentence, pairViewOf, quoteFacts,
} from './currencyPairModel'
import { _url as chartBarsUrl } from '../../../utils/prefetchBars'
import { FUNCTIONS } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const PAIR = { symbol: 'BTCUSD', name: 'Bitcoin', base: 'BTC', quote: 'USD', source: 'FMP' }
const QUOTE_URL = '/api/crypto/quote/BTCUSD'
const BARS_URL = '/api/bars/BTCUSD?tf=D&bars=600'
const QUOTE = {
  symbol: 'BTCUSD', name: 'Bitcoin', source: 'FMP', state: 'fresh', price: 41234.5, change: 494.81, change_pct: 1.2,
  open: 40800, day_high: 41500.25, day_low: 40511, prev_close: 40739.69, year_high: 50000, year_low: 20000,
  as_of: 1794657600,   // 2026-11-14 12:00 UTC, 7:00 AM in New York
}
const BARS = { ticker: 'BTCUSD', tf: 'D', bars: [{ t: '2026-11-14', o: 40800, h: 41500.25, l: 40511, c: 41234.5, v: 10 }] }
const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

/** GP's own panel, as panels.jsx hands it in: records what it was told. */
const chartSpy = vi.fn()
const OwnChart = (props) => { chartSpy(props); return <div data-testid="own-chart" /> }

function renderPanel(props, { open = vi.fn(), setFreshness = vi.fn(), code = 'DES' } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>
            <CurrencyPairPanel pair={PAIR} {...props} />
          </TerminalPanelContext.Provider>
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { open, setFreshness, container: view.container }
}
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).at(-1)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const NOT_LIVE = /\blive\b|real.?time|streaming/i
/** The one-security panels the catalogue can open with a ticker. */
const TICKER_PANELS = [...new Set(FUNCTIONS.map((f) => f.ticker?.panel).filter(Boolean))]

beforeEach(() => { jsonFetcher.mockReset(); chartSpy.mockReset() })
afterEach(cleanup)

describe('which panel draws what for a pair', () => {
  it('GP is the chart, DES is the price, everything else is the sentence', () => {
    expect({ ...PAIR_VIEWS }).toEqual({ Chart: 'chart', Overview: 'quote' })
    expect(TICKER_PANELS.length).toBeGreaterThan(40)
    for (const name of TICKER_PANELS) {
      expect(pairViewOf(name), name).toBe(name === 'Chart' ? 'chart' : name === 'Overview' ? 'quote' : 'none')
    }
    expect(pairViewOf('toString')).toBe('none')
    expect(pairViewOf(undefined)).toBe('none')
  })

  it('every panel the sentences name is a real panel, so a renamed panel cannot fall to the plain sentence unseen', () => {
    for (const name of [...Object.keys(COMPANY_ONLY), ...OPTIONS_PANELS, ...Object.keys(PAIR_VIEWS)]) {
      expect(Object.keys(PANEL_IMPORTERS), name).toContain(name)
    }
  })

  it('financials, earnings, ownership and options each say why, in one sentence', () => {
    expect(pairSentence('Financials', PAIR)).toBe('Bitcoin (BTCUSD) is a currency pair, not a company, so it has no financial statements.')
    expect(pairSentence('Estimates', PAIR)).toBe('Bitcoin (BTCUSD) is a currency pair, not a company, so it has no earnings estimates.')
    expect(pairSentence('EarningsReaction', PAIR)).toBe('Bitcoin (BTCUSD) is a currency pair, not a company, so it has no earnings reports.')
    expect(pairSentence('Ownership', PAIR)).toBe('Bitcoin (BTCUSD) is a currency pair, not a company, so it has no ownership filings.')
    expect(pairSentence('OptionsChain', PAIR)).toBe('This site has no options data for a currency pair such as BTCUSD.')
    expect(pairSentence('Flow', PAIR)).toBe('This site has no options data for a currency pair such as BTCUSD.')
    expect(pairSentence('News', PAIR)).toBe('This panel is not available for a currency pair such as BTCUSD.')
    // a name that is not a panel reads no inherited key: the plain sentence, never "so it has no function…"
    for (const name of ['constructor', 'toString', undefined, null]) {
      expect(pairSentence(name, PAIR), String(name)).toBe('This panel is not available for a currency pair such as BTCUSD.')
    }
  })

  it('every one-security panel has exactly one plain sentence that names the pair', () => {
    for (const name of TICKER_PANELS.filter((n) => pairViewOf(n) === 'none')) {
      const said = pairSentence(name, PAIR)
      expect(said, name).toMatch(/currency pair/)
      expect(said, name).toContain('BTCUSD')
      expect(said.match(/\./g), name).toHaveLength(1)
      expect(said.endsWith('.'), name).toBe(true)
      expect(said, name).not.toMatch(NOT_LIVE)
    }
    expect(pairSentence('News', { symbol: 'BTCUSD', name: 'BTCUSD' })).not.toContain('(')
  })
})

describe('BTCUSD GP: the chart', () => {
  it('a pair is charted on D, W and M; anything else is the daily chart, and says which was refused', () => {
    expect(pairChartTf('D')).toEqual({ tf: 'D', refused: null })
    expect(pairChartTf('w')).toEqual({ tf: 'W', refused: null })
    expect(pairChartTf('M')).toEqual({ tf: 'M', refused: null })
    expect(pairChartTf(undefined)).toEqual({ tf: 'D', refused: null })
    for (const tf of ['1', '5', '15', '30', '60', '2D', 'Q']) expect(pairChartTf(tf), tf).toEqual({ tf: 'D', refused: tf })
  })

  it('draws GP\'s own chart with live ticks off and the daily-only warm-up', async () => {
    serve({ [BARS_URL]: BARS })
    renderPanel({ panel: 'Chart', Panel: OwnChart, tf: 'W' }, { code: 'GP' })
    expect(screen.getByTestId('own-chart')).toBeTruthy()
    expect(chartSpy.mock.calls.at(-1)[0]).toEqual({ sym: 'BTCUSD', tf: 'W', liveUpdates: false, chartProps: { breadthSeries: true, watermarkName: 'Bitcoin' } })
    expect(screen.getByTestId('terminal-pair-chart').getAttribute('data-tf')).toBe('W')
    expect(screen.queryByTestId('terminal-pair-tf-note')).toBeNull()
    await waitFor(() => expect(asked()).toEqual([BARS_URL]))
  })

  it('an intraday timeframe draws the daily chart and says so in one line', () => {
    serve({ [BARS_URL]: BARS })
    renderPanel({ panel: 'Chart', Panel: OwnChart, tf: '5' }, { code: 'GP' })
    expect(chartSpy.mock.calls.at(-1)[0].tf).toBe('D')
    expect(screen.getByTestId('terminal-pair-tf-note').textContent).toBe(PAIR_TF_NOTE)
    expect(PAIR_TF_NOTE).toBe('A currency pair is charted on daily, weekly and monthly bars only, so this is the daily chart.')
  })

  it('the header gets the source and the newest bar\'s own day, and no day when there is no bar', async () => {
    expect(pairNewestBarUrl('BTCUSD')).toBe(BARS_URL)
    // the daily chart's own address: no background-warm mark, no session, nothing of the panel's own
    expect(pairNewestBarUrl('BTCUSD')).toBe(chartBarsUrl('BTCUSD', 'D', false))
    expect(newestBarDay(BARS)).toBe('2026-11-14')
    for (const none of [null, {}, { bars: [] }, { bars: 'x' }, { bars: [{ t: 1794657600 }] }, { bars: [{ t: '11/14/2026' }] }, { bars: [null] }]) {
      expect(newestBarDay(none), JSON.stringify(none)).toBe(null)
    }
    serve({ [BARS_URL]: BARS })
    const a = renderPanel({ panel: 'Chart', Panel: OwnChart }, { code: 'GP' })
    await waitFor(() => expect(lastReport(a.setFreshness)?.age).toEqual({ asOfDate: '2026-11-14' }))
    expect(lastReport(a.setFreshness).source).toBe('FMP daily bars')
    cleanup()
    serve({ [BARS_URL]: { ticker: 'BTCUSD', tf: 'D', bars: [], no_data: true } })
    const b = renderPanel({ panel: 'Chart', Panel: OwnChart }, { code: 'GP' })
    await waitFor(() => expect(asked()).toContain(BARS_URL))
    await new Promise((r) => setTimeout(r, 20))
    expect(lastReport(b.setFreshness)).toEqual({ source: 'FMP daily bars' })
  })
})

describe('BTCUSD DES: the price', () => {
  it('loading is a skeleton, and reads the one quote route', () => {
    serve({ [QUOTE_URL]: PENDING })
    renderPanel({ panel: 'Overview' })
    expect(screen.getByTestId('terminal-pair-loading')).toBeTruthy()
    expect(asked()).toEqual([QUOTE_URL])
  })

  it('the price, the change, the day\'s facts, the source and FMP\'s own time', async () => {
    serve({ [QUOTE_URL]: QUOTE })
    const { setFreshness } = renderPanel({ panel: 'Overview' })
    await screen.findByTestId('terminal-pair-quote')
    expect(screen.getByTestId('terminal-pair-price').textContent).toBe('41,234.50')
    const change = screen.getByTestId('terminal-pair-change')
    expect(change.getAttribute('data-dir')).toBe('up')
    expect(change.textContent).toContain('+1.20%')
    expect(change.textContent).toContain("since FMP's previous close")
    const facts = [...screen.getByTestId('terminal-pair-facts').querySelectorAll('div')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent])
    expect(facts).toEqual([
      ['Open', '40,800.00'], ['Day high', '41,500.25'], ['Day low', '40,511.00'], ['Previous close', '40,739.69'],
      ['52-week high', '50,000.00'], ['52-week low', '20,000.00'],
    ])
    const source = screen.getByTestId('terminal-pair-source').textContent
    expect(source).toContain('Source: FMP, price as of Nov 14, 7:00 AM ET.')
    expect(source).toContain('asks again every 30 seconds, so the price can trail the market')
    expect(source).toContain('has a bar for Saturdays and Sundays too')
    expect(source).toContain('financials, earnings, ownership and options panels have nothing for it')
    expect(screen.getByTestId('terminal-pair-quote').getAttribute('data-stale')).toBe('false')
    expect(lastReport(setFreshness)).toEqual({ source: 'FMP', observedAt: '2026-11-14T12:00:00.000Z', age: { asOfDate: 'Nov 14, 7:00 AM ET' } })
    expect(document.body.textContent).not.toMatch(NOT_LIVE)
  })

  it('a field FMP did not send is left out, never drawn as 0', async () => {
    expect(quoteFacts({ ...QUOTE, open: null, day_high: 0, year_low: undefined, prev_close: 'x' }).map(([l]) => l)).toEqual(['Day low', '52-week high'])
    expect(quoteFacts(null)).toEqual([])
    serve({ [QUOTE_URL]: { symbol: 'BTCUSD', source: 'FMP', state: 'fresh', price: 41234.5, change_pct: null, as_of: null } })
    const { setFreshness } = renderPanel({ panel: 'Overview' })
    await screen.findByTestId('terminal-pair-quote')
    expect(screen.queryByTestId('terminal-pair-change')).toBeNull()
    expect(screen.queryByTestId('terminal-pair-facts')).toBeNull()
    expect(screen.getByTestId('terminal-pair-source').textContent).toContain('Source: FMP, which sent no time for this price.')
    expect(lastReport(setFreshness)).toEqual({ source: 'FMP' })
    expect(document.body.textContent).not.toMatch(/\b0\.00\b/)
  })

  it('a falling price points down and keeps its minus sign', async () => {
    serve({ [QUOTE_URL]: { ...QUOTE, change_pct: -2.5 } })
    renderPanel({ panel: 'Overview' })
    const change = await screen.findByTestId('terminal-pair-change')
    expect(change.getAttribute('data-dir')).toBe('down')
    expect(change.textContent).toContain('−2.50%')
  })

  it('a held price after a failed read is marked, and says the read failed', async () => {
    serve({ [QUOTE_URL]: { ...QUOTE, state: 'failed' } })
    renderPanel({ panel: 'Overview' })
    const box = await screen.findByTestId('terminal-pair-quote')
    expect(box.getAttribute('data-stale')).toBe('true')
    expect(screen.getByTestId('terminal-pair-source').textContent).toContain('(the last read failed)')
    expect(screen.getByTestId('terminal-pair-source').textContent).toContain('This price is older than the newest read')
  })

  it('the server still reading is a waiting state, not a price', async () => {
    serve({ [QUOTE_URL]: { symbol: 'BTCUSD', source: 'FMP', state: 'warming', price: null } })
    renderPanel({ panel: 'Overview' })
    const box = await screen.findByTestId('terminal-pair-waiting')
    expect(box.textContent).toContain('The server is reading the BTCUSD price from FMP.')
    expect(screen.queryByTestId('terminal-pair-price')).toBeNull()
  })

  it('"FMP sent no price" is said in words, is not 0, and can be retried', async () => {
    serve({ [QUOTE_URL]: { symbol: 'BTCUSD', source: 'FMP', state: 'failed', price: null } })
    const { open } = renderPanel({ panel: 'Overview' })
    const box = await screen.findByTestId('terminal-pair-no-price')
    expect(box.textContent).toContain('FMP sent no price for BTCUSD on the last read.')
    expect(box.textContent).toContain('That is not a price of zero.')
    expect(screen.queryByTestId('terminal-pair-price')).toBeNull()
    fireEvent.click(screen.getByTestId('panel-command-BTCUSD-GP'))
    expect(open).toHaveBeenCalledWith('BTCUSD GP')
    serve({ [QUOTE_URL]: QUOTE })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect((await screen.findByTestId('terminal-pair-price')).textContent).toBe('41,234.50')
  })

  it('a switched-off route says so and offers no Retry; a failed read offers one and reads again', async () => {
    serve({ [QUOTE_URL]: fail(404) })
    renderPanel({ panel: 'Overview' })
    const off = await screen.findByTestId('terminal-pair-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('The BTCUSD price is not switched on for this server yet.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    serve({ [QUOTE_URL]: fail(500) })
    renderPanel({ panel: 'Overview' })
    const down = await screen.findByTestId('terminal-pair-error')
    expect(down.getAttribute('data-kind')).toBe('error')
    expect(down.textContent).toContain('The BTCUSD price could not be read just now.')
    serve({ [QUOTE_URL]: QUOTE })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect((await screen.findByTestId('terminal-pair-price')).textContent).toBe('41,234.50')
  })
})

describe('a panel that has nothing for a pair', () => {
  it.each(['Financials', 'Estimates', 'OptionsChain', 'Ownership', 'News', 'Dilution'])('%s says its one sentence, reads nothing, and offers the two that work', (panel) => {
    serve({})
    const { open, setFreshness } = renderPanel({ panel, Panel: OwnChart }, { code: 'FA' })
    const box = screen.getByTestId('terminal-pair-unavailable')
    expect(box.getAttribute('data-kind')).toBe('empty')
    expect(box.textContent).toContain(pairSentence(panel, PAIR))
    expect(jsonFetcher).not.toHaveBeenCalled()
    expect(chartSpy).not.toHaveBeenCalled()                 // the panel's own component is never drawn
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    fireEvent.click(screen.getByTestId('panel-command-BTCUSD-GP'))
    fireEvent.click(screen.getByTestId('panel-command-BTCUSD-DES'))
    expect(open.mock.calls.map(([c]) => c)).toEqual(['BTCUSD GP', 'BTCUSD DES'])
  })
})

describe('the pair panel follows the member\'s theme and fits a phone', () => {
  const FILES = ['CurrencyPairPanel.jsx', 'currencyPairModel.js', 'CurrencyPairPanel.module.css']
  it('holds no hard-coded color', () => {
    for (const f of FILES) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
    const lib = fs.readFileSync(path.join(HERE, '..', '..', '..', 'lib', 'cryptoPairs.js'), 'utf8')
    expect(colourLiteralsIn('lib/cryptoPairs.js', lib).map((h) => h.lit)).toEqual([])
  })

  it('nothing has a fixed width: no pixel width, no nowrap, and two fact columns fit 390px', () => {
    const css = fs.readFileSync(path.join(HERE, 'CurrencyPairPanel.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/(?:^|[\s;{])(?:min-)?width\s*:\s*\d+px/)
    expect(css).not.toMatch(/white-space\s*:\s*nowrap/)
    const cols = /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(([\d.]+)rem,\s*1fr\)\)/.exec(css)
    expect(cols).not.toBeNull()
    expect(Number(cols[1]) * 16 * 2).toBeLessThanOrEqual(390 - 2 * 16 - 12)   // two columns inside a 390px phone's gutters
    const jsx = fs.readFileSync(path.join(HERE, 'CurrencyPairPanel.jsx'), 'utf8')
    expect(jsx).not.toMatch(/style=\{\{/)
    expect(jsx).not.toMatch(/<table/)
  })

  it('the day note names the pair and its source, with a plain fallback', () => {
    expect(pairDayNote(PAIR)).toBe('Bitcoin trades every day, around the clock, so its chart has a bar for Saturdays and Sundays too. Each daily bar is one calendar day as FMP dates it.')
    expect(pairDayNote(null)).toContain('A currency pair trades every day')
  })
})

describe('pair panel accessibility', () => {
  it('the price, the no-price state, the sentence and the chart note pass axe (WCAG A and AA)', async () => {
    serve({ [QUOTE_URL]: QUOTE })
    renderPanel({ panel: 'Overview' })
    await screen.findByTestId('terminal-pair-quote')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [QUOTE_URL]: { symbol: 'BTCUSD', source: 'FMP', state: 'failed', price: null } })
    renderPanel({ panel: 'Overview' })
    await screen.findByTestId('terminal-pair-no-price')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({})
    renderPanel({ panel: 'Financials' })
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [BARS_URL]: BARS })
    renderPanel({ panel: 'Chart', Panel: OwnChart, tf: '5' }, { code: 'GP' })
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
