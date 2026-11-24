// ⭐⭐ Engine 66 (#1473) (bt, 2026-11-16) — `time(tf, session[, zone])`: the wrapping session, the
// session that runs to midnight, the v4 default days, the UTC spelling of a fixed zone, and the bare
// `period` of v1-v3 — each held to what witnesses it.
//
//   · four captures of probes under `tools/visual_conformance/probes/`, all BITSTAMP:BTCUSD (a bar
//     every hour of every day), every bar: `vw-w4-session-overnight-btcusd-60-2026-11-16` (O1-O4,
//     membership), `vw-bt-session-overnight-value-btcusd-{60,1d}-2026-11-16` (V1-V4, the value
//     inside a wrapping session), `vw-bt-session-to-midnight-daymask-btcusd-60-2026-11-16` (M1/M2,
//     "HHMM-0000" under a day list), `vw-w4-session-default-days-v4-btcusd-60-2026-11-16` (N1-N3,
//     the v4 default days); and the user manual's session table, the v4 reference and the v4->v5
//     migration guide, quoted at `pine.js::sessionClockOf`;
//   · "UTC±H" / "UTC±HH:MM" / "GMT±HHMM": the user manual ("UTC (or GMT) offset notation"); the
//     arithmetic is the measured "GMT-4" one, so the trees must be the same tree;
//   · bare `period` from v4 on: TradingView's v4 compiler, "Undeclared identifier 'period'" (the
//     capture session's reading, in the header of the captured default-days-v4 source).
//
// ⛔ THE CAPTURES REACH `tests/fixtures/vendor/harness/` THROUGH THE CAPTURE SESSION'S DATA PRs, never
// a copy committed here: `vw-w4-session-overnight-btcusd-60` with #1472 (run cq1), the other four with
// #1494 (runs ac2 / ac3), each byte-identical to the copy this rail was graded against before it landed.
// Every block is UNCONDITIONAL: a missing capture is RED.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition.js'
import * as registry from '../nativeRegistry.js'

