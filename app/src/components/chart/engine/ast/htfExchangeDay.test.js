// app/src/components/chart/engine/ast/htfExchangeDay.test.js
//
// ─── ⭐⭐ RULING 2 (coordinator, 2026-11-20) — A RESAMPLER KEYS A BAR'S WEEK OR MONTH BY THE EXCHANGE'S LOCAL SESSION
//     DATE, NEVER ITS UTC DATE; AND THE TWO LANES NEVER DISAGREE ON A WEEK ─────────────────────────────────────────────
//
// An intraday bar's `t` is unix seconds, and both lanes read its day as the UTC one (`isoDay`, `_iso_day`). New York's
// extended-hours bars after 19:00 in winter are the next UTC day: a Friday evening bar became a Saturday, which the
// Python resampler ("a week is its sessions", `bars_fetch`) left out of the week, so a weekly close or high read on an
// intraday chart differed between the chart and the server lane (the server's indicator alerts read it: it fired on
// the other number); a month's last evening bar went into the next month in both lanes. TradingView keys the bar to its
// local day: capture `vw-bi-time-d-extended-spy-60-2026-11-19` (SPY 60 minutes, 04:00-20:00) reads `time("D")` 54,000 s
// before every winter Friday 19:00 bar (Friday 04:00 New York), day offset 0. Now both lanes key the day in New York
// (`newYorkOffsetSeconds`, twin `_new_york_offset_seconds`).
// A bar dated on a day the exchange held no session (a Good Friday bar: impossible for a listing the store serves, real
// for a symbol trading on such a day) was in one lane's week and not the other's (weekly high 10.5 against 9.5). Both
// lanes now keep every bar the series holds (one aggregate). Whether TradingView's week holds such a bar is NOT
// measured (Q-REQ-CLOSURE): by the coordinator's ruling (C) the withhold that would name it waits for that capture,
// because no series the store serves holds such a bar (`tests/test_htf_closure_week_unreachable.py`, the tripwire),
// and a venue that would bring one is refused by name (below).
//
// THE SHARED FIXTURE `tests/fixtures/ast/htf_exchange_day.json` is WRITTEN here (HTF_EXCHANGE_DAY_WRITE=1) and READ by
// `tests/test_pine_htf_exchange_day.py`: the bars of every set (the SPY weeks are the capture's own rows), each case's
// tree, its hand-written answer and this lane's served column and named codes; the Python lane must equal them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret, barDays, newYorkOffsetSeconds } from './interpret'
import { translatePine } from './pine.js'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'htf_exchange_day.json')
const CAPTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness',
  'vw-bi-time-d-extended-spy-60-2026-11-19.json')
const CAP = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))

const S = (name) => ({ type: 'series', name })
const num = (value) => ({ type: 'num', value })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const merge = (arg, code = 'W') => ({ type: 'tf_merge', value: code, args: [arg] })
const live = (arg, code = 'W') => ({ type: 'tf_live', value: code, args: [arg] })
const tf = (arg, code = 'W') => ({ type: 'tf', value: code, args: [arg] })
const CLOSE = S('close')
const HIGH = S('high')
const n = null

// ── the capture's own SPY rows (time, open, high, low, close, volume), cut to the weeks a case reads ──────────────────
const F = CAP.bars.fields
const rowsBetween = (lo, hi) => CAP.bars.rows.filter((r) => r[0] >= lo && r[0] < hi)
  .map((r) => ({ t: r[F.indexOf('time')], o: r[F.indexOf('open')], h: r[F.indexOf('high')], l: r[F.indexOf('low')],
    c: r[F.indexOf('close')], v: r[F.indexOf('volume')] }))
