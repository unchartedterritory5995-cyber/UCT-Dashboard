// app/src/components/chart/engine/ast/sessionClockParity.test.js
//
// ─── ⭐⭐ 2026-10-31 (`fix/fx-clock-blank`) — THE BAR'S OWN CLOCK, BOTH LANES ──────
//
// Two defects, one clock:
//
//   1. A date-keyed series holding ONE bar before 1990-01-01 blanked EVERY clock
//      column on EVERY bar — bare `time`, `dayofweek`, `hour`, `time_close`, the
//      session test — with nothing said. The 1990 floor guards a NUMBER that is not
//      unix seconds (a `YYYYMMDD` int); `barOpenInstant` reached it for an ISO date
//      through `etWallInstant` → `etClockAt`. Now read (`indicators.js::etClockRead`,
//      `indicator_compute.py::bar_open_instant`), and the `YYYYMMDD` int is still refused.
//   2. On a daily chart of the FX shape (one weekend day, not both) the 09:30 New
//      York stamp is not TradingView's 17:00-the-evening-before, so a TIME-OF-DAY
//      read (`SESSION_CLOCK_LEAVES`) is withheld whole and named
//      (`time-clock:weekend-session`); a DATE read (`dayofweek`) is drawn.
//
// `api/services/ast_interpret.py` is the server's port. This file and
// `tests/test_ast_session_clock_parity.py` read ONE fixture
// (`tests/fixtures/ast/session_clock_parity.json`), so a lane that drifts fails
// against the other lane's own output.
//
// To regenerate after a deliberate change (from `app/`):
//   SESSION_CLOCK_PARITY_WRITE=1 npx vitest run src/components/chart/engine/ast/sessionClockParity.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import { interpret, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE, SESSION_CLOCK_LEAVES } from './interpret.js'
import { tradingViewCloseMinute } from '../../../../lib/marketClock/tradingViewSession.js'
import { barOpenInstant, computeClock } from '../../indicators.js'

const FIXTURE = '../tests/fixtures/ast/session_clock_parity.json'
const WRITE = process.env.SESSION_CLOCK_PARITY_WRITE === '1'
const CODE = 'time-clock:weekend-session'

const iso = (d) => d.toISOString().slice(0, 10)
/** `n` daily bars keyed by ISO date from a UTC date: the vendor's sessions, plus every
 *  calendar day (`every`) or plus one weekend day (`sat` / `sun`). */
