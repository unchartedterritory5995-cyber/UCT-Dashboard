// ─── ⭐⭐ C49 — THE CAPTURED CLOCK: what capture round 3 (2026-10-01) witnesses about
//     `time(<period>)`, `time_close(<period>)`, other chart timeframes ───────────────
//
// C30 served `time("W" | "M" | "3M" | "12M")` on a daily chart as "the first daily bar
// of the period"; C36 found that rule wrong on the Hurricane Sandy week, withheld
// every period it could not vouch for, and added `time_close("W" | "M")`. Round 3
// then captured the same two probes (`vw-time-tf.pine`, `vw-time-close-tf.pine`) on:
//
//   AMEX:SPY 1D, FULL history   8,476 bars from the listing (1993-01-29)
//   AMEX:SPY 1W / 1M            1,758 / 406 bars from the listing
//   AMEX:SPY 15 / 5             3,300 bars each, regular session
//   FX:EURUSD 1D                14,329 bars from 1971
//
// ONE RULE ANSWERS EVERY SPY BAR OF EVERY ONE (and of the 60-minute capture of
// 2026-09-28, which C30 had read as a different rule): `time(<period>)` is 09:30 New
// York on the FIRST session the vendor's calendar holds in the period containing the
// day the bar OPENED; `time_close(<period>)` is the close of the LAST one. The
// calendar is `tradingViewSession.js`'s — no closure before 2000, and not the six
// 9/11 and Sandy days. `indicators.js::computePeriodCalendar` is that rule; section 1
// below checks it against the vendor's numbers with nothing of the engine in between.
//
// WHAT IS SERVED (sections 2–5, through the real member door), and what is not
// (section 6), is `interpret.js::chartClockRegime` / `periodAnchorMask`.
//
// Section 8 is packet #3 — `request.security(tickerid, "D", close)` on a 5-minute
// chart with the newest bar forming (`request-realtime-alignment-spy-5-2026-10-01`
// and `…-b-…`) — and the wrong value it found in the member door: a request for the
// translation's base period folded to its own expression, so on a 5-minute chart
// the pane drew the 5-MINUTE close as the daily one, on 299 of 300 bars.
//
// ⚠️ THE PROBES STAY REFUSED AT THE DOOR on rows outside this lane (T16 `input.time`;
// Q03 / Q04 `time_close("3M" / "12M")`; Q05 `time_close(timeframe.period)`), so each
// replay grades a DERIVED capture — those rows cut, re-sealed — exactly as the C30 and
// C36 rails do. Every number compared is the vendor's.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture } from './harness'
import { runOurSide, toProductBars, tfCodeOf } from './ourSide'
import { validateCapture, sealCapture, sha256Hex } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { translatePine } from '../../ast/pine.js'
import {
  chartClockRegime, periodAnchorNode, periodAnchorGatePeriod, chartSixtyTimeNode, isChartSixtyTime,
  CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE, PERIOD_ANCHOR_WITNESSED_TF, PERIOD_CLOSE_WITNESSED_TF,
  SIXTY_WITNESSED_TF, requestBaseNode, requestBaseOf, interpret, periodAnchorMask,
} from '../../ast/interpret.js'
import {
  computePeriodCalendar, PERIOD_CALENDAR_CODES, barOpenInstant,
} from '../../../indicators.js'
import { LOWER_TF_REFUSAL } from '../../lowerTf.js'
import { lowerTfServingEnabled } from '../../lowerTfGate.js'
import { TRADINGVIEW_CLOSURES_FROM, TRADINGVIEW_UNAPPLIED_CLOSURES, tradingViewCloseMinute } from '../../../../../lib/marketClock/tradingViewSession.js'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', `${name}.json`), 'utf8'))
const CAP = {
  D_T: load('vw-time-tf-spy-1d-full-2026-10-01'),
  D_Q: load('vw-time-close-tf-spy-1d-full-2026-10-01'),
  W_T: load('vw-time-tf-spy-1w-2026-10-01'),
  W_Q: load('vw-time-close-tf-spy-1w-2026-10-01'),
  M_T: load('vw-time-tf-spy-1m-2026-10-01'),
  M_Q: load('vw-time-close-tf-spy-1m-2026-10-01'),
  I15: load('vw-time-tf-spy-15-2026-10-01'),
  I5: load('vw-time-tf-spy-5-2026-10-01'),
  I60: load('vw-time-tf-spy-60-2026-09-28'),
  FX_T: load('vw-time-tf-fx-eurusd-1d-2026-10-01'),
  FX_Q: load('vw-time-close-tf-fx-eurusd-1d-2026-10-01'),
  EXT5: load('vw-clock-vwap-spy-5-ext-2026-09-28'),
  REQ_A: load('request-realtime-alignment-spy-5-2026-10-01'),
  REQ_B: load('request-realtime-alignment-spy-5-b-2026-10-01'),
  D900: load('vw-time-tf-spy-1d-2026-09-28'),
}

const OPEN_ROW = { W: 'T01_timeW_minus_time_DAYS', M: 'T02_timeM_minus_time_DAYS', '3M': 'T03_time3M_minus_time_DAYS', '12M': 'T04_time12M_minus_time_DAYS' }
const OPEN_ROW_Q = { W: 'Q08_timeW_minus_time_DAYS', M: 'Q09_timeM_minus_time_DAYS', '3M': 'Q10_time3M_minus_time_DAYS', '12M': 'Q11_time12M_minus_time_DAYS' }
const CLOSE_ROW = { W: 'Q01_timecloseW_minus_time_DAYS', M: 'Q02_timecloseM_minus_time_DAYS', '3M': 'Q03_timeclose3M_minus_time_DAYS', '12M': 'Q04_timeclose12M_minus_time_DAYS' }
const EVENT_ROW = { W: 'T07_newWeek', M: 'T08_newMonth', '3M': 'T09_newQuarter' }

