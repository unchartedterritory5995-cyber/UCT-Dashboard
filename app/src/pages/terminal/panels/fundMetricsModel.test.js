// FUND's pure half. Every company, ticker and figure here is invented (__fixtures__/fundMetricsFixture.js);
// the catalog is the server's own payload (__fixtures__/fundCatalogFixture.js), checked against catalog.py.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { barsUrl as storeBarsUrl } from '../../../data/barStore/network'
import { keyOf } from '../../../data/barStore/types'
import {
  ANCHOR_SERIES, DEFAULT_METRICS, FUND_METRIC_ARG_WORDS, FUND_SOURCE_LINE, MAX_METRICS, TABLE_QUARTERS, WORD_OF_METRIC,
  alignmentNote, barsUrl, closeFor, columnsOf, companyOf, companyQuarters, dateText, fiscalYearEnd, fundCommandArgs,
  fundFailure, fundLine, fundView, lagNote, lineGeometry, metricCell, metricsToken, normMetrics, normPeers, ownLimitations,
  parseFundMetric, parseFundMetrics, parseFundPeers, peerInput, peerToken, pricesOf, quarterBucket, readCatalog, readSeries,
  rowWords, seriesIdsFor, seriesUrl, shownColumns, valuationNote, valueText,
} from './fundMetricsModel'
import { spreadGeometry } from './ratesModel'
import { isCode } from '../functions'
import {
  A_ENDS, B_ENDS, COMPANIES, FUND_CATALOG, FUND_NOW_SEC, FUND_TODAY, barsAnswer, closeOn, morningOf, plusDays, seriesAnswer,
} from './__fixtures__/fundMetricsFixture'
import { fundamentalColumn } from '../../../components/chart/engine/fundamentalSource'
import { _resetFundamentalsForTests, primeFundamentalsCatalog } from '../../../components/chart/engine/fundamentalSeries'

const CATALOG = readCatalog(FUND_CATALOG)
const REPO = path.join(process.cwd(), '..')
const read = (sym, ids = seriesIdsFor(DEFAULT_METRICS, CATALOG)) => ({ body: seriesAnswer(sym, seriesUrl(sym, ids)), error: null, loading: false })
const company = (sym, ids) => companyOf(sym, read(sym, ids))
const prices = (sym) => pricesOf(sym, { body: barsAnswer(sym), error: null, loading: false })
const col = (pe) => ({ key: quarterBucket(pe).key })
const m = (id) => CATALOG.byId.get(id)
const ctx = (sym) => ({ nowSec: FUND_NOW_SEC, today: FUND_TODAY, prices: prices(sym) })

afterEach(() => _resetFundamentalsForTests())

