// app/src/components/chart/engine/ast/htfSessionWeek.test.js
//
// ─── ⭐⭐ Q-CLOSURE (coordinator ruling 2026-11-21) — A DAILY BAR IS KEYED TO ITS WEEK OR MONTH BY THE SESSION IT BELONGS
//     TO, NEVER BY THE CALENDAR DATE OF ITS OPEN; A WEEK THE EXCHANGE'S OWN CALENDAR DECIDES IS WITHHELD BY NAME ──────
//
// TradingView stamps a daily bar at its session OPEN, and an FX or futures session opens the evening before its trading
// day (FX:EURUSD 17:00 New York, CME_MINI:ES1! 17:00 Chicago). The harness dates a capture's daily bar by the calendar date
// of that open (`ourSide.js::toProductBars`), so both lanes put Monday's session in the week before. MEASURED (captures
// `vw-req-w-closure-day-{eurusd,es1}-1d-2026-11-20`, PR #2275, probe `vw-req-w-closure-day.pine`): keyed by the open's
// date, a weekly read was wrong on 13,852 of 14,365 EURUSD bars and 7,160 of 7,386 ES1 bars. Keyed by the session
// (`interpret.js::sessionKeying`: S0 the next day, S2 a closure's session carried to the next trading day when that day
// holds no bar of its own), every look-ahead weekly open, high, low and close is TradingView's on both; TradingView's
// week includes a closure-day bar (EURUSD Good Friday 2024 closes week 13 on it, 1.07894).
// What the venue's calendar decides is withheld by name (`request:htf-venue-calendar`): with look-ahead off, the close of
// a week or month ending before a weekday with no session (34 EURUSD bars, 37 ES1), and a carry the captures do not
// witness (after 2026-11-20, the newest bar on a closure, past the calendar's horizon).
//
// THE BARS ARE SYNTHETIC, shaped like the two captures (the repo is public: no vendor rows): bar i has o = i + 0.5,
// h = i + 1.5, l = i, c = i + 1, v = 100 + i, dated as the harness dates a capture's bar (its open's calendar date).
// THE SHARED FIXTURE `tests/fixtures/ast/htf_session_week.json` is WRITTEN here (HTF_SESSION_WEEK_WRITE=1) and READ by
// `tests/test_pine_htf_session_week.py`: each set's bars and keying, each case's tree, hand-written answer, this lane's
// column and named codes; the Python lane must equal them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret, barDays, isoDay, requestAlignment, HTF_VENUE_CALENDAR_CODE, SESSION_CARRY_WITNESSED_THROUGH,
  CHART_CLOCK_WITHHELD } from './interpret'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'htf_session_week.json')
const HARNESS = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'vendor', 'harness')

const plus = (iso, k) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1,
  Number(iso.slice(8, 10)) + k)).toISOString().slice(0, 10)
// the opens of one week of sessions: Sunday's evening (Monday's session) and the `days - 1` evenings after it
const week = (sunday, days = 5) => Array.from({ length: days }, (_, k) => plus(sunday, k))
const dailyBars = (opens) => opens.map((t, i) => ({ t, o: i + 0.5, h: i + 1.5, l: i, c: i + 1, v: 100 + i }))

