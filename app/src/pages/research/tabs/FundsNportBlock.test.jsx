// app/src/pages/research/tabs/FundsNportBlock.test.jsx
//
// The OWN panel's Funds (N-PORT) block on screen: the summary, the period line, the sortable funds table (20 rows,
// the rest on request), the change words, the sold-out list, the match and coverage lines, the source line, each
// state with no table, no screen-reader text inside the scrolling table, and axe. Placed below the 13F block in
// OwnershipTab. Every fund, trust, ticker and figure is INVENTED.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import FundsNportBlock from './FundsNportBlock'
import { NPORT_SOURCE } from '../../terminal/panels/fundNportModel'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

let current = null
vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data: current, isLoading: false, mutate: vi.fn() }) }))

const OwnershipTab = (await import('./OwnershipTab')).default

const fund = (i, over = {}) => ({
  series_id: `S${String(i).padStart(9, '0')}`, name: `Invented Fund ${String(i).padStart(2, '0')}`,
  family: `Invented Trust ${i % 5}`,
  url: `https://www.sec.gov/Archives/edgar/data/90000${i}/000900000131${String(i).padStart(6, '0')}/0009000001-31-${String(i).padStart(6, '0')}-index.htm`,
  shares: 2_000_000 - i * 20_000, value: 90_000_000 - i * 900_000, pct: 2.5 - i * 0.02,
  period: i % 2 ? '2031-07-31' : '2031-06-30', prior_period: i % 2 ? '2031-04-30' : '2031-03-31',
  prior_shares: 1_800_000 - i * 20_000, change_shares: 200_000, change_pct: 11.1, state: 'added', ...over,
})

const OK = {
  state: 'ok', source: NPORT_SOURCE, sym: 'ZQAA',
  data_set: { quarter: '2031Q3', prior_quarter: '2031Q2', built_at: '2031-10-06T09:51:00+00:00',
    periods: { from: '2031-05-31', to: '2031-08-31' } },
  coverage: { matched_value_pct: 87.2, matched_rows_pct: 80, pct_units: 'percent' },
  summary: { funds: 312, shares: 61_500_000, value: 2_400_000_000, value_complete: true, added: 120, cut: 95, unchanged: 40,
    new: 31, no_prior: 26, sold_out: 14, both_now: 55_000_000, both_prior: 52_500_000, period_from: '2031-05-31',
    period_to: '2031-08-31', tier: 'fund_ticker', votes: 188 },
  holders: Array.from({ length: 50 }, (_, i) => fund(i, i === 3
    ? { name: 'Harrowgate Small Cap Fund', state: 'new', prior_shares: 0, change_shares: 1_940_000, change_pct: null }
    : i === 6 ? { name: 'Quillstone Value Fund', state: 'cut', change_shares: -400_000, change_pct: -18.5 }
      : i === 9 ? { name: 'Tamsin Growth ETF', state: 'no_prior', prior_shares: null, prior_period: null, change_shares: null, change_pct: null }
        : {})),
  holders_total: 312, holders_limit: 50,
  sold_out: [{ name: 'Ostler Income Fund', family: 'Ostler Funds', prior_shares: 700_000, prior_value: 31_000_000,
    prior_period: '2031-03-31', period: '2031-06-30', url: 'https://www.sec.gov/Archives/edgar/data/9000005/x-index.htm' }],
  sold_out_total: 14,
}

const tableRows = () => within(screen.getByTestId('funds-nport-table')).getAllByRole('row').slice(1)
const fundNames = () => tableRows().map((tr) => tr.querySelector('th').querySelector('span').textContent)

afterEach(cleanup)

