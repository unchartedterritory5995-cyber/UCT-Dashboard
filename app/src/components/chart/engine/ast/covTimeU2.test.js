// app/src/components/chart/engine/ast/covTimeU2.test.js
//
// ─── COV-TIME u2 (capmatrix C1-C9, 2026-11-27) — TIME / TIMEFRAME ADMISSION, EACH FORM HELD TO A CAPTURE ──────────
//
// FRED's capability matrix (`D:/e98-scratch/capmatrix/capture-index.json`, captures held locally under licence and
// NEVER committed) graded 26/26 INCONCLUSIVE on engine 97: the member door refused every capture before the feature
// ran. What this unit admits, and what holds each:
//
//   C3  `input.time(timestamp("<date>"))` and the bare `timestamp("<date>")`, for the five date shapes of
//       `vw-cap-c3-timestamp-{a..e}-spy-{1d,15}-2026-11-26` (month-first, seconds, `GMT+10`, ISO with no zone,
//       `+0300`): ONE reader (`clockFns.js::dateStringMs`) for the input default, the runtime lane's bare call and
//       the host lane's fold. TradingView reads the input and the bare call as the same instant on every bar.
//   C2  `timeframe.change("3M" | "12M")` = `ta.change(time(<tf>)) != 0`, false on bar 0: equal on every bar of
//       `vw-cap-c2-change-qy-spy-{1d,1w,1m}-2026-11-26`. Derived from the served `time(<tf>)` anchor.
//   C9  `time(<tf>, bars_back = N)` / `time_close(<tf>, bars_back = N)` = the call N chart bars back, and
//       `time_close("")` = `time_close`: `vw-cap-c9-time-close-bars-back-spy-1d-2026-11-26`, every bar.
//   C1  `timeframe.in_seconds("480" | "120" | "2D" | "3W")` = n x the unit: `vw-cap-c1-from-seconds-spy-1d-2026-11-26`.
//
// The rails below run synthetic bars through the member door (`runOurSide`, both lanes) and hold each form to the
// RELATION the capture showed (an equality TradingView answered on every bar) or to the reference's own arithmetic,
// so no licensed value is committed. Mutants: `ci/mutants/cov-time-u2.json`.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine } from './pine'
import * as registry from '../nativeRegistry'
import { runOurSide, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'
import { dateStringMs, timestampMs } from '../runtime/clockFns'
import { timestampOfDateString, timeInputDefaultOf } from '../runtime/runtimeInputs'
import { parseWholeExpression, lexPine } from './pine.js'

const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
const flagOf = (src) => (src.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_ONLY_FLAG = flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
const RUNTIME_FLAG = flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))
const NL = String.fromCharCode(10)
const V6 = (body) => `//@version=6${NL}indicator("t", overlay = false)${NL}${body}`

afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  vi.unstubAllEnvs()
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
})

// Monday-to-Friday daily bars opening 09:30 New York (the session open TradingView stamps a SPY daily bar with),
// 2019-02-13 .. 2021-12-31: mid-quarter at bar 0, so the first partial quarter and year are on the chart.
const DAILY = (() => {
  const rows = []
  for (let d = Date.UTC(2019, 1, 13); d <= Date.UTC(2021, 11, 31); d += 86400000) {
    const x = new Date(d)
    const wd = x.getUTCDay()
    if (wd === 0 || wd === 6) continue
    const t = timestampMs('exchange', x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), 9, 30, 0) / 1000
    const c = 300 + 20 * Math.sin(rows.length / 17)
    rows.push([t, c - 1, c + 2, c - 2, c, 1e6 + (rows.length % 13) * 1e4])
  }
  return rows
})()
const SYMBOL = { name: 'SPY', full_name: 'AMEX:SPY', pro_name: 'AMEX:SPY', exchange: 'AMEX', listed_exchange: 'AMEX',
  type: 'fund', session: '0930-1600', timezone: 'America/New_York' }

