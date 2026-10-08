// An UNKNOWN reporting currency prints no symbol and says so (owner decision 2026-10-07).
//
// FA and EE show a filer's own statements and the consensus on them, which are in its
// REPORTING currency. When the payload does not state that currency, a "$" is a guess —
// EstimateHistory's rule is "never a guessed $". So: unknown -> no symbol and a short
// "Currency not reported." note; known USD stays "$"; known foreign stays its ISO code.
// ANR price targets and OWN holder values ARE US dollars (US listing / 13F): they keep "$"
// and say USD in their labels.
//
// Rendered text is asserted, not state (CLAUDE.md: user-facing feedback by rendered DOM text).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../research-kit', () => ({
  SeriesChart: (p) => <div data-testid="chart" data-label={p.label || ''}
    data-tick={p.valueFormatter ? p.valueFormatter(1.59e9) : ''} />,
  MetricTrendChart: (p) => <div data-testid="trend" data-label={p.label || ''}
    data-tick={p.valueFormatter ? p.valueFormatter(2.5) : ''} />,
  CoverageNote: () => null,
  EmptyState: ({ title }) => <div data-testid="empty-state">{title}</div>,
}))

const fin = { data: null }
vi.mock('../../../pages/research/hooks/useFinancials', () => ({
  default: () => ({ data: fin.data, isLoading: false, error: false }),
}))

import FinancialsDeep from './FinancialsDeep'
import ConsensusEstimates from './ConsensusEstimates'
import StatementPanels from '../sections/StatementPanels'
import FinancialsTab from '../../../pages/research/tabs/FinancialsTab'
import { buildTable, fmtEps, fmtMoney } from './depthFormat'
import {
  CURRENCY_NOT_REPORTED, currencyPrefix, formatCurrency, formatCurrencyIn, isKnownCurrency,
  relabelDollarText, reportingCurrencyNote,
} from '../../../lib/presentation/presentationPrimitives'

const NONE = { unknown: 'none' }

const row = (y, eps, rev) => ({
  period_end: `${y}-12-31`, label: `FY${y}`,
  eps: { avg: eps, low: eps * 0.9, high: eps * 1.05, n: 20 },
  revenue: { avg: rev, low: rev * 0.95, high: rev * 1.04, n: 18 },
  eps_growth: 25, revenue_growth: 20, ebitda_avg: rev * 0.7, net_income_avg: rev * 0.45,
})
const consensus = (currency, rows) => ({
  state: 'ok', source: 'FMP /stable/analyst-estimates', fetched_at: 1759500000, annual: rows, quarterly: [], currency,
})
const estimates = (c, extra = {}) => ({
  sym: 'X', entity: null, forward: [], revisions: [], consensus: c,
  sources: { forward: 'Yahoo Finance', revisions: 'Yahoo Finance', consensus: 'FMP' },
  reporting_currency: c?.currency ?? null, ...extra,
})
const Q = ['Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026']
const history = (sym, currency) => ({
  sym, period: 'quarter', periods: Q, dates: Q.map(() => '2026-06-30'), count: 4, currency,
  series: { revenue: [1.1e12, 1.2e12, 1.13e12, 1.27e12], net_income: [4e11, 4.2e11, 4.5e11, 5e11],
    eps: [15.5, 16.2, 17.4, 19.3] },
  ratios: {},
  source: { vendor: 'FMP', basis: 'fiscal', endpoints: ['/stable/income-statement'], fetched_at: 1759500000 },
})

let routes
beforeEach(() => {
  routes = {}
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const r = Object.entries(routes).find(([k]) => url.startsWith(k))
    if (!r) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => r[1] }
  }))
})
afterEach(() => { vi.unstubAllGlobals(); fin.data = null })

const mount = (node) => render(
  <AuthContext.Provider value={{}}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      {node}
    </SWRConfig>
  </AuthContext.Provider>,
)

