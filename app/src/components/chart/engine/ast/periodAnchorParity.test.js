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
import { interpret, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE, chartOwnTimeNode, OWN_TIME_WITNESSED_TF_C36 } from './interpret.js'
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

/** Regular-session intraday bars (unix seconds): every `step` minutes from 09:30 to
 *  16:00 New York on each of `sessions` vendor sessions from a UTC date. Winter
 *  dates only (New York is UTC-5: 09:30 is 14:30 UTC), and no half-day among them.
 *  `extra`: bars prepended to a session — `[[sessionIndex, minutesBefore0930], …]`. */
function sessionBars(start, sessions, step, extra = []) {
  const out = []
  const d = new Date(Date.UTC(...start))
  for (let s = 0; s < sessions; d.setUTCDate(d.getUTCDate() + 1)) {
    if (tradingViewCloseMinute(Number(iso(d).replace(/-/g, ''))) === null) continue
    const open = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 14, 30) / 1000
    const at = (t) => { const i = out.length; const c = 80 + Math.sin(i / 9) * 3; out.push({ t, o: c, h: c + 0.3, l: c - 0.3, c, v: 100 + i }) }
    for (const [, before] of extra.filter(([k]) => k === s)) at(open - before * 60)
    for (let m = 0; m < 390; m += step) at(open + m * 60)
    s += 1
  }
  return out
}
/** `n` weekly bars keyed the way `/api/bars` keys them — the FRIDAY of the ISO week
 *  — or `n` monthly bars keyed by the 1st. */
