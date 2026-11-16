// ⭐⭐ NUMBER PENDING (bt, 2026-11-16) — `time(tf, session[, zone])`: the wrapping session, the v4
// default days and the UTC spelling of a fixed zone, held to what witnesses each.
//
//   · a session whose end is not after its start, for MEMBERSHIP: capture
//     `vw-w4-session-overnight-btcusd-60-2026-11-16` (probe
//     `tools/visual_conformance/probes/vw-w4-session-overnight.pine`, BITSTAMP:BTCUSD 60, 25,215
//     bars), rows O1-O4, every bar; and the user manual's session table. ⛔ The capture reaches
//     `tests/fixtures/vendor/harness/` through the capture session's cq1 data PR (never a copy
//     committed here); until that PR is on the tree the capture block below is SKIPPED, by a title
//     that says so, and this unit's PR lands after it;
//   · a v4 session with no day list is Monday to Friday: the v4 reference (`time`) and the
//     v4->v5 migration guide, quoted at `pine.js::sessionClockOf`; checked here against a calendar
//     written out by hand;
//   · "UTC±H" / "UTC±HH:MM" / "GMT±HHMM": the user manual ("UTC (or GMT) offset notation"); the
//     arithmetic is the measured "GMT-4" one, so the trees must be the same tree.
// What stays refused keeps its name, and each refusal has a case here.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const REPO = path.resolve(process.cwd(), '..')
const OVERNIGHT = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-w4-session-overnight-btcusd-60-2026-11-16.json')
const OVERNIGHT_HELD = fs.existsSync(OVERNIGHT)
const V6 = '//@version=6\nindicator("p")\n'
const V4 = '//@version=4\nstudy("p")\n'
const V3 = '//@version=3\nstudy("p")\n'

const tr = (src, basePeriod = 'D') => translatePine(src, { strict: true, basePeriod })
const outputsOf = (src, basePeriod) => {
  const t = tr(src, basePeriod)
  expect(t.ok, t.ok ? '' : `${t.refusal && t.refusal.guard}: ${t.refusal && t.refusal.message}`).toBe(true)
  return t.outputs
}
const refusalOf = (src, basePeriod) => {
  const t = tr(src, basePeriod)
  const r = t.ok ? (t.outputs || []).map((o) => o.refusal).find(Boolean) : t.refusal
  expect(r, 'expected a refusal').toBeTruthy()
  return r
}
const evalOn = (formula, bars, tf) => interpret(parseFormula(formula).ast, bars, {}, undefined, undefined, { tf })

describe.skipIf(!OVERNIGHT_HELD)(`a wrapping session, membership: vw-w4-session-overnight O1-O4 on every bar${
  OVERNIGHT_HELD ? '' : ' — SKIPPED: WAITS ON THE cq1 DATA PR (capture not on this tree)'}`, () => {
  const d = OVERNIGHT_HELD ? JSON.parse(fs.readFileSync(OVERNIGHT, 'utf8')) : null
  if (!d) return
  const titles = d.study.plots.map((p) => p.title)
  const col = (name) => 1 + titles.indexOf(name)
  const rows = d.plotValues.rows
  const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  const index = new Map(d.bars.rows.map((r, i) => [r[0], i]))
  // The probe reads the session in the EXCHANGE zone, which for BITSTAMP:BTCUSD is Etc/UTC
  // (`d.symbol.timezone`, asserted below). This engine's exchange clock is New York, so the same
  // question is asked here with the zone written out: "GMT+0" is that clock, by the measured
  // fixed-offset arithmetic.
  const CASES = [
    ['O1_na_wrap_all_days', '1800-0200:1234567'],
    ['O2_na_wrap_weekdays', '1800-0200:23456'],
    ['O3_na_to_midnight', '2000-0000:1234567'],
    ['O4_na_whole_day', '0000-0000:1234567'],
  ]

  it('the capture is the probe, in the zone this rail assumes, and it discriminates', () => {
    expect(d.symbol.timezone).toBe('Etc/UTC')
    expect(d.timeframe).toBe('60')
    expect(rows.length).toBeGreaterThan(20000)
    const inOf = (name) => rows.filter((r) => r[col(name)] === 0)
    // O1 and O2 differ exactly on the weekend side of the wrap; O3 is 4 hours a day; O4 every bar
    const o1 = inOf('O1_na_wrap_all_days').length
    const o2 = inOf('O2_na_wrap_weekdays').length
    expect(o1).toBeGreaterThan(o2 + 1000)
    expect(o2).toBeGreaterThan(5000)
    expect(inOf('O3_na_to_midnight').every((r) => r[col('HOUR')] >= 20)).toBe(true)
    expect(inOf('O4_na_whole_day').length).toBe(rows.length)
    // the after-midnight part belongs to the session that ENDS that day: Friday 00:00-01:59 in,
    // Friday 18:00 out, Sunday 18:00 in, Saturday never (O2)
    const o2At = (dow, hour) => rows.filter((r) => r[col('DOW_dayofweek')] === dow && r[col('HOUR')] === hour)
      .map((r) => r[col('O2_na_wrap_weekdays')])
    expect(new Set(o2At(6, 1))).toEqual(new Set([0]))
    expect(new Set(o2At(6, 18))).toEqual(new Set([1]))
    expect(new Set(o2At(1, 18))).toEqual(new Set([0]))
    expect(new Set(o2At(7, 1))).toEqual(new Set([1]))
  })

  for (const [title, spec] of CASES) {
    it(`${title} ("${spec}") matches on every bar, read as \`na(time(…))\``, () => {
      const [o] = outputsOf(`${V6}plot(na(time(timeframe.period, "${spec}", "GMT+0")) ? 1 : 0, "${title}")`, '60')
      const ours = evalOn(o.formula, bars, '60')
      let bad = 0
      let first = null
      for (const r of rows) {
        const got = ours[index.get(r[0])]
        if (got !== r[col(title)]) { bad += 1; if (!first) first = { t: r[0], want: r[col(title)], got } }
      }
      expect(bad, `${bad}/${rows.length} differ, first ${JSON.stringify(first)} — ${o.formula}`).toBe(0)
    })
  }
})

