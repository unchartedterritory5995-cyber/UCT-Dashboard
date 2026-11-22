// SEG's pure half (revenueSegmentsModel.js). Every symbol, segment name and figure is invented.
import { describe, it, expect } from 'vitest'
import {
  SEG_COLUMNS, SEG_COMPUTING_POLL_MS, SEG_HELD_POLL_MS, SEG_PERIOD_ARG_WORDS, SEG_VIEW_ARG_WORDS, currencyNote, legNoteWords, legStateWords,
  legTables, moneyWords, normSegPeriod, normSegView, parseSegPeriod, parseSegView, periodEndWords, segCommandArgs, segLede, segPollMs,
  segRead, segUrl, shareWords,
} from './revenueSegmentsModel'

const seg = (name, revenue, share) => ({ name, revenue, share })
const period = (date, label, segments, over = {}) => ({ date, fiscal_year: date.slice(0, 4), label, currency: 'USD', total: 1e9, segments, cut: false, ...over })
const LEG = {
  state: 'ok', http_status: null, dropped: 0, cut: false,
  periods: [
    period('2029-09-29', 'FY2029', [seg('Kettles', 5e8, 66.67), seg('Lanterns', 2.5e8, 33.33)], { total: 7.5e8 }),
    period('2030-09-28', 'FY2030', [seg('Kettles', 6e8, 60), seg('Lanterns', 3e8, 30), seg('Ropes', 1e8, 10)]),
  ],
}
const BODY = (over = {}) => ({ status: 'ok', sym: 'QQZA', period: 'annual', read_at: '2031-03-12T14:02:00+00:00', source: 'Financial Modeling Prep',
  check: null, product: LEG, region: { state: 'not_in_plan', http_status: 403, periods: [], dropped: 0, cut: false }, ...over })

describe('the argument words', () => {
  it('views and periods, and the command each pick writes', () => {
    expect(SEG_VIEW_ARG_WORDS).toEqual({ PRODUCT: 'product', PRODUCTS: 'product', REGION: 'region', REGIONS: 'region', GEOGRAPHY: 'region' })
    expect(SEG_PERIOD_ARG_WORDS).toEqual({ ANNUAL: 'annual', YEARLY: 'annual', QUARTERLY: 'quarter', QTRLY: 'quarter' })
    expect(parseSegView(' region ')).toBe('region')
    expect(parseSegView('GEO')).toBeNull()                     // GEO is a stock
    expect(parseSegPeriod('qtrly')).toBe('quarter')
    expect(parseSegPeriod('QUARTER')).toBeNull()               // PCHG's word for its quarter-to-date range
    expect([normSegView('x'), normSegPeriod('x')]).toEqual(['product', 'annual'])
    expect(segCommandArgs({ view: 'product', period: 'annual' })).toEqual([])
    expect(segCommandArgs({ view: 'region', period: 'quarter' })).toEqual(['REGION', 'QUARTERLY'])
    expect(segUrl('BRK.B', 'quarter')).toBe('/api/research/revenue-segments/BRK.B?period=quarter')
    expect(segUrl('QQZA', 'nonsense')).toBe('/api/research/revenue-segments/QQZA?period=annual')
    expect(segPollMs({ status: 'computing' })).toBe(SEG_COMPUTING_POLL_MS)
    expect(segPollMs({ status: 'ok' })).toBe(SEG_HELD_POLL_MS)
  })
})

