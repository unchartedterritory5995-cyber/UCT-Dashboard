/**
 * NEXT-ROW CHART WALKS, ITEM (i): THE EARNINGS / SPLIT / DIVIDEND BADGES FIND THEIR BARS WITHOUT AN INDEX OF EVERY BAR
 * (2026-11-23, production profile of a next-row press: the earnings builder built a Map over every bar of a daily chart,
 * ~8,000 bucket computations, to place a handful of badges, 1.2 ms a press).
 *
 *   E1 the same badges as before on every timeframe (D, W, M), with and without the Next earnings "E", for rows on a
 *      bar, between bars (a weekend), before the first bar, after the last, an estimate row, a beat, a duplicate report
 *      in one period, a date with a time suffix, an unparseable date, a null row
 *   E2 the same badges on input the fast path refuses: bars out of order, times that are not strings, two bars on one
 *      day (the LAST wins, as the Map's last write did)
 *   E3 on a sorted daily chart the builders read a handful of bars, not every bar (String.prototype.slice: the bucket
 *      of each bar was a slice), for earnings, splits and dividends
 *
 * The reference functions below are the builders exactly as they were before this change (StockChart.jsx at 44a7defafb).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { earningsEventsOf, splitEventsOf, dividendEventsOf, bucketSlot } from '../StockChart'
import { earningsBadgeRows } from './nextEarningsMark'
import { parseTf } from './timeframes'

// ── the reference: the builders as they were (44a7defafb), verbatim but for their names ────────────────────────────
function refBucketEventDate(dstr, tf) {
  const s = String(dstr).slice(0, 10)
  if (tf === 'W') {
    const dt = new Date(`${s}T00:00:00Z`)
    if (isNaN(dt.getTime())) return s
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)) // → Monday of its ISO week
    return dt.toISOString().slice(0, 10)
  }
  if (tf === 'M') return s.slice(0, 7)   // YYYY-MM
  return s
}
function refEarningsEventsOf(markersData, earningsOn, resolvedTf, filteredBars, _nextEarnOn) {
  const isDailyWeekly = parseTf(resolvedTf).minutes == null
  if (!earningsOn || !markersData?.earnings || !isDailyWeekly || !filteredBars?.length) return []
  const tf = resolvedTf
  const bucket = (dstr) => refBucketEventDate(dstr, tf)
  const barByBucket = new Map()
  for (const b of filteredBars) barByBucket.set(bucket(b.t), b)
  const out = []
  const seen = new Set()
  for (const e of earningsBadgeRows(markersData.earnings, _nextEarnOn)) {
    if (!e?.date) continue
    if (e.estimate) {
      out.push({ date: bucketSlot(tf, e.date), low: null, beat: null, estimate: true, data: e })
      continue
    }
    const bar = barByBucket.get(bucket(e.date))
    if (!bar) continue
    const low = +bar.l
    if (!Number.isFinite(low) || seen.has(bar.t)) continue
    seen.add(bar.t)
    out.push({ date: bar.t, low, beat: e.beat, data: e })
  }
  return out
}
function refSplitEventsOf(markersData, splitsOn, resolvedTf, filteredBars) {
  const isDailyWeekly = parseTf(resolvedTf).minutes == null
  if (!splitsOn || !Array.isArray(markersData?.splits) || !isDailyWeekly || !filteredBars?.length) return []
  const barByBucket = new Map()
  for (const b of filteredBars) barByBucket.set(refBucketEventDate(b.t, resolvedTf), b)
  const out = []
  const seen = new Set()
  for (const s of markersData.splits) {
    if (!s.date) continue
    const bar = barByBucket.get(refBucketEventDate(s.date, resolvedTf))
    if (!bar || seen.has(bar.t)) continue
    seen.add(bar.t)
    out.push({ date: bar.t, low: +bar.l, ratio: s.ratio })
  }
  return out
}
function refDividendEventsOf(markersData, dividendsOn, resolvedTf, filteredBars) {
  const isDailyWeekly = parseTf(resolvedTf).minutes == null
  if (!dividendsOn || !Array.isArray(markersData?.dividends) || !isDailyWeekly || !filteredBars?.length) return []
  const barByBucket = new Map()
  for (const b of filteredBars) barByBucket.set(refBucketEventDate(b.t, resolvedTf), b)
  const out = []
  const seen = new Set()
  for (const d of markersData.dividends) {
    if (!d.date || d.amount == null) continue
    const bar = barByBucket.get(refBucketEventDate(d.date, resolvedTf))
    if (!bar || seen.has(bar.t)) continue
    seen.add(bar.t)
    out.push({ date: bar.t, low: +bar.l, amount: Number(d.amount) })
  }
  return out
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const DAY = 86400000
const bar = (t, i) => { const c = 50 + Math.sin(i / 7) * 5; return { t, o: c - 0.3, h: c + 1, l: c - 1 - (i % 5) / 10, c, v: 1e5 + i } }
/** Weekday daily bars from `from` (ms), `n` of them. */
function dailyBars(from, n) {
  const out = []
  for (let ms = from; out.length < n; ms += DAY) {
    const wd = new Date(ms).getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(bar(iso(ms), out.length))
  }
  return out
}
const START = Date.UTC(1995, 0, 2)
const DAILY = dailyBars(START, 8000)                       // 1995 .. ~2025: the size of a member's daily chart
const WEEKLY = DAILY.filter((b) => new Date(`${b.t}T00:00:00Z`).getUTCDay() === 5)   // keyed by the week's Friday
const MONTHLY = (() => { const seen = new Set(); const out = []; for (const b of DAILY) { const m = b.t.slice(0, 7); if (!seen.has(m)) { seen.add(m); out.push({ ...b, t: `${m}-01` }) } } return out })()
const FIRST = DAILY[0].t, LAST = DAILY[DAILY.length - 1].t