// 2021-02-08 04:00 New York (09:00Z) to 2021-02-17 04:00: week 6 (Mon 8th - Fri 12th, its last bar Friday 19:00 New York
// = 2021-02-13 00:00Z, a UTC Saturday) and Tuesday 16th (Monday 15th was a holiday)
const FEB = rowsBetween(1612774800, 1613552400)
// 2021-11-29 04:00 New York to 2021-12-02 04:00: November's last bar is Tuesday 30th 19:00 New York = 12-01 00:00Z
const NOV = rowsBetween(1638176400, 1638435600)
// ── a daily series holding a Good Friday bar (2024-03-29), bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1 ────────────
const DAILY = ['2024-03-18', '2024-03-19', '2024-03-20', '2024-03-21', '2024-03-22', '2024-03-25', '2024-03-26', '2024-03-27',
  '2024-03-28', '2024-03-29', '2024-04-01', '2024-04-02', '2024-04-03', '2024-04-04', '2024-04-05', '2024-04-08']
const dailyBars = (days) => days.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))
const NO_CLOSURE = DAILY.filter((d) => d !== '2024-03-29')
// the same daily series stamped in unix seconds at midnight UTC (a DATE, as the run's daily supply spells it): read in
// New York it would be the day before, a Sunday for every Monday
const atMidnightUtc = (b) => ({ ...b, t: Date.UTC(Number(b.t.slice(0, 4)), Number(b.t.slice(5, 7)) - 1, Number(b.t.slice(8, 10))) / 1000 })
const SETS = { feb: FEB, nov: NOV, goodFriday: dailyBars(DAILY), noClosure: dailyBars(NO_CLOSURE),
  midnight: dailyBars(NO_CLOSURE).map(atMidnightUtc) }
const INTRADAY = { tf: '60', newestBarIsForming: false, historyFromListing: true }
const DAY = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

// index of a bar by its New York wall time, for the hand-written answers below
const at = (set, iso, hh) => {
  const days = barDays(SETS[set])
  return SETS[set].findIndex((b, i) => days[i] === iso && ((b.t + newYorkOffsetSeconds(b.t)) % 86400) / 3600 === hh)
}

const CASES = [
  // ⭐ THE DEFECT: the week's close is its Friday 19:00 New York bar's (393.1), never the 18:00 bar's (393.08)
  { name: 'tf_merge(W, close) on Tuesday 16th reads week 6, closed by its Friday 19:00 New York bar (a UTC Saturday)',
    set: 'feb', opts: INTRADAY, tree: () => merge(CLOSE), pick: () => [at('feb', '2021-02-16', 4)], expect: [393.1] },
  { name: 'tf_merge(W, close) on the Friday 19:00 bar itself: it closes week 6 (the merge shows the close there)',
    set: 'feb', opts: INTRADAY, tree: () => merge(CLOSE), pick: () => [at('feb', '2021-02-12', 19)], expect: [393.1] },
  { name: 'tf_live(W, close) on Monday 8th 04:00: the week it is in, closed by the Friday 19:00 bar',
    set: 'feb', opts: INTRADAY, tree: () => live(CLOSE), pick: () => [at('feb', '2021-02-08', 4)], expect: [393.1] },
  { name: 'tf(W, close) (a formula read: the last closed week) on Tuesday 16th',
    set: 'feb', opts: INTRADAY, tree: () => tf(CLOSE), pick: () => [at('feb', '2021-02-16', 4)], expect: [393.1] },
  // ⭐ THE MONTH: November's last bar is Tuesday 30th 19:00 New York (12-01 00:00Z): its close (457.4) is November's
  { name: 'tf_merge(M, close) on December 1st reads November, closed by its 30th 19:00 New York bar (UTC December 1st)',
    set: 'nov', opts: INTRADAY, tree: () => merge(CLOSE, 'M'), pick: () => [at('nov', '2021-12-01', 4)], expect: [457.4] },
  { name: 'tf_live(M, close) on November 30th 19:00 New York: still November',
    set: 'nov', opts: INTRADAY, tree: () => live(CLOSE, 'M'), pick: () => [at('nov', '2021-11-30', 19)], expect: [457.4] },
  // ⭐ A SESSION THE EXCHANGE NEVER HELD (Good Friday 2024-03-29, bar 9): ONE aggregate in both lanes, the bar kept (its
  // high 10.5 is week 13's); whether TradingView keeps it is Q-REQ-CLOSURE's (no served series holds one: the tripwire)
  { name: 'nz(tf_merge(W, high)) on the Good Friday series: week 13 holds its Friday bar in both lanes (10.5)',
    set: 'goodFriday', opts: DAY, tree: () => call('nz', merge(HIGH), num(0)), pick: () => [4, 5, 8, 9, 10, 13, 14],
    expect: [5.5, 5.5, 5.5, 10.5, 10.5, 10.5, 15.5] },
  { name: 'tf_live(W, close) on the Good Friday series: week 13 closes on its Friday bar (10)',
    set: 'goodFriday', opts: DAY, tree: () => live(CLOSE), pick: () => [4, 5, 9, 10], expect: [5, 10, 10, 15] },
  // CONTROLS
  { name: 'CONTROL nz(tf_merge(W, high)) on the same series without the Good Friday bar (Thursday closes the week; nothing withheld)',
    set: 'noClosure', opts: DAY, tree: () => call('nz', merge(HIGH), num(0)), pick: () => [4, 8, 9, 13],
    expect: [5.5, 9.5, 9.5, 14.5] },
  { name: 'CONTROL a daily series stamped at midnight UTC keeps its dates (a date, not an instant): the same weeks',
    set: 'midnight', opts: DAY, tree: () => call('nz', merge(HIGH), num(0)), pick: () => [4, 8, 9, 13],
    expect: [5.5, 9.5, 9.5, 14.5] },
  { name: 'CONTROL a read of the chart\'s own bars only (close) holds no week: nothing withheld on the Good Friday series',
    set: 'goodFriday', opts: DAY, tree: () => call('nz', CLOSE, num(0)), pick: () => [9], expect: [10] },
]

