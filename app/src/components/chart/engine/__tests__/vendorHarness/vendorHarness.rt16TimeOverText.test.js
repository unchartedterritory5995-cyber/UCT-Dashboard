// ─── ⭐⭐ RT16 W2 — `time(<text held in a variable>)` ON THE RUNTIME LANE ────────────
//
// `volume-profile-auto-line-v2` picks its higher timeframe by chart and then asks
// `ta.change(time(periodH)) != 0`, with `periodH2` reassigned in an `if` ladder
// (`'12M'` / `'1M'` / `'1W'` / `'1D'` / `'60'`, `'1'` for seconds). The runtime lane
// now lowers `time(<variable>)` as the HOST lane's own node for whichever literal the
// variable holds on the bar (`pineRuntimeFrontend.js::timeOverText`) — so every value
// below is one the host already serves for the written spelling, graded here through
// the runtime run against the vendor's capture of that spelling:
//
//   1D chart  '1W'  `ta.change(time("W")) != 0`  K14, vw-clock-close-tfchange-spy-1d (8,473 bars)
//   1W chart  '1M'  `ta.change(time("M")) != 0`  K15, vw-clock-close-tfchange-spy-1w (1,758 bars)
//   60m chart '1D'  `ta.change(time("D")) != 0`  K07, the four 60m excerpt windows
//   5m / 15m  '60'  `time("60") − time` in days   T06, vw-time-tf-spy-{5,15}-2026-10-01
//   1M chart  '12M' `time("12M") − time` in days  T04, vw-time-tf-spy-1m-2026-10-01
//
// A spelling the host refuses is never `na`: on a bar that reaches it the run STOPS
// by name (`runtime:time-unserved`) and nothing is drawn.
//
// ⚠️ The intraday and weekly captures do not start at the listing, and the runtime
// lane withholds a stateful script off the listing (`runtime:history-start`, a policy
// this does not change). Those grades run on a COPY marked `startsAtBar0` — what is
// proven there is the VALUE the run computes on each bar, which no history reaches
// (a period anchor and its change). The listing-proved 1D and 1M grades need no copy.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { runOurSide, enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { enterDoorState } from './harness'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const REPO = path.resolve(process.cwd(), '..')
const load = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor', rel), 'utf8'))
const vendor = (cap, title) => {
  const c = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
  return cap.plotValues.rows.map((r) => r[c])
}
const same = (a, b) => (a === null || a === undefined || Number.isNaN(a))
  ? (b === null || b === undefined || Number.isNaN(b)) : Math.abs(a - b) <= 1e-9

afterEach(() => { registry.uninstallUserDefinition(HARNESS_DEF_ID); vi.unstubAllEnvs() })

/** The script's own ladder, verbatim from the corpus file, and two plots. */
const LADDER = [
  "periodH2 = '1'",
  'if timeframe.ismonthly',
  "    periodH2 := '12M'",
  '    periodH2',
  'else',
  '    if timeframe.isweekly',
  "        periodH2 := '1M'",
  '        periodH2',
  '    else',
  '        if timeframe.isdaily',
  "            periodH2 := '1W'",
  '            periodH2',
  '        else',
  "            if timeframe.period == '60' or timeframe.period == '120' or timeframe.period == '180' or timeframe.period == '240' or timeframe.period == '360' or timeframe.period == '480' or timeframe.period == '720'",
  "                periodH2 := '1D'",
  '                periodH2',
  '            else',
  '                if timeframe.isminutes',
  "                    periodH2 := '60'",
  '                    periodH2',
  '                else',
  '                    if timeframe.isseconds',
  "                        periodH2 := '1'",
  '                        periodH2',
]
const SCRIPT = ['//@version=5', 'indicator("rt16 time over text", overlay = false)', ...LADDER,
  "periodH1 = input.timeframe('D', title='Higher Timeframe')",
  'i_auto = input.bool(true)',
  'periodH = i_auto ? periodH2 : periodH1',
  'plot(ta.change(time(periodH)) != 0 ? 1 : 0, "NEW_PERIOD")',
  'plot((time(periodH) - time) / 86400000.0, "DAYS")'].join('\n')

