// OIL's pure half. Every value is invented (__fixtures__/oilFixture.js, in the routes' real shapes).
import { describe, it, expect } from 'vitest'
import {
  LINE_SYMBOL, LINE_WEEKS, OIL_CODE, OIL_GROUPS, OIL_LATEST_URL, OIL_SYMBOLS, YEAR_DAYS, addDays, buildDrawWord,
  historyPoints, historyStateOf, historyUrls, latestBySymbol, lineGeometry, lineWords, mergePoints, millionBarrels,
  monthStartBefore, nextSentence, oilChangeText, oilFailure, oilRead, oilRow, oilValueText, pointNear, reportHead,
  signedBarrels, stocksLine, stocksPicture, wantedHistory, weekBeforeOf, yearAgoOf,
} from './oilModel'
import { CRUDE_GAP, FIXTURE_SYMBOLS, OIL_TODAY, oilHistory, oilLatest } from './__fixtures__/oilFixture'

const allHistory = () => Object.fromEntries(OIL_SYMBOLS.map((s) => [s, historyPoints(oilHistory(s), s)]))
const allOk = () => Object.fromEntries(OIL_SYMBOLS.map((s) => [s, 'ok']))
const view = ({ latest = oilLatest(), histories = allHistory(), historyState = allOk() } = {}) =>
  oilRead({ latest, histories, historyState, today: OIL_TODAY })
const rowOf = (v, key) => v.groups.flatMap((g) => g.rows).find((r) => r.key === key)
const MBBL = { units: { display: 'bbl', fmt: 'mbbl', scale: 1000 } }
const BPD = { units: { display: 'bbl/d', fmt: 'num0', scale: 1000 } }
const PCT1 = { units: { display: '%', fmt: 'pct1', scale: 1 } }
const GAL = { units: { display: 'USD/gal', fmt: 'usd3', scale: 1 } }

describe('what it asks for', () => {
  it('nine enabled EIA series in one latest read, grouped in reading order; natural gas storage (unverified) is not asked for', () => {
    expect(OIL_CODE).toBe('OIL')
    expect(OIL_SYMBOLS).toEqual(['USCRUDEINV', 'USCRUDEINVCHG', 'USGASINV', 'USDISTINV', 'USSPR', 'USCRUDEPROD', 'USREFUTIL', 'USGASPRICE', 'USDIESELPRICE'])
    expect(OIL_LATEST_URL).toBe(`/api/econ/latest?symbols=${OIL_SYMBOLS.join(',')}`)
    expect(OIL_SYMBOLS.join()).not.toMatch(/NATGAS/)
    expect(OIL_GROUPS.map((g) => g.title)).toEqual(['Inventories', 'Production and refining', 'Pump prices (U.S. average)'])
    expect(OIL_GROUPS.flatMap((g) => g.rows.map((r) => r.symbol))).toEqual(OIL_SYMBOLS)
    expect(FIXTURE_SYMBOLS).toEqual(OIL_SYMBOLS)
    expect(LINE_SYMBOL).toBe('USCRUDEINV')
  })

  it('history reads start on a month\'s first day (one URL all month): crude 25 months back for the line, the rest 14', () => {
    const urls = historyUrls(OIL_TODAY)
    expect(urls.USCRUDEINV).toBe('/api/econ/series/USCRUDEINV?start=2029-02-01')
    expect(urls.USGASPRICE).toBe('/api/econ/series/USGASPRICE?start=2030-01-01')
    expect(Object.keys(urls)).toEqual(OIL_SYMBOLS)
    expect(historyUrls('2031-03-01')).toEqual(urls)
    expect(monthStartBefore('2031-01-15', 14)).toBe('2029-11-01')
    expect(historyUrls(null)).toEqual({})
  })

  it('a history is wanted only for a series the latest read says is held', () => {
    const latest = oilLatest({ bySymbol: { USSPR: { symbol: 'USSPR', state: 'not_found' }, USGASINV: { ...oilLatest().series[2], state: 'no_data', points: [] } } })
    const want = wantedHistory(latest)
    expect(want.USSPR).toBe(false)
    expect(want.USGASINV).toBe(false)
    expect(want.USCRUDEINV).toBe(true)
    expect(Object.values(wantedHistory(null)).every((w) => w === false)).toBe(true)
  })
})

