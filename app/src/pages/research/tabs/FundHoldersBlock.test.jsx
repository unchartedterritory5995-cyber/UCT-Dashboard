// app/src/pages/research/tabs/FundHoldersBlock.test.jsx
//
// The OWN panel's Funds (13F) block on screen: the summary line, the quarter end and the filing rule,
// the sortable holders table (20 rows, the rest on request), the words for a missing figure, the SEC
// link, the empty and failed states, and axe. Every fund name, id and figure is INVENTED.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import FundHoldersBlock from './FundHoldersBlock'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const NOW = Date.UTC(2031, 10, 21, 15)

const holder = (i, over = {}) => ({
  name: `Invented Filer ${String(i).padStart(2, '0')}`, cik: String(9_990_000 + i).padStart(10, '0'),
  shares: 10_000_000 - i * 100_000, prior_shares: 9_000_000 - i * 100_000, change_shares: 1_000_000 - i * 50_000,
  change_pct: 11 - i * 0.5, ownership: 5 - i * 0.05, prior_ownership: 4.5 - i * 0.05, change_ownership: 0.5,
  market_value: 1_000_000_000 - i * 10_000_000, prior_market_value: 800_000_000 - i * 10_000_000,
  weight: 1.5, prior_weight: 1.2, change_weight: 0.3, quarter_end_price: 100,
  quarter_end: '2031-09-30', filing_date: `2031-11-${String(1 + (i % 14)).padStart(2, '0')}`,
  is_new: false, is_sold_out: false, ...over,
})

const SUMMARY = {
  ownership_pct: 41.5, investors_holding: 412, total_shares: 96_500_000, total_shares_change: -1_250_000,
  new_positions: 31, increased_positions: 150, reduced_positions: 120, closed_positions: 18, put_call_ratio: 0.62,
}

const FIFTY = {
  quarter: '2031Q3', summary: SUMMARY, holders_limit: 50,
  holders: Array.from({ length: 50 }, (_, i) => holder(i, i === 3
    ? { name: 'Harrowgate Capital LLC', is_new: true, change_pct: 0, prior_shares: 0 }
    : i === 7 ? { name: 'Quillstone Partners', shares: 0, change_shares: -2_000_000, change_pct: -100, is_sold_out: true } : {})),
}

const tableRows = () => within(screen.getByTestId('funds-13f-table')).getAllByRole('row').slice(1)
const holderNames = () => tableRows().map((tr) => tr.querySelector('th').querySelector('span').textContent)

afterEach(cleanup)

