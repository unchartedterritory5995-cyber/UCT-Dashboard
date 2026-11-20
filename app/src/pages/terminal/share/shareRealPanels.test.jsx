// Share a panel: REAL panels, rendered with sample data, read by the real reader.
//
// The reader is written against the markup the panels really draw, so it is proven against
// that markup, not against a table typed for the test:
//   TOPF  merged two-line cells, a row number inside the ticker's own cell, the kit's symbol
//         button WITH a watchlist star, a "showing the first N of M" line, phone-folded columns;
//   RSL   sort buttons and a caret inside every header, a column of row numbers, signed returns;
//   PERF  the member's own numbers (the class that shares today), a wrapping first column, a
//         small-sample note inside a cell, and a `<select>` and an SVG chart beside the table.
//
// ⛔ In each: the rows read are the rows on screen, in the order shown, and never one more.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-07-06' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import { WatchMarksContext, buildWatchMarks } from '../../../components/terminal/watchMarks'
import TopFlowPanel, { PAGE_ROWS, TOP_FLOW_URL } from '../panels/TopFlowPanel'
import RsLeadersPanel, { RS_URL } from '../panels/RsLeadersPanel'
import PerformancePanel, { ACCOUNTS_URL, METRICS_REGISTRY_URL, analyticsUrl, metricsUrl, registryRead } from '../panels/PerformancePanel'
import { cellLines, readPanel } from './shareRead'
import { BOM, toCsv } from './shareText'

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

/** Serve each route its body; anything else is a 500 (a panel asking for more than its routes fails loudly). */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => (url in routes ? Promise.resolve(routes[url])
    : Promise.reject(Object.assign(new Error(`unserved ${url}`), { status: 500 }))))
}

const MARKS = buildWatchMarks([{ name: 'Leaders', items: [{ sym: 'ZZA' }, { sym: 'NVDA' }] }], [])
let report = null
function renderIn(code, body) {
  report = null
  const api = { open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <WatchMarksContext.Provider value={MARKS}>
        <PanelFreshnessContext.Provider value={(r) => { if (r) report = r }}>
          <PanelListContext.Provider value={api}>
            <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider>
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </WatchMarksContext.Provider>
    </SWRConfig>,
  )
  return view.container
}

/** jsdom applies no stylesheet. The panels fold columns away on a phone with their CSS module's
 *  `phoneHide` class; this stands in for that one rule, at phone width or not. */
const styleAt = (phone) => (el) => {
  const cls = typeof el.className === 'string' ? el.className : ''
  return { display: phone && /phoneHide/.test(cls) ? 'none' : '', visibility: '', color: '', textAlign: '', fontWeight: '' }
}
const wide = (root) => readPanel(root, { getStyle: styleAt(false) })
const phone = (root) => readPanel(root, { getStyle: styleAt(true) })
const grid = (table) => table.rows.filter((r) => r.cells).map((r) => r.cells.map((c) => cellLines(c)))
const heads = (table) => table.columns.map((c) => c.text)
const onScreen = (root) => root.querySelectorAll('tbody tr').length

// ── TOPF: the store's real shape (api/top_flow_tracker.py), with made-up tickers ──
const snap = (date, price, oi = 1000) => ({ date, price, oi, spot: 150, volume: 200 })
const pick = (over = {}) => ({
  id: `${over.sym || 'ZZA'}|C|200.0|8/21/2026`, sym: 'ZZA', cp: 'C', strike: 200, exp: '8/21/2026', entry: 2.0, grade: 'A', dir: 'BULL', cap: 'Large',
  dateSaved: '2026-07-01', hits: 4, prem: 1500000, history: [snap('7/1/2026', 2.0), snap('7/2/2026', 3.0, 1300), snap('7/6/2026', 2.5, 900)],
  ...over,
})
const STORE = {
  active: [
    pick(),
    pick({ sym: 'ZZB', cp: 'P', strike: 27.5, exp: '6/20', entry: 1.2, grade: 'A+', dir: 'BEAR', dateSaved: '2026-07-06', history: [snap('7/6/2026', 1.3)] }),
    pick({ sym: 'ZZC', strike: 50, exp: '9/18/2026', entry: 5.0, grade: 'B', dir: 'BEAR', dateSaved: '2026-06-22', history: [snap('6/22/2026', 5.0), snap('7/6/2026', 2.0)] }),
  ],
  archived: [],
}