const run = (c, sink) => Array.from(interpret(c.tree(), SETS[c.set], {}, undefined, undefined,
  { ...c.opts, ...(sink ? { chartClockSink: sink } : {}) })).map((v) => (Number.isFinite(v) ? v : null))

function build() {
  return {
    _about: 'RULING 2 (2026-11-20). WRITTEN by app/src/components/chart/engine/ast/htfExchangeDay.test.js '
      + '(HTF_EXCHANGE_DAY_WRITE=1), READ by it and by tests/test_pine_htf_exchange_day.py. `sets`: the bars (feb and '
      + 'nov are rows of the TradingView capture vw-bi-time-d-extended-spy-60-2026-11-19, t in unix seconds; the daily '
      + 'sets ISO days). Per case: `tree`, `opts` (JS spelling), `pick` (bar indexes) and `expect` (the hand-written '
      + 'answer there, null = withheld), `served` (this lane\'s whole column) and `codes` (what it named). The Python '
      + 'lane (ast_interpret.interpret) must equal all of them.',
    sets: SETS,
    cases: CASES.map((c) => {
      const sink = new Map()
      const served = run(c, sink)
      return { name: c.name, set: c.set, opts: c.opts, tree: c.tree(), pick: c.pick(), expect: c.expect, served,
        codes: [...sink.keys()].sort() }
    }),
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.HTF_EXCHANGE_DAY_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''
const FIX = JSON.parse(COMMITTED || '{"cases": []}')

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (HTF_EXCHANGE_DAY_WRITE=1 rewrites it)', () => {
    expect(COMMITTED).toBe(TEXT)
  })
})

