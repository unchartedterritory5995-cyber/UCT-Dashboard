// COT by trader type, the model: the routes' answers (GET /api/cot/{code}/breakdown, GET /api/cot/breakdown) ->
// the "By trader type" table and the board's funds column. Rails:
//   * each class's net is long minus short, its week's change is against the week before, its share of open
//     interest is net over open interest, and its 3-year range is cotRead's own `cotIndex` over the class's last
//     156 weeks, shown only with 156 (the legacy table's rule); a side the CFTC printed none for is null, never 0;
//   * the watched class is the one the route names; spreading and trader counts are carried as sent;
//   * every route state (ok, no_record, not_built, unavailable) and any other shape (failed);
//   * the board cell is the watched class's net and week's change, null with no earlier week;
//   * the words: the credit line word for word, the records and concentration sentences.
// Every number, name and date is invented; the fixtures are the routes' real shapes.
import { describe, it, expect } from 'vitest'
import { cotIndex } from '../../cot/cotRead'
import {
  COT_FINER_CREDIT, COT_FINER_URL, COT_RANGE_WEEKS, FINER_CLASS_WORDS, concentrationText, cotFinerBoard, cotFinerRead, cotFinerUrl,
  finerClassLabel, finerRangeWhy, recordsText, sideText,
} from './cotModel'

const tue = (back) => new Date(Date.UTC(2026, 10, 17) - back * 7 * 86400000).toISOString().slice(0, 10)
const KEYS = ['dealer', 'asset_manager', 'leveraged_funds', 'other_reportable', 'nonreportable']
const CLASSES = KEYS.map((key) => ({ key, cftc: key, spread: key !== 'nonreportable', traders: key !== 'nonreportable' }))
/** `n` weeks oldest first; leveraged funds net 180,000 now (+80,000 on the week, 80 of 100), dealers -200,000 (50 of 100). */
function tffBody(n = 160, extra = {}) {
  const rows = Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i
    const lev = back === 0 ? [300000, 120000] : back % 2 ? [200000, 100000] : [260000, 60000]
    const dealer = back === 0 ? [50000, 250000] : back % 2 ? [60000, 210000] : [40000, 290000]
    return {
      date: tue(back), open_interest: back === 0 ? 520000 : 500000, traders_total: 300,
      classes: {
        dealer: { long: dealer[0], short: dealer[1], spread: 10000, traders_long: 20, traders_short: 25, traders_spread: 9 },
        asset_manager: { long: 400000, short: 90000, spread: 15000, traders_long: 70, traders_short: 30, traders_spread: 12 },
        leveraged_funds: { long: lev[0], short: lev[1], spread: 23456, traders_long: 41, traders_short: 33, traders_spread: 20 },
        other_reportable: { long: 30000, short: 31000, spread: 2000, traders_long: 10, traders_short: 12, traders_spread: 3 },
        nonreportable: { long: 45000, short: 50000, spread: null, traders_long: null, traders_short: null, traders_spread: null },
      },
    }
  })
  return {
    symbol: 'ES', state: 'ok', report: 'tff', report_name: 'Traders in Financial Futures', watch: 'leveraged_funds',
    classes: CLASSES, rows, records: [{ cftc_code: 'INV001', market_name: 'INVENTED INDEX - INVENTED EXCHANGE', match: 'code', first: rows[0].date, last: tue(0) }],
    concentration: { date: tue(0), gross_4_long: 21.7, gross_4_short: 18.04, gross_8_long: 33.1, gross_8_short: 29.4 },
    source: 'x', next_check: '2026-11-22T21:10-05:00', building: false, ...extra,
  }
}

