// Where the Ownership tab's two top cards read from, and what they say when there is nothing to read.
//
//   Institutional ownership   the Form 13F block of the ownership answer: the percent is the
//                             server's `institutional.pct_held`, the ranked holders are the Charts
//                             dock's `topHolders` (one model, two screens). No 13F on file is said
//                             in words, never drawn as an empty chart or a 0.
//   Short interest            the newest FINRA report the short interest service already holds,
//                             with its settlement date. Nothing held: "not available" on every
//                             figure and a pointer to SHINT, never a number.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { PanelListContext } from '../../../components/terminal/terminalPanel'

let data
vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data, isLoading: false, mutate: () => {} }) }))
vi.mock('../../../components/research-kit', () => ({
  SeriesChart: (p) => (
    <div data-testid="rank-chart" data-periods={p.periods.join('|')} data-values={p.series[0].values.join('|')}
      data-label={p.label} />
  ),
}))

import OwnershipTab from './OwnershipTab'
import { institutionalNote, shortMissingWords } from '../../charts/widgets/ownershipModel'

const HOLDERS = [
  { name: 'BlackRock', shares: 1.1e9, change_shares: -1e8, ownership: 7.0, market_value: 2.7e11 },
  { name: 'Vanguard', shares: 1.3e9, change_shares: 2e7, ownership: 8.4, market_value: 3.2e11 },
  { name: 'No Percent LP', shares: 5e5, change_shares: 0, ownership: null, market_value: 1e8 },
  { name: 'State Street', shares: 6e8, change_shares: 0, ownership: 3.9, market_value: 1.5e11 },
]
const TF = {
  quarter: '2026Q3',
  summary: { ownership_pct: 63.46, ownership_change: -0.96, investors_holding: 6339, total_invested: 2.4e12 },
  holders: HOLDERS, _meta: null,
}
const SHORT_OK = {
  state: 'ok', shares_short: 50_000_000, short_pct_float: 0.74, days_to_cover: 1.85, avg_daily_volume: 27_000_000,
  settlement_date: '2026-10-30', prior_short: 48_000_000, prior_settlement_date: '2026-10-15',
  float_shares: 6_800_000_000, pct_float_withheld: false, source: 'FINRA, through Massive',
}
const base = (over = {}) => ({
  sym: 'AAPL', entity: { status: 'resolved' },
  institutional: { state: 'ok', pct_held: 63.46, quarter: '2026Q3', source: 'Form 13F filings, through FMP' },
  thirteen_f: TF, short: SHORT_OK,
  share_counts: { float_shares: 1.48e10, shares_outstanding: 1.5e10, _meta: null },
  insider: [], legs_failed: [], ...over,
})
const kv = (card, label) => within(card).getByText(label).closest('div').querySelector('b').textContent

afterEach(cleanup)