const EARNINGS = [
  { date: '1996-04-17', beat: true },                      // on a bar
  { date: '1999-07-17', beat: false },                     // a Saturday: no daily bar, a weekly / monthly one
  { date: '1999-07-21', beat: true },                      // same week as the row above (weekly: one badge a bar)
  { date: '2003-01-31T21:00:00Z', beat: true },            // a time suffix
  { date: '1990-01-05', beat: true },                      // before the first bar
  { date: '2031-05-01', beat: true },                      // after the last bar
  { date: 'not-a-date', beat: false },                     // unparseable
  null,                                                    // a null row
  { date: '' },                                            // no date
  { date: '2015-10-20', beat: null },
  { date: '2015-10-20', beat: true },                      // the same report twice: one badge
  { date: '2026-12-15', estimate: true },                  // the upcoming report
  { date: FIRST, beat: true }, { date: LAST, beat: false },
]
const SPLITS = [{ date: '2000-06-21', ratio: '2:1' }, { date: '2000-06-24', ratio: '3:1' }, { date: '1980-01-02', ratio: '2:1' },
  { date: 'x', ratio: '1:1' }, { date: '', ratio: '2:1' }, { date: '2020-08-31', ratio: '4:1' }]
const DIVS = [{ date: '2012-08-09', amount: 2.65 }, { date: '2012-08-11', amount: 1 }, { date: '2012-08-09', amount: 3 },
  { date: '2019-02-08', amount: null }, { date: '2019-02-08', amount: '0.73' }, { date: 'bad', amount: 1 }, { date: '1970-01-01', amount: 1 }]
const MD = { earnings: EARNINGS, splits: SPLITS, dividends: DIVS }