// ── FX:EURUSD's shape: a session opens every Sunday-Thursday evening; FX trades Good Friday and July 4; no session on a
// Christmas or New Year's Friday ────────────────────────────────────────────────────────────────────────────────────
const EUR = [
  // Christmas 2015: the Thursday 12-24 and 12-31 sessions (opened Wednesday) are the last of their weeks
  ...week('2015-12-13'), ...week('2015-12-20', 4), ...week('2015-12-27', 4), ...week('2016-01-03'),
  // Good Friday 2024: its session (opened Thursday 03-28) closes week 13; Monday 04-01's opens Sunday 03-31
  ...week('2024-03-17'), ...week('2024-03-24'), ...week('2024-03-31'), ...week('2024-04-07'),
  // July 4 2025 (a Friday the NYSE is closed): FX holds the session (opened Thursday 07-03) and Monday 07-07's
  ...week('2025-06-29'), ...week('2025-07-06'),
]
// ── CME_MINI:ES1!'s shape: a holiday's Globex session trades for the next trade date, which holds no bar of its own; no
// session on Good Friday ─────────────────────────────────────────────────────────────────────────────────────────────
const ES = [
  // Memorial Day 2021 (Monday 05-31): its session opens Sunday 05-30 and trades for Tuesday 06-01 (a June session)
  ...week('2021-05-23'), '2021-05-30', '2021-06-01', '2021-06-02', '2021-06-03', ...week('2021-06-06'),
  // Good Friday 2024: no session; the week's last bar is Thursday 03-28's (opened Wednesday 03-27)
  ...week('2024-03-17'), ...week('2024-03-24', 4), ...week('2024-03-31'),
  // July 4 2025 (Friday): Thursday 07-03's session (opened Wednesday 07-02) closes the week at 12:15 Chicago; the
  // holiday's (opened Thursday 07-03) trades for Monday 07-07, and the next bar opens Monday 07-07 (Tuesday's session)
  ...week('2025-06-22'), ...week('2025-06-29'), '2025-07-07', '2025-07-08', '2025-07-09', '2025-07-10', ...week('2025-07-13'),
  // Juneteenth 2026 (Friday 06-19): the holiday's session (opened Thursday 06-18) trades for Monday 06-22
  ...week('2026-06-14'), '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25',
]
// a carry after `SESSION_CARRY_WITNESSED_THROUGH` (Juneteenth 2027, Friday 06-18 observed), the newest bar on a closure,
// and past the calendar's horizon (Good Friday 2029: no closure is known for it)
const ES_FUTURE = [...week('2027-06-13'), '2027-06-21', '2027-06-22', '2027-06-23', '2027-06-24', ...week('2027-06-27')]
const ES_NEWEST = [...week('2025-06-22'), ...week('2025-06-29')]
const ES_FAR = [...week('2029-03-18'), ...week('2029-03-25'), '2029-04-02', '2029-04-03', '2029-04-04', '2029-04-05',
  ...week('2029-04-08'), ...week('2029-04-15')]
// ── CONTROLS (coordinator condition 1): no series of another shape is touched ───────────────────────────────────────
const weekdays = (from, to) => { const out = []; for (let d = from; d <= to; d = plus(d, 1)) { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); if (w > 0 && w < 6) out.push(d) } return out }
const SPY_LIKE = weekdays('2024-03-18', '2024-04-12').filter((d) => d !== '2024-03-29')
const STRAY = [...SPY_LIKE.slice(0, 5), '2024-03-24', ...SPY_LIKE.slice(5)]        // one stray Sunday row in a stock's series
const EVERY_DAY = Array.from({ length: 28 }, (_, k) => plus('2024-03-18', k))        // a 24x7 symbol's daily bars
const atMidnightUtc = (b) => ({ ...b, t: Date.parse(`${b.t}T00:00:00Z`) / 1000 })
const SETS = {
  eur: dailyBars(EUR), es: dailyBars(ES), esFuture: dailyBars(ES_FUTURE), esNewest: dailyBars(ES_NEWEST),
  esFar: dailyBars(ES_FAR), spyLike: dailyBars(SPY_LIKE), stray: dailyBars(STRAY), everyDay: dailyBars(EVERY_DAY),
  midnight: dailyBars(SPY_LIKE).map(atMidnightUtc),
}
const OPENS = { eur: EUR, es: ES, esFuture: ES_FUTURE, esNewest: ES_NEWEST, esFar: ES_FAR }
const DAY = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

// the bar opened on an evening, and its fields (bar i: o = i + 0.5, h = i + 1.5, l = i, c = i + 1, v = 100 + i)
const ix = (set, open) => {
  const i = OPENS[set].indexOf(open)
  if (i < 0) throw new Error(`${set}: no bar opened on ${open}`)
  return i
}
const cl = (set, open) => ix(set, open) + 1
const op = (set, open) => ix(set, open) + 0.5
const S = (name) => ({ type: 'series', name })
const num = (value) => ({ type: 'num', value })
const live = (arg, code = 'W') => ({ type: 'tf_live', value: code, args: [arg] })
const merge = (arg, code = 'W') => ({ type: 'tf_merge', value: code, args: [arg] })
const off = (k, a) => ({ type: 'offset', value: k, args: [a] })
const call = (name, ...args) => ({ type: 'call', name, args })
const CLOSE = S('close')
const n = null

