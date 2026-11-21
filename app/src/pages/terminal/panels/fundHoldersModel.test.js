// app/src/pages/terminal/panels/fundHoldersModel.test.js
//
// The Funds (13F) block's rows, words and sorting. Every fund name, id and figure is INVENTED.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ROWS, DEFAULT_SORT, FUND_COLUMNS, NOT_REPORTED, boundRows, changePctText, fundRows,
  fundsSummaryLine, heldLine, nextSort, noHoldersWords, presentColumns, priceLine, quarterFacts,
  secFilerUrl, sortFundRows, sortWords, tableName, toneOf, COLUMN_BY_KEY,
} from './fundHoldersModel'

const FULL = {
  name: 'Harrowgate Capital LLC', cik: '0009990001', shares: 4_100_000, prior_shares: 3_600_000,
  change_shares: 500_000, change_pct: 13.89, ownership: 4.25, prior_ownership: 3.73, change_ownership: 0.52,
  market_value: 410_000_000, prior_market_value: 300_000_000, weight: 2.5, prior_weight: 2.1, change_weight: 0.4,
  quarter_end_price: 100, quarter_end: '2031-09-30', filing_date: '2031-11-12', is_new: false, is_sold_out: false,
}
const TF = (holders, over = {}) => ({ quarter: '2031Q3', summary: {}, holders, holders_limit: 50, ...over })
const cell = (key, row) => COLUMN_BY_KEY[key].cell(row)

describe('fundRows', () => {
  it('reads every field the answer carries, in the vendor order', () => {
    const [r] = fundRows(TF([FULL]))
    expect(r).toMatchObject({
      rank: 0, name: 'Harrowgate Capital LLC', cik: '0009990001', shares: 4_100_000, priorShares: 3_600_000,
      changeShares: 500_000, changePct: 13.89, ownership: 4.25, priorOwnership: 3.73, changeOwnership: 0.52,
      value: 410_000_000, priorValue: 300_000_000, weight: 2.5, priorWeight: 2.1, changeWeight: 0.4,
      quarterEndPrice: 100, quarterEnd: '2031-09-30', filed: '2031-11-12', state: 'added',
    })
  })

  it('a field the answer leaves out is null, never 0; a vendor 0/1 flag is read as a flag', () => {
    const [r] = fundRows(TF([{ name: 'Quillstone Partners', shares: '1200', is_new: 1, change_pct: '', weight: true }]))
    expect(r.shares).toBe(1200)
    expect(r.state).toBe('new')
    for (const k of ['priorShares', 'changeShares', 'changePct', 'ownership', 'value', 'weight', 'filed', 'cik']) {
      expect(r[k], k).toBeNull()
    }
  })

  it('names the position state from the filing: added, cut, unchanged, sold out, or unknown', () => {
    const rows = fundRows(TF([
      { name: 'A', change_shares: -10 }, { name: 'B', change_shares: 0 }, { name: 'C' },
      { name: 'D', is_sold_out: true, shares: 0, change_shares: -900 }, null, 'junk',
    ]))
    expect(rows.map((r) => r.state)).toEqual(['cut', 'unchanged', null, 'sold_out'])
  })

  it('no holders, or no 13F block at all, is an empty list', () => {
    expect(fundRows(null)).toEqual([])
    expect(fundRows({ holders: 'nope' })).toEqual([])
  })
})

