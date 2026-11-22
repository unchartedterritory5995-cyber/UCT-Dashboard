// app/src/pages/terminal/panels/fundNportModel.test.js
//
// The Funds (N-PORT) block's pure model: rows from the server's `funds_nport`, the change words, the columns and the
// sort, the summary / period / held / sold / match / coverage lines, and every state with no table.
// Every fund, trust, ticker and figure here is INVENTED.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SORT, NOT_KNOWN, NOT_REPORTED, NPORT_SOURCE, changePctText, changeText, checkTimeWords, nextNportSort,
  nportCheckLine, nportColumns, nportCoverageLine, nportHeldLine, nportMatchLine, nportPeriodLine, nportRows,
  nportSoldRows, nportSortWords, nportStateWords, nportSummaryLines, nportTableName, quarterWords, soldMoreLine,
  soldText, sortNportRows, toneOf, NPORT_COLUMN_BY_KEY,
} from './fundNportModel'

const fund = (i, over = {}) => ({
  series_id: `S00000000${i}`, name: `Invented Fund ${i}`, family: `Invented Trust ${i}`,
  url: `https://www.sec.gov/Archives/edgar/data/900000${i}/0009000001310001${i}/0009000001-31-00010${i}-index.htm`,
  shares: 1000 - i * 100, value: 10_000 - i * 1_000, pct: 1.5, period: '2031-06-30', prior_period: '2031-03-31',
  prior_shares: 800, change_shares: 200 - i * 100, change_pct: 25 - i * 12.5, state: 'added', ...over,
})

const BLOCK = {
  state: 'ok', source: NPORT_SOURCE, sym: 'ZQAA',
  data_set: { quarter: '2031Q3', prior_quarter: '2031Q2', built_at: '2031-10-06T09:51:00+00:00',
    periods: { from: '2031-05-31', to: '2031-08-31' } },
  coverage: { matched_value_pct: 87.25, matched_rows_pct: 80, pct_units: 'percent' },
  summary: { funds: 41, shares: 2_450_000, value: 98_000_000, value_complete: true, added: 12, cut: 9, unchanged: 3,
    new: 5, no_prior: 4, sold_out: 2, both_now: 2_100_000, both_prior: 2_250_000, period_from: '2031-05-31',
    period_to: '2031-08-31', tier: 'fund_ticker', votes: 37 },
  holders: [fund(0), fund(1, { state: 'unchanged', change_shares: 0, change_pct: 0 }),
    fund(2, { state: 'cut', change_shares: -150, change_pct: -15.789 }),
    fund(3, { state: 'new', prior_shares: 0, change_shares: 700, change_pct: null }),
    fund(4, { state: 'no_prior', prior_shares: null, prior_period: null, change_shares: null, change_pct: null, value: null, pct: null })],
  holders_total: 41, holders_limit: 50,
  sold_out: [{ name: 'Ostler Income Fund', family: 'Ostler Funds', prior_shares: 7_000, prior_value: 63_000,
    prior_period: '2031-03-31', period: '2031-06-30', url: 'https://www.sec.gov/x' }],
  sold_out_total: 2,
}

describe('rows', () => {
  it('reads every field, drops a link that is not to sec.gov, and keeps the server order', () => {
    const rows = nportRows({ holders: [fund(0, { url: 'https://example.invalid/x' }), null, fund(1)] })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Invented Fund 0', family: 'Invented Trust 0', url: null, shares: 1000,
      value: 10_000, pct: 1.5, period: '2031-06-30', priorShares: 800, priorPeriod: '2031-03-31', changeShares: 200,
      state: 'added', rank: 0 })
    expect(rows[1].url).toMatch(/^https:\/\/www\.sec\.gov\//)
    expect(nportRows(null)).toEqual([])
  })

  it('a missing figure stays null, never 0', () => {
    const [r] = nportRows({ holders: [{ name: 'X', shares: '', value: null, pct: undefined, state: 'bogus' }] })
    expect(r.shares).toBeNull()
    expect(r.value).toBeNull()
    expect(r.pct).toBeNull()
    expect(r.state).toBeNull()
  })
})

describe('change words', () => {
  const rows = nportRows(BLOCK)
  it('added, unchanged, cut, new and no earlier report each read as themselves', () => {
    expect(rows.map(changeText)).toEqual(['+200', 'unchanged', '-150', 'new', 'no earlier report'])
    expect(rows.map(changePctText)).toEqual(['+25.0%', '0.0%', '-15.8%', 'new', NOT_KNOWN])
  })

  it('the colour follows the sign the text carries; a zero and an unknown have none', () => {
    const ch = NPORT_COLUMN_BY_KEY.change
    expect(rows.map((r) => toneOf(ch, r))).toEqual(['up', null, 'down', 'up', null])
    expect(toneOf(NPORT_COLUMN_BY_KEY.shares, rows[0])).toBeNull()
    expect(toneOf(NPORT_COLUMN_BY_KEY.changePct, { ...rows[0], changePct: -0.04 })).toBeNull()
  })
})