describe('units: each series in its own, through the shared formatters', () => {
  it('a value: barrels from thousands, barrels a day, percent, dollars a gallon; no figure is null', () => {
    expect(oilValueText(431240, MBBL)).toBe('431.2M bbl')
    expect(oilValueText(13812, BPD)).toBe('13.81M bbl/d')                       // the barrels' K/M ladder: fits a phone's column
    expect(oilValueText(812, BPD)).toBe('812K bbl/d')
    expect(oilValueText(null, BPD)).toBeNull()
    expect(oilValueText(88.4, PCT1)).toBe('88.4%')
    expect(oilValueText(3.284, GAL)).toBe('$3.284/gal')
    expect(oilValueText(null, MBBL)).toBeNull()
    expect(oilValueText(Number.NaN, GAL)).toBeNull()
  })

  it('barrels as a signed change and as million barrels; a small change never reads 0.0', () => {
    expect(signedBarrels(-2322000)).toBe('-2.3M bbl')
    expect(signedBarrels(435000)).toBe('+435K bbl')
    expect(signedBarrels(999600)).toBe('+1.0M bbl')
    expect(signedBarrels(0)).toBe('unchanged')
    expect(signedBarrels(null)).toBeNull()
    expect(millionBarrels(-2322000)).toBe('2.3 million barrels')
    expect(millionBarrels(450000)).toBe('0.5 million barrels')
    expect(millionBarrels(40000)).toBe('0.04 million barrels')
    expect(millionBarrels(undefined)).toBeNull()
    expect([buildDrawWord(5), buildDrawWord(-5), buildDrawWord(0), buildDrawWord(null)]).toEqual(['build', 'draw', 'no change', null])
  })

  it('a change in the series\' own units; without two real figures there is none', () => {
    expect(oilChangeText(431240, 433562, MBBL)).toBe('-2.3M bbl')
    expect(oilChangeText(13812, 13795, BPD)).toBe('+17K bbl/d')
    expect(oilChangeText(88.4, 87.6, PCT1)).toBe('+0.8 pts')
    expect(oilChangeText(3.284, 3.312, GAL)).toBe('-$0.028/gal')
    expect(oilChangeText(3.3, 3.3, GAL)).toBe('unchanged')
    expect(oilChangeText(3.2840000000001, 3.284, GAL)).toBe('unchanged')       // a float's dust is not a change
    expect(oilChangeText(null, 3.3, GAL)).toBeNull()
    expect(oilChangeText(3.3, undefined, GAL)).toBeNull()
  })
})

describe('a row: the latest week, the week before and the change, the same week a year ago, the date', () => {
  it('every row from the invented report', () => {
    const v = view()
    const crude = rowOf(v, 'crude')
    expect(crude).toMatchObject({ state: 'ok', label: 'Crude oil, excluding the SPR', symbol: 'USCRUDEINV', derived: false, chartHref: '/charts?sym=ECON%3AUSCRUDEINV' })
    expect(crude.latest).toMatchObject({ value: 431240, text: '431.2M bbl', period: 'wk 3/14', released: 'Mar 19', word: null })
    expect(crude.prior).toMatchObject({ value: 433562, text: '433.6M bbl', period: 'wk 3/7' })
    expect(crude.change).toBe('-2.3M bbl')
    expect(crude.yearAgo).toMatchObject({ state: 'ok', value: 436080, text: '436.1M bbl', period: 'wk 3/15, 2030', change: '-4.8M bbl' })
    const table = Object.fromEntries(v.groups.flatMap((g) => g.rows).map((r) => [r.key, [r.latest.text, r.prior?.text, r.change, r.yearAgo.text, r.yearAgo.change ?? null]]))
    expect(table).toEqual({
      crude: ['431.2M bbl', '433.6M bbl', '-2.3M bbl', '436.1M bbl', '-4.8M bbl'],
      crude_change: ['-2.3M bbl', '+2.6M bbl', null, '+5.6M bbl', null],
      gasoline: ['238.4M bbl', '236.9M bbl', '+1.5M bbl', '241.7M bbl', '-3.3M bbl'],
      distillate: ['119.0M bbl', '120.3M bbl', '-1.4M bbl', '122.5M bbl', '-3.5M bbl'],
      spr: ['402.6M bbl', '402.2M bbl', '+435K bbl', '395.9M bbl', '+6.7M bbl'],
      production: ['13.81M bbl/d', '13.79M bbl/d', '+22K bbl/d', '13.52M bbl/d', '+292K bbl/d'],
      refining: ['88.4%', '87.6%', '+0.8 pts', '86.1%', '+2.3 pts'],
      gas_price: ['$3.284/gal', '$3.312/gal', '-$0.028/gal', '$3.517/gal', '-$0.233/gal'],
      diesel_price: ['$3.957/gal', '$3.941/gal', '+$0.016/gal', undefined, null],
    })
    expect(rowOf(v, 'gas_price').latest).toMatchObject({ period: 'wk 3/17', released: 'Mar 18' })
  })

  it('the weekly build or draw is the econ service\'s own UCT calculation: each figure says build or draw, and no change of a change is shown', () => {
    const r = rowOf(view(), 'crude_change')
    expect(r).toMatchObject({ derived: true, buildDraw: true, change: null })
    expect([r.latest.word, r.prior.word, r.yearAgo.word]).toEqual(['draw', 'build', 'build'])
    expect(r.yearAgo.change).toBeNull()
  })

  it('a year ago not held says why: not held, still reading, or a failed read', () => {
    expect(rowOf(view(), 'diesel_price').yearAgo).toEqual({ state: 'not_held', words: 'Not held for a year ago' })
    const h = allHistory()
    for (const [state, words] of [['loading', 'Reading the week a year ago'], ['failed', 'The week a year ago could not be read just now'], ['not_held', 'Not held for a year ago']]) {
      const r = rowOf(view({ histories: { ...h, USGASINV: null }, historyState: { ...allOk(), USGASINV: state } }), 'gasoline')
      expect(r.yearAgo).toEqual({ state, words })
      expect(r.latest.text).toBe('238.4M bbl')                   // the latest read's own weeks still show
      expect(r.change).toBe('+1.5M bbl')
    }
  })
})