describe('cells', () => {
  const [r] = fundRows(TF([FULL]))
  it('every figure on the terminal ladder, signed where it is a change', () => {
    expect(cell('shares', r)).toBe('4.1M')
    expect(cell('change', r)).toBe('+500K')
    expect(cell('changePct', r)).toBe('+13.9%')
    expect(cell('ownership', r)).toBe('4.25%')
    expect(cell('value', r)).toBe('$410.0M')
    expect(cell('weight', r)).toBe('2.50%')
    expect(cell('filed', r)).toBe('Nov 12, 2031')
    expect(cell('priorShares', r)).toBe('3.6M')
    expect(cell('priorValue', r)).toBe('$300.0M')
    expect(cell('changeOwnership', r)).toBe('+0.52pp')
    expect(cell('changeWeight', r)).toBe('+0.40pp')
  })

  it('a missing figure is words in every column, never 0 or a blank', () => {
    const [bare] = fundRows(TF([{ name: 'Tidewell Asset Management' }]))
    for (const c of FUND_COLUMNS.filter((x) => x.key !== 'holder')) {
      expect(c.cell(bare), c.key).toBe(NOT_REPORTED)
    }
    expect(cell('holder', fundRows(TF([{ shares: 5 }]))[0])).toBe('Name not reported')
  })

  it('a cut reads "-", a real zero shares (sold out) reads 0, and a new position has no percent change', () => {
    const [cut, sold, fresh, soldNoPct] = fundRows(TF([
      { name: 'Cut', change_shares: -2_500_000, change_pct: -40 },
      { name: 'Sold', shares: 0, change_shares: -800, change_pct: -100, is_sold_out: true },
      { name: 'Fresh', shares: 9000, change_shares: 9000, change_pct: 0, is_new: true },
      { name: 'Gone', shares: 0, is_sold_out: true },
    ]))
    expect(cell('change', cut)).toBe('-2.5M')
    expect(cell('changePct', cut)).toBe('-40.0%')
    expect(cell('shares', sold)).toBe('0')
    expect(changePctText(sold)).toBe('-100.0%')
    expect(changePctText(fresh)).toBe('new')
    expect(changePctText(soldNoPct)).toBe('sold out')
  })

  it('colour follows the sign, and the text carries the sign too', () => {
    const [up, down, fresh] = fundRows(TF([
      { name: 'U', change_shares: 5, change_pct: 1 }, { name: 'D', change_shares: -5, change_pct: -1 },
      { name: 'N', is_new: true },
    ]))
    expect(toneOf(COLUMN_BY_KEY.change, up)).toBe('up')
    expect(toneOf(COLUMN_BY_KEY.change, down)).toBe('down')
    expect(toneOf(COLUMN_BY_KEY.changePct, fresh)).toBe('up')
    expect(toneOf(COLUMN_BY_KEY.shares, up)).toBeNull()
  })

  it('a change that prints as zero is zero: no minus sign and no colour', () => {
    const [tiny] = fundRows(TF([{ name: 'T', change_ownership: -0.004, change_weight: 0.002, change_pct: -0.04 }]))
    expect(cell('changeOwnership', tiny)).toBe('0.00pp')
    expect(cell('changeWeight', tiny)).toBe('0.00pp')
    expect(cell('changePct', tiny)).toBe('0.0%')
    expect(toneOf(COLUMN_BY_KEY.changeOwnership, tiny)).toBeNull()
    expect(toneOf(COLUMN_BY_KEY.changeWeight, tiny)).toBeNull()
    expect(toneOf(COLUMN_BY_KEY.changePct, tiny)).toBeNull()
    const [small] = fundRows(TF([{ name: 'S', change_ownership: -0.006 }]))
    expect(cell('changeOwnership', small)).toBe('-0.01pp')
    expect(toneOf(COLUMN_BY_KEY.changeOwnership, small)).toBe('down')
  })

  it('the SEC link is built only from a CIK of digits', () => {
    expect(secFilerUrl('0009990001')).toBe('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0009990001&type=13F-HR&dateb=&owner=include&count=40')
    expect(secFilerUrl('99x')).toBeNull()
    expect(secFilerUrl('')).toBeNull()
    expect(secFilerUrl(null)).toBeNull()
  })
})

describe('columns', () => {
  it('core columns always; an optional one only when some row carries its figure', () => {
    const keys = (rows) => presentColumns(fundRows(TF(rows))).map((c) => c.key)
    expect(keys([{ name: 'Old shape', shares: 1, change_shares: 1, ownership: 1, market_value: 1 }]))
      .toEqual(['holder', 'shares', 'change', 'changePct', 'ownership', 'value'])
    expect(keys([FULL])).toEqual(FUND_COLUMNS.map((c) => c.key))
    expect(keys([{ name: 'X' }, { name: 'Y', filing_date: '2031-11-01' }])).toContain('filed')
  })
})