describe('the words', () => {
  it('one word per catalog metric: the ids are catalog.py\'s own, every one of them, none twice', () => {
    const src = fs.readFileSync(path.join(REPO, 'api', 'services', 'fundamentals_pit', 'catalog.py'), 'utf8')
    const ids = [...src.matchAll(/MetricDef\("(\w+)"/g)].map((x) => x[1])
    expect(ids.length).toBe(29)
    expect(Object.values(FUND_METRIC_ARG_WORDS).sort()).toEqual([...ids].sort())
    expect(new Set(Object.values(FUND_METRIC_ARG_WORDS)).size).toBe(ids.length)
    expect(FUND_CATALOG.metrics.map((x) => x.id).sort()).toEqual([...ids].sort())   // the fixture is the server's catalog
    expect(DEFAULT_METRICS).toEqual(['revenue_ttm', 'eps_ttm', 'revenue_growth_ttm', 'net_margin', 'fcf_margin', 'pe_ttm'])
  })

  it('no word is a function code or a stock in the site\'s universe', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(REPO, 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('NVDA')).toBe(true)                       // the control: the list is the ticker list
    for (const w of Object.keys(FUND_METRIC_ARG_WORDS)) {
      expect([w, isCode(w), universe.has(w)]).toEqual([w, false, false])
    }
  })

  it('a word draws a line, a + set picks the rows, tickers compare; nothing else is taken', () => {
    expect(parseFundMetric('pe')).toBe('pe_ttm')
    expect(parseFundMetric('BETA1Y')).toBe('beta_1y_spy')
    expect(parseFundMetric('PE+')).toBeNull()
    expect(parseFundMetrics('rev+eps+pe')).toEqual(['revenue_ttm', 'eps_ttm', 'pe_ttm'])
    expect(parseFundMetrics('REV+')).toEqual(['revenue_ttm'])
    for (const no of ['REV', 'REV+REV', 'REV+NOPE', '+', Object.keys(FUND_METRIC_ARG_WORDS).slice(0, MAX_METRICS + 1).join('+')]) {
      expect([no, parseFundMetrics(no)]).toEqual([no, null])
    }
    expect(parseFundPeers('ZQXB ZQXC')).toEqual(['ZQXB', 'ZQXC'])
    expect(parseFundPeers('$GP')).toEqual(['GP'])                    // a code is a ticker only with $
    expect(parseFundPeers('GP')).toBeNull()
    expect(parseFundPeers('PE')).toBeNull()                          // a metric word too
    expect(parseFundPeers('$PE')).toEqual(['PE'])
    expect(parseFundPeers('A B C D')).toBeNull()                     // at most three
    expect(parseFundPeers('ZQXB ZQXB')).toBeNull()
  })

  it('the command keeps the choice; the default is the bare command', () => {
    expect(fundCommandArgs({})).toEqual([])
    expect(fundCommandArgs({ peers: ['ZQXB', 'GP'], metrics: [...DEFAULT_METRICS].reverse(), line: null })).toEqual(['ZQXB', '$GP'])
    expect(fundCommandArgs({ metrics: ['revenue_ttm', 'roe'], line: 'pe_ttm' })).toEqual(['REV+ROE', 'PE'])
    expect(fundCommandArgs({ metrics: ['roe'] })).toEqual(['ROE+'])
    expect(metricsToken(['revenue_ttm', 'eps_ttm'])).toBe('REV+EPS')
    expect(peerToken('PE')).toBe('$PE')
    expect(normPeers(['zqxb', 'ZQXA', 'ZQXB', '$ZQXC', 'ZQXD', 'ZQXE'], 'ZQXA')).toEqual(['ZQXB', 'ZQXC', 'ZQXD'])
    expect(normMetrics(undefined)).toEqual([...DEFAULT_METRICS])
    expect(normMetrics(['roe', 'nope', 'roe'])).toEqual(['roe'])
  })

  it('the add box says why a ticker cannot be added', () => {
    expect(peerInput(' zqxb ', { sym: 'ZQXA', peers: [] })).toEqual({ sym: 'ZQXB' })
    expect(peerInput('', { sym: 'ZQXA' }).error).toMatch(/Type a ticker/)
    expect(peerInput('1234', { sym: 'ZQXA' }).error).toMatch(/not a ticker/)
    expect(peerInput('ZQXA', { sym: 'ZQXA' }).error).toBe('ZQXA is the main ticker already.')
    expect(peerInput('ZQXB', { sym: 'ZQXA', peers: ['ZQXB'] }).error).toBe('ZQXB is compared already.')
    expect(peerInput('ZQXE', { sym: 'ZQXA', peers: ['ZQXB', 'ZQXC', 'ZQXD'] }).error).toMatch(/Up to 3/)
  })
})

