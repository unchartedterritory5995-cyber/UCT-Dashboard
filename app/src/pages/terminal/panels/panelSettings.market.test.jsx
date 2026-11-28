// Settings pass (2026-11-28, gap audit C6): the market panels that had no settings now carry the ones their data
// supports. For each:
//   * the default is exactly today's panel (and stores nothing);
//   * the setting changes what it should;
//   * it survives a remount from the saved record (a VIEW setting) or from the command (an ARGUMENT).
// VIEW: RSL size, BRKO RS floor, NEWS kind / naming a stock, ECON theme, AUCT kind + all results, RATES spread + span.
// ARGUMENT: LIQ / OIL line span (`LIQ 5Y`), which changes what is read.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import { ViewHost, savedView } from '../__tests__/panelViewHarness'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'
import RsLeadersPanel, { RS_URL, RSL_SIZES, TOP_N } from './RsLeadersPanel'
import BreakoutPanel, { RS_FLOORS, withRsFloor } from './BreakoutPanel'
import NewsPanel, { NEWS_URL, filterNews, newsKinds } from './NewsPanel'
import EconomyPanel, { ECON_LATEST_URL } from './EconomyPanel'
import { ECON_THEME_CHIPS, themesShown } from './economyModel'
import TreasuryAuctionsPanel from './TreasuryAuctionsPanel'
import { AUCT_SOURCE, AUCT_URL, auctionsOfKind, auctionsRead, isBill } from './treasuryAuctionsModel'
import RatesPanel, { RATES_URL, SOURCE as RATES_SOURCE } from './RatesPanel'
import { historyWindow, monthsBefore, rangeWords } from './ratesModel'
import LiquidityPanel, { LIQ_LATEST_URL } from './LiquidityPanel'
import { historyUrls as liqUrls, netLiquidityLine } from './liquidityModel'
import OilPanel, { OIL_LATEST_URL } from './OilPanel'
import { OIL_SYMBOLS, historyUrls as oilUrls, stocksLine } from './oilModel'
import { LIQ_NOW_MS, LIQ_TODAY, liqLatest, liqSeries } from './__fixtures__/liquidityFixture'
import { econAnswer } from './__fixtures__/economyFixture'
import { OIL_TODAY, oilHistory, oilLatest } from './__fixtures__/oilFixture'

const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = typeof routes === 'function' ? routes(u) : routes[u]
    return hit === undefined ? Promise.reject(fail(500)) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

/** The panel inside the shell's wires: its view (saved record), its command (rerun), its code. */
function mount(node, { saved = savedView(), code = null, rerun = vi.fn() } = {}) {
  const body = code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{node}</TerminalPanelContext.Provider> : node
  const view = render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelFreshnessContext.Provider value={vi.fn()}>
          <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
            <ViewHost saved={saved}>{body}</ViewHost>
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </SWRConfig>
    </MemoryRouter>,
  )
  return { saved, rerun, ...view }
}
const pressed = (id) => screen.getByTestId(id).getAttribute('aria-pressed')

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// ── RSL: how many leaders ───────────────────────────────────────────────────────────────────────
const RANKS = Array.from({ length: 300 }, (_, i) => ({ ticker: `T${String(i).padStart(3, '0')}`, rs_score: 300 - i, rs_rank: 99 - Math.floor(i / 4), returns: { '3m': 10 } }))
const rslRows = () => within(screen.getByTestId('terminal-rsl-table')).getAllByRole('row').length - 1