const corpusSource = () => {
  const dir = path.join(REPO, 'corpus', 'committed')
  return fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith('volume-profile-auto-line-v2__'))), 'utf8')
}

function ours(capture, { listing = false } = {}) {
  enterDoorState('runtime')
  const cap = { ...capture, source: { ...capture.source, text: SCRIPT },
    history: listing ? { startsAtBar0: true, why: 'RT16 rail copy: the clock value, not the history, is graded' } : capture.history }
  const door = enterMemberDoor(SCRIPT)
  expect(door.def, door.refusal).toBeTruthy()
  expect(door.built.lane).toBe('runtime') // the runtime lane serves it: `periodH2` is reassigned
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  const out = runOurSide(cap)
  expect(out.ok, out.refusal).toBe(true)
  const col = (title) => {
    const p = out.plots.find((x) => x.title === title)
    expect(p && p.column, `${title}: ${p && p.missingReason}`).toBeTruthy()
    return Array.from(p.column)
  }
  return { newPeriod: col('NEW_PERIOD'), days: col('DAYS') }
}

const wrongBars = (theirs, mine, from = 0) => theirs.map((v, i) => (i < from || same(v, mine[i]) ? -1 : i)).filter((i) => i >= 0)

describe('RT16 W2 — the runtime lane reads `time(periodH)` as the host node of the text it holds', () => {
  it('1D (listing): \'1W\' — the new-week idiom equals K14 `ta.change(time("W")) != 0` on all 8,473 bars', () => {
    const cap = load('harness/vw-clock-close-tfchange-spy-1d-2026-09-28.json')
    expect(cap.history.startsAtBar0).toBe(true)
    const { newPeriod } = ours(cap)
    const theirs = vendor(cap, 'K14_newWeek_from_timeW_CONTROL')
    expect(newPeriod.length).toBe(8473)
    expect(wrongBars(theirs, newPeriod)).toEqual([])
    expect(newPeriod.filter((v) => v === 1).length).toBeGreaterThan(1000) // weeks were found
  })

  it('1W: \'1M\' — equals K15 `ta.change(time("M")) != 0` on all 1,758 bars', () => {
    const cap = load('harness/vw-clock-close-tfchange-spy-1w-2026-09-28.json')
    const { newPeriod } = ours(cap, { listing: true })
    const theirs = vendor(cap, 'K15_newMonth_from_timeM_CONTROL')
    expect(wrongBars(theirs, newPeriod)).toEqual([])
    expect(newPeriod.filter((v) => v === 1).length).toBeGreaterThan(300)
  })

  it('1M (listing): \'12M\' — `time("12M") − time` equals T04 on all 406 bars', () => {
    const cap = load('harness/vw-time-tf-spy-1m-2026-10-01.json')
    expect(cap.history.startsAtBar0).toBe(true)
    const { days } = ours(cap)
    const theirs = vendor(cap, 'T04_time12M_minus_time_DAYS')
    expect(wrongBars(theirs, days)).toEqual([])
    expect(days.some((v) => v < 0)).toBe(true) // not every month opens a year
  })

  for (const file of ['harness/vw-time-tf-spy-5-2026-10-01.json', 'harness/vw-time-tf-spy-15-2026-10-01.json']) {
    it(`${file.split('/')[1]}: '60' — \`time("60") − time\` equals T06 on every bar`, () => {
      const cap = load(file)
      const { days } = ours(cap, { listing: true })
      const theirs = vendor(cap, 'T06_time60_minus_time_DAYS')
      expect(wrongBars(theirs, days)).toEqual([])
      expect(days.some((v) => v < 0)).toBe(true) // the 60-minute bucket is not the bar's own time
    })
  }

  it('60m: \'1D\' — equals K07 `ta.change(time("D")) != 0` on the four excerpt windows (first bar of each excepted)', () => {
    const ex = load('clock-close-tfchange-spy-60-excerpt-2026-09-28.json')
    const d1 = load('harness/vw-clock-close-tfchange-spy-1d-2026-09-28.json')
    const k = 1 + ex.plotTitles.findIndex((t) => t.startsWith('K07_'))
    let compared = 0
    for (const w of ex.windows) {
      const cap = { ...d1, id: `rt16-60-${w.from}`, timeframe: '60', newestBarIsForming: false,
        bars: { ...d1.bars, rows: w.bars, count: w.bars.length }, plotValues: undefined, study: undefined }
      const { newPeriod } = ours(cap, { listing: true })
      const theirs = w.plotRows.map((r) => r[k])
      expect(wrongBars(theirs, newPeriod, 1)).toEqual([])
      compared += theirs.length - 1
    }
    expect(compared).toBeGreaterThan(100)
  })

  it('the corpus script itself attaches on the runtime lane (and nowhere else)', () => {
    const src = corpusSource()
    expect(src).toMatch(/chT_H {2}= ta\.change\(time\(periodH\)\) != 0/)
    for (const [state, attaches] of [['off', false], ['on', false], ['runtime', true]]) {
      enterDoorState(state)
      const door = enterMemberDoor(src)
      expect(!!door.def, `${state}: ${door.refusal}`).toBe(attaches)
      if (attaches) expect(door.built.lane).toBe('runtime')
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      vi.unstubAllEnvs()
    }
  })
})