describe('the week before and the year ago are found by date, never by position', () => {
  const pts = [
    { t: 1, v: 10, ps: '2030-03-09', pe: '2030-03-15' }, { t: 2, v: 11, ps: '2031-02-22', pe: '2031-02-28' },
    { t: 3, v: 12, ps: '2031-03-08', pe: '2031-03-14' },
  ]
  it('the week before must end 7 days earlier (give or take 3): a missing week is not replaced by an older one', () => {
    expect(weekBeforeOf(pts, pts[2])).toBeNull()                  // the week to Feb 28 is two weeks back
    expect(weekBeforeOf(pts.slice(1), pts[1])).toBeNull()
    expect(weekBeforeOf([pts[1], { ...pts[2], pe: '2031-03-07' }], { pe: '2031-03-07' }).v).toBe(11)
  })

  it('the year ago is the week ending 364 days before, give or take 3 days, the nearest first; its no-figure week is still that week', () => {
    expect(YEAR_DAYS).toBe(364)
    expect(yearAgoOf(pts, pts[2]).v).toBe(10)
    expect(yearAgoOf(pts, { pe: '2031-03-18' })).toBeNull()         // 4 days off
    expect(pointNear([{ pe: '2030-03-13', v: 1 }, { pe: '2030-03-16', v: 2 }], '2030-03-15').v).toBe(2)
    expect(yearAgoOf([{ pe: '2030-03-15', v: null }], { pe: '2031-03-14' })).toEqual({ pe: '2030-03-15', v: null })
    expect(addDays('2031-03-14', -YEAR_DAYS)).toBe('2030-03-15')
  })
})

describe('a missing value is words, never 0', () => {
  it('a week the EIA published no figure for has no value and no change; a series not served and one with nothing published', () => {
    const base = oilLatest()
    const gas = base.series.find((s) => s.symbol === 'USGASINV')
    const pts = gas.points.map((p, i, a) => (i === a.length - 1 ? [p[0], null, p[2], p[3], p[4]] : p))
    const h = allHistory()
    const latest = oilLatest({ bySymbol: { USGASINV: { ...gas, points: pts }, USSPR: { symbol: 'USSPR', state: 'not_found' }, USDISTINV: { ...base.series[3], state: 'no_data', points: [] } } })
    const v = view({ latest, histories: { ...h, USGASINV: h.USGASINV.slice(0, -1), USDISTINV: null, USSPR: null } })
    const r = rowOf(v, 'gasoline')
    expect(r.latest).toMatchObject({ value: null, text: null, period: 'wk 3/14' })
    expect(r.change).toBeNull()
    expect(r.yearAgo.change).toBeNull()
    expect(rowOf(v, 'spr')).toMatchObject({ state: 'not_found', words: 'Not among the economic series this server publishes.' })
    expect(rowOf(v, 'distillate')).toMatchObject({ state: 'no_data', words: 'No reading published here yet.' })
    expect(rowOf(v, 'distillate').next).toMatchObject({ state: 'ok', date: '2031-03-26' })
  })

  it('a row with no spec\'s series in the answer is not held', () => {
    expect(oilRow({ key: 'x', label: 'X', symbol: 'USX' }, undefined, [])).toMatchObject({ state: 'not_found' })
  })
})