describe('TOPF, a real list panel', () => {
  it('reads the rows on screen: two-line cells, plain tickers, row numbers beside the rows', async () => {
    serve({ [TOP_FLOW_URL]: STORE })
    const root = renderIn('TOPF', <TopFlowPanel />)
    await screen.findByTestId('terminal-topf-table')
    const out = wide(root)
    expect(out.rowCount).toBe(onScreen(root))
    expect(out.rowCount).toBe(3)
    const [t] = out.tables
    expect(heads(t)).toEqual(['Symbol', 'Contract', 'Grade', 'Entry', 'Latest price', 'Peak'])
    expect(grid(t)).toEqual([
      [['ZZA'], ['$200 call', 'exp 8/21/2026'], ['A', 'Bullish'], ['$2.00', 'on 2026-07-01'], ['$2.50 +25.0%', 'as of 2026-07-06'], ['+50.0%', '5 days']],
      [['ZZC'], ['$50 call', 'exp 9/18/2026'], ['B', 'Bearish'], ['$5.00', 'on 2026-06-22'], ['$2.00 -60.0%', 'as of 2026-07-06'], ['+0.0%', '14 days']],
      [['ZZB'], ['$27.50 put', 'exp 6/20'], ['A+', 'Bearish'], ['$1.20', 'on 2026-07-06'], ['Too new to score', '1 daily price so far'], ['n/a']],
    ])
    expect(t.rows.map((r) => r.no)).toEqual(['1', '2', '3'])
  })

  it('the watchlist star is on screen for ZZA and is in neither the rows nor the file', async () => {
    serve({ [TOP_FLOW_URL]: STORE })
    const root = renderIn('TOPF', <TopFlowPanel />)
    await screen.findByTestId('terminal-topf-table')
    // The star really is drawn, with its words in the button's name and the icon's title ...
    const cell = screen.getByTestId('panel-symbol-ZZA')
    expect(cell.querySelector('[data-testid="watch-mark"]')).toBeTruthy()
    expect(cell.getAttribute('aria-label')).toMatch(/on your watchlist/)
    // ... and none of it is shared.
    const out = wide(root)
    expect(JSON.stringify(out)).not.toMatch(/watchlist|Leaders|Load ZZA|linked panels/i)
    const csv = toCsv(out, { code: 'TOPF', command: 'TOPF', label: 'Top Flow picks', report }, new Date('2026-07-06T20:00:00Z'))
    expect(csv).not.toMatch(/watchlist|Leaders|Load ZZ/i)
    expect(csv.replace(BOM, '').split('\r\n').filter((l) => /^ZZ[A-C],/.test(l)).map((l) => l.split(',')[0])).toEqual(['ZZA', 'ZZC', 'ZZB'])
  })

  it('at phone width the folded columns are gone; the chips change what is read, and it is never more than is shown', async () => {
    serve({ [TOP_FLOW_URL]: STORE })
    const root = renderIn('TOPF', <TopFlowPanel />)
    await screen.findByTestId('terminal-topf-table')
    const small = phone(root)
    expect(heads(small.tables[0])).toEqual(['Symbol', 'Contract', 'Latest price'])
    expect(grid(small.tables[0])[0]).toEqual([['ZZA'], ['$200 call', 'exp 8/21/2026'], ['$2.50 +25.0%', 'as of 2026-07-06']])
    // The member narrows the list to bearish picks: the share holds those rows and no others.
    fireEvent.click(screen.getByTestId('terminal-topf-direction-bearish'))
    const bears = wide(root)
    expect(bears.rowCount).toBe(onScreen(root))
    expect(grid(bears.tables[0]).map((r) => r[0][0])).toEqual(['ZZC', 'ZZB'])
    expect(bears.tables[0].rows.map((r) => r.no)).toEqual(['1', '2'])
  })

  it('carries the panel\'s own "showing the first N of M", and the header report names the source', async () => {
    const total = PAGE_ROWS + 7
    const many = { active: Array.from({ length: total }, (_, i) => pick({ sym: `ZQ${String.fromCharCode(65 + (i % 26))}`, id: `p${i}`, strike: 100 + i })), archived: [] }
    serve({ [TOP_FLOW_URL]: many })
    const root = renderIn('TOPF', <TopFlowPanel />)
    await screen.findByTestId('terminal-topf-table')
    const out = wide(root)
    // ⛔ The store holds more picks than the panel draws: the share holds what is drawn, not the store.
    expect(out.rowCount).toBe(onScreen(root))
    expect(out.rowCount).toBe(PAGE_ROWS)
    expect(out.rowCount).toBeLessThan(total)
    // The panel's own sentence, word for word (its next sentence, about the panel's limit, is not a cut).
    const said = screen.getByTestId('terminal-topf-cut').textContent.trim()
    expect(out.notes).toHaveLength(1)
    expect(out.notes[0].startsWith(`Showing the first ${PAGE_ROWS} of ${total}, `)).toBe(true)
    expect(said.startsWith(out.notes[0])).toBe(true)
    expect(report.source).toMatch(/UCT options flow tape/)
    const csv = toCsv(out, { code: 'TOPF', command: 'TOPF', label: 'Top Flow picks', report }, new Date('2026-07-06T20:00:00Z'))
    expect(csv.split('\r\n')[1]).toBe(`"${out.notes[0]}"`)
    expect(csv.split('\r\n')[0]).toContain('As of 2026-07-06')
    expect(csv.split('\r\n').filter((l) => /^ZQ[A-Z],/.test(l))).toHaveLength(PAGE_ROWS)
  })
})

