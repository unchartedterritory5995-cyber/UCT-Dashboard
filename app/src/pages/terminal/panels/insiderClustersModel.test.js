// INS CLUSTER's pure half (insiderClustersModel.js). Every company, person, ticker and number here
// is invented.
import { describe, it, expect } from 'vitest'
import {
  INS_CLUSTERS_BUILDING_POLL_MS, INS_CLUSTERS_POLL_MS, INS_CLUSTERS_SOURCE, INS_CLUSTERS_URL,
  avgText, changeText, closeWhy, clusterRows, clustersPollMs, clustersRead, cutText, instantText, notBuiltText,
  personLine, readText, rolesText, ruleText, valueText,
} from './insiderClustersModel'

const CLUSTER = {
  issuer_cik: '0009900001', ticker: 'qfrb', company: 'Quillfeather Robotics Inc', insiders: 3,
  roles: { ceo: 1, cfo: 1, officer: 0, director: 1, ten_percent: 0, other: 0, not_stated: 0 },
  people: [
    { names: ['Anneliese Marrow-Quint'], role: 'ceo', last_buy: '2031-03-10', value: 12500 },
    { names: ['Invented Capital Partners LP', 'Invented Capital GP LLC'], role: 'ten_percent', last_buy: '2031-03-12', value: null },
  ],
  first_buy: '2031-03-10', last_buy: '2031-03-13', buys: 4, filings: 3, last_filed: '2031-03-14',
  shares: 3500, value: 43300, value_complete: false, unpriced_buys: 1, avg_price: 12.7353,
  close: { value: 13.75, date: '2031-03-14', reason: null }, change_pct: 7.97,
  url: 'https://www.sec.gov/Archives/edgar/data/9900001/000123456731000103/0001234567-31-000103-index.htm',
}
const NO_TICKER = {
  issuer_cik: '0009900002', ticker: null, company: 'Vellumark Biosystems Corp', insiders: 4,
  roles: { director: 4 }, people: [], first_buy: '2031-03-11', last_buy: '2031-03-11', buys: 4, filings: 4,
  value: 9000, value_complete: true, avg_price: 4.5, close: { value: null, date: null, reason: 'no_ticker' }, change_pct: null,
  url: 'https://example.test/not-the-sec',
}
const OK = {
  status: 'ok', as_of: '2031-03-14', read_at: '2031-03-15T05:23:00+00:00', source: INS_CLUSTERS_SOURCE,   // 1:23 AM EDT
  rules: { min_insiders: 3, window_business_days: 10 }, clusters: [CLUSTER, NO_TICKER], total: 2, truncated: false,
  coverage: { complete: true, listed: 6400, read: 6400, given_up: 0, from: '2031-02-27', to: '2031-03-14', window_weekdays: 12 },
  last_run: { stop: null }, building: false, next_run: '2031-03-18T01:20-04:00',
}

describe('the route and the source', () => {
  it('reads the cluster route and names the SEC filings as the source', () => {
    expect(INS_CLUSTERS_URL).toBe('/api/insider/clusters')
    expect(INS_CLUSTERS_SOURCE).toBe('SEC Form 4 filings (open-market purchases)')
  })
})

describe('roles, money and dates in words', () => {
  it('counts each role once, highest first, and leaves out the roles nobody holds', () => {
    expect(rolesText(CLUSTER.roles)).toBe('CEO, CFO, director')
    expect(rolesText({ director: 2, ten_percent: 1 })).toBe('2 directors, 10% owner')
    expect(rolesText({ ceo: 0, officer: 3, other: 1, not_stated: 2 })).toBe('3 officers, other insider, 2 roles not stated')
    expect(rolesText(null)).toBe('')
    expect(rolesText({ director: -1, ceo: 1.5 })).toBe('')
  })

  it('a total some purchases gave no price for is "at least", and a missing total is never 0', () => {
    expect(valueText(43300, true)).toBe('$43K')
    expect(valueText(43300, false)).toBe('at least $43K')
    expect(valueText(null, true)).toBe('not stated')
    expect(valueText(undefined, false)).toBe('not stated')
  })

  it('an insider in one line, and a close that is missing says why', () => {
    expect(personLine(CLUSTER.people[0])).toBe('Anneliese Marrow-Quint, CEO: $13K, last buy Mar 10')
    expect(personLine(CLUSTER.people[1])).toBe('Invented Capital Partners LP and Invented Capital GP LLC, 10% owner: price not stated, last buy Mar 12')
    expect(personLine({})).toBe('Name not given, role not stated: price not stated')
    expect(closeWhy('no_ticker')).toBe('no ticker in the filing')
    expect(closeWhy('stale')).toBe('close not current')
    expect(closeWhy('not_held')).toBe('close not held')
    expect(changeText(7.97)).toBe('+7.97%')
    expect(changeText(-3.1)).toBe('-3.10%')
    expect(changeText(null)).toBe('')
    expect(avgText(12.7353)).toBe('avg $12.74')
    expect(avgText(null)).toBe('')
  })
})