describe('RSL size (view)', () => {
  it('lists the top 100 by default and stores nothing; 50 and 250 change the list; the choice survives a remount', async () => {
    serve({ [RS_URL]: RANKS })
    expect(TOP_N).toBe(100)
    expect(RSL_SIZES).toEqual([50, 100, 250, 500])
    const first = mount(<RsLeadersPanel />)
    await screen.findByTestId('terminal-rsl-table')
    expect(rslRows()).toBe(100)
    expect(pressed('terminal-rsl-size-100')).toBe('true')
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-rsl-size-50'))
    expect(rslRows()).toBe(50)
    expect(first.saved.view).toEqual({ filters: { top: 50 } })
    first.unmount()
    mount(<RsLeadersPanel />, { saved: first.saved })
    await screen.findByTestId('terminal-rsl-table')
    expect(rslRows()).toBe(50)
    fireEvent.click(screen.getByTestId('terminal-rsl-size-250'))
    expect(rslRows()).toBe(250)
    expect(screen.getByTestId('terminal-rsl-method').textContent).toContain('top 250 of 300 names')
    fireEvent.click(screen.getByTestId('terminal-rsl-size-100'))
    expect(first.saved.view).toBeNull()                       // back to the default stores nothing
  })

  it('a stored size the panel does not offer reads as today\'s 100', async () => {
    serve({ [RS_URL]: RANKS })
    mount(<RsLeadersPanel />, { saved: savedView({ filters: { top: 7 } }) })
    await screen.findByTestId('terminal-rsl-table')
    expect(rslRows()).toBe(100)
  })
})

// ── BRKO: a higher RS floor ────────────────────────────────────────────────────────────────────
const SCAN = {
  total: 3, snapshot_date: '2026-10-08',
  rows: [
    { ticker: 'AMD', company: 'A', price: 100, rs_rank: 91, close_cv_pct: 2.5, pattern_engine_ids: ',bull_flag,', pattern_entry_dist_pct: 4, snapshot_date: '2026-10-08' },
    { ticker: 'NVDA', company: 'N', price: 200, rs_rank: 98, close_cv_pct: 1.2, pattern_engine_ids: ',vcp,', pattern_entry_dist_pct: 1.5, snapshot_date: '2026-10-08' },
    { ticker: 'CRWD', company: 'C', price: 300, rs_rank: 74, close_cv_pct: 3.1, pattern_engine_ids: null, pattern_entry_dist_pct: -0.8, snapshot_date: '2026-10-08' },
  ],
}
const brkoSyms = () => within(screen.getByTestId('terminal-brko-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-brko-row-', ''))

describe('BRKO RS floor (view)', () => {
  it('pure: the floor narrows the read list and numbers it again; the scan floor returns it as it is', () => {
    const rows = [{ sym: 'A', rs: 72, order: 0 }, { sym: 'B', rs: 95, order: 1 }, { sym: 'C', rs: null, order: 2 }, { sym: 'D', rs: 81, order: 3 }]
    expect(withRsFloor(rows, 70)).toBe(rows)
    expect(withRsFloor(rows, 80)).toEqual([{ sym: 'B', rs: 95, order: 0 }, { sym: 'D', rs: 81, order: 1 }])
    expect(withRsFloor(rows, 90).map((r) => r.sym)).toEqual(['B'])
    expect(RS_FLOORS).toEqual([70, 80, 90])
  })

  it('the default lists every name read; 90+ keeps the leaders; an empty floor says so; it survives a remount', async () => {
    serve(() => SCAN)
    const first = mount(<BreakoutPanel />)
    await screen.findByTestId('terminal-brko-table')
    expect(brkoSyms()).toEqual(['CRWD', 'NVDA', 'AMD'])
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-brko-rs-90'))
    expect(brkoSyms()).toEqual(['NVDA', 'AMD'])
    expect(screen.getByTestId('terminal-brko-row-AMD').textContent).toContain('2')   // numbered again
    expect(screen.getByTestId('terminal-brko-method').textContent).toContain('this panel shows only 90 or higher')
    expect(first.saved.view).toEqual({ filters: { rs: 90 } })
    first.unmount()
    mount(<BreakoutPanel />, { saved: first.saved })
    await screen.findByTestId('terminal-brko-table')
    expect(brkoSyms()).toEqual(['NVDA', 'AMD'])
  })

  it('a floor no name reaches is an honest empty state with a way back', async () => {
    serve(() => ({ ...SCAN, rows: SCAN.rows.filter((r) => r.rs_rank < 80) }))
    mount(<BreakoutPanel />, { saved: savedView({ filters: { rs: 90 } }) })
    const empty = await screen.findByTestId('terminal-brko-floor-empty')
    expect(empty.textContent).toContain('None of the 1 breakout-ready names has an RS rank of 90 or higher.')
    fireEvent.click(within(empty).getByRole('button'))
    expect(brkoSyms()).toEqual(['CRWD'])
  })
})