const REPO = path.resolve(process.cwd(), '..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const capPath = (id) => path.join(HARNESS, `${id}.json`)
const V6 = '//@version=6\nindicator("p")\n'
const V4 = '//@version=4\nstudy("p")\n'
const V3 = '//@version=3\nstudy("p")\n'

const tr = (src, basePeriod = 'D') => translatePine(src, { strict: true, basePeriod })
const outputsOf = (src, basePeriod) => {
  const t = tr(src, basePeriod)
  expect(t.ok, t.ok ? '' : `${t.refusal && t.refusal.guard}: ${t.refusal && t.refusal.message}`).toBe(true)
  for (const o of t.outputs) expect(o.refusal, o.refusal && o.refusal.message).toBeFalsy()
  return t.outputs
}
const refusalOf = (src, basePeriod) => {
  const t = tr(src, basePeriod)
  const r = t.ok ? (t.outputs || []).map((o) => o.refusal).find(Boolean) : t.refusal
  expect(r, 'expected a refusal').toBeTruthy()
  return r
}
const evalOn = (formula, bars, tf) => interpret(parseFormula(formula).ast, bars, {}, undefined, undefined, { tf })

/** A capture's rows, graded against OUR answer to the same question per row. The probes read the
 *  session in the EXCHANGE zone, which for BITSTAMP:BTCUSD is Etc/UTC (asserted); this engine's
 *  exchange clock is New York, so each row is asked here with the zone written out: "GMT+0" is that
 *  clock, by the measured fixed-offset arithmetic. `rows` maps a capture title to a Pine expression. */
function gradeCapture(id, tf, rows) {
  const d = JSON.parse(fs.readFileSync(capPath(id), 'utf8'))
  expect(d.symbol.timezone, id).toBe('Etc/UTC')
  const titles = d.study.plots.map((p) => p.title)
  const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  const index = new Map(d.bars.rows.map((r, i) => [r[0], i]))
  const out = {}
  for (const [title, expr] of Object.entries(rows)) {
    const col = 1 + titles.indexOf(title)
    expect(col, `${title} is not a plot of ${id}`).toBeGreaterThan(0)
    const [o] = outputsOf(`${V6}plot(${expr}, "${title}")`, tf)
    const ours = evalOn(o.formula, bars, tf)
    let bad = 0
    let first = null
    let n = 0
    for (const r of d.plotValues.rows) {
      const want = r[col]
      if (want === null || want === undefined) continue
      n += 1
      const got = ours[index.get(r[0])]
      if (Math.abs(got - want) > 1e-9) { bad += 1; if (!first) first = { t: r[0], want, got } }
    }
    out[title] = { bad, n, first, formula: o.formula }
  }
  return { d, out }
}
const expectAllMatch = (res, min) => {
  for (const [title, r] of Object.entries(res.out)) {
    expect(r.n, `${title}: capture too short`).toBeGreaterThanOrEqual(min)
    expect(r.bad, `${title}: ${r.bad}/${r.n} bars differ, first ${JSON.stringify(r.first)} — ${r.formula}`).toBe(0)
  }
}
const isNa = (spec) => `na(time(timeframe.period, "${spec}", "GMT+0")) ? 1 : 0`
const secs = (spec) => `na(time(timeframe.period, "${spec}", "GMT+0")) ? -1.0 : (time(timeframe.period, "${spec}", "GMT+0") - time) / 1000.0`

const OVERNIGHT = 'vw-w4-session-overnight-btcusd-60-2026-11-16'
describe(`a wrapping session's membership: ${OVERNIGHT} O1-O4`, () => {
  it('matches O1-O4 on every bar, and the capture discriminates', () => {
    const res = gradeCapture(OVERNIGHT, '60', {
      O1_na_wrap_all_days: isNa('1800-0200:1234567'),
      O2_na_wrap_weekdays: isNa('1800-0200:23456'),
      O3_na_to_midnight: isNa('2000-0000:1234567'),
      O4_na_whole_day: isNa('0000-0000:1234567'),
    })
    expectAllMatch(res, 20000)
    // ⛔ NON-VACUITY: the after-midnight part belongs to the session that ENDS that day (O2):
    // Friday 01:00 in, Friday 18:00 out, Sunday 18:00 in, Saturday 01:00 out.
    const { d } = res
    const t = d.study.plots.map((p) => p.title)
    const c = (n) => 1 + t.indexOf(n)
    const o2At = (dow, hour) => new Set(d.plotValues.rows
      .filter((r) => r[c('DOW_dayofweek')] === dow && r[c('HOUR')] === hour).map((r) => r[c('O2_na_wrap_weekdays')]))
    expect(o2At(6, 1)).toEqual(new Set([0]))
    expect(o2At(6, 18)).toEqual(new Set([1]))
    expect(o2At(1, 18)).toEqual(new Set([0]))
    expect(o2At(7, 1)).toEqual(new Set([1]))
  })
})

const VALUE60 = 'vw-bt-session-overnight-value-btcusd-60-2026-11-16'
const VALUE1D = 'vw-bt-session-overnight-value-btcusd-1d-2026-11-16'
const VALUE_ROWS = {
  V1_secs_wrap_half_hour: secs('1930-0230:1234567'),
  V2_secs_wrap_on_the_hour_CONTROL: secs('1800-0200:1234567'),
  V3_secs_whole_day_wrap: secs('1700-1700:1234567'),
  V4_secs_wrap_through_the_day: secs('2000-1630:1234567'),
}
describe(`the VALUE inside a wrapping session, hourly: ${VALUE60}`, () => {
  it('matches V1-V4 on every bar: the session grid continues across midnight (-1800 s at 00:00-02:00)', () => {
    const res = gradeCapture(VALUE60, '60', VALUE_ROWS)
    expectAllMatch(res, 20000)
    const { d } = res
    const t = d.study.plots.map((p) => p.title)
    const c = (n) => 1 + t.indexOf(n)
    // ⛔ NON-VACUITY: the half-hour session answers the :30 BEFORE on an after-midnight bar, which
    // the bar's own open (0) would not
    const after = d.plotValues.rows.filter((r) => r[c('HOUR')] === 1)
    expect(after.length).toBeGreaterThan(500)
    expect(new Set(after.map((r) => r[c('V1_secs_wrap_half_hour')]))).toEqual(new Set([-1800]))
  })
})
describe(`the VALUE inside a wrapping session, daily: ${VALUE1D}`, () => {
  it('matches V1-V4 on every bar: the session\'s start the evening before', () => {
    const res = gradeCapture(VALUE1D, 'D', VALUE_ROWS)
    expectAllMatch(res, 1000)
    const v3 = new Set(res.d.plotValues.rows.map((r) => r[1 + res.d.study.plots.map((p) => p.title).indexOf('V3_secs_whole_day_wrap')]))
    expect(v3).toEqual(new Set([-25200]))
  })
})

const TO_MIDNIGHT = 'vw-bt-session-to-midnight-daymask-btcusd-60-2026-11-16'
describe(`"HHMM-0000" under a day list: ${TO_MIDNIGHT}`, () => {
  it('matches M1/M2 on every bar: the hours before midnight are the bar\'s own day\'s session', () => {
    expectAllMatch(gradeCapture(TO_MIDNIGHT, '60', {
      M1_na_to_midnight_weekdays: isNa('2000-0000:23456'),
      M2_na_to_midnight_every_day_CONTROL: isNa('2000-0000:1234567'),
    }), 20000)
  })
})

const DAYS_V4 = 'vw-w4-session-default-days-v4-btcusd-60-2026-11-16'
describe(`a v4 session with no day list: ${DAYS_V4}`, () => {
  it('the captured v4 source (`timeframe.period`) matches N1-N3 on every bar: Monday to Friday', () => {
    const d = JSON.parse(fs.readFileSync(capPath(DAYS_V4), 'utf8'))
    expect(d.source.text).toMatch(/^\/\/@version=4/)
    const titles = d.study.plots.map((p) => p.title)
    const c = (n) => 1 + titles.indexOf(n)
    const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
    const index = new Map(d.bars.rows.map((r, i) => [r[0], i]))
    // ⭐ the captured source itself, the exchange zone written out (see `gradeCapture`); every row
    // is a whole-day window, so only the day list decides
    for (const [title, spec] of [['N1_na_no_day_list', '0000-2359'], ['N2_na_every_day_CONTROL', '0000-2359:1234567'],
      ['N3_na_monday_to_friday_CONTROL', '0000-2359:23456']]) {
      const [o] = outputsOf(`${V4}plot(na(time(timeframe.period, "${spec}", "GMT+0")) ? 1 : 0, title = "${title}")`, '60')
      const ours = evalOn(o.formula, bars, '60')
      const bad = d.plotValues.rows.filter((r) => ours[index.get(r[0])] !== r[c(title)]).length
      expect(bad, `${title} — ${o.formula}`).toBe(0)
    }
    // ⛔ NON-VACUITY: N1 is out on Saturday and Sunday and in on Monday
    const n1 = (dow) => new Set(d.plotValues.rows.filter((r) => r[c('DOW_dayofweek')] === dow).map((r) => r[c('N1_na_no_day_list')]))
    expect(n1(1)).toEqual(new Set([1]))
    expect(n1(7)).toEqual(new Set([1]))
    expect(n1(2)).toEqual(new Set([0]))
  })
})

describe('a membership read is the membership tree (the install budget)', () => {
  it('`na(time(tf, <wrapping session>))` carries no `time` and no `periodseconds`; the value read does', () => {
    const [m] = outputsOf(`${V6}plot(na(time(timeframe.period, "1800-0200:23456")) ? 0 : 1)`, '60')
    expect(m.formula).not.toMatch(/periodseconds|\btime\b/)
    const [v] = outputsOf(`${V6}plot(time(timeframe.period, "1800-0200:23456") / 1000)`, '60')
    expect(v.formula).toMatch(/periodseconds/)
  })
  it('session-hilo (committed, transferring on master) still installs: two wrapping sessions and their [1] history', () => {
    // ⚰️ MEASURED on e64bc57ee0: with the value tree in the membership read, its background paint
    // measured 10 series references against the install cap of 8 (`budget:series`) and the whole
    // definition failed to install; the coverage ratchet named it LOST on both lanes.
    // ⚰️ AND THE MEMBERSHIP TREE ALONE DID NOT FIX IT (remote run on 5bc583b4b3: 9 against 8). The
    // rest were the script's own `s_useSess` / `s_incWE` / `s_lines` toggles, live as knobs once
    // the session translated (on master the refused session folded them). The member door now
    // gives knobs back to the install budget, by name (`builderInputs.js`, `budgetRefusal`;
    // the general rail is `builder/knobInstallBudget.test.js`).
    const src = fs.readFileSync(path.join(REPO, 'corpus', 'committed', 'session-hilo__WM2g5GtC4h.pine'), 'utf8')
    const d = memberPaneDefinition({ source: src, id: 'u_bt_hilo', name: 'session-hilo' })
    expect(d.ok, d.reason).toBe(true)
    // ⭐⭐ e95 unit 2b (2026-11-22, coordinator ruling) — the install budget is the DEFAULTS' program now
    // (`astColumns.js::defaultBoundDocument`, `bind.js::pruneAtLeafDefaults`): `s_useSess` at its default (false)
    // prunes the session arm away, so the toggles are no longer given back. They stay the member's settings, and
    // each binding is measured by its own compute budget. ⚰️ Before: given back (measured: s_lines, s_useSess).
    const given = new Set((d.translation.outputs || []).flatMap((o) => o.skippedInputs || [])
      .filter((e) => e && e.budgetBound).map((e) => e.name))
    expect([...given]).toEqual([])
    for (const knob of ['s_useSess', 's_incWE', 's_lines']) expect(d.translation.declared || []).toContain(knob)
    try {
      const r = registry.installUserDefinitions([d.definition])
      expect(r.errors, JSON.stringify(r.errors)).toEqual([])
      expect(r.installed.length).toBe(1)
    } finally {
      try { registry.uninstallUserDefinition('u_bt_hilo') } catch { /* nothing installed */ }
    }
  })
})

describe('what still refuses, by name', () => {
  it('a v1-v3 session with no day list: no reference text states the default', () => {
    const r = refusalOf(`${V3}plot(na(time(period, "0930-1600")) ? 0 : 1)`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/no day list[\s\S]*not stated by any reference text/)
  })
  it('bare `period` from v4 on (TradingView: "Undeclared identifier \'period\'"), and it says what to write', () => {
    for (const src of [`${V4}plot(na(time(period, "0930-1600:23456")) ? 0 : 1)`,
      `${V4}tf = period\nplot(security(syminfo.tickerid, tf, close))`]) {
      const r = refusalOf(src)
      expect(r.guard, src).toBe('pine:builtin')
      expect(r.message, src).toMatch(/Undeclared identifier 'period'[\s\S]*timeframe\.period/)
    }
  })
  it('CONTROL: a v4 script\'s OWN `period` is its own, and v3\'s bare `period` is the chart\'s', () => {
    expect(tr(`${V4}period = "W"\nplot(security(syminfo.tickerid, period, close))`).ok).toBe(true)
    expect(tr(`${V3}plot(na(time(period, "0930-1600:23456")) ? 0 : 1)`).ok).toBe(true)
  })
  it('`""` is the chart\'s own timeframe on this lane too (the reference: "the script\'s main timeframe")', () => {
    const own = outputsOf(`${V6}plot(na(time(timeframe.period, "0930-1000:23456")) ? 0 : 1)`)[0].formula
    expect(outputsOf(`${V6}plot(na(time("", "0930-1000:23456")) ? 0 : 1)`)[0].formula).toBe(own)
    // CONTROL: another literal is still another timeframe
    expect(refusalOf(`${V6}plot(na(time("W", "0930-1000:23456")) ? 0 : 1)`).message).toMatch(/OWN timeframe/)
  })
  it('CONTROL: a same-day session is untouched — the same tree it always was', () => {
    const [o] = outputsOf(`${V6}plot(time(timeframe.period, "0930-1000:23456") / 1000)`)
    expect(o.formula).toMatch(/dayofweek == 2/)
    expect(o.formula).not.toMatch(/mod\(dayofweek, 7\)/)
    expect(o.formula).not.toMatch(/\+ 1440/)
  })
})

// Hourly bars from Sunday 2024-01-07 00:00 New York (EST, UTC-5): seven whole days, Sunday first.
// Day 0 is Sunday (Pine 1) ... day 6 Saturday (Pine 7), written out, never derived from the code.
const T60 = Date.UTC(2024, 0, 7, 5, 0) / 1000
const WEEK = Array.from({ length: 7 * 24 }, (_, i) => ({ t: T60 + i * 3600, o: 1, h: 1, l: 1, c: 1, v: 1 }))

describe('the same rules on a hand-written calendar (New York clock)', () => {
  const weekday = (i) => { const day = Math.floor(i / 24); return day >= 1 && day <= 5 }
  it('v4 "0000-0000" with no day list (the v4 reference\'s own example): Monday-Friday only', () => {
    const [o] = outputsOf(`${V4}plot(na(time(timeframe.period, "0000-0000")) ? 0 : 1)`, '60')
    expect(Array.from(evalOn(o.formula, WEEK, '60'))).toEqual(WEEK.map((_, i) => (weekday(i) ? 1 : 0)))
  })
  it('v4 with no day list is the same tree as ":23456" written out', () => {
    expect(outputsOf(`${V4}plot(time(timeframe.period, "0930-1600"))`, '60')[0].formula)
      .toBe(outputsOf(`${V4}plot(time(timeframe.period, "0930-1600:23456"))`, '60')[0].formula)
  })
  it('"1800-0200:23456": Sunday 18:00 through Friday 01:00, never Friday evening or Saturday', () => {
    const [o] = outputsOf(`${V6}plot(na(time(timeframe.period, "1800-0200:23456")) ? 0 : 1)`, '60')
    const want = WEEK.map((_, i) => {
      const day = Math.floor(i / 24) // 0 Sunday
      const hour = i % 24
      if (hour >= 18) return day <= 4 ? 1 : 0 // the session that ends tomorrow, Monday..Friday
      if (hour < 2) return day >= 1 && day <= 5 ? 1 : 0 // the session that ends today
      return 0
    })
    expect(Array.from(evalOn(o.formula, WEEK, '60'))).toEqual(want)
  })
  it('"1930-0230": the value is the :30 of the session grid on every in-session bar, after midnight too', () => {
    const [o] = outputsOf(`${V6}plot(na(time(timeframe.period, "1930-0230")) ? -1 : (time(timeframe.period, "1930-0230") - time) / 1000)`, '60')
    const want = WEEK.map((_, i) => { const h = i % 24; return h >= 20 || h <= 2 ? -1800 : -1 })
    expect(Array.from(evalOn(o.formula, WEEK, '60'))).toEqual(want)
  })
  it('"2000-0000:23456": 20:00-23:00 of Monday-Friday themselves', () => {
    const [o] = outputsOf(`${V6}plot(na(time(timeframe.period, "2000-0000:23456")) ? 0 : 1)`, '60')
    expect(Array.from(evalOn(o.formula, WEEK, '60'))).toEqual(WEEK.map((_, i) => (i % 24 >= 20 && weekday(i) ? 1 : 0)))
  })
})

describe('a fixed zone in UTC notation (the manual) is the measured GMT arithmetic', () => {
  const formulaOf = (zone) => outputsOf(`${V6}plot(na(time(timeframe.period, "0930-1000:1234567", "${zone}")) ? 0 : 1)`)[0].formula
  it('"UTC-4" is "GMT-4"; "GMT+0100" and "UTC+1" are one hour; "UTC+05:30" is 330 minutes', () => {
    expect(formulaOf('UTC-4')).toBe(formulaOf('GMT-4'))
    expect(formulaOf('GMT+0100')).toBe(formulaOf('UTC+1'))
    expect(formulaOf('UTC+05:30')).toMatch(/floor\(time \/ 60\) \+ 330/)
  })
  it('a spelling the manual does not show, or an offset past 14 hours, refuses by name', () => {
    for (const zone of ['UTC+530', 'UTC+15', 'GMT+14:30', 'UTC']) {
      expect(refusalOf(`${V6}plot(na(time(timeframe.period, "0930-1000:1234567", "${zone}")) ? 0 : 1)`).message,
        zone).toMatch(/is not one this engine reads/)
    }
  })
})