describe('Institutional ownership reads the Form 13F block', () => {
  it('the percent is the answer\'s institutional percent, and the source line names 13F and its quarter', () => {
    data = base()
    render(<OwnershipTab sym="AAPL" />)
    const card = screen.getByTestId('ownership-institutional')
    expect(card.getAttribute('data-state')).toBe('ok')
    expect(kv(card, '% of shares outstanding')).toBe('63.46%')
    expect(screen.getByTestId('ownership-institutional-source').textContent)
      .toBe('Source: Form 13F filings, through FMP · Q3 2026. Each holder, with the change in its position, is in the Form 13F table below.')
    expect(screen.queryByTestId('ownership-institutional-note')).toBeNull()
  })

  it('the ranking draws the 13F holders that carry a percent, largest first', () => {
    data = base()
    render(<OwnershipTab sym="AAPL" />)
    const chart = screen.getByTestId('rank-chart')
    expect(chart.getAttribute('data-periods')).toBe('Vanguard|BlackRock|State Street')
    expect(chart.getAttribute('data-values')).toBe('8.4|7|3.9')
  })

  it('at most ten holders are ranked', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `Filer ${i}`, shares: 1e6, ownership: i + 1, market_value: 1e8 }))
    data = base({ thirteen_f: { ...TF, holders: many } })
    render(<OwnershipTab sym="AAPL" />)
    const names = screen.getByTestId('rank-chart').getAttribute('data-periods').split('|')
    expect(names).toHaveLength(10)
    expect(names[0]).toBe('Filer 11')
  })

  it('there is ONE holders table on the tab, the Form 13F one, and it lists every holder', () => {
    data = base()
    render(<OwnershipTab sym="AAPL" />)
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(1)
    expect(tables[0].getAttribute('aria-label')).toBe('Form 13F top holders, 2026Q3')
    expect(within(tables[0]).getAllByRole('row')).toHaveLength(HOLDERS.length + 1)
  })

  it('a holders list the answer no longer carries is never drawn (no second source)', () => {
    data = base({
      thirteen_f: null,
      institutional: { state: 'none', pct_held: null, holders: [{ holder: 'Old Table Co', shares: 1, pct_out: 9.9, value: 1 }] },
    })
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.queryByText('Old Table Co')).toBeNull()
    expect(screen.queryByTestId('rank-chart')).toBeNull()
    expect(screen.queryAllByRole('table')).toHaveLength(0)
  })

  it('no 13F on file: "not available" in words, with why, and no chart', () => {
    data = base({ thirteen_f: null, institutional: { state: 'none', pct_held: null, quarter: null } })
    render(<OwnershipTab sym="AAPL" />)
    const card = screen.getByTestId('ownership-institutional')
    expect(card.getAttribute('data-state')).toBe('none')
    expect(kv(card, '% of shares outstanding')).toBe('not available')
    expect(screen.getByTestId('ownership-institutional-note').textContent)
      .toBe('Institutional holders are not available for AAPL: no Form 13F summary is on file for it in the last four completed quarters.')
    expect(screen.getByTestId('ownership-institutional-source').textContent).toBe('Source: Form 13F filings, through FMP.')
    expect(within(card).queryByText('0%')).toBeNull()
  })

  it('a 13F read that failed is a gap in the read, never "none on file"', () => {
    data = base({ thirteen_f: null, institutional: { state: 'failed', pct_held: null },
      legs_failed: ['institutional holders (Form 13F)'] })
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('ownership-institutional').getAttribute('data-state')).toBe('failed')
    expect(screen.getByTestId('ownership-institutional-note').textContent)
      .toBe('Institutional holders could not be read right now. That is a gap in what we could read, not a finding about AAPL.')
    expect(screen.getByTestId('ownership-partial').textContent).toContain('institutional holders (Form 13F)')
  })

  it('a percent over 100 is withheld from the headline, with the reason; the 13F card keeps its own figure', () => {
    data = base({
      institutional: { state: 'ok', pct_held: null, quarter: '2026Q3' },
      thirteen_f: { ...TF, summary: { ...TF.summary, ownership_pct: 104.2 } },
    })
    render(<OwnershipTab sym="AAPL" />)
    expect(kv(screen.getByTestId('ownership-institutional'), '% of shares outstanding')).toBe('not available')
    expect(screen.getByTestId('ownership-institutional-note').textContent).toContain('more than 100% of the shares outstanding')
    expect(screen.getByText('104.2%')).toBeInTheDocument()
  })

  it('institutionalNote: nothing to add when the percent is there', () => {
    expect(institutionalNote({ state: 'ok', pct_held: 63.46 }, TF, 'AAPL')).toBeNull()
    expect(institutionalNote({ state: 'ok', pct_held: null }, { summary: {} }, 'AAPL')).toBeNull()
    expect(institutionalNote(undefined, null, 'ZZ')).toContain('not available for ZZ')
  })
})