// ── NEWS: one kind, naming a stock ─────────────────────────────────────────────────────────────
const ITEMS = [
  { headline: 'Fed holds', source: 'CNBC', url: 'https://x/1', time: '2026-10-09 08:15:00', category: 'MACRO', tickers: [] },
  { headline: 'NVDA beats', source: 'Benzinga', url: 'https://x/2', time: '2026-10-09 09:40:00', category: 'EARN', tickers: ['NVDA'] },
  { headline: 'AMD beats', source: 'Benzinga', url: 'https://x/3', time: '2026-10-09 09:30:00', category: 'EARN', tickers: ['AMD'] },
  { headline: 'Oil slides', source: 'RSS', url: 'https://x/4', time: '2026-10-09 09:00:00', category: 'GENERAL', tickers: [] },
]
const headlines = () => screen.getAllByTestId('terminal-news-row').map((r) => r.querySelector('a').textContent)

describe('NEWS filters (view)', () => {
  it('pure: the kinds held, most first; a kind and naming a stock narrow the tape', () => {
    const rows = [{ category: 'EARN', tickers: ['A'] }, { category: 'MACRO', tickers: [] }, { category: 'EARN', tickers: [] }]
    expect(newsKinds(rows)).toEqual([{ kind: 'EARN', count: 2 }, { kind: 'MACRO', count: 1 }])
    expect(filterNews(rows)).toHaveLength(3)
    expect(filterNews(rows, { kind: 'EARN' })).toHaveLength(2)
    expect(filterNews(rows, { kind: 'EARN', named: true })).toEqual([rows[0]])
  })

  it('the default is every headline; a kind and naming a stock narrow it, say so, and survive a remount', async () => {
    serve((u) => (u === NEWS_URL ? ITEMS : []))
    const first = mount(<NewsPanel />)
    await screen.findByTestId('terminal-news-list')
    expect(headlines()).toEqual(['NVDA beats', 'AMD beats', 'Oil slides', 'Fed holds'])
    expect(screen.getByTestId('terminal-news-kind').value).toBe('')
    expect(first.saved.view).toBeNull()
    fireEvent.change(screen.getByTestId('terminal-news-kind'), { target: { value: 'EARN' } })
    expect(headlines()).toEqual(['NVDA beats', 'AMD beats'])
    expect(screen.getByTestId('terminal-news-method').textContent).toContain('2 of 4 headlines, newest first, with the filters above')
    fireEvent.click(screen.getByTestId('terminal-news-named'))
    expect(first.saved.view).toEqual({ filters: { kind: 'EARN', named: true } })
    first.unmount()
    mount(<NewsPanel />, { saved: first.saved })
    await screen.findByTestId('terminal-news-list')
    expect(headlines()).toEqual(['NVDA beats', 'AMD beats'])
    expect(pressed('terminal-news-named')).toBe('true')
  })

  it('a kept kind the tape holds none of stays offered and says so, with a way back', async () => {
    serve((u) => (u === NEWS_URL ? ITEMS : []))
    mount(<NewsPanel />, { saved: savedView({ filters: { kind: 'IPO' } }) })
    const empty = await screen.findByTestId('terminal-news-filtered-empty')
    expect(empty.textContent).toContain('None of the 4 headlines on the tape is IPO.')
    expect([...screen.getByTestId('terminal-news-kind').options].map((o) => o.textContent)).toContain('IPO (none now)')
    fireEvent.click(within(empty).getByRole('button'))
    expect(headlines()).toHaveLength(4)
  })
})

