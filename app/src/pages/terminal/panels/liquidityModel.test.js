// LIQ's pure half. Rails:
//   * net liquidity = the Fed's assets - the H.4.1 TGA - reverse repo, each in dollars by its own scale,
//     on each H.4.1 Wednesday; reverse repo from that Wednesday, else the nearest earlier print within
//     three days (and it says so), else no value; any input missing is a gap, never 0;
//   * the changes are measured to the Wednesday exactly that many weeks earlier, and a gap there is words;
//   * the sentence reads the direction from the numbers; the parts' changes are in their own units;
//   * the reads' URLs, the failure words, the credit lines.
// Every value is invented (__fixtures__/liquidityFixture.js).
import { describe, it, expect } from 'vitest'
import {
  CHANGE_WEEKS, LIQ_CODE, LIQ_LATEST_URL, LINE_SYMBOLS, NET_LABEL, PARTS, SHORT_SYMBOLS, addDays, directionSentence,
  headlineRow, historyStart, historyUrls, latestBySymbol, lineReadState, liqFailure, liquidityRead, mergePoints,
  netChanges, netLiquidityLine, netPicture, partChangeText, partRow, scaleOf, shortStart, signedUsd, usdText,
  valueOnOrBefore, wantedHistory,
} from './liquidityModel'
import { pointsOf } from './economyModel'
import { spreadGeometry } from './ratesModel'
import { LIQ_TODAY, NEWEST_WED, liqLatest, liqMeta, liqPoints, liqSeries } from './__fixtures__/liquidityFixture'

const pts = (raw) => pointsOf(raw)
const M = (fmt, scale = 1) => ({ units: { display: 'USD', fmt, scale } })
/** The three inputs of the line from the fixture (everything held), optionally edited. */
function inputs(edit = {}) {
  const all = liqPoints()
  for (const [s, fn] of Object.entries(edit)) all[s] = fn(all[s])
  return {
    assets: { points: mergePoints(pts(all.USFEDBAL)), meta: liqMeta('USFEDBAL') },
    tga: { points: mergePoints(pts(all.USTGAFED)), meta: liqMeta('USTGAFED') },
    rrp: { points: mergePoints(pts(all.USRRP)), meta: liqMeta('USRRP') },
  }
}
const wedK = (k) => addDays(NEWEST_WED, -7 * k)
const row = (line, k) => line.rows.find((r) => r.date === wedK(k))

describe('the code, the reads', () => {
  it('names the code, asks the latest read for the eight parts, and the history reads for five', () => {
    expect(LIQ_CODE).toBe('LIQ')
    expect(LIQ_LATEST_URL).toBe('/api/econ/latest?symbols=USFEDBAL,USTGAFED,USTGA,USRRP,USRESBAL,USM2,USM2YOY,USSOFR')
    expect(LIQ_LATEST_URL).not.toContain('USNETLIQ')                 // unverified in the registry: never served, never asked
    expect([...LINE_SYMBOLS]).toEqual(['USFEDBAL', 'USTGAFED', 'USRRP'])
    expect([...SHORT_SYMBOLS]).toEqual(['USTGA', 'USSOFR'])
    expect(PARTS.map((p) => p.symbol)).toEqual(['USFEDBAL', 'USTGAFED', 'USTGA', 'USRRP', 'USRESBAL', 'USM2', 'USSOFR'])
  })

  it('the history starts on the first of a month, so a URL stays the same all month: 25 months back for the line, 2 for the daily parts', () => {
    expect(historyStart('2031-03-21')).toBe('2029-02-01')
    expect(historyStart('2031-03-01')).toBe('2029-02-01')
    expect(historyStart('2031-01-15')).toBe('2028-12-01')
    expect(shortStart('2031-03-21')).toBe('2031-01-01')
    expect(shortStart('2031-02-10')).toBe('2030-12-01')
    expect(historyUrls('2031-03-21')).toEqual({
      USFEDBAL: '/api/econ/series/USFEDBAL?start=2029-02-01', USTGAFED: '/api/econ/series/USTGAFED?start=2029-02-01',
      USRRP: '/api/econ/series/USRRP?start=2029-02-01', USTGA: '/api/econ/series/USTGA?start=2031-01-01',
      USSOFR: '/api/econ/series/USSOFR?start=2031-01-01',
    })
    expect(historyUrls('not a day')).toEqual({})
    // two years of Wednesdays and the days before the first fit after the start
    expect(addDays(NEWEST_WED, -7 * 104 - 3) >= historyStart(LIQ_TODAY)).toBe(true)
  })

  it('a history read is wanted only for a series the latest read says is held', () => {
    const latest = liqLatest({ bySymbol: { USRRP: { symbol: 'USRRP', state: 'not_found' }, USSOFR: { symbol: 'USSOFR', state: 'no_data', meta: liqMeta('USSOFR'), points: [] } } })
    expect(wantedHistory(latest)).toEqual({ USFEDBAL: true, USTGAFED: true, USRRP: false, USTGA: true, USSOFR: false })
    expect(wantedHistory(null)).toEqual({ USFEDBAL: false, USTGAFED: false, USRRP: false, USTGA: false, USSOFR: false })
  })
})