function dailyBars(start, n, days = 'sessions') {
  const out = []
  const d = new Date(Date.UTC(...start))
  while (out.length < n) {
    const dow = d.getUTCDay()
    const session = tradingViewCloseMinute(Number(iso(d).replace(/-/g, ''))) !== null
    if (days === 'every' || session || (days === 'sat' && dow === 6) || (days === 'sun' && dow === 0)) {
      const i = out.length
      const c = 100 + Math.sin(i / 7) * 6 + i * 0.05
      out.push({ t: iso(d), o: c - 0.4, h: c + 0.9, l: c - 0.9, c, v: 1000 + i })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

const BARSETS = {
  weekdays: () => dailyBars([2025, 0, 8], 60),
  everyDay: () => dailyBars([2025, 0, 8], 60, 'every'),
  // the FX shape: sessions plus Sundays (TradingView keys an FX day by its 17:00 open,
  // so the harness's FX:EURUSD days run Sunday..Thursday), and plus Saturdays
  sundays: () => dailyBars([2025, 0, 8], 60, 'sun'),
  saturdays: () => dailyBars([2025, 0, 8], 60, 'sat'),
  // 40 sessions from Wed 1985-01-02 — before the 1990 floor; and the same shape with a
  // Sunday bar in 1971, FX:EURUSD's own first year
  sessions1985: () => dailyBars([1985, 0, 2], 40),
  sundays1971: () => dailyBars([1971, 0, 3], 40, 'sun'),
  // ⛔ session days keyed by an INSTANT at 00:00 UTC (`objectDoorDraws.test.js`'s SPY
  // bars): every Monday is a Sunday in New York, yet this is no FX chart and no stamp
  // of ours — the instant is its own time
  utcMidnight: () => dailyBars([2025, 0, 8], 60).map((b) => ({ ...b, t: Date.parse(`${b.t}T00:00:00Z`) / 1000 })),
}

const PINE = {
  time: 'plot(time)',
  hour: 'plot(hour)',
  minute: 'plot(minute)',
  timeClose: 'plot(time_close)',
  session: 'plot(not na(time(timeframe.period, "0930-1600")) ? 1 : 0)',
  dow: 'plot(dayofweek)',
  ymd: 'plot(year * 10000 + month * 100 + dayofmonth)',
  'close+dow': 'plot(close + dayofweek)',
}
const treeOf = (key) => {
  const t = translatePine(`//@version=6\nindicator("p")\n${PINE[key]}\n`, { strict: true })
  if (!t.ok) throw new Error(`${key}: ${t.refusal && t.refusal.message}`)
  return t.outputs[t.selected].ast
}

const CASES = [
  ...Object.keys(PINE).flatMap((k) => ['weekdays', 'everyDay', 'sundays', 'saturdays']
    .map((set) => [`${k} · ${set} · D`, k, set, { tf: 'D' }])),
  ...['time', 'dow', 'timeClose', 'session'].map((k) => [`${k} · 1985 sessions · D`, k, 'sessions1985', { tf: 'D' }]),
  ...['time', 'dow', 'ymd'].map((k) => [`${k} · 1971 sundays · D`, k, 'sundays1971', { tf: 'D' }]),
  ...['time', 'hour', 'session', 'dow'].map((k) => [`${k} · utc-midnight instants · D`, k, 'utcMidnight', { tf: 'D' }]),
  // no timeframe stated: a date key is not read at all, and nothing is named (unchanged)
  ['time · sundays · no tf', 'time', 'sundays', null],
]

function evaluate(ast, bars, opts) {
  const sink = new Map()
  const col = Array.from(interpret(ast, bars, {}, undefined, undefined, { ...(opts || {}), chartClockSink: sink }))
    .map((x) => (Number.isNaN(x) ? null : x))
  return { expected: col, codes: [...sink.keys()].sort() }
}

if (WRITE) {
  const bars = Object.fromEntries(Object.entries(BARSETS).map(([k, f]) => [k, f()]))
  const doc = {
    _: 'fix/fx-clock-blank (2026-10-31) — the bar\'s own clock: read before 1990, withheld by name on an '
      + 'FX-shaped daily chart. Written by app/src/components/chart/engine/ast/sessionClockParity.test.js '
      + '(SESSION_CLOCK_PARITY_WRITE=1); read by that file and by tests/test_ast_session_clock_parity.py. '
      + '`expected` is the JS lane\'s own output (null = withheld / not computable); `codes` the withholding codes.',
    pine: PINE,
    bars,
    cases: CASES.map(([name, key, set, opts]) => ({
      name, pine: key, bars: set, ...(opts ? { opts } : {}), ast: treeOf(key), ...evaluate(treeOf(key), bars[set], opts),
    })),
  }
  writeFileSync(FIXTURE, `${JSON.stringify(doc)}\n`)
}

const PARITY = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const byName = new Map(PARITY.cases.map((c) => [c.name, c]))
const nulls = (name) => byName.get(name).expected.filter((v) => v === null).length

describe('session clock · the fixture is the member door\'s own trees over the bars this file builds', () => {
  it('every case tree is what the translator writes today, every barset the one built here', () => {
    expect(PARITY.cases.map((c) => c.name)).toEqual(CASES.map((c) => c[0]))
    for (const c of PARITY.cases) expect(c.ast, c.name).toEqual(treeOf(c.pine))
    for (const [k, f] of Object.entries(BARSETS)) expect(PARITY.bars[k], k).toEqual(f())
  })
  it('the JS lane reproduces its own fixture', () => {
    for (const c of PARITY.cases) {
      const got = evaluate(c.ast, PARITY.bars[c.bars], c.opts)
      expect(got.expected, c.name).toEqual(c.expected)
      expect(got.codes, c.name).toEqual(c.codes)
    }
  })
})

describe('⭐⭐ a date-keyed series before 1990 is READ, never blanked', () => {
  it('1985: every bar of `time`, `dayofweek`, `time_close` and the session test is served — 09:30 New York', () => {
    for (const k of ['time', 'dow', 'timeClose', 'session']) expect(nulls(`${k} · 1985 sessions · D`), k).toBe(0)
    // Wed 1985-01-02 09:30 EST is 14:30 UTC, in Pine's milliseconds
    expect(byName.get('time · 1985 sessions · D').expected[0]).toBe(Date.UTC(1985, 0, 2, 14, 30))
    expect(byName.get('dow · 1985 sessions · D').expected[0]).toBe(4)
    expect(byName.get('time · 1985 sessions · D').codes).toEqual([])
  })
  it('1971 (FX:EURUSD\'s first year): the DATE is served on every bar', () => {
    expect(nulls('dow · 1971 sundays · D')).toBe(0)
    expect(byName.get('dow · 1971 sundays · D').expected[0]).toBe(1) // Sun 1971-01-03, Pine's 1
    expect(byName.get('ymd · 1971 sundays · D').expected[0]).toBe(19710103)
  })
  it('⛔ the NUMBER door keeps its floor: a `YYYYMMDD` int, and a pre-1990 unix second, are refused', () => {
    expect(barOpenInstant(20250101, 'D')).toBe(null)
    expect(barOpenInstant(31788000, 'D')).toBe(null) // FX:EURUSD's first stamp, as a NUMBER
    const ints = computeClock([{ t: 19850102 }, { t: 19850103 }], 'D')
    expect(Array.from(ints.time).every((v) => Number.isNaN(v))).toBe(true)
    expect(Array.from(ints.dayofweek).every((v) => Number.isNaN(v))).toBe(true)
  })
  it('⛔ before 1883-11-19 (New York local mean time) a date is unreadable, never read off a fractional offset', () => {
    expect(barOpenInstant('1883-11-17', 'D')).toBe(null)
    expect(barOpenInstant('1883-11-18', 'D')).toBe(null) // standard time began at 12:03:58 that day
    expect(barOpenInstant('1883-11-19', 'D')).toBe(Date.UTC(1883, 10, 19, 14, 30) / 1000)
    const old = computeClock([{ t: '1883-11-16' }, { t: '1883-11-19' }], 'D')
    expect(Array.from(old.time).every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('⭐⭐ the bar\'s own clock on an FX-shaped day: time of day withheld by name, the date drawn', () => {
  const TIME_OF_DAY = ['time', 'hour', 'minute', 'timeClose', 'session']
  it('one weekend day but not the other: every time-of-day read is withheld on every bar, and named', () => {
    for (const set of ['sundays', 'saturdays']) {
      for (const k of TIME_OF_DAY) {
        const c = byName.get(`${k} · ${set} · D`)
        expect(c.expected.every((v) => v === null), `${k} · ${set}`).toBe(true)
        expect(c.codes, `${k} · ${set}`).toEqual([CODE])
      }
      // and on FX's own first year, before 1990 too
      expect(byName.get('time · 1971 sundays · D').codes).toEqual([CODE])
    }
  })
  it('a DATE read is drawn there, on every bar, with nothing named', () => {
    for (const set of ['sundays', 'saturdays']) {
      for (const k of ['dow', 'ymd', 'close+dow']) {
        expect(nulls(`${k} · ${set} · D`), `${k} · ${set}`).toBe(0)
        expect(byName.get(`${k} · ${set} · D`).codes, `${k} · ${set}`).toEqual([])
      }
    }
  })
  it('⛔ session bars and every-day bars are unchanged: everything served, nothing named', () => {
    for (const set of ['weekdays', 'everyDay']) {
      for (const k of Object.keys(PINE)) {
        const c = byName.get(`${k} · ${set} · D`)
        expect(c.codes, `${k} · ${set}`).toEqual([])
        // `time_close` on a weekend bar of an every-day chart is unmeasured (pre-existing)
        if (!(set === 'everyDay' && k === 'timeClose')) expect(nulls(`${k} · ${set} · D`), `${k} · ${set}`).toBe(0)
      }
    }
  })
  it('⛔ bars keyed by an INSTANT are never asked: a Sunday in New York there is not an FX day', () => {
    for (const k of ['time', 'hour', 'session', 'dow']) {
      const c = byName.get(`${k} · utc-midnight instants · D`)
      expect(c.codes, k).toEqual([])
      expect(nulls(`${k} · utc-midnight instants · D`), k).toBe(0)
    }
    // non-vacuity: those bars DO read a Sunday in New York
    expect(byName.get('dow · utc-midnight instants · D').expected).toContain(1)
  })
  it('the code is a WHOLE one with a sentence that names its capture, and the leaf list holds no date leaf', () => {
    expect(CHART_CLOCK_WHOLE).toContain(CODE)
    const s = CHART_CLOCK_WITHHELD[CODE]('D')
    expect(s).toContain('vw-time-tf-fx-eurusd-1d-2026-10-01')
    expect(s).toContain('17:00 New York')
    for (const date of ['year', 'month', 'dayofmonth', 'dayofweek', 'lastbaryear']) expect(SESSION_CLOCK_LEAVES).not.toContain(date)
    for (const leaf of ['time', 'hour', 'minute', 'timeclose', 'weekfirst', 'monthfirst']) expect(SESSION_CLOCK_LEAVES).toContain(leaf)
  })
})