const CASES = [
  // ⭐ S0 + THE INCLUDE (EURUSD): the Good Friday bar is in its week, and closes it
  { name: 'S0: tf_live(W, close) on the Good Friday 2024 week closes on the Good Friday bar (opened Thursday 03-28): TradingView includes a closure-day bar',
    set: 'eur', tree: () => live(CLOSE), pick: () => [ix('eur', '2024-03-24'), ix('eur', '2024-03-26'), ix('eur', '2024-03-28')],
    expect: () => [cl('eur', '2024-03-28'), cl('eur', '2024-03-28'), cl('eur', '2024-03-28')] },
  { name: 'S0: Monday 04-01\'s session (opened Sunday 03-31) is in the next week: tf_live(W, close) there is that week\'s close',
    set: 'eur', tree: () => live(CLOSE), pick: () => [ix('eur', '2024-03-31')], expect: () => [cl('eur', '2024-04-04')] },
  { name: 'S0: and that week opens with it: tf_live(W, open) on Monday 04-01\'s session',
    set: 'eur', tree: () => live(S('open')), pick: () => [ix('eur', '2024-03-31'), ix('eur', '2024-04-04')],
    expect: () => [op('eur', '2024-03-31'), op('eur', '2024-03-31')] },
  { name: 'S0: tf_merge(W, close) shows week 13\'s close on the Good Friday bar, and on the next week\'s bars',
    set: 'eur', tree: () => merge(CLOSE), pick: () => [ix('eur', '2024-03-27'), ix('eur', '2024-03-28'), ix('eur', '2024-03-31')],
    expect: () => [cl('eur', '2024-03-21'), cl('eur', '2024-03-28'), cl('eur', '2024-03-28')] },
  { name: 'S0, the month: tf_live(M, close) on Monday 04-01\'s session (opened on a March date) is April\'s; March closes on Good Friday',
    set: 'eur', tree: () => live(CLOSE, 'M'), pick: () => [ix('eur', '2024-03-31'), ix('eur', '2024-03-26')],
    expect: () => [cl('eur', '2024-04-11'), cl('eur', '2024-03-28')] },
  { name: 'S0: July 4 2025 on FX is a session of its week (opened Thursday 07-03): tf_live(W, close) closes on it',
    set: 'eur', tree: () => live(CLOSE), pick: () => [ix('eur', '2025-06-30'), ix('eur', '2025-07-06')],
    expect: () => [cl('eur', '2025-07-03'), cl('eur', '2025-07-10')] },
  // ⭐⭐ THE VENUE CLOSE (EURUSD Christmas 2015): only the closing bar, never the week
  { name: 'THE VENUE CLOSE: tf_merge(W, close) on Thursday 12-24\'s session (the week\'s last, before a Friday with no session) is withheld by name; the week\'s other bars draw the week before',
    set: 'eur', tree: () => merge(CLOSE),
    pick: () => [ix('eur', '2015-12-20'), ix('eur', '2015-12-21'), ix('eur', '2015-12-22'), ix('eur', '2015-12-23'), ix('eur', '2015-12-27')],
    expect: () => [cl('eur', '2015-12-17'), cl('eur', '2015-12-17'), cl('eur', '2015-12-17'), n, cl('eur', '2015-12-23')] },
  { name: 'THE VENUE CLOSE: nz(tf_merge(W, close)) is withheld there too (never nz\'s 0), and tf_merge(W, close)[1] one bar later',
    set: 'eur', tree: () => call('nz', merge(CLOSE), num(0)), pick: () => [ix('eur', '2015-12-23'), ix('eur', '2015-12-30')],
    expect: () => [n, n] },
  { name: 'THE VENUE CLOSE through an offset: tf_merge(W, close)[1] withholds the bar after the closing bar',
    set: 'eur', tree: () => off(1, merge(CLOSE)), pick: () => [ix('eur', '2015-12-23'), ix('eur', '2015-12-27'), ix('eur', '2015-12-28')],
    expect: () => [cl('eur', '2015-12-17'), n, cl('eur', '2015-12-23')] },
  { name: 'THE VENUE CLOSE is a look-ahead-off question only: tf_live(W, close) on Christmas 2015\'s week draws',
    set: 'eur', tree: () => live(CLOSE), pick: () => [ix('eur', '2015-12-21'), ix('eur', '2015-12-23')],
    expect: () => [cl('eur', '2015-12-23'), cl('eur', '2015-12-23')] },
  // ⭐⭐ S2 (ES1): a holiday's session carried to the next trading day
  { name: 'S2: July 4 2025\'s holiday session (opened Thursday 07-03) is in the week of 07-07: tf_live(W, close) there is that week\'s close',
    set: 'es', tree: () => live(CLOSE), pick: () => [ix('es', '2025-07-03'), ix('es', '2025-07-08')],
    expect: () => [cl('es', '2025-07-10'), cl('es', '2025-07-10')] },
  { name: 'S2: the week before closes on Thursday 07-03\'s session (opened Wednesday 07-02)',
    set: 'es', tree: () => live(CLOSE), pick: () => [ix('es', '2025-06-29'), ix('es', '2025-07-02')],
    expect: () => [cl('es', '2025-07-02'), cl('es', '2025-07-02')] },
  { name: 'S2: the week of 07-07 opens with the holiday session and holds its volume',
    set: 'es', tree: () => live(S('open')), pick: () => [ix('es', '2025-07-07')], expect: () => [op('es', '2025-07-03')] },
  { name: 'S2: tf_live(W, volume) of the week of 07-07 sums its five bars (the holiday session\'s included)',
    set: 'es', tree: () => live(S('volume')), pick: () => [ix('es', '2025-07-09')],
    expect: () => [['2025-07-03', '2025-07-07', '2025-07-08', '2025-07-09', '2025-07-10'].reduce((s, d) => s + 100 + ix('es', d), 0)] },
  { name: 'S2: tf_merge(W, close) on Thursday 07-03\'s session closes the week on that bar (TradingView\'s week ends 07-03 12:15): drawn',
    set: 'es', tree: () => merge(CLOSE), pick: () => [ix('es', '2025-07-02'), ix('es', '2025-07-03')],
    expect: () => [cl('es', '2025-07-02'), cl('es', '2025-07-02')] },
  { name: 'S2, the month: Memorial Day 2021\'s session (opened Sunday 05-30) trades for Tuesday 06-01: June\'s; May closes Friday 05-28',
    set: 'es', tree: () => live(CLOSE, 'M'), pick: () => [ix('es', '2021-05-30'), ix('es', '2021-05-27')],
    expect: () => [cl('es', '2021-06-10'), cl('es', '2021-05-27')] },
  { name: 'S2: Juneteenth 2026\'s session (opened Thursday 06-18) is in the week of 06-22',
    set: 'es', tree: () => live(CLOSE), pick: () => [ix('es', '2026-06-18'), ix('es', '2026-06-17')],
    expect: () => [cl('es', '2026-06-25'), cl('es', '2026-06-17')] },
  { name: 'THE VENUE CLOSE (ES1 Good Friday 2024): tf_merge(W, close) on Thursday 03-28\'s session is withheld by name; the look-ahead read draws',
    set: 'es', tree: () => merge(CLOSE), pick: () => [ix('es', '2024-03-26'), ix('es', '2024-03-27'), ix('es', '2024-03-31')],
    expect: () => [cl('es', '2024-03-21'), n, cl('es', '2024-03-27')] },
  // ⭐⭐ WHAT NO CAPTURE WITNESSES (coordinator condition 2): withheld by the same code
  { name: 'UNWITNESSED: a carry after 2026-11-20 (Juneteenth 2027) withholds the two weeks it touches; the week after draws',
    set: 'esFuture', tree: () => live(CLOSE),
    pick: () => [ix('esFuture', '2027-06-14'), ix('esFuture', '2027-06-17'), ix('esFuture', '2027-06-22'), ix('esFuture', '2027-06-28')],
    expect: () => [n, n, n, cl('esFuture', '2027-07-01')] },
  { name: 'UNWITNESSED: the newest bar on a closure (its next trading day not known yet) withholds its week; the week before draws',
    set: 'esNewest', tree: () => live(CLOSE), pick: () => [ix('esNewest', '2025-06-25'), ix('esNewest', '2025-06-30'), ix('esNewest', '2025-07-03')],
    expect: () => [cl('esNewest', '2025-06-26'), n, n] },
  { name: 'UNWITNESSED: past the calendar\'s horizon a next weekday with no bar of its own may be a carry (Good Friday 2029)',
    set: 'esFar', tree: () => live(CLOSE), pick: () => [ix('esFar', '2029-03-19'), ix('esFar', '2029-03-26'), ix('esFar', '2029-04-03'), ix('esFar', '2029-04-09')],
    expect: () => [cl('esFar', '2029-03-22'), n, n, cl('esFar', '2029-04-12')] },
  // CONTROLS — another shape keeps its dates (Good Friday 2024 absent from the stock's series)
  { name: 'CONTROL a stock\'s daily series: tf_live(W, close) closes week 13 on Thursday 03-28', set: 'spyLike',
    tree: () => live(CLOSE), pick: () => [SPY_LIKE.indexOf('2024-03-25'), SPY_LIKE.indexOf('2024-04-01')],
    expect: () => [SPY_LIKE.indexOf('2024-03-28') + 1, SPY_LIKE.indexOf('2024-04-05') + 1] },
  { name: 'CONTROL a stray Sunday row in a stock\'s series moves nothing: tf_live(W, close) on Monday 03-25', set: 'stray',
    tree: () => live(CLOSE), pick: () => [STRAY.indexOf('2024-03-25')], expect: () => [STRAY.indexOf('2024-03-28') + 1] },
  { name: 'CONTROL a 24x7 series: its week ends on its Sunday (tf_live(W, close) on Monday 03-18)', set: 'everyDay',
    tree: () => live(CLOSE), pick: () => [0], expect: () => [EVERY_DAY.indexOf('2024-03-24') + 1] },
  { name: 'CONTROL a daily series stamped at midnight UTC keeps its dates', set: 'midnight',
    tree: () => live(CLOSE), pick: () => [SPY_LIKE.indexOf('2024-03-25')], expect: () => [SPY_LIKE.indexOf('2024-03-28') + 1] },
]

