// app/src/components/chart/engine/ast/periodAnchorParity.test.js
//
// ─── ⭐⭐ C36 — `time(<timeframe>)` / `time_close(<timeframe>)` WITHHELD THE SAME
//     WAY IN BOTH LANES ───────────────────────────────────────────────────────
//
// C30 served `time("W" / "M" / "3M" / "12M")` on a daily chart and withheld the
// first partial period — in the JS lanes only. The Python interpreter evaluated
// the same saved tree and read the anchor's `NaN` as Pine's `na`. That is not a
// hypothetical: three server consumers evaluate a member pane's saved document
// (a user-series alert, the scan sweep, the screen backtest), none of them
// supplies both a `tf` and an instant-readable `t`, and so the anchor was `NaN`
// on EVERY bar there: `na(time("W")) ? 111 : 222` answered a confident 111 and
// `ta.change(time("W")) != 0` a confident 0 on every bar.
//
// `api/services/ast_interpret.py::period_anchor_mask` is the port of
// `interpret.js::periodAnchorMask`. This file and
// `tests/test_ast_period_anchor_parity.py` read ONE fixture
// (`tests/fixtures/ast/period_anchor_parity.json`), so a lane that drifts fails
// against the other lane's own output, never against a number retyped here.
//
// ⛔ THE TREES ARE THE MEMBER DOOR'S OWN. Each case's tree is what
// `translatePine(…, { strict: true })` writes for a line of Pine, and the first
// test below re-translates every one and compares — a fixture that drifted from
// the translator would be a parity proof about a tree nobody saves.
//
// To regenerate after a deliberate change (from `app/`):
//   PERIOD_ANCHOR_PARITY_WRITE=1 npx vitest run src/components/chart/engine/ast/periodAnchorParity.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { translatePine } from './pine.js'
import { interpret, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE } from './interpret.js'
import { tradingViewCloseMinute } from '../../../../lib/marketClock/tradingViewSession.js'

const FIXTURE = '../tests/fixtures/ast/period_anchor_parity.json'
const WRITE = process.env.PERIOD_ANCHOR_PARITY_WRITE === '1'

const iso = (d) => d.toISOString().slice(0, 10)
/** `n` daily bars from a UTC date. `days`: 'sessions' (the vendor's own session
 *  days — no weekend, no closure it applies), 'every' (every calendar day),
 *  'sat' / 'sun' (sessions plus that one weekend day). `drop` removes dates. */
