// ─── ⭐⭐ C36 — WHAT C30 LEFT: weekend bars, the silent non-daily chart, the two
//     rows the probe asked that were never served, and `time_close(<tf>)` ────────
//
// C30 serves `time("W" | "M" | "3M" | "12M")` on a daily chart off
// `vw-time-tf-spy-1d-2026-09-28`. Five things were left, each a statement about
// what that capture does not show. The captures that settle them are all under
// `tests/fixtures/vendor/harness/`:
//
//  1. WEEKEND BARS — `vw-time-tf-bitstamp-btcusd-1d-2026-09-30` (5,491 daily bars,
//     every day of the week, 00:00 UTC). The week starts MONDAY (`time("W") − time`
//     reads 0 on a Monday bar and −6 on a Sunday bar), the month on the 1st. SERVED
//     on a chart whose daily bars cover every day of the week, less two things this
//     chart cannot reproduce, each withheld by name: a period whose calendar first
//     day has no bar (the vendor anchors to the calendar open — 19 / 22 / 75 bars),
//     and a bar across a New York clock change from its anchor (this chart stamps a
//     daily bar at 09:30 New York, the vendor at 00:00 UTC — 30 / 666 / 1,138 /
//     3,540 bars). Every bar that IS served equals TradingView.
//     And the same capture family showed the first-bar rule WRONG on a session
//     chart: the Hurricane Sandy week (`vw-time-close-tf-spy-1d-2026-09-30`).
//
//  2. THE SILENT NON-DAILY CHART — every withholding now names its reason, out of
//     the function that makes the decision (`interpret.js::periodAnchorMask` →
//     `nativeRegistry.chartClockReport`, the object reader's `chartClock`); the
//     binder publishes it to the member's disclosure strip
//     (`chartClockNotice.test.jsx`).
//
//  3. `time(timeframe.period)` AND `time("60")` — equal to `time` on 900 daily, 300
//     hourly and 5,491 every-day daily bars. Served on a 1D and a 60m chart.
//
//  5. `time_close("W" | "M")` — `vw-time-close-tf-spy-1d-2026-09-30` (4,800 bars):
//     the close of the period's last session, the forming period its SCHEDULED
//     close. Served on a session daily chart, every bar. On BTCUSD it is the next
//     period's open, which this chart's clock does not hold: withheld by name.
//
// (4 is the Python mirror: `ast/periodAnchorParity.test.js`.)
//
// ⭐⭐ C49 (2026-10-01) — RE-PINNED WHERE CAPTURE ROUND 3 MOVED THE RULE, each with
// its reason beside it. On a New York session chart `time(<period>)` /
// `time_close(<period>)` are the vendor's SESSION CALENDAR
// (`indicators.js::computePeriodCalendar`; `vendorHarness.c49CapturedClock.test.js`
// holds the captures), so: the first partial period is served; a pre-2000 holiday
// period is served from the calendar (it was withheld here as unmeasured); the
// 60-minute, 5-minute, weekly and monthly charts are served where C36 named them
// unmeasured; and `time("60")` has its own tree. What C36 found is unchanged where
// the captures did not move it: the BTCUSD every-day rows, one weekend day, a read
// of other bars, an unreadable clock, the Sandy week (still withheld, by name).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { validateCapture, sealCapture, sha256Hex } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { translatePine } from '../../ast/pine.js'
import {
  interpret, periodFirstCondition, periodAnchorMask, isPeriodAnchor, isChartOwnTime, isPeriodClose,
  chartOwnTimeNode, periodCloseNode, OWN_TIME_WITNESSED_TF, PERIOD_CLOSE_CODES, CHART_CLOCK_WITHHELD,
  OWN_TIME_WITNESSED_TF_C36, chartOwnTimeTfs, chartSixtyTimeNode, isChartSixtyTime,
} from '../../ast/interpret.js'
import { buildGraph } from '../../ast/graph.js'
import { computeObjectColumns } from '../../objectColumns'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
const D1 = load('vw-time-tf-spy-1d-2026-09-28.json')
const H60 = load('vw-time-tf-spy-60-2026-09-28.json')
const M5 = load('vw-clock-vwap-spy-5-ext-2026-09-28.json')
const LONG = load('vw-clock-close-tfchange-spy-1d-2026-09-28.json')
const W1 = load('vw-clock-close-tfchange-spy-1w-2026-09-28.json')
const BTC = load('vw-time-tf-bitstamp-btcusd-1d-2026-09-30.json')
const TC_SPY = load('vw-time-close-tf-spy-1d-2026-09-30.json')
const TC_BTC = load('vw-time-close-tf-bitstamp-btcusd-1d-2026-09-30.json')
// C49 — a chart timeframe NO capture of these probes measured (NYSE:RDDT, 240 minutes)
const R240 = load('vw-bar-counters-rddt-240-2026-09-30.json')

const pine = (lines) => ['//@version=6', 'indicator("c36", overlay=true)', ...lines].join('\n')
const on = (capture, src) => runOurSide({ ...capture, source: { ...capture.source, text: src } })
const column = (ours, i = 0) => Array.from(ours.plots[i].column)
const allNaN = (col) => col.length > 0 && col.every(Number.isNaN)
const noteCodes = (ours) => [...new Set(ours.notes.map((n) => (/withheld \(([a-z:-]+)\)/.exec(n) || [])[1]).filter(Boolean))].sort()
const vendor = (cap, title) => {
  const c = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
  return cap.plotValues.rows.map((r) => r[c])
}

/** The daily SPY capture plus a Saturday and / or a Sunday bar after every Friday.
 *  SYNTHETIC: it proves a withholding, never a value. */
function withWeekends(capture, keep, { sat = true, sun = true } = {}) {
  const rows = []
  for (const r of capture.bars.rows.slice(-keep)) {
    rows.push(r)
    const dow = new Date(r[0] * 1000).getUTCDay()
    if (dow === 5) {
      if (sat) rows.push([r[0] + 86400, ...r.slice(1)])
      if (sun) rows.push([r[0] + 2 * 86400, ...r.slice(1)])
    }
  }
  return { ...capture, bars: { ...capture.bars, rows } }
}
const SATURDAYS = withWeekends(D1, 160, { sun: false })
const SUNDAYS = withWeekends(D1, 160, { sat: false })
const WEEKDAYS = { ...D1, bars: { ...D1.bars, rows: D1.bars.rows.slice(-160) } }