const run = (c, sink) => Array.from(interpret(c.tree(), SETS[c.set], {}, undefined, undefined,
  { ...DAY, ...(sink ? { chartClockSink: sink } : {}) })).map((v) => (Number.isFinite(v) ? v : null))

function build() {
  return {
    _about: 'Q-CLOSURE (coordinator ruling 2026-11-21). WRITTEN by app/src/components/chart/engine/ast/htfSessionWeek.test.js '
      + '(HTF_SESSION_WEEK_WRITE=1), READ by it and by tests/test_pine_htf_session_week.py. `sets`: SYNTHETIC daily bars '
      + 'shaped like the captures vw-req-w-closure-day-{eurusd,es1}-1d-2026-11-20 (bar i: o = i + 0.5, h = i + 1.5, l = i, '
      + 'c = i + 1, v = 100 + i), dated by the calendar date of each session\'s open, plus controls of other shapes; '
      + '`keying`: this lane\'s barDays for each set. Per case: `tree`, `opts` (JS spelling), `pick` (bar indexes), '
      + '`expect` (the hand-written answer, null = withheld), `served` (this lane\'s whole column), `codes` (what it named). '
      + 'The Python lane (ast_interpret) must equal all of them.',
    witnessedThrough: SESSION_CARRY_WITNESSED_THROUGH,
    sets: SETS,
    keying: Object.fromEntries(Object.entries(SETS).map(([k, bars]) => [k, barDays(bars)])),
    cases: CASES.map((c) => {
      const sink = new Map()
      const served = run(c, sink)
      return { name: c.name, set: c.set, opts: DAY, tree: c.tree(), pick: c.pick(), expect: c.expect(), served,
        codes: [...sink.keys()].sort() }
    }),
  }
}