describe('the catalog', () => {
  it('reads every metric the server serves, in its own categories and order', () => {
    expect(CATALOG.state).toBe('ok')
    expect(CATALOG.metrics).toHaveLength(29)
    expect(CATALOG.unknown).toBe(0)
    expect(CATALOG.categories).toEqual(['Financials', 'Growth', 'Profitability', 'Valuation', 'Financial Health', 'Shares & Dividends', 'Market'])
    expect(m('pe_ttm')).toMatchObject({ word: 'PE', compose: 'pe', inputs: ['eps_diluted_ttm'], unit: 'ratio', fmt: 'x2', cadence: 'daily', series: null })
    expect(m('eps_ttm')).toMatchObject({ series: 'eps_diluted_ttm', requires: ['split_ledger'] })
    expect(m('beta_1y_spy')).toMatchObject({ series: 'beta_1y_spy', cadence: 'daily', compose: null })
  })

  it('an answer that is not the catalog, an empty one, and a metric the panel does not know', () => {
    expect(readCatalog({ detail: 'x' }).state).toBe('bad_shape')
    expect(readCatalog(null).state).toBe('bad_shape')
    expect(readCatalog({ metrics: [] }).state).toBe('empty')
    const extra = readCatalog({ ...FUND_CATALOG, metrics: [...FUND_CATALOG.metrics, { id: 'new_one', name: 'New one', series: 'new_one', category: 'Growth' }] })
    expect([extra.metrics.length, extra.unknown]).toEqual([29, 1])
  })

  it('asks only for series the catalog serves: what the rows need, the anchors, sorted', () => {
    expect(seriesIdsFor(DEFAULT_METRICS, CATALOG)).toEqual(['assets', 'eps_diluted_ttm', 'fcf_margin_ttm', 'net_income_ttm', 'net_margin_ttm', 'revenue_growth_ttm', 'revenue_ttm'])
    expect(seriesIdsFor(['market_cap'], CATALOG)).toEqual([...ANCHOR_SERIES, 'shares_outstanding'].sort())
    const all = seriesIdsFor(CATALOG.metrics.map((x) => x.id), CATALOG)
    expect(all.length).toBeLessThanOrEqual(40)                     // the route reads the first 40
    expect(all).toContain('beta_1y_spy')
    expect(seriesUrl('ZQXA', ['a', 'b'])).toBe('/api/fundamentals/pit/series/ZQXA?series=a,b')
    // the bar store's own weekly key (the chart's cache entry), never a hand-built URL
    expect(barsUrl('zqxa')).toBe(storeBarsUrl(keyOf({ sym: 'ZQXA', tf: 'W' })))
    expect(barsUrl('zqxa')).toMatch(/^\/api\/bars\/ZQXA\?tf=W&bars=\d+/)
  })
})

describe('fiscal quarters', () => {
  it('a fiscal quarter goes in the calendar quarter that holds most of it', () => {
    expect(quarterBucket('2026-01-25')).toMatchObject({ key: '2025Q4', months: 'Oct-Dec' })   // late-January year end
    expect(quarterBucket('2025-12-27')).toMatchObject({ key: '2025Q4' })                      // a 52-week year
    expect(quarterBucket('2026-02-01')).toMatchObject({ key: '2025Q4' })                      // Nov 3 to Feb 1
    expect(quarterBucket('2026-05-03')).toMatchObject({ key: '2026Q1' })                      // Feb 2 to May 3: mostly Q1
    expect(quarterBucket('2026-09-30')).toMatchObject({ key: '2026Q3', months: 'Jul-Sep', year: 2026 })
    expect(quarterBucket('nope')).toBeNull()
  })

  it('each company: one column per fiscal quarter, dated by when its first figure became public', () => {
    const a = company('ZQXA')
    expect(a.state).toBe('ok')
    expect(a.quarters.byBucket.size).toBe(A_ENDS.length)
    const newest = a.quarters.byBucket.get('2026Q3')
    expect(newest.pe).toBe('2026-10-25')
    expect(newest.firstT).toBe(morningOf('2026-11-18'))
    expect(a.quarters.merged).toEqual([])
  })

  it('two quarters in one calendar quarter (a fiscal year change) keep the later one and say so', () => {
    const s = readSeries({ symbol: 'X', metrics: { assets: [[1, 5, '2026-03-31', 'instant'], [2, 6, '2026-04-30', 'instant']] }, missing: [] }, 'X')
    const q = companyQuarters(s)
    expect(q.byBucket.get('2026Q1').pe).toBe('2026-04-30')
    expect(q.merged).toEqual(['2026-03-31'])
  })

  it('the fiscal year end is read from the companies\' own year-end figures', () => {
    expect(fiscalYearEnd(company('ZQXA').series)).toBe(1)
    expect(fiscalYearEnd(company('ZQXB').series)).toBe(12)
    expect(fiscalYearEnd(company('ZQXC').series)).toBe(11)
    expect(fiscalYearEnd({ points: {} })).toBeNull()
  })
})