/** A vendor column, by plot title. */
const vendor = (cap, title) => {
  const c = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
  return cap.plotValues.rows.map((r) => r[c])
}
/** `time + days` as a unix-second instant: what the vendor's `(x - time) / 86400000` row says `x` is. */
const instants = (cap, title) => { const v = vendor(cap, title); return cap.bars.rows.map((r, i) => Math.round(r[0] + v[i] * 86400)) }
/** New York calendar parts of a unix-second instant — this file's own reading, not the engine's. */
const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
const ny = (t) => {
  const p = Object.fromEntries(NY.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]))
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, wd: p.weekday }
}
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
    id: `${capture.id}-c49-derived`,
    source: { ...capture.source, text, sha256: sha256Hex(text), chars: text.length },
    study: { ...capture.study, plots },
    plotValues: { fields: keep.map((i) => capture.plotValues.fields[i]), rows: capture.plotValues.rows.map((r) => keep.map((i) => r[i])) },
  })
}
const T_CUT = ['T16_input_time_default_DAYS']
const Q_CUT = [CLOSE_ROW['3M'], CLOSE_ROW['12M'], 'Q05_timecloseSelf_minus_timeclose_MUST_BE_0']
const pine = (lines) => ['//@version=6', 'indicator("c49", overlay=true)', ...lines].join('\n')
const on = (capture, src) => runOurSide({ ...capture, source: { ...capture.source, text: src } })
const column = (ours, i = 0) => Array.from(ours.plots[i].column)
const noteCodes = (ours) => [...new Set(ours.notes.map((n) => (/withheld \(([a-z:-]+)\)/.exec(n) || [])[1]).filter(Boolean))].sort()
/** The door's verdict on a derived capture: per title, the plot verdict, and OUR withheld bars as dates. */
function grade(capture, cut) {
  const derived = derive(capture, cut)
  const { verdict, integrity } = gradeCapture(derived)
  const ours = runOurSide(derived)
  const dates = capture.bars.rows.map((r) => ny(r[0]).ymd)
  const withheld = (title) => Array.from(ours.plots.find((p) => p.title === title).column)
    .map((v, i) => (Number.isNaN(v) ? dates[i] : null)).filter(Boolean)
  return { byTitle: new Map(verdict.plots.map((p) => [p.title, p])), integrity, withheld, ours }
}

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 1 — the rule, against the vendor\'s own numbers (no member door, no tree: the calendar and the capture)', () => {
  it('the eleven captures verify, and hold what the rule is read from', () => {
    for (const [k, n] of [['D_T', 8476], ['D_Q', 8476], ['W_T', 1758], ['W_Q', 1758], ['M_T', 406], ['M_Q', 406], ['I15', 3300], ['I5', 3300], ['I60', 300], ['FX_T', 14329], ['FX_Q', 14329]]) {
      const v = validateCapture(CAP[k])
      expect(v.ok, `${k}: ${v.errors && v.errors.join('; ')}`).toBe(true)
      expect(CAP[k].bars.rows.length, k).toBe(n)
    }
    expect(CAP.D_T.history.startsAtBar0).toBe(true)
    expect(ny(CAP.D_T.bars.rows[0][0])).toEqual({ ymd: '1993-01-29', hm: '09:30', wd: 'Fri' })
    // the intraday captures are REGULAR-SESSION bars and nothing else
    for (const k of ['I15', 'I5', 'I60']) {
      const hms = CAP[k].bars.rows.map((r) => ny(r[0]).hm)
      expect(hms.every((x) => x >= '09:30' && x < '16:00'), k).toBe(true)
      expect(CAP[k].bars.rows.every((r) => !['Sat', 'Sun'].includes(ny(r[0]).wd)), k).toBe(true)
    }
  })

  const OPENS = [['D_T', OPEN_ROW], ['D_Q', OPEN_ROW_Q], ['W_T', OPEN_ROW], ['W_Q', OPEN_ROW_Q], ['M_T', OPEN_ROW], ['M_Q', OPEN_ROW_Q], ['I15', OPEN_ROW], ['I5', OPEN_ROW], ['I60', OPEN_ROW]]
  for (const [k, rows] of OPENS) {
    it(`⭐ ${CAP[k].id}: time("W" / "M" / "3M" / "12M") is the calendar's first session open on EVERY bar`, () => {
      const cal = computePeriodCalendar(toProductBars(CAP[k]), tfCodeOf(CAP[k].timeframe))
      expect(cal).not.toBeNull()
      for (const code of PERIOD_CALENDAR_CODES) expect(Array.from(cal.open[code]), `${k} ${code}`).toEqual(instants(CAP[k], rows[code]))
    })
  }
  for (const k of ['D_Q', 'W_Q', 'M_Q']) {
    it(`⭐ ${CAP[k].id}: time_close("W" / "M" / "3M" / "12M") is the calendar's last session close on EVERY bar`, () => {
      const cal = computePeriodCalendar(toProductBars(CAP[k]), tfCodeOf(CAP[k].timeframe))
      for (const code of PERIOD_CALENDAR_CODES) expect(Array.from(cal.close[code]), `${k} ${code}`).toEqual(instants(CAP[k], CLOSE_ROW[code]))
    })
  }

  it('the rule is not the first-bar rule: on the full daily capture the two part on 124 / 165 / 414 / 1,497 bars', () => {
    // ⭐ exactly the bars C36 withheld (a period whose first session has no bar) plus
    // the first partial period — and all but the Sandy week's three are before 2000
    const times = CAP.D_T.bars.rows.map((r) => r[0])
    const dates = times.map((t) => ny(t).ymd)
    const cal = computePeriodCalendar(toProductBars(CAP.D_T), 'D')
    const parted = (code) => {
      const out = []
      let first = 0
      for (let i = 0; i < times.length; i++) {
        if (i > 0 && cal.firstDay[code][i] !== cal.firstDay[code][i - 1]) first = i
        if (cal.open[code][i] !== times[first]) out.push(dates[i])
      }
      return out
    }
    const w = parted('W')
    expect([w.length, parted('M').length, parted('3M').length, parted('12M').length]).toEqual([124, 165, 414, 1497])
    expect(w.filter((d) => d >= '2000-01-01')).toEqual(['2012-10-31', '2012-11-01', '2012-11-02'])
    for (const code of ['M', '3M', '12M']) expect(parted(code).filter((d) => d >= '2000-01-01'), code).toEqual([])
  })

  it('⭐ keyed on the day the bar OPENS, not on its week\'s Monday: the three weekly bars that can tell the two apart', () => {
    // a week whose Monday is the last day of a month AND a closure: the bar opens Tuesday the 1st
    const times = CAP.W_T.bars.rows.map((r) => r[0])
    const telling = times.map((t, i) => ({ i, ...ny(t) })).filter((b) => b.wd === 'Tue' && b.ymd.endsWith('-01'))
    expect(telling.map((b) => b.ymd)).toEqual(['2004-06-01', '2010-06-01', '2021-06-01'])
    const mOpen = instants(CAP.W_T, OPEN_ROW.M)
    const mClose = instants(CAP.W_Q, CLOSE_ROW.M)
    for (const b of telling) {
      expect(ny(mOpen[b.i]).ymd, b.ymd).toBe(b.ymd)                               // JUNE's first session — the bar itself
      expect(ny(mClose[b.i]).ymd.slice(0, 7), b.ymd).toBe(b.ymd.slice(0, 7))      // and June's close, not May's
    }
  })

  it('⛔ the boundary is BRACKETED by the capture, and the calendar\'s own constant sits inside the bracket', () => {
    // The vendor answers a holiday it keeps open from the CALENDAR, one it closes from
    // the BARS. Read off the daily capture alone: the last period it answers from the
    // calendar, and the first holiday week it answers from the bars.
    const times = CAP.D_Q.bars.rows.map((r) => r[0])
    const dates = times.map((t) => ny(t).ymd)
    const wOpen = instants(CAP.D_Q, OPEN_ROW_Q.W)
    const wClose = instants(CAP.D_Q, CLOSE_ROW.W)
    const barClose = instants(CAP.D_Q, 'Q07_timeclose_minus_time_DAYS_CONTROL')
    const monday = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
    const calendarAnswered = []      // weeks whose close the vendor reads is NOT the last bar's close
    const barsAnswered = []          // weeks that open on a Tuesday bar AND read that bar
    for (let i = 0; i < times.length; i++) {
      const last = i + 1 === times.length || monday(dates[i + 1]) !== monday(dates[i])
      if (last && i + 1 < times.length && wClose[i] !== barClose[i]) calendarAnswered.push(ny(wClose[i]).ymd)
      const firstOfWeek = i > 0 && monday(dates[i - 1]) !== monday(dates[i])
      if (firstOfWeek && ny(times[i]).wd !== 'Mon' && wOpen[i] === times[i]) barsAnswered.push(dates[i])
    }
    const lastCalendar = calendarAnswered.filter((d) => d < '2001-01-01').pop()
    expect(lastCalendar).toBe('1999-12-24')                    // Christmas, observed on a Friday: no bar, and the week closes on it
    expect(barsAnswered[0]).toBe('2000-01-18')                 // the Tuesday after MLK Monday: the first holiday week read off the bars
    expect(TRADINGVIEW_CLOSURES_FROM > lastCalendar && TRADINGVIEW_CLOSURES_FROM <= barsAnswered[0]).toBe(true)
    // and from that boundary on, the only weeks the vendor answers from the calendar are the two it never closed
    expect(calendarAnswered.filter((d) => d >= '2000-01-01')).toEqual(['2001-09-14'])
    expect(TRADINGVIEW_UNAPPLIED_CLOSURES.map((c) => c.date)).toEqual(['2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14', '2012-10-29', '2012-10-30'])
  })

  it('`time_close("D")` on a weekly / monthly chart is the close of the bar\'s FIRST day, `time_close(timeframe.period)` its own close', () => {
    for (const k of ['W_Q', 'M_Q']) {
      const barClose = instants(CAP[k], 'Q07_timeclose_minus_time_DAYS_CONTROL')
      const d = vendor(CAP[k], 'Q06_timecloseD_minus_timeclose_DAYS')
      CAP[k].bars.rows.forEach((r, i) => {
        const dayClose = ny(Math.round(barClose[i] + d[i] * 86400))
        expect(dayClose.ymd, `${k} ${i}`).toBe(ny(r[0]).ymd)
      })
      expect(new Set(vendor(CAP[k], 'Q05_timecloseSelf_minus_timeclose_MUST_BE_0')), k).toEqual(new Set([0]))
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 2 — AMEX:SPY 1D from the listing, through the real member door: 8,476 bars from 1993', () => {
  const T = grade(CAP.D_T, T_CUT)
  const Q = grade(CAP.D_Q, Q_CUT)
  const SANDY = ['2012-10-31', '2012-11-01', '2012-11-02']

  it('the derived captures are sealed and valid; as captured each still refuses on a row outside this lane, by name', () => {
    expect(T.integrity.ok && Q.integrity.ok).toBe(true)
    expect(gradeCapture(CAP.D_T).verdict.reason).toMatch(/member door refused \(pine:input-kind\)/)
    expect(gradeCapture(CAP.D_Q).verdict.reason).toMatch(/time_close\("3M"\)/)
  })

  it('⭐ PRIORITY 0 — nothing the door serves contradicts the full-history capture: 0 value mismatches on every row of both', () => {
    for (const g of [T, Q]) for (const [title, p] of g.byTitle) if (p.stats) expect(p.stats.valueMismatches, title).toBe(0)
  })

  for (const code of ['M', '3M', '12M']) {
    it(`time("${code}") − time: equal to TradingView on all 8,476 bars — the pre-2000 holiday periods and the first partial one included`, () => {
      for (const [g, rows] of [[T, OPEN_ROW], [Q, OPEN_ROW_Q]]) {
        expect(g.byTitle.get(rows[code]).verdict, rows[code]).toBe('MATCH')
        expect(g.byTitle.get(rows[code]).stats, rows[code]).toMatchObject({ matching: 8476, valueMismatches: 0, naMismatches: 0 })
      }
    })
  }

  // ⭐ RULING (integrator, 2026-10-01): the Sandy week is SERVED. This read 8,473 equal and three
  // withheld (`time-anchor:session-open-missing`); the capture holds those three bars and the
  // calendar reproduces them, which is a witness. The rail grades them against the fixture.
  it('time("W") − time: equal to TradingView on all 8,476 bars — the Hurricane Sandy week reads Monday 2012-10-29, a day with no bar', () => {
    for (const [g, rows] of [[T, OPEN_ROW], [Q, OPEN_ROW_Q]]) {
      expect(g.byTitle.get(rows.W).verdict, rows.W).toBe('MATCH')
      expect(g.byTitle.get(rows.W).stats, rows.W).toMatchObject({ matching: 8476, valueMismatches: 0, naMismatches: 0 })
      expect(g.withheld(rows.W), rows.W).toEqual([])
    }
    expect(noteCodes(T.ours)).toEqual([])
    // the three bars themselves, the vendor's number and ours, through the door
    const v = vendor(CAP.D_T, OPEN_ROW.W)
    const dates = CAP.D_T.bars.rows.map((r) => ny(r[0]).ymd)
    expect(SANDY.map((d) => v[dates.indexOf(d)])).toEqual([-2, -3, -4])
    const ours = Array.from(T.ours.plots.find((p) => p.title === OPEN_ROW.W).column)
    expect(SANDY.map((d) => ours[dates.indexOf(d)])).toEqual([-2, -3, -4])
    expect(dates.includes('2012-10-29') || dates.includes('2012-10-30')).toBe(false)
  })

  it('the bars this lane lifted are real: 31 holiday-opened weeks before 2000 read the calendar\'s Monday, not the first bar', () => {
    const v = vendor(CAP.D_T, OPEN_ROW.W)
    const times = CAP.D_T.bars.rows.map((r) => r[0])
    // a week's first bar that does NOT read 0 days: the vendor's week opened before it
    const opened = []
    for (let i = 0; i < times.length; i++) {
      const firstOfWeek = i === 0 || Math.round(times[i] + v[i] * 86400) !== Math.round(times[i - 1] + v[i - 1] * 86400)
      if (firstOfWeek && v[i] !== 0) opened.push(ny(times[i]).ymd)
    }
    expect(opened.filter((d) => d < '2000-01-01').length).toBe(31)                 // the listing week, and 30 holiday Mondays
    expect(opened.filter((d) => d >= '2000-01-01')).toEqual(['2012-10-31'])
    expect(opened).toContain('1999-01-19')
    expect(v[CAP.D_T.bars.rows.findIndex((r) => ny(r[0]).ymd === '1999-01-19')]).toBe(-1)   // MLK Monday 1999-01-18
    expect(v[0]).toBe(-4)                                                          // Fri 1993-01-29 → Mon 01-25, before the listing
    // each is served, and equal: the row MATCHes on every bar, Sandy's included (above)
  })

  // ⭐ H5 (step 84) re-pin: this read "equal on every bar but bar 0 (it reads the
  // anchor of a bar before the series)", bar 0 withheld. This series STARTS AT THE
  // LISTING (1993-01-29), so there is no bar before it: bar 0 reads Pine's `na`,
  // which is what TradingView answers too — served and equal on every bar.
  it('the new-period events: equal on EVERY bar, bar 0 included (from the listing there is no bar before the series) — the Sandy week\'s four included', () => {
    for (const code of ['W', 'M', '3M']) {
      expect(T.withheld(EVENT_ROW[code]), code).toEqual([])
      expect(T.byTitle.get(EVENT_ROW[code]).stats, code).toMatchObject({ valueMismatches: 0, naMismatches: 0 })
    }
  })

  it('time_close("M"): all 8,476 bars — May 1993 and May 1999 close on Memorial Day, a day with no bar', () => {
    expect(Q.byTitle.get(CLOSE_ROW.M).verdict).toBe('MATCH')
    expect(Q.byTitle.get(CLOSE_ROW.M).stats).toMatchObject({ matching: 8476, valueMismatches: 0, naMismatches: 0 })
    const close = instants(CAP.D_Q, CLOSE_ROW.M)
    const dates = CAP.D_Q.bars.rows.map((r) => ny(r[0]).ymd)
    expect(ny(close[dates.indexOf('1999-05-28')])).toEqual({ ymd: '1999-05-31', hm: '16:00', wd: 'Mon' })
    expect(dates.includes('1999-05-31')).toBe(false)
    expect(Q.byTitle.get('Q13_newMonthClose').verdict).toBe('MATCH')
  })

  // ⭐ RULING (integrator, 2026-10-01): the week of 2001-09-10 is SERVED (was 8,475 equal, one bar
  // withheld as `time-close:period-end-missing`).
  it('time_close("W"): equal to TradingView on all 8,476 bars — Monday 2001-09-10 reads Friday 09-14 16:00, four sessions with no bar later', () => {
    expect(Q.byTitle.get(CLOSE_ROW.W).verdict).toBe('MATCH')
    expect(Q.byTitle.get(CLOSE_ROW.W).stats).toMatchObject({ matching: 8476, valueMismatches: 0, naMismatches: 0 })
    expect(Q.withheld(CLOSE_ROW.W)).toEqual([])
    expect(Q.byTitle.get('Q12_newWeekClose').verdict).toBe('MATCH')
    expect(Q.withheld('Q12_newWeekClose')).toEqual([])
    expect(noteCodes(Q.ours)).toEqual([])
    const v = vendor(CAP.D_Q, CLOSE_ROW.W)
    const dates = CAP.D_Q.bars.rows.map((r) => ny(r[0]).ymd)
    const ours = Array.from(Q.ours.plots.find((p) => p.title === CLOSE_ROW.W).column)
    const i = dates.indexOf('2001-09-10')
    expect(dates[i + 1]).toBe('2001-09-17')
    expect(v[i]).toBeCloseTo(4.2708, 4)                       // Mon 09:30 → Fri 16:00
    expect(ours[i]).toBeCloseTo(v[i], 9)
    // Thu 1999-04-01 reads 1.2708 days — Good Friday 16:00, a day with no bar
    expect(v[dates.indexOf('1999-04-01')]).toBeCloseTo(1.2708, 4)
  })

  it('⭐ the two weeks are NOT a second rule — they are the calendar\'s six unapplied closures, and a calendar that applied them answers both wrong', () => {
    const bars = toProductBars(CAP.D_Q)
    const cal = computePeriodCalendar(bars, 'D')
    const at = (ymd) => bars.findIndex((b) => b.t === ymd)
    for (const d of SANDY) expect(cal.open.W[at(d)], d).toBe(instants(CAP.D_Q, OPEN_ROW_Q.W)[at(d)])
    expect(ny(cal.open.W[at('2012-10-31')])).toEqual({ ymd: '2012-10-29', hm: '09:30', wd: 'Mon' })
    expect(cal.close.W[at('2001-09-10')]).toBe(instants(CAP.D_Q, CLOSE_ROW.W)[at('2001-09-10')])
    expect(ny(cal.close.W[at('2001-09-10')])).toEqual({ ymd: '2001-09-14', hm: '16:00', wd: 'Fri' })
    // the six days are sessions to this calendar, and NYSE closures to the exchange's
    for (const c of TRADINGVIEW_UNAPPLIED_CLOSURES) expect(tradingViewCloseMinute(Number(c.date.replace(/-/g, ''))), c.date).toBe(960)
  })

  it('`time(timeframe.period)` and `time("60")` equal `time` on all 8,476 bars', () => {
    for (const title of ['T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
      expect(T.byTitle.get(title).verdict, title).toBe('MATCH')
      expect(T.byTitle.get(title).stats, title).toMatchObject({ matching: 8476, valueMismatches: 0, naMismatches: 0 })
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 3 — AMEX:SPY 1W and 1M: a period request is keyed on the bar\'s OPENING day', () => {
  for (const [kt, kq, n, tf] of [['W_T', 'W_Q', 1758, '1W'], ['M_T', 'M_Q', 406, '1M']]) {
    const T = grade(CAP[kt], T_CUT)
    const Q = grade(CAP[kq], Q_CUT)
    it(`${tf}: the four opens, the two own-time rows, both closes and their events — equal to TradingView on all ${n} bars`, () => {
      expect(T.integrity.ok && Q.integrity.ok).toBe(true)
      for (const title of [...Object.values(OPEN_ROW), 'T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
        expect(T.byTitle.get(title).verdict, title).toBe('MATCH')
        expect(T.byTitle.get(title).stats, title).toMatchObject({ matching: n, valueMismatches: 0, naMismatches: 0 })
      }
      for (const title of [CLOSE_ROW.W, CLOSE_ROW.M, ...Object.values(OPEN_ROW_Q), 'Q12_newWeekClose', 'Q13_newMonthClose',
        'Q06_timecloseD_minus_timeclose_DAYS', 'Q07_timeclose_minus_time_DAYS_CONTROL']) {
        expect(Q.byTitle.get(title).verdict, title).toBe('MATCH')
        expect(Q.byTitle.get(title).stats, title).toMatchObject({ matching: n, valueMismatches: 0, naMismatches: 0 })
      }
      expect(noteCodes(T.ours)).toEqual([])
      expect(noteCodes(Q.ours)).toEqual([])
    })
    // ⭐ H5 (step 84) re-pin: "bar 0 alone is withheld" — from the listing it is not.
    it(`${tf}: the new-period events fire where TradingView's do, on every bar from the listing`, () => {
      expect(CAP[kt].history.startsAtBar0).toBe(true)
      for (const code of ['W', 'M', '3M']) {
        expect(T.byTitle.get(EVENT_ROW[code]).stats, code).toMatchObject({ matching: n, valueMismatches: 0, naMismatches: 0 })
        expect(T.withheld(EVENT_ROW[code]), code).toEqual([])
      }
    })
  }

  it('the rows are not trivial: on 1W the month open equals `time` on 180 of 1,758 bars; on 1M the week close NEVER equals the bar\'s close', () => {
    expect(vendor(CAP.W_T, OPEN_ROW.M).filter((x) => x === 0).length).toBe(180)
    expect(vendor(CAP.W_T, OPEN_ROW.W).every((x) => x === 0)).toBe(true)
    const barClose = vendor(CAP.M_Q, 'Q07_timeclose_minus_time_DAYS_CONTROL')
    expect(vendor(CAP.M_Q, CLOSE_ROW.W).filter((x, i) => x === barClose[i]).length).toBe(0)
    expect(vendor(CAP.M_Q, CLOSE_ROW.M).every((x, i) => x === barClose[i])).toBe(true)
  })

  it('⭐ the weekly chart holds the Sandy week and the week of 2001-09-10 as ordinary bars, and serves them: Monday 10-29, and Friday 09-14 16:00', () => {
    const dates = CAP.W_T.bars.rows.map((r) => ny(r[0]).ymd)
    expect(dates).toContain('2012-10-29')
    expect(dates).toContain('2001-09-10')
    const ours = on(CAP.W_Q, pine(['plot(time("W"), "o")', 'plot(time_close("W"), "c")']))
    expect(noteCodes(ours)).toEqual([])
    expect(ny(column(ours, 0)[dates.indexOf('2012-10-29')] / 1000)).toEqual({ ymd: '2012-10-29', hm: '09:30', wd: 'Mon' })
    expect(ny(column(ours, 1)[dates.indexOf('2001-09-10')] / 1000)).toEqual({ ymd: '2001-09-14', hm: '16:00', wd: 'Fri' })
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 4 — AMEX:SPY 15, 5 and 60 minutes: the period opens at 09:30 of its first session; `time("60")` is a 60-minute bucket', () => {
  for (const [k, n] of [['I15', 3300], ['I5', 3300], ['I60', 300]]) {
    const T = grade(CAP[k], T_CUT)
    it(`${CAP[k].id}: every period row and both own-time rows equal TradingView on all ${n} bars`, () => {
      expect(T.integrity.ok).toBe(true)
      for (const title of [...Object.values(OPEN_ROW), 'T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
        expect(T.byTitle.get(title).verdict, title).toBe('MATCH')
        expect(T.byTitle.get(title).stats, title).toMatchObject({ matching: n, valueMismatches: 0, naMismatches: 0 })
      }
      for (const code of ['W', 'M', '3M']) {
        expect(T.byTitle.get(EVENT_ROW[code]).stats, code).toMatchObject({ matching: n - 1, valueMismatches: 0, naMismatches: 1 })
      }
      // wave 12 (C45): the probe's `bar_index` control row is withheld by name on these windows
      // (they do not start at the listing); every clock row above is still MATCH on every bar.
      expect(noteCodes(T.ours)).toEqual(['bar-index:window'])
    })
  }

  it('the anchors are opens the window does not hold: on the 5-minute capture the year opened Fri 2026-01-02 09:30, 213 days before bar 0', () => {
    const y = instants(CAP.I5, OPEN_ROW['12M'])
    expect(new Set(y.map((t) => `${ny(t).ymd} ${ny(t).hm}`))).toEqual(new Set(['2026-01-02 09:30']))
    expect(ny(CAP.I5.bars.rows[0][0]).ymd).toBe('2026-08-03')
    // …and a holiday week: Labor Day Monday 2026-09-07 is a closure — the week opens Tuesday 09:30
    const ev = vendor(CAP.I5, EVENT_ROW.W).map((v, i) => (v === 1 ? ny(CAP.I5.bars.rows[i][0]) : null)).filter(Boolean)
    expect(ev.map((e) => `${e.ymd} ${e.wd} ${e.hm}`)).toContain('2026-09-08 Tue 09:30')
    expect(ev.every((e) => e.hm === '09:30')).toBe(true)
  })

  it('⭐ `time("60")` is NOT `time` below 60 minutes: the 60-minute bucket from 09:30 — equal to `time` on 888 / 296 of 3,300 bars', () => {
    for (const [k, same, slots] of [['I15', 888, 26], ['I5', 296, 78]]) {
      const got = instants(CAP[k], 'T06_time60_minus_time_DAYS')
      const times = CAP[k].bars.rows.map((r) => r[0])
      expect(got.filter((t, i) => t === times[i]).length, k).toBe(same)
      // every bar's bucket opens on a half hour, 09:30 .. 15:30, at or before the bar, less than an hour back
      expect(new Set(got.map((t) => ny(t).hm)), k).toEqual(new Set(['09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30']))
      expect(got.every((t, i) => times[i] - t >= 0 && times[i] - t < 3600), k).toBe(true)
      expect(new Set(times.map((t) => ny(t).hm)).size, k).toBe(slots)
      expect(new Set(vendor(CAP[k], 'T05_timeSelf_minus_time_MUST_BE_0')), k).toEqual(new Set([0]))
    }
  })

  it('the object lane: a last-bar label prints the vendor\'s own week and year offsets on the 5-minute chart', () => {
    const ours = on(CAP.I5, pine([
      'if barstate.islast',
      '    label.new(bar_index, high, str.tostring((time("W") - time) / 60000) + " " + str.tostring((time("12M") - time) / 60000))',
    ]))
    expect(ours.objects.ok).toBe(true)
    const last = CAP.I5.bars.rows.length - 1
    const mins = (title) => Math.round(vendor(CAP.I5, title)[last] * 1440)
    expect(ours.objects.texts.labels).toEqual([`${mins(OPEN_ROW.W)} ${mins(OPEN_ROW['12M'])}`])
    expect(ours.objects.chartClock).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 5 — the regime: which charts the calendar answers', () => {
  const col = (n, v) => Float64Array.from({ length: n }, () => v)
  it('session / every-day / one weekend day / outside the session / unreadable / unwitnessed — by the bars, never by a symbol name', () => {
    const weekday = [2, 3, 4, 5, 6]
    const rth = (tf) => chartClockRegime(tf, Float64Array.from(weekday), col(5, 9), col(5, 30)).kind
    expect(PERIOD_ANCHOR_WITNESSED_TF).toEqual(['5', '15', '60', 'D', 'W', 'M'])
    expect(PERIOD_CLOSE_WITNESSED_TF).toEqual(['D', 'W', 'M'])
    for (const tf of PERIOD_ANCHOR_WITNESSED_TF) expect(rth(tf), tf).toBe('session')
    for (const tf of ['1', '30', '240', undefined, null, 'X']) expect(rth(tf), String(tf)).toBe('unwitnessed')
    expect(chartClockRegime('D', Float64Array.from([2, 7, 1, 2]), col(4, 9), col(4, 30)).kind).toBe('every-day')
    expect(chartClockRegime('D', Float64Array.from([2, 7, 2]), col(3, 9), col(3, 30)).kind).toBe('one-weekend-day')
    expect(chartClockRegime('D', Float64Array.from([6, 1, 2]), col(3, 9), col(3, 30)).kind).toBe('one-weekend-day')
    expect(chartClockRegime('D', Float64Array.from([2, NaN, 4]), col(3, 9), col(3, 30)).kind).toBe('unreadable')
    // an intraday chart: 09:30 ≤ bar open < 16:00, Monday..Friday — or it is not the session the captures hold
    for (const [h, m, kind] of [[9, 30, 'session'], [15, 55, 'session'], [9, 25, 'outside-session'], [16, 0, 'outside-session'], [4, 0, 'outside-session'], [19, 55, 'outside-session']]) {
      expect(chartClockRegime('5', Float64Array.from([2]), col(1, h), col(1, m)).kind, `${h}:${m}`).toBe(kind)
    }
    expect(chartClockRegime('15', Float64Array.from([2, 1]), col(2, 10), col(2, 0)).kind).toBe('outside-session')
  })

  it('⛔ a 5-minute chart WITH extended hours (the product\'s default): the periods and `time("60")` are withheld whole, and named', () => {
    const hms = CAP.EXT5.bars.rows.map((r) => ny(r[0]).hm)
    expect(hms.some((x) => x < '09:30') && hms.some((x) => x >= '16:00')).toBe(true)
    const ours = on(CAP.EXT5, pine(['plot(time("W"), "w")', 'plot(time("12M"), "y")', 'plot(time("60"), "s")', 'plot(time(timeframe.period), "own")',
      'if barstate.islast', '    label.new(bar_index, high, na(time("M")) ? "na" : "known")']))
    expect(ours.ok, ours.refusal).toBe(true)
    for (const i of [0, 1, 2]) expect(column(ours, i).every(Number.isNaN), String(i)).toBe(true)
    expect(column(ours, 3).some(Number.isNaN)).toBe(false)
    expect(noteCodes(ours)).toEqual(['time-clock:outside-session'])
    expect(ours.objects.counts.labels).toBe(0)
    expect(ours.objects.chartClock).toEqual([{ code: 'time-clock:outside-session', reason: CHART_CLOCK_WITHHELD['time-clock:outside-session']('5') }])
    expect(CHART_CLOCK_WHOLE).toContain('time-clock:outside-session')
    expect(CHART_CLOCK_WITHHELD['time-clock:outside-session']('5')).toMatch(/With extended hours switched off it draws/)
  })

  it('CONTROL — the same script on the regular-session 5-minute capture is drawn on every bar, and names nothing', () => {
    const ours = on(CAP.I5, pine(['plot(time("W"), "w")', 'plot(time("12M"), "y")', 'plot(time("60"), "s")', 'plot(time(timeframe.period), "own")',
      'if barstate.islast', '    label.new(bar_index, high, na(time("M")) ? "na" : "known")']))
    for (const i of [0, 1, 2, 3]) expect(column(ours, i).some(Number.isNaN), String(i)).toBe(false)
    expect(noteCodes(ours)).toEqual([])
    expect(ours.objects.texts.labels).toEqual(['known'])
  })

  it('`time_close(<period>)` below a daily chart was not captured: withheld whole, by name, on the regular-session 15-minute chart', () => {
    const ours = on(CAP.I15, pine(['plot(time_close("W"), "w")']))
    expect(ours.ok, ours.refusal).toBe(true)
    expect(column(ours).every(Number.isNaN)).toBe(true)
    expect(noteCodes(ours)).toEqual(['time-close:not-daily'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 6 — FX:EURUSD 1D: MEASURED, and left withheld — this chart\'s clock is not the vendor\'s there', () => {
  const times = CAP.FX_T.bars.rows.map((r) => r[0])
  const parts = times.map(ny)

  it('what the capture shows: every daily bar opens 17:00 New York, Sunday to Thursday, and spans exactly one day', () => {
    expect(new Set(parts.map((p) => p.hm))).toEqual(new Set(['17:00']))
    expect(new Set(parts.map((p) => p.wd))).toEqual(new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu']))
    expect(new Set(vendor(CAP.FX_Q, 'Q07_timeclose_minus_time_DAYS_CONTROL'))).toEqual(new Set([1]))
    // `dayofweek` is the OPENING day in the exchange zone: 1 (Sunday) on the Sunday-evening bar
    const dow = vendor(CAP.FX_T, 'T17_dayofweek')
    const want = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5 }
    expect(dow.every((d, i) => d === want[parts[i].wd])).toBe(true)
    expect(dow.filter((d) => d === 1).length).toBe(2813)
  })

  it('the week opens on the calendar\'s Sunday 17:00 (not the first bar: 371 bars part), and closes Friday 17:00; the month follows the TRADING day', () => {
    const w = instants(CAP.FX_T, OPEN_ROW.W)
    expect(new Set(w.map((t) => ny(t).hm))).toEqual(new Set(['17:00']))
    const sunday = w.filter((t) => ny(t).wd === 'Sun').length
    expect([sunday, w.length - sunday]).toEqual([14321, 8])                 // 8 bars of two Christmas weeks open Monday 17:00
    const c = instants(CAP.FX_Q, CLOSE_ROW.W)
    expect(c.filter((t) => ny(t).wd === 'Fri' && ny(t).hm === '17:00').length).toBe(14325)
    // the bar opening Mon 2026-08-31 17:00 is SEPTEMBER's first: its month opens on itself
    const i = parts.findIndex((p) => p.ymd === '2026-08-31')
    expect(instants(CAP.FX_T, OPEN_ROW.M)[i]).toBe(times[i])
    expect(vendor(CAP.FX_T, 'T08_newMonth')[i]).toBe(1)
  })

  it('⛔ this chart cannot stamp such a bar: a date-keyed daily bar opens 09:30 New York on its date — 16.5 hours from the vendor\'s open, and never on a Sunday', () => {
    // the vendor's bar for the trading day Mon 2026-09-28 opens Sun 09-27 17:00 New York
    const i = parts.findIndex((p) => p.ymd === '2026-09-27')
    expect(parts[i]).toEqual({ ymd: '2026-09-27', hm: '17:00', wd: 'Sun' })
    const ours = barOpenInstant('2026-09-28', 'D')
    expect(ny(ours)).toEqual({ ymd: '2026-09-28', hm: '09:30', wd: 'Mon' })
    expect((ours - times[i]) / 3600).toBe(16.5)
    // …and keyed by the vendor's own opening date instead, it would be a Sunday 09:30 bar: 7.5 hours early
    expect((times[i] - barOpenInstant('2026-09-27', 'D')) / 3600).toBe(7.5)
  })

  it('so the door withholds it whole, and says why: one weekend day but not the other — anchors and closes, plots and labels', () => {
    // the capture's last 3,000 bars (2015 →): the full series reaches back before 1990, where no clock is read at all
    const recent = (cap) => ({ ...cap, bars: { ...cap.bars, rows: cap.bars.rows.slice(-3000) }, plotValues: { ...cap.plotValues, rows: cap.plotValues.rows.slice(-3000) } })
    const ours = on(recent(CAP.FX_Q), pine(['plot(time("W"), "w")', 'plot(time("M"), "m")', 'plot(time_close("W"), "c")',
      'if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    expect(ours.ok, ours.refusal).toBe(true)
    for (const k of [0, 1, 2]) expect(column(ours, k).every(Number.isNaN), String(k)).toBe(true)
    expect(noteCodes(ours)).toEqual(['time-anchor:weekend-bars', 'time-close:weekend-bars'])
    expect(ours.objects.counts.labels).toBe(0)
    expect(CHART_CLOCK_WITHHELD['time-anchor:weekend-bars']()).toMatch(/vw-time-tf-fx-eurusd-1d-2026-10-01/)
    expect(CHART_CLOCK_WITHHELD['time-anchor:weekend-bars']()).toMatch(/17:00 New York the evening\s+before/)
    // the whole capture (from 1971): no readable clock, withheld whole and named — and that covers the own-time rows too
    const all = on(CAP.FX_T, pine(['plot(time("W"), "w")', 'plot(na(time(timeframe.period)) ? 111 : 222, "own")']))
    expect(column(all, 0).every(Number.isNaN) && column(all, 1).every(Number.isNaN)).toBe(true)
    expect(noteCodes(all)).toEqual(['time-clock:unreadable'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 7 — the trees, and what stays refused by name', () => {
  const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)

  it('the anchor tree is ONE builder\'s — the tree C30 wrote, so a saved document is recognised; and the recogniser is exact', () => {
    for (const [tf, period] of [['"W"', 'W'], ['"1W"', 'W'], ['"M"', 'M'], ['"3M"', '3M'], ['"12M"', '12M']]) {
      const t = S(`plot(time(${tf}))`, { strict: true })
      expect(t.ok, tf).toBe(true)
      expect(t.outputs[t.selected].ast, tf).toEqual(periodAnchorNode(period, true))
      expect(periodAnchorGatePeriod(t.outputs[t.selected].ast), tf).toBe(period)
    }
    expect(periodAnchorNode('W', true).args[0]).toEqual({ type: 'op', name: '==', args: [{ type: 'series', name: 'periodseconds' }, { type: 'num', value: 86400 }] })
    expect(periodAnchorNode('2W', true)).toBeNull()
    // one literal different is a member's own tree, and keeps its own meaning
    expect(periodAnchorGatePeriod(JSON.parse(JSON.stringify(periodAnchorNode('W', true)).replace('86400', '3600')))).toBeNull()
    expect(periodAnchorGatePeriod(periodAnchorNode('W', true).args[1])).toBeNull()
  })

  it('`time("60")` has its own tree: the 09:30-anchored hour bucket below 60 minutes, the bar\'s time at or above, blank anywhere else', () => {
    const t = S('plot(time("60"))', { strict: true })
    expect(t.outputs[t.selected].formula).toBe('(periodseconds == 300 || periodseconds == 900 '
      + '? dayopentime + 34200 + floor((time - (dayopentime + 34200)) / 3600) * 3600 '
      + ': periodseconds == 3600 || periodseconds == 86400 || periodseconds == 604800 || periodseconds == 2628003 ? time : 0 / 0) * 1000')
    expect(isChartSixtyTime(chartSixtyTimeNode(false))).toBe(true)
    expect(isChartSixtyTime(JSON.parse(JSON.stringify(chartSixtyTimeNode(true)).replace('34200', '36000')))).toBe(false)
    expect(SIXTY_WITNESSED_TF).toEqual(['5', '15', '60', 'D', 'W', 'M'])
  })

  it('refused by name: any other literal, the quarter / year close, `time_close(timeframe.period)`, a screen, an unmeasured told chart', () => {
    for (const body of ['plot(time("15"))', 'plot(time("30"))', 'plot(time("240"))', 'plot(time("1H"))', 'plot(time("2W"))', 'plot(time("6M"))',
      'plot(time_close("3M"))', 'plot(time_close("12M"))', 'plot(time_close(timeframe.period))', 'plot(time_close("60"))']) {
      const t = S(body, { strict: true })
      expect(t.ok, body).toBe(false)
      expect(t.refusal.guard, body).toBe('pine:function')
    }
    for (const base of ['1', '30', '240']) {
      for (const body of ['plot(time("W"))', 'plot(time("60"))', 'plot(time(timeframe.period))', 'plot(time_close("W"))']) {
        expect(S(body, { strict: true, basePeriod: base }).ok, `${body} on ${base}`).toBe(false)
      }
    }
    expect(S('plot(time_close("W"))', { strict: true, basePeriod: '15' }).refusal.message).toMatch(/measured on 1D, 1W and 1M charts only/)
    expect(S('plot(time("W"))', {}).ok).toBe(false)
  })

  it('every withholding has a sentence that says what is withheld and what would settle it', () => {
    for (const [code, say] of Object.entries(CHART_CLOCK_WITHHELD)) {
      expect(say('5'), code).toMatch(/withheld/)
      expect(say('5'), code).toMatch(/What would settle it/)
    }
    for (const code of CHART_CLOCK_WHOLE) expect(Object.keys(CHART_CLOCK_WITHHELD), code).toContain(code)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 8 — packet #3: `request.security(tickerid, "D", close)` on AMEX:SPY 5 minutes, the newest bar forming', () => {
  const A = CAP.REQ_A
  const B = CAP.REQ_B
  const R = (cap) => ({
    on: vendor(cap, 'R1_close_D_lookahead_ON'), off: vendor(cap, 'R2_close_D_lookahead_OFF'), prev: vendor(cap, 'R7_prev_D_close_OFF'),
    rt: vendor(cap, 'R4_isrealtime'), last: vendor(cap, 'R5_islast'), close: vendor(cap, 'R6_chart_close'),
    day: cap.bars.rows.map((r) => ny(r[0]).ymd), hm: cap.bars.rows.map((r) => ny(r[0]).hm),
  })
  const a = R(A)
  const b = R(B)

  it('the two captures verify: 300 and 301 five-minute bars, the newest forming, taken 2 minutes apart during regular hours', () => {
    for (const cap of [A, B]) expect(validateCapture(cap).ok).toBe(true)
    expect([A.bars.rows.length, B.bars.rows.length]).toEqual([300, 301])
    expect(A.newestBarIsForming && B.newestBarIsForming).toBe(true)
    expect(A.capturedAtUTC.slice(0, 16)).toBe('2026-10-01T19:53')
    expect(B.capturedAtUTC.slice(0, 16)).toBe('2026-10-01T19:55')
    expect(a.rt.filter((x) => x === 1).length).toBe(1)
    expect(b.rt.filter((x) => x === 1).length).toBe(2)
  })

  it('⭐ HISTORICAL bars of a finished day: look-ahead ON is that day\'s DAILY close on every bar; OFF is the previous day\'s, except on the day\'s last bar', () => {
    const closeOf = {}                                          // the daily close each finished day shows (ON)
    for (const d of ['2026-09-28', '2026-09-29', '2026-09-30']) {
      const on = new Set(b.on.filter((_, i) => b.day[i] === d))
      expect(on.size, d).toBe(1)
      closeOf[d] = [...on][0]
    }
    expect(closeOf).toEqual({ '2026-09-28': 765.61, '2026-09-29': 764.2, '2026-09-30': 762.63 })
    for (const [d, before] of [['2026-09-29', '2026-09-28'], ['2026-09-30', '2026-09-29']]) {
      const idx = b.day.map((x, i) => (x === d ? i : -1)).filter((i) => i >= 0)
      const lastBar = idx[idx.length - 1]
      expect(b.hm[lastBar], d).toBe('15:55')
      for (const i of idx.slice(0, -1)) expect(b.off[i], `${d} ${b.hm[i]}`).toBe(closeOf[before])
      expect(b.off[lastBar], d).toBe(closeOf[d])
    }
    // R7 — `close[1]` of the daily bar, look-ahead off: one day further back, switching on the same bar
    const i30 = b.day.map((x, i) => (x === '2026-09-30' ? i : -1)).filter((i) => i >= 0)
    expect(new Set(i30.slice(0, -1).map((i) => b.prev[i]))).toEqual(new Set([closeOf['2026-09-28']]))
    expect(b.prev[i30[i30.length - 1]]).toBe(closeOf['2026-09-29'])
  })

  it('⭐ the daily close is the DAILY bar\'s, not the last 5-minute bar\'s: 762.63 against 762.46 on 2026-09-30', () => {
    const last = b.day.lastIndexOf('2026-09-30')
    expect(b.hm[last]).toBe('15:55')
    expect(b.close[last]).toBe(762.46)
    expect(b.on[last]).toBe(762.63)
  })

  it('⭐ THE FORMING BAR: look-ahead ON and OFF read the same number — the forming daily bar\'s current close; a bar that closed in realtime keeps its final value', () => {
    const n = a.on.length - 1
    expect([a.rt[n], a.last[n]]).toEqual([1, 1])
    expect([a.on[n], a.off[n], a.close[n]]).toEqual([765.03, 765.03, 765.03])
    expect(a.prev[n]).toBe(762.63)                              // `close[1]`, off: yesterday's close
    // today's HISTORICAL bars (loaded before the capture): ON is today's daily close as it stood then, OFF yesterday's
    const today = a.day.map((x, i) => (x === '2026-10-01' && a.rt[i] === 0 ? i : -1)).filter((i) => i >= 0)
    expect(today.length).toBe(76)
    expect(new Set(today.map((i) => a.on[i]))).toEqual(new Set([765.08]))
    expect(new Set(today.map((i) => a.off[i]))).toEqual(new Set([762.63]))
    // two minutes later: the 15:50 bar has closed (still `isrealtime`) and reads its final close; the new one forms
    expect([b.on[299], b.off[299], b.close[299], b.rt[299]]).toEqual([764.52, 764.52, 764.52, 1])
    // ⚠️ and the daily request and the 5-minute bar are separate feeds: they can differ by a tick
    expect([b.on[300], b.off[300], b.close[300]]).toEqual([764.13, 764.13, 764.2])
  })

  it('⛔ WHAT THE DOOR DREW BEFORE C49: the request folded to its own expression — the 5-MINUTE close — wrong on 299 of 300 bars for each merge', () => {
    // the fold is the chart's own `close` (R6 is that column, and it MATCHes the vendor's on 300 / 300)
    const wrong = (col) => col.filter((v, i) => v !== a.close[i]).length
    expect([wrong(a.on), wrong(a.off)]).toEqual([299, 299])
    expect(Math.max(...a.on.map((v, i) => Math.abs(v - a.close[i])))).toBeCloseTo(6.61, 2)
    expect(Math.max(...a.off.map((v, i) => Math.abs(v - a.close[i])))).toBeCloseTo(7.42, 2)
    // …right only on the bar still forming
    expect(a.on.map((v, i) => (v === a.close[i] ? i : -1)).filter((i) => i >= 0)).toEqual([299])
  })

  for (const [name, cap, n] of [['the first capture', A, 300], ['the second, two minutes later', B, 301]]) {
    it(`⭐ through the member door, ${name}: the four request rows draw NOTHING — 0 wrong values, all ${n} bars withheld, by name`, () => {
      const { verdict } = gradeCapture(cap)
      const byTitle = new Map(verdict.plots.map((p) => [p.title, p]))
      for (const title of ['R1_close_D_lookahead_ON', 'R2_close_D_lookahead_OFF', 'R3_DELTA_on_minus_off', 'R7_prev_D_close_OFF']) {
        expect(byTitle.get(title).stats, title).toMatchObject({ matching: 0, valueMismatches: 0, naMismatches: n })
      }
      expect(byTitle.get('R6_chart_close').verdict).toBe('MATCH')
      const ours = runOurSide(cap)
      // wave 12 (C45): plus the probe's `bar_index` control row, withheld by name off the listing
      expect(noteCodes(ours)).toEqual(['bar-index:window', 'request:other-timeframe'])
      expect(ours.notes.join('\n')).toMatch(/This chart's timeframe is `5`/)
      expect(ours.notes.join('\n')).toMatch(/request-realtime-alignment-spy-5-2026-10-01/)
    })
  }

  it('the object lane: a drawing that reads the daily request is withheld on the 5-minute chart, and says why — and `nz(…)` does not turn it into a 0', () => {
    const ours = on(A, pine(['d = request.security(syminfo.tickerid, "D", high)', 'plot(nz(d), "nz")', 'if barstate.islast',
      '    label.new(bar_index, high, str.tostring(d))', '    line.new(bar_index - 5, d, bar_index, d)']))
    expect(ours.ok, ours.refusal).toBe(true)
    expect(column(ours).every(Number.isNaN)).toBe(true)
    expect(ours.objects.counts).toMatchObject({ labels: 0, lines: 0 })
    expect(ours.objects.chartClock).toEqual([{ code: 'request:other-timeframe', reason: CHART_CLOCK_WITHHELD['request:other-timeframe']('5') }])
  })

  it('CONTROL — on a 1D chart the same requests are the bars in hand: drawn on every bar, nothing named', () => {
    const ours = on(CAP.D900, pine(['plot(request.security(syminfo.tickerid, "D", close), "d")',
      'plot(request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on), "don")',
      'plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on), "won")',
      'if barstate.islast', '    label.new(bar_index, high, str.tostring(request.security(syminfo.tickerid, "D", high)))']))
    const closes = CAP.D900.bars.rows.map((r) => r[4])
    expect(column(ours, 0)).toEqual(closes)
    expect(column(ours, 1)).toEqual(closes)
    expect(column(ours, 2).some(Number.isNaN)).toBe(false)
    expect(column(ours, 2)[899]).toBe(closes[899])                          // Fri 2026-09-25: its own week's close
    expect(noteCodes(ours)).toEqual([])
    expect(ours.objects.texts.labels).toEqual([String(CAP.D900.bars.rows[899][2])])
  })

  it('a weekly / monthly request is built from DAILY bars: served on 1D, withheld by name on 5-minute, 60-minute and weekly charts (never an `interpret:timeframe` throw)', () => {
    const src = pine(['plot(request.security(syminfo.tickerid, "W", close), "w")', 'plot(nz(request.security(syminfo.tickerid, "M", close)), "m")'])
    for (const cap of [CAP.I5, CAP.I60, CAP.W_T]) {
      const ours = on(cap, src)
      expect(ours.ok, `${cap.id}: ${ours.refusal}`).toBe(true)
      expect(column(ours, 0).every(Number.isNaN) && column(ours, 1).every(Number.isNaN), cap.id).toBe(true)
      expect(noteCodes(ours), cap.id).toEqual(['request:other-timeframe'])
    }
    const daily = on(CAP.D900, src)
    expect(noteCodes(daily)).toEqual([])
    expect(column(daily, 0).filter(Number.isNaN).length).toBe(1)             // the first partial week: no closed week before it
    // ⚠️ WHY the intraday resample was not the answer: on the 60-minute chart its "weekly close" is the last
    // HOURLY bar's close, which is not the daily bar's — the same gap the 5-minute capture shows for the day
    const h = CAP.I60.bars.rows
    const lastOf = (ymd) => h.filter((r) => ny(r[0]).ymd === ymd).pop()[4]
    const d = CAP.D900.bars.rows.find((r) => ny(r[0]).ymd === '2026-09-18')[4]
    expect([lastOf('2026-09-18'), d]).toEqual([761.64, 761.69])
  })

  it('CONTROL — the chart\'s OWN timeframe is the identity on every chart, and this platform\'s own `tf(…)` formula carries no gate', () => {
    for (const cap of [CAP.I5, CAP.W_T, CAP.D900]) {
      const ours = on(cap, pine(['plot(request.security(syminfo.tickerid, timeframe.period, close), "own")', 'plot(request.security(syminfo.tickerid, "", close), "empty")']))
      const closes = cap.bars.rows.map((r) => r[4])
      expect(column(ours, 0), cap.id).toEqual(closes)
      expect(column(ours, 1), cap.id).toEqual(closes)
      expect(noteCodes(ours), cap.id).toEqual([])
    }
    const native = { type: 'tf', value: 'W', args: [{ type: 'series', name: 'close' }] }
    const bars = toProductBars(CAP.I5)
    expect(periodAnchorMask(native, bars, {}, undefined, undefined, { tf: '5' })).toBeNull()
    expect(Array.from(interpret(native, bars, {}, undefined, undefined, { tf: '5' })).some((v) => !Number.isNaN(v))).toBe(true)
  })

  it('the tree: the request under the gate of the base it was translated for — on a chart pane only, and exact', () => {
    const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
    const f = (body, opts = { strict: true }) => { const t = S(body, opts); return t.ok ? t.outputs[t.selected].formula : `${t.refusal.guard}` }
    expect(f('plot(request.security(syminfo.tickerid, "D", close))')).toBe('86400 != periodseconds ? 0 / 0 : close')
    expect(f('plot(request.security(syminfo.tickerid, "D", close[1], lookahead = barmerge.lookahead_on))')).toBe('86400 != periodseconds ? 0 / 0 : close[1]')
    expect(f('plot(request.security(syminfo.tickerid, "W", close))')).toBe("86400 != periodseconds ? 0 / 0 : tf(close, 'W')")
    expect(f('plot(request.security(syminfo.tickerid, "M", high, lookahead = barmerge.lookahead_on))')).toBe("86400 != periodseconds ? 0 / 0 : tf_live(high, 'M')")
    // the chart's own timeframe: no gate
    expect(f('plot(request.security(syminfo.tickerid, timeframe.period, close))')).toBe('close')
    // a screen evaluates stored daily bars: the bare tree, as before
    expect(f('plot(request.security(syminfo.tickerid, "D", close))', {})).toBe('close')
    expect(f('plot(request.security(syminfo.tickerid, "W", close))', {})).toBe("tf(close, 'W')")
    // ANOTHER symbol at a literal timeframe: the same gate, OUTSIDE its `sym` (which hands that
    // listing's bars at the chart's own timeframe); at the chart's own timeframe, none
    expect(f('plot(request.security("AMEX:SPY", "D", close))')).toBe("86400 != periodseconds ? 0 / 0 : sym('SPY', close)")
    expect(f('plot(request.security("AMEX:SPY", timeframe.period, close))')).toBe("sym('SPY', close)")
    // told the chart is intraday, a daily request still refuses (ruling 3.5's own guard), as before
    expect(f('plot(request.security(syminfo.tickerid, "D", close))', { strict: true, basePeriod: '5' })).toBe('pine:request')
    const gated = requestBaseNode('D', { type: 'series', name: 'close' })
    expect(requestBaseOf(gated)).toBe('D')
    expect(requestBaseNode('240', gated)).toBe(gated)                       // no bar length known for the base: nothing to gate on
    // a member's own ternary with the comparison the other way round keeps its own meaning
    const own = JSON.parse(JSON.stringify(gated)); own.args[0].args.reverse()
    expect(requestBaseOf(own)).toBeNull()
    expect(requestBaseOf(gated.args[2])).toBeNull()
  })

  it('a chart that does not STATE its timeframe evaluates the request as it always has (the server\'s daily consumers)', () => {
    const tree = requestBaseNode('D', { type: 'series', name: 'close' })
    const bars = toProductBars(CAP.D900).slice(-50)
    const closes = bars.map((x) => x.c)
    for (const opts of [undefined, {}, { tf: 'D' }]) {
      expect(Array.from(interpret(tree, bars, {}, undefined, undefined, opts)), JSON.stringify(opts)).toEqual(closes)
      expect(periodAnchorMask(tree, bars, {}, undefined, undefined, opts) || [], JSON.stringify(opts)).toEqual([])
    }
    const sink = new Map()
    expect(Array.from(interpret(tree, bars, {}, undefined, undefined, { tf: '60', chartClockSink: sink })).every(Number.isNaN)).toBe(true)
    expect([...sink.keys()]).toEqual(['request:other-timeframe'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('C49 · 9 — ONE answer for `request.security(syminfo.tickerid, <tf>, close)`: every timeframe on every chart, lower-timeframe flag off', () => {
  // ⭐ The member door translates ONCE, for a daily base, and binds that tree on
  // every chart. Two lanes answer a request at another timeframe, and they must
  // not overlap or leave a hole:
  //   · C41 (`lowerTf.js`) — a timeframe BELOW the base the tree is translated for
  //     (5 / 15 / 60 against `D`): refused at translation, by a `lower-tf:*` code,
  //     while `VITE_PINE_LOWER_TF_ENABLED` is off. The same on every chart, because
  //     the translation does not know the chart.
  //   · C49 (`requestBaseNode`) — the base itself (`D`, the fold) or above it
  //     (`W` / `M`, a resample): served on a 1D chart, withheld by
  //     `request:other-timeframe` on every other chart the tree is bound on.
  // ⚠️ so a `"60"` request on a 5-minute chart — ABOVE that chart — is C41's
  // refusal, not C49's gate: the tree is the daily base's, where 60 is below.
  const CHARTS = [['5', CAP.I5], ['60', CAP.I60], ['D', CAP.D900], ['W', CAP.W_T]]
  const TFS = ['5', '15', '60', 'D', 'W', 'M']
  const cell = (cap, tf, look) => {
    const ours = on(cap, pine([`plot(request.security(syminfo.tickerid, "${tf}", close${look ? ', lookahead = barmerge.lookahead_on' : ''}), "r")`]))
    if (!ours.ok) {
      const text = JSON.stringify(ours.refusal)
      const lower = /lower-tf:[a-z-]+/.exec(text)
      return lower ? lower[0] : `refused:${(/\((pine:[a-z-]+)\)/.exec(text) || [])[1]}`
    }
    const codes = noteCodes(ours)
    const col = column(ours)
    if (codes.length) {
      expect(col.every(Number.isNaN), `${tf}: a named withholding draws nothing`).toBe(true)
      return codes.join(' + ')
    }
    return 'served'
  }
  const LOWER_OFF = LOWER_TF_REFUSAL.STORE_UNMEASURED   // the rule is witnessed, the store's intraday bars are not: refused while the flag is off
  const LOWER_ON = LOWER_TF_REFUSAL.LOOKAHEAD
  const GATE = 'request:other-timeframe'
  // rows: the requested timeframe; columns: the chart (5, 60, D, W)
  const TABLE = {
    5: [LOWER_OFF, LOWER_OFF, LOWER_OFF, LOWER_OFF],
    15: [LOWER_OFF, LOWER_OFF, LOWER_OFF, LOWER_OFF],
    60: [LOWER_OFF, LOWER_OFF, LOWER_OFF, LOWER_OFF],
    D: [GATE, GATE, 'served', GATE],
    W: [GATE, GATE, 'served', GATE],
    M: [GATE, GATE, 'served', GATE],
  }

  it('the lower-timeframe flag is off in this run (the table below is the flag-off table)', () => {
    expect(lowerTfServingEnabled()).toBe(false)
  })

  for (const look of [false, true]) {
    it(`⭐ look-ahead ${look ? 'ON' : 'off'}: 6 timeframes × 4 charts, one code per cell`, () => {
      const got = {}
      for (const tf of TFS) got[tf] = CHARTS.map(([, cap]) => cell(cap, tf, look))
      const want = {}
      for (const tf of TFS) want[tf] = TABLE[tf].map((c) => (look && c === LOWER_OFF ? LOWER_ON : c))
      expect(got).toEqual(want)
      // no cell is answered by both lanes, and none by neither
      for (const tf of TFS) for (const c of got[tf]) expect(c === 'served' || c === GATE || /^lower-tf:[a-z-]+$/.test(c), `${tf}: ${c}`).toBe(true)
    }, 600000)
  }

  it('the two codes are disjoint vocabularies: C41\'s are refusals at translation, C49\'s a withholding at evaluation', () => {
    for (const code of Object.values(LOWER_TF_REFUSAL)) expect(Object.keys(CHART_CLOCK_WITHHELD), code).not.toContain(code)
    expect(Object.values(LOWER_TF_REFUSAL)).not.toContain(GATE)
    expect(CHART_CLOCK_WHOLE).toContain(GATE)
  })
})