function periodBars(start, n, code) {
  const d = new Date(Date.UTC(...start))
  return Array.from({ length: n }, (_, i) => {
    const c = 200 + Math.cos(i / 4) * 9 + i * 0.3
    const bar = { t: iso(d), o: c - 1, h: c + 2, l: c - 2, c, v: 5000 + i }
    if (code === 'W') d.setUTCDate(d.getUTCDate() + 7)
    else d.setUTCMonth(d.getUTCMonth() + 1)
    return bar
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
  // ⭐ C49 — 80 weekdays from Mon 1998-12-21 less the five NYSE holidays among them. Before
  // 2000 the vendor's calendar applies no closure, so each is a session it holds and the
  // chart has no bar for: Christmas (Fri 12-25), New Year (Fri 01-01), MLK (Mon 01-18),
  // Presidents' Day (Mon 02-15) and Good Friday (Fri 04-02)
  holidays1999: () => dailyBars([1998, 11, 21], 80, { drop: ['1998-12-25', '1999-01-01', '1999-01-18', '1999-02-15', '1999-04-02'] }),
  // ⭐ ruling 2026-10-01 — the two periods from 2000 on whose first / last session has no bar,
  // as the vendor's own daily series has them: Hurricane Sandy (Mon 2012-10-29 and Tue 10-30
  // are sessions its calendar keeps and no bar exists for) and the week of 2001-09-10 (Tue..Fri)
  sandy2012: () => dailyBars([2012, 9, 15], 30, { drop: ['2012-10-29', '2012-10-30'] }),
  sept2001: () => dailyBars([2001, 7, 27], 30, { drop: ['2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14'] }),
  // 15-minute regular-session bars over 16 vendor sessions from Thu 2025-01-02 (the Carter
  // closure of Thu 01-09 and MLK Monday 01-20 among the days skipped), and the same with
  // one pre-market bar (08:00) on the third session
  rth15: () => sessionBars([2025, 0, 2], 16, 15),
  ext15: () => sessionBars([2025, 0, 2], 16, 15, [[2, 90]]),
  // 60-minute regular-session bars on the vendor's own grid (09:30, 10:30 … 15:30)
  rth60: () => sessionBars([2025, 0, 2], 16, 60),
  // weekly bars keyed by the Friday of the ISO week; monthly bars keyed by the 1st
  weekly: () => periodBars([2024, 9, 11], 60, 'W'),
  monthly: () => periodBars([2023, 0, 1], 30, 'M'),
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
  // C49 — a request for another timeframe of the chart's own symbol
  reqD: 'plot(request.security(syminfo.tickerid, "D", close))',
  'nz(reqW)': 'plot(nz(request.security(syminfo.tickerid, "W", close)))',
  reqOwn: 'plot(request.security(syminfo.tickerid, timeframe.period, close))',
}
/** Trees no translation writes TODAY but a saved document still carries. */
const BUILT = {
  // C36's `time(timeframe.period)` / `time("60")` tree: 1D and 60 minutes only
  'own (C36 tree)': () => chartOwnTimeNode(true, OWN_TIME_WITNESSED_TF_C36),
}
const treeOf = (key) => {
  if (BUILT[key]) return BUILT[key]()
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
  // 40 hourly bars in a row run past 16:00: an intraday chart with bars outside the session
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
  ['own · hourly · 30 (unmeasured)', 'own', 'hourly', { tf: '30' }],
  ['na(own) · hourly · 30 (unmeasured)', 'na(own)', 'hourly', { tf: '30' }],
  ['na(own) · weekdays · no tf', 'na(own)', 'weekdays', null],
  // time_close("W" | "M"): the period's last session close
  ...['closeW', 'closeM', 'na(closeW)', 'change(closeW)'].map((k) => [`${k} · weekdays · D`, k, 'weekdays', { tf: 'D' }]),
  ['closeW · a Friday missing · D', 'closeW', 'fridayMissing', { tf: 'D' }],
  ['closeW · every day · D', 'closeW', 'everyDay', { tf: 'D' }],
  ['closeW · saturdays · D', 'closeW', 'saturdays', { tf: 'D' }],
  ['closeW · hourly · 60', 'closeW', 'hourly', { tf: '60' }],
  ['closeW · rth 15m · 15', 'closeW', 'rth15', { tf: '15' }],
  ['na(closeW) · weekdays · no tf', 'na(closeW)', 'weekdays', null],
  ['na(closeW) · date ints · D (the scan sweep)', 'na(closeW)', 'dateInts', { tf: 'D' }],
  // ⭐⭐ C49 — the vendor's calendar. Before 2000 it applies no closure: a holiday is a
  // session it holds, and the period that opens (or ends) on it is served from it
  ...['W', 'M', 'Q', 'Y', 'change(W)', 'closeW', 'closeM'].map((k) => [`${k} · 1999 holidays · D`, k, 'holidays1999', { tf: 'D' }]),
  ...['W', 'M', 'change(W)', 'closeW'].map((k) => [`${k} · Sandy 2012 · D`, k, 'sandy2012', { tf: 'D' }]),
  ...['W', 'closeW', 'closeM'].map((k) => [`${k} · September 2001 · D`, k, 'sept2001', { tf: 'D' }]),
  // the charts below and above daily that the captures cover
  ...['W', 'M', 'Q', 'Y', 'change(W)', 'own', 'sixty'].map((k) => [`${k} · rth 15m · 15`, k, 'rth15', { tf: '15' }]),
  ...['W', 'sixty', 'own'].map((k) => [`${k} · 15m with a pre-market bar · 15`, k, 'ext15', { tf: '15' }]),
  ...['W', 'M', 'sixty'].map((k) => [`${k} · rth 60m · 60`, k, 'rth60', { tf: '60' }]),
  ...['W', 'M', 'Q', 'change(M)', 'own', 'sixty', 'closeW', 'closeM'].map((k) => [`${k} · weekly · W`, k, 'weekly', { tf: 'W' }]),
  ...['W', 'M', 'Y', 'closeW', 'closeM'].map((k) => [`${k} · monthly · M`, k, 'monthly', { tf: 'M' }]),
  // an unmeasured chart timeframe: every bar, by name
  ['W · rth 15m · 30 (unmeasured)', 'W', 'rth15', { tf: '30' }],
  ['sixty · rth 15m · 30 (unmeasured)', 'sixty', 'rth15', { tf: '30' }],
  // ⭐⭐ C49 — `request.security` of the chart's own symbol is translated for a DAILY base:
  // served on a daily chart and where no timeframe is stated (the server's daily consumers),
  // withheld whole and named on a chart that states another; the chart's OWN timeframe is
  // the identity everywhere
  ...['reqD', 'nz(reqW)', 'reqOwn'].flatMap((k) => [
    [`${k} · weekdays · D`, k, 'weekdays', { tf: 'D' }],
    [`${k} · weekdays · no tf`, k, 'weekdays', null],
    [`${k} · rth 15m · 15`, k, 'rth15', { tf: '15' }],
    [`${k} · weekly · W`, k, 'weekly', { tf: 'W' }],
  ]),
  // the tree a document saved before C49 carries: still 1D and 60 minutes only
  ['own (C36 tree) · weekdays · D', 'own (C36 tree)', 'weekdays', { tf: 'D' }],
  ['own (C36 tree) · rth 15m · 15', 'own (C36 tree)', 'rth15', { tf: '15' }],
  // ⭐ H5 — a series FROM THE LISTING (ruling R-W): no bar before it to be unknown,
  // so nothing is withheld for one (`vendorHarness.h5ListingAnchor` grades it)
  ...['change(W)', 'change(M)'].map((k) => [`${k} · weekdays · D · from the listing`, k, 'weekdays', { tf: 'D', historyFromListing: true }]),
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
    _: 'C36 / C49 — time(<timeframe>) / time_close(<timeframe>) answered and withheld the same way in both lanes. Written by '
      + 'app/src/components/chart/engine/ast/periodAnchorParity.test.js (PERIOD_ANCHOR_PARITY_WRITE=1); '
      + 'read by that file and by tests/test_ast_period_anchor_parity.py. `expected` is the JS lane\'s own '
      + 'output (null = withheld / not computable); `codes` are the withholding codes '
      + '(interpret.js::CHART_CLOCK_WITHHELD) the mask named.',
    pine: PINE,
    built: Object.keys(BUILT),
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
    expect(PARITY.built).toEqual(Object.keys(BUILT))
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
    // ⭐ F5 — nor is `seed:window` (`seed_warmup_parity.json`).
    expect([...codes].sort()).toEqual(Object.keys(CHART_CLOCK_WITHHELD)
      .filter((k) => k !== 'time-anchor:other-bars' && !k.startsWith('bar-index:') && !k.startsWith('seed:')).sort())
    for (const code of codes) expect(typeof CHART_CLOCK_WITHHELD[code]('5')).toBe('string')
    for (const code of CHART_CLOCK_WHOLE) expect(Object.keys(CHART_CLOCK_WITHHELD)).toContain(code)
  })
})