describe('dollars', () => {
  it('reads in the econ grammar through the shared formatter, signed for a change', () => {
    expect(usdText(6.03e12)).toBe('$6.03T')
    expect(usdText(412.5e9)).toBe('$412.50B')
    expect(signedUsd(7.5e9)).toBe('+$7.50B')
    expect(signedUsd(-20e9)).toBe('-$20.00B')
    expect(signedUsd(0)).toBe('unchanged')
    expect(signedUsd(null)).toBeNull()
    expect(signedUsd(NaN)).toBeNull()
  })

  it("each series' own scale: the Fed's figures in millions, reverse repo in dollars; 1 when it does not say", () => {
    expect(scaleOf(liqMeta('USFEDBAL'))).toBe(1000000)
    expect(scaleOf(liqMeta('USRRP'))).toBe(1)
    expect(scaleOf(liqMeta('USM2'))).toBe(1000000000)
    expect(scaleOf({ units: { scale: 0 } })).toBe(1)
    expect(scaleOf(null)).toBe(1)
  })
})

describe('the alignment rule: each H.4.1 Wednesday', () => {
  it('the newest Wednesday the Fed holds ends the line; 105 Wednesdays, oldest first', () => {
    const line = netLiquidityLine(inputs())
    expect(line.end).toBe('2031-03-19')
    expect(line.rows).toHaveLength(105)
    expect(line.rows[0].date).toBe('2029-03-21')
    expect(line.rows[104].date).toBe('2031-03-19')
    expect(line.rows.every((r) => new Date(`${r.date}T00:00:00Z`).getUTCDay() === 3)).toBe(true)
  })

  it('assets and TGA from H.4.1 in millions, reverse repo that Wednesday in dollars: 7.000T - 0.820T - 0.150T', () => {
    const r = row(netLiquidityLine(inputs()), 0)
    expect(r).toMatchObject({ assets: 7.0e12, tga: 0.82e12, rrp: 150e9, rrpDay: '2031-03-19', rrpShifted: false, missing: [] })
    expect(r.net).toBeCloseTo(6.03e12, -3)
  })

  it('a Wednesday with no reverse repo print takes the day before, and says so', () => {
    const line = netLiquidityLine(inputs())
    const r = row(line, 20)                                       // the fixture has no print on that Wednesday
    expect(r.rrpDay).toBe(addDays(wedK(20), -1))
    expect(r.rrpShifted).toBe(true)
    expect(r.rrp).toBe(150e9 + 5e9 * 20 + 1e9)                    // Tuesday's print, not Wednesday's formula
    expect(r.net).not.toBeNull()
    expect(line.shifted).toBe(1)
  })

  it('Wednesday and Tuesday missing: Monday (within three days); nothing within three days: a gap', () => {
    const dropRrp = (days) => ({ USRRP: (p) => p.filter((x) => !days.includes(x[3])) })
    const two = row(netLiquidityLine(inputs(dropRrp([wedK(0), addDays(wedK(0), -1)]))), 0)
    expect([two.rrpDay, two.rrpShifted]).toEqual([addDays(wedK(0), -2), true])
    const r40 = row(netLiquidityLine(inputs()), 40)               // the fixture holds nothing Mon to Wed that week
    expect(r40).toMatchObject({ net: null, rrp: null, rrpDay: null, missing: ['reverse repo'] })
    // a print four days back (the Friday before) is too far: the rule never reaches it
    expect(valueOnOrBefore(new Map([[addDays(wedK(40), -5), 1]]), wedK(40), 3)).toBeNull()
    expect(valueOnOrBefore(new Map([[addDays(wedK(40), -3), 1]]), wedK(40), 3)).toEqual({ v: 1, day: addDays(wedK(40), -3), shifted: true })
  })

  it('any input missing is a gap, never 0: a TGA "no figure", a week the Fed does not hold, reverse repo out of reach', () => {
    const line = netLiquidityLine(inputs())
    expect(row(line, 30)).toMatchObject({ net: null, tga: null, missing: ['the TGA (H.4.1)'] })
    expect(row(line, 60)).toMatchObject({ net: null, assets: null, missing: ["the Fed's total assets"] })
    expect(line.gaps).toBe(3)                                     // k = 30, 40, 60
    expect(line.rows.filter((r) => r.net === 0)).toEqual([])
    expect(line.rows.filter((r) => r.net == null).map((r) => r.date)).toEqual([wedK(60), wedK(40), wedK(30)])
  })

  it('no Wednesday from the Fed: no line', () => {
    expect(netLiquidityLine({ ...inputs(), assets: { points: [], meta: liqMeta('USFEDBAL') } })).toBeNull()
    expect(netLiquidityLine(undefined)).toBeNull()
  })
})