describe('Funds (N-PORT) block', () => {
  it('says who holds it, what changed, the periods, the data sets and the source', () => {
    render(<FundsNportBlock block={OK} sym="ZQAA" />)
    expect(screen.getByTestId('funds-nport-summary').textContent).toBe('312 funds reported a position: 61.5M shares worth $2.40B.')
    expect(screen.getByText(/^Since each fund's previous report: 120 added, 95 cut, 40 unchanged, 31 new, 14 sold out\./)).toBeTruthy()
    expect(screen.getByText(/^The funds with both reports held 55.0M shares, against 52.5M at their previous reports \(\+2.5M net\)\.$/)).toBeTruthy()
    expect(screen.getByTestId('funds-nport-period').textContent).toMatch(/^Reports for periods ending May 31, 2031 to Aug 31, 2031, from the SEC's 2031 Q3 data set/)
    expect(screen.getByTestId('funds-nport-source').textContent).toBe(
      'Source: SEC Form N-PORT (public; filed 60 days after each quarter-end month). A report shows what a fund held on its period\'s last day, not when it bought or sold.')
    expect(screen.getByTestId('funds-nport-match').textContent).toMatch(/^Matched to ZQAA by the ticker the funds gave/)
    expect(screen.getByTestId('funds-nport-coverage').textContent).toMatch(/^Across the data set, 87.2% of the funds' common-stock holdings by value/)
  })

  it('20 rows by default, all 50 on request, and back; the line says where the list stops', () => {
    render(<FundsNportBlock block={OK} sym="ZQAA" />)
    expect(tableRows()).toHaveLength(20)
    expect(screen.getByTestId('funds-nport-held').textContent).toBe(
      'Showing 20 of 50 funds, by value, highest first. The list keeps the top 50 of 312 funds by value.')
    fireEvent.click(screen.getByRole('button', { name: 'Show all 50' }))
    expect(tableRows()).toHaveLength(50)
    fireEvent.click(screen.getByRole('button', { name: 'Show first 20' }))
    expect(tableRows()).toHaveLength(20)
  })

  it('every column is a sort button; a press sorts the whole list and moves aria-sort', () => {
    render(<FundsNportBlock block={OK} sym="ZQAA" />)
    const headers = within(screen.getByTestId('funds-nport-table')).getAllByRole('columnheader').map((th) => th.textContent.replace(/[▲▼]/g, ''))
    expect(headers).toEqual(['Fund', 'Shares', 'Change', 'Chg %', 'Value (USD)', '% of fund', 'Period', 'Shares before', 'Previous period'])
    expect(screen.getByRole('columnheader', { name: 'Value (USD)' }).getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('columnheader', { name: 'Change' }).getAttribute('aria-sort')).toBe('descending')
    expect(fundNames()[0]).toBe('Harrowgate Small Cap Fund')            // a new position is the largest add
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(fundNames()[0]).toBe('Quillstone Value Fund')
    expect(screen.getByTestId('funds-nport-held').textContent).toMatch(/by change in shares, lowest first/)
  })

  it('new, cut and no earlier report read in words, each fund with its trust and its own period', () => {
    render(<FundsNportBlock block={OK} sym="ZQAA" />)
    const row = (name) => screen.getByText(name).closest('tr')
    expect(within(row('Harrowgate Small Cap Fund')).getByText('New position')).toBeTruthy()
    expect(row('Harrowgate Small Cap Fund').querySelector('[data-col="change"]').textContent).toBe('new')
    expect(row('Quillstone Value Fund').querySelector('[data-col="change"]').textContent).toBe('-400K')
    expect(row('Quillstone Value Fund').querySelector('[data-col="changePct"]').textContent).toBe('-18.5%')
    expect(within(row('Tamsin Growth ETF')).getByText('No earlier report')).toBeTruthy()
    expect(row('Tamsin Growth ETF').querySelector('[data-col="change"]').textContent).toBe('no earlier report')
    expect(row('Tamsin Growth ETF').querySelector('[data-col="priorShares"]').textContent).toBe('not known')
    expect(row('Invented Fund 01').querySelector('[data-col="period"]').textContent).toBe('Jul 31, 2031')
    expect(within(row('Invented Fund 01')).getByText('Invented Trust 1')).toBeTruthy()
  })

  it('a change a stock split may have touched and that could not be checked reads "not comparable", and the split list is said', () => {
    const block = { ...OK,
      data_set: { ...OK.data_set, splits: { state: 'unavailable' } },
      summary: { ...OK.summary, added: 0, cut: 0, unchanged: 0, not_comparable: 255 },
      holders: OK.holders.map((h, i) => (i === 0 ? { ...h, name: 'Larchmont Index Fund', state: 'not_comparable', change_shares: null, change_pct: null } : h)) }
    render(<FundsNportBlock block={block} sym="ZQAA" />)
    const row = screen.getByText('Larchmont Index Fund').closest('tr')
    expect(within(row).getByText('Change not comparable')).toBeTruthy()
    expect(row.querySelector('[data-col="change"]').textContent).toBe('not comparable')
    expect(row.querySelector('[data-col="changePct"]').textContent).toBe('not comparable')
    expect(screen.getByText(/^Since each fund's previous report: 0 added, 0 cut, 0 unchanged, 31 new, 14 sold out, 255 not comparable\./)).toBeTruthy()
    expect(screen.getByTestId('funds-nport-period').textContent).toMatch(/The list of stock splits could not be read for this data set/)
  })

  it('earlier shares put through a split between the reports are said', () => {
    render(<FundsNportBlock block={{ ...OK, summary: { ...OK.summary, splits: [['2031-07-15', 4]] } }} sym="ZQAA" />)
    expect(screen.getByText(/^A stock split fell between some funds' two reports \(4-for-1 on Jul 15, 2031\): their shares before are counted in post-split shares/)).toBeTruthy()
  })

  it("the fund links to its own filing on sec.gov in a new tab", () => {
    render(<FundsNportBlock block={OK} sym="ZQAA" />)
    const link = screen.getByRole('link', { name: 'Invented Fund 00' })
    expect(link.getAttribute('href')).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('the funds that sold out are listed with how many more', () => {
    render(<FundsNportBlock block={OK} sym="ZQAA" />)
    const sold = screen.getByTestId('funds-nport-sold')
    expect(sold.textContent).toContain('Ostler Income Fund')
    expect(sold.textContent).toContain('held 700K shares ($31.0M) at Mar 31, 2031; its Jun 30, 2031 report holds none.')
    expect(screen.getByTestId('funds-nport-sold-more').textContent).toBe('13 more funds sold out of it.')
  })

  it('a newer read that did not finish is said beside the list that is still shown', () => {
    render(<FundsNportBlock block={{ ...OK, check: { state: 'stopped', reason: 'sec_403' } }} sym="ZQAA" />)
    expect(screen.getByTestId('funds-nport-check').textContent).toMatch(/^The last attempt to read a newer data set did not finish/)
    expect(tableRows()).toHaveLength(20)
  })

  it('each state with no table says what it is in words, and never draws a 0', () => {
    const cases = [
      [{ state: 'not_built', next_check: '2031-11-23T05:50', source: NPORT_SOURCE }, /have not been read on this server yet\. The next check is Nov 23, 2031 at 05:50 New York time\./],
      [{ state: 'not_built', building: true, source: NPORT_SOURCE }, /running now/],
      [{ state: 'not_matched', data_set: { quarter: '2031Q3' }, coverage: { matched_value_pct: 87.2 }, source: NPORT_SOURCE }, /could be matched to ZQAA\. That is not the same as no fund holding it\./],
      [{ state: 'unavailable', source: NPORT_SOURCE }, /gap in the read, not a finding/],
    ]
    for (const [block, words] of cases) {
      render(<FundsNportBlock block={block} sym="ZQAA" />)
      expect(screen.getByTestId('funds-nport-state').textContent).toMatch(words)
      expect(screen.queryByRole('table')).toBeNull()
      expect(screen.getByTestId('funds-nport').textContent).not.toMatch(/(^|[^\d.])0 funds/)
      expect(screen.getByTestId('funds-nport-source')).toBeTruthy()
      cleanup()
    }
    render(<FundsNportBlock block={cases[2][0]} sym="ZQAA" />)
    expect(screen.getByTestId('funds-nport-coverage').textContent).toMatch(/87.2%/)
  })

  it('held before but not now: no table, the sold-out list and the reason', () => {
    const block = { ...OK, state: 'none_now', holders: [], holders_total: 0,
      summary: { funds: 0, shares: 0, value: null, sold_out: 3, both_now: 0, both_prior: 900_000, tier: 'sec_name' } }
    render(<FundsNportBlock block={block} sym="ZQAA" />)
    expect(screen.getByTestId('funds-nport-state').textContent).toMatch(/^No fund's current report holds ZQAA\./)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByTestId('funds-nport-sold')).toBeTruthy()
    expect(screen.queryByTestId('funds-nport-summary')).toBeNull()
  })

  it('no screen-reader-only text inside the scrolling table (it once widened a whole panel)', () => {
    const { container } = render(<FundsNportBlock block={OK} sym="ZQAA" />)
    expect(container.querySelector('table [class*="sr"], table [class*="visuallyHidden"], table [class*="srOnly"]')).toBeNull()
  })

  it('the block, folded and unfolded, and a state with no table pass axe (WCAG A and AA)', async () => {
    const { container } = render(<FundsNportBlock block={OK} sym="ZQAA" />)
    await expectNoAxeViolations(container)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 50' }))
    await expectNoAxeViolations(container)
    cleanup()
    const empty = render(<FundsNportBlock block={{ state: 'not_matched', data_set: { quarter: '2031Q3' }, source: NPORT_SOURCE }} sym="ZQAA" />)
    await expectNoAxeViolations(empty.container)
  })
})

describe('OwnershipTab: the Funds (N-PORT) block sits below the 13F block', () => {
  const TF = { quarter: '2031Q2', summary: { ownership_pct: 41.5 }, holders: [{ name: 'Invented Filer LLC', shares: 1e6 }] }
  const base = { sym: 'ZQAA', entity: { status: 'resolved' }, institutional: { holders: [] }, short: {},
    share_counts: {}, insider: [], thirteen_f: TF }

  it('below the Funds (13F) card, titled with its data set', () => {
    current = { ...base, funds_nport: OK }
    render(<OwnershipTab sym="ZQAA" />)
    const thirteen = screen.getByTestId('ownership-funds')
    const nport = screen.getByTestId('ownership-funds-nport')
    expect(thirteen.compareDocumentPosition(nport) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nport.textContent).toMatch(/^Funds \(N-PORT\) · 2031 Q3 data set/)
    expect(nport.getAttribute('data-state')).toBe('ok')
  })

  it('an answer with no block (an older server) draws nothing, and the rest of the tab is unchanged', () => {
    current = base
    render(<OwnershipTab sym="ZQAA" />)
    expect(screen.queryByTestId('ownership-funds-nport')).toBeNull()
    expect(screen.getByTestId('ownership-funds')).toBeTruthy()
  })

  it('a stock with only the N-PORT list is not "ownership data is unavailable"', () => {
    current = { sym: 'ZQAA', entity: { status: 'resolved' }, institutional: {}, short: {}, share_counts: {}, insider: [],
      thirteen_f: null, funds_nport: OK }
    render(<OwnershipTab sym="ZQAA" />)
    expect(screen.queryByText('Ownership data is unavailable for this ticker.')).toBeNull()
    expect(screen.getByTestId('funds-nport-table')).toBeTruthy()
  })
})