describe('cotFinerRead: one market', () => {
  it('each class: long, short, spreading, net, the week\'s change, the share of open interest and the 3-year range', () => {
    const v = cotFinerRead(tffBody())
    expect(v.state).toBe('ok')
    expect([v.report, v.reportName, v.watch, v.date]).toEqual(['tff', 'Traders in Financial Futures', 'leveraged_funds', '2026-11-17'])
    expect(v.classes.map((c) => c.key)).toEqual(KEYS)
    const lev = v.classes[2]
    expect([lev.label, lev.watched, lev.long, lev.short, lev.spread, lev.net, lev.wow]).toEqual(['Leveraged funds', true, 300000, 120000, 23456, 180000, 80000])
    expect(lev.pctOi).toBeCloseTo((180000 / 520000) * 100, 6)
    expect(lev.range).toBe(80)
    expect(lev.traders).toEqual({ long: 41, short: 33, spread: 20 })
    const dealer = v.classes[0]
    expect([dealer.net, dealer.wow, dealer.range, dealer.watched]).toEqual([-200000, -50000, 50, false])
    // the range is cotRead's own arithmetic over the class's last 156 weeks, never a second formula
    const nets = tffBody().rows.map((r) => r.classes.leveraged_funds.long - r.classes.leveraged_funds.short)
    expect(lev.range).toBe(cotIndex(nets.slice(-COT_RANGE_WEEKS)))
    expect(v.oi).toEqual({ value: 520000, wow: 20000 })
    expect(v.classes[4].spread).toBeNull()                         // small traders have no spreading column
  })

  it('the range waits for 156 weeks of the class, and a week with a missing side is left out of it, never read as 0', () => {
    expect(cotFinerRead(tffBody(155)).classes[2].range).toBeNull()
    expect(cotFinerRead(tffBody(155)).classes[2].weeks).toBe(155)
    expect(cotFinerRead(tffBody(156)).classes[2].range).not.toBeNull()
    const holed = tffBody(157)
    holed.rows[50].classes.leveraged_funds.short = null
    const v = cotFinerRead(holed)
    expect([v.classes[2].weeks, v.classes[2].range == null]).toEqual([156, false])
    // the newest week with a side missing: no net, no change, no share, no range
    const blank = tffBody(160)
    blank.rows[159].classes.leveraged_funds.long = null
    const lev = cotFinerRead(blank).classes[2]
    expect([lev.long, lev.short, lev.net, lev.wow, lev.pctOi, lev.range]).toEqual([null, 120000, null, null, null, null])
  })

  it('one week: no change on the week; rows arrive in any order and are read oldest first', () => {
    const one = cotFinerRead(tffBody(1))
    expect([one.classes[2].net, one.classes[2].wow, one.oi.wow]).toEqual([180000, null, null])
    const shuffled = tffBody(3)
    shuffled.rows.reverse()
    expect(cotFinerRead(shuffled).classes[2].wow).toBe(80000)
  })

  it('every route state, and anything else is a failed read', () => {
    for (const state of ['not_built', 'no_record', 'unavailable']) expect(cotFinerRead({ state }).state).toBe(state)
    for (const body of [null, [], 'x', { status: 'ok' }, { state: 'computing' }]) expect(cotFinerRead(body).state).toBe('failed')
    expect(cotFinerRead({ ...tffBody(), rows: [] }).state).toBe('no_record')
    expect(cotFinerRead({ ...tffBody(), classes: [] }).state).toBe('no_record')
    expect(cotFinerRead({ ...tffBody(), rows: [{ date: 'yesterday', classes: {} }] }).state).toBe('no_record')
  })

  it('the Disaggregated report: its own classes, managed money watched', () => {
    const body = tffBody(2, { report: 'disaggregated', report_name: 'Disaggregated', watch: 'managed_money',
      classes: ['producer_merchant', 'swap_dealer', 'managed_money', 'other_reportable', 'nonreportable'].map((key) => ({ key })) })
    body.rows = body.rows.map((r) => ({ ...r, classes: { managed_money: { long: 9000, short: 1000 }, producer_merchant: { long: 1, short: 5 } } }))
    const v = cotFinerRead(body)
    expect(v.classes.map((c) => c.label)).toEqual(['Producers and merchants', 'Swap dealers', 'Managed money', 'Other reportables', 'Small traders'])
    expect(v.classes.filter((c) => c.watched).map((c) => c.key)).toEqual(['managed_money'])
    expect([v.classes[2].net, v.classes[1].net, v.classes[1].long]).toEqual([8000, null, null])   // a class absent that week is null
  })
})