describe('the changes and the sentence', () => {
  it('1, 4, 13 and 52 weeks, each to the Wednesday exactly that many weeks before the headline', () => {
    const line = netLiquidityLine(inputs())
    expect(headlineRow(line).date).toBe('2031-03-19')
    expect([...CHANGE_WEEKS]).toEqual([1, 4, 13, 52])
    const ch = netChanges(line, { today: LIQ_TODAY })
    expect(ch.map((c) => [c.weeks, c.from, c.text])).toEqual([
      [1, '2031-03-12', '+$7.50B'], [4, '2031-02-19', '+$30.00B'], [13, '2030-12-18', '+$39.00B'], [52, '2030-03-20', '+$78.00B'],
    ])
  })

  it('a change whose earlier Wednesday has no value is words, never 0', () => {
    const line = netLiquidityLine(inputs({ USTGAFED: (p) => p.map((x) => (x[3] === wedK(13) ? [x[0], null, x[2], x[3], x[4]] : x)) }))
    const c13 = netChanges(line, { today: LIQ_TODAY }).find((c) => c.weeks === 13)
    expect(c13).toMatchObject({ value: null, text: 'n/a', why: 'No value for Wed Dec 18, 2030: the TGA (H.4.1) not held.' })
    expect(netChanges(null)[0]).toMatchObject({ value: null, text: 'n/a' })
  })

  it('the newest Wednesday without a value: the headline is the newest one with a value, and changes are measured from it', () => {
    const drop = [0, 1, 2].map((n) => addDays(wedK(0), -n))
    const line = netLiquidityLine(inputs({ USRRP: (p) => p.filter((x) => !drop.includes(x[3])) }))
    expect(line.end).toBe('2031-03-19')
    expect(headlineRow(line).date).toBe('2031-03-12')
    expect(netChanges(line).find((c) => c.weeks === 4)).toMatchObject({ from: '2031-02-12', text: '+$23.50B' })
  })

  it('the sentence reads the direction from the numbers, with its two dates', () => {
    expect(directionSentence(netLiquidityLine(inputs()), LIQ_TODAY)).toBe(
      "Net liquidity rose $30.00B over 4 weeks (Feb 19 to Mar 19): the Fed's assets fell $20.00B, the TGA fell $30.00B and reverse repo fell $20.00B.")
    const flat = inputs({
      USFEDBAL: (p) => p.map((x) => [x[0], 7000000, x[2], x[3], x[4]]),
      USTGAFED: (p) => p.map((x) => [x[0], 800000, x[2], x[3], x[4]]),
    })
    expect(directionSentence(netLiquidityLine(flat), LIQ_TODAY)).toBe(
      "Net liquidity rose $20.00B over 4 weeks (Feb 19 to Mar 19): the Fed's assets were unchanged, the TGA was unchanged and reverse repo fell $20.00B.")
    // no sentence when the 4-week change cannot be worked out
    const gap = inputs({ USTGAFED: (p) => p.map((x) => (x[3] === wedK(4) ? [x[0], null, x[2], x[3], x[4]] : x)) })
    expect(directionSentence(netLiquidityLine(gap), LIQ_TODAY)).toBeNull()
    expect(directionSentence(null, LIQ_TODAY)).toBeNull()
  })

  it('the picture: the line through its own range (not from zero), the gaps broken, the numbers in words', () => {
    const pic = netPicture(netLiquidityLine(inputs()), LIQ_TODAY)
    expect(pic.min).toBeCloseTo(5.9e12, -3)
    expect(pic.max).toBeCloseTo(6.03e12, -3)
    expect(pic.zeroY).toBeNull()
    expect((pic.path.match(/M/g) || []).length).toBe(4)          // three gaps break one line into four pieces
    expect(pic.words).toBe('Net liquidity, weekly, Mar 21, 2029 to Mar 19: low $5.90T on Mar 21, 2029, high $6.03T on Mar 19, '
      + 'now $6.03T. 3 of 105 Wednesdays have no value, and the line breaks there.')
    expect([pic.fromText, pic.toText]).toEqual(['Mar 21, 2029', 'Mar 19'])
  })

  it("RATES' spread picture is unchanged by default: zero stays in the range", () => {
    const h = { dates: ['2031-01-01', '2031-01-02', '2031-01-03'], s: [1.2, 1.5, 1.4] }
    const withZero = spreadGeometry(h, 's')
    expect([withZero.min, withZero.max, withZero.zeroY]).toEqual([0, 1.5, 112])
    const own = spreadGeometry(h, 's', { withZero: false })
    expect([own.min, own.max, own.zeroY]).toEqual([1.2, 1.5, null])
  })
})