// ── ECON: one theme ────────────────────────────────────────────────────────────────────────────
describe('ECON theme (view)', () => {
  it('pure: every theme by default, one when chosen, every theme for a key it does not know', () => {
    const themes = [{ key: 'inflation' }, { key: 'jobs' }]
    expect(themesShown(themes)).toBe(themes)
    expect(themesShown(themes, 'jobs')).toEqual([{ key: 'jobs' }])
    expect(themesShown(themes, 'nope')).toBe(themes)
    expect(Object.keys(ECON_THEME_CHIPS)).toEqual(['inflation', 'jobs', 'growth', 'housing', 'rates'])
  })

  it('the default board holds every theme; Jobs keeps only jobs; it survives a remount', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2031-03-20T16:00:00Z'))
    serve({ [ECON_LATEST_URL]: econAnswer() })
    const first = mount(<EconomyPanel />)
    const table = await screen.findByTestId('terminal-econ-table')
    expect(table.textContent).toContain('Core CPI')
    expect(table.textContent).toContain('Nonfarm payrolls')
    expect(pressed('terminal-econ-show-all')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-econ-show-jobs'))
    expect(screen.getByTestId('terminal-econ-table').textContent).not.toContain('Core CPI')
    expect(screen.getByTestId('terminal-econ-table').textContent).toContain('Nonfarm payrolls')
    expect(first.saved.view).toEqual({ filters: { theme: 'jobs' } })
    first.unmount()
    mount(<EconomyPanel />, { saved: first.saved })
    expect((await screen.findByTestId('terminal-econ-table')).textContent).not.toContain('Core CPI')
  })
})

// ── AUCT: which auctions, and every result ─────────────────────────────────────────────────────
const up = (type, term, date, over = {}) => ({ security_type: type, security_term: term, auction_date: date, issue_date: '2026-11-30', announced_date: '2026-11-12', offering_amount: 58e9, reopening: false, cusip: 'x', ...over })
const res = (type, term, date, over = {}) => ({
  security_type: type, security_term: term, auction_date: date, issue_date: '2026-11-16', maturity_date: '2036-11-15', offering_amount: 42e9, rate: 4.1,
  rate_kind: 'high_yield', bid_to_cover: 2.5, reopening: false, tips: false, floating_rate: false, cash_management: false, cusip: `c${term}`, bidders: null, ...over,
})
const AUCT_BODY = {
  status: 'ok', as_of: '2026-11-17', upcoming_as_of: '2026-11-17', results_through: '2026-11-17', window_days: 45,
  upcoming: [up('Bond', '20-Year', '2026-11-18'), up('Bill', '13-Week', '2026-11-23')],
  results: [res('Bill', '4-Week', '2026-11-17', { rate_kind: 'high_rate' }), res('CMB', '6-Week', '2026-11-13', { rate_kind: 'high_rate', cash_management: true }),
    res('Note', '10-Year', '2026-11-12'), res('Bond', '30-Year', '2026-11-05')],
  dropped: { upcoming: 0, results: 0 }, read_at: '2026-11-17T23:20:04+00:00', basis: 'as_published', source: AUCT_SOURCE, check: null,
}
const auctTerms = () => [...screen.getByTestId('terminal-auct').querySelectorAll('tbody th, tbody td:first-child')].map((c) => c.textContent).join(' | ')