const shuffled = (arr, seed = 7) => {
  const a = arr.slice()
  let s = seed
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

afterEach(() => { vi.restoreAllMocks() })

describe('the event badges find the bars they did before (equality with the builders at 44a7defafb)', () => {
  const CASES = [['D', DAILY], ['W', WEEKLY], ['M', MONTHLY]]

  it('E1 every timeframe, with and without the Next earnings E', () => {
    for (const [tf, bars] of CASES) {
      for (const nextOn of [false, true]) {
        const got = earningsEventsOf(MD, true, tf, bars, nextOn)
        expect(got, `earnings ${tf} next=${nextOn}`).toEqual(refEarningsEventsOf(MD, true, tf, bars, nextOn))
      }
      expect(splitEventsOf(MD, true, tf, bars), `splits ${tf}`).toEqual(refSplitEventsOf(MD, true, tf, bars))
      expect(dividendEventsOf(MD, true, tf, bars), `dividends ${tf}`).toEqual(refDividendEventsOf(MD, true, tf, bars))
    }
    // the fixtures place something on every timeframe (or this proves little)
    expect(refEarningsEventsOf(MD, true, 'D', DAILY, false).filter((e) => !e.estimate).length).toBeGreaterThan(4)
    expect(refSplitEventsOf(MD, true, 'D', DAILY).length).toBeGreaterThan(0)
    expect(refDividendEventsOf(MD, true, 'D', DAILY).length).toBeGreaterThan(0)
    // and the gates that return nothing still do
    expect(earningsEventsOf(MD, false, 'D', DAILY, false)).toEqual([])
    expect(earningsEventsOf(MD, true, '5', DAILY, false)).toEqual([])
    expect(splitEventsOf(MD, true, 'D', [])).toEqual([])
  })

  it('E2 input the fast path refuses: out of order, numeric times, two bars on one day (the last wins)', () => {
    const outOfOrder = shuffled(DAILY)
    const numeric = DAILY.slice(0, 500).map((b, i) => ({ ...b, t: Date.UTC(2001, 0, 1) / 1000 + i * 86400 }))
    const twin = DAILY.slice()
    const k = twin.findIndex((b) => b.t === '2015-10-20')
    twin.splice(k + 1, 0, { ...twin[k], l: 1.25 })        // a second bar on 2015-10-20, after the first (still sorted)
    const twinM = MONTHLY.slice()
    twinM.splice(10, 0, { ...MONTHLY[9], l: 2.5 })
    for (const [tf, bars] of [['D', outOfOrder], ['D', numeric], ['D', twin], ['M', twinM], ['W', shuffled(WEEKLY)]]) {
      for (const nextOn of [false, true]) {
        expect(earningsEventsOf(MD, true, tf, bars, nextOn)).toEqual(refEarningsEventsOf(MD, true, tf, bars, nextOn))
      }
      expect(splitEventsOf(MD, true, tf, bars)).toEqual(refSplitEventsOf(MD, true, tf, bars))
      expect(dividendEventsOf(MD, true, tf, bars)).toEqual(refDividendEventsOf(MD, true, tf, bars))
    }
    // the twin really is the badge's bar (or the last-wins case proves nothing)
    expect(refEarningsEventsOf(MD, true, 'D', twin, false).find((e) => e.date === '2015-10-20').low).toBe(1.25)
  })
})

describe('the builders read a handful of bars on a sorted daily chart', () => {
  const slicesDuring = (fn) => {
    const spy = vi.spyOn(String.prototype, 'slice')
    try { fn() } finally { spy.mockRestore() }
    return spy.mock.calls.length
  }
  it('E3 earnings, splits and dividends: far fewer bucket slices than bars', () => {
    const md = { earnings: EARNINGS.filter((e) => e && !e.estimate), splits: SPLITS, dividends: DIVS }
    const nE = slicesDuring(() => earningsEventsOf(md, true, 'D', DAILY, false))
    const nS = slicesDuring(() => splitEventsOf(md, true, 'D', DAILY))
    const nD = slicesDuring(() => dividendEventsOf(md, true, 'D', DAILY))
    expect(nE).toBeLessThan(600)                           // was one slice per bar (8,000+)
    expect(nS).toBeLessThan(400)
    expect(nD).toBeLessThan(400)
  })
})