describe('cells', () => {
  it('a value in the catalog\'s format with the day its filing became public', () => {
    const a = company('ZQXA')
    const c = metricCell(m('revenue_ttm'), a, col('2026-10-25'), ctx('ZQXA'))
    expect(c).toMatchObject({ state: 'ok', v: 92e9, text: '$92.00B', date: '2026-11-18', line2: 'Nov 18' })
    expect(c.words).toBe('$92.00B, quarter ended Oct 25, 2026, public Nov 18, 2026.')
    expect(metricCell(m('net_margin'), a, col('2026-10-25'), ctx('ZQXA')).text).toBe('33.0%')
    expect(metricCell(m('revenue_growth_ttm'), a, col('2026-10-25'), ctx('ZQXA')).text).toBe('21.1%')
    expect(metricCell(m('eps_ttm'), a, col('2026-10-25'), ctx('ZQXA')).text).toBe('$12.14')
  })

  it('a figure a later filing revised shows the newest, with the first one in words', () => {
    const c = metricCell(m('revenue_ttm'), company('ZQXA'), col('2026-07-26'), ctx('ZQXA'))
    expect(c).toMatchObject({ state: 'ok', text: '$88.50B', revised: true, date: '2026-09-08' })
    expect(c.words).toContain('A later filing revised it; first made public Aug 19, 2026 as $88.00B.')
  })

  it('never a 0: a figure the filing does not give, a quarter not filed, a quarter with no figure', () => {
    const a = company('ZQXA')
    const gap = metricCell(m('fcf_margin'), a, col('2026-10-25'), ctx('ZQXA'))
    expect(gap).toMatchObject({ state: 'gap', text: 'Not derivable', v: null })
    const early = metricCell(m('revenue_growth_ttm'), a, col(A_ENDS[0]), ctx('ZQXA'))
    expect(early).toMatchObject({ state: 'none', text: 'Not reported', words: 'Not reported in its filings for this quarter.' })
    const none = metricCell(m('revenue_ttm'), a, { key: '2019Q1' }, ctx('ZQXA'))
    expect(none).toMatchObject({ state: 'no_quarter', text: 'No filing' })
    for (const x of [gap, early, none]) expect(x.text).not.toMatch(/^\$?0/)
  })

  it('the cover-page share count is the one stated after the quarter end', () => {
    const a = company('ZQXA', seriesIdsFor(['shares_outstanding'], CATALOG))
    const c = metricCell(m('shares_outstanding'), a, col('2026-10-25'), ctx('ZQXA'))
    expect(c).toMatchObject({ state: 'ok', text: '2.50B', date: '2026-11-18' })
  })
})