describe('the parts', () => {
  const by = latestBySymbol(liqLatest())
  const merged = (s) => mergePoints(pts(liqSeries(s, '2029-02-01').points), by[s].points)

  it('a weekly part: its Wednesday, and the change from the Wednesday before, in dollars', () => {
    const r = partRow(PARTS[0], by.USFEDBAL, merged('USFEDBAL'), { today: LIQ_TODAY })
    expect(r).toMatchObject({ state: 'ok', chartHref: '/charts?sym=ECON%3AUSFEDBAL' })
    expect(r.latest).toMatchObject({ text: '$7.00T', when: 'Wed Mar 19' })
    expect(r.change).toEqual({ text: '-$5.00B', over: '1 week', since: 'Mar 12' })
  })

  it('a daily part: the print on or before the day a week earlier (a holiday reaches back three days at most)', () => {
    const r = partRow(PARTS[3], by.USRRP, merged('USRRP'), { today: LIQ_TODAY })
    expect(r.latest).toMatchObject({ text: '$151.00B', when: 'Thu Mar 20' })
    expect(r.change).toEqual({ text: '-$5.00B', over: '1 week', since: 'Mar 13' })
    const holiday = merged('USRRP').filter((p) => p.pe !== '2031-03-13')
    expect(partRow(PARTS[3], by.USRRP, holiday, { today: LIQ_TODAY }).change.since).toBe('Mar 12')
    // only the latest read's three points: no print a week before is held, and it says so
    expect(partRow(PARTS[3], by.USRRP, by.USRRP.points, { today: LIQ_TODAY }).change)
      .toEqual({ text: null, over: '1 week', why: 'No print 1 week earlier is held here.' })
    expect(partRow(PARTS[3], by.USRRP, by.USRRP.points, { today: LIQ_TODAY, historyFailed: true }).change.why)
      .toBe('The history for this change could not be read just now.')
  })

  it('a rate changes in basis points; M2 by the month, in dollars, with its year-over-year beside it', () => {
    const sofr = partRow(PARTS[6], by.USSOFR, merged('USSOFR'), { today: LIQ_TODAY })
    expect([sofr.latest.text, sofr.change.text]).toEqual(['4.30%', '-2 bp'])
    const m2 = partRow(PARTS[5], by.USM2, by.USM2.points, { today: LIQ_TODAY, alt: by.USM2YOY, altPoints: by.USM2YOY.points })
    expect(m2.latest).toMatchObject({ text: '$22.41T', when: 'Jan 2031' })
    expect(m2.change).toEqual({ text: '+$59.50B', over: '1 month', since: 'Dec 2030' })
    expect(m2.alt).toMatchObject({ label: 'y/y', text: '4.1%', period: 'Jan 2031' })
    expect(partChangeText(4.3, 4.3, M('pct2'))).toBe('0 bp')
    expect(partChangeText(5, 5, M('usd_compact', 1e6))).toBe('unchanged')
    expect(partChangeText(null, 5, M('usd_compact'))).toBeNull()
  })

  it('a series not served and one with nothing published are words; the newest period with no figure says so', () => {
    expect(partRow(PARTS[4], { symbol: 'USRESBAL', state: 'not_found' }, [], {}))
      .toMatchObject({ state: 'not_found', words: 'Not among the economic series this server publishes.' })
    expect(partRow(PARTS[4], { ...by.USRESBAL, state: 'no_data' }, [], {}))
      .toMatchObject({ state: 'no_data', words: 'No reading published here yet.' })
    const nul = by.USRESBAL.points.map((p, i, a) => (i === a.length - 1 ? { ...p, v: null } : p))
    const r = partRow(PARTS[4], by.USRESBAL, nul, { today: LIQ_TODAY })
    expect(r.latest).toMatchObject({ value: null, text: null, when: 'Wed Mar 19' })
    expect(r.change).toMatchObject({ text: null, why: 'The newest period has no figure.' })
  })
})