describe('what a wrapping session still refuses, by name', () => {
  it('its VALUE (the probe read membership only)', () => {
    const r = refusalOf(`${V6}plot(time(timeframe.period, "1800-0200:1234567") / 1000)`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/wraps past midnight[\s\S]*VALUE inside a wrapping session is not measured/)
  })
  it('membership through a binding: the call has to be written inside `na(…)`', () => {
    const r = refusalOf(`${V6}t = time(timeframe.period, "1800-0200:1234567")\nplot(na(t) ? 1 : 0)`)
    expect(r.message).toMatch(/wraps past midnight/)
  })
  it('CONTROL: the membership read beside a value read of the same session — the value refuses', () => {
    const r = refusalOf(`${V6}s = "1800-0200:1234567"\nplot(na(time(timeframe.period, s)) ? 1 : time(timeframe.period, s))`)
    expect(r.message).toMatch(/VALUE inside a wrapping session/)
  })
  it('"HHMM-0000" with a day list that is not every day', () => {
    const r = refusalOf(`${V6}plot(na(time(timeframe.period, "2000-0000:23456")) ? 1 : 0)`)
    expect(r.message).toMatch(/runs to midnight/)
  })
  it('CONTROL: a same-day session is untouched — the same tree it always was', () => {
    const [o] = outputsOf(`${V6}plot(time(timeframe.period, "0930-1000:23456") / 1000)`)
    expect(o.formula).toMatch(/dayofweek == 2/)
    expect(o.formula).not.toMatch(/mod\(dayofweek, 7\)/)
  })
})

// Hourly bars from Sunday 2024-01-07 00:00 New York (EST, UTC-5): seven whole days, Sunday first.
// Day 0 is Sunday (Pine 1) ... day 6 Saturday (Pine 7), written out, never derived from the code.
const T60 = Date.UTC(2024, 0, 7, 5, 0) / 1000
const WEEK = Array.from({ length: 7 * 24 }, (_, i) => ({ t: T60 + i * 3600, o: 1, h: 1, l: 1, c: 1, v: 1 }))
const PINE_DOW = [1, 2, 3, 4, 5, 6, 7]

describe('a v4 session with no day list is Monday to Friday (v4 reference, migration guide)', () => {
  it('"0000-0000" (the v4 reference\'s own example) is in on Monday-Friday, out on Saturday and Sunday', () => {
    const [o] = outputsOf(`${V4}plot(na(time(period, "0000-0000")) ? 0 : 1)`, '60')
    const got = evalOn(o.formula, WEEK, '60')
    const want = WEEK.map((_, i) => ([2, 3, 4, 5, 6].includes(PINE_DOW[Math.floor(i / 24)]) ? 1 : 0))
    expect(Array.from(got)).toEqual(want)
  })
  it('it is the same tree as ":23456" written out', () => {
    const a = outputsOf(`${V4}plot(time(period, "0930-1600"))`, '60')[0].formula
    const b = outputsOf(`${V4}plot(time(period, "0930-1600:23456"))`, '60')[0].formula
    expect(a).toBe(b)
  })
  it('v1-v3 keep the refusal: no reference text states their default', () => {
    const r = refusalOf(`${V3}plot(na(time(period, "0930-1600")) ? 0 : 1)`)
    expect(r.guard).toBe('pine:function')
    expect(r.message).toMatch(/no day list[\s\S]*not stated by any reference text/)
  })
})

describe('a wrapping session on a hand-written calendar (New York clock)', () => {
  it('"1800-0200:23456": Sunday 18:00 through Friday 01:00, never Friday evening or Saturday', () => {
    const [o] = outputsOf(`${V6}plot(na(time(timeframe.period, "1800-0200:23456")) ? 0 : 1)`, '60')
    const got = Array.from(evalOn(o.formula, WEEK, '60'))
    const want = WEEK.map((_, i) => {
      const day = Math.floor(i / 24) // 0 Sunday
      const hour = i % 24
      if (hour >= 18) return day <= 4 ? 1 : 0 // tomorrow is Monday..Friday
      if (hour < 2) return day >= 1 && day <= 5 ? 1 : 0 // today is Monday..Friday
      return 0
    })
    expect(got).toEqual(want)
  })
  it('"1700-1700" (the manual\'s overnight session) holds every hour of every day', () => {
    const [o] = outputsOf(`${V6}plot(na(time(timeframe.period, "1700-1700")) ? 0 : 1)`, '60')
    expect(Array.from(evalOn(o.formula, WEEK, '60')).every((v) => v === 1)).toBe(true)
  })
  it('"0000-0000:23456" (the manual\'s Monday-to-Friday whole day) is the bar\'s own date', () => {
    const [o] = outputsOf(`${V6}plot(na(time(timeframe.period, "0000-0000:23456")) ? 0 : 1)`, '60')
    const want = WEEK.map((_, i) => ([2, 3, 4, 5, 6].includes(PINE_DOW[Math.floor(i / 24)]) ? 1 : 0))
    expect(Array.from(evalOn(o.formula, WEEK, '60'))).toEqual(want)
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