describe('columns and sorting', () => {
  it('core columns always; the previous-report columns only when a row carries them', () => {
    expect(nportColumns(nportRows(BLOCK)).map((c) => c.label)).toEqual(
      ['Fund', 'Shares', 'Change', 'Chg %', 'Value (USD)', '% of fund', 'Period', 'Shares before', 'Previous period'])
    const bare = nportRows({ holders: [{ name: 'A', shares: 5, state: 'no_prior' }] })
    expect(nportColumns(bare).map((c) => c.key)).toEqual(['fund', 'shares', 'change', 'changePct', 'value', 'pct', 'period'])
  })

  it('sorts by value by default, a missing figure sinks either way, and a new position is the largest add', () => {
    const rows = nportRows(BLOCK)
    expect(sortNportRows(rows).map((r) => r.name).at(-1)).toBe('Invented Fund 4')
    expect(sortNportRows(rows, { key: 'value', dir: 'asc' }).map((r) => r.name).at(-1)).toBe('Invented Fund 4')
    expect(sortNportRows(rows, { key: 'change', dir: 'desc' })[0].name).toBe('Invented Fund 3')
    expect(sortNportRows(rows, { key: 'fund', dir: 'desc' })[0].name).toBe('Invented Fund 4')
  })

  it('a header press flips its own column and starts a new one the natural way', () => {
    expect(nextNportSort(DEFAULT_SORT, 'value')).toEqual({ key: 'value', dir: 'asc' })
    expect(nextNportSort(DEFAULT_SORT, 'fund')).toEqual({ key: 'fund', dir: 'asc' })
    expect(nextNportSort(DEFAULT_SORT, 'period')).toEqual({ key: 'period', dir: 'desc' })
    expect(nextNportSort(DEFAULT_SORT, 'nope')).toBe(DEFAULT_SORT)
    expect(nportSortWords({ key: 'period', dir: 'asc' })).toBe('by period, oldest first')
    expect(nportSortWords({ key: 'fund', dir: 'asc' })).toBe('by fund, A to Z')
  })
})