describe('the whole read', () => {
  const histories = Object.fromEntries(Object.entries(historyUrls(LIQ_TODAY)).map(([s, u]) => [s, pts(liqSeries(s, u.split('start=')[1]).points)]))

  it('every part, the line, and each source\'s credit line once in the order shown', () => {
    const v = liquidityRead({ latest: liqLatest(), histories, today: LIQ_TODAY })
    expect(v.state).toBe('ok')
    expect(v.parts.map((p) => [p.key, p.state])).toEqual([['assets', 'ok'], ['tga_weekly', 'ok'], ['tga_daily', 'ok'], ['rrp', 'ok'],
      ['reserves', 'ok'], ['m2', 'ok'], ['sofr', 'ok']])
    expect(v.net.state).toBe('ok')
    expect(usdText(v.net.head.net)).toBe('$6.03T')
    expect(v.net.next).toMatchObject({ state: 'ok', text: 'Mar 27, 4:30 PM ET' })
    expect(v.credits.map((c) => c.key)).toEqual(['fed_board', 'fiscaldata', 'nyfed'])
    expect(v.credits[2].text).toBe('The ON RRP Facility Take-up and Secured Overnight Financing Rate is invented for UCT Intelligence.')
    expect(v.newestT).toBe(Date.parse('2031-03-21T13:00:00Z') / 1000)
    expect(NET_LABEL).toBe("UCT calculation from the Fed's and Treasury's own figures")
  })

  it('an input the latest read does not hold: net liquidity is not worked out, and says which', () => {
    const latest = liqLatest({ bySymbol: { USTGAFED: { symbol: 'USTGAFED', state: 'not_found' } } })
    const v = liquidityRead({ latest, histories, today: LIQ_TODAY })
    expect(v.net).toMatchObject({ state: 'not_held', missing: ['the TGA (H.4.1)'] })
    expect(v.net.line).toBeUndefined()
  })

  it('the line\'s reads loading or failed are their own states; a body that is not the route\'s shape is a failed read', () => {
    expect(liquidityRead({ latest: liqLatest(), lineState: 'loading' }).net.state).toBe('loading')
    expect(liquidityRead({ latest: liqLatest(), lineState: 'failed' }).net.state).toBe('failed')
    for (const b of [null, { items: [] }, { series: 'x' }, []]) expect(liquidityRead({ latest: b }).state).toBe('bad_shape')
  })

  it('the line\'s read state: loading, a 404 is the series not held, any other failure is failed', () => {
    const r = (o) => ({ wanted: true, body: null, error: null, loading: false, ...o })
    expect(lineReadState([r({ body: {} }), r({ body: {} }), r({ body: {} })])).toBe('ok')
    expect(lineReadState([r({ body: {} }), r({ loading: true }), r({ body: {} })])).toBe('loading')
    expect(lineReadState([r({ body: {} }), r({ error: { status: 500 } }), r({ loading: true })])).toBe('failed')
    expect(lineReadState([r({ error: { status: 404 } }), r({ body: {} }), r({ body: {} })])).toBe('not_held')
    expect(lineReadState([r({ wanted: false, loading: true }), r({ body: {} }), r({ body: {} })])).toBe('ok')
    // a later poll that failed while the last answer is kept still draws the last answer
    expect(lineReadState([r({ body: {}, error: { status: 500 } }), r({ body: {} }), r({ body: {} })])).toBe('ok')
  })

  it('a failed latest read in words: the ECON board\'s, with this panel\'s own hint when the feature is off', () => {
    expect(liqFailure({ status: 404 })).toMatchObject({ kind: 'locked', state: 'off', title: 'The economic data is switched off for this server.', retry: false })
    expect(liqFailure({ status: 404 }).hint).toContain("The Fed's balance sheet, the Treasury's cash account and the reverse repo figures")
    expect(liqFailure({ status: 403 })).toMatchObject({ kind: 'locked', state: 'plan', retry: false })
    expect(liqFailure({ status: 401 })).toMatchObject({ kind: 'error', state: 'signed_out', retry: true })
    expect(liqFailure({ status: 500 })).toMatchObject({ kind: 'error', state: 'error', retry: true })
  })
})
