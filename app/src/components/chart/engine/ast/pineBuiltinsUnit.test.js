// app/src/components/chart/engine/ast/pineBuiltinsUnit.test.js
//
// ─── U-BUILTIN (2026-11-19) — BUILT-IN NAMES, EACH HELD TO A CAPTURE OR TO THE REFERENCE'S OWN SENTENCE ──
//
// `docs/pine/PARITY-ROADMAP-2026-11-18.md` U-BUILTIN; queue `docs/pine/capture-queue-2026-11-19-builtins.md`.
// Every block says what holds it:
//
//   T-D  `time("D")` and `time("D", session)` — VENDOR: `vw-bt-time-1440-spy-{1d,60}-2026-11-16` (Q-BT2),
//        through the member door on both lanes, every bar. Withholding off the regular session is railed in
//        both lanes by `periodAnchorParity.test.js` + `tests/test_ast_period_anchor_parity.py`.
//   B1   `timeframe.in_seconds("1440")` — VENDOR: the same captures, R7.
//   B2   `math.toradians` / `math.todegrees` — VENDOR: `vw-bt-toradians-spy-1d-2026-11-16` (Q-BT3).
//   B3   `math.asin` (v4 bare `asin`) — REFERENCE: "the arcsine ... in the range [-Pi/2, Pi/2], or na if y is
//        outside of range [-1, 1]", as `Math.asin`, exactly (no epsilon). The last bit owes Q-BI-ASIN.
//   B4   `color(na)` — REFERENCE: "Casts na to color": the cast IS `na` (the program is the same program).
//   (B5, `ta.kc` with a computed flag, is withdrawn: its flag must be a `simple bool` and the builder cannot
//   tell an input from a series. It stays refused by name.)
//   B6   `extend.*` bound to a name — REFERENCE: a named constant; the binding is the inline ternary.
//   B7   `text.format_bold + text.format_italic` — REFERENCE: `text_format` adds; one canonical value, the
//        host object pass's own (`canonicalTextFormat`).
//   B8   `math.e` — REFERENCE: "It is equal to 2.7182818284590452".
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine, canonicalTextFormat } from './pine'
import { parseFormula } from './parse'
import { interpret, isDayAnchor, isSessionDayGate, sessionDayWindowOf } from './interpret'
import { buildRuntimeIr } from './pineRuntimeFrontend'
import { lowerIrProgram } from '../runtime/lowerIr'
import { execute } from '../runtime/vm'
import * as registry from '../nativeRegistry'
import { runOurSide, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const capture = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))
const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
const flagOf = (src) => (src.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_ONLY_FLAG = flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
const RUNTIME_FLAG = flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))
const NL = String.fromCharCode(10)
const V = (v, body) => `//@version=${v}${NL}${v >= 5 ? 'indicator' : 'study'}("t")${NL}${body}`

afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  vi.unstubAllEnvs()
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
})

/** The member door on a capture's own bars, on one lane: title → {column, withheldBy}. */
function door(cap, lane, text = cap.source.text) {
  vi.stubEnv(OBJECTS_ONLY_FLAG, '1')
  vi.stubEnv(RUNTIME_FLAG, lane === 'runtime' ? '1' : '')
  if (lane === 'runtime') { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() }
  const side = runOurSide({ ...cap, source: { ...cap.source, text } })
  expect(side.ok, side.refusal).toBe(true)
  return { side, plot: (title) => side.plots.find((p) => p.title === title) }
}
/** Bars where our column differs from TradingView's, and how many we drew. */
function grade(cap, plot, title) {
  const j = 1 + cap.study.plots.map((p) => p.title).indexOf(title)
  expect(j, `${title} is not in the capture`).toBeGreaterThan(0)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[j]]))
  let bad = 0
  let drawn = 0
  let first = null
  cap.bars.rows.forEach(([t], i) => {
    if (!byTime.has(t)) return
    const got = plot.column[i]
    if (got === null || (typeof got === 'number' && Number.isNaN(got))) return
    drawn += 1
    if (got !== byTime.get(t)) { bad += 1; if (!first) first = { t, want: byTime.get(t), got } }
  })
  return { bad, drawn, first, n: byTime.size }
}
const without = (text, re) => text.split(NL).filter((l) => !re.test(l)).join(NL)

// ─── T-D ──────────────────────────────────────────────────────────────────────────────────────────