// ── RSL ──
const RANKS = [
  { ticker: 'AMD', rs_score: 40.1, rs_rank: 97, returns: { '1w': -2.1, '1m': 8, '3m': 35, '6m': 60 } },
  { ticker: 'NVDA', rs_score: 55.5, rs_rank: 99, returns: { '1w': 3.4, '1m': 12, '3m': 41, '6m': 80 } },
  { ticker: 'XYZ', rs_score: -10, rs_rank: 2, returns: { '1w': -1, '1m': -5, '3m': -20, '6m': null } },
]

describe('RSL, a real sortable list', () => {
  it('header names carry no sort button or caret; the row-number column is a column; the star is not read', async () => {
    serve({ [RS_URL]: RANKS })
    const root = renderIn('RSL', <RsLeadersPanel />)
    await screen.findByTestId('terminal-rsl-table')
    const out = wide(root)
    const [t] = out.tables
    expect(heads(t)).toEqual(['#', 'Symbol', 'RS rank', 'Score', '1W', '1M', '3M', '6M'])
    expect(grid(t)).toEqual([
      [['1'], ['NVDA'], ['99'], ['55.50'], ['+3.4%'], ['+12.0%'], ['+41.0%'], ['+80.0%']],
      [['2'], ['AMD'], ['97'], ['40.10'], ['-2.1%'], ['+8.0%'], ['+35.0%'], ['+60.0%']],
      [['3'], ['XYZ'], ['2'], ['-10.00'], ['-1.0%'], ['-5.0%'], ['-20.0%'], ['\u2014']],
    ])
    expect(out.rowCount).toBe(onScreen(root))
    expect(screen.getByTestId('panel-symbol-NVDA').querySelector('[data-testid="watch-mark"]')).toBeTruthy()
    expect(JSON.stringify(out)).not.toMatch(/watchlist|Leaders/i)
    expect(out.notes).toEqual(['The top 3 of 3 names by RS rank.'])
  })

  it('after the member sorts, the share is in the order shown, and the caret is still not in the name', async () => {
    serve({ [RS_URL]: RANKS })
    const root = renderIn('RSL', <RsLeadersPanel />)
    await screen.findByTestId('terminal-rsl-table')
    fireEvent.click(screen.getByTestId('terminal-rsl-sort-w1'))
    expect(screen.getByTestId('terminal-rsl-sort-w1').textContent).toMatch(/[\u25B2\u25BC\u2191\u2193]/)
    const [t] = wide(root).tables
    expect(grid(t).map((r) => r[1][0])).toEqual(['NVDA', 'XYZ', 'AMD'])
    expect(heads(t)).toEqual(['#', 'Symbol', 'RS rank', 'Score', '1W', '1M', '3M', '6M'])
    expect(heads(phone(root).tables[0])).toEqual(['#', 'Symbol', 'RS rank', '3M'])
  })
})

// ── PERF: the routes' real shapes (api/services/journal_two), made-up numbers ──
const account = (id, name) => ({ id, userId: 'u-test', name, color: 'gold', broker: null, startingBalance: 100000.0, goals: {}, balanceSource: 'manual' })
const VOCABULARY = ['net_pnl', 'gross_pnl', 'fees', 'trades', 'wins', 'losses', 'win_rate', 'avg_win', 'avg_loss', 'payoff', 'profit_factor',
  'expectancy', 'days_traded', 'profitable_days', 'avg_true_r', 'max_drawdown']