describe('AUCT kind (view)', () => {
  it('pure: bills (and cash management bills) apart from the coupon auctions; counts again; every auction is the answer as read', () => {
    const v = auctionsRead(AUCT_BODY)
    expect(auctionsOfKind(v, 'all')).toBe(v)
    const bills = auctionsOfKind(v, 'bills')
    expect([bills.upcomingCount, bills.resultCount]).toEqual([1, 2])
    const coupons = auctionsOfKind(v, 'coupons')
    expect([coupons.upcomingCount, coupons.resultCount]).toEqual([1, 2])
    expect(coupons.results.flatMap((d) => d.rows).some(isBill)).toBe(false)
    expect(isBill({ type: 'CMB' })).toBe(true)
    expect(isBill({ type: 'Note', cmb: false })).toBe(false)
  })

  it('the default lists every auction; Bills keeps the bills, says so and survives a remount', async () => {
    serve({ [AUCT_URL]: AUCT_BODY })
    const first = mount(<TreasuryAuctionsPanel />)
    await screen.findByTestId('terminal-auct-count')
    expect(pressed('terminal-auct-kind-all')).toBe('true')
    expect(auctTerms()).toContain('10-Year')
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-auct-kind-bills'))
    expect(auctTerms()).not.toContain('10-Year')
    expect(auctTerms()).toContain('4-Week')
    expect(screen.getByTestId('terminal-auct-count').textContent).toContain('Only bills are shown.')
    expect(first.saved.view).toEqual({ filters: { kind: 'bills' } })
    first.unmount()
    mount(<TreasuryAuctionsPanel />, { saved: first.saved })
    await screen.findByTestId('terminal-auct-count')
    expect(auctTerms()).not.toContain('10-Year')
  })

  it('a kind with nothing in either list is an honest empty state, not "the Treasury lists no auction"', async () => {
    serve({ [AUCT_URL]: { ...AUCT_BODY, upcoming: [up('Bill', '13-Week', '2026-11-23')], results: [res('Bill', '4-Week', '2026-11-17')] } })
    mount(<TreasuryAuctionsPanel />, { saved: savedView({ filters: { kind: 'coupons' } }) })
    const empty = await screen.findByTestId('terminal-auct-kind-empty')
    expect(empty.textContent).toContain('No note, bond, TIPS or floating rate note auction is coming up or listed for the last 45 days.')
    fireEvent.click(within(empty).getByRole('button'))
    expect(screen.getByTestId('terminal-auct-count')).toBeTruthy()
  })
})

// ── RATES: which spread, how far back ──────────────────────────────────────────────────────────
const H = (d1, w1, m1, m3, y1) => ({ d1, w1, m1, m3, y1 })
const DAYS = ['2025-05-01', '2025-11-03', '2026-06-01', '2026-11-16', '2026-11-17']
const RATES_BODY = {
  status: 'ok', as_of: '2026-11-17', ref_dates: H('2026-11-16', null, null, null, null), read_at: '2026-11-17T23:20:04+00:00', basis: 'end_of_day', source: RATES_SOURCE, check: null,
  maturities: [{ key: '2y', label: '2-year', months: 24, yield: 3.7, was: H(null, null, null, null, null), change_bp: H(0, 0, 0, 0, 0) },
    { key: '10y', label: '10-year', months: 120, yield: 4.1, was: H(null, null, null, null, null), change_bp: H(0, 0, 0, 0, 0) }],
  spreads: [
    { key: '10y2y', label: '10-year minus 2-year', long: '10-year', short: '2-year', value: 0.4, state: 'positive', days_in_state: 3, since: '2026-11-12', days_at_least: false, was: H(null, null, null, null, null), change_bp: H(0, 0, 0, 0, 0) },
    { key: '10y3m', label: '10-year minus 3-month', long: '10-year', short: '3-month', value: -0.2, state: 'inverted', days_in_state: 3, since: '2026-11-12', days_at_least: false, was: H(null, null, null, null, null), change_bp: H(0, 0, 0, 0, 0) },
  ],
  history: { from: DAYS[0], to: DAYS[4], points: 5, years: 5, dates: DAYS, y2y: [1, 1, 1, 1, 1], y10y: [1, 1, 1, 1, 1], y30y: [1, 1, 1, 1, 1],
    s10y2y: [0.1, 0.2, 0.3, 0.35, 0.4], s10y3m: [-0.5, -0.4, -0.3, -0.25, -0.2] },
}
const spread = () => screen.getByTestId('terminal-rates-spread-history')

