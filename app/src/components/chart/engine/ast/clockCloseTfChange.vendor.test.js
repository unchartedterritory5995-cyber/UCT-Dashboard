// ─── C8: `time_close`, `time_close("D")` AND `timeframe.change`, AGAINST THE VENDOR ──
//
// Probe `tools/visual_conformance/probes/vw-clock-close-tfchange.pine` (its
// header explains K00–K17), captured live on AMEX:SPY at full history,
// 2026-09-28:
//   1D  `tests/fixtures/vendor/harness/vw-clock-close-tfchange-spy-1d-2026-09-28.json` (8,473 bars)
//   1W  `tests/fixtures/vendor/harness/vw-clock-close-tfchange-spy-1w-2026-09-28.json` (1,758 bars)
//   60  `tests/fixtures/vendor/clock-close-tfchange-spy-60-excerpt-2026-09-28.json` — four
//       windows of the 20,616-bar RTH capture, which is 5.6 MB and not in git.
//
// THE RULES THE CAPTURES SHOW (`indicators.js::CLOCK_TIME_DERIVED` states them):
//   * `time_close` is the bar's period END, never the next bar's open: 16:00 New
//     York on a daily bar; the next 60m boundary CLIPPED at 16:00 (the 15:30 bar
//     reads 16:00); Friday 16:00 on a weekly bar — and the same template on the
//     forming last bar.
//   * `time_close("D")` is 16:00 on the date the bar OPENED, on all three charts.
//   * `timeframe.change("D"|"W"|"M")` is "this bar's New York day / ISO week /
//     month differs from the previous bar's", false on bar 0; "1W" reads as "W".
//   * ⭐ THE VENDOR USES THE REAL EARLY CLOSE (13:00) on 13 SPY days since 2019
//     and the real last session of a holiday week, as ITS calendar applies them:
//     no closure before 2000, not September 11 or Hurricane Sandy, no half-day
//     before 2019, not 2020-11-27 or 2020-12-24. Since 2026-09-28 the clock reads
//     that same view from the one calendar (`nyseCalendar.js`'s
//     `tradingViewCloseMinute`, parity-tested against `nyse_calendar.py`), so
//     every served row below agrees on EVERY bar. Until then this file counted
//     the 13 / 52 bars the regular-session template got wrong; the counts are
//     gone because the disagreement is.
//
// Every door test runs the PRODUCT'S bar shape (`ourSide.toProductBars`): a
// daily bar keyed by an ISO date, an intraday bar by unix seconds.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { computeClock, etClockAt } from '../../indicators.js'
import { toProductBars } from '../__tests__/vendorHarness/ourSide.js'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const load = (rel) => JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))
const D1 = load('harness/vw-clock-close-tfchange-spy-1d-2026-09-28.json')
const W1 = load('harness/vw-clock-close-tfchange-spy-1w-2026-09-28.json')
const H60 = load('clock-close-tfchange-spy-60-excerpt-2026-09-28.json')
const SOURCE = D1.source.text

/** Column index of a K-row in `plotValues.rows` (column 0 is the bar time). */
const col = (titles, k) => 1 + titles.findIndex((t) => t.startsWith(`${k}_`))
const TITLES = D1.study.plots.map((p) => p.title)

/** The rows the door serves, and the ones it still refuses by a SEPARATE,
 *  named rule: `hour(<a computed timestamp>)` (K09–K11), checked off the
 *  columns directly. ⭐ C30 (2026-09-30): K14/K15 (`time("W"/"M")`, the
 *  controls) are served on the DAILY chart now and graded there
 *  (`DAILY_ONLY`); on the weekly and 60m charts they refuse by name. */
const SERVED = ['K00', 'K01', 'K02', 'K03', 'K04', 'K05', 'K06', 'K07', 'K08', 'K12', 'K13', 'K16', 'K17']
const REFUSED = { K09: 'pine:builtin', K10: 'pine:builtin', K11: 'pine:builtin' }
/** Served on 1D only (C30): `time("W"/"M")` is measured on a daily chart. */
const DAILY_ONLY = ['K14', 'K15']
/** Rows that read the PREVIOUS bar — ungraded on a window's first bar when the
 *  window does not start at the capture's bar 0. */