const TEXT = `${JSON.stringify(build(), null, 1)}\n`
if (process.env.HTF_SESSION_WEEK_WRITE === '1') fs.writeFileSync(FIXTURE, TEXT)
const COMMITTED = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : ''
const FIX = JSON.parse(COMMITTED || '{"cases": [], "keying": {}}')

describe('the fixture both lanes read', () => {
  it('⭐ regenerates byte for byte (HTF_SESSION_WEEK_WRITE=1 rewrites it)', () => {
    expect(COMMITTED).toBe(TEXT)
  })
})

describe('every case is its hand-written answer (computed here, and recorded in the fixture)', () => {
  it('is not vacuous', () => {
    expect(FIX.cases.length).toBe(CASES.length)
    expect(FIX.cases.filter((c) => c.name.startsWith('CONTROL')).length).toBeGreaterThanOrEqual(4)
    expect(FIX.cases.filter((c) => c.expect.includes(null)).length).toBeGreaterThanOrEqual(6)
    for (const c of FIX.cases) expect(c.pick.length, c.name).toBe(c.expect.length)
  })
  for (const spec of CASES) {
    it(spec.name, () => {
      const sink = new Map()
      const served = run(spec, sink)
      const c = { name: spec.name, tree: spec.tree(), pick: spec.pick(), expect: spec.expect(), served, codes: [...sink.keys()] }
      c.pick.forEach((j, k) => {
        if (c.expect[k] === null) expect(c.served[j], `${c.name} bar ${j}`).toBe(null)
        else expect(c.served[j], `${c.name} bar ${j}`).toBeCloseTo(c.expect[k], 9)
      })
      const named = c.codes.includes(HTF_VENUE_CALENDAR_CODE)
      if (c.expect.includes(null)) expect(named, `${c.name}: withholds by the venue code`).toBe(true)
      // a control, and a look-ahead read of a set holding no unwitnessed carry, never names it
      if (c.name.startsWith('CONTROL') || (c.tree.type === 'tf_live' && ['eur', 'es'].includes(c.set))) {
        expect(named, `${c.name}: names nothing`).toBe(false)
      }
    })
  }
})