describe('RATES spread picture (view)', () => {
  it('pure: a span cuts every column alike from the newest day; all held returns the history; words for each span', () => {
    const h = RATES_BODY.history
    expect(historyWindow(h, 'all')).toEqual({ ...h, cut: false })
    const y1 = historyWindow(h, '1y')
    expect(y1.dates).toEqual(['2026-06-01', '2026-11-16', '2026-11-17'])
    expect(y1.s10y3m).toEqual([-0.3, -0.25, -0.2])
    expect(y1.cut).toBe(true)
    expect(historyWindow(h, '6m').dates).toEqual(['2026-06-01', '2026-11-16', '2026-11-17'])
    expect(monthsBefore('2026-03-31', 1)).toBe('2026-02-28')
    expect([rangeWords('all', 5), rangeWords('1y'), rangeWords('2y'), rangeWords('6m')]).toEqual(['5 years', '1 year', '2 years', '6 months'])
  })

  it('the default is today\'s picture (10Y-2Y, everything held); 10Y-3M over 1Y is drawn, named, and survives a remount', async () => {
    serve({ [RATES_URL]: RATES_BODY })
    const first = mount(<RatesPanel />)
    await screen.findByTestId('terminal-rates-spread-history')
    expect([spread().dataset.spread, spread().dataset.range]).toEqual(['10y2y', 'all'])
    expect(spread().textContent).toContain('10-year minus 2-year, 5 years')
    expect(first.saved.view).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-rates-line-10y3m'))
    fireEvent.click(screen.getByTestId('terminal-rates-span-1y'))
    expect(spread().textContent).toContain('10-year minus 3-month, 1 year')
    expect(spread().querySelector('path[data-series="s10y3m"]')).toBeTruthy()
    expect(screen.getByTestId('terminal-rates-spread-words').textContent).toContain('Jun 1, 2026')
    expect(first.saved.view).toEqual({ filters: { spread: '10y3m', range: '1y' } })
    first.unmount()
    mount(<RatesPanel />, { saved: first.saved })
    await screen.findByTestId('terminal-rates-spread-history')
    expect([spread().dataset.spread, spread().dataset.range]).toEqual(['10y3m', '1y'])
  })
})

// ── LIQ / OIL: the line's span is an ARGUMENT ──────────────────────────────────────────────────
function serveLiq(range) {
  const routes = { [LIQ_LATEST_URL]: liqLatest() }
  for (const r of ['2y', range]) for (const [s, u] of Object.entries(liqUrls(LIQ_TODAY, r))) routes[u] = liqSeries(s, u.split('start=')[1])
  serve(routes)
}

describe('LIQ line span (argument)', () => {
  it('bare LIQ reads and draws two years exactly as before; a chip writes `LIQ 5Y` back to the command', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(LIQ_NOW_MS)
    serveLiq('2y')
    const { rerun } = mount(<LiquidityPanel />, { code: 'LIQ' })
    expect((await screen.findByTestId('terminal-liq-line-words')).textContent).toContain('Wednesdays')
    expect(screen.getByTestId('terminal-liq').dataset.range).toBe('2y')
    expect(screen.getByTestId('terminal-liq-net').textContent).toContain('Net liquidity, 2 years, every Wednesday')
    expect(asked()).not.toContain(liqUrls(LIQ_TODAY, '5y').USFEDBAL)
    fireEvent.click(screen.getByTestId('terminal-liq-range-5y'))
    expect(rerun).toHaveBeenLastCalledWith('LIQ 5Y')
    fireEvent.click(screen.getByTestId('terminal-liq-range-2y'))
    expect(rerun).toHaveBeenLastCalledWith('LIQ')
  })

  it('`LIQ 5Y` (the prop the command gives) reads five years and says where the held figures start', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(LIQ_NOW_MS)
    serveLiq('5y')
    mount(<LiquidityPanel range="5y" />, { code: 'LIQ' })
    await screen.findByTestId('terminal-liq-line-words')
    expect(asked()).toContain(liqUrls(LIQ_TODAY, '5y').USFEDBAL)
    expect(asked()).not.toContain(liqUrls(LIQ_TODAY, '2y').USFEDBAL)
    expect(pressed('terminal-liq-range-5y')).toBe('true')
    expect(screen.getByTestId('terminal-liq-net').textContent).toContain('Net liquidity, 5 years, every Wednesday')
    // the fixture holds about two years, so the five-year line starts at the first Wednesday held, said in words
    expect(screen.getByTestId('terminal-liq-held-from').textContent).toMatch(/^The figures held start on /)
  })

  it('pure: the default span is never trimmed; a longer one starts at its first value', () => {
    const pts = (n) => Array.from({ length: n }, (_, i) => ({ pe: new Date(Date.UTC(2031, 2, 19) - (n - 1 - i) * 7 * 864e5).toISOString().slice(0, 10), v: 1, t: 1 }))
    const inputs = { assets: { points: pts(30), meta: null }, tga: { points: pts(30), meta: null }, rrp: { points: pts(30), meta: null } }
    expect(netLiquidityLine(inputs).rows).toHaveLength(105)
    expect(netLiquidityLine(inputs).heldFrom).toBeNull()
    const five = netLiquidityLine(inputs, { weeks: 260 })
    expect(five.rows).toHaveLength(30)
    expect(five.heldFrom).toBe(pts(30)[0].pe)
    expect(netLiquidityLine(inputs, { weeks: 52 }).rows).toHaveLength(53)
  })
})