describe('Funds (13F) block', () => {
  it('states the summary, the quarter end with how long ago, the filing rule and the price', () => {
    render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    expect(screen.getByTestId('funds-13f-summary').textContent).toBe(
      '13F filers held 96.5M shares (-1.3M on the quarter). Positions: 31 new, 150 added to, 120 cut, 18 sold out. Put/call ratio of their option positions 0.62.')
    expect(screen.getByTestId('funds-13f-quarter').textContent).toBe(
      'Quarter ended Sep 30, 2031 (52 days ago). 13F filings are due 45 days after a quarter ends, so the newest quarter shown can be up to about 4.5 months old.')
    expect(screen.getByTestId('funds-13f-price').textContent).toBe('Values use the quarter-end price of $100.00 a share.')
    expect(screen.getByTestId('funds-13f-source').textContent).toMatch(/^Source: Form 13F filings, through FMP\./)
  })

  it('20 rows by default, all 50 on request, and back; the line says where the list stops', () => {
    render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    expect(tableRows()).toHaveLength(20)
    expect(screen.getByTestId('funds-13f-held').textContent).toBe(
      "Showing 20 of 50 holders, by shares, highest first. The list stops at the vendor's top 50 of 412 filers.")
    fireEvent.click(screen.getByRole('button', { name: 'Show all 50' }))
    expect(tableRows()).toHaveLength(50)
    expect(screen.getByTestId('funds-13f-held').textContent).toMatch(/^All 50 holders listed/)
    fireEvent.click(screen.getByRole('button', { name: 'Show first 20' }))
    expect(tableRows()).toHaveLength(20)
  })

  it('every column the answer carries is drawn, each header a sort button', () => {
    render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    const headers = within(screen.getByTestId('funds-13f-table')).getAllByRole('columnheader').map((th) => th.textContent.replace(/[▲▼]/g, ''))
    expect(headers).toEqual(['Holder', 'Shares', 'Change', 'Chg %', '% of shares', 'Value (USD)', 'Fund weight', 'Filed',
      'Shares last qtr', 'Value last qtr', '% of shares chg', 'Weight chg'])
    // the arrow is aria-hidden, so each button's name is its label alone
    for (const name of headers) expect(screen.getByRole('button', { name })).toBeTruthy()
  })

  it('a header press sorts the whole list (then bounds it) and moves aria-sort; a second press flips it', () => {
    render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    const sharesTh = screen.getByRole('columnheader', { name: 'Shares' })
    expect(sharesTh.getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByRole('button', { name: 'Chg %' }))
    expect(screen.getByRole('columnheader', { name: 'Chg %' }).getAttribute('aria-sort')).toBe('descending')
    expect(sharesTh.getAttribute('aria-sort')).toBeNull()
    // the new position is the largest add, wherever the vendor listed it
    expect(holderNames()[0]).toBe('Harrowgate Capital LLC')
    fireEvent.click(screen.getByRole('button', { name: 'Chg %' }))
    expect(screen.getByRole('columnheader', { name: 'Chg %' }).getAttribute('aria-sort')).toBe('ascending')
    expect(holderNames()[0]).toBe('Quillstone Partners')
    expect(screen.getByTestId('funds-13f-held').textContent).toMatch(/by percent change, lowest first/)
    fireEvent.click(screen.getByRole('button', { name: 'Holder' }))
    expect(holderNames()[0]).toBe('Harrowgate Capital LLC')
  })

  it('new and sold-out positions say so in words; a sold-out position holds a real 0', () => {
    render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    // the sold-out position holds 0 shares, so it sorts below the first 20
    expect(screen.queryByText('Quillstone Partners')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 50' }))
    const row = (name) => screen.getByText(name).closest('tr')
    expect(within(row('Harrowgate Capital LLC')).getByText('New position')).toBeTruthy()
    expect(row('Harrowgate Capital LLC').querySelector('[data-col="changePct"]').textContent).toBe('new')
    expect(within(row('Quillstone Partners')).getByText('Sold out')).toBeTruthy()
    expect(row('Quillstone Partners').querySelector('[data-col="shares"]').textContent).toBe('0')
    expect(row('Quillstone Partners').querySelector('[data-col="change"]').textContent).toBe('-2.0M')
  })

  it('the holder links to its 13F filings on SEC EDGAR in a new tab', () => {
    render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    const link = screen.getByRole('link', { name: 'Invented Filer 00' })
    expect(link.getAttribute('href')).toBe('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0009990000&type=13F-HR&dateb=&owner=include&count=40')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('an answer from before the server passed the new fields: the optional columns are not drawn, a missing figure is words', () => {
    const old = {
      quarter: '2031Q3', summary: { new_positions: 2 },
      holders: [
        { name: 'Tidewell Asset Management', shares: 5_000_000, change_shares: null, ownership: null, market_value: 4e8, is_new: false, is_sold_out: false },
        { name: 'Brackenridge Fund LP', shares: 1_000_000, change_shares: 200_000, ownership: 0.8, market_value: 8e7, is_new: false, is_sold_out: false },
      ],
    }
    render(<FundHoldersBlock tf={old} now={NOW} />)
    const headers = within(screen.getByTestId('funds-13f-table')).getAllByRole('columnheader').map((th) => th.textContent.replace(/[▲▼]/g, ''))
    expect(headers).toEqual(['Holder', 'Shares', 'Change', 'Chg %', '% of shares', 'Value (USD)'])
    const row = screen.getByText('Tidewell Asset Management').closest('tr')
    expect(row.querySelector('[data-col="change"]').textContent).toBe('not reported')
    expect(row.querySelector('[data-col="ownership"]').textContent).toBe('not reported')
    expect(row.textContent).not.toMatch(/(^|[^\d.])0(\.0+)?%/)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('funds-13f-held').textContent).toBe('All 2 holders listed, by shares, highest first.')
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
    expect(screen.getByTestId('funds-13f-summary').textContent)
      .toBe('Positions: 2 new, added to not reported, cut not reported, sold out not reported.')
    expect(screen.queryByTestId('funds-13f-price')).toBeNull()
  })

  it('no holder rows: an empty list and a failed read are different sentences, and no table', () => {
    render(<FundHoldersBlock tf={{ quarter: '2031Q3', summary: SUMMARY, holders: [] }} now={NOW} />)
    expect(screen.getByTestId('funds-13f-none').textContent).toBe('The data vendor lists no individual holders for this quarter.')
    expect(screen.queryByRole('table')).toBeNull()
    cleanup()
    render(<FundHoldersBlock tf={{ quarter: '2031Q3', summary: SUMMARY, holders: [] }} failed now={NOW} />)
    expect(screen.getByTestId('funds-13f-none').getAttribute('data-state')).toBe('failed')
    expect(screen.getByTestId('funds-13f-none').textContent).toMatch(/could not be read right now/)
  })

  it('the holder column is capped by the PANEL width (a size container), not the screen', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/research/tabs/FundHoldersBlock.module.css'), 'utf8')
    expect(css).toMatch(/\.block \{ container-type: inline-size;/)
    expect(css).toMatch(/\.holder \{[^}]*max-width: min\(11rem, 36cqi\);/)
    const { container } = render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    expect(container.firstElementChild.getAttribute('data-testid')).toBe('funds-13f')
    expect(container.firstElementChild.className).toMatch(/block/)
  })

  it('no screen-reader-only text inside the scrolling table (it once widened a whole panel)', () => {
    const { container } = render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    expect(container.querySelector('table [class*="sr"], table [class*="visuallyHidden"], table [class*="srOnly"]')).toBeNull()
  })

  it('the block, folded and unfolded, and the empty state pass axe (WCAG A and AA)', async () => {
    const { container } = render(<FundHoldersBlock tf={FIFTY} now={NOW} />)
    await expectNoAxeViolations(container)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 50' }))
    await expectNoAxeViolations(container)
    cleanup()
    const empty = render(<FundHoldersBlock tf={{ quarter: null, summary: {}, holders: [] }} failed now={NOW} />)
    await expectNoAxeViolations(empty.container)
  })
})