describe('the top line: the week\'s build or draw, the week, the release, the next report', () => {
  it('a draw in plain words, the week it covers, when it came out and the next Wednesday report from the calendar', () => {
    const h = view().head
    expect(h).toMatchObject({
      state: 'ok', headline: 'Draw of 2.3 million barrels', word: 'draw', value: -2322, barrels: -2322000,
      week: 'the week to Fri Mar 14', released: 'Wed Mar 19', derived: true,
    })
    expect(nextSentence('EIA weekly petroleum report', h.next)).toBe('Next EIA weekly petroleum report: Wed Mar 26, 10:30 AM ET.')
    expect(nextSentence('EIA pump price survey', h.pumpNext)).toBe('Next EIA pump price survey: Tue Mar 25, ~5:00 PM ET (est.).')
  })

  it('a build, no change, no figure, nothing published and a series not served each read right', () => {
    const latestWith = (v) => {
      const base = oilLatest()
      const ch = base.series.find((s) => s.symbol === 'USCRUDEINVCHG')
      const pts = ch.points.map((p, i, a) => (i === a.length - 1 ? [p[0], v, p[2], p[3], p[4]] : p))
      return latestBySymbol(oilLatest({ bySymbol: { USCRUDEINVCHG: { ...ch, points: pts } } }))
    }
    const head = (by) => reportHead(by, by.USCRUDEINVCHG?.points || [], OIL_TODAY)
    expect(head(latestWith(1048)).headline).toBe('Build of 1.0 million barrels')
    expect(head(latestWith(40)).headline).toBe('Build of 0.04 million barrels')
    expect(head(latestWith(0)).headline).toBe('No change in crude oil stocks')
    expect(head(latestWith(null))).toMatchObject({ state: 'no_figure', words: 'No figure for the week to Fri Mar 14.', released: 'Wed Mar 19' })
    const by = latestBySymbol(oilLatest({ bySymbol: { USCRUDEINVCHG: { symbol: 'USCRUDEINVCHG', state: 'not_found' } } }))
    expect(head(by)).toMatchObject({ state: 'not_found', words: 'The weekly change in crude oil stocks is not among the economic series this server publishes.' })
    expect(head(by).next.state).toBe('ok')                         // the next report still comes from crude stocks' calendar
    const none = latestBySymbol(oilLatest({ bySymbol: { USCRUDEINVCHG: { ...oilLatest().series[1], state: 'no_data', points: [] } } }))
    expect(head(none)).toMatchObject({ state: 'no_data', words: 'No weekly change in crude oil stocks is published here yet.' })
  })

  it('the next report is the calendar\'s date, never today: not held, or passed and not confirmed, is said', () => {
    const strip = (s) => ({ ...s, currentness: { ...s.currentness, next_release: { date: null, time: null, precision: 'unknown' } } })
    const base = oilLatest()
    const by = latestBySymbol(oilLatest({ bySymbol: { USCRUDEINV: strip(base.series[0]), USCRUDEINVCHG: strip(base.series[1]) } }))
    const h = reportHead(by, by.USCRUDEINVCHG.points, OIL_TODAY)
    expect(nextSentence('EIA weekly petroleum report', h.next)).toBe('EIA weekly petroleum report: next release not held.')
    const passed = latestBySymbol(oilLatest({ bySymbol: { USCRUDEINV: { ...base.series[0], currentness: { state: 'DELAYED', next_release: { date: '2031-03-19', time: '10:30', precision: 'exact' } } } } }))
    const hp = reportHead(passed, passed.USCRUDEINVCHG.points, OIL_TODAY)
    expect(nextSentence('EIA weekly petroleum report', hp.next)).toBe('Next EIA weekly petroleum report: Wed Mar 26, 10:30 AM ET.')   // the change series' date is held
    const both = latestBySymbol(oilLatest({ bySymbol: {
      USCRUDEINV: { ...base.series[0], currentness: { state: 'DELAYED', next_release: { date: '2031-03-19', time: '10:30', precision: 'exact' } } },
      USCRUDEINVCHG: strip(base.series[1]),
    } }))
    const hb = reportHead(both, both.USCRUDEINVCHG.points, OIL_TODAY)
    expect(nextSentence('EIA weekly petroleum report', hb.next)).toBe('EIA weekly petroleum report: was due Mar 19; not confirmed yet.')
    expect(hb.note).toBe('Delayed: the newest release has not arrived')
  })
})