describe('the currency primitives — the opt-in "unknown means no symbol" rule', () => {
  it('unknown under { unknown: "none" } prints no symbol, inside or outside the sign', () => {
    expect(currencyPrefix(null, NONE)).toBe('')
    expect(currencyPrefix('not-a-code', NONE)).toBe('')
    expect(formatCurrencyIn(2.9, null, NONE)).toBe('2.90')
    expect(formatCurrencyIn(-2.9, undefined, NONE)).toBe('-2.90')
    expect(formatCurrencyIn(null, null, NONE)).toBe('—')
    expect(relabelDollarText('-$450.0M', null, NONE)).toBe('-450.0M')
    expect(reportingCurrencyNote(null, NONE)).toBe(CURRENCY_NOT_REPORTED)
    expect(CURRENCY_NOT_REPORTED).toBe('Currency not reported.')
  })

  it('known USD stays "$" and known foreign stays its code, under either rule', () => {
    for (const opts of [undefined, NONE]) {
      expect(currencyPrefix('USD', opts)).toBe('$')
      expect(formatCurrencyIn(4, 'usd', opts)).toBe('$4.00')
      expect(relabelDollarText('$1.59B', 'USD', opts)).toBe('$1.59B')
      expect(reportingCurrencyNote('USD', opts)).toBeNull()
      expect(formatCurrencyIn(535.87, 'TWD', opts)).toBe('TWD 535.87')
      expect(relabelDollarText('-$450.0M', 'JPY', opts)).toBe('-JPY 450.0M')
      expect(reportingCurrencyNote('TWD', opts)).toMatch(/^Figures in TWD/)
    }
  })

  it('the default is unchanged: unknown still renders "$" for callers that did not opt in', () => {
    // Every other surface (FlowScoreboard's contract prefix, the /charts widgets) keeps its "$".
    for (const v of [4, -2.9, 0, null]) expect(formatCurrencyIn(v, null)).toBe(formatCurrency(v))
    expect(currencyPrefix(null)).toBe('$')
    expect(reportingCurrencyNote(null)).toBeNull()
    expect(isKnownCurrency('USD')).toBe(true)
    expect(isKnownCurrency(null)).toBe(false)
  })

  it('the FA/EE grammar applies it: depthFormat money and EPS are bare for unknown', () => {
    expect(fmtMoney(1.27e12, null)).toBe('1.27T')
    expect(fmtMoney(1.27e12, 'USD')).toBe('$1.27T')
    expect(fmtEps(19.3, null)).toBe('19.30')
    expect(fmtEps(19.3, 'USD')).toBe('$19.30')
    const cells = buildTable(history('X', null), 'income').rows.flatMap((r) => r.cells)
    expect(cells.join(' ')).not.toContain('$')
  })
})