describe('sorting', () => {
  const rows = fundRows(TF([
    { name: 'bravo fund', shares: 300, change_shares: 10, change_pct: 5, filing_date: '2031-11-02' },
    { name: 'Alpha Fund', shares: null, change_shares: -40, change_pct: -20, filing_date: '2031-11-14' },
    { name: 'Charlie LP', shares: 900, change_shares: null, is_new: true },
    { name: 'Delta LP', shares: 300, change_shares: 0, change_pct: 0, filing_date: null },
    { name: 'Echo LP', shares: 0, is_sold_out: true },
  ]))
  const names = (sorted) => sorted.map((r) => r.name)

  it('by shares, largest first by default; a missing figure sinks; ties keep the vendor order', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'shares', dir: 'desc' })
    expect(names(sortFundRows(rows))).toEqual(['Charlie LP', 'bravo fund', 'Delta LP', 'Echo LP', 'Alpha Fund'])
    expect(names(sortFundRows(rows, { key: 'shares', dir: 'asc' }))).toEqual(['Echo LP', 'bravo fund', 'Delta LP', 'Charlie LP', 'Alpha Fund'])
  })

  it('by percent change: a new position is the largest add, a sold-out one the largest cut', () => {
    expect(names(sortFundRows(rows, { key: 'changePct', dir: 'desc' })))
      .toEqual(['Charlie LP', 'bravo fund', 'Delta LP', 'Alpha Fund', 'Echo LP'])
    expect(names(sortFundRows(rows, { key: 'changePct', dir: 'asc' })))
      .toEqual(['Echo LP', 'Alpha Fund', 'Delta LP', 'bravo fund', 'Charlie LP'])
  })

  it('by holder name ignores case; by filing date newest first; an unknown key falls back to shares', () => {
    expect(names(sortFundRows(rows, { key: 'holder', dir: 'asc' }))).toEqual(['Alpha Fund', 'bravo fund', 'Charlie LP', 'Delta LP', 'Echo LP'])
    expect(names(sortFundRows(rows, { key: 'filed', dir: 'desc' })).slice(0, 2)).toEqual(['Alpha Fund', 'bravo fund'])
    expect(names(sortFundRows(rows, { key: 'nope', dir: 'desc' }))).toEqual(names(sortFundRows(rows)))
  })

  it('never reorders the rows it was given', () => {
    const before = names(rows)
    sortFundRows(rows, { key: 'holder', dir: 'asc' })
    expect(names(rows)).toEqual(before)
  })

  it('a header press: the same column flips; a new figure column starts highest first, the holder A to Z', () => {
    expect(nextSort(DEFAULT_SORT, 'shares')).toEqual({ key: 'shares', dir: 'asc' })
    expect(nextSort({ key: 'shares', dir: 'asc' }, 'shares')).toEqual({ key: 'shares', dir: 'desc' })
    expect(nextSort(DEFAULT_SORT, 'change')).toEqual({ key: 'change', dir: 'desc' })
    expect(nextSort(DEFAULT_SORT, 'holder')).toEqual({ key: 'holder', dir: 'asc' })
    expect(nextSort(DEFAULT_SORT, 'filed')).toEqual({ key: 'filed', dir: 'desc' })
    expect(nextSort(DEFAULT_SORT, 'nope')).toEqual(DEFAULT_SORT)
  })

  it('says the sort in words', () => {
    expect(sortWords(DEFAULT_SORT)).toBe('by shares, highest first')
    expect(sortWords({ key: 'changePct', dir: 'asc' })).toBe('by percent change, lowest first')
    expect(sortWords({ key: 'holder', dir: 'asc' })).toBe('by holder, A to Z')
    expect(sortWords({ key: 'filed', dir: 'desc' })).toBe('by filing date, newest first')
  })
})