// ⭐⭐ THE KEYING ITSELF: S0 everywhere on the evening-open sets, S2 on exactly the sessions it is witnessed on
describe('⭐⭐ the session each bar is keyed to', () => {
  const s0 = (set) => OPENS[set].map((d) => plus(d, 1))
  it('EURUSD\'s shape: every bar is the session it opens (S2 never fires: FX holds a Monday bar after every closure)', () => {
    expect(barDays(SETS.eur)).toEqual(s0('eur'))
  })
  it('ES1\'s shape: S0, and S2 on exactly the holiday sessions whose next trading day holds no bar of its own', () => {
    const got = barDays(SETS.es)
    const moved = got.map((d, i) => [OPENS.es[i], d]).filter(([o, d]) => d !== plus(o, 1))
    expect(moved).toEqual([['2021-05-30', '2021-06-01'], ['2025-07-03', '2025-07-07'], ['2026-06-18', '2026-06-22']])
  })
  // ⭐⭐ COORDINATOR CONDITION 2 — S2 IS AN OBSERVED RULE. Every session it carries across a week or month on the ES1
  // capture (7,386 bars, 1997-09-08 .. 2026-11-20; graded per bar, look-ahead W o/h/l/c 0 wrong, M close 0 wrong except
  // the three Holy Thursday month-ends the venue code withholds): the holiday session's open, the trading day it is carried
  // to, and TradingView's own week for that bar (time("W") .. time_close("W"), Chicago). A carry outside this span is
  // withheld (`UNWITNESSED` cases above).
  const WITNESSED = [
    ['2009-07-02', '2009-07-03', '2009-07-06', 'W', 'Thu 2009-07-02 17:00 .. Fri 2009-07-10 16:00'],
    ['2010-05-30', '2010-05-31', '2010-06-01', 'M', 'Sun 2010-05-30 17:00 .. Fri 2010-06-04 16:00'],
    ['2014-07-03', '2014-07-04', '2014-07-07', 'W', 'Thu 2014-07-03 17:00 .. Fri 2014-07-11 16:00'],
    ['2015-07-02', '2015-07-03', '2015-07-06', 'W', 'Thu 2015-07-02 17:00 .. Fri 2015-07-10 16:00'],
    ['2020-07-02', '2020-07-03', '2020-07-06', 'W', 'Thu 2020-07-02 17:00 .. Fri 2020-07-10 16:00'],
    ['2021-05-30', '2021-05-31', '2021-06-01', 'M', 'Sun 2021-05-30 17:00 .. Fri 2021-06-04 16:00'],
    ['2025-07-03', '2025-07-04', '2025-07-07', 'W', 'Thu 2025-07-03 17:00 .. Fri 2025-07-11 16:00'],
    ['2026-06-18', '2026-06-19', '2026-06-22', 'W', 'Thu 2026-06-18 17:00 .. Fri 2026-06-26 16:00'],
    ['2026-07-02', '2026-07-03', '2026-07-06', 'W', 'Thu 2026-07-02 17:00 .. Fri 2026-07-10 16:00'],
  ]
  for (const [open, session, to, crosses, tvWeek] of WITNESSED) {
    it(`S2 witnessed: the session opened ${open} (dated ${session}) is keyed ${to}, across a ${crosses === 'W' ? 'week' : 'month'} (TradingView's week ${tvWeek})`, () => {
      // the shape around it: the holiday's session opens the evening before; the next bar opens on the day it is carried to
      const opens = [...week(plus(open, -((new Date(`${open}T00:00:00Z`).getUTCDay() + 7) % 7) - 7)), open, to, plus(to, 1)]
      const days = barDays(dailyBars(opens))
      expect(days[opens.indexOf(open)]).toBe(to)
      expect(to <= SESSION_CARRY_WITNESSED_THROUGH).toBe(true)
      const wk = (d) => { const z = Date.parse(`${d}T00:00:00Z`) / 86400000; return z - (((z + 3) % 7) + 7) % 7 }
      expect(crosses === 'W' ? wk(session) !== wk(to) : session.slice(0, 7) !== to.slice(0, 7)).toBe(true)
    })
  }
  it('controls: a stock\'s, a 24x7 symbol\'s, a stray Sunday row\'s and a midnight-UTC series keep their dates', () => {
    for (const k of ['spyLike', 'stray', 'everyDay', 'midnight']) {
      expect(barDays(SETS[k]), k).toEqual(SETS[k].map((b) => isoDay(b.t)))
    }
  })
})