const READS_PREVIOUS = new Set(['K04', 'K05', 'K06', 'K07', 'K12', 'K16'])

const same = (got, want) => ((want === null || want === undefined)
  ? Number.isNaN(got)
  : Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)))

/** Translate the probe once for a chart and evaluate every served row over
 *  `bars`, keyed by K-number. Refused rows come back as their refusal. */
function ourRows(bars, tf, forming) {
  const t = translatePine(SOURCE, { strict: true, basePeriod: tf })
  const out = {}
  // One output per `plot`, in source order — a refused output carries no title,
  // so the K-number is its position.
  expect(t.outputs.length).toBe(TITLES.length)
  for (const [i, o] of t.outputs.entries()) {
    const k = `K${String(i).padStart(2, '0')}`
    if (o.title) expect(o.title.startsWith(k), o.title).toBe(true)
    if (o.refusal || !o.formula) { out[k] = { refusal: o.refusal }; continue }
    out[k] = {
      formula: o.formula,
      values: interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined,
        { tf, newestBarIsForming: forming }),
    }
  }
  return out
}

/** Every bar where ours differs from the vendor, per row. */
function disagreements(rows, vendorRows, from = 0) {
  const bad = {}
  for (const k of SERVED) {
    const c = col(TITLES, k)
    bad[k] = []
    for (let i = from; i < vendorRows.length; i++) {
      if (!same(rows[k].values[i], vendorRows[i][c])) bad[k].push(i)
    }
  }
  return bad
}

const secsAfterOpen = (row, k) => row[col(TITLES, k)]

describe('1D — the product\'s ISO-date daily bars, all 8,473 SPY sessions', () => {
  const bars = toProductBars(D1)
  const rows = ourRows(bars, 'D', D1.newestBarIsForming)
  const V = D1.plotValues.rows
  // The vendor's own early closes: its span `time_close - time` is 12600 s.
  const early = V.map((r, i) => (secsAfterOpen(r, 'K03') === 12600 ? i : -1)).filter((i) => i >= 0)

  it('the vendor used the REAL early close on exactly 13 days, all from 2019-07-03 on', () => {
    const days = early.map((i) => bars[i].t)
    expect(days).toEqual(['2019-07-03', '2019-11-29', '2019-12-24', '2021-11-26', '2022-11-25',
      '2023-07-03', '2023-11-24', '2024-07-03', '2024-11-29', '2024-12-24', '2025-07-03',
      '2025-11-28', '2025-12-24'])
    // ⚠️ and NOT on 2020-11-27 / 2020-12-24 or any year before 2019 — the
    // vendor's own calendar is irregular, which is one more reason not to invent one.
    const at = (d) => V[bars.findIndex((b) => b.t === d)]
    for (const d of ['2018-11-23', '2018-12-24', '2020-11-27', '2020-12-24']) {
      expect(secsAfterOpen(at(d), 'K03'), d).toBe(23400)
    }
  })

  it('every served row translates, and the five others refuse by their own rule', () => {
    for (const k of SERVED) expect(rows[k] && rows[k].values, `${k}: ${rows[k] && rows[k].refusal && rows[k].refusal.message}`).toBeTruthy()
    for (const [k, guard] of Object.entries(REFUSED)) {
      expect(rows[k].refusal, `${k} now translates — grade it here`).toBeTruthy()
      expect(rows[k].refusal.guard, k).toBe(guard)
    }
    expect(rows.K01.formula).toMatch(/timeclose \* 1000/)
    expect(rows.K02.formula).toMatch(/dayclosetime \* 1000/)
    for (const [k, name] of [['K04', 'sessionfirst'], ['K05', 'weekfirst'], ['K06', 'monthfirst'], ['K16', 'weekfirst']]) {
      expect(rows[k].formula, k).toContain(`(isfirst ? 0 : ${name})`)
    }
  })

  it('⭐⭐ bar for bar: every served row agrees on every one of the 8,473 sessions', () => {
    const bad = disagreements(rows, V)
    for (const k of SERVED) {
      expect(bad[k], `${k} disagrees at bars ${bad[k].slice(0, 5)}`).toEqual([])
    }
    // ⛔ non-vacuity: the 13 half-days ARE in this series, and ours spans 12600 s
    // there (09:30 -> 13:00), the reading the regular-session template missed
    expect(early.length).toBe(13)
    for (const i of early) expect(rows.K03.values[i], bars[i].t).toBe(12600)
  })

  it('K09–K11 (hour/minute/dayofweek OF time_close), read off the column: the session close on the bar\'s own day', () => {
    const cols = computeClock(bars, 'D', false)
    for (const [k, field] of [['K09', 'h'], ['K10', 'min'], ['K11', 'dow']]) {
      const bad = []
      V.forEach((r, i) => { if (etClockAt(cols.timeclose[i])[field] !== r[col(TITLES, k)]) bad.push(i) })
      expect(bad, k).toEqual([])
    }
    expect(early.map((i) => etClockAt(cols.timeclose[i]).h)).toEqual(early.map(() => 13))
  })

  it('⭐ C30 — K14/K15 through the door: 0 wrong on 8,473 sessions; bar 0 and the first boundary withheld', () => {
    // `time("W"/"M")` before the first period boundary the series shows is an open
    // from bars before the window (`interpret.js::periodAnchorMask`): bar 0 (the
    // listing, 1993-01-29) and the boundary bar that reads it one back through
    // `ta.change` are withheld (`NaN`), never a confident 0. Every other bar agrees.
    for (const k of DAILY_ONLY) {
      expect(rows[k].values, `${k}: ${rows[k].refusal && rows[k].refusal.message}`).toBeTruthy()
      const c = col(TITLES, k)
      const withheld = []
      const wrong = []
      V.forEach((r, i) => {
        const got = rows[k].values[i]
        if (Number.isNaN(got)) withheld.push(i)
        else if (got !== r[c]) wrong.push(i)
      })
      expect(wrong, k).toEqual([])
      expect(withheld, k).toEqual([0, 1])
    }
  })

  it('K14/K15 (the controls `ta.change(time("W"/"M")) != 0`) equal our week / month columns', () => {
    const cols = computeClock(bars, 'D', false)
    for (const [k, name] of [['K14', 'weekfirst'], ['K15', 'monthfirst'], ['K07', 'sessionfirst']]) {
      const got = Array.from(cols[name], (v) => (v !== 0 && !Number.isNaN(v) ? 1 : 0))
      expect(got, k).toEqual(V.map((r) => r[col(TITLES, k)]))
    }
  })
})