describe('RT16 W2 — a text the host refuses stops the run by name; what cannot be enumerated keeps its refusal', () => {
  const cap = load('harness/vw-clock-close-tfchange-spy-1d-2026-09-28.json')
  const run = (lines) => {
    const src = ['//@version=5', 'indicator("rt16 stop", overlay = false)', ...lines].join('\n')
    enterDoorState('runtime')
    return { src, door: enterMemberDoor(src) }
  }

  it('a branch the chart REACHES whose spelling the host refuses ("15" on a daily chart): nothing drawn, guard runtime:time-unserved', () => {
    const { src, door } = run(["tf = 'W'", 'if timeframe.isdaily', "    tf := '15'", 'plot(time(tf) - time, "X")'])
    expect(door.def, door.refusal).toBeTruthy()
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    const out = runOurSide({ ...cap, source: { ...cap.source, text: src } })
    const p = out.plots && out.plots[0]
    expect(p && p.column).toBeFalsy()
    expect(String(p && p.missingReason)).toMatch(/runtime:time-unserved/)
    expect(String(p && p.missingReason)).toMatch(/time\("15"\)/)
  })

  it('the same refused spelling on a branch the chart never takes changes nothing (the daily run draws `time("W")`)', () => {
    const { src, door } = run(["tf = 'W'", 'if timeframe.isweekly', "    tf := '15'", 'plot(ta.change(time(tf)) != 0 ? 1 : 0, "X")'])
    expect(door.def, door.refusal).toBeTruthy()
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    const out = runOurSide({ ...cap, source: { ...cap.source, text: src } })
    expect(out.ok, out.refusal).toBe(true)
    const col = Array.from(out.plots[0].column)
    expect(wrongBars(vendor(cap, 'K14_newWeek_from_timeW_CONTROL'), col)).toEqual([])
  })

  it('a text built while the bar runs, a frame parameter, or an unreadable assignment keeps the refusal it had', () => {
    const refused = (lines) => {
      const ir = buildRuntimeIr(['//@version=5', 'indicator("x")', ...lines].join('\n'), { basePeriod: 'D' })
      expect(ir.ok, lines.join(' / ')).toBe(false)
      return ir.refusal.guard
    }
    expect(refused(["tf = 'W'", 'if close > open', '    tf := str.tostring(5)', 'plot(time(tf))'])).toBeTruthy()
    expect(refused(['f(x) =>', '    var n = 0', '    n += 1', '    time(x)', 'plot(f("W"))'])).toBeTruthy()
    expect(refused(["tf = 'W'", "tf += 'x'", 'plot(time(tf))'])).toBeTruthy()
  })

  it("inside a request's value it is not served (the request's own rule refuses a variable there first)", () => {
    const ir = buildRuntimeIr(['//@version=5', 'indicator("x")', "tf = 'W'", 'if timeframe.isdaily', "    tf := 'M'",
      'plot(request.security(syminfo.tickerid, "W", time(tf)))'].join('\n'), { basePeriod: 'D' })
    expect(ir.ok).toBe(false)
  })
})