describe('the answer', () => {
  it('rows keep the server order, a filer with no ticker stays plain text, and only an SEC link is kept', () => {
    const rows = clusterRows(OK.clusters)
    expect(rows.map((r) => r.sym)).toEqual(['QFRB', null])
    expect(rows[0]).toMatchObject({
      company: 'Quillfeather Robotics Inc', insiders: 3, roles: 'CEO, CFO, director', value: 43300, valueComplete: false,
      avgPrice: 12.7353, close: 13.75, closeDate: '2031-03-14', closeReason: null, change: 7.97,
      firstBuy: '2031-03-10', lastBuy: '2031-03-13', buys: 4, filings: 3,
    })
    expect(rows[0].url).toBe(CLUSTER.url)
    expect(rows[0].people).toHaveLength(2)
    expect(rows[1]).toMatchObject({ company: 'Vellumark Biosystems Corp', close: null, closeReason: 'no_ticker', url: null })
    // an entry with no insiders, or with no name at all, is not a row
    expect(clusterRows([{ ticker: 'ZQXA', insiders: 0 }, { insiders: 3 }, null, 'x'])).toEqual([])
  })

  it('reads ok, not built and anything else as failed', () => {
    const ok = clustersRead(OK)
    expect(ok).toMatchObject({ state: 'ok', total: 2, truncated: false, asOf: '2031-03-14', building: false })
    expect(ok.coverage).toEqual({ complete: true, listed: 6400, read: 6400, givenUp: 0, from: '2031-02-27', to: '2031-03-14', weekdays: 12 })
    expect(clustersRead({ status: 'not_built', building: true, next_run: '2031-03-18T01:20-04:00' }))
      .toEqual({ state: 'not_built', building: true, nextRun: '2031-03-18T01:20-04:00' })
    for (const bad of [null, [], 'x', { status: 'computing' }, { clusters: [] }]) expect(clustersRead(bad).state).toBe('failed')
  })

  it('the rule, the read and the cut are said in plain words, from the answer\'s own numbers', () => {
    const view = clustersRead(OK)
    expect(ruleText(view.rules)).toBe('Stocks where 3 or more insiders bought shares on the open market within 10 business days, from SEC Form 4 filings (transaction code P). Newest last buy first.')
    expect(readText(view)).toBe('Filings through Mar 14, read Sat Mar 15, 1:23 AM ET.')
    expect(cutText(view)).toBe('')
    const partial = clustersRead({ ...OK, truncated: true, total: 71, coverage: { ...OK.coverage, complete: false, read: 4100, given_up: 3 },
      last_run: { stop: 'refused' } })
    expect(readText(partial)).toBe('Filings through Mar 14, read Sat Mar 15, 1:23 AM ET. 4,100 of 6,400 Form 4 filings of the last 12 weekdays are read so far; the rest are read on the coming nights. 3 filings could not be read after three tries. The last nightly read stopped early because the SEC\'s website turned the server away; it carries on the next night.')
    expect(cutText(partial)).toBe('Showing the newest 2 of 71 clusters; the older ones are left off.')
  })

  it('a list not built yet says whether its first read is running, or when it is due', () => {
    expect(notBuiltText({ building: true })).toBe('The first nightly read of the SEC\'s Form 4 filings is running now. This panel asks again every minute.')
    expect(notBuiltText({ building: false, nextRun: '2031-03-18T01:20-04:00' }))
      .toBe('The first read of the SEC\'s Form 4 filings is due Tue Mar 18, 1:20 AM ET, and then each night after a weekday.')
    expect(notBuiltText({ building: false, nextRun: null })).toBe('The first read of the SEC\'s Form 4 filings runs overnight after a weekday.')
    expect(instantText('not a time')).toBe('')
  })

  it('asks again every minute only while the first read runs', () => {
    expect(clustersPollMs({ status: 'not_built', building: true })).toBe(INS_CLUSTERS_BUILDING_POLL_MS)
    expect(clustersPollMs({ status: 'not_built', building: false })).toBe(INS_CLUSTERS_POLL_MS)
    expect(clustersPollMs(OK)).toBe(INS_CLUSTERS_POLL_MS)
    expect(clustersPollMs(undefined)).toBe(INS_CLUSTERS_POLL_MS)
    expect(INS_CLUSTERS_BUILDING_POLL_MS).toBe(60 * 1000)
    expect(INS_CLUSTERS_POLL_MS).toBe(30 * 60 * 1000)
  })
})