const titlesOf = (text) => [...text.matchAll(/plot\([^\n]*,\s*"([^"]+)"\)/g)].map((m) => m[1])
/** The member door on synthetic daily bars, on one lane: title -> column (NaN where withheld or na). */
function door(text, lane) {
  vi.stubEnv(OBJECTS_ONLY_FLAG, '1')
  vi.stubEnv(RUNTIME_FLAG, lane === 'runtime' ? '1' : '')
  if (lane === 'runtime') { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() }
  const cap = {
    id: 'cov-time-u2-synthetic', symbol: SYMBOL, timeframe: '1D', newestBarIsForming: false,
    source: { text }, bars: { fields: ['time', 'open', 'high', 'low', 'close', 'volume'], timeUnit: 'unix-s', rows: DAILY },
    study: { plots: titlesOf(text).map((title, i) => ({ id: `plot_${i}`, title })), inputs: [] },
  }
  const side = runOurSide(cap)
  expect(side.ok, side.refusal).toBe(true)
  return (title) => {
    const p = side.plots.find((x) => x.title === title)
    expect(p, `no plot ${title}`).toBeTruthy()
    return Array.from(p.column, (v) => (v === null || v === undefined ? NaN : v))
  }
}
const drawn = (v) => typeof v === 'number' && !Number.isNaN(v)
const LANES = ['host', 'runtime']

// ─── C3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Each captured spelling and the instant TradingView read for it (T16 is RULING-0927's; a-e are capmatrix C3).
const CAPTURED_DATES = [
  ['18 May 2022 00:00 +0000', Date.UTC(2022, 4, 18)],
  ['Jan 01 2023 00:00:00', Date.UTC(2023, 0, 1)],
  ['Feb 01 2020 22:10:05', Date.UTC(2020, 1, 1, 22, 10, 5)],
  ['01 Jan 2000 00:00:00 GMT+10', Date.UTC(1999, 11, 31, 14)],
  ['2023-01-01T12:00:00', Date.UTC(2023, 0, 1, 12)],
  ['20 Jul 2021 00:00 +0300', Date.UTC(2021, 6, 19, 21)],
]

describe('C3 — ONE reader of a date string, for the input default, the bare call and both lanes', () => {
  it.each(CAPTURED_DATES)('%s is the instant TradingView read', (text, ms) => {
    expect(dateStringMs(text)).toBe(ms)
    expect(timestampOfDateString(text)).toBe(ms)
    const def = parseWholeExpression(lexPine(`input.time(timestamp("${text}"))`).tokens || lexPine(`input.time(timestamp("${text}"))`))
    expect(timeInputDefaultOf(def, () => null)).toEqual({ ms })
  })

  it('no zone is GMT+0, `GMT+10` is ten hours EAST, `+0300` three hours east', () => {
    expect(dateStringMs('Jan 01 2023 00:00:00') - dateStringMs('Jan 01 2023 00:00:00 GMT+10')).toBe(10 * 3600000)
    expect(dateStringMs('Jan 01 2023 00:00:00') - dateStringMs('Jan 01 2023 00:00:00 UTC-5')).toBe(-5 * 3600000)
    expect(dateStringMs('2023-01-01T12:00:00')).toBe(dateStringMs('2023-01-01T12:00:00Z'))
  })

  it.each(['Jan 01, 2023', 'Sun Jan 01 2023', '01 Jan 2000 00:00 GMT+15', '01 Jan 2000 00:00 EST',
    '2023/01/01', 'Jan 32 2023', '01 Jan 2000 00:00 +03', '20 Feb 2020 America/New_York'])(
    '⛔ %s is read by neither reader, and an input defaulted to it is refused by name', (text) => {
      expect(dateStringMs(text)).toBe(null)
      expect(timestampOfDateString(text)).toBe(null)
      const r = translatePine(V6(`t = input.time(timestamp("${text}"), "S")${NL}plot(t, "a")`), { strict: true })
      expect(r.outputs[0].refusal && r.outputs[0].refusal.guard).toBe('pine:input-kind')
    })

  it.each(CAPTURED_DATES)('%s: input and bare call are one instant on every bar, on both lanes', (text, ms) => {
    const src = V6([`tIn = input.time(timestamp("${text}"), "S")`, `tBare = timestamp("${text}")`,
      'plot(tIn, "a")', 'plot(tBare, "b")', 'plot(tIn - tBare, "c")', 'plot(time >= tBare ? 1 : 0, "d")'].join(NL))
    for (const lane of LANES) {
      const col = door(src, lane)
      const want = DAILY.map(([t]) => (t * 1000 >= ms ? 1 : 0))
      expect(col('a').every((v) => v === ms), lane).toBe(true)
      expect(col('b').every((v) => v === ms), lane).toBe(true)
      expect(col('c').every((v) => v === 0), lane).toBe(true)
      expect(col('d'), lane).toEqual(want)
    }
  })

  it('non-vacuous: two captured instants fall inside the bars, so the step is drawn on both sides', () => {
    for (const [, ms] of [CAPTURED_DATES[2], CAPTURED_DATES[5]]) {
      expect(DAILY[0][0] * 1000 < ms && ms < DAILY[DAILY.length - 1][0] * 1000).toBe(true)
    }
  })

  it('the host lane folds the bare call itself (it does not lean on the runtime lane)', () => {
    const t = translatePine(V6(`plot(timestamp("Jan 01 2023 00:00:00"), "a")`), { strict: true })
    expect(t.outputs[0].refusal).toBeFalsy()
    expect(t.outputs[0].formula).toBe(String(Date.UTC(2023, 0, 1)))
  })
})

// ─── C2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('C2 — timeframe.change("3M" | "12M") is the change of time(<tf>), false on bar 0', () => {
  const src = V6(['plot(timeframe.change("3M") ? 1 : 0, "q")', 'plot(ta.change(time("3M")) != 0 ? 1 : 0, "qc")',
    'plot(timeframe.change("12M") ? 1 : 0, "y")', 'plot(ta.change(time("12M")) != 0 ? 1 : 0, "yc")'].join(NL))
  // the first bar of each calendar quarter / year these bars show, read off their New York dates
  const nyMonth = (t) => new Date(t * 1000 - 5 * 3600000).getUTCMonth()
  const nyYear = (t) => new Date(t * 1000 - 5 * 3600000).getUTCFullYear()
  const firstOf = (key) => DAILY.map(([t], i) => (i > 0 && key(DAILY[i - 1][0]) !== key(t) ? 1 : 0))
  const QUARTER = firstOf((t) => `${nyYear(t)}-${Math.floor(nyMonth(t) / 3)}`)
  const YEAR = firstOf(nyYear)

  it.each(LANES)('%s lane: equal to its control on every bar both draw; the new periods are the calendar\'s', (lane) => {
    const col = door(src, lane)
    for (const [k, c, cal] of [['q', 'qc', QUARTER], ['y', 'yc', YEAR]]) {
      const got = col(k)
      const ctl = col(c)
      let both = 0
      for (let i = 1; i < got.length; i += 1) {
        if (drawn(got[i]) && drawn(ctl[i])) { both += 1; expect(got[i], `${k} bar ${i}`).toBe(ctl[i]) }
        if (drawn(got[i])) expect(got[i], `${k} bar ${i} calendar`).toBe(cal[i])
      }
      expect(both, `${k} drawn`).toBeGreaterThan(600)
      expect(got.filter((v) => v === 1).length, `${k} new periods`).toBe(cal.filter((v) => v === 1).length)
      // ⛔ bar 0 is false (or withheld), never the start of a period TradingView did not see begin
      expect(got[0] === 0 || !drawn(got[0])).toBe(true)
    }
  })

  it('⛔ by name: a screen, and a period no capture asked', () => {
    const ref = (body, opts) => translatePine(V6(body), opts).outputs[0].refusal
    expect(ref('plot(timeframe.change("3M") ? 1 : 0)', {}).message).toMatch(/this is a screen/)
    const six = ref('plot(timeframe.change("6M") ? 1 : 0)', { strict: true })
    expect(six.guard).toBe('pine:builtin')
    expect(six.message).toMatch(/"6M" is not one of those measured/)
  })
})