describe('bounds and the lines around the table', () => {
  const many = fundRows(TF(Array.from({ length: 50 }, (_, i) => ({ name: `Invented Filer ${i}`, shares: 1000 - i }))))

  it('20 rows by default, all on request', () => {
    expect(DEFAULT_ROWS).toBe(20)
    expect(boundRows(many, false)).toHaveLength(20)
    expect(boundRows(many, true)).toHaveLength(50)
  })

  it('says how many are shown, how they are sorted, and that the list stops at the read', () => {
    expect(heldLine({ total: 50, shown: 20, limit: 50, investors: 412, sort: DEFAULT_SORT }))
      .toBe("Showing 20 of 50 holders, by shares, highest first. The list stops at the vendor's top 50 of 412 filers.")
    expect(heldLine({ total: 12, shown: 12, limit: 50, investors: 412, sort: DEFAULT_SORT }))
      .toBe('All 12 holders listed, by shares, highest first. 412 filers reported a position in all.')
    expect(heldLine({ total: 1, shown: 1, limit: null, investors: 1, sort: DEFAULT_SORT }))
      .toBe('One holder listed, by shares, highest first.')
    // a list as long as the read is not "cut" when it already holds every filer
    expect(heldLine({ total: 50, shown: 20, limit: 50, investors: 50, sort: DEFAULT_SORT }))
      .toBe('Showing 20 of 50 holders, by shares, highest first.')
    expect(heldLine({ total: 50, shown: 50, limit: 50, investors: null, sort: { key: 'holder', dir: 'asc' } }))
      .toBe("All 50 holders listed, by holder, A to Z. The list stops at the vendor's top 50.")
    expect(heldLine({ total: 0, shown: 0 })).toBeNull()
  })

  it('the one-line summary: total shares, the four position counts, the put/call ratio', () => {
    expect(fundsSummaryLine({
      total_shares: 96_500_000, total_shares_change: -1_250_000, new_positions: 31,
      increased_positions: 1500, reduced_positions: 120, closed_positions: 18, put_call_ratio: 0.62,
    })).toBe('13F filers held 96.5M shares (-1.3M on the quarter). Positions: 31 new, 1,500 added to, 120 cut, 18 sold out. Put/call ratio of their option positions 0.62.')
  })

  it('a count the summary does not carry is words; with nothing to say there is no line', () => {
    expect(fundsSummaryLine({ new_positions: 4, increased_positions: null, reduced_positions: 0, closed_positions: undefined }))
      .toBe('Positions: 4 new, added to not reported, 0 cut, sold out not reported.')
    expect(fundsSummaryLine({ total_shares: 1e6 })).toBe('13F filers held 1.0M shares.')
    expect(fundsSummaryLine({})).toBeNull()
    expect(fundsSummaryLine(null)).toBeNull()
  })

  it('the quarter end, how long ago, and the 45-day filing rule', () => {
    const now = Date.UTC(2031, 10, 21, 15)
    const q = quarterFacts(TF([]), [], now)
    expect(q.end).toBe('2031-09-30')
    expect(q.daysAgo).toBe(52)
    expect(q.text).toBe('Quarter ended Sep 30, 2031 (52 days ago). 13F filings are due 45 days after a quarter ends, so the newest quarter shown can be up to about 4.5 months old.')
  })

  it('no quarter on the block: the rows\' own quarter end if they agree, else it says it is not reported', () => {
    const rows = fundRows(TF([FULL, FULL]))
    expect(quarterFacts({ quarter: null }, rows, Date.UTC(2031, 9, 1)).end).toBe('2031-09-30')
    expect(quarterFacts({ quarter: null }, rows, Date.UTC(2031, 9, 1)).text).toMatch(/^Quarter ended Sep 30, 2031 \(1 day ago\)\. 13F filings are due 45 days/)
    const none = quarterFacts({}, [], Date.UTC(2031, 9, 1))
    expect(none.end).toBeNull()
    expect(none.text).toMatch(/^The quarter these filings cover is not reported\. 13F filings are due 45 days after a quarter ends/)
  })

  it('the quarter-end price, only when the rows agree on one', () => {
    expect(priceLine(fundRows(TF([FULL, { ...FULL, quarter_end_price: null }])))).toBe('Values use the quarter-end price of $100.00 a share.')
    expect(priceLine(fundRows(TF([FULL, { ...FULL, quarter_end_price: 99 }])))).toBeNull()
    expect(priceLine([])).toBeNull()
  })

  it('no holder rows: a failed read and an empty list are different sentences', () => {
    expect(noHoldersWords(true)).toMatch(/could not be read right now/)
    expect(noHoldersWords(false)).toBe('The data vendor lists no individual holders for this quarter.')
  })

  it('the table is named with its quarter, and without a dangling separator when there is none', () => {
    expect(tableName({ quarter: '2031Q3' })).toBe('Funds (13F) holders, Q3 2031')
    expect(tableName({ quarter: '2031 Q3' })).toBe('Funds (13F) holders, 2031 Q3')
    expect(tableName({ quarter: null })).toBe('Funds (13F) holders')
  })
})