describe('T-D — time("D") is the 09:30 session open; time("D", "0930-1600") reads it inside the window (Q-BT2)', () => {
  // ⭐ COV-TIME B1 (2026-11-26): the probe's "1440" rows (R1, R3, R5) are no longer taken out. TradingView reads
  // them equal to R2 / R4 / R6 on every bar, and this engine now reads "1440" as "D" in the session clock and
  // the anchor (`pine.js::clockTfCodeOf`), so the probe is graded whole.
  const TEXT = (cap) => cap.source.text
  const DAILY = 'vw-bt-time-1440-spy-1d-2026-11-16'
  const HOURLY = 'vw-bt-time-1440-spy-60-2026-11-16'

  it('host lane, 1D: R1-R7 are TradingView on all 8,508 bars', () => {
    const cap = capture(DAILY)
    expect(cap.source.text).toMatch(/time\("1440", "0930-1600"\)/)
    const { plot } = door(cap, 'host', TEXT(cap))
    for (const title of ['R1_secs_1440_rth', 'R2_secs_D_rth', 'R3_secs_1440_premarket', 'R4_secs_D_premarket',
      'R5_secs_1440_anchor', 'R6_secs_D_anchor', 'R7_in_seconds_1440']) {
      const r = grade(cap, plot(title), title)
      expect(r.n).toBe(8508)
      expect(r.drawn, title).toBe(8508)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
  })

  it('host lane, RTH 60m: R1, R2, R5, R6, R7 are TradingView on all 20,861 bars; R3 / R4 (a 00:00 window) are withheld by name', () => {
    const cap = capture(HOURLY)
    const { plot } = door(cap, 'host', TEXT(cap))
    for (const title of ['R1_secs_1440_rth', 'R2_secs_D_rth', 'R5_secs_1440_anchor', 'R6_secs_D_anchor', 'R7_in_seconds_1440']) {
      const r = grade(cap, plot(title), title)
      expect(r.drawn, title).toBe(20861)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
    // ⛔ NON-VACUITY: the anchor really is before the bar on most hourly bars (the -34,200 s midnight defect
    // and a fold to bare `time` would both fail this)
    const j = 1 + cap.study.plots.map((p) => p.title).indexOf('R6_secs_D_anchor')
    expect(cap.plotValues.rows.filter((r) => r[j] < 0).length).toBeGreaterThan(17000)
    const r4 = plot('R4_secs_D_premarket')
    expect(r4.withheldBy).toBe('time-session:day-on-other-chart')
    // "1440" is withheld exactly where "D" is, by the same name
    expect(plot('R3_secs_1440_premarket').withheldBy).toBe('time-session:day-on-other-chart')
  })

  it('runtime lane: the same rows read from runtime state are TradingView on every bar the run draws', () => {
    const RT = [`//@version=6`, 'indicator("UCTPROBE_VW_BT_TIME_1440", overlay = false)',
      'secs(t) => na(t) ? -1.0 : (t - time) / 1000.0', 'a = array.new_float(4, 0.0)',
      'array.set(a, 0, secs(time("D", "0930-1600")))', 'array.set(a, 1, secs(time("D")))',
      'array.set(a, 2, secs(time("1440", "0930-1600")))', 'array.set(a, 3, secs(time("1440")))',
      'plot(array.get(a, 0), "R2_secs_D_rth")', 'plot(array.get(a, 1), "R6_secs_D_anchor")',
      'plot(array.get(a, 2), "R1_secs_1440_rth")', 'plot(array.get(a, 3), "R5_secs_1440_anchor")'].join(NL)
    for (const [id, least] of [[DAILY, 8508], [HOURLY, 20000]]) {
      const cap = capture(id)
      const { side, plot } = door(cap, 'runtime', RT)
      expect(side.door).toBe('runtime')
      for (const title of ['R2_secs_D_rth', 'R6_secs_D_anchor', 'R1_secs_1440_rth', 'R5_secs_1440_anchor']) {
        const r = grade(cap, plot(title), title)
        expect(r.drawn, `${id} ${title}`).toBeGreaterThanOrEqual(least)
        expect(r.bad, `${id} ${title}: first ${JSON.stringify(r.first)}`).toBe(0)
      }
    }
  })

  it('the trees: the anchor shape; every window of one day is the daily gate, the 09:30 one included', () => {
    const tree = (body) => { const t = translatePine(V(6, body), { strict: true }); expect(t.ok).toBe(true); return t.outputs[t.selected].ast }
    expect(isDayAnchor(tree('plot(time("D"))'))).toBe(true)
    expect(isDayAnchor(tree('plot(time("1D"))'))).toBe(true)
    // ⭐ T-D EXT (2026-11-20): a 09:30 window is the window's own start, not the anchor (they part on an
    // extended-hours chart: S1 reads 09:30 where A1 reads 04:00)
    const rth = tree('plot(time("D", "0930-1600"))')
    expect(isSessionDayGate(rth)).toBe(true)
    expect(sessionDayWindowOf(rth)).toEqual({ start: 570, end: 960, days: null, ms: true })
    expect(sessionDayWindowOf(tree('plot(time("D", "1000-1100:23456"))'))).toEqual({ start: 600, end: 660, days: [2, 3, 4, 5, 6], ms: true })
    // a window that wraps past midnight, or names a fixed zone, is the gate but not a served window
    for (const body of ['plot(time("D", "1800-0200"))', 'plot(time("D", "0930-1600", "GMT-5"))']) {
      const t = tree(body)
      expect(isSessionDayGate(t), body).toBe(true)
      expect(sessionDayWindowOf(t), body).toBe(null)
    }
    // ⛔ the chart's own timeframe keeps its own tree (no anchor, no gate)
    const own = tree('plot(time(timeframe.period, "0930-1600"))')
    expect(isSessionDayGate(own) || isDayAnchor(own.args && own.args[1])).toBe(false)
  })
})

// ─── T-D EXT ──────────────────────────────────────────────────────────────────────────────────────

describe('T-D EXT — on an extended-hours chart time("D") is 04:00; time("D", sess) is the window start; 24-hour charts withhold', () => {
  // `vw-bi-time-d-extended.pine`. Three rows are refused by name before this unit, and in strict mode one refused
  // output refuses the whole script, so they are taken out: S5 (`time("1440")`, B1), and A4 / A5, which read
  // `hour(time("D"))` / `dayofmonth(time("D"))` (a clock function of a computed timestamp: `pine:builtin`, railed
  // below). A3 (`timeframe.change("D")`) is another built-in's and is not graded here.
  // ⭐ COV-TIME B1 (2026-11-26): S5 (`time("1440")`) is no longer taken out; it is graded with the rows below.
  const TEXT = (cap) => without(cap.source.text, /"A4_|"A5_/)
  const SPY = 'vw-bi-time-d-extended-spy-60-2026-11-19'
  const BTC = 'vw-bi-time-d-extended-btcusd-60-2026-11-19'
  const ROWS = ['A1_secs_time_D', 'A2_change_time_D',
    'S1_secs_D_rth', 'S2_secs_D_extended', 'S3_secs_D_after_open', 'S4_secs_D_after_hours', 'S5_secs_1440']
  const col = (cap, title) => {
    const j = 1 + cap.study.plots.map((p) => p.title).indexOf(title)
    expect(j, title).toBeGreaterThan(0)
    return cap.plotValues.rows.map((r) => r[j])
  }
  /** ET wall clock of a unix-second instant: [weekday 0-6 (Sunday 0), hour, minute]. */
  const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const etOf = (t) => {
    const p = Object.fromEntries(ET.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]))
    return [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), Number(p.hour), Number(p.minute)]
  }
  // ⭐ Engine 92 train integration (coordinator ruling, 2026-11-20): #2213's RULING 1 holds here. "A window that
  // reaches before the chart's first bar, off the listing, is unknown there": on bar 0, A2 (`ta.change(time("D"))`)
  // reads `time("D")[1]`, a bar BEFORE the chart this engine does not hold, so bar 0 is withheld by name
  // (`history:before-chart`) even though the old value happened to match TradingView's. A deliberate one-bar
  // narrowing of A2; every other bar of A2, and every bar of the other rows, is drawn and TradingView's.
  const BEFORE_CHART = { A2_change_time_D: 1 }
  const expectBar0Withheld = (p, title) => {
    if (!BEFORE_CHART[title]) return
    expect(p.withheldBars && p.withheldBars[0], `${title}: bar 0 is withheld (ruling 1)`).toBe(1)
    expect(p.withheldBarsCodes, title).toContain('history:before-chart')
  }

  it('the capture is what it says: AMEX:SPY with the extended session (0400-2000), 60m, every bar 04:00-19:00 New York', () => {
    const cap = capture(SPY)
    // ⛔ the session is read INSIDE the capture, never from the file name
    expect(cap.symbol.session).toBe('0400-2000')
    expect(cap.symbol.timezone).toBe('America/New_York')
    expect(cap.timeframe).toBe('60')
    const hours = new Set(cap.bars.rows.map(([t]) => etOf(t)[1]))
    expect([...hours].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it('A4 / A5 (a clock function of `time("D")`) refuse by name, as any computed timestamp does', () => {
    const t = translatePine(V(6, 'plot(hour(time("D")) * 100 + minute(time("D")))'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:builtin')
  })

  it('host lane: A1, A2 and S1-S5 are TradingView on all 23,615 bars', () => {
    const cap = capture(SPY)
    const { plot } = door(cap, 'host', TEXT(cap))
    for (const title of ROWS) {
      const p = plot(title)
      expect(p, title).toBeTruthy()
      expect(p.withheldBy, title).toBe(null)
      const r = grade(cap, p, title)
      expect(r.n).toBe(23615)
      // A2: 23,614 drawn, bar 0 withheld by ruling 1 (BEFORE_CHART above); every other row: all 23,615
      expect(r.drawn, title).toBe(23615 - (BEFORE_CHART[title] || 0))
      expectBar0Withheld(p, title)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
    // ⛔ NON-VACUITY: the 09:30 anchor (the regular-hours reading) is wrong on every bar here, and the window
    // start is not the anchor: S1 (09:30) and A1 (04:00) differ on every bar inside the regular session
    const a1 = col(cap, 'A1_secs_time_D')
    const s1 = col(cap, 'S1_secs_D_rth')
    const regularAnchor = cap.bars.rows.map(([t]) => { const [, h, m] = etOf(t); return 34200 - (h * 3600 + m * 60) })
    expect(a1.filter((v, i) => v === regularAnchor[i]).length).toBe(0)
    const inside = s1.map((v, i) => [v, a1[i]]).filter(([v]) => v !== -1)
    expect(inside.length).toBeGreaterThan(8000)
    expect(inside.every(([v, a]) => v !== a)).toBe(true)
    // the new day starts on the 04:00 bar, and only there
    const a2 = col(cap, 'A2_change_time_D')
    const fires = cap.bars.rows.filter((_, i) => a2[i] === 1).map(([t]) => etOf(t)[1])
    expect(fires.length).toBeGreaterThan(1400)
    expect(new Set(fires)).toEqual(new Set([4]))
  })

  it('runtime lane: the anchor and the windows read from runtime state are TradingView on every bar the run draws', () => {
    const RT = [`//@version=6`, 'indicator("UCTPROBE_VW_BI_TIME_D_EXTENDED", overlay = false)',
      'secs(t) => na(t) ? -1.0 : (t - time) / 1000.0', 'a = array.new_float(4, 0.0)',
      'array.set(a, 0, secs(time("D")))', 'array.set(a, 1, ta.change(time("D")) != 0 ? 1 : 0)',
      'array.set(a, 2, secs(time("D", "0930-1600")))', 'array.set(a, 3, secs(time("D", "1000-1100")))',
      'plot(array.get(a, 0), "A1_secs_time_D")', 'plot(array.get(a, 1), "A2_change_time_D")',
      'plot(array.get(a, 2), "S1_secs_D_rth")', 'plot(array.get(a, 3), "S3_secs_D_after_open")'].join(NL)
    const cap = capture(SPY)
    const { side, plot } = door(cap, 'runtime', RT)
    expect(side.door).toBe('runtime')
    for (const title of ['A1_secs_time_D', 'A2_change_time_D', 'S1_secs_D_rth', 'S3_secs_D_after_open']) {
      const r = grade(cap, plot(title), title)
      expect(r.drawn, title).toBeGreaterThanOrEqual(23000)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
  })

  it('BITSTAMP:BTCUSD 60 (exchange zone UTC): every row is withheld by name on every bar, both lanes', () => {
    const cap = capture(BTC)
    expect(cap.symbol.timezone).toBe('Etc/UTC')
    expect(cap.symbol.session).toBe('24x7')
    const { plot } = door(cap, 'host', TEXT(cap))
    for (const title of ROWS) expect(plot(title).withheldBy, title).toBe('time-day:exchange-zone')
    // ⛔ NON-VACUITY: TradingView's day starts at 00:00 UTC; midnight New York (this engine's clock) and the
    // 04:00 anchor are both wrong on every bar of the capture
    const a1 = col(cap, 'A1_secs_time_D')
    const nyMidnight = cap.bars.rows.map(([t]) => { const [, h, m] = etOf(t); return -(h * 3600 + m * 60) })
    expect(a1.filter((v, i) => v === nyMidnight[i] || v === nyMidnight[i] + 14400).length).toBe(0)
    expect(a1.every((v, i) => v === -(cap.bars.rows[i][0] % 86400))).toBe(true)
    const rt = door(cap, 'runtime', [`//@version=6`, 'indicator("t", overlay = false)',
      'a = array.new_float(1, 0.0)', 'array.set(a, 0, (time("D") - time) / 1000)', 'plot(array.get(a, 0), "A1_secs_time_D")'].join(NL))
    // the runtime lane declines a run whose columnar lane withholds a `time-*` code, by name (`columnSinkRefusal`)
    const p = rt.plot('A1_secs_time_D')
    expect(p.column, 'the runtime lane draws nothing for it').toBe(null)
    expect(p.missingReason).toMatch(/runtime:chart-clock/)
  })

  it('an OVERNIGHT bar never reads a value (time-day:overnight); the 04:00 bar after it starts the new day', () => {
    // the capture's first 30 sessions with an overnight bar at 20:00, 23:00, 02:00 and 03:00 between each pair
    // of sessions on consecutive days (Monday-Thursday nights: a Friday-night bar is no US equity session at
    // all, and reads as a chart that trades around the clock)
    const cap = capture(SPY)
    const days = []
    for (const r of cap.bars.rows) {
      if (etOf(r[0])[1] === 4) days.push([])
      days[days.length - 1].push(r)
    }
    const rows = []
    const night = new Set()
    days.slice(0, 30).forEach((day, k) => {
      rows.push(...day)
      if (k === 29) return
      const last = day[day.length - 1][0]
      const next = days[k + 1][0][0]
      if (next - last > 12 * 3600) return
      for (const t of [last + 3600, last + 4 * 3600, next - 2 * 3600, next - 3600]) {
        rows.push([t, 1, 1, 1, 1, 1])
        night.add(t)
      }
    })
    rows.sort((a, b) => a[0] - b[0])
    const synthetic = { ...cap, bars: { ...cap.bars, rows, count: rows.length } }
    const { plot } = door(synthetic, 'host', TEXT(cap))
    for (const title of ['A1_secs_time_D', 'A2_change_time_D', 'S1_secs_D_rth', 'S2_secs_D_extended']) {
      const p = plot(title)
      expect(p.withheldBy, title).toBe(null)
      rows.forEach(([t], i) => {
        if (!night.has(t)) return
        expect(p.column[i] !== p.column[i], `${title} reads a value on the overnight bar ${t}`).toBe(true)
        expect(p.withheldBars && p.withheldBars[i], `${title} at ${t}`).toBe(1)
      })
      expect(p.withheldBarsCodes, title).toContain('time-day:overnight')
      // every in-session bar is TradingView's (the bars are the capture's own; graded by time on THIS chart's rows)
      const r = grade(synthetic, p, title)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
      // A2: one fewer, bar 0 withheld by ruling 1 (BEFORE_CHART above)
      expect(r.drawn, title).toBe(rows.length - night.size - (BEFORE_CHART[title] || 0))
      expectBar0Withheld(p, title)
    }
    // the 04:00 bar after each night fires, as on TradingView's chart (which holds no overnight bar)
    const a2 = plot('A2_change_time_D')
    const after = rows.map(([t], i) => [t, i]).filter(([t], i) => i > 0 && night.has(rows[i - 1][0]) && !night.has(t))
    expect(after.length).toBe(night.size / 4)
    expect(after.length).toBeGreaterThan(15)
    for (const [t, i] of after) {
      expect(etOf(t)[1]).toBe(4)
      expect(a2.column[i]).toBe(1)
    }
    // the runtime lane, which serves no per-bar withholding of a clock, declines this chart by name
    const rtSide = door(synthetic, 'runtime', [`//@version=6`, 'indicator("t", overlay = false)',
      'a = array.new_float(1, 0.0)', 'array.set(a, 0, (time("D") - time) / 1000)', 'plot(array.get(a, 0), "A1_secs_time_D")'].join(NL))
    expect(rtSide.plot('A1_secs_time_D').column).toBe(null)
    expect(rtSide.plot('A1_secs_time_D').missingReason).toMatch(/runtime:chart-clock/)
  })
})

// ─── B1 ───────────────────────────────────────────────────────────────────────────────────────────

describe('B1 — "1440" is "D" for timeframe.in_seconds, the session clock and the anchor; nowhere else', () => {
  const formulaOf = (body, v = 6) => {
    const t = translatePine(V(v, body), { strict: true })
    expect(t.ok, `${body}: ${t.refusal && t.refusal.message}`).toBe(true)
    return t.outputs[t.selected].formula
  }
  it('timeframe.in_seconds("1440") is 86400 (R7 above)', () => {
    expect(formulaOf('plot(timeframe.in_seconds("1440") + close)')).toBe('86400 + close')
  })

  it('COV-TIME B1: time("1440", sess) / time("1440") translate to exactly the "D" tree (Q-BT2 R1 = R2, R3 = R4, R5 = R6)', () => {
    for (const [a, b] of [
      ['plot(time("1440", "0930-1600"))', 'plot(time("D", "0930-1600"))'],
      ['plot(time("1440", "0000-0930"))', 'plot(time("D", "0000-0930"))'],
      ['plot(time("1440", "1900-0001"))', 'plot(time("D", "1900-0001"))'],
      ['plot(time(" 1440 ", "1000-1100:23456"))', 'plot(time("D", "1000-1100:23456"))'],
      ['plot(time("1440"))', 'plot(time("D"))'],
      ['s = input.session("0930-1600")\nplot(time("1440", s))', 's = input.session("0930-1600")\nplot(time("D", s))'],
      ['tf = input.timeframe("1440")\nplot(time(tf))', 'tf = input.timeframe("D")\nplot(time(tf))'],
    ]) {
      expect(formulaOf(a), a).toBe(formulaOf(b))
    }
    // ⛔ NON-VACUITY: the "D" trees are not the chart's own timeframe's (a fold to `timeframe.period` would pass
    // the equalities above only if "D" folded too)
    expect(formulaOf('plot(time("D"))')).not.toBe(formulaOf('plot(time(timeframe.period))'))
  })

  it('"1440" is NOT a spelling anywhere else: time_close, timeframe.change and request.security keep their answers', () => {
    // each was asked at "1440" by no capture, so each answers "1440" exactly as it did before this unit
    for (const body of ['plot(time_close("1440"))', 'plot(timeframe.change("1440") ? 1 : 0)']) {
      const t = translatePine(V(6, body), { strict: true })
      expect(t.ok, body).toBe(false)
    }
    const req = translatePine(V(6, 'plot(request.security(syminfo.tickerid, "1440", close))'), { strict: true })
    const reqD = translatePine(V(6, 'plot(request.security(syminfo.tickerid, "D", close))'), { strict: true })
    expect(req.ok && reqD.ok && req.outputs[req.selected].formula === reqD.outputs[reqD.selected].formula).toBe(false)
  })
})

// ─── COV-TIME B2 ─────────────────────────────────────────────────────────────────────────────────

describe('COV-TIME B2 — a v1-v3 bare `interval` is timeframe.multiplier (the v3 reference); v4+ keeps its refusal', () => {
  // REFERENCE (v3): "interval — Resolution multiplier, e.g. '60' - 60, 'D' - 1, '5D' - 5, '12M' - 12"; the v3->v4
  // conversion renames it `timeframe.multiplier`. Graded against the reference's own numbers, and against the
  // modern name on the same base (one reader).
  const legacy = (v, body) => (v === null ? `study("t")${NL}${body}` : `//@version=${v}${NL}study("t")${NL}${body}`)
  const fOf = (src, opts) => {
    const t = translatePine(src, { strict: true, ...opts })
    expect(t.ok, `${src}: ${t.refusal && t.refusal.message}`).toBe(true)
    return t.outputs[t.selected].formula
  }
  it('reads the reference\'s numbers on the base it is given, in v1 (no version line), v2 and v3', () => {
    for (const v of [null, 2, 3]) {
      expect(fOf(legacy(v, 'plot(close + interval)'), { basePeriod: '60' }), `v${v}`).toBe('close + 60')
      expect(fOf(legacy(v, 'plot(close + interval)'), { basePeriod: '15' }), `v${v}`).toBe('close + 15')
      expect(fOf(legacy(v, 'plot(close + interval)'), { basePeriod: 'D' }), `v${v}`).toBe('close + 1')
      expect(fOf(legacy(v, 'plot(close + interval)')), `v${v} default base`).toBe('close + 1')
    }
  })

  it('is the same number timeframe.multiplier reads on every base this engine holds', () => {
    for (const base of ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M']) {
      const old = translatePine(legacy(3, 'plot(close + interval)'), { strict: true, basePeriod: base })
      const now = translatePine(V(5, 'plot(close + timeframe.multiplier)'), { strict: true, basePeriod: base })
      expect(old.ok, base).toBe(now.ok)
      if (now.ok) expect(old.outputs[old.selected].formula, base).toBe(now.outputs[now.selected].formula)
    }
  })

  it('a script\'s OWN `interval` is its own (a binding is read first)', () => {
    expect(fOf(legacy(3, 'interval = 7\nplot(close + interval)'), { basePeriod: '60' })).toBe('close + 7')
  })

  it('v4, v5 and v6 keep the refusal by name (no reference from v4 on holds a bare `interval`)', () => {
    for (const v of [4, 5, 6]) {
      const t = translatePine(V(v, 'plot(close + interval)'), { strict: true, basePeriod: '60' })
      expect(t.ok, `v${v}`).toBe(false)
      expect(t.refusal.guard, `v${v}`).toBe('pine:builtin')
    }
  })

  it('the runtime lane reads it the same way (the v3 script `volume-profile-free-pro-by-rrb` writes `interval * 1`)', () => {
    // (v3 has no `var`; a reassigned name is the v3 way to hold runtime state)
    const src = legacy(3, 'x = 0.0\nx := close\nplot(x * interval)')
    const b = buildRuntimeIr(src, { bars: [], inputs: {}, newestBarIsForming: false, basePeriod: '60' })
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    // ⛔ control: the same script in v4 is refused on this lane too
    const b4 = buildRuntimeIr(V(4, 'x = 0.0\nx := close\nplot(x * interval)'), { bars: [], inputs: {}, newestBarIsForming: false, basePeriod: '60' })
    expect(b4.ok).toBe(false)
  })
})

// ─── B2 ───────────────────────────────────────────────────────────────────────────────────────────

describe('B2 — math.toradians / math.todegrees are x * pi / 180 and y * 180 / pi (Q-BT3)', () => {
  const ID = 'vw-bt-toradians-spy-1d-2026-11-16'
  // D3 (`x * (math.pi / 180)` written by hand, not the function) is one ulp off TradingView on 8,457 bars:
  // its constant quotient is not IEEE `Math.PI / 180` there. Recorded in the capture queue; not graded here.
  const ROWS = ['D0_bar_index_CONTROL', 'X_degrees', 'D1_minus_x_pi_over_180', 'D2_minus_x_over_180_pi',
    'E1_minus_y_180_over_pi', 'E2_minus_y_over_pi_180', 'E3_minus_y_times_180_pi']

  it('host lane: every row but D3, all 8,508 bars, exactly', () => {
    const cap = capture(ID)
    const { plot } = door(cap, 'host')
    for (const title of ROWS) {
      const r = grade(cap, plot(title), title)
      expect(r.drawn, title).toBe(8508)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
    // ⛔ NON-VACUITY: D2 / E2 are non-zero on thousands of bars, so a different spelling of either function
    // would have moved them (D1 / E1 alone are 0 for any self-consistent spelling)
    const j = (t) => 1 + cap.study.plots.map((p) => p.title).indexOf(t)
    expect(cap.plotValues.rows.filter((r) => r[j('D2_minus_x_over_180_pi')] !== 0).length).toBeGreaterThan(3000)
  })

  it('runtime lane: the same rows over runtime state, bar for bar', () => {
    const cap = capture(ID)
    const text = cap.source.text.replace('x = close * 7.3 + bar_index * 13.17',
      ['a = array.new_float(1, 0.0)', 'array.set(a, 0, close * 7.3 + bar_index * 13.17)', 'x = array.get(a, 0)'].join(NL))
    expect(text).not.toBe(cap.source.text)
    const { side, plot } = door(cap, 'runtime', text)
    expect(side.door).toBe('runtime')
    for (const title of ROWS) {
      const r = grade(cap, plot(title), title)
      expect(r.drawn, title).toBe(8508)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
  })

  it('one angle, by position; the v4 bare spelling is the same function, the v6 bare one refuses by name', () => {
    expect(translatePine(V(6, 'plot(math.toradians(close, 2))'), { strict: true }).ok).toBe(false)
    const v4 = translatePine(V(4, 'plot(toradians(close))'), { strict: true })
    const v6 = translatePine(V(6, 'plot(math.toradians(close))'), { strict: true })
    expect(v4.outputs[v4.selected].formula).toBe(v6.outputs[v6.selected].formula)
    const bare = translatePine(V(6, 'plot(toradians(close))'), { strict: true })
    expect(bare.ok).toBe(false)
    expect(String(bare.refusal.message)).toContain('`math.toradians`')
  })
})

// ─── B3 ───────────────────────────────────────────────────────────────────────────────────────────

describe('B3 — math.asin is Math.asin, na outside [-1, 1] (the reference sentence, no epsilon)', () => {
  const YS = [-1, -0.75, -0.5, 0, 1e-17, 0.3333333333333333, 0.5, 0.9999999999999999, 1, 1.0000000000000002, -2, NaN]
  const BARS = YS.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }))
  const want = YS.map((y) => (Number.isNaN(y) || y < -1 || y > 1 ? null : Math.asin(y)))
  const asNull = (col) => Array.from(col, (x) => (Number.isFinite(x) ? x : null))

  it('host lane: every value is Math.asin bit for bit, na outside the domain and for na', () => {
    const t = translatePine(V(6, 'plot(math.asin(close))'), { strict: true })
    const p = parseFormula(t.outputs[t.selected].formula)
    expect(asNull(interpret(p.ast, BARS))).toEqual(want)
  })

  it('runtime lane: the same over runtime state', () => {
    const src = V(6, ['a = array.new_float(1, 0.0)', 'array.set(a, 0, close)', 'plot(math.asin(array.get(a, 0)))'].join(NL))
    const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
    expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
    const prog = lowerIrProgram(b.ir, { historyFromListing: true })
    const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((x) => x[k])))
    const out = execute(prog, { bars: BARS.length, series, columns: prog.columns, confirmed: true }).outputs[0]
    expect(asNull(out)).toEqual(want)
  })

  it('v4 bare asin is math.asin (committed:screener-mean-reversion-channel: 2 * asin(1)); v6 bare refuses', () => {
    const v4 = translatePine(V(4, 'pi = 2 * asin(1)\nplot(close * pi)'), { strict: true })
    expect(v4.ok).toBe(true)
    expect(v4.outputs[v4.selected].formula).toBe('close * (2 * asin(1))')
    const bare = translatePine(V(6, 'plot(asin(0.5))'), { strict: true })
    expect(bare.ok).toBe(false)
    expect(String(bare.refusal.message)).toContain('`math.asin`')
  })
})

// ─── B4–B7: the runtime lane's program is the served program ─────────────────────────────────────────

const programOf = (body, opts = {}) => {
  const b = buildRuntimeIr(V(6, body), { bars: [], inputs: {}, newestBarIsForming: false, ...opts })
  expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  // a statement's source position (`site`) is where it was written, not what it does
  return JSON.stringify(b.ir.statements, (k, v) => (k === 'site' ? undefined : v))
}
const DRAW = { objectsInRun: true }

describe('B4 — color(na) is na ("Casts na to color"): the same program wherever it stands', () => {
  const PAIRS = {
    'a label colour (the drawing build)': ['var float k = 0.0\nk := k + 1\nif k > 3\n    label.new(bar_index, close, "x", color = color(na), textcolor = color.red)\nplot(k)',
      'var float k = 0.0\nk := k + 1\nif k > 3\n    label.new(bar_index, close, "x", color = na, textcolor = color.red)\nplot(k)', DRAW],
    'a ternary arm': ['var float k = 0.0\nk := k + 1\nbgcolor(k > 3 ? color.red : color(na))',
      'var float k = 0.0\nk := k + 1\nbgcolor(k > 3 ? color.red : na)', {}],
    'a var it seeds, then reassigned': ['var float k = 0.0\nk := k + 1\nvar c = color(na)\nc := k > 3 ? color.red : color(na)\nbgcolor(c)',
      'var float k = 0.0\nk := k + 1\nvar color c = na\nc := k > 3 ? color.red : na\nbgcolor(c)', {}],
  }
  for (const [what, [cast, plain, opts]] of Object.entries(PAIRS)) {
    it(what, () => { expect(programOf(cast, opts)).toBe(programOf(plain, opts)) })
  }
})

// ⭐ B4b (2026-11-21) — REFERENCE, `color()`: "The value of the argument after casting to color". A colour cast to
// color is that colour: `color(c)` is `c` wherever `c` holds one (bolingger-bands-inside-bar-boxes draws every box with
// `border_color = color(bgColor)`, an input colour, and the runtime lane refused the cast, so DRAW-1 killed its boxes).
describe('B4b — color(x) is x when x holds a colour: the same program wherever it stands', () => {
  const BOX = (border) => `c = input.color(color.red)\nvar float k = 0.0\nk := k + 1\nif k > 3\n    box.new(bar_index - 1, high, bar_index, low, border_color = ${border}, bgcolor = color.new(c, 80))\nplot(k)`
  const PAIRS = {
    'a box border colour from an input (the drawing build, bolingger-bands-inside-bar-boxes)': [BOX('color(c)'), BOX('c'), DRAW],
    'a ternary arm': ['var float k = 0.0\nk := k + 1\nbgcolor(k > 3 ? color(color.red) : na)',
      'var float k = 0.0\nk := k + 1\nbgcolor(k > 3 ? color.red : na)', {}],
    'a binding it seeds, read later': ['var float k = 0.0\nk := k + 1\nc = color(color.new(color.blue, 50))\nbgcolor(k > 3 ? c : na)',
      'var float k = 0.0\nk := k + 1\nc = color.new(color.blue, 50)\nbgcolor(k > 3 ? c : na)', {}],  }
  for (const [what, [cast, plain, opts]] of Object.entries(PAIRS)) {
    it(what, () => { expect(programOf(cast, opts)).toBe(programOf(plain, opts)) })
  }
  it('⛔ a number is no colour: `color(close)` is refused as before, never read as a colour', () => {
    const b = buildRuntimeIr(V(6, 'bgcolor(color(close))'), { bars: [], inputs: {}, newestBarIsForming: false })
    expect(b.ok).toBe(false)
  })
  it('⛔ a named argument is not the cast\'s one positional argument', () => {
    const b = buildRuntimeIr(V(6, 'bgcolor(color(x = color.red))'), { bars: [], inputs: {}, newestBarIsForming: false })
    expect(b.ok).toBe(false)
  })
})

describe('B6 — extend.* bound to a name is the inline choice (session-tpo-profile)', () => {
  it('the drawing build reads `ext = c ? extend.right : extend.none` as RT5 reads it written inline', () => {
    const head = 'b = input.bool(true, "x")\nvar line poc = na\nif barstate.islast\n'
    expect(programOf(`${head}    ext = b ? extend.right : extend.none\n    poc := line.new(bar_index - 5, close, bar_index, close, extend = ext)\nplot(close)`, DRAW))
      .toBe(programOf(`${head}    poc := line.new(bar_index - 5, close, bar_index, close, extend = b ? extend.right : extend.none)\nplot(close)`, DRAW))
  })
})

describe('B7 — a sum of text.format_* is one canonical format, the host object pass\'s own', () => {
  const lab = (fmt) => `fmt = ${fmt}\nvar float k = 0.0\nk := k + 1\nif k > 3\n    label.new(bar_index, close, "x", text_formatting = fmt)\nplot(close)`
  it('bold + italic is "bold_italic" in either order, never the concatenation', () => {
    const a = programOf(lab('text.format_bold + text.format_italic'), DRAW)
    const b = programOf(lab('text.format_italic + text.format_bold'), DRAW)
    expect(a).toBe(b)
    expect(canonicalTextFormat(['italic', 'bold'])).toBe('bold_italic')
    expect(a).toContain('"bold_italic"')
    expect(a).not.toContain('bolditalic')
  })
})

describe('B8 — math.e is the reference value', () => {
  it('"2.7182818284590452" is the double Math.E; both lanes read it', () => {
    expect(Number('2.7182818284590452')).toBe(Math.E)
    const t = translatePine(V(6, 'plot(close * math.e)'), { strict: true })
    expect(t.outputs[t.selected].formula).toBe('close * 2.718281828459045')
    programOf('f(float d, float b = 1.0) => math.pow(math.e, -0.5 * math.pow(d / b, 2.0))\nvar float k = 0.0\nk := k + 1\nplot(f(k))')
  })
})