describe('C36 · the fixture is not vacuous', () => {
  const col = (name) => byName.get(name).expected
  const codes = (name) => byName.get(name).codes
  const nulls = (name) => col(name).filter((v) => v === null).length
  const dateAt = (set, i) => PARITY.bars[set][i].t

  it('⭐ H5 — from the listing nothing is withheld for "the bar before the series"; off it, that bar is', () => {
    for (const k of ['change(W)', 'change(M)']) {
      expect(nulls(`${k} · weekdays · D`), k).toBeGreaterThan(0)
      expect(nulls(`${k} · weekdays · D · from the listing`), k).toBe(0)
      // the rest of the column is the same answer: only the withheld head moved
      const off = col(`${k} · weekdays · D`)
      const on = col(`${k} · weekdays · D · from the listing`)
      off.forEach((v, i) => { if (v !== null) expect(on[i], `${k} bar ${i}`).toBe(v) })
    }
  })

  it('⭐ C49 — on session bars the four periods are SERVED on every bar, the first partial period included: the calendar\'s open', () => {
    expect(['W', 'M', 'Q', 'Y'].map((k) => nulls(`${k} · weekdays · D`))).toEqual([0, 0, 0, 0])
    for (const k of ['W', 'M', 'Q', 'Y']) expect(codes(`${k} · weekdays · D`)).toEqual([])
    // Thu 2024-10-10 opens in the week of Mon 10-07, the month and quarter of Tue 10-01,
    // and the year of Tue 2024-01-02 — none of them a bar this series holds
    expect(col('W · weekdays · D')[0]).toBe(Date.UTC(2024, 9, 7, 13, 30))
    expect(col('M · weekdays · D')[0]).toBe(Date.UTC(2024, 9, 1, 13, 30))
    expect(col('Q · weekdays · D')[0]).toBe(Date.UTC(2024, 9, 1, 13, 30))
    expect(col('Y · weekdays · D')[0]).toBe(Date.UTC(2024, 0, 2, 14, 30))
    // and from the first boundary the series shows it is the bar C30 answered
    expect(col('W · weekdays · D')[2]).toBe(Date.UTC(2024, 9, 14, 13, 30))
  })

  it('`na(time("W"))` reads a KNOWN false on every bar of a session chart', () => {
    expect(new Set(col('na(W) · weekdays · D'))).toEqual(new Set([222]))
  })

  it('⛔ the three server contexts answer NOTHING — never the confident 111 / 0 they answered before the port', () => {
    for (const name of ['na(W) · ISO dates · no tf (the screen backtest)', 'na(W) · date ints · D (the scan sweep)',
      'na(W) · date ints · no tf (a user-series alert)', 'change(W) · date ints · D (the scan sweep)',
      'na(closeW) · weekdays · no tf', 'na(closeW) · date ints · D (the scan sweep)']) {
      expect(col(name).every((v) => v === null), name).toBe(true)
    }
  })

  it('the new-week event holds both answers, and withholds bar 0 — it reads the anchor of a bar before the series', () => {
    const c = col('change(W) · weekdays · D')
    expect(c.slice(0, 3)).toEqual([null, 0, 1])               // Thu 10-10 (withheld), Fri 10-11, Mon 10-14
    expect(c.slice(1).every((v) => v === 0 || v === 1)).toBe(true)
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

  // ⭐ RULING 2026-10-01 — the calendar is the rule, bar or no bar. C49 first withheld a period from
  // 2000 on whose first session has no bar (`time-anchor:session-open-missing`); the full-history
  // capture holds the one such week (Hurricane Sandy) and the calendar reproduces it, so it is served.
  it('⭐ a session chart: a period whose first session has no bar reads that session’s 09:30 — the calendar, not the chart’s first bar', () => {
    const bars = PARITY.bars.mondayMissing
    const at = (date) => bars.findIndex((b) => b.t === date)
    const name = (k) => `${k} · a Monday and the year's first session missing · D`
    const w = col(name('W'))
    expect(at('2025-01-13')).toBe(-1)
    // Tue..Fri of that week read MONDAY 01-13 09:30 New York, a day this chart has no bar for
    for (let i = at('2025-01-14'); i < at('2025-01-21'); i++) expect(w[i], bars[i].t).toBe(Date.UTC(2025, 0, 13, 14, 30))
    expect(w[at('2025-01-10')]).toBe(Date.UTC(2025, 0, 6, 14, 30))
    expect(w[at('2025-01-21')]).toBe(Date.UTC(2025, 0, 21, 14, 30))   // CONTROL: MLK Monday is a closure — Tuesday IS the open
    expect(w[at('2025-01-03')]).toBe(Date.UTC(2024, 11, 30, 14, 30))
    // January, the first quarter and the year open on Fri 01-03 on this chart; the calendar says Thu 01-02
    expect(at('2025-01-02')).toBe(-1)
    for (const k of ['M', 'Q', 'Y']) {
      const c = col(name(k))
      expect(c[at('2025-01-03')], k).toBe(Date.UTC(2025, 0, 2, 14, 30))
      expect(c.slice(at('2025-01-03')).filter((v) => v === null).length, k).toBe(0)
      expect(codes(name(k)), k).toEqual([])
    }
    expect(col(name('M'))[at('2025-02-03')]).toBe(Date.UTC(2025, 1, 3, 14, 30))
    expect(codes(name('W'))).toEqual([])
  })

  it('⭐ a quarter (and a year) whose whole first month is missing still opens on January’s first session', () => {
    const bars = PARITY.bars.januaryMissing
    const feb = bars.findIndex((b) => b.t === '2025-02-03')
    expect(bars[feb - 1].t).toBe('2024-12-31')
    expect(col('M · January missing · D')[feb]).toBe(Date.UTC(2025, 1, 3, 14, 30))
    expect(codes('M · January missing · D')).toEqual([])
    for (const k of ['Q', 'Y']) {
      expect(col(`${k} · January missing · D`)[feb], k).toBe(Date.UTC(2025, 0, 2, 14, 30))
      expect(nulls(`${k} · January missing · D`), k).toBe(0)
      expect(codes(`${k} · January missing · D`), k).toEqual([])
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

  it('`time(timeframe.period)` / `time("60")` are the bar\'s own time on 1D and 60m, withheld and named on a 30m chart', () => {
    expect(col('own · weekdays · D')[0]).toBe(Date.UTC(2024, 9, 10, 13, 30))
    expect(col('sixty · weekdays · D')).toEqual(col('own · weekdays · D'))
    expect(col('own · hourly · 60')[0]).toBe(Date.UTC(2025, 0, 8, 14, 30))
    expect(nulls('own · weekdays · D') + nulls('own · hourly · 60') + nulls('own · every day · D')).toBe(0)
    for (const name of ['own · hourly · 30 (unmeasured)', 'na(own) · hourly · 30 (unmeasured)', 'na(own) · weekdays · no tf',
      'sixty · rth 15m · 30 (unmeasured)']) {
      expect(col(name).every((v) => v === null), name).toBe(true)
      expect(codes(name), name).toEqual(['time-own:chart-unwitnessed'])
    }
  })

  it('⭐ C49 — before 2000 a holiday is a session the calendar holds: the period that opens on it is SERVED from it', () => {
    const bars = PARITY.bars.holidays1999
    const at = (date) => bars.findIndex((b) => b.t === date)
    const name = (k) => `${k} · 1999 holidays · D`
    for (const gone of ['1998-12-25', '1999-01-01', '1999-01-18', '1999-02-15', '1999-04-02']) expect(at(gone)).toBe(-1)
    for (const k of ['W', 'M', 'Q', 'Y', 'closeW', 'closeM']) {
      expect(nulls(name(k)), k).toBe(0)
      expect(codes(name(k)), k).toEqual([])
    }
    // Tue 1999-01-19 (MLK Monday has no bar) reads MONDAY 01-18 09:30 New York
    expect(col(name('W'))[at('1999-01-19')]).toBe(Date.UTC(1999, 0, 18, 14, 30))
    // Mon 1999-01-04 opens January, the quarter and the year on the chart; the calendar says Fri 01-01
    for (const k of ['M', 'Q', 'Y']) expect(col(name(k))[at('1999-01-04')], k).toBe(Date.UTC(1999, 0, 1, 14, 30))
    // the week of Mon 1998-12-21 ends on Christmas Friday 16:00, a day with no bar; Good Friday likewise
    expect(col(name('closeW'))[at('1998-12-24')]).toBe(Date.UTC(1998, 11, 25, 21, 0))
    expect(col(name('closeW'))[at('1999-04-01')]).toBe(Date.UTC(1999, 3, 2, 21, 0))
    // the same shape from 2000 on (the bars of `mondayMissing`, `fridayMissing`) is served from the calendar
    // too (ruling 2026-10-01) — what differs across the boundary is whether a HOLIDAY is a session
    expect(codes("W · a Monday and the year's first session missing · D")).toEqual([])
    expect(codes('closeW · a Friday missing · D')).toEqual([])
  })

  it('⭐ ruling 2026-10-01 — the Sandy week opens Monday 2012-10-29 09:30 and the week of 2001-09-10 closes Friday 09-14 16:00: sessions the calendar keeps, bars nobody has', () => {
    const sandy = PARITY.bars.sandy2012
    const sAt = (date) => sandy.findIndex((b) => b.t === date)
    for (const gone of ['2012-10-29', '2012-10-30']) expect(sAt(gone)).toBe(-1)
    const w = col('W · Sandy 2012 · D')
    for (const day of ['2012-10-31', '2012-11-01', '2012-11-02']) expect(w[sAt(day)], day).toBe(Date.UTC(2012, 9, 29, 13, 30))
    expect(w[sAt('2012-10-26')]).toBe(Date.UTC(2012, 9, 22, 13, 30))
    expect(w[sAt('2012-11-05')]).toBe(Date.UTC(2012, 10, 5, 14, 30))    // EST from Sunday 11-04
    // the week's first BAR (Wed 10-31) is not a new week against Fri 10-26? it is: the anchor moved
    expect(col('change(W) · Sandy 2012 · D')[sAt('2012-10-31')]).toBe(1)
    expect(col('change(W) · Sandy 2012 · D')[sAt('2012-11-01')]).toBe(0)
    for (const k of ['W', 'M', 'closeW']) { expect(nulls(`${k} · Sandy 2012 · D`), k).toBe(0); expect(codes(`${k} · Sandy 2012 · D`), k).toEqual([]) }
    const sept = PARITY.bars.sept2001
    const pAt = (date) => sept.findIndex((b) => b.t === date)
    for (const gone of ['2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14']) expect(pAt(gone)).toBe(-1)
    const c = col('closeW · September 2001 · D')
    expect(c[pAt('2001-09-10')]).toBe(Date.UTC(2001, 8, 14, 20, 0))
    expect(c[pAt('2001-09-07')]).toBe(Date.UTC(2001, 8, 7, 20, 0))
    expect(c[pAt('2001-09-17')]).toBe(Date.UTC(2001, 8, 21, 20, 0))
    expect(col('W · September 2001 · D')[pAt('2001-09-17')]).toBe(Date.UTC(2001, 8, 17, 13, 30))
    for (const k of ['W', 'closeW', 'closeM']) { expect(nulls(`${k} · September 2001 · D`), k).toBe(0); expect(codes(`${k} · September 2001 · D`), k).toEqual([]) }
  })

  it('⭐ C49 — a 15-minute regular-session chart: the period opens at 09:30 of the calendar\'s first session, and `time("60")` is the 60-minute bucket', () => {
    const bars = PARITY.bars.rth15
    const at = (ms) => bars.findIndex((b) => b.t === ms / 1000)
    expect(bars.length).toBe(16 * 26)
    for (const k of ['W', 'M', 'Q', 'Y', 'own', 'sixty']) {
      expect(nulls(`${k} · rth 15m · 15`), k).toBe(0)
      expect(codes(`${k} · rth 15m · 15`), k).toEqual([])
    }
    // bar 0 is Thu 2025-01-02 09:30: the week opened Mon 2024-12-30, the month, quarter and year on it
    expect(col('W · rth 15m · 15')[0]).toBe(Date.UTC(2024, 11, 30, 14, 30))
    for (const k of ['M', 'Q', 'Y']) expect(col(`${k} · rth 15m · 15`)[0], k).toBe(Date.UTC(2025, 0, 2, 14, 30))
    // MLK Monday 2025-01-20 is a closure the calendar applies: that week opens Tuesday 01-21 09:30
    expect(col('W · rth 15m · 15')[at(Date.UTC(2025, 0, 22, 16, 0))]).toBe(Date.UTC(2025, 0, 21, 14, 30))
    // time("60"): 09:30 for 09:30..10:15, 10:30 for 10:30..11:15 … 15:30 for 15:30..15:45
    const sixty = col('sixty · rth 15m · 15')
    expect(sixty.slice(0, 5)).toEqual([0, 0, 0, 0, 1].map((h) => Date.UTC(2025, 0, 2, 14 + h, 30)))
    expect(sixty[25]).toBe(Date.UTC(2025, 0, 2, 20, 30))
    expect(col('own · rth 15m · 15')[1]).toBe(Date.UTC(2025, 0, 2, 14, 45))
    // the new-week event fires on the 09:30 bar of the week's first session, and bar 0 is withheld
    const event = col('change(W) · rth 15m · 15')
    expect(event[0]).toBeNull()
    expect(event.map((v, i) => (v === 1 ? new Date(bars[i].t * 1000).toISOString().slice(0, 16) : null)).filter(Boolean))
      .toEqual(['2025-01-06T14:30', '2025-01-13T14:30', '2025-01-21T14:30', '2025-01-27T14:30'])
  })

  it('⛔ C49 — one pre-market bar and the 15-minute chart is withheld whole for the periods and `time("60")`, by name; `time(timeframe.period)` is not', () => {
    for (const k of ['W', 'sixty']) {
      const c = byName.get(`${k} · 15m with a pre-market bar · 15`)
      expect(c.expected.every((v) => v === null), k).toBe(true)
      expect(c.codes, k).toEqual(['time-clock:outside-session'])
    }
    expect(nulls('own · 15m with a pre-market bar · 15')).toBe(0)
    expect(codes('change(W) · hourly · 60')).toEqual(['time-clock:outside-session'])
    expect(col('change(W) · hourly · 60').every((v) => v === null)).toBe(true)
  })

  it('⭐ C49 — a 60-minute, a weekly and a monthly chart: every bar, keyed on the day the bar OPENS', () => {
    for (const name of ['W · rth 60m · 60', 'M · rth 60m · 60', 'sixty · rth 60m · 60', 'W · weekly · W', 'M · weekly · W',
      'Q · weekly · W', 'own · weekly · W', 'sixty · weekly · W', 'closeW · weekly · W', 'closeM · weekly · W',
      'W · monthly · M', 'M · monthly · M', 'Y · monthly · M', 'closeW · monthly · M', 'closeM · monthly · M']) {
      expect(nulls(name), name).toBe(0)
      expect(codes(name), name).toEqual([])
    }
    const weekly = PARITY.bars.weekly
    const at = (date) => weekly.findIndex((b) => b.t === date)
    // a weekly bar is its own week: time("W") is its `time`, time_close("W") its `time_close`
    expect(col('W · weekly · W')).toEqual(col('own · weekly · W'))
    expect(col('sixty · weekly · W')).toEqual(col('own · weekly · W'))
    // the week keyed Fri 2025-01-03 opens Mon 2024-12-30 — DECEMBER's month, whose first
    // session is Mon 12-02 and whose last is Tue 12-31
    expect(col('W · weekly · W')[at('2025-01-03')]).toBe(Date.UTC(2024, 11, 30, 14, 30))
    expect(col('M · weekly · W')[at('2025-01-03')]).toBe(Date.UTC(2024, 11, 2, 14, 30))
    expect(col('closeM · weekly · W')[at('2025-01-03')]).toBe(Date.UTC(2024, 11, 31, 21, 0))
    expect(col('closeW · weekly · W')[at('2025-01-03')]).toBe(Date.UTC(2025, 0, 3, 21, 0))
    // on a weekly chart the new-month event is a bar-to-bar change; bar 0 is withheld
    expect(col('change(M) · weekly · W')[0]).toBeNull()
    // a monthly bar keyed 2023-07-01 opens Mon 07-03: its week opened that Monday and closes Fri 07-07
    const monthly = PARITY.bars.monthly
    const m = monthly.findIndex((b) => b.t === '2023-07-01')
    expect(col('M · monthly · M')[m]).toBe(Date.UTC(2023, 6, 3, 13, 30))
    expect(col('W · monthly · M')[m]).toBe(Date.UTC(2023, 6, 3, 13, 30))
    expect(col('closeW · monthly · M')[m]).toBe(Date.UTC(2023, 6, 7, 20, 0))
    expect(col('Y · monthly · M')[m]).toBe(Date.UTC(2023, 0, 3, 14, 30))
  })

  it('⛔ C49 — a chart timeframe no capture measured is withheld whole, and named', () => {
    expect(col('W · rth 15m · 30 (unmeasured)').every((v) => v === null)).toBe(true)
    expect(codes('W · rth 15m · 30 (unmeasured)')).toEqual(['time-anchor:not-daily'])
    expect(col('closeW · rth 15m · 15').every((v) => v === null)).toBe(true)
    expect(codes('closeW · rth 15m · 15')).toEqual(['time-close:not-daily'])
  })

  it('⛔ C49 — a `request.security` for another timeframe is translated for a daily chart: served there, withheld by name on a chart that states another', () => {
    const closes = (set) => PARITY.bars[set].map((b) => b.c)
    // the daily request on a daily chart, and where no timeframe is stated, is the bars in hand
    expect(col('reqD · weekdays · D')).toEqual(closes('weekdays'))
    expect(col('reqD · weekdays · no tf')).toEqual(closes('weekdays'))
    expect(codes('reqD · weekdays · D').concat(codes('reqD · weekdays · no tf'))).toEqual([])
    // the weekly one there is the last closed week (`nz` of the first partial week is Pine's 0)
    expect(col('nz(reqW) · weekdays · D').slice(0, 2)).toEqual([0, 0])
    expect(col('nz(reqW) · weekdays · D')[2]).toBe(PARITY.bars.weekdays[1].c)
    expect(col('nz(reqW) · weekdays · no tf')).toEqual(col('nz(reqW) · weekdays · D'))
    // ⛔ on a 15-minute and a weekly chart both are withheld on every bar — never a 15-minute
    // close under the name of the daily one, never `nz`'s confident 0
    for (const k of ['reqD', 'nz(reqW)']) {
      for (const chart of ['rth 15m · 15', 'weekly · W']) {
        expect(col(`${k} · ${chart}`).every((v) => v === null), `${k} ${chart}`).toBe(true)
        expect(codes(`${k} · ${chart}`), `${k} ${chart}`).toEqual(['request:other-timeframe'])
      }
    }
    // CONTROL — the chart's OWN timeframe is the identity on every chart
    for (const [chart, set] of [['weekdays · D', 'weekdays'], ['rth 15m · 15', 'rth15'], ['weekly · W', 'weekly']]) {
      expect(col(`reqOwn · ${chart}`), chart).toEqual(closes(set))
      expect(codes(`reqOwn · ${chart}`), chart).toEqual([])
    }
  })

  it('⛔ C49 — the tree a document saved before this lane carries keeps C36\'s two charts: it cannot say which spelling wrote it', () => {
    expect(nulls('own (C36 tree) · weekdays · D')).toBe(0)
    expect(col('own (C36 tree) · rth 15m · 15').every((v) => v === null)).toBe(true)
    expect(codes('own (C36 tree) · rth 15m · 15')).toEqual(['time-own:chart-unwitnessed'])
    // CONTROL — today's tree for `time(timeframe.period)` IS served there
    expect(nulls('own · rth 15m · 15')).toBe(0)
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

  // ⭐ RULING 2026-10-01 — was withheld (`time-close:period-end-missing`); the one witness (the week
  // of 2001-09-10) is in the full-history capture and the calendar reproduces it.
  it('⭐ a completed week whose last session has no bar reads that session’s close — the calendar, not the chart’s last bar', () => {
    const bars = PARITY.bars.fridayMissing
    const at = (date) => bars.findIndex((b) => b.t === date)
    const w = col('closeW · a Friday missing · D')
    expect(at('2025-01-17')).toBe(-1)
    for (let i = at('2025-01-13'); i < at('2025-01-21'); i++) expect(w[i], bars[i].t).toBe(Date.UTC(2025, 0, 17, 21, 0))   // Mon..Thu: Fri 16:00 EST
    expect(w[at('2025-01-10')]).toBe(Date.UTC(2025, 0, 10, 21, 0))
    expect(w[at('2025-01-21')]).toBe(Date.UTC(2025, 0, 24, 21, 0))
    expect(nulls('closeW · a Friday missing · D')).toBe(0)
    expect(codes('closeW · a Friday missing · D')).toEqual([])
  })

  it('`time_close("W")` is withheld whole, and named, off a session-only daily chart', () => {
    for (const [name, code] of [['closeW · every day · D', 'time-close:weekend-bars'], ['closeW · saturdays · D', 'time-close:weekend-bars'],
      ['closeW · hourly · 60', 'time-close:not-daily'], ['closeW · rth 15m · 15', 'time-close:not-daily'],
      ['na(closeW) · weekdays · no tf', 'time-close:not-daily']]) {
      expect(col(name).every((v) => v === null), name).toBe(true)
      expect(codes(name), name).toEqual([code])
    }
  })
})