/** A capture with the named plot rows cut from source and columns, re-sealed. */
function derive(capture, drop) {
  const text = capture.source.text.split('\n')
    .filter((l) => !drop.some((t) => l.includes(`"${t}"`)) && !l.startsWith('startTime ='))
    .join('\n')
  const plots = capture.study.plots.filter((p) => !drop.includes(p.title))
  const ids = new Set(plots.map((p) => p.id))
  const keep = capture.plotValues.fields.map((f, i) => ((f === 'time' || ids.has(f)) ? i : -1)).filter((i) => i >= 0)
  return sealCapture({
    ...capture,
    id: `${capture.id}-c36-derived`,
    source: { ...capture.source, text, sha256: sha256Hex(text), chars: text.length },
    study: { ...capture.study, plots },
    plotValues: { fields: keep.map((i) => capture.plotValues.fields[i]), rows: capture.plotValues.rows.map((r) => keep.map((i) => r[i])) },
  })
}
const T16 = ['T16_input_time_default_DAYS']                                   // `input.time`: its own wall
const TC_CUT = ['Q03_timeclose3M_minus_time_DAYS', 'Q04_timeclose12M_minus_time_DAYS',   // no quarterly bar
  'Q05_timecloseSelf_minus_timeclose_MUST_BE_0']                               // `time_close(timeframe.period)`: not served

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

// ── what the BTCUSD capture itself says, computed from ITS bars and nothing of ours ──
const BTC_DATES = BTC.bars.rows.map((r) => new Date(r[0] * 1000))
const utcParts = (d) => ({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay() })
/** New York's UTC offset, in hours, at 09:30 New York on a UTC calendar date. */
const nyOffset = (d) => {
  const noon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17))
  return 17 - Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(noon))
}
const BTC_PERIODS = {
  W: { key: (d) => Math.floor(d.getTime() / 86400000) - ((d.getUTCDay() + 6) % 7), first: (p) => p.dow === 1 },
  M: { key: (d) => d.getUTCFullYear() * 12 + d.getUTCMonth(), first: (p) => p.day === 1 },
  '3M': { key: (d) => d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3), first: (p) => p.day === 1 && (p.m - 1) % 3 === 0 },
  '12M': { key: (d) => d.getUTCFullYear(), first: (p) => p.day === 1 && p.m === 1 },
}
/** Per period: which bars the capture says this chart cannot answer, and why. */
function btcUnknown(period) {
  const { key, first } = BTC_PERIODS[period]
  const out = { partial: [], openMissing: [], clock: [], unknown: new Uint8Array(BTC_DATES.length) }
  let anchor = -1
  let calendarOpen = true
  for (let i = 0; i < BTC_DATES.length; i++) {
    if (i > 0 && key(BTC_DATES[i]) !== key(BTC_DATES[i - 1])) { anchor = i; calendarOpen = first(utcParts(BTC_DATES[i])) }
    if (anchor < 0) out.partial.push(i)
    else if (!calendarOpen) out.openMissing.push(i)
    else if (nyOffset(BTC_DATES[i]) !== nyOffset(BTC_DATES[anchor])) out.clock.push(i)
    else continue
    out.unknown[i] = 1
  }
  return out
}
const reachOne = (unknown) => unknown.reduce((n, u, i) => n + (u || (i > 0 && unknown[i - 1]) ? 1 : 0), 0)