describe('valuation, composed with prices', () => {
  it('P/E is the first weekly close after the filing, over the EPS TTM known at that close', () => {
    const a = company('ZQXA')
    const c = metricCell(m('pe_ttm'), a, col('2026-10-25'), ctx('ZQXA'))
    const eps = COMPANIES.ZQXA.rows[13].eps_diluted_ttm
    expect(c.state).toBe('ok')
    expect(c.date).toBe('2026-11-20')                              // filed Wed Nov 18; that week's close
    expect(c.v).toBeCloseTo(closeOn('ZQXA', '2026-11-20') / eps, 10)
    expect(c.text).toBe(`${(closeOn('ZQXA', '2026-11-20') / eps).toFixed(2)}x`)
    expect(c.words).toMatch(/at the weekly close of Nov 20, 2026 \(close \$\d+\.\d\d\), from the figures known then \(quarter ended Oct 25, 2026\)\.$/)
  })

  it('agrees with the chart: the same composer and as-of rule on the same weekly closes', () => {
    primeFundamentalsCatalog(FUND_CATALOG)
    const a = company('ZQXA')
    const bars = barsAnswer('ZQXA').bars.map((b) => ({ t: b.t }))
    const close = barsAnswer('ZQXA').bars.map((b) => b.c)
    const entry = { series: Object.fromEntries(Object.entries(a.series.points).map(([id, pts]) => [id, pts])) }
    for (const metricId of ['pe_ttm', 'ps_ttm', 'pb', 'fcf_yield', 'market_cap']) {
      const ids = seriesIdsFor([metricId], CATALOG)
      const co = company('ZQXA', ids)
      const chart = fundamentalColumn({ kind: 'fundamental', metric: metricId }, {
        bars, tf: 'W', sym: 'ZQXA', fundamentals: new Map([['ZQXA', { series: co.series.points }]]), closeOf: () => close,
      })
      for (const pe of A_ENDS.slice(-6)) {
        const c = metricCell(m(metricId), co, col(pe), ctx('ZQXA'))
        const i = bars.findIndex((b) => b.t === c.date)
        expect([metricId, pe, c.state]).toEqual([metricId, pe, 'ok'])
        expect([metricId, pe, Math.abs(c.v - chart[i]) < 1e-9 * Math.max(1, Math.abs(c.v))]).toEqual([metricId, pe, true])
      }
    }
    expect(entry.series.eps_diluted_ttm.length).toBeGreaterThan(0)
  })

  it('a zero or negative EPS is "n/m", never a negative P/E', () => {
    const b = company('ZQXB')
    const c = metricCell(m('pe_ttm'), b, col(B_ENDS[0]), ctx('ZQXB'))
    expect(c).toMatchObject({ state: 'not_meaningful', text: 'n/m', v: null, words: 'Not meaningful: EPS TTM is zero or negative.' })
  })

  it('a filing after Friday\'s close reads the next week\'s close', () => {
    const closes = barsAnswer('ZQXA').bars.map((b) => ({ d: b.t, c: b.c }))
    const after = closeFor(closes, Date.UTC(2026, 10, 13, 21, 30) / 1000, FUND_NOW_SEC)   // Fri Nov 13, 4:30 PM ET
    expect(after.d).toBe('2026-11-20')
    const before = closeFor(closes, Date.UTC(2026, 10, 13, 20, 30) / 1000, FUND_NOW_SEC)  // 3:30 PM ET
    expect(before.d).toBe('2026-11-13')
    expect(closeFor(closes, Date.UTC(2026, 10, 25, 14) / 1000, FUND_NOW_SEC)).toEqual({ state: 'no_price', after: true })
    expect(closeFor([], morningOf('2026-11-18'), FUND_NOW_SEC).state).toBe('no_price')
    // a week still open is said
    const open = closeFor(closes, morningOf('2026-11-16'), Date.UTC(2026, 10, 18, 15) / 1000)
    expect(open).toMatchObject({ d: '2026-11-20', forming: true })
  })

  it('prices in words: loading, preparing, not held, failed', () => {
    expect(pricesOf('ZQXA', { loading: true }).state).toBe('loading')
    expect(pricesOf('ZQXA', { body: null, error: { status: 503 } }, { warming: true }).words).toBe("The server is still preparing ZQXA's prices. Retry in a minute.")
    expect(pricesOf('ZQXA', { body: null, error: { status: 404 } }).state).toBe('not_held')
    expect(pricesOf('ZQXA', { body: { bars: [] }, error: null }).state).toBe('not_held')
    expect(pricesOf('ZQXA', { body: null, error: { status: 500 } }).words).toBe("UCT's stored prices for ZQXA could not be read just now.")
    expect(prices('ZQXA').closes.length).toBeGreaterThan(190)
  })
})

