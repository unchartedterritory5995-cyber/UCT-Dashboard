// app/src/pages/terminal/a11y/todayPanels.axe.test.jsx
//
// RAIL (2026-10-09, lane w9-7): the fourteen panels added or changed on 2026-10-09, rendered with
// real-shaped data and handed to axe-core over the WCAG 2.0 / 2.1 / 2.2 A and AA rules, through the
// one harness the repo already has (journal-2-0/a11y/axeHarness.js: colour contrast is measured
// elsewhere, jsdom has no layout). Each panel is rendered in its LOADED state, the state a member
// spends time in; the scatter is checked in both its chart and its table view.
//
// Beside axe, the behaviours axe cannot see and this lane fixed:
//   * SCAT has a text alternative: the plot is a named image whose name gives the count, the
//     up/down split and the names at both ends of the Y axis, and "Show as table" lists every name
//     with Up or Down in words, each symbol a button the keyboard reaches;
//   * two ETF or two CHK panels on one board do not share an id (they did: fixed heading ids);
//   * SIZE and PLAN fields point at their hint and at the refusal sentence (aria-describedby);
//   * PLAN's buttons disable themselves while they write, so focus moves to the sentence that
//     says what happened instead of dropping to the page;
//   * a link or button's name contains its visible words (WCAG 2.5.3).
//
// The panel list is a fixture list on purpose: each entry needs its own data. The markup rails
// in terminalA11yStatic.test.js are the DERIVED half and walk every panel file every run.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: () => ({ prices: { NVDA: { price: 199, change_pct: 1.2 }, AMD: { price: 150, change_pct: -0.8 } }, isLoading: false, error: null }),
}))

import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelListContext } from '../../../components/terminal'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'
import NewsPanel, { NEWS_URL } from '../panels/NewsPanel'
import RegimePanel, { REGIME_URL, VOCAB_URL } from '../panels/RegimePanel'
import InsiderPanel, { INSIDER_URL } from '../panels/InsiderPanel'
import RsLeadersPanel, { RS_URL } from '../panels/RsLeadersPanel'
import ThemeBoardPanel from '../panels/ThemeBoardPanel'
import { THEMES_URL } from '../panels/imovModel'
import PeerPanel, { PERF_URL, peersUrl } from '../panels/PeerPanel'
import EtfPanel, { ETF_SYMBOLS_URL, familyUrl, holdingsUrl } from '../panels/EtfPanel'
import TwtPanel, { tweetsUrl } from '../panels/TwtPanel'
import SizePanel from '../panels/SizePanel'
import SentimentPanel, { ECON_CATALOG, SENTIMENT_URL } from '../panels/SentimentPanel'
import ScatterPanel, { METRICS_URL, UNIVERSES_URL, dataUrl, scatterSummary } from '../panels/ScatterPanel'
import CheckPanel from '../panels/CheckPanel'
import { RISK_URL, TEMPLATES_URL } from '../panels/checkModel'
import BreakoutPanel, { BRKO_URL, CATALOG_URL } from '../panels/BreakoutPanel'
import PlanPanel from '../panels/PlanPanel'