describe('60m — four windows of the RTH capture (09:30-aligned bars, the vendor\'s grid)', () => {
  it('the excerpt is of the capture this probe produced', () => {
    expect(H60.capture.sourceSha256).toBe(D1.source.sha256)
    expect(H60.plotTitles).toEqual(TITLES)
    expect(H60.windows.length).toBe(4)
  })

  for (const w of H60.windows) {
    it(`${w.from} → ${w.to}: every served row agrees on every bar, half-days included`, () => {
      const bars = w.bars.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
      const rows = ourRows(bars, '60', H60.capture.newestBarIsForming)
      // `bar_index` counts from the window's first bar here, from the capture's there.
      rows.K00.values = rows.K00.values.map((v) => v + w.firstIndex)
      const V = w.plotRows
      const bad = disagreements(rows, V, 0)
      // The window's first bar has no previous bar HERE (it does in the capture).
      for (const k of READS_PREVIOUS) bad[k] = bad[k].filter((i) => i > 0)
      const ny = (t) => etClockAt(t)
      // The vendor's early-close days in this window: a 12:30 bar that closes at 13:00.
      const earlyDays = new Set(V.filter((r) => ny(r[0]).h === 12 && ny(r[0]).min === 30
        && r[col(TITLES, 'K03')] === 1800).map((r) => `${ny(r[0]).m}/${ny(r[0]).d}`))
      const dayOf = (i) => `${ny(V[i][0]).m}/${ny(V[i][0]).d}`
      const lastBarOfEarly = V.map((r, i) => (earlyDays.has(dayOf(i)) && ny(r[0]).h === 12 ? i : -1)).filter((i) => i >= 0)
      for (const k of SERVED) {
        expect(bad[k], `${k} disagrees at ${bad[k].slice(0, 5)}`).toEqual([])
      }
      // the half-day's 12:30 bar closes at 13:00 on ours as on the vendor's
      for (const i of lastBarOfEarly) expect(rows.K03.values[i]).toBe(1800)
      // ⭐ THE CLIP IS MEASURED IN EVERY WINDOW: a 15:30 bar reads 16:00.
      const clipped = V.filter((r) => ny(r[0]).h === 15 && ny(r[0]).min === 30)
      expect(clipped.length).toBeGreaterThan(0)
      for (const r of clipped) expect(r[col(TITLES, 'K03')]).toBe(1800)
    })
  }

  it('the windows DO hold early closes (2019-07-03 and 2019-11-29), so the accounting above is not vacuous', () => {
    const early = H60.windows.flatMap((w) => w.plotRows.filter((r) => {
      const p = etClockAt(r[0])
      return p.h === 12 && p.min === 30 && r[col(TITLES, 'K03')] === 1800
    }).map((r) => { const p = etClockAt(r[0]); return `${p.y}-${p.m}-${p.d}` }))
    expect(early).toEqual(['2019-7-3', '2019-11-29'])
  })
})