describe('rows in words', () => {
  it('a series the company does not have, a split history not verified, prices not read', () => {
    const b = company('ZQXB')
    expect(rowWords(m('fcf_margin'), b, null)).toBe('Not reported in its filings.')
    const c = company('ZQXC')
    expect(rowWords(m('eps_ttm'), c, null)).toBe('Withheld for ZQXC: its split history could not be verified, so per-share and share-count figures are not shown.')
    expect(rowWords(m('revenue_ttm'), c, null)).toBeNull()
    const a = company('ZQXA')
    expect(rowWords(m('pe_ttm'), a, pricesOf('ZQXA', { body: null, error: { status: 500 } }))).toBe("UCT's stored prices for ZQXA could not be read just now.")
    expect(rowWords(m('pe_ttm'), a, null)).toBe("Loading UCT's stored prices for ZQXA.")
    const noBeta = company('ZQXA', seriesIdsFor(['beta_1y_spy'], CATALOG))
    expect(rowWords(m('beta_1y_spy'), noBeta, null)).toBe('No Beta is held for ZQXA yet: it needs about a year of daily prices.')
  })

  it('a company the server does not hold, one that failed, an answer that is not the route\'s', () => {
    expect(companyOf('ZQXD', { body: null, error: { status: 404 }, loading: false })).toMatchObject({ state: 'not_held', short: 'No figures held for ZQXD.' })
    expect(companyOf('ZQXD', { body: null, error: { status: 500 }, loading: false })).toMatchObject({ state: 'failed', retry: true })
    expect(companyOf('ZQXD', { body: { detail: 'x' }, error: null, loading: false })).toMatchObject({ state: 'failed' })
    expect(companyOf('ZQXA', { body: seriesAnswer('ZQXB', seriesUrl('ZQXB', ['assets'])), error: null, loading: false }).state).toBe('failed')
    expect(companyOf('ZQXA', { loading: true }).state).toBe('loading')
  })
})