// ── one route table for every panel ─────────────────────────────────────────────────────────
const pt = (iso, v) => [Math.floor(Date.parse(`${iso}T12:30:00Z`) / 1000), v, iso, iso, 'V']
const ROUTES = {
  [NEWS_URL]: [
    { headline: 'NVDA beats', source: 'Benzinga', url: 'https://x/2', time: '2026-10-09 09:40:00', category: 'EARN', tickers: ['NVDA', 'AMD'], change_pct: 3.2 },
    { headline: 'Older story', source: 'CNBC', url: 'https://x/1', time: '2026-10-09 08:15:00', category: 'MACRO', tickers: [] },
  ],
  [REGIME_URL]: {
    regime: 'bear_trend', label: 'Bear trend', confidence: 0.62, reasons: ['18% above 50MA (broken)', 'VIX 31.2 (fear)'],
    signals: { pct_above_50ma: 18, pct_above_200ma: 29, new_highs: 4, new_lows: 210, vix: 31.2, distribution_days: 7, uct_exposure_rating: 12, market_phase: 'Correction' },
  },
  [VOCAB_URL]: { regimes: [{ id: 'bear_trend', label: 'Bear trend', band: 'RED' }], unknown: { id: 'unknown' } },
  [INSIDER_URL]: [
    { symbol: 'NVDA', name: 'Jane Doe', title: 'director', type: 'buy', shares: 10000, price: 150, amount: 1500000, date: '2026-10-06', filing_date: '2026-10-07' },
    { symbol: 'AMD', name: 'John Roe', title: 'officer: CFO', type: 'buy', shares: 2000, price: 100, amount: 200000, date: '2026-10-08', filing_date: '2026-10-08' },
  ],
  [RS_URL]: [
    { ticker: 'AMD', rs_score: 40.1, rs_rank: 97, returns: { '1w': -2.1, '1m': 8, '3m': 35, '6m': 60 } },
    { ticker: 'NVDA', rs_score: 55.5, rs_rank: 99, returns: { '1w': 3.4, '1m': 12, '3m': 41, '6m': 80 } },
  ],
  [THEMES_URL]: {
    live_as_of: '2026-10-09T14:30:00+00:00',
    themes: [
      { name: 'Semiconductors', ticker: 'SMH', theme_id: 'semis', group_return: { '1d': 2.5 }, holdings: [{ sym: 'NVDA', returns: { '1d': 3 } }] },
      { name: 'Gold Miners', ticker: 'GDX', theme_id: 'gold', group_return: { '1d': -1.5 }, holdings: [{ sym: 'NEM', returns: { '1d': -1 } }] },
    ],
  },
  [peersUrl('NVDA')]: { seed: 'NVDA', group_name: 'AI / GPU Chips', source: 'taxonomy', peers: ['AMD', 'AVGO'], also_in: [{ name: 'Semiconductors' }] },
  [PERF_URL]: { NVDA: { '1w': 2, '1m': 5, '3m': 20, ytd: 60 }, AMD: { '1w': -1, '1m': 3, '3m': 10, ytd: 30 }, AVGO: { '1w': 1, '1m': 2, '3m': 8, ytd: 25 } },
  [familyUrl('NVDA')]: {
    underlying: 'NVDA',
    long: [{ ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA', factor: 2, avg_dollar_vol: 1.2e9 }],
    short: [{ ticker: 'NVDS', name: 'Tradr 1.5x Short NVDA', factor: 1.5, avg_dollar_vol: 3.4e7 }],
  },
  [holdingsUrl('NVDA')]: { holdings: [] },
  [familyUrl('SMH')]: { underlying: null, long: [], short: [] },
  [holdingsUrl('SMH')]: { holdings: [{ sym: 'NVDA', name: 'Nvidia', weight: 20, sector: 'Technology' }, { sym: 'AMD', name: 'AMD', weight: 8, sector: 'Technology' }] },
  [ETF_SYMBOLS_URL]: { symbols: ['SMH'] },
  [tweetsUrl('NVDA')]: [
    { id: '2', created_at: 1_790_003_600, text: '$NVDA newer post', author_handle: 'DeItaone', author_name: 'Walter Bloomberg', url: 'https://x.com/DeItaone/status/2', like_count: 1200, retweet_count: 30 },
    { id: '1', created_at: 1_790_000_000, text: '$NVDA older post', author_handle: 'DeItaone', author_name: 'Walter Bloomberg', url: 'https://x.com/DeItaone/status/1', like_count: 10, retweet_count: 3 },
  ],
  [SENTIMENT_URL]: { rows: [
    { date: '2026-10-08', aaii_bulls: 41.2, aaii_bears: 30.1, aaii_spread: 11.1, aaii_survey_date: '2026-10-07', naaim: 88.5, naaim_date: '2026-10-07', cboe_putcall: 0.82, cnn_fear_greed: 72 },
    { date: '2026-10-01', aaii_bulls: 38.0, aaii_bears: 33.0, aaii_spread: 5.0, aaii_survey_date: '2026-09-30', naaim: 80.0, naaim_date: '2026-09-30', cboe_putcall: 1.0, cnn_fear_greed: 60 },
    { date: '2026-09-09', aaii_bulls: 30.0, aaii_bears: 40.0, aaii_spread: -10.0, aaii_survey_date: '2026-09-09', naaim: 60.0, naaim_date: '2026-09-09', cboe_putcall: 1.1, cnn_fear_greed: 40 },
  ] },
  [ECON_CATALOG]: { series: [{ symbol: 'UST10Y', short_name: '10Y Treasury yield', frequency: 'D', units: { display: '%', fmt: 'pct2', scale: 1 } }] },
  [METRICS_URL]: { metrics: [
    { key: 'rs_rank', label: 'RS Rating', group: 'Momentum', unit: 'num' },
    { key: 'dist_52w_high', label: '% Off 52w High', group: 'Trend', unit: 'pct' },
  ] },
  [UNIVERSES_URL]: { groups: [{ group: 'Indices', items: [{ source: 'index', value: 'sp500', label: 'S&P 500' }] }] },
  [dataUrl('index', 'sp500')]: { tickers: [
    { sym: 'NVDA', dir: 'up', m: { rs_rank: 97, dist_52w_high: -2.5 } },
    { sym: 'AMD', dir: 'up', m: { rs_rank: 88, dist_52w_high: -6 } },
    { sym: 'MID', dir: 'down', m: { rs_rank: 50, dist_52w_high: -20 } },
    { sym: 'LOW', dir: 'down', m: { rs_rank: 20, dist_52w_high: -35 } },
    { sym: 'XYZ', dir: 'down', m: { rs_rank: 12, dist_52w_high: -41 } },
  ] },
  [TEMPLATES_URL]: { templates: [{ name: 'VCP', family: 'Breakout' }, { name: 'Episodic Pivot', family: 'Gap' }] },
  [RISK_URL]: {
    heat: { total_heat_pct: 2.5, position_count: 2, per_position: [], warnings: [] },
    limits: { exposure: 70, max_position: 15, max_positions: 8 },
    regime_phase: 'Pullback', regime_exposure_pct: 70, current_exposure_pct: 60, open_position_count: 3,
  },
  [BRKO_URL]: { total: 2, snapshot_date: '2026-10-08', rows: [
    { ticker: 'NVDA', company: 'Nvidia', price: 200, rs_rank: 98, close_cv_pct: 1.2, pattern_engine_ids: ',flat_base,vcp,', pattern_entry_dist_pct: 1.5, snapshot_date: '2026-10-08' },
    { ticker: 'AMD', company: 'Advanced Micro', price: 100, rs_rank: 91, close_cv_pct: 2.5, pattern_engine_ids: ',bull_flag,', pattern_entry_dist_pct: 4, snapshot_date: '2026-10-08' },
  ] },
  [CATALOG_URL]: { patterns: { vcp: { name: 'VCP', direction: 'bullish' } } },
}
const PREFIX_ROUTES = [
  ['/api/econ/series/UST10Y', { symbol: 'UST10Y', columns: ['t', 'v', 'ps', 'pe', 'pit'], points: [pt('2026-10-06', 4.1), pt('2026-10-07', 4.25)] }],
  ['/api/pre-trade-checklist', {
    symbol: 'NVDA', setup_type: 'VCP', template_found: true,
    regime: { phase: 'Pullback', trend_score: 6, exposure_pct: 70, regime_compatible: false },
    risk: { entry_price: 100, stop_price: 95, stop_distance_pct: 5, position_size_pct: 20, account_risk_pct: 1, max_stop_pct: 8, stop_within_max: true },
    template_rules: { entry_trigger: 'Break of the pivot on volume', stop_method: 'Below the last contraction', invalidation: 'Closes back in the base' },
  }],
  ['/api/setup-performance/', { setup_type: 'VCP', data: { win_rate_pct: 61.5, total_trades: 26, avg_gain_pct: 14.2, avg_loss_pct: -5.1, expectancy: 6.8 } }],
  ['/api/analogs', { analogs: [
    { symbol: 'smci', date_flagged: '2024-01-18', setup_type: 'VCP', status: 'CLOSED', entry_price: 300, pct_change: 42.5, days_held: 21 },
    { symbol: 'ANF', date_flagged: '2023-11-02', setup_type: 'VCP', status: 'STOPPED', entry_price: 70, pct_change: -6.2, days_held: 4 },
  ] }],
  ['/api/live-prices', { NVDA: { price: 199 } }],
]
const failAlerts = { on: false }
function serve() {
  jsonFetcher.mockImplementation(async (url, init) => {
    if (url === '/api/watchlist-alerts' && init?.method === 'POST') {
      if (failAlerts.on) throw Object.assign(new Error('x'), { status: 500 })
      return { id: 1 }
    }
    if (url in ROUTES) return ROUTES[url]
    const hit = PREFIX_ROUTES.find(([p]) => String(url).startsWith(p))
    if (hit) return hit[1]
    throw Object.assign(new Error(`unserved ${url}`), { status: 404 })
  })
}

function renderIn(ui) {
  return render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {ui}
        </PanelListContext.Provider>
      </SWRConfig>
    </MemoryRouter>,
  )
}

beforeEach(() => { serve(); failAlerts.on = false; window.localStorage.clear() })
afterEach(() => { cleanup(); vi.clearAllMocks() })

const typeInto = (testId, value) => fireEvent.change(screen.getByTestId(testId), { target: { value } })
const AXE_MS = 20_000

describe('the 2026-10-09 panels pass axe in their loaded state', () => {
  const CASES = [
    ['NEWS', () => <NewsPanel />, 'terminal-news-list'],
    ['REGM', () => <RegimePanel />, 'terminal-regime-fields'],
    ['INS', () => <InsiderPanel />, 'terminal-insider-table'],
    ['RSL', () => <RsLeadersPanel />, 'terminal-rsl-table'],
    ['THMS', () => <ThemeBoardPanel />, 'terminal-thms-leaders'],
    ['PEER', () => <PeerPanel sym="NVDA" />, 'terminal-peer-table'],
    ['ETF (a stock)', () => <EtfPanel sym="NVDA" />, 'terminal-etf-family'],
    ['ETF (an ETF)', () => <EtfPanel sym="SMH" />, 'terminal-etf-holdings'],
    ['TWT', () => <TwtPanel sym="NVDA" />, 'terminal-twt-list'],
    ['SENT', () => <SentimentPanel />, 'terminal-sent-econ'],
    ['BRKO', () => <BreakoutPanel />, 'terminal-brko-table'],
  ]
  for (const [code, ui, ready] of CASES) {
    it(code, async () => {
      const { container } = renderIn(ui())
      await screen.findByTestId(ready, {}, { timeout: 4000 })
      await expectNoAxeViolations(container)
    }, AXE_MS)
  }

  it('SIZE, filled in and sized', async () => {
    const { container } = renderIn(<SizePanel sym="NVDA" />)
    typeInto('terminal-size-account', '100000')
    typeInto('terminal-size-entry', '100')
    typeInto('terminal-size-stop', '95')
    await screen.findByTestId('terminal-size-table')
    await expectNoAxeViolations(container)
  }, AXE_MS)

  it('SIZE, refusing a stop on the wrong side', async () => {
    const { container } = renderIn(<SizePanel />)
    typeInto('terminal-size-account', '100000')
    typeInto('terminal-size-entry', '100')
    typeInto('terminal-size-stop', '105')
    await screen.findByTestId('terminal-size-error')
    await expectNoAxeViolations(container)
  }, AXE_MS)

  it('CHK, with a setup picked and levels typed', async () => {
    const { container } = renderIn(<CheckPanel sym="NVDA" />)
    const pick = await screen.findByTestId('terminal-chk-setup-pick', {}, { timeout: 4000 })
    fireEvent.change(pick, { target: { value: 'VCP' } })
    typeInto('terminal-chk-entry', '100')
    typeInto('terminal-chk-stop', '95')
    await screen.findByTestId('terminal-chk-checks', {}, { timeout: 4000 })
    await screen.findByTestId('terminal-chk-analogs-table', {}, { timeout: 4000 })
    await expectNoAxeViolations(container)
  }, AXE_MS)

  it('PLAN, a valid plan', async () => {
    const { container } = renderIn(<PlanPanel sym="NVDA" buy="203" stop="195" />)
    await screen.findByTestId('terminal-plan-summary')
    await expectNoAxeViolations(container)
  }, AXE_MS)

  it('SCAT, as a chart and as a table', async () => {
    const { container } = renderIn(<ScatterPanel />)
    await screen.findByTestId('terminal-scat-chart', {}, { timeout: 4000 })
    await expectNoAxeViolations(container)
    fireEvent.click(screen.getByTestId('terminal-scat-as-table'))
    await screen.findByTestId('terminal-scat-table')
    await expectNoAxeViolations(container)
  }, AXE_MS)
})

describe('what axe cannot see', () => {
  it('SCAT: the plot is a named image that gives the count, the split and both ends', async () => {
    renderIn(<ScatterPanel />)
    const chart = await screen.findByTestId('terminal-scat-chart', {}, { timeout: 4000 })
    expect(chart.getAttribute('role')).toBe('img')
    const name = chart.getAttribute('aria-label')
    expect(name).toContain('Scatter of 5 names, RS Rating against % Off 52w High.')
    expect(name).toContain('2 up today, 3 down.')
    expect(name).toContain('Highest RS Rating: NVDA 97.0, AMD 88.0, MID 50.0.')
    expect(name).toContain('Lowest: XYZ 12.0, LOW 20.0.')
  }, AXE_MS)

  it('SCAT: the table lists every name, highest first, Up or Down in words, each a button', async () => {
    const run = vi.fn()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelListContext.Provider value={{ open: vi.fn(), run }}><ScatterPanel /></PanelListContext.Provider>
      </SWRConfig>,
    )
    await screen.findByTestId('terminal-scat-chart', {}, { timeout: 4000 })
    const toggle = screen.getByTestId('terminal-scat-as-table')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    const table = await screen.findByRole('table', { name: /^5 names, RS Rating against % Off 52w High/ })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(
      ['NVDA', 'AMD', 'MID', 'LOW', 'XYZ'].map((s) => `terminal-scat-row-${s}`))
    expect(within(rows[0]).getByText('Up')).toBeTruthy()
    expect(within(rows[4]).getByText('Down')).toBeTruthy()
    fireEvent.click(within(rows[4]).getByRole('button', { name: 'Load XYZ' }))
    expect(run).toHaveBeenCalledWith('$XYZ')
  }, AXE_MS)

  it('SCAT: the summary is empty with no points and stops at the top names for a short list', () => {
    const meta = { label: 'Y', unit: 'num' }
    expect(scatterSummary([], meta, meta)).toBe('')
    const two = scatterSummary([{ sym: 'A', x: 1, y: 2, dir: 'up' }, { sym: 'B', x: 1, y: 1, dir: 'down' }], meta, meta)
    expect(two).toContain('Highest Y: A 2.0, B 1.0.')
    expect(two).not.toContain('Lowest')
  })

  it('two ETF panels and two CHK panels on one board share no id', async () => {
    const { container } = renderIn(
      <>
        <EtfPanel sym="NVDA" />
        <EtfPanel sym="SMH" />
        <CheckPanel sym="NVDA" />
        <CheckPanel sym="AMD" />
      </>,
    )
    await screen.findByTestId('terminal-etf-holdings', {}, { timeout: 4000 })
    await waitFor(() => expect(screen.getAllByTestId('terminal-chk-setup-pick')).toHaveLength(2), { timeout: 4000 })
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id)
    expect(ids.length).toBeGreaterThanOrEqual(8)
    expect(new Set(ids).size).toBe(ids.length)
    for (const section of container.querySelectorAll('section[aria-labelledby]')) {
      const label = container.querySelector(`[id="${section.getAttribute('aria-labelledby')}"]`)
      expect(label && section.contains(label)).toBe(true)
    }
  }, AXE_MS)

  it('SIZE: a field points at its hint, and every field points at the refusal', async () => {
    renderIn(<SizePanel />)
    const risk = screen.getByTestId('terminal-size-risk')
    const hintId = risk.getAttribute('aria-describedby')
    expect(document.getElementById(hintId).textContent).toMatch(/^Default /)
    typeInto('terminal-size-account', '100000')
    typeInto('terminal-size-entry', '100')
    typeInto('terminal-size-stop', '105')
    const err = await screen.findByTestId('terminal-size-error')
    for (const key of ['account', 'risk', 'entry', 'stop']) {
      expect(screen.getByTestId(`terminal-size-${key}`).getAttribute('aria-describedby').split(' ')).toContain(err.id)
    }
  })

  it('CHK: entry and stop point at the levels sentence when it shows', async () => {
    renderIn(<CheckPanel sym="NVDA" />)
    await screen.findByTestId('terminal-chk-setup-pick', {}, { timeout: 4000 })
    typeInto('terminal-chk-entry', '100')
    typeInto('terminal-chk-stop', '105')
    const err = await screen.findByTestId('terminal-chk-levels-error')
    expect(err.id).toBeTruthy()
    for (const key of ['entry', 'stop']) {
      expect(screen.getByTestId(`terminal-chk-${key}`).getAttribute('aria-describedby').split(' ')).toContain(err.id)
    }
  }, AXE_MS)

  it('PLAN: a keyboard press that disables its button moves focus to the result sentence', async () => {
    renderIn(<PlanPanel sym="NVDA" buy="203" stop="195" />)
    const btn = screen.getByTestId('terminal-plan-set-alerts')
    btn.focus()
    expect(document.activeElement).toBe(btn)
    fireEvent.click(btn)
    const out = await screen.findByTestId('terminal-plan-alerts-result')
    await waitFor(() => expect(document.activeElement).toBe(out))
    expect(out.getAttribute('role')).toBe('status')
    expect(out.getAttribute('tabindex')).toBe('-1')
  })

  it('PLAN: a failed write moves focus to the alert, and a mouse press never steals focus', async () => {
    failAlerts.on = true
    renderIn(<PlanPanel sym="NVDA" buy="203" stop="195" />)
    const btn = screen.getByTestId('terminal-plan-set-alerts')
    btn.focus()
    fireEvent.click(btn)
    const out = await screen.findByTestId('terminal-plan-alerts-result')
    await waitFor(() => expect(document.activeElement).toBe(out))
    expect(out.getAttribute('role')).toBe('alert')
    // The journal button was pressed without focus (a pointer): nothing is moved.
    const field = screen.getByTestId('terminal-plan-target')
    field.focus()
    fireEvent.click(screen.getByTestId('terminal-plan-log-journal'))
    await screen.findByTestId('terminal-plan-journal-result')
    expect(document.activeElement).toBe(field)
  })

  it('names contain the visible words (WCAG 2.5.3, label in name)', async () => {
    renderIn(<><PlanPanel sym="NVDA" buy="203" stop="195" /><TwtPanel sym="NVDA" /><CheckPanel sym="NVDA" /></>)
    fireEvent.click(screen.getByTestId('terminal-plan-set-alerts'))
    await screen.findByTestId('terminal-plan-alerts-result')
    await screen.findByTestId('terminal-twt-list', {}, { timeout: 4000 })
    await screen.findByTestId('terminal-chk-links', {}, { timeout: 4000 })
    const named = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('link'),
    ].filter((el) => el.getAttribute('aria-label'))
    expect(named.length).toBeGreaterThanOrEqual(5)
    for (const el of named) {
      const visible = el.textContent.replace(/\s+/g, ' ').trim()
      if (!visible) continue
      expect(el.getAttribute('aria-label').toLowerCase(), `"${visible}"`).toContain(visible.toLowerCase())
    }
  }, AXE_MS)
})