describe('cotFinerBoard: the funds column', () => {
  it('the watched class\'s net and its change on the week, null with no earlier week; a market with no figure is left out', () => {
    const body = {
      state: 'ok', watch: { tff: 'leveraged_funds', disaggregated: 'managed_money' },
      markets: {
        ES: { report: 'tff', watch: 'leveraged_funds', date: '2026-11-17', open_interest: 1, long: 300000, short: 120000, spread: 5, previous: { date: '2026-11-10', long: 200000, short: 100000 } },
        GC: { report: 'disaggregated', watch: 'managed_money', date: '2026-11-10', long: 9000, short: 1000, previous: null },
        CL: { report: 'disaggregated', watch: 'managed_money', date: '2026-11-17', long: null, short: 1000, previous: null },
        XX: { date: 'never' },
      },
      no_record: ['ZZ'],
    }
    const b = cotFinerBoard(body)
    expect(b.state).toBe('ok')
    expect(Object.keys(b.cells)).toEqual(['ES', 'GC'])
    expect(b.cells.ES).toEqual({ watch: 'leveraged_funds', label: 'Leveraged funds', report: 'tff', date: '2026-11-17', net: 180000, wow: 80000 })
    expect([b.cells.GC.label, b.cells.GC.net, b.cells.GC.wow]).toEqual(['Managed money', 8000, null])
  })

  it('every route state, and anything else is a failed read', () => {
    expect(cotFinerBoard({ state: 'not_built' })).toEqual({ state: 'not_built', cells: {} })
    expect(cotFinerBoard({ state: 'unavailable' })).toEqual({ state: 'unavailable', cells: {} })
    for (const body of [null, [], { state: 'ok' }, { state: 'no_record' }]) expect(cotFinerBoard(body).state).toBe('failed')
  })
})

describe('the words', () => {
  it('the routes, the credit line and the class names', () => {
    expect(COT_FINER_URL).toBe('/api/cot/breakdown')
    expect(cotFinerUrl('gc')).toBe('/api/cot/GC/breakdown?weeks=160')
    expect(COT_FINER_CREDIT).toBe('Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, published the following Friday.')
    expect(Object.keys(FINER_CLASS_WORDS)).toHaveLength(8)
    expect(finerClassLabel('managed_money')).toBe('Managed money')
    expect(finerClassLabel('some_new_class')).toBe('Some new class')
    expect(finerClassLabel(null)).toBe('')
    expect(finerRangeWhy(1)).toBe('The 3-year range needs 156 weekly reports of this class; 1 is stored.')
    expect(sideText(212400, 'long')).toBe('212.4K long')
    expect(sideText(null, 'short')).toBe('n/a short')
  })

  it('the concentration sentence says only what the route sent', () => {
    const v = cotFinerRead(tffBody())
    expect(concentrationText(v.concentration)).toBe('The largest 4 traders hold 21.7% of the long side and 18.0% of the short side; '
      + 'the largest 8 hold 33.1% of the long side and 29.4% of the short side (gross positions).')
    expect(concentrationText({ gross4: { long: 10, short: null }, gross8: { long: 30, short: 40 } }))
      .toBe('The largest 8 hold 30.0% of the long side and 40.0% of the short side (gross positions).')
    expect(concentrationText({ gross4: { long: null, short: null }, gross8: { long: null, short: null } })).toBe('')
    expect(concentrationText(null)).toBe('')
  })

  it('one record is named; joined records each say their span', () => {
    expect(recordsText([{ name: 'INVENTED - EXCHANGE', code: 'INV001', first: '2026-01-06', last: '2026-11-17' }]))
      .toBe('CFTC record: INVENTED - EXCHANGE, contract INV001.')
    expect(recordsText([{ name: 'OLD NAME', code: 'INV001', first: '2026-11-03', last: '2026-11-03' }, { name: 'NEW NAME', code: null, first: '2026-11-10', last: '2026-11-17' }]))
      .toBe('These weeks join 2 CFTC records: OLD NAME, contract INV001 (Tue Nov 3, 2026 to Tue Nov 3, 2026); NEW NAME (Tue Nov 10, 2026 to Tue Nov 17, 2026).')
    expect(recordsText([])).toBe('')
  })
})