describe('1W — the column rules on the vendor\'s own instants, and the product\'s date-keyed bars', () => {
  const V = W1.plotValues.rows
  const numeric = W1.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

  it('time_close is the week\'s LAST vendor session close — on all 1,758 weeks, the 52 holiday ones included', () => {
    const cols = computeClock(numeric, 'W', W1.newestBarIsForming)
    const bad = []
    const notFridayFour = []
    V.forEach((r, i) => {
      if (!same(cols.timeclose[i], r[col(TITLES, 'K01')])) bad.push(i)
      const p = etClockAt(r[col(TITLES, 'K01')])
      if (!(p.dow === 6 && p.h === 16 && p.min === 0)) notFridayFour.push(i)
    })
    expect(bad).toEqual([])
    // ⛔ non-vacuity: 52 of the vendor's weeks do NOT end Friday 16:00
    expect(notFridayFour.length).toBe(52)
    // time_close("D") on a weekly bar: the close of the week's FIRST session --
    // 13:00 on the one week that opened on a half-day (2023-07-03).
    const badD = V.map((r, i) => (same(cols.dayclosetime[i], r[col(TITLES, 'K02')]) ? -1 : i)).filter((i) => i >= 0)
    expect(badD).toEqual([])
  })

  it('the FORMING last week reads the same template the vendor read', () => {
    const last = V.length - 1
    expect(V[last][col(TITLES, 'K17')]).toBe(0)
    for (const forming of [true, false, null]) {
      const cols = computeClock(numeric, 'W', forming)
      expect(cols.timeclose[last]).toBe(V[last][col(TITLES, 'K01')])
    }
  })

  it('timeframe.change "D"/"W"/"M"/"1W" match on every bar (0 on bar 0)', () => {
    const cols = computeClock(numeric, 'W', false)
    for (const [k, name] of [['K04', 'sessionfirst'], ['K05', 'weekfirst'], ['K06', 'monthfirst'], ['K16', 'weekfirst']]) {
      const got = Array.from(cols[name], (v) => (v !== 0 && !Number.isNaN(v) ? 1 : 0))
      expect(got, k).toEqual(V.map((r) => r[col(TITLES, k)]))
    }
  })

  // ⚰️ Until 2026-09-28 this read "⛔ on the PRODUCT'S weekly bars (date-keyed,
  // unread — Q-T1) every clock row reads BLANK past bar 0, never a confident 0":
  // a weekly bar keyed by a date had no clock, and the rail kept that blank from
  // being laundered into "no new period". The bar now HAS its clock — the open of
  // its week's first vendor session — so the rail asserts the readings instead.
  it('⭐⭐ on the PRODUCT\'S weekly bars (keyed by the FRIDAY of the ISO week) every served row agrees with the vendor', () => {
    const product = toProductBars(W1)
    // ⛔ non-vacuity: the harness feeds the product's key, a Friday, even on the
    // 52 weeks whose Friday was not a session — never the vendor's own stamp
    expect(product.every((b) => new Date(`${b.t}T12:00:00Z`).getUTCDay() === 5)).toBe(true)
    const rows = ourRows(product, 'W', W1.newestBarIsForming)
    const bad = disagreements(rows, V)
    // K17 (`barstate.isconfirmed`) is not a clock row: the capture's own
    // `newestBarIsForming` reads false while its K17 reads 0 on the forming week
    // (see the FORMING case above), so the tri-state INPUT differs, not the clock.
    for (const k of SERVED.filter((s) => s !== 'K17')) {
      expect(bad[k], `${k} disagrees at bars ${bad[k].slice(0, 5)}`).toEqual([])
    }
    expect(bad.K17).toEqual([V.length - 1])
    // …and the key day does not matter: the vendor's own first-session dates give
    // the SAME clock, bar for bar
    const stamped = W1.bars.rows.map(([t, o, h, l, c, v]) => ({ t: etIso(t), o, h, l, c, v }))
    const a = computeClock(product, 'W', false)
    const b = computeClock(stamped, 'W', false)
    for (const name of ['time', 'timeclose', 'dayclosetime', 'weekfirst', 'monthfirst']) {
      expect(Array.from(a[name]), name).toEqual(Array.from(b[name]))
    }
    // `time` is Monday 09:30 on most weeks, Tuesday after a holiday Monday from
    // 2000 on (132), and Wednesday once (2007-01-03, Ford's funeral after New
    // Year's Day) — 133 weeks that do not open on Monday, as on the vendor's side
    expect(Array.from(a.time).map((t) => etClockAt(t).dow).filter((d) => d !== 2).length).toBe(133)
  })
})