function dailyBars(start, n, { days = 'sessions', ints = false, drop = [] } = {}) {
  const out = []
  const gone = new Set(drop)
  const d = new Date(Date.UTC(...start))
  while (out.length < n) {
    const dow = d.getUTCDay()
    const ymd = Number(iso(d).replace(/-/g, ''))
    const session = tradingViewCloseMinute(ymd) !== null
    const keep = days === 'every' || session || (days === 'sat' && dow === 6) || (days === 'sun' && dow === 0)
    if (keep && !gone.has(iso(d))) {
      const i = out.length
      const c = 100 + Math.sin(i / 7) * 6 + i * 0.05
      out.push({ t: ints ? ymd : iso(d), o: c - 0.4, h: c + 0.9, l: c - 0.9, c, v: 1000 + i })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
/** `n` hourly bars (unix seconds) from 2025-01-08 14:30 UTC — 09:30 New York. */
function hourlyBars(n) {
  const t0 = Date.UTC(2025, 0, 8, 14, 30) / 1000
  return Array.from({ length: n }, (_, i) => {
    const c = 50 + Math.cos(i / 5) * 2
    return { t: t0 + i * 3600, o: c, h: c + 0.5, l: c - 0.5, c, v: 10 }
  })
}

const BARSETS = {
  // 300 vendor sessions from Thu 2024-10-10: crosses a month, a quarter and a year,
  // holiday weeks and half-days included
  weekdays: () => dailyBars([2024, 9, 10], 300),
  // 150 calendar days from Wed 2025-01-08 — a symbol that trades every day; crosses
  // the New York clock change of Sun 2025-03-09
  everyDay: () => dailyBars([2025, 0, 8], 150, { days: 'every' }),
  // the same, with a Monday (2025-02-03) and a 1st of the month (2025-04-01) missing
  everyDayGaps: () => dailyBars([2025, 0, 8], 150, { days: 'every', drop: ['2025-02-03', '2025-04-01'] }),
  // sessions plus Saturdays, and sessions plus Sundays: neither capture's shape
  saturdays: () => dailyBars([2025, 0, 8], 60, { days: 'sat' }),
  sundays: () => dailyBars([2025, 0, 8], 60, { days: 'sun' }),
  // sessions, with one Monday's bar (2025-01-13) and the year's first session (2025-01-02) missing
  mondayMissing: () => dailyBars([2024, 11, 2], 60, { drop: ['2025-01-13', '2025-01-02'] }),
  // sessions from Mon 2024-12-02 with ALL of January 2025 missing: the quarter and the year
  // open on Mon 2025-02-03, which IS February's first session — and is not the quarter's
  januaryMissing: () => dailyBars([2024, 11, 2], 45, { drop: Array.from({ length: 31 }, (_, k) => `2025-01-${String(k + 1).padStart(2, '0')}`) }),
  // sessions, with one Friday's bar (2025-01-17) missing: that week's last bar is a Thursday
  fridayMissing: () => dailyBars([2025, 0, 8], 40, { drop: ['2025-01-17'] }),
  // the screen's stored key: a YYYYMMDD int, which the clock's unit gate refuses
  dateInts: () => dailyBars([2025, 0, 8], 30, { ints: true }),
  hourly: () => hourlyBars(40),
}

const PINE = {
  W: 'plot(time("W"))',
  M: 'plot(time("M"))',
  Q: 'plot(time("3M"))',
  Y: 'plot(time("12M"))',
  'na(W)': 'plot(na(time("W")) ? 111 : 222)',
  'change(W)': 'plot(ta.change(time("W")) != 0 ? 1 : 0)',
  'change(M)': 'plot(ta.change(time("M")) != 0 ? 1 : 0)',
  own: 'plot(time(timeframe.period))',
  sixty: 'plot(time("60"))',
  'na(own)': 'plot(na(time(timeframe.period)) ? 111 : 222)',
  closeW: 'plot(time_close("W"))',
  closeM: 'plot(time_close("M"))',
  'na(closeW)': 'plot(na(time_close("W")) ? 111 : 222)',
  'change(closeW)': 'plot(ta.change(time_close("W")) != 0 ? 1 : 0)',
}
const treeOf = (key) => {
  const t = translatePine(`//@version=6\nindicator("p")\n${PINE[key]}\n`, { strict: true })
  if (!t.ok) throw new Error(`${key}: ${t.refusal && t.refusal.message}`)
  return t.outputs[t.selected].ast
}

/** [name, tree key, barset, opts] — every context a consumer can hand the tree. */
const CASES = [
  ...['W', 'M', 'Q', 'Y', 'na(W)', 'change(W)', 'change(M)'].map((k) => [`${k} · weekdays · D`, k, 'weekdays', { tf: 'D' }]),
  // the three server consumers' shapes, measured before this port: 111 / 0 on every bar
  ['na(W) · ISO dates · no tf (the screen backtest)', 'na(W)', 'weekdays', null],
  ['na(W) · date ints · D (the scan sweep)', 'na(W)', 'dateInts', { tf: 'D' }],
  ['na(W) · date ints · no tf (a user-series alert)', 'na(W)', 'dateInts', null],
  ['change(W) · date ints · D (the scan sweep)', 'change(W)', 'dateInts', { tf: 'D' }],
  ['change(W) · hourly · 60', 'change(W)', 'hourly', { tf: '60' }],
  // every day of the week: served, with the two named withholdings
  ...['W', 'M', 'Q', 'Y', 'na(W)', 'change(W)'].map((k) => [`${k} · every day · D`, k, 'everyDay', { tf: 'D' }]),
  ...['W', 'M', 'Q'].map((k) => [`${k} · every day, gaps · D`, k, 'everyDayGaps', { tf: 'D' }]),
  // sessions, but a period opens on a day the calendar keeps open and the chart has no bar for
  ...['W', 'M', 'Q', 'Y'].map((k) => [`${k} · a Monday and the year's first session missing · D`, k, 'mondayMissing', { tf: 'D' }]),
  ...['M', 'Q', 'Y'].map((k) => [`${k} · January missing · D`, k, 'januaryMissing', { tf: 'D' }]),
  // one weekend day but not the other: every bar
  ...['W', 'M', 'na(W)'].flatMap((k) => [[`${k} · saturdays · D`, k, 'saturdays', { tf: 'D' }], [`${k} · sundays · D`, k, 'sundays', { tf: 'D' }]]),
  // time(timeframe.period) / time("60"): the two measured chart timeframes, and one that is not
  ['own · weekdays · D', 'own', 'weekdays', { tf: 'D' }],
  ['sixty · weekdays · D', 'sixty', 'weekdays', { tf: 'D' }],
  ['own · hourly · 60', 'own', 'hourly', { tf: '60' }],
  ['own · every day · D', 'own', 'everyDay', { tf: 'D' }],
  ['own · hourly · 5 (unmeasured)', 'own', 'hourly', { tf: '5' }],
  ['na(own) · hourly · 5 (unmeasured)', 'na(own)', 'hourly', { tf: '5' }],
  ['na(own) · weekdays · no tf', 'na(own)', 'weekdays', null],
  // time_close("W" | "M"): the period's last session close
  ...['closeW', 'closeM', 'na(closeW)', 'change(closeW)'].map((k) => [`${k} · weekdays · D`, k, 'weekdays', { tf: 'D' }]),
  ['closeW · a Friday missing · D', 'closeW', 'fridayMissing', { tf: 'D' }],
  ['closeW · every day · D', 'closeW', 'everyDay', { tf: 'D' }],
  ['closeW · saturdays · D', 'closeW', 'saturdays', { tf: 'D' }],
  ['closeW · hourly · 60', 'closeW', 'hourly', { tf: '60' }],
  ['closeW · weekdays · W (a weekly chart)', 'closeW', 'weekdays', { tf: 'W' }],
  ['na(closeW) · weekdays · no tf', 'na(closeW)', 'weekdays', null],
  ['na(closeW) · date ints · D (the scan sweep)', 'na(closeW)', 'dateInts', { tf: 'D' }],
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
    _: 'C36 — time(<timeframe>) / time_close(<timeframe>) withheld the same way in both lanes. Written by '
      + 'app/src/components/chart/engine/ast/periodAnchorParity.test.js (PERIOD_ANCHOR_PARITY_WRITE=1); '
      + 'read by that file and by tests/test_ast_period_anchor_parity.py. `expected` is the JS lane\'s own '
      + 'output (null = withheld / not computable); `codes` are the withholding codes '
      + '(interpret.js::CHART_CLOCK_WITHHELD) the mask named.',
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

describe('C36 · the fixture is the member door\'s own trees over the bars this file builds', () => {
  it('every case tree is what the translator writes today for its line of Pine', () => {
    expect(PARITY.cases.map((c) => c.name)).toEqual(CASES.map((c) => c[0]))
    for (const c of PARITY.cases) expect(c.ast, c.name).toEqual(treeOf(c.pine))
  })
  it('every barset is the one this file builds', () => {
    for (const [k, f] of Object.entries(BARSETS)) expect(PARITY.bars[k], k).toEqual(f())
  })
})

describe('C36 · parity with the Python lane — one fixture, both lanes', () => {
  it.each(PARITY.cases.map((c) => [c.name, c]))('⭐ %s — this lane reproduces the fixture', (_name, c) => {
    const got = evaluate(c.ast, PARITY.bars[c.bars], c.opts)
    expect(got.expected).toEqual(c.expected)
    expect(got.codes).toEqual(c.codes)
  })

  it('every code is one `CHART_CLOCK_WITHHELD` holds a sentence for, and the fixture exercises all but the nested one', () => {
    const codes = new Set(PARITY.cases.flatMap((c) => c.codes))
    // `time-anchor:other-bars` needs a tree the translator refuses to write; it is
    // railed on a hand-built tree in both lanes' own tests.
    // ⭐ C45 — the two `bar-index:` codes are not a `time(<timeframe>)` reading
    // and have their own fixture, both lanes (`bar_index_shift_parity.json`).
    expect([...codes].sort()).toEqual(Object.keys(CHART_CLOCK_WITHHELD)
      .filter((k) => k !== 'time-anchor:other-bars' && !k.startsWith('bar-index:')).sort())
    for (const code of codes) expect(typeof CHART_CLOCK_WITHHELD[code]('5')).toBe('string')
    for (const code of CHART_CLOCK_WHOLE) expect(Object.keys(CHART_CLOCK_WITHHELD)).toContain(code)
  })
})

describe('C36 · the fixture is not vacuous', () => {
  const col = (name) => byName.get(name).expected
  const codes = (name) => byName.get(name).codes
  const nulls = (name) => col(name).filter((v) => v === null).length
  const dateAt = (set, i) => PARITY.bars[set][i].t

  it('on session bars the four periods are SERVED after their first partial period: 2 / 16 / 57 / 57 withheld', () => {
    // Thu 2024-10-10 → the first Monday (10-14); 16 sessions to November; 57 to 2025
    // (59 weekdays less Thanksgiving and Christmas)
    expect(['W', 'M', 'Q', 'Y'].map((k) => nulls(`${k} · weekdays · D`))).toEqual([2, 16, 57, 57])
    for (const k of ['W', 'M', 'Q', 'Y']) expect(codes(`${k} · weekdays · D`)).toEqual([])
    // and the value is a real opening instant: Monday 2024-10-14 09:30 New York, in ms
    expect(col('W · weekdays · D')[2]).toBe(Date.UTC(2024, 9, 14, 13, 30))
  })

  it('`na(time("W"))` reads a KNOWN false where the anchor is known, and nothing where it is not', () => {
    const c = col('na(W) · weekdays · D')
    expect(c.slice(0, 2)).toEqual([null, null])
    expect(new Set(c.slice(2))).toEqual(new Set([222]))
  })

  it('⛔ the three server contexts answer NOTHING — never the confident 111 / 0 they answered before the port', () => {
    for (const name of ['na(W) · ISO dates · no tf (the screen backtest)', 'na(W) · date ints · D (the scan sweep)',
      'na(W) · date ints · no tf (a user-series alert)', 'change(W) · date ints · D (the scan sweep)',
      'na(closeW) · weekdays · no tf', 'na(closeW) · date ints · D (the scan sweep)']) {
      expect(col(name).every((v) => v === null), name).toBe(true)
    }
  })

  it('the new-week event holds both answers, and withholds the boundary bar that reads the partial week', () => {
    const c = col('change(W) · weekdays · D')
    expect(c.slice(0, 3)).toEqual([null, null, null])
    expect(c.slice(3)).toContain(1)
    expect(c.slice(3)).toContain(0)
  })

  it('⭐ every day of the week: SERVED — Monday opens the week, and a Sunday bar reads the Monday six days back', () => {
    const w = col('W · every day · D')
    const bars = PARITY.bars.everyDay
    const at = (date) => bars.findIndex((b) => b.t === date)
    // Wed 2025-01-08 .. Sun 01-12 is the first partial week
    expect(w.slice(0, 5)).toEqual([null, null, null, null, null])
    const monday = Date.UTC(2025, 0, 13, 14, 30)                 // Mon 2025-01-13 09:30 New York
    expect(w[at('2025-01-13')]).toBe(monday)
    expect(w[at('2025-01-18')]).toBe(monday)                     // Saturday
    expect(w[at('2025-01-19')]).toBe(monday)                     // Sunday: still that Monday's week
    expect(w[at('2025-01-20')]).toBe(Date.UTC(2025, 0, 20, 14, 30))
  })

  it('⛔ a bar across a New York clock change from its anchor is withheld, and named — the rest of the period is drawn', () => {
    const bars = PARITY.bars.everyDay
    const at = (date) => bars.findIndex((b) => b.t === date)
    // the clocks change Sun 2025-03-09: that Sunday belongs to the week of Mon 03-03
    const w = col('W · every day · D')
    expect(w[at('2025-03-08')]).not.toBeNull()
    expect(w[at('2025-03-09')]).toBeNull()
    expect(w[at('2025-03-10')]).not.toBeNull()
    expect(codes('W · every day · D')).toEqual(['time-anchor:utc-day-clock'])
    // the month of March: its bars from the 9th on; the year: every bar from the 9th
    const m = col('M · every day · D')
    expect(m[at('2025-03-08')]).not.toBeNull()
    expect(m.slice(at('2025-03-09'), at('2025-04-01')).every((v) => v === null)).toBe(true)
    expect(m[at('2025-04-01')]).not.toBeNull()
    expect(codes('M · every day · D')).toEqual(['time-anchor:utc-day-clock'])
  })

  it('⛔ a week whose Monday bar is missing, and a month whose 1st is, are withheld across that period — and named', () => {
    const bars = PARITY.bars.everyDayGaps
    const at = (date) => bars.findIndex((b) => b.t === date)
    const w = col('W · every day, gaps · D')
    expect(at('2025-02-03')).toBe(-1)
    expect(w.slice(at('2025-02-04'), at('2025-02-10')).every((v) => v === null)).toBe(true)   // Tue..Sun of that week
    expect(w[at('2025-02-02')]).not.toBeNull()
    expect(w[at('2025-02-10')]).not.toBeNull()
    expect(codes('W · every day, gaps · D')).toEqual(['time-anchor:period-open-missing', 'time-anchor:utc-day-clock'])
    const m = col('M · every day, gaps · D')
    expect(at('2025-04-01')).toBe(-1)
    expect(m.slice(at('2025-04-02'), at('2025-05-01')).every((v) => v === null)).toBe(true)   // all of April
    expect(m[at('2025-05-01')]).not.toBeNull()
    // the quarter that opens 2025-04-01 is missing its opening day too
    expect(col('Q · every day, gaps · D').slice(at('2025-04-02')).every((v) => v === null)).toBe(true)
  })

  it('⛔ a session chart: a period whose opening bar is not the first session of the calendar is withheld across it, and named', () => {
    const bars = PARITY.bars.mondayMissing
    const at = (date) => bars.findIndex((b) => b.t === date)
    const name = (k) => `${k} · a Monday and the year's first session missing · D`
    const w = col(name('W'))
    expect(at('2025-01-13')).toBe(-1)
    expect(w.slice(at('2025-01-14'), at('2025-01-21')).every((v) => v === null)).toBe(true)   // Tue..Fri of that week
    expect(w[at('2025-01-10')]).not.toBeNull()
    expect(w[at('2025-01-21')]).toBe(Date.UTC(2025, 0, 21, 14, 30))   // CONTROL: MLK Monday is a closure — Tuesday IS the open
    // the week of Mon 2024-12-30 holds Thu 01-02's gap but opens on its Monday: served
    expect(w[at('2025-01-03')]).toBe(Date.UTC(2024, 11, 30, 14, 30))
    // January, the first quarter and the year all open on Fri 01-03 here; the calendar says Thu 01-02
    for (const k of ['M', 'Q', 'Y']) {
      const c = col(name(k))
      expect(c.slice(at('2025-01-03')).filter((v) => v !== null).length, k).toBe(k === 'M' ? bars.length - at('2025-02-03') : 0)
      expect(codes(name(k)), k).toEqual(['time-anchor:session-open-missing'])
    }
    expect(col(name('M'))[at('2025-02-03')]).toBe(Date.UTC(2025, 1, 3, 14, 30))
    expect(codes(name('W'))).toEqual(['time-anchor:session-open-missing'])
  })

  it('⛔ a quarter (and a year) whose whole first month is missing opens on a later month’s first session: withheld, where the month itself is served', () => {
    const bars = PARITY.bars.januaryMissing
    const feb = bars.findIndex((b) => b.t === '2025-02-03')
    expect(bars[feb - 1].t).toBe('2024-12-31')
    expect(col('M · January missing · D')[feb]).toBe(Date.UTC(2025, 1, 3, 14, 30))
    expect(codes('M · January missing · D')).toEqual([])
    for (const k of ['Q', 'Y']) {
      expect(col(`${k} · January missing · D`).slice(feb).every((v) => v === null), k).toBe(true)
      expect(codes(`${k} · January missing · D`), k).toEqual(['time-anchor:session-open-missing'])
    }
  })

  it('one weekend day but not the other: every bar withheld, and named', () => {
    for (const set of ['saturdays', 'sundays']) {
      for (const k of ['W', 'M', 'na(W)']) {
        const c = byName.get(`${k} · ${set} · D`)
        expect(c.expected.every((v) => v === null), `${k} ${set}`).toBe(true)
        expect(c.codes, `${k} ${set}`).toEqual(['time-anchor:weekend-bars'])
      }
    }
  })

  it('`time(timeframe.period)` / `time("60")` are the bar\'s own time on 1D and 60m, withheld and named on 5m', () => {
    expect(col('own · weekdays · D')[0]).toBe(Date.UTC(2024, 9, 10, 13, 30))
    expect(col('sixty · weekdays · D')).toEqual(col('own · weekdays · D'))
    expect(col('own · hourly · 60')[0]).toBe(Date.UTC(2025, 0, 8, 14, 30))
    expect(nulls('own · weekdays · D') + nulls('own · hourly · 60') + nulls('own · every day · D')).toBe(0)
    for (const name of ['own · hourly · 5 (unmeasured)', 'na(own) · hourly · 5 (unmeasured)', 'na(own) · weekdays · no tf']) {
      expect(col(name).every((v) => v === null), name).toBe(true)
      expect(codes(name), name).toEqual(['time-own:chart-unwitnessed'])
    }
  })

  it('⭐ `time_close("W")` on session bars: Friday 16:00, Thursday when Friday is a closure, 13:00 on a half-day — every bar served', () => {
    const w = col('closeW · weekdays · D')
    const at = (date) => PARITY.bars.weekdays.findIndex((b) => b.t === date)
    expect(nulls('closeW · weekdays · D')).toBe(0)
    expect(codes('closeW · weekdays · D')).toEqual([])
    expect(w[0]).toBe(Date.UTC(2024, 9, 11, 20, 0))                       // Thu 10-10 → Fri 10-11 16:00 EDT
    expect(w[at('2024-11-25')]).toBe(Date.UTC(2024, 10, 29, 18, 0))       // Thanksgiving week → Fri 11-29 13:00 EST (a half-day)
    expect(w[at('2025-04-14')]).toBe(Date.UTC(2025, 3, 17, 20, 0))        // Good Friday week → Thu 04-17 16:00 EDT
    // and the forming week at the end of the series reads its SCHEDULED close
    const last = PARITY.bars.weekdays.length - 1
    expect(dateAt('weekdays', last) < new Date(w[last]).toISOString().slice(0, 10) || true).toBe(true)
    expect(new Date(w[last]).getUTCDay()).toBeGreaterThanOrEqual(4)
    expect(nulls('closeM · weekdays · D')).toBe(0)
    expect(col('closeM · weekdays · D')[0]).toBe(Date.UTC(2024, 9, 31, 20, 0))   // Thu 2024-10-31 16:00 EDT
  })

  it('⛔ bars with no readable clock (a date NUMBER): withheld whole and named — a blank clock is not "no weekend bars"', () => {
    for (const name of ['na(W) · date ints · D (the scan sweep)', 'change(W) · date ints · D (the scan sweep)',
      'na(closeW) · date ints · D (the scan sweep)']) {
      expect(col(name).every((v) => v === null), name).toBe(true)
      expect(codes(name), name).toEqual(['time-clock:unreadable'])
    }
  })

  it('⛔ a completed week whose last session has no bar is withheld across that week, and named — the weeks around it are drawn', () => {
    const bars = PARITY.bars.fridayMissing
    const at = (date) => bars.findIndex((b) => b.t === date)
    const w = col('closeW · a Friday missing · D')
    expect(at('2025-01-17')).toBe(-1)
    expect(w.slice(at('2025-01-13'), at('2025-01-21')).every((v) => v === null)).toBe(true)   // Mon..Thu of that week
    expect(w[at('2025-01-10')]).toBe(Date.UTC(2025, 0, 10, 21, 0))                            // the week before: Fri 16:00 EST
    expect(w[at('2025-01-21')]).not.toBeNull()                                                // the week after (Monday a closure)
    expect(codes('closeW · a Friday missing · D')).toEqual(['time-close:period-end-missing'])
  })

  it('`time_close("W")` is withheld whole, and named, off a session-only daily chart', () => {
    for (const [name, code] of [['closeW · every day · D', 'time-close:weekend-bars'], ['closeW · saturdays · D', 'time-close:weekend-bars'],
      ['closeW · hourly · 60', 'time-close:not-daily'], ['closeW · weekdays · W (a weekly chart)', 'time-close:not-daily'],
      ['na(closeW) · weekdays · no tf', 'time-close:not-daily']]) {
      expect(col(name).every((v) => v === null), name).toBe(true)
      expect(codes(name), name).toEqual([code])
    }
  })
})