// ─── C9 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('C9 — bars_back is the same call N chart bars back; time_close("") is time_close', () => {
  const src = V6(['plot(time_close("W", bars_back = 1), "a")', 'plot(time_close("W"), "a0")',
    'plot(time("M", bars_back = 2), "b")', 'plot(time("M"), "b0")',
    'plot(time_close("", bars_back = 1), "c")', 'plot(time_close, "c0")',
    'plot(time_close("W", bars_back = 0), "d")', 'plot(time_close(""), "e")'].join(NL))

  it.each(LANES)('%s lane: each column is its base column shifted, on every bar both draw', (lane) => {
    const col = door(src, lane)
    for (const [k, base, n] of [['a', 'a0', 1], ['b', 'b0', 2], ['c', 'c0', 1], ['d', 'a0', 0], ['e', 'c0', 0]]) {
      const got = col(k)
      const want = col(base)
      let both = 0
      for (let i = n; i < got.length; i += 1) {
        if (drawn(got[i]) && drawn(want[i - n])) { both += 1; expect(got[i], `${k} bar ${i}`).toBe(want[i - n]) }
      }
      expect(both, `${k} drawn`).toBeGreaterThan(600)
      for (let i = 0; i < n; i += 1) expect(drawn(got[i]), `${k} bar ${i} reaches before the chart`).toBe(false)
    }
  })

  it('⛔ by name: a negative bars_back (a bar that has not opened), and one that is not a written whole number', () => {
    const ref = (body) => translatePine(V6(body), { strict: true }).outputs[0].refusal
    expect(ref('plot(time_close("W", bars_back = -1))').message).toMatch(/has not opened yet/)
    expect(ref('n = bar_index % 2\nplot(time("M", bars_back = n))').message).toMatch(/whole number written in the script/)
  })
})

// ─── C1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('C1 — timeframe.in_seconds of n minutes, days, weeks is n x the unit', () => {
  it.each([['480', 28800], ['120', 7200], ['2D', 172800], ['3W', 1814400], ['1440', 86400]])(
    'in_seconds("%s") = %d', (tf, secs) => {
      const t = translatePine(V6(`plot(timeframe.in_seconds("${tf}"), "a")`), { strict: true })
      expect(t.outputs[0].refusal).toBeFalsy()
      expect(t.outputs[0].formula).toBe(String(secs))
    })
  it.each(['30S', '1441', '2d', '366D', '53W', '0'])('⛔ in_seconds("%s") is not answered', (tf) => {
    const t = translatePine(V6(`plot(timeframe.in_seconds("${tf}"), "a")`), { strict: true })
    expect(t.outputs[0].refusal).toBeTruthy()
  })
})