describe('the line: two years of crude stocks, in its own range, a missing week a gap', () => {
  it('105 weeks on the series\' own weekly grid; the missing week is null, never 0', () => {
    const line = stocksLine(mergePoints(allHistory().USCRUDEINV, latestBySymbol(oilLatest()).USCRUDEINV.points))
    expect(line.rows).toHaveLength(LINE_WEEKS + 1)
    expect(line.end).toBe('2031-03-14')
    expect(line.rows[0].date).toBe('2029-03-16')
    expect(line.gaps).toBe(1)
    expect(line.rows[CRUDE_GAP]).toEqual({ date: '2029-12-21', v: null })
    expect(stocksLine([])).toBeNull()
  })

  it('the picture is drawn in the line\'s own range (never forced through zero) and breaks at the gap', () => {
    const v = view()
    expect(v.line.state).toBe('ok')
    const pic = v.line.picture
    expect(pic.min).toBe(412345)
    expect(pic.max).toBe(452100)
    expect(pic.zeroY).toBeNull()
    expect(pic.path.match(/M/g)).toHaveLength(2)                     // one break, at the missing week
    expect(pic.rangeText).toBe('412.3M bbl to 452.1M bbl')
    expect(pic.words).toBe('Crude oil stocks excluding the SPR, weekly, week to Mar 16, 2029 to week to Mar 14: '
      + 'low 412.3M bbl (week to Aug 3, 2029), high 452.1M bbl (week to Jul 19, 2030), latest 431.2M bbl. '
      + '1 of 105 weeks have no figure here, and the line breaks there.')
    expect([pic.fromText, pic.toText]).toEqual(['Mar 16, 2029', 'Mar 14'])
  })

  it('lineGeometry keeps RATES\' contract: zero is in the range by default; withZero false draws the line\'s own range', () => {
    const hist = { dates: ['a', 'b', 'c'], v: [400, 410, 405] }
    const zeroIn = lineGeometry(hist, 'v')
    expect([zeroIn.min, zeroIn.max]).toEqual([0, 410])
    expect(zeroIn.zeroY).toBe(112)
    const own = lineGeometry(hist, 'v', { withZero: false })
    expect([own.min, own.max, own.zeroY]).toEqual([400, 410, null])
    // in its own range the line spans the box's height; forced through zero it is a flat strip at the top
    const ys = (g) => g.path.split(/[ML]/).filter(Boolean).map((s) => Number(s.trim().split(' ')[1]))
    expect(Math.max(...ys(own)) - Math.min(...ys(own))).toBeGreaterThan(100)
    expect(Math.max(...ys(zeroIn)) - Math.min(...ys(zeroIn))).toBeLessThan(3)
    expect(lineGeometry({ dates: ['a'], v: [1] }, 'v')).toBeNull()
    expect(stocksPicture(null)).toBeNull()
  })

  it('a line with its history not held, still loading, failed, or too short says so', () => {
    expect(view({ historyState: { ...allOk(), USCRUDEINV: 'failed' } }).line).toEqual({ state: 'failed' })
    expect(view({ historyState: { ...allOk(), USCRUDEINV: 'loading' } }).line).toEqual({ state: 'loading' })
    expect(view({ historyState: { ...allOk(), USCRUDEINV: 'not_held' } }).line).toEqual({ state: 'not_held' })
    const crude = oilLatest().series[0]
    const one = oilLatest({ bySymbol: { USCRUDEINV: { ...crude, points: crude.points.slice(-1) } } })
    expect(view({ latest: one, histories: { ...allHistory(), USCRUDEINV: [] } }).line).toEqual({ state: 'too_few' })
    expect(view({ latest: oilLatest({ bySymbol: { USCRUDEINV: { symbol: 'USCRUDEINV', state: 'not_found' } } }) }).line).toEqual({ state: 'not_held' })
    expect(lineWords('not_held')).toBe('The history of crude oil stocks is not held here, so there is no line to draw.')
    expect(lineWords('failed')).toBe('The history of crude oil stocks could not be read just now.')
    expect(lineWords('too_few')).toBe('Fewer than two weeks of crude oil stocks are held, so there is no line to draw.')
  })
})