describe('EE — an unknown reporting currency', () => {
  it('FMP consensus with no currency: no "$" anywhere, and the card says "Currency not reported."', async () => {
    routes['/api/research/estimates/XYZ?consensus=1'] = estimates(consensus(null, [row(2026, 4, 2e11), row(2027, 5, 2.3e11)]))
    mount(<ConsensusEstimates sym="XYZ" />)
    const card = await screen.findByTestId('ee-consensus')
    const first = within(within(card).getByRole('table')).getAllByRole('row')[1]
    expect(first).toHaveTextContent('4.00')
    expect(first).toHaveTextContent('200.00B')
    expect(card).not.toHaveTextContent('$')
    expect(within(card).getByTestId('ee-currency')).toHaveTextContent('Currency not reported.')
    expect(within(card).getByTestId('chart')).toHaveAttribute('data-tick', '1590000000.00')
  })

  it('a KNOWN USD consensus still reads "$" with no note (control)', async () => {
    routes['/api/research/estimates/NVDA?consensus=1'] = estimates(consensus('USD', [row(2026, 4, 2e11), row(2027, 5, 2.3e11)]))
    mount(<ConsensusEstimates sym="NVDA" />)
    const card = await screen.findByTestId('ee-consensus')
    expect(within(within(card).getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('$4.00')
    expect(within(card).queryByTestId('ee-currency')).toBeNull()
  })

  it('the Yahoo fallback with no reporting currency: bare EPS and revenue, with the note', async () => {
    routes['/api/research/estimates/XYZ?consensus=1'] = estimates(
      { state: 'empty', annual: [], quarterly: [], currency: null },
      { forward: [{ period: 'Current Yr', eps_avg: 16.95, eps_low: 15.23, eps_high: 17.8,
        num_analysts: 20, eps_growth: 30, rev_avg: 5.443e12 }],
      revisions: [{ period: 'Current Yr', current: 16.95, ago30: 16.5, ago90: 15.9, up30: 4, down30: 0 }] })
    mount(<ConsensusEstimates sym="XYZ" />)
    const fb = await screen.findByTestId('ee-fallback')
    expect(fb).toHaveTextContent('16.95')
    expect(fb).toHaveTextContent('5.44T')
    expect(fb).not.toHaveTextContent('$')
    expect(within(fb).getByTestId('ee-yahoo-currency')).toHaveTextContent('Currency not reported.')
    const revs = screen.getByTestId('ee-revisions')
    expect(revs).not.toHaveTextContent('$')
    expect(within(revs).getByTestId('ee-revisions-currency')).toHaveTextContent('Currency not reported.')
  })
})

describe('FA — an unknown reporting currency', () => {
  it('statement tables and panels carry no "$" and both say "Currency not reported."', async () => {
    routes['/api/research/financial-history/XYZ?period=quarter'] = history('XYZ', null)
    mount(<FinancialsDeep sym="XYZ" />)
    const tables = await screen.findByTestId('statement-tables')
    const table = await within(tables).findByRole('table')
    const revenue = within(table).getAllByRole('row').find((r) => r.getAttribute('data-row') === 'revenue')
    expect(revenue).toHaveTextContent('1.27T')
    expect(table).not.toHaveTextContent('$')
    expect(within(tables).getByTestId('fa-currency')).toHaveTextContent('Currency not reported.')
    expect(await screen.findByTestId('panels-currency')).toHaveTextContent('Currency not reported.')
    const ticks = screen.getAllByTestId('chart').map((c) => c.getAttribute('data-tick'))
    expect(ticks).toContain('1.59B')
    expect(ticks.join(' ')).not.toContain('$')
  })

  it('a KNOWN USD filer is unchanged: "$" and no note (control)', async () => {
    routes['/api/research/financial-history/NVDA?period=quarter'] = history('NVDA', 'USD')
    mount(<StatementPanels sym="NVDA" />)
    expect((await screen.findAllByTestId('chart')).map((c) => c.getAttribute('data-tick'))).toContain('$1.59B')
    expect(screen.queryByTestId('panels-currency')).toBeNull()
  })

  it('the yfinance fallback tab: unknown currency is bare with the note; USD keeps "$"', () => {
    const base = {
      sym: 'XYZ',
      quarterly: [
        { period: 'Q4 2024', revenue: 1.1e11, eps: 2.2, revenue_yoy: 10, eps_yoy: -5 },
        { period: 'Q3 2024', revenue: 1.0e11, eps: 2.0, revenue_yoy: 9, eps_yoy: 4 },
      ],
      annual: [], balance: {}, metrics: {},
    }
    fin.data = { ...base, currency: null }
    const { unmount } = render(<FinancialsTab sym="XYZ" />)
    expect(screen.getByText('110.00B')).toBeInTheDocument()
    expect(screen.queryByText('$110.00B')).toBeNull()
    expect(screen.getByTestId('financials-currency')).toHaveTextContent('Currency not reported.')
    const rev = screen.getAllByTestId('trend').find((t) => t.getAttribute('data-label').startsWith('Revenue'))
    expect(rev).toHaveAttribute('data-label', 'Revenue (B)')
    expect(rev).toHaveAttribute('data-tick', '2.5B')
    unmount()

    fin.data = { ...base, currency: 'USD' }
    render(<FinancialsTab sym="XYZ" />)
    expect(screen.getByText('$110.00B')).toBeInTheDocument()
    expect(screen.queryByTestId('financials-currency')).toBeNull()
    expect(screen.getAllByTestId('trend').find((t) => t.getAttribute('data-label').startsWith('Revenue')))
      .toHaveAttribute('data-label', 'Revenue ($B)')
  })
})