const REGISTRY = [
  { key: 'payoff_kelly', title: 'Payoff & Kelly', description: 'Average win vs average loss.', category: 'risk' },
  { key: 'custom', title: 'Custom KPI', description: 'Your own formula', category: 'custom', vocabulary: VOCABULARY },
]
const kpi = (name, value) => ({ name, expr: name, value, error: null })
const METRICS = {
  metrics: { payoff_kelly: { decisive: 23, minDecisive: 20, avgWin: 420.5, avgLoss: 180.25, payoff: 2.333, winRate: 0.6087, kelly: 0.441, halfKelly: 0.2205 } },
  custom: [kpi('wins', 14), kpi('losses', 9), kpi('profit_factor', 3.6289), kpi('expectancy', 177.7917)],
  unknownKeys: [], tradeCount: 24, rSources: { stop: 15, trueR: 6, none: 3 },
}
const setup = (name, totalPnl, winRate, avgR, n) => ({ setup: name, totalPnl, winRate, avgR, tradeCount: n, sampleSize: n, lowConfidence: n < 10 })
const ANALYTICS = {
  tradeCount: 24, strategyCount: 0, dateRange: { from: null, to: null }, rSources: { stop: 15, trueR: 6, none: 3 },
  equity: {
    kpis: { peakPnl: 4250.0, maxDrawdown: -450.0, maxDrawdownPct: -0.004489, currentDrawdown: 0.0, longestUnderwaterDays: 1 },
    curve: [{ date: '2026-09-01', equity: 100250.0, drawdown: 0.0 }, { date: '2026-11-13', equity: 104250.0, drawdown: 0.0 }],
  },
  attribution: {
    bySetup: [setup('Breakout', 3600.0, 0.6667, 0.85, 12), setup('Pullback', 900.0, 0.5, null, 2), setup('Earnings gap', -400.0, 0.25, -0.3, 4)],
    bySymbol: [], rollingWinRate: { windows: {} },
  },
  edgeScore: { score: 1.2345, components: { winRate: 0.6087, profitFactor: 3.629, rConsistency: 0.5589, tradeCount: 24 }, trend: [] },
  risk: {
    coverageReady: true, tradeCount: 24, decisiveCount: 23, noRCount: 3, rHistogram: [], expectancyR: 0.412,
    drawdown: { maxDrawdownDollar: 450.0, currentDrawdownDollar: 0.0, peakDate: '2026-09-01', troughDate: '2026-09-15' },
    streaks: { longestWin: 5, longestLoss: 2, current: { type: 'win', length: 2 } },
    lossStreakOdds: { winRate: 0.6087, k: 5, perYear: 1.4 },
  },
}

describe('PERF, the member\'s own numbers (the class that shares today)', () => {
  const routes = () => ({
    [ACCOUNTS_URL]: { accounts: [account('acc-1', 'Default')] },
    [METRICS_REGISTRY_URL]: REGISTRY,
    [metricsUrl({ accountId: 'acc-1', registry: registryRead(REGISTRY) })]: METRICS,
    [analyticsUrl({ accountId: 'acc-1' })]: ANALYTICS,
  })

  it('reads the by-setup table as shown: best expectancy first, the small-sample words kept in the cell', async () => {
    serve(routes())
    const root = renderIn('PERF', <PerformancePanel />)
    await screen.findByTestId('terminal-perf-setup-table')
    const out = wide(root)
    expect(out.tables).toHaveLength(1)
    expect(out.rowCount).toBe(onScreen(root))
    const [t] = out.tables
    expect(heads(t)).toEqual(['Setup', 'Trades', 'Win rate', 'Expectancy', 'Average R', 'Total profit or loss'])
    expect(grid(t)).toEqual([
      [['Pullback'], ['2 (small sample, 10 needed)'], ['50.0%'], ['+$450.00'], ['R not known'], ['+$900.00']],
      [['Breakout'], ['12'], ['66.7%'], ['+$300.00'], ['+0.85R'], ['+$3,600.00']],
      [['Earnings gap'], ['4 (small sample, 10 needed)'], ['25.0%'], ['-$100.00'], ['-0.30R'], ['-$400.00']],
    ])
    // The header report the frame keeps is what the picture and the file name as the source.
    expect(report.source).toBe('Your journal')
    // Nothing from the equity chart's SVG, the account line or the method note is in the rows.
    expect(JSON.stringify(out.tables)).not.toMatch(/equity|Journal|Account/i)
    expect(out.notes).toEqual([])
  })

  it('at phone width the two folded columns are gone from the file too', async () => {
    serve(routes())
    const root = renderIn('PERF', <PerformancePanel />)
    await screen.findByTestId('terminal-perf-setup-table')
    const small = phone(root)
    expect(heads(small.tables[0])).toEqual(['Setup', 'Trades', 'Win rate', 'Expectancy'])
    const csv = toCsv(small, { code: 'PERF', command: 'PERF', label: 'My trading stats (from your Journal)', report }, new Date('2026-11-17T20:45:00Z'))
    const lines = csv.replace(BOM, '').split('\r\n')
    expect(lines[0]).toContain('My trading stats (from your Journal) (PERF)')
    expect(lines[0]).toContain('Source: Your journal')
    expect(lines[2]).toBe('Setup,Trades,Win rate,Expectancy')
    expect(lines[3]).toBe('Pullback,"2 (small sample, 10 needed)",50.0%,+$450.00')
    expect(lines).toHaveLength(7)
  })
})