describe('the reads', () => {
  it('a history read\'s state: its points, still out, a 404 (the series), any other failure or a wrong shape', () => {
    const body = oilHistory('USSPR')
    expect(historyStateOf({ wanted: true, body, error: null, loading: false }, 'USSPR')).toBe('ok')
    expect(historyStateOf({ wanted: true, body, error: { status: 500 }, loading: false }, 'USSPR')).toBe('ok')   // the last good answer stays
    expect(historyStateOf({ wanted: true, body: undefined, error: null, loading: true }, 'USSPR')).toBe('loading')
    expect(historyStateOf({ wanted: true, body: undefined, error: { status: 404 }, loading: false }, 'USSPR')).toBe('not_held')
    expect(historyStateOf({ wanted: true, body: undefined, error: { status: 500 }, loading: false }, 'USSPR')).toBe('failed')
    expect(historyStateOf({ wanted: true, body: { points: [] , symbol: 'USGASINV' }, error: null, loading: false }, 'USSPR')).toBe('failed')
    expect(historyStateOf({ wanted: false, body: undefined, error: null, loading: true }, 'USSPR')).toBe('ok')
    expect(historyPoints({ items: [] }, 'USSPR')).toBeNull()
  })

  it('history and the latest read merge one point per week, the latest read winning a week both hold', () => {
    const a = { t: 1, v: 1, ps: '2031-03-08', pe: '2031-03-14' }
    expect(mergePoints([a, { t: 0, v: 9, ps: '2031-03-01', pe: '2031-03-07' }], [{ ...a, v: 2 }]).map((p) => p.v)).toEqual([9, 2])
    expect(mergePoints(null, [{ v: 1 }])).toEqual([])
  })

  it('the credit line once, its publication date the newest release day of the figures shown', () => {
    const v = view()
    expect(v.credits).toEqual([{ key: 'eia', agency: 'U.S. Energy Information Administration', text: 'Invented EIA credit (Mar 19, 2031).', derived: true }])
    expect(v.newestT).toBe(Math.floor(Date.parse('2031-03-19T10:30:00-04:00') / 1000))
    const none = view({ latest: oilLatest({ bySymbol: Object.fromEntries(OIL_SYMBOLS.map((s) => [s, { symbol: s, state: 'not_found' }])) }) })
    expect(none.credits).toEqual([])
    expect(none.newestT).toBeNull()
  })

  it('an answer that is not the route\'s shape; a failed history is flagged once', () => {
    for (const b of [null, [], { series: 'x' }, { items: [] }, 'text']) expect(oilRead({ latest: b, today: OIL_TODAY }).state).toBe('bad_shape')
    expect(view().historyFailed).toBe(false)
    expect(view({ historyState: { ...allOk(), USREFUTIL: 'failed' } }).historyFailed).toBe(true)
    expect(view({ historyState: { ...allOk(), USREFUTIL: 'not_held' } }).historyFailed).toBe(false)
  })

  it('a failed latest read in words: the ECON board\'s, with OIL\'s own words when the feature is off', () => {
    expect(oilFailure({ status: 403 })).toMatchObject({ kind: 'locked', state: 'plan', title: 'The economic data needs a paid plan.', retry: false })
    expect(oilFailure({ status: 401 })).toMatchObject({ state: 'signed_out', retry: true })
    const off = oilFailure({ status: 404 })
    expect(off).toMatchObject({ kind: 'locked', state: 'off', retry: false })
    expect(off.hint).toBe("The EIA's weekly oil figures this panel shows (stocks, production, refining, pump prices) are not served here right now. Nothing is wrong with your account.")
    expect(oilFailure({ status: 500 })).toMatchObject({ state: 'error', retry: true })
  })
})