describe('OIL line span (argument)', () => {
  function serveOil(range) {
    const routes = { [OIL_LATEST_URL]: oilLatest() }
    for (const r of ['2y', range]) for (const s of OIL_SYMBOLS) routes[oilUrls(OIL_TODAY, r)[s]] = oilHistory(s)
    serve(routes)
  }
  it('bare OIL is two years; `OIL 1Y` reads the same history and draws one year; a chip writes the span back', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2031-03-20T16:00:00Z'))
    serveOil('2y')
    const { rerun } = mount(<OilPanel />, { code: 'OIL' })
    const line = await screen.findByTestId('terminal-oil-line')
    expect(line.textContent).toContain('Crude oil stocks, 2 years, weekly')
    fireEvent.click(screen.getByTestId('terminal-oil-range-1y'))
    expect(rerun).toHaveBeenLastCalledWith('OIL 1Y')
    cleanup()
    jsonFetcher.mockClear()
    serveOil('1y')
    mount(<OilPanel range="1y" />, { code: 'OIL' })
    expect((await screen.findByTestId('terminal-oil-line')).textContent).toContain('Crude oil stocks, 1 year, weekly')
    expect(asked()).toContain(oilUrls(OIL_TODAY, '2y').USCRUDEINV)         // one year reads the same 25 months
    expect(screen.getByTestId('terminal-oil-line-words').textContent).toMatch(/53 weeks/)
  })

  it('pure: the stocks line follows the span', () => {
    const pts = Array.from({ length: 300 }, (_, i) => ({ pe: new Date(Date.UTC(2031, 2, 14) - (299 - i) * 7 * 864e5).toISOString().slice(0, 10), v: 400 + i }))
    expect(stocksLine(pts).rows).toHaveLength(105)
    expect(stocksLine(pts, { weeks: 52 }).rows).toHaveLength(53)
    expect(stocksLine(pts, { weeks: 260 }).rows).toHaveLength(261)
    expect(stocksLine(pts.slice(-60), { weeks: 260 })).toMatchObject({ heldFrom: pts[240].pe, gaps: 0 })
  })
})

describe('the settings pass a11y', () => {
  it('the RSL, BRKO and NEWS toolbars have no axe violations', async () => {
    serve((u) => (u === RS_URL ? RANKS : u === NEWS_URL ? ITEMS : SCAN))
    const { container } = mount(<><RsLeadersPanel /><BreakoutPanel /><NewsPanel /></>)
    await screen.findByTestId('terminal-rsl-table')
    await screen.findByTestId('terminal-brko-table')
    await screen.findByTestId('terminal-news-list')
    await expectNoAxeViolations(container)
  })
})