describe('the view', () => {
  const view = (syms, ids = DEFAULT_METRICS) => {
    const want = seriesIdsFor(ids, CATALOG)
    const companies = syms.map((s) => companyOf(s, COMPANIES[s] ? read(s, want) : { body: null, error: { status: 404 }, loading: false }))
    return fundView({ catalog: CATALOG, companies, metricIds: ids, prices: Object.fromEntries(syms.map((s) => [s, prices(s)])), nowSec: FUND_NOW_SEC, today: FUND_TODAY })
  }

  it('one company: its fiscal quarters newest first, headed by the quarter\'s last day', () => {
    const v = view(['ZQXA'])
    expect(v.columns).toHaveLength(14)
    expect(v.columns[0]).toEqual({ key: '2026Q3', top: 'Oct 25', bottom: '2026', title: 'Fiscal quarter ended Oct 25, 2026' })
    expect(v.groups.map((g) => g.metric.word)).toEqual(['REV', 'EPS', 'REVG', 'NETM', 'FCFM', 'PE'])
    expect(v.note).toBeNull()
    expect(v.newestT).toBe(morningOf('2026-11-18'))
    expect(shownColumns(v.columns, false)).toHaveLength(TABLE_QUARTERS)
    expect(shownColumns(v.columns, true)).toHaveLength(14)
  })

  it('compared: calendar quarters, each company\'s quarter in the one that holds most of it, and a note', () => {
    const v = view(['ZQXA', 'ZQXB'])
    expect(v.columns[0]).toMatchObject({ key: '2026Q3', top: 'Jul-Sep', bottom: '2026' })
    const rev = v.groups[0].rows
    expect(rev.map((r) => r.cells[0].pe)).toEqual(['2026-10-25', '2026-09-30'])
    expect(v.note).toBe('Fiscal years differ: ZQXA\'s ends in January, ZQXB\'s ends in December. ZQXA\'s quarters end in Jan, Apr, Jul and Oct; '
      + 'ZQXB\'s quarters end in Mar, Jun, Sep and Dec. Each column is a calendar quarter and holds each company\'s fiscal quarter that falls '
      + 'mostly inside it, so the quarter ends in one column can be up to 4 weeks apart. Hover a figure for its own quarter end.')
    expect(v.groups.find((g) => g.metric.word === 'FCFM').rows[1].words).toBe('Not reported in its filings.')
  })

  it('a company not held is one short line in each row; the note is only about the companies read', () => {
    const v = view(['ZQXA', 'ZQXD'])
    expect(v.groups[0].rows[1]).toMatchObject({ sym: 'ZQXD', words: 'No figures held for ZQXD.', cells: [] })
    expect(v.note).toBeNull()
  })

  it('the alignment note: same months say nothing, a year end not held is said', () => {
    const fake = (sym, ends, yearEnd) => ({ sym, state: 'ok', yearEnd, quarters: { byBucket: new Map(ends.map((pe) => [quarterBucket(pe).key, { pe, bucket: quarterBucket(pe) }])) } })
    const cols = columnsOf([fake('X', ['2026-06-30'], 12)])
    expect(alignmentNote([fake('X', ['2026-06-30'], 12), fake('Y', ['2026-06-27'], 12)], cols)).toBeNull()
    expect(alignmentNote([fake('X', ['2026-06-30'], 12), fake('Y', ['2026-06-27'], 6)], cols))
      .toBe("Fiscal years differ: X's ends in December, Y's ends in June. Their quarters end within a week of each other, so each column is the same three months for every company.")
    expect(alignmentNote([fake('X', ['2026-06-30'], 12), fake('Y', ['2026-06-27'], null)], cols)).toBe('Y: the fiscal year end is not in the filings held here.')
  })
})

describe('the line', () => {
  it('one series is the RATES / LIQ picture; several share one range; a missing value breaks the line', () => {
    const one = lineGeometry([{ key: 'X', values: [1, 2, null, 4] }])
    const rates = spreadGeometry({ dates: ['1', '2', '3', '4'], v: [1, 2, null, 4] }, 'v', { withZero: false })
    expect(one.lines[0].path).toBe(rates.path)
    expect(one.lines[0].path.match(/M/g)).toHaveLength(2)          // broken at the null, never bridged
    const two = lineGeometry([{ key: 'X', values: [10, 20, 30] }, { key: 'Y', values: [100, 200, 300] }])
    expect([two.min, two.max]).toEqual([10, 300])
    const solo = lineGeometry([{ key: 'X', values: [10, 20, 30] }])
    expect(two.lines[0].path).not.toBe(solo.lines[0].path)        // one range for both, not one each
    expect(lineGeometry([{ key: 'X', values: [-5, 5] }], { withZero: true }).zeroY).not.toBeNull()
    expect(lineGeometry([{ key: 'X', values: [5, null] }])).toBeNull()
  })

  it('a metric over every quarter held, in words, with a legend when compared', () => {
    const want = seriesIdsFor(DEFAULT_METRICS, CATALOG)
    const v = fundView({ catalog: CATALOG, companies: [companyOf('ZQXA', read('ZQXA', want)), companyOf('ZQXB', read('ZQXB', want))],
      metricIds: DEFAULT_METRICS, prices: { ZQXA: prices('ZQXA'), ZQXB: prices('ZQXB') }, nowSec: FUND_NOW_SEC, today: FUND_TODAY })
    const line = fundLine(v, 'revenue_ttm')
    expect(line.state).toBe('ok')
    expect(line.quarters).toBe(14)
    expect(line.fromText).toBe('Apr-Jun 2023')
    expect(line.toText).toBe('Jul-Sep 2026')
    expect(line.words[0]).toBe('ZQXA: low $40.00B (Apr-Jun 2023), high $92.00B (Jul-Sep 2026), newest $92.00B (Jul-Sep 2026).')
    expect(line.words[1]).toMatch(/^ZQXB: low \$10\.00B \(Jul-Sep 2023\), high \$16\.00B/)
    expect(line.words[1]).toContain('1 of 14 quarters have no figure and the line breaks there')
    expect(line.legend).toEqual([{ sym: 'ZQXA', style: 0, last: '$92.00B' }, { sym: 'ZQXB', style: 1, last: '$16.00B' }])
    const fcf = fundLine(v, 'fcf_margin')
    expect(fcf.words.at(-1)).toBe('ZQXB: Not reported in its filings.')
    expect(fundLine(v, 'nope').state).toBe('words')
  })
})