describe('Short interest reads the FINRA report the short interest service holds', () => {
  it('a held report: its figures, its settlement date, its source, and how the percent of float is worked out', () => {
    data = base()
    render(<OwnershipTab sym="AAPL" />)
    const card = screen.getByTestId('ownership-short')
    expect(card.getAttribute('data-state')).toBe('ok')
    expect(kv(card, 'Short % of float')).toBe('0.74%')
    expect(kv(card, 'Days to cover')).toBe('1.9')
    expect(kv(card, 'Shares short')).toBe('50.0M')
    const asOf = screen.getByTestId('ownership-short-asof').textContent
    expect(asOf).toContain('FINRA report for settlement date Oct 30, 2026.')
    expect(asOf).toContain('so this is not today\'s position.')
    expect(asOf).toContain('Percent of float uses today\'s float from the nightly screener export (6.80B shares), so the two figures are from different days.')
    expect(screen.getByTestId('ownership-short-source').textContent)
      .toBe('Source: FINRA, through Massive. Every report for AAPL: Short interest history (SHINT)')
    expect(screen.queryByTestId('ownership-short-unavailable')).toBeNull()
  })

  it('nothing held: every figure says "not available", in words why, and where the dated record is', () => {
    data = base({ short: { state: 'not_held', shares_short: null, short_pct_float: null, days_to_cover: null,
      settlement_date: null, source: 'FINRA, through Massive' } })
    render(<OwnershipTab sym="AAPL" />)
    const card = screen.getByTestId('ownership-short')
    expect(card.getAttribute('data-state')).toBe('not_held')
    for (const label of ['Short % of float', 'Days to cover', 'Shares short']) expect(kv(card, label)).toBe('not available')
    const words = screen.getByTestId('ownership-short-unavailable').textContent
    expect(words).toContain('Short interest is not available here for AAPL right now: the site has not read its FINRA reports lately.')
    expect(words).toContain('That is not the same as no short interest.')
    expect(words).toContain('The dated record, report by report, is on Short interest history (SHINT): run AAPL SHINT in the UCT Terminal.')
    expect(screen.queryByTestId('ownership-short-asof')).toBeNull()
    expect(screen.queryByTestId('ownership-short-source')).toBeNull()
  })

  it('an answer with no short block at all (an older record) is "not available", never a blank or a 0', () => {
    data = base({ short: undefined })
    render(<OwnershipTab sym="AAPL" />)
    const card = screen.getByTestId('ownership-short')
    expect(card.getAttribute('data-state')).toBe('not_held')
    expect(kv(card, 'Shares short')).toBe('not available')
  })

  it('figures without a held report are never drawn (no state, or no settlement date)', () => {
    for (const short of [
      { shares_short: 5e7, short_pct_float: 0.73, days_to_cover: 1.8 },                        // the retired shape
      { state: 'ok', shares_short: 5e7, short_pct_float: 0.73, days_to_cover: 1.8 },            // no settlement date
      { state: 'ok', shares_short: null, settlement_date: '2026-10-30' },                       // no figure
    ]) {
      data = base({ short })
      render(<OwnershipTab sym="AAPL" />)
      const card = screen.getByTestId('ownership-short')
      expect(card.getAttribute('data-state')).not.toBe('ok')
      expect(kv(card, 'Shares short')).toBe('not available')
      expect(kv(card, 'Short % of float')).toBe('not available')
      expect(within(card).queryByText('0.73%')).toBeNull()
      cleanup()
    }
  })

  it('a refused data plan and "no rows at the vendor" are each said as what they are', () => {
    data = base({ short: { state: 'unavailable', reason: 'refused', http_status: 403 } })
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('ownership-short-unavailable').textContent)
      .toContain('Short interest is not available on the data plan right now (the data vendor answered 403). That is not the same as none.')
    cleanup()
    data = base({ short: { state: 'none' } })
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('ownership-short-unavailable').textContent)
      .toContain('FINRA short interest has no reports on file for AAPL at the data vendor. That is not the same as zero.')
  })

  it('a withheld or missing percent of float says why, beside the report\'s other figures', () => {
    data = base({ short: { ...SHORT_OK, short_pct_float: null, pct_float_withheld: true } })
    render(<OwnershipTab sym="AAPL" />)
    expect(kv(screen.getByTestId('ownership-short'), 'Short % of float')).toBe('not available')
    expect(kv(screen.getByTestId('ownership-short'), 'Shares short')).toBe('50.0M')
    expect(screen.getByTestId('ownership-short-asof').textContent)
      .toContain('Percent of float is not available. Not shown: the short interest is more than 150% of the float on file, so the two do not describe the same share count.')
    cleanup()
    data = base({ short: { ...SHORT_OK, short_pct_float: null, float_shares: null } })
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('ownership-short-asof').textContent)
      .toContain('Percent of float is not available. No float on file for this stock.')
  })

  it('a report of zero shares short is the report\'s figure, shown with its date', () => {
    data = base({ short: { ...SHORT_OK, shares_short: 0, days_to_cover: 0, short_pct_float: 0 } })
    render(<OwnershipTab sym="AAPL" />)
    const card = screen.getByTestId('ownership-short')
    expect(card.getAttribute('data-state')).toBe('ok')
    expect(kv(card, 'Shares short')).toBe('0')
    expect(screen.getByTestId('ownership-short-asof').textContent).toContain('settlement date Oct 30, 2026')
  })

  it('inside the Terminal the pointer opens SHINT for the stock; outside it is plain words', () => {
    data = base({ short: { state: 'not_held' } })
    const open = vi.fn()
    render(
      <PanelListContext.Provider value={{ open, run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
        <OwnershipTab sym="AAPL" />
      </PanelListContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Short interest history (SHINT) for AAPL (AAPL SHINT)' }))
    expect(open).toHaveBeenCalledWith('AAPL SHINT')
    cleanup()
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.queryByRole('button', { name: /SHINT/ })).toBeNull()
    expect(screen.getByTestId('ownership-short-unavailable').textContent).toContain('Short interest history (SHINT)')
  })

  it('shortMissingWords: one sentence per state, the stock named', () => {
    expect(shortMissingWords({ state: 'unavailable', reason: 'not_configured' }, 'ZZ'))
      .toBe('Short interest is not available on this server: it has no key for the data vendor. That is not the same as none.')
    expect(shortMissingWords(undefined, 'ZZ')).toContain('not available here for ZZ right now')
  })
})

describe('the tab names no source it does not read', () => {
  it('with everything held', () => {
    data = base()
    const { container } = render(<OwnershipTab sym="AAPL" />)
    expect(container.textContent).not.toMatch(/Yahoo|yfinance/i)
  })

  it('with nothing held', () => {
    data = base({ thirteen_f: null, institutional: { state: 'none', pct_held: null }, short: { state: 'not_held' } })
    const { container } = render(<OwnershipTab sym="AAPL" />)
    expect(container.textContent).not.toMatch(/Yahoo|yfinance/i)
  })

  it('the float still shows beside a missing short report, and the tab is not "unavailable"', () => {
    data = base({ thirteen_f: null, institutional: { state: 'none', pct_held: null }, short: { state: 'not_held' } })
    render(<OwnershipTab sym="AAPL" />)
    expect(kv(screen.getByTestId('ownership-short'), 'Float')).toBe('14.80B')
    expect(screen.queryByText('Ownership data is unavailable for this ticker.')).toBeNull()
  })
})