/** The New York calendar date of a unix instant, as `YYYY-MM-DD`. */
function etIso(t) {
  const p = etClockAt(t)
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

describe('the door — CONTROLS that were refusals before C8', () => {
  const V6 = '//@version=6\nindicator("t")\n'
  const tr = (body, opts = { strict: true, basePeriod: 'D' }) => translatePine(`${V6}${body}\n`, opts)

  it('⭐ bare `time_close` is `timeclose * 1000`, and `time_close("D")` is `dayclosetime * 1000`', () => {
    for (const [body, formula] of [
      ['plot(time_close)', 'timeclose * 1000'],
      ['plot(time_close("D"))', 'dayclosetime * 1000'],
      ['plot(time_close("1D"))', 'dayclosetime * 1000'],
      ['plot(time_close - time_close[1])', 'timeclose * 1000 - (timeclose * 1000)[1]'],
    ]) {
      const t = tr(body)
      expect(t.ok, `${body}: ${t.refusal && t.refusal.message}`).toBe(true)
      expect(t.outputs[t.selected].formula, body).toBe(formula)
    }
  })

  it('⛔ a versionless script meets the UNIT refusal, as bare `time` does', () => {
    const t = translatePine('indicator("t")\nplot(time_close)\n', { strict: true, basePeriod: 'D' })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:builtin')
    expect(t.refusal.message).toMatch(/MILLISECONDS/)
  })

  it('⛔ every unmeasured `time_close(...)` form is refused BY NAME', () => {
    for (const [body, why] of [
      ['plot(time_close("W"))', /only "D"/],
      ['plot(time_close("60"))', /only "D"/],
      ['plot(time_close("D", "0930-1600"))', /exactly one argument/],
      ['plot(time_close(timeframe.period))', /does not fold to a literal/],
      ['plot(time_close(timeframe = "D", bars_back = 1))', /only argument read here is `timeframe`/],
    ]) {
      const t = tr(body)
      expect(t.ok, body).toBe(false)
      expect(t.refusal.guard, body).toBe('pine:function')
      expect(t.refusal.message, body).toMatch(/time_close/)
      expect(t.refusal.message, body).toMatch(why)
    }
  })

  it('⭐ the five corpus spellings reach the door (C8\'s five scripts)', () => {
    for (const body of [
      'plot(time_close + 5 * timeframe.multiplier * 60 * 1000)',
      'plot(time_close + 3 * (time_close - time_close[1]))',
      'plot(timeframe.change("D") ? 1 : 0)',
      'plot(timeframe.change("M") ? 1 : 0)',
      'tf = input.timeframe("1W", "TimeFrame")\nplot(timeframe.change(tf) ? 1 : 0)',
    ]) {
      const t = tr(body)
      expect(t.ok, `${body}: ${t.refusal && t.refusal.message}`).toBe(true)
    }
  })
})