// ⭐⭐ COORDINATOR CONDITION 1 — THE COMMITTED SPY AND BTCUSD DAILY CAPTURES' W / M AGGREGATES ARE BYTE-EQUAL TO THEIR
// DATES' (the keying before this change: `isoDay`), read as TradingView stamps them (unix seconds) and as the harness
// hands them (the open's date in the exchange's zone)
describe('⭐⭐ controls on committed captures: SPY 1D and BITSTAMP:BTCUSD 1D', () => {
  const capture = (file) => JSON.parse(fs.readFileSync(path.join(HARNESS, file), 'utf8'))
  const FILES = ['vw-request-htf-alignment-spy-1d-2026-10-02.json', 'vw-bt-session-overnight-value-btcusd-1d-2026-11-16.json']
  const refAggregate = (bars, days, code, field) => {
    const key = (d) => (code === 'M' ? d.slice(0, 7) : (() => { const z = Date.parse(`${d}T00:00:00Z`) / 86400000; return z - (((z + 3) % 7) + 7) % 7 })())
    const agg = new Map()
    bars.forEach((b, i) => {
      const k = key(days[i])
      const a = agg.get(k)
      if (!a) agg.set(k, { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })
      else { a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.v += b.v }
    })
    return bars.map((b, i) => agg.get(key(days[i]))[field])
  }
  for (const file of FILES) {
    const cap = capture(file)
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: cap.symbol.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const asStamped = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v ?? 0 }))
    const asHarness = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t: fmt.format(new Date(t * 1000)), o, h, l, c, v: v ?? 0 }))
    for (const [how, bars] of [['unix seconds', asStamped], ['the harness\'s dates', asHarness]]) {
      it(`${file} (${how}): keyed by its own dates, every W / M look-ahead aggregate equals theirs`, () => {
        const days = bars.map((b) => isoDay(b.t))
        expect(barDays(bars)).toEqual(days)
        for (const code of ['W', 'M']) {
          for (const field of ['open', 'high', 'low', 'close', 'volume']) {
            const col = Array.from(interpret(live(S(field), code), bars, {}, undefined, undefined, DAY))
            const ref = refAggregate(bars, days, code, field[0] === 'v' ? 'v' : field[0])
            expect(col, `${code} ${field}`).toEqual(ref)
          }
        }
      })
    }
  }
})