describe('words for reads and notes', () => {
  it('a failed catalog read: signed out, plan, switched off, timeout, error', () => {
    expect(fundFailure({ status: 401 })).toMatchObject({ state: 'signed_out', kind: 'error', retry: true })
    expect(fundFailure({ status: 403 })).toMatchObject({ state: 'plan', kind: 'locked', retry: false })
    expect(fundFailure({ status: 402 }).state).toBe('plan')
    expect(fundFailure({ status: 404 })).toMatchObject({ state: 'off', kind: 'locked', retry: false, title: 'Company metrics from SEC filings are switched off for this server.' })
    expect(fundFailure({ status: 0, timedOut: true }).state).toBe('timeout')
    expect(fundFailure(null)).toMatchObject({ state: 'error', retry: true })
  })

  it('the catalog\'s own notes: the filing lag said once, each metric\'s own limits, valuation composed with prices', () => {
    const lag = lagNote(CATALOG.metrics)
    expect(lag).toBe('Updates when the 10-Q/10-K is filed, which can follow the earnings press release by days; press-release figures are not machine-readable.')
    expect(ownLimitations(m('revenue_ttm'))).toBeNull()
    expect(ownLimitations(m('fcf_ttm'))).toBe('Unavailable where capex is tagged with a company-specific concept.')
    expect(valuationNote([m('revenue_ttm')])).toBeNull()
    expect(valuationNote([m('pe_ttm')])).toMatch(/^P\/E \(TTM\) is not filed: UCT works it out from its stored weekly close/)
    expect(FUND_SOURCE_LINE).toBe("SEC filings (XBRL), as filed; each value dated by when its filing became public. Valuation uses UCT's stored prices.")
  })

  it('formats through the catalog\'s own fmt; no number is never 0', () => {
    expect(valueText(1234.5e9, 'compact_usd')).toBe('$1.23T')
    expect(valueText(-2.5e8, 'compact_usd')).toBe('-$250.0M')
    expect(valueText(-0.31, 'usd2')).toBe('-$0.31')
    expect(valueText(23.456, 'pct1')).toBe('23.5%')
    expect(valueText(32.1, 'x2')).toBe('32.10x')
    expect(valueText(1.234, 'num2')).toBe('1.23')
    expect(valueText(2.5e9, 'compact')).toBe('2.50B')
    expect(valueText(null, 'pct1')).toBeNull()
    expect(valueText(NaN, 'x2')).toBeNull()
    expect(dateText('2026-11-18')).toBe('Nov 18, 2026')
    expect(plusDays('2026-11-18', 2)).toBe('2026-11-20')
    expect(WORD_OF_METRIC.pe_ttm).toBe('PE')
  })
})