describe('⭐ TradingView keys the bar to its exchange day (the capture, read here)', () => {
  it('on every winter Friday 19:00 New York bar of the capture, time("D") is that Friday 04:00 (54,000 s before)', () => {
    const plots = CAP.study.plots.map((p) => p.title || p.id)
    const A1 = 1 + plots.indexOf('A1_secs_time_D')
    const A5 = 1 + plots.indexOf('A5_day_offset_time_D')
    expect(A1).toBeGreaterThan(0)
    const fridays = CAP.plotValues.rows.filter((r) => {
      const t = r[0]
      return newYorkOffsetSeconds(t) === -5 * 3600 && ((t - 5 * 3600) % 86400) / 3600 === 19
        && (((Math.floor((t - 5 * 3600) / 86400) + 4) % 7) + 7) % 7 === 5
    })
    expect(fridays.length).toBe(96)
    const days = barDays(CAP.plotValues.rows.map((r) => ({ t: r[0] })))
    const dayOf = new Map(CAP.plotValues.rows.map((r, i) => [r[0], days[i]]))
    for (const r of fridays) {
      expect(r[A1], `t ${r[0]}`).toBe(-54000)
      expect(r[A5], `t ${r[0]}`).toBe(0)
      // ...and this engine's day for it is that Friday, not the UTC Saturday
      const [y, m, d] = dayOf.get(r[0]).split('-').map(Number)
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), `t ${r[0]}`).toBe(5)
    }
  })
  it('the New York offset is the IANA zone\'s on every half hour 1990-2035', () => {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
      day: '2-digit' })
    let checked = 0
    const stamps = []
    for (let t = Date.UTC(1990, 0, 1) / 1000; t < Date.UTC(2036, 0, 1) / 1000; t += 1799) stamps.push(t)
    // an intraday series (half-hour spacing): each bar keyed by its New York day
    const days = barDays(stamps.map((t) => ({ t })))
    stamps.forEach((t, i) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]))
      if (days[i] !== `${p.year}-${p.month}-${p.day}`) expect(days[i], `t ${t}`).toBe(`${p.year}-${p.month}-${p.day}`)
      checked += 1
    })
    expect(checked).toBeGreaterThan(800000)
  })
})

describe('every case is its hand-written answer', () => {
  it('is not vacuous', () => {
    expect(FIX.cases.length).toBe(CASES.length)
    expect(SETS.feb.length).toBe(96)
    expect(SETS.nov.length).toBe(48)
    for (const c of FIX.cases) for (const j of c.pick) expect(j, c.name).toBeGreaterThanOrEqual(0)
  })
  for (const c of FIX.cases) {
    it(c.name, () => {
      c.pick.forEach((j, k) => {
        if (c.expect[k] === null) expect(c.served[j], `${c.name} bar ${j}`).toBe(null)
        else expect(c.served[j], `${c.name} bar ${j}`).toBeCloseTo(c.expect[k], 9)
      })
      // nothing here names a closure-week withhold: ruling (C) defers it to Q-REQ-CLOSURE
      expect(c.codes.filter((k) => k.includes('closure')), c.name).toEqual([])
    })
  }
})

// ⭐⭐ THE TRIPWIRE'S CHART HALF (ruling (C)): a symbol whose own sessions fall on exchange closures (crypto, FX, futures)
// reaches a weekly or monthly merge here only through a door that refuses it by name today. If one of these ever
// translates, a series holding closure-day bars can reach the aggregate whose TradingView answer is unmeasured: the
// withhold deferred to Q-REQ-CLOSURE (`vw-req-w-closure-day-eurusd-1d` / `-es1-1d`) has to land first.
describe('⭐⭐ the tripwire: a venue whose sessions fall on exchange closures is refused by name before any weekly read', () => {
  for (const venue of ['BINANCE:BTCUSDT', 'BITSTAMP:BTCUSD', 'FX:EURUSD', 'CME_MINI:ES1!']) {
    it(`request.security("${venue}", "W", high) is refused by name`, () => {
      const out = translatePine(['//@version=5', 'indicator("t")',
        `plot(request.security("${venue}", "W", high))`, ''].join('\n'))
      expect(out.refusal, `${venue} translated: read Q-REQ-CLOSURE before serving it`).not.toBe(null)
      expect(String(out.refusal && out.refusal.message), venue).toContain('other-symbol:venue-foreign')
    })
  }
})