describe('reading the answer', () => {
  it('not an answer, computing and the server\'s failed read are each their own state', () => {
    for (const body of [null, [], 'x', { status: 'ok' }, { status: 'ok', product: LEG }]) expect(segRead(body).state, JSON.stringify(body)).toBe('failed')
    expect(segRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(segRead({ status: 'failed', reason: 'source' })).toEqual({ state: 'unavailable', reason: 'source' })
  })

  it('each leg keeps its own state; periods newest first; an unknown state is failed', () => {
    const v = segRead(BODY({ region: { state: 'weird' } }))
    expect(v.state).toBe('ok')
    expect(v.legs.product.periods.map((p) => p.date)).toEqual(['2030-09-28', '2029-09-29'])
    expect(v.legs.region.state).toBe('failed')
    expect(segRead(BODY()).legs.region).toMatchObject({ state: 'not_in_plan', httpStatus: 403 })
  })

  it('a period without a date or without a segment figure is dropped and counted; an ok leg with none left is none', () => {
    const v = segRead(BODY({ product: { state: 'ok', dropped: 1, periods: [period('soon', 'X', [seg('A', 1, 100)]), period('2030-09-28', 'FY2030', [seg('A', null, null)])] } }))
    expect(v.legs.product.state).toBe('none')
    expect(v.legs.product.dropped).toBe(3)
  })
})

describe('the tables', () => {
  it('the newest period ranked, and up to four periods side by side with each segment in every column', () => {
    const t = legTables(segRead(BODY()).legs.product)
    expect(t.newest.label).toBe('FY2030')
    expect(t.ranked.map((s) => s.name)).toEqual(['Kettles', 'Lanterns', 'Ropes'])
    expect(t.columns.map((p) => p.label)).toEqual(['FY2030', 'FY2029'])
    expect(t.grid.map((r) => [r.name, r.cells.map((c) => (c ? c.revenue : null))])).toEqual([
      ['Kettles', [6e8, 5e8]], ['Lanterns', [3e8, 2.5e8]], ['Ropes', [1e8, null]],
    ])
    expect(SEG_COLUMNS).toBe(4)
    const many = { ...LEG, periods: Array.from({ length: 6 }, (_, i) => period(`20${30 - i}-09-28`, `FY20${30 - i}`, [seg('Kettles', 10, 100)])) }
    expect(legTables(segRead(BODY({ product: many })).legs.product).columns).toHaveLength(4)
    expect(legTables({ state: 'none', periods: [] })).toBeNull()
  })

  it('the lede names the stock, the split, the period, its end and the total of the segments', () => {
    expect(segLede('QQZA', 'product', segRead(BODY()).legs.product))
      .toBe('QQZA: revenue by product, FY2030 (period ended Sep 28, 2030). 3 segments listed, $1.00B together.')
    expect(periodEndWords({ date: '2030-09-28' })).toBe('Sep 28, 2030')
    expect(periodEndWords({ date: null })).toBe('')
  })
})

describe('words', () => {
  it('money in the period\'s currency, bare when it is not given; a missing figure is never 0', () => {
    expect(moneyWords(1.2e9, 'USD')).toBe('$1.20B')
    expect(moneyWords(9.5e8, 'EUR')).toBe('EUR 950.0M')
    expect(moneyWords(4.5e7, null)).toBe('45.0M')
    expect(moneyWords(null, 'USD')).toBe('Not reported')
    expect(shareWords(60)).toBe('60.0%')
    expect(shareWords(null)).toBe('No share')
    expect(currencyNote({ currency: null })).toBe('Currency not reported.')
    expect(currencyNote({ currency: 'USD' })).toBeNull()
  })

  it('each leg state says what it is; only a failed read offers Retry', () => {
    const say = (state) => legStateWords({ state }, 'region', 'QQZA')
    expect(say('none')).toMatchObject({ kind: 'empty', retry: false, title: 'Financial Modeling Prep holds no revenue split by region for QQZA.' })
    expect(say('not_in_plan')).toMatchObject({ kind: 'locked', retry: false, title: 'Revenue by region is not available from our data provider.' })
    expect(say('not_in_plan').body).toContain('That is an answer about the source, not a failed read.')
    expect(say('not_configured')).toMatchObject({ kind: 'locked', retry: false })
    expect(say('rate_limited')).toMatchObject({ kind: 'error', retry: true })
    expect(say('failed')).toMatchObject({ kind: 'error', retry: true, title: 'Revenue by region could not be read from Financial Modeling Prep just now.' })
  })

  it('a cut list and dropped rows in words', () => {
    expect(legNoteWords({ cut: true, dropped: 2, periods: [{ cut: true }] }))
      .toBe('More periods are held than the panel draws; the oldest are left out. A period lists more segments than the panel draws; the smallest are left out. 2 rows in the answer had no date or no segment figure and are not shown.')
    expect(legNoteWords({ cut: false, dropped: 0, periods: [] })).toBe('')
  })
})