describe('C36 · 1 — BITSTAMP:BTCUSD 1D, every day of the week: served, date for date against TradingView', () => {
  const derived = derive(BTC, T16)
  const { verdict, integrity } = gradeCapture(derived)
  const byTitle = new Map(verdict.plots.map((p) => [p.title, p]))
  const ours = runOurSide(derived)
  const ourCol = (title) => Array.from(ours.plots.find((p) => p.title === title).column)

  it('the capture verifies, holds every day of the week, and its bars open at 00:00 UTC', () => {
    expect(validateCapture(BTC).ok).toBe(true)
    expect(integrity.ok, integrity.errors && integrity.errors.join('; ')).toBe(true)
    expect(BTC.bars.rows.length).toBe(5491)
    expect(new Set(BTC_DATES.map((d) => d.getUTCDay())).size).toBe(7)
    expect(BTC.bars.rows.every((r) => r[0] % 86400 === 0)).toBe(true)
    expect(BTC.symbol.session).toBe('24x7')
  })

  it('the probe as captured still refuses at the door on `input.time` alone (so the replay is the derived capture)', () => {
    const full = gradeCapture(BTC)
    expect(full.verdict.verdict).toBe('INCONCLUSIVE')
    expect(full.verdict.reason).toMatch(/member door refused \(pine:input-kind\)/)
  })

  const ROWS = { W: 'T01_timeW_minus_time_DAYS', M: 'T02_timeM_minus_time_DAYS', '3M': 'T03_time3M_minus_time_DAYS', '12M': 'T04_time12M_minus_time_DAYS' }
  for (const [period, title] of Object.entries(ROWS)) {
    it(`${title}: 0 wrong values; withheld exactly the bars the capture says this chart cannot answer`, () => {
      const p = byTitle.get(title)
      const u = btcUnknown(period)
      const withheld = u.partial.length + u.openMissing.length + u.clock.length
      expect(p.stats.valueMismatches).toBe(0)
      expect(p.stats.naMismatches).toBe(withheld)
      expect(p.stats.matching).toBe(5491 - withheld)
      // and it is the SAME bars, not merely the same count
      const got = ourCol(title)
      expect(got.map((v, i) => (Number.isNaN(v) ? i : -1)).filter((i) => i >= 0)).toEqual([...u.unknown].map((x, i) => (x ? i : -1)).filter((i) => i >= 0))
    })
  }

  it('the counts are not vacuous: first partial period / opening day missing / across a New York clock change', () => {
    const parts = (period) => { const u = btcUnknown(period); return [u.partial.length, u.openMissing.length, u.clock.length] }
    expect(parts('W')).toEqual([4, 19, 30])
    expect(parts('M')).toEqual([8, 22, 666])
    expect(parts('3M')).toEqual([31, 75, 1138])
    expect(parts('12M')).toEqual([106, 0, 3540])
  })

  for (const [title, period] of [['T07_newWeek', 'W'], ['T08_newMonth', 'M'], ['T09_newQuarter', '3M']]) {
    it(`${title}: the new-period event agrees on every served bar (an unknown bar withholds the bar that reads it one back)`, () => {
      const p = byTitle.get(title)
      const withheld = reachOne(btcUnknown(period).unknown)
      expect(p.stats.valueMismatches).toBe(0)
      expect(p.stats.naMismatches).toBe(withheld)
      expect(p.stats.matching).toBe(5491 - withheld)
    })
  }

  it('⭐ THE WEEK STARTS MONDAY: every served Sunday bar reads −6, every Monday bar 0 — TradingView\'s own numbers', () => {
    const got = ourCol(ROWS.W)
    const v = vendor(BTC, ROWS.W)
    const at = (dow) => BTC_DATES.map((d, i) => (d.getUTCDay() === dow && !Number.isNaN(got[i]) ? i : -1)).filter((i) => i >= 0)
    const sundays = at(0)
    const mondays = at(1)
    expect(sundays.length).toBeGreaterThan(740)
    expect(mondays.length).toBeGreaterThan(770)
    expect(new Set(sundays.map((i) => got[i]))).toEqual(new Set([-6]))
    expect(new Set(sundays.map((i) => v[i]))).toEqual(new Set([-6]))
    expect(new Set(mondays.map((i) => got[i]))).toEqual(new Set([0]))
  })

  it('⛔ where the Monday bar is missing TradingView still anchors to the Monday: the week is withheld, not answered from its Tuesday', () => {
    // Tue 2011-08-30 opens its week on this chart (no bar from Fri 08-26 to Mon 08-29); the vendor reads −1 there
    const i = BTC_DATES.findIndex((d) => d.toISOString().slice(0, 10) === '2011-08-30')
    expect(BTC_DATES[i - 1].toISOString().slice(0, 10)).toBe('2011-08-25')
    expect(BTC_DATES.some((d) => d.toISOString().slice(0, 10) === '2011-08-29')).toBe(false)
    expect(vendor(BTC, ROWS.W)[i]).toBe(-1)
    expect(Number.isNaN(ourCol(ROWS.W)[i])).toBe(true)
  })

  it('the two partial withholdings are NAMED, and `time(timeframe.period)` / `time("60")` match on all 5,491 bars', () => {
    expect(noteCodes(ours)).toEqual(['time-anchor:period-open-missing', 'time-anchor:utc-day-clock'])
    for (const title of ['T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
      expect(byTitle.get(title).stats).toMatchObject({ matching: 5491, valueMismatches: 0, naMismatches: 0 })
    }
  })

  it('⚠️ WHY a clock change withholds: this chart\'s `time` on such a symbol is 09:30 New York, TradingView\'s 00:00 UTC — on every bar', () => {
    const t = column(on(BTC, pine(['plot(time, "t")'])))
    const apart = new Map()
    BTC.bars.rows.forEach((r, i) => { const h = (t[i] / 1000 - r[0]) / 3600; apart.set(h, (apart.get(h) || 0) + 1) })
    expect([...apart.entries()].sort((a, b) => a[0] - b[0])).toEqual([[13.5, 3596], [14.5, 1895]])
  })

  it('the object lane: a last-bar label prints the vendor\'s own offset; a first-bar label (the partial week) is withheld', () => {
    const last = on(BTC, pine(['d = (time("W") - time) / 86400000', 'if barstate.islast', '    label.new(bar_index, high, str.tostring(d))']))
    expect(last.objects.texts.labels).toEqual([String(vendor(BTC, ROWS.W)[5490])])
    const first = on(BTC, pine(['if barstate.isfirst', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    expect(first.objects.counts.labels).toBe(0)
  })
})

describe('C36 · 1 — one weekend day but not the other is neither capture\'s shape: every bar withheld, by name', () => {
  it('the synthetic series hold a Saturday OR a Sunday; the capture they are built from holds neither', () => {
    const dows = (cap) => [...new Set(column(on(cap, pine(['plot(dayofweek)']))))].sort()
    expect(dows(WEEKDAYS)).toEqual([2, 3, 4, 5, 6])
    expect(dows(SATURDAYS)).toEqual([2, 3, 4, 5, 6, 7])
    expect(dows(SUNDAYS)).toEqual([1, 2, 3, 4, 5, 6])
  })

  for (const tf of ['W', 'M', '3M', '12M']) {
    it(`plot(time("${tf}")) — every bar withheld on both, and the reason is named`, () => {
      for (const cap of [SATURDAYS, SUNDAYS]) {
        const ours = on(cap, pine([`plot(time("${tf}"), "t")`, `plot(na(time("${tf}")) ? 111 : 222, "r")`]))
        expect(ours.ok, ours.refusal).toBe(true)
        expect(allNaN(column(ours, 0)) && allNaN(column(ours, 1))).toBe(true)
        expect(noteCodes(ours)).toEqual(['time-anchor:weekend-bars'])
        expect(ours.notes.join('\n')).toMatch(/a Saturday or a Sunday but not both/)
      }
    })
  }

  it('⛔ the object lane: a last-bar label reading the anchor is withheld, and says why', () => {
    const ours = on(SUNDAYS, pine(['if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.counts.labels).toBe(0)
    expect(ours.objects.chartClock.map((r) => r.code)).toEqual(['time-anchor:weekend-bars'])
  })

  it('CONTROL — the same scripts on the weekday series are SERVED, with no reason given', () => {
    const plot = on(WEEKDAYS, pine(['plot(time("W"), "t")', 'plot(na(time("W")) ? 111 : 222, "r")']))
    const w = column(plot, 0)
    expect(w.filter(Number.isNaN).length).toBe(0)                  // C49: the first partial week too
    expect(new Set(column(plot, 1).filter((v) => !Number.isNaN(v)))).toEqual(new Set([222]))
    expect(noteCodes(plot)).toEqual([])
    const label = on(WEEKDAYS, pine(['if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    expect(label.objects.texts.labels).toEqual(['known'])
    expect(label.objects.chartClock).toEqual([])
  })

  it('CONTROL — on those series a tree that reads NO anchor is untouched', () => {
    const ours = on(SUNDAYS, pine(['plot(close, "c")', 'plot(time, "t")', 'plot(time(timeframe.period), "own")']))
    expect(column(ours, 0).some(Number.isNaN)).toBe(false)
    expect(column(ours, 1).some(Number.isNaN)).toBe(false)
    expect(column(ours, 2)).toEqual(column(ours, 1))
    expect(noteCodes(ours)).toEqual([])
  })
})

describe('C36 · 1 — C30\'s surviving mutation M5 (a Sunday-first week) now goes RED, on TradingView\'s numbers', () => {
  // The week key with the week starting on Sunday instead of Monday: `+ 5` → `+ 6`
  // (both copies of the key: the bar's own and the `[1]` it is compared with).
  const mondayFirst = periodFirstCondition('W')
  const sundayFirst = JSON.parse(JSON.stringify(mondayFirst).replace(/"value":5\}/g, '"value":6}'))
  const anchorOf = (cond) => ({ type: 'call', name: 'valuewhenOccurrence', args: [cond, { type: 'series', name: 'time' }, { type: 'num', value: 0 }] })
  const events = (cond, bars) => Array.from(interpret(cond, bars, {}, undefined, undefined, { tf: 'D' }))

  it('the mutation is a real change to the tree (one literal, twice), and is no longer recognised as the anchor', () => {
    expect(sundayFirst).not.toEqual(mondayFirst)
    expect(JSON.stringify(mondayFirst).match(/"value":5\}/g).length).toBe(2)
    expect(isPeriodAnchor(anchorOf(mondayFirst))).toBe(true)
    expect(isPeriodAnchor(anchorOf(sundayFirst))).toBe(false)
  })

  it('WHY IT SURVIVED C30: on Monday-to-Friday bars the two keys open a week on EXACTLY the same bars — 900 and 8,473 sessions', () => {
    for (const cap of [D1, LONG]) {
      const bars = toProductBars(cap)
      const a = events(mondayFirst, bars)
      expect(a.filter((v) => v === 1).length).toBeGreaterThan(150)
      expect(events(sundayFirst, bars)).toEqual(a)
    }
    expect(toProductBars(LONG).length).toBe(8473)
  })

  it('⭐ WHY IT IS DEAD NOW: on BTCUSD the vendor opens the week where the Monday-first key does, on every bar', () => {
    const bars = toProductBars(BTC)
    const newWeek = vendor(BTC, 'T07_newWeek')
    const agree = (cond) => events(cond, bars).filter((v, i) => i > 0 && v === newWeek[i]).length
    // the vendor's own event (bar 0 aside, which has no previous bar on either side)
    expect(agree(mondayFirst)).toBe(5490)
    // the Sunday-first key puts every week's open one bar early: wrong on both bars of every boundary
    expect(agree(sundayFirst)).toBeLessThan(5490 - 1500)
  })
})

describe('C36 · 1 — a session chart: the anchor is the first session THE VENDOR\'S CALENDAR holds, not the first bar', () => {
  const { verdict } = gradeCapture(derive(TC_SPY, TC_CUT))
  const byTitle = new Map(verdict.plots.map((p) => [p.title, p]))
  const dates = toProductBars(TC_SPY).map((b) => b.t)

  it('⛔ the Hurricane Sandy week (2012): TradingView reads −2 / −3 / −4 where the first-bar rule reads 0 / −1 / −2', () => {
    const i = dates.indexOf('2012-10-31')
    expect(dates[i - 1]).toBe('2012-10-26')                                   // no bar Mon 10-29, Tue 10-30
    expect(vendor(TC_SPY, 'Q08_timeW_minus_time_DAYS').slice(i, i + 3)).toEqual([-2, -3, -4])
  })

  it('Q08–Q11 (`time("W" / "M" / "3M" / "12M") − time`): equal to TradingView on all 4,800 bars — the Sandy week answered from the calendar', () => {
    // C49 — the first partial period (1 / 1 / 20 / 84 bars) is served from the
    // calendar. ⚰️ RE-PINNED 2026-10-01 (integrator ruling): the Sandy week's three
    // bars were withheld (3 / 0 / 0 / 0); the calendar reproduces them and they are served.
    for (const [title, withheld] of [['Q08_timeW_minus_time_DAYS', 0], ['Q09_timeM_minus_time_DAYS', 0],
      ['Q10_time3M_minus_time_DAYS', 0], ['Q11_time12M_minus_time_DAYS', 0]]) {
      const p = byTitle.get(title)
      expect(p.stats.valueMismatches, title).toBe(0)
      expect(p.stats.naMismatches, title).toBe(withheld)
      expect(p.stats.matching, title).toBe(4800 - withheld)
    }
  })

  it('nothing is withheld for it (ruling 2026-10-01: was `time-anchor:session-open-missing`) — Wed 2012-10-31 reads Monday 10-29 09:30', () => {
    const sandy = on(TC_SPY, pine(['plot(time("W"), "w")']))
    expect(noteCodes(sandy)).toEqual([])
    expect(column(sandy)[dates.indexOf('2012-10-31')]).toBe(Date.UTC(2012, 9, 29, 13, 30))
    const recent = on(D1, pine(['plot(time("W"), "w")']))
    expect(noteCodes(recent)).toEqual([])
    expect(column(recent).filter(Number.isNaN).length).toBe(0)
  })

  it('⭐ C49 — before 2000 the vendor\'s calendar applies no closure, and the full-history capture measured it: those periods are SERVED from the calendar, and so is the Sandy week (ruling 2026-10-01)', () => {
    // ⚰️ This asserted the opposite ("no daily chart was measured: those periods are
    // withheld") until `vw-time-tf-spy-1d-full-2026-10-01` measured 1993 → 2000.
    const bars = toProductBars(LONG)
    const ours = on(LONG, pine(['plot(time("W"), "w")', 'plot(time("12M"), "y")']))
    const w = column(ours, 0)
    const withheld = w.map((v, i) => (Number.isNaN(v) ? bars[i].t : null)).filter(Boolean)
    expect(withheld).toEqual([])                                  // was the Sandy week's three, until the ruling
    for (const d of ['2012-10-31', '2012-11-01', '2012-11-02']) expect(w[bars.findIndex((b) => b.t === d)], d).toBe(Date.UTC(2012, 9, 29, 13, 30))
    // Tue 1999-01-19 (MLK Monday: a holiday the calendar keeps open) reads MONDAY 01-18 09:30 New York
    expect(w[bars.findIndex((b) => b.t === '1999-01-19')]).toBe(Date.UTC(1999, 0, 18, 14, 30))
    // the year is served on every bar; 1999 opens on Fri 01-01, a day with no bar
    const y = column(ours, 1)
    expect(y.filter(Number.isNaN).length).toBe(0)
    expect(y[bars.findIndex((b) => b.t === '1999-01-04')]).toBe(Date.UTC(1999, 0, 1, 14, 30))
  })
})

describe('C36 · 2 — a chart timeframe no capture measured: withheld as before, and it says why', () => {
  // ⭐ C49 — the 60-minute chart these tests used IS measured now (and served); the
  // unmeasured chart here is a 240-minute one.
  it('240m: the plot lane names `time-anchor:not-daily`, with the chart\'s own timeframe and the capture that settles it', () => {
    const ours = on(R240, pine(['plot(time("W"), "w")', 'plot(time("12M"), "y")']))
    expect(allNaN(column(ours, 0)) && allNaN(column(ours, 1))).toBe(true)
    expect(noteCodes(ours)).toEqual(['time-anchor:not-daily'])
    const note = ours.notes.find((n) => n.includes('time-anchor:not-daily'))
    expect(note).toMatch(/on 2 plot\(s\)/)
    expect(note).toMatch(/This chart's timeframe is `240`/)
    expect(note).toMatch(/5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts/)
    expect(note).toMatch(/`vw-time-tf` probe measured on this timeframe/)
  })

  it('240m: the object lane carries the same reason', () => {
    const ours = on(R240, pine(['if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    expect(ours.objects.counts.labels).toBe(0)
    expect(ours.objects.chartClock).toEqual([{ code: 'time-anchor:not-daily', reason: CHART_CLOCK_WITHHELD['time-anchor:not-daily']('240') }])
  })

  it('CONTROL — the same plots on the daily and the 60-minute chart are served on every bar, and report nothing', () => {
    for (const cap of [D1, H60]) {
      const ours = on(cap, pine(['plot(time("W"), "w")', 'plot(time("12M"), "y")']))
      expect(noteCodes(ours)).toEqual([])
      expect(column(ours, 0).filter(Number.isNaN).length).toBe(0)
      expect(column(ours, 1).filter(Number.isNaN).length).toBe(0)
    }
  })

  it('CONTROL — a script with no `time(<timeframe>)` reports nothing on the 240m chart', () => {
    const ours = on(R240, pine(['plot(close)', 'if barstate.islast', '    label.new(bar_index, high, "x")']))
    expect(noteCodes(ours)).toEqual([])
    expect(ours.objects.chartClock).toEqual([])
  })

  it('every sentence says what is withheld and what would settle it', () => {
    for (const [code, say] of Object.entries(CHART_CLOCK_WITHHELD)) {
      expect(say('5'), code).toMatch(/What would settle it/)
      expect(say('5'), code).toMatch(/withheld/)
    }
    expect(CHART_CLOCK_WITHHELD['time-anchor:not-daily']('W')).toMatch(/timeframe is `W`/)
    expect(CHART_CLOCK_WITHHELD['time-own:chart-unwitnessed'](undefined)).toMatch(/timeframe is not stated/)
  })
})

describe('C36 · 2 — the mask itself: a read of OTHER bars, and the graph-form object lane', () => {
  const anchor = { type: 'call', name: 'valuewhenOccurrence', args: [periodFirstCondition('M'), { type: 'series', name: 'time' }, { type: 'num', value: 0 }] }
  const bars = toProductBars(D1)

  it('an anchor, the own-time node or a period close under a `tf` / `sym` node reads other bars: every bar, named', () => {
    for (const inner of [anchor, chartOwnTimeNode(true), periodCloseNode('W', true)]) {
      for (const type of ['tf', 'sym']) {
        const sink = new Map()
        const mask = periodAnchorMask({ type, value: type === 'tf' ? 'W' : 'QQQ', args: [inner] }, bars, {}, undefined, undefined, { tf: 'D', chartClockSink: sink })
        expect(Array.from(mask).every((m) => m === 1), type).toBe(true)
        expect([...sink.keys()], type).toContain('time-anchor:other-bars')
      }
    }
  })

  it('CONTROL — the same anchor on the chart\'s own bars is known on every bar (C49: its first partial period too), and names nothing', () => {
    const sink = new Map()
    const mask = Array.from(periodAnchorMask(anchor, bars, {}, undefined, undefined, { tf: 'D', chartClockSink: sink }))
    expect(mask.filter((m) => m === 1).length).toBe(0)
    expect(sink.size).toBe(0)
    expect(periodAnchorMask({ type: 'series', name: 'close' }, bars, {}, undefined, undefined, { tf: 'D', chartClockSink: sink })).toBeNull()
  })

  it('the GRAPH-form object lane (a document over the byte budget) names the reason too', () => {
    const tree = { type: 'call', name: 'na', args: [anchor] }
    const graph = buildGraph({ a: tree })
    const program = { ops: [{ props: { y: { v: 'graph', node: graph.outputRoots.a } } }] }
    const unmeasured = computeObjectColumns(graph, program, toProductBars(R240), { tf: '240', inputs: {} })
    expect(unmeasured.chartClock).toEqual([{ code: 'time-anchor:not-daily', reason: CHART_CLOCK_WITHHELD['time-anchor:not-daily']('240') }])
    expect(unmeasured.readUnknown(graph.outputRoots.a, 0)).toBe(true)
    const daily = computeObjectColumns(graph, program, bars, { tf: 'D', inputs: {} })
    expect(daily.chartClock).toEqual([])
    expect(daily.readUnknown(graph.outputRoots.a, bars.length - 1)).toBe(false)
  })
})

describe('C36 · 3 — `time(timeframe.period)` and `time("60")`: the bar\'s own time, where a capture shows it', () => {
  it('the captures are valid, and both rows read 0 on every vendor bar — 900 daily, 300 hourly, 5,491 every-day', () => {
    for (const [cap, n] of [[D1, 900], [H60, 300], [BTC, 5491]]) {
      expect(validateCapture(cap).ok).toBe(true)
      for (const title of ['T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
        const col = vendor(cap, title)
        expect(col.length).toBe(n)
        expect(new Set(col)).toEqual(new Set([0]))
      }
    }
  })

  describe('the 60m capture through the real member door (T16 cut, re-sealed)', () => {
    const { verdict, integrity } = gradeCapture(derive(H60, T16))
    const byTitle = new Map(verdict.plots.map((p) => [p.title, p]))
    it('the derived capture is sealed and valid', () => {
      expect(integrity.ok, integrity.errors && integrity.errors.join('; ')).toBe(true)
    })
    for (const title of ['T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
      it(`${title}: equal to TradingView on all 300 hourly bars`, () => {
        const p = byTitle.get(title)
        expect(p.verdict).toBe('MATCH')
        expect(p.stats).toMatchObject({ matching: 300, valueMismatches: 0, naMismatches: 0 })
      })
    }
    it('⭐ C49 — the seven period rows on the hourly chart: 0 wrong values; the four anchors on all 300 bars, the three events on all but bar 0', () => {
      // ⚰️ "draw NOTHING on the hourly chart" until C49: C30 read this capture's bar 0
      // as a different rule. It is the calendar's (`vendorHarness.c30TimeAnchor.test.js`).
      for (const title of ['T01_timeW_minus_time_DAYS', 'T02_timeM_minus_time_DAYS', 'T03_time3M_minus_time_DAYS', 'T04_time12M_minus_time_DAYS']) {
        expect(byTitle.get(title).stats, title).toMatchObject({ matching: 300, valueMismatches: 0, naMismatches: 0 })
      }
      for (const title of ['T07_newWeek', 'T08_newMonth', 'T09_newQuarter']) {
        expect(byTitle.get(title).stats, title).toMatchObject({ matching: 299, valueMismatches: 0, naMismatches: 1 })
      }
    })
  })

  it('a 240-minute chart is not one of the measured ones: every bar withheld, named, in both lanes', () => {
    expect(OWN_TIME_WITNESSED_TF).toEqual(['5', '15', '60', 'D', 'W', 'M'])
    expect(OWN_TIME_WITNESSED_TF_C36).toEqual(['D', '60'])
    const ours = on(R240, pine(['plot(time(timeframe.period), "own")', 'plot(time("60"), "sixty")', 'plot(time, "t")']))
    expect(ours.ok, ours.refusal).toBe(true)
    expect(allNaN(column(ours, 0)) && allNaN(column(ours, 1))).toBe(true)
    expect(column(ours, 2).some(Number.isNaN)).toBe(false)
    expect(noteCodes(ours)).toEqual(['time-own:chart-unwitnessed'])
    expect(ours.notes.join('\n')).toMatch(/timeframe is `240`/)
    const label = on(R240, pine(['if barstate.islast', '    label.new(bar_index, high, na(time(timeframe.period)) ? "na" : "known")']))
    expect(label.objects.counts.labels).toBe(0)
    expect(label.objects.chartClock.map((r) => r.code)).toEqual(['time-own:chart-unwitnessed'])
  })

  it('⭐ C49 — a 5-minute chart WITH extended-hours bars: `time(timeframe.period)` is the bar\'s own time; `time("60")` is withheld and named (only regular-session bars were measured)', () => {
    const hm = M5.bars.rows.map((r) => new Date(r[0] * 1000).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }))
    expect(hm.some((x) => x < '09:30') || hm.some((x) => x >= '16:00')).toBe(true)
    const ours = on(M5, pine(['plot(time(timeframe.period), "own")', 'plot(time("60"), "sixty")', 'plot(time, "t")', 'plot(time("W"), "w")']))
    expect(ours.ok, ours.refusal).toBe(true)
    expect(column(ours, 0)).toEqual(column(ours, 2))
    expect(allNaN(column(ours, 1)) && allNaN(column(ours, 3))).toBe(true)
    expect(noteCodes(ours)).toEqual(['time-clock:outside-session'])
    expect(ours.notes.join('\n')).toMatch(/pre-market, after-hours or weekend bar/)
  })

  it('CONTROL — the same label on the 60m and 1D charts IS drawn, and reads the known answer', () => {
    for (const cap of [H60, D1]) {
      const label = on(cap, pine(['if barstate.islast', '    label.new(bar_index, high, na(time(timeframe.period)) ? "na" : "known")']))
      expect(label.objects.texts.labels).toEqual(['known'])
      expect(label.objects.chartClock).toEqual([])
    }
  })

  it('the tree is the ONE builder\'s, gated on the measured bar lengths — and C36\'s two-length tree is still recognised, as what it was', () => {
    const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
    const own = S('plot(time(timeframe.period))', { strict: true })
    expect(own.ok).toBe(true)
    expect(own.outputs[own.selected].formula).toBe('periodseconds == 300 || periodseconds == 900 || periodseconds == 3600 '
      + '|| periodseconds == 86400 || periodseconds == 604800 || periodseconds == 2628003 ? time * 1000 : 0 / 0')
    expect(own.outputs[own.selected].ast).toEqual(chartOwnTimeNode(true))
    expect(isChartOwnTime(own.outputs[own.selected].ast)).toBe(true)
    expect(chartOwnTimeTfs(own.outputs[own.selected].ast)).toEqual(OWN_TIME_WITNESSED_TF)
    // ⭐ C49 — `time("60")` writes its OWN tree: below 60 minutes it is not the bar's time
    const sixty = S('plot(time("60"))', { strict: true }).outputs[0].ast
    expect(sixty).toEqual(chartSixtyTimeNode(true))
    expect(isChartSixtyTime(sixty)).toBe(true)
    expect(isChartOwnTime(sixty)).toBe(false)
    // a name bound to the chart's own timeframe is the same question
    expect(S('tf = timeframe.period\nplot(time(tf))', { strict: true }).outputs[0].ast).toEqual(chartOwnTimeNode(true))
    // the tree C36 wrote for BOTH spellings: recognised, and still 1D and 60 minutes only
    const c36 = chartOwnTimeNode(true, OWN_TIME_WITNESSED_TF_C36)
    const on = (secs) => ({ type: 'op', name: '==', args: [{ type: 'series', name: 'periodseconds' }, { type: 'num', value: secs }] })
    expect(c36.args[0]).toEqual({ type: 'op', name: '||', args: [on(86400), on(3600)] })
    expect(chartOwnTimeTfs(c36)).toEqual(['D', '60'])
    // a member's own ternary over the same leaves, one literal different, is NOT it
    const near = JSON.parse(JSON.stringify(c36).replace('3600', '900'))
    expect(isChartOwnTime(near)).toBe(false)
  })

  it('refused by name — everything the captures do not show', () => {
    const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
    // any other literal: the probe asked "60" and nothing else below the chart
    for (const tf of ['"15"', '"30"', '"240"', '"1H"', '"5"']) {
      const t = S(`plot(time(${tf}))`, { strict: true })
      expect(t.ok, tf).toBe(false)
      expect(t.refusal.guard, tf).toBe('pine:function')
    }
    // a chart the translation is TOLD is none of the measured ones (C49: 5 / 15 / W / M joined them)
    for (const base of ['1', '30']) {
      for (const body of ['plot(time(timeframe.period))', 'plot(time("60"))']) {
        const t = S(body, { strict: true, basePeriod: base })
        expect(t.ok, `${body} on ${base}`).toBe(false)
        expect(t.refusal.message, base).toMatch(/5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts only/)
        expect(t.refusal.message, base).toMatch(/same\s+probe on this timeframe/)
      }
    }
    for (const base of ['5', '15', '60', 'D', 'W', 'M']) {
      for (const body of ['plot(time(timeframe.period))', 'plot(time("60"))']) expect(S(body, { strict: true, basePeriod: base }).ok, `${body} on ${base}`).toBe(true)
    }
    // a screen
    const screen = S('plot(time(timeframe.period))', {})
    expect(screen.ok).toBe(false)
    expect(screen.refusal.message).toMatch(/only on a chart\s+pane/)
    // inside a request for other bars
    const req = S('plot(request.security(syminfo.tickerid, "W", time(timeframe.period)))', { strict: true })
    expect(req.ok).toBe(false)
    expect(req.refusal.message).toMatch(/inside a `request.security` at `W`/)
  })
})

describe('C36 · 5 — `time_close("W" | "M")` on AMEX:SPY 1D: the close of the period\'s last session', () => {
  const derived = derive(TC_SPY, TC_CUT)
  const { verdict, integrity } = gradeCapture(derived)
  const byTitle = new Map(verdict.plots.map((p) => [p.title, p]))
  const bars = toProductBars(TC_SPY)

  it('the capture verifies; as captured it refuses at the door on `time_close("3M")` alone, by name', () => {
    expect(validateCapture(TC_SPY).ok).toBe(true)
    expect(integrity.ok, integrity.errors && integrity.errors.join('; ')).toBe(true)
    expect(TC_SPY.bars.rows.length).toBe(4800)
    const full = gradeCapture(TC_SPY)
    expect(full.verdict.verdict).toBe('INCONCLUSIVE')
    expect(full.verdict.reason).toMatch(/time_close\("3M"\).*resamples only weeks and months/)
  })

  for (const title of ['Q01_timecloseW_minus_time_DAYS', 'Q02_timecloseM_minus_time_DAYS', 'Q12_newWeekClose', 'Q13_newMonthClose']) {
    it(`${title}: equal to TradingView on all 4,800 bars — nothing wrong, nothing withheld`, () => {
      const p = byTitle.get(title)
      expect(p.verdict).toBe('MATCH')
      expect(p.stats).toMatchObject({ matching: 4800, valueMismatches: 0, naMismatches: 0 })
    })
  }

  it('the capture holds the cases that matter: Friday closes, Thursday closes (a holiday Friday), and 13:00 half-days', () => {
    const w = vendor(TC_SPY, 'Q01_timecloseW_minus_time_DAYS')
    const closes = bars.map((b, i) => new Date(Date.parse(`${b.t}T00:00:00Z`) + Math.floor(w[i]) * 86400000))
    const dow = (d) => d.getUTCDay()
    expect(closes.filter((d) => dow(d) === 5).length).toBeGreaterThan(4000)
    expect(closes.filter((d) => dow(d) === 4).length).toBeGreaterThan(100)
    // a 16:00 close is 6.5 h after a 09:30 bar (0.2708 d); a 13:00 one, 3.5 h (0.1458 d)
    const frac = (x) => Math.round((x - Math.floor(x)) * 10000) / 10000
    expect(w.filter((x) => frac(x) === 0.1458).length).toBeGreaterThan(20)
    expect(w.filter((x) => frac(x) === 0.2708).length).toBeGreaterThan(4500)
  })

  it('⭐ the FORMING period reads the SCHEDULED close: Wed 2026-09-30 → Fri 2026-10-02 16:00 New York; the month, that same day', () => {
    const ours = on(TC_SPY, pine(['plot(time_close("W"), "w")', 'plot(time_close("M"), "m")']))
    expect(bars[4799].t).toBe('2026-09-30')
    expect(column(ours, 0)[4799]).toBe(Date.UTC(2026, 9, 2, 20, 0))
    expect(column(ours, 1)[4799]).toBe(Date.UTC(2026, 8, 30, 20, 0))
    expect(noteCodes(ours)).toEqual([])
  })

  it('the object lane draws it: a last-bar label is not withheld', () => {
    const ours = on(TC_SPY, pine(['if barstate.islast', '    label.new(bar_index, high, str.tostring((time_close("W") - time) / 86400000))']))
    expect(ours.objects.counts.labels).toBe(1)
    expect(Number(ours.objects.texts.labels[0])).toBeCloseTo(vendor(TC_SPY, 'Q01_timecloseW_minus_time_DAYS')[4799], 3)
    expect(ours.objects.chartClock).toEqual([])
  })

  it('⭐ a completed period whose last session has no bar reads the calendar\'s close: on 8,473 sessions nothing is withheld (ruling 2026-10-01)', () => {
    const long = toProductBars(LONG)
    const ours = on(LONG, pine(['plot(time_close("W"), "w")', 'plot(time_close("M"), "m")']))
    expect(noteCodes(ours)).toEqual([])
    const withheld = (i) => column(ours, i).map((v, k) => (Number.isNaN(v) ? long[k].t : null)).filter(Boolean)
    // ⚰️ 53 and 40 bars until `vw-time-close-tf-spy-1d-full-2026-10-01` measured the
    // 13 weeks and 2 months before 2000 that end on a holiday: the calendar's close.
    // ⚰️ then ['2001-09-10'] (`time-close:period-end-missing`) until the integrator
    // ruled the one witness served: the vendor's session keeps 2001-09-11..14 open.
    expect(withheld(0)).toEqual([])
    expect(withheld(1)).toEqual([])
    expect(column(ours, 0)[long.findIndex((b) => b.t === '2001-09-10')]).toBe(Date.UTC(2001, 8, 14, 20, 0))
    // Thu 1999-04-01 (Good Friday has no bar) reads FRIDAY 04-02 16:00 New York
    expect(column(ours, 0)[long.findIndex((b) => b.t === '1999-04-01')]).toBe(Date.UTC(1999, 3, 2, 21, 0))
  })

  it('the tree is vocabulary both lanes already hold — `tf_live(<period>, timeclose)`, gated on a daily bar', () => {
    const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
    const w = S('plot(time_close("W"))', { strict: true })
    expect(w.ok).toBe(true)
    expect(w.outputs[w.selected].formula).toBe("periodseconds == 86400 ? tf_live(timeclose, 'W') * 1000 : 0 / 0")
    expect(w.outputs[w.selected].ast).toEqual(periodCloseNode('W', true))
    expect(S('plot(time_close("M"))', { strict: true }).outputs[0].ast).toEqual(periodCloseNode('M', true))
    expect(S('plot(time_close("1W"))', { strict: true }).outputs[0].ast).toEqual(periodCloseNode('W', true))
    expect(PERIOD_CLOSE_CODES).toEqual(['W', 'M'])
    expect(isPeriodClose(periodCloseNode('M', false))).toBe(true)
    // a member's own `tf_live` read of the same leaf, without the gate, keeps its own meaning
    expect(isPeriodClose({ type: 'tf_live', value: 'W', args: [{ type: 'series', name: 'timeclose' }] })).toBe(false)
    expect(isPeriodClose(JSON.parse(JSON.stringify(periodCloseNode('W', true)).replace('timeclose', 'time')))).toBe(false)
  })

  it('refused by name — the quarter and the year (no bar to read them from), a screen, a told chart, a request', () => {
    const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
    for (const tf of ['"3M"', '"12M"']) {
      const t = S(`plot(time_close(${tf}))`, { strict: true })
      expect(t.ok, tf).toBe(false)
      expect(t.refusal.guard, tf).toBe('pine:function')
      expect(t.refusal.message, tf).toMatch(/vw-time-close-tf-spy-1d-2026-09-30/)
      expect(t.refusal.message, tf).toMatch(/resamples only weeks and months/)
    }
    const screen = S('plot(time_close("W"))', {})
    expect(screen.ok).toBe(false)
    expect(screen.refusal.message).toMatch(/only on a chart pane/)
    for (const base of ['60', '5']) {
      const t = S('plot(time_close("M"))', { strict: true, basePeriod: base })
      expect(t.ok, base).toBe(false)
      expect(t.refusal.message, base).toMatch(/measured on 1D, 1W and 1M charts only/)
    }
    // C49 — the weekly and monthly charts were measured (`vw-time-close-tf-spy-{1w,1m}-2026-10-01`)
    for (const base of ['D', 'W', 'M']) expect(S('plot(time_close("M"))', { strict: true, basePeriod: base }).ok, base).toBe(true)
    const req = S('plot(request.security(syminfo.tickerid, "W", time_close("M")))', { strict: true })
    expect(req.ok).toBe(false)
    expect(req.refusal.message).toMatch(/inside a `request.security` at `W`/)
    for (const tf of ['"60"', '"240"', '"2W"']) {
      const t = S(`plot(time_close(${tf}))`, { strict: true })
      expect(t.ok, tf).toBe(false)
    }
  })
})

describe('C36 · 5 — `time_close("W" | "M")` everywhere it was NOT measured: withheld whole, by name, never refused mid-evaluation', () => {
  it('BITSTAMP:BTCUSD 1D — TradingView answers the NEXT period\'s open there; all four rows withheld on all 5,491 bars', () => {
    const { verdict } = gradeCapture(derive(TC_BTC, TC_CUT))
    const byTitle = new Map(verdict.plots.map((p) => [p.title, p]))
    for (const title of ['Q01_timecloseW_minus_time_DAYS', 'Q02_timecloseM_minus_time_DAYS', 'Q12_newWeekClose', 'Q13_newMonthClose']) {
      const p = byTitle.get(title)
      expect(p.stats.valueMismatches, title).toBe(0)
      expect(p.stats.matching, title).toBe(0)
      expect(p.stats.naMismatches, title).toBe(5491)
    }
    // the vendor's answer is a whole number of days on: the next Monday 00:00 UTC
    expect(new Set(vendor(TC_BTC, 'Q01_timecloseW_minus_time_DAYS').map((x) => x % 1))).toEqual(new Set([0]))
    // …and the anchors beside them on the same capture are served, 0 wrong
    for (const title of ['Q08_timeW_minus_time_DAYS', 'Q09_timeM_minus_time_DAYS', 'Q10_time3M_minus_time_DAYS', 'Q11_time12M_minus_time_DAYS']) {
      expect(byTitle.get(title).stats.valueMismatches, title).toBe(0)
      expect(byTitle.get(title).stats.matching, title).toBeGreaterThan(1800)
    }
    const ours = on(TC_BTC, pine(['plot(time_close("W"), "w")', 'if barstate.islast', '    label.new(bar_index, high, na(time_close("W")) ? "na" : "known")']))
    expect(noteCodes(ours)).toEqual(['time-close:weekend-bars'])
    expect(ours.objects.counts.labels).toBe(0)
    // ⚠️ C49 — an explicit ceiling: three member-door runs over 5,491 bars in one test. Alone it
    // takes 7–10 s; inside the full chart suite on a loaded box it crossed the 15 s default.
  }, 60000)

  it('an hourly chart: the plot is withheld and named — not an `interpret:timeframe` refusal of the `tf_live` read', () => {
    const ours = on(H60, pine(['plot(time_close("W"), "w")', 'plot(time_close("M"), "m")', 'if barstate.islast', '    label.new(bar_index, high, na(time_close("W")) ? "na" : "known")']))
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.plots.map((p) => p.missingReason || null)).toEqual([null, null])
    expect(allNaN(column(ours, 0)) && allNaN(column(ours, 1))).toBe(true)
    expect(noteCodes(ours)).toEqual(['time-close:not-daily'])
    expect(ours.notes.join('\n')).toContain('This chart\'s timeframe is `60`')
    expect(ours.objects.counts.labels).toBe(0)
  })

  it('⭐ C49 — a WEEKLY chart is measured now: served on every bar, and still never an `interpret:timeframe` refusal', () => {
    const ours = on(W1, pine(['plot(time_close("W"), "w")', 'plot(time_close("M"), "m")', 'plot(time_close, "own")', 'if barstate.islast', '    label.new(bar_index, high, na(time_close("W")) ? "na" : "known")']))
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.plots.map((p) => p.missingReason || null)).toEqual([null, null, null])
    expect(column(ours, 0).some(Number.isNaN) || column(ours, 1).some(Number.isNaN)).toBe(false)
    expect(column(ours, 0)).toEqual(column(ours, 2))                // a weekly bar's week closes when the bar does
    expect(noteCodes(ours)).toEqual([])
    expect(ours.objects.texts.labels).toEqual(['known'])
  })

  it('CONTROL — the same script on the daily capture is drawn and names nothing', () => {
    const ours = on(TC_SPY, pine(['plot(time_close("W"), "w")', 'if barstate.islast', '    label.new(bar_index, high, na(time_close("W")) ? "na" : "known")']))
    expect(column(ours).some(Number.isNaN)).toBe(false)
    expect(ours.objects.texts.labels).toEqual(['known'])
    expect(noteCodes(ours)).toEqual([])
  })
})