// ⭐⭐ THE CAPTURES THEMSELVES (committed by #2275): the keying and the grade, read here as the harness hands the bars
// (each bar dated by its open's calendar date in the exchange's zone, `ourSide.js::toProductBars`)
describe('⭐⭐ the two captures: vw-req-w-closure-day-{eurusd,es1}-1d-2026-11-20', () => {
  const load = (id) => {
    const cap = JSON.parse(fs.readFileSync(path.join(HARNESS, `vw-req-w-closure-day-${id}-1d-2026-11-20.json`), 'utf8'))
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: cap.symbol.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const bars = cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t: fmt.format(new Date(t * 1000)), o, h, l, c, v: v ?? 0 }))
    const plots = cap.study.plots.map((p) => p.title || p.id)
    const tv = (title) => { const j = 1 + plots.indexOf(title); const at = new Map(cap.plotValues.rows.map((r) => [r[0], r[j]])); return cap.bars.rows.map((r) => at.get(r[0])) }
    return { cap, bars, tv }
  }
  const wk = (d) => { const z = Date.parse(`${d}T00:00:00Z`) / 86400000; return z - (((z + 3) % 7) + 7) % 7 }
  const crossings = (bars) => {
    const days = barDays(bars)
    return bars.map((b, i) => [b.t, plus(b.t, 1), days[i]])
      .filter(([, s0, d]) => d !== s0 && (wk(s0) !== wk(d) || s0.slice(0, 7) !== d.slice(0, 7))).map(([o, s0, d]) => [o, s0, d])
  }
  for (const id of ['eurusd', 'es1']) {
    it(`${id}: every look-ahead weekly close is TradingView's, and the look-ahead-off close only where the venue's calendar does not decide`, () => {
      const { bars, tv } = load(id)
      const want = tv('W_close_on')
      const got = Array.from(interpret(live(CLOSE), bars, {}, undefined, undefined, { ...DAY, historyFromListing: false }))
      let compared = 0
      for (let i = 0; i < bars.length; i++) {
        if (want[i] === null || want[i] === undefined) continue
        compared += 1
        expect(got[i], `${id} bar ${i} (${bars[i].t})`).toBeCloseTo(want[i], 9)
      }
      expect(compared).toBeGreaterThan(7000)
      const off = tv('W_close_off')
      const held = new Map()
      const merged = Array.from(interpret(merge(CLOSE), bars, {}, undefined, undefined, { ...DAY, historyFromListing: false, withheldBarsSink: held }))
      const venue = held.get(HTF_VENUE_CALENDAR_CODE)
      let withheld = 0
      for (let i = 0; i < bars.length; i++) {
        if (venue && venue[i]) { withheld += 1; continue }
        if (off[i] === null || off[i] === undefined || !Number.isFinite(merged[i])) continue
        expect(merged[i], `${id} merge bar ${i} (${bars[i].t})`).toBeCloseTo(off[i], 9)
      }
      expect(withheld, `${id}: the venue closes withheld`).toBe(id === 'eurusd' ? 34 : 37)
    })
  }
  it('S2 on the captures: never on EURUSD; on ES1 exactly the 9 witnessed crossings, and none after the witnessed span', () => {
    expect(crossings(load('eurusd').bars)).toEqual([])
    expect(crossings(load('es1').bars)).toEqual([
      ['2009-07-02', '2009-07-03', '2009-07-06'], ['2010-05-30', '2010-05-31', '2010-06-01'],
      ['2014-07-03', '2014-07-04', '2014-07-07'], ['2015-07-02', '2015-07-03', '2015-07-06'],
      ['2020-07-02', '2020-07-03', '2020-07-06'], ['2021-05-30', '2021-05-31', '2021-06-01'],
      ['2025-07-03', '2025-07-04', '2025-07-07'], ['2026-06-18', '2026-06-19', '2026-06-22'],
      ['2026-07-02', '2026-07-03', '2026-07-06']])
    // the witnessed span ends at the captures' newest session
    for (const id of ['eurusd', 'es1']) {
      const { bars } = load(id)
      expect(plus(bars[bars.length - 1].t, 1), id).toBe(SESSION_CARRY_WITNESSED_THROUGH)
    }
  })
})

describe('the run\'s request (`requestAlignment`) withholds the same bars', () => {
  it('EURUSD Christmas 2015: the venue close, and nothing else in its week', () => {
    const sink = new Map()
    const { withheld } = requestAlignment({ chartBars: SETS.eur, srcBars: SETS.eur, code: 'W', opts: { ...DAY, chartClockSink: sink } })
    expect(withheld[ix('eur', '2015-12-23')]).toBe(1)
    for (const d of ['2015-12-20', '2015-12-21', '2015-12-22', '2015-12-27']) expect(withheld[ix('eur', d)], d).toBe(0)
    expect(sink.has(HTF_VENUE_CALENDAR_CODE)).toBe(true)
  })
  it('ES1 July 4 2025: the holiday session reads the week of 07-07, and is drawn', () => {
    const { index, withheld } = requestAlignment({ chartBars: SETS.es, srcBars: SETS.es, code: 'W', live: true, opts: DAY })
    expect(index[ix('es', '2025-07-03')]).toBe(index[ix('es', '2025-07-08')])
    expect(index[ix('es', '2025-07-03')]).not.toBe(index[ix('es', '2025-07-02')])
    expect(withheld[ix('es', '2025-07-03')]).toBe(0)
  })
})

describe('the sentence', () => {
  it('names what it withholds, the two captures and the witnessed span', () => {
    const s = CHART_CLOCK_WITHHELD[HTF_VENUE_CALENDAR_CODE]()
    expect(s).toContain('vw-req-w-closure-day-{eurusd,es1}-1d-2026-11-20')
    expect(s).toContain(SESSION_CARRY_WITNESSED_THROUGH)
    expect(s).toMatch(/withheld rather than guessed/)
  })
})