describe('the lines', () => {
  it('who holds it and what changed, over every fund', () => {
    expect(nportSummaryLines(BLOCK)).toEqual([
      '41 funds reported a position: 2.5M shares worth $98.0M.',
      "Since each fund's previous report: 12 added, 9 cut, 3 unchanged, 5 new, 2 sold out. 4 funds have no earlier report in the data, so their change is not known.",
      'The funds with both reports held 2.1M shares, against 2.3M at their previous reports (-150K net).',
    ])
  })

  it('one fund, a partial value, and only no-earlier-report funds', () => {
    const s = { funds: 1, shares: 500, value: 4_000, value_complete: false, no_prior: 1, both_now: 0, both_prior: 0 }
    expect(nportSummaryLines({ summary: s })).toEqual([
      'One fund reported a position: 500 shares worth at least $4K (some funds gave no value).',
      'No fund has an earlier report in the data, so no change is known.',
    ])
    expect(nportSummaryLines({})).toEqual([])
  })

  it('the period span, the data sets, when they were read and how old a report can be', () => {
    expect(nportPeriodLine(BLOCK)).toBe(
      "Reports for periods ending May 31, 2031 to Aug 31, 2031, from the SEC's 2031 Q3 data set, each compared with the fund's previous report (the 2031 Q2 data set or the same one). Read on Oct 6, 2031. A fund files within 60 days after each fiscal quarter ends and the SEC posts these data sets once a quarter, so the newest report shown can be months old.")
    const noPrior = { ...BLOCK, data_set: { ...BLOCK.data_set, prior_quarter: null }, summary: { period_from: '2031-06-30', period_to: '2031-06-30' } }
    expect(nportPeriodLine(noPrior)).toMatch(/^Reports for the period ending Jun 30, 2031, from the SEC's 2031 Q3 data set\. Read on Oct 6, 2031\. The data set before it could not be read, so changes are not known\./)
  })

  it('where the list stops', () => {
    expect(nportHeldLine({ shown: 20, rows: 50, total: 312, limit: 50, sort: DEFAULT_SORT }))
      .toBe('Showing 20 of 50 funds, by value, highest first. The list keeps the top 50 of 312 funds by value.')
    expect(nportHeldLine({ shown: 4, rows: 4, total: 4, limit: 50, sort: DEFAULT_SORT })).toBe('All 4 funds listed, by value, highest first.')
    expect(nportHeldLine({ shown: 1, rows: 1, total: 1, sort: DEFAULT_SORT })).toBe('One fund listed, by value, highest first.')
    expect(nportHeldLine({ shown: 0, rows: 0 })).toBeNull()
  })

  it('the funds that sold out, and how many more', () => {
    const rows = nportSoldRows(BLOCK)
    expect(soldText(rows[0])).toBe('held 7K shares ($63K) at Mar 31, 2031; its Jun 30, 2031 report holds none.')
    expect(soldMoreLine(BLOCK, rows.length)).toBe('1 more fund sold out of it.')
    expect(soldMoreLine({ sold_out_total: 1 }, 1)).toBeNull()
    expect(soldText({ priorShares: null, priorValue: null, priorPeriod: null, period: null })).toBe('held it; its current report holds none.')
  })

  it('how the stock was matched, and what share of the data set was', () => {
    expect(nportMatchLine(BLOCK, 'ZQAA')).toBe('Matched to ZQAA by the ticker the funds gave for the security (37 reports), joined by its CUSIP.')
    expect(nportMatchLine({ summary: { tier: 'sec_ftd' } }, 'ZQAA')).toMatch(/fails-to-deliver records/)
    expect(nportMatchLine({ summary: { tier: 'sec_name' } }, 'ZQAA')).toMatch(/SEC's company name for ZQAA and no other ticker/)
    expect(nportMatchLine({ summary: {} }, 'ZQAA')).toBeNull()
    expect(nportCoverageLine(BLOCK)).toBe("Across the data set, 87.3% of the funds' common-stock holdings by value were matched to a ticker. A fund whose holding could not be matched is not listed.")
    expect(nportCoverageLine({ coverage: { pct_units: 'unclear' } })).toMatch(/^How much of the data set was matched to a ticker is not known\..*percent of each fund is not shown/)
  })
})

describe('states with no table', () => {
  it('not read yet: running, scheduled with the last attempt, or scheduled', () => {
    expect(nportStateWords({ state: 'not_built', building: true }, 'ZQAA')).toMatch(/running now/)
    expect(nportStateWords({ state: 'not_built', next_check: '2031-11-23T05:50', last_check: { state: 'not_published' } }, 'ZQAA'))
      .toBe("The SEC's Form N-PORT data sets have not been read on this server yet: the SEC has not posted a newer data set yet. The next check is Nov 23, 2031 at 05:50 New York time.")
    expect(nportStateWords({ state: 'not_built' }, 'ZQAA')).toBe("The SEC's Form N-PORT data sets have not been read on this server yet.")
  })

  it('could not be matched is never "no fund holds it"', () => {
    const w = nportStateWords({ state: 'not_matched', data_set: { quarter: '2031Q3' } }, 'ZQAA')
    expect(w).toBe('No fund holding in the newest N-PORT data set (2031 Q3) could be matched to ZQAA. That is not the same as no fund holding it.')
  })

  it('held before but not now, unreadable, an unknown state, and ok', () => {
    expect(nportStateWords({ state: 'none_now' }, 'ZQAA')).toMatch(/^No fund's current report holds ZQAA\./)
    expect(nportStateWords({ state: 'unavailable' }, 'ZQAA')).toMatch(/gap in the read, not a finding/)
    expect(nportStateWords({ state: 'odd' }, 'ZQAA')).toBe('The fund holdings could not be read right now.')
    expect(nportStateWords(BLOCK, 'ZQAA')).toBeNull()
  })

  it('a newer read that did not finish is said beside the list', () => {
    expect(nportCheckLine({ check: { state: 'stopped' } })).toMatch(/^The last attempt to read a newer data set did not finish: the read was stopped/)
    expect(nportCheckLine({ check: { state: 'built' } })).toBeNull()
    expect(nportCheckLine({})).toBeNull()
  })
})

describe('small words', () => {
  it('quarters, times and the table name', () => {
    expect(quarterWords('2031Q3')).toBe('2031 Q3')
    expect(quarterWords(null)).toBeNull()
    expect(checkTimeWords('2031-11-23T05:50')).toBe('Nov 23, 2031 at 05:50 New York time')
    expect(checkTimeWords('soon')).toBeNull()
    expect(nportTableName(BLOCK)).toBe('Funds (N-PORT) holders, 2031 Q3 data set')
    expect(nportTableName({})).toBe('Funds (N-PORT) holders')
    expect(NOT_REPORTED).toBe('not reported')
  })
})
