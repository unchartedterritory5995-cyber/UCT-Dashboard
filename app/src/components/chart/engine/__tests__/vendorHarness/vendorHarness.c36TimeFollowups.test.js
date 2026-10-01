// ─── ⭐⭐ C36 — WHAT C30 LEFT: weekend bars, the silent non-daily chart, and the
//     two rows the probe asked that were never served ──────────────────────────
//
// C30 serves `time("W" | "M" | "3M" | "12M")` on a daily chart off
// `tests/fixtures/vendor/harness/vw-time-tf-spy-1d-2026-09-28.json`. Three things
// were left, and each is a statement about what that capture does NOT show:
//
//  1. WEEKEND BARS. AMEX:SPY trades Monday to Friday, so the capture cannot tell a
//     Monday-first week from a Sunday-first one (C30's mutation M5 survived for
//     exactly that reason). On a daily chart whose bars include a Saturday or a
//     Sunday nothing was measured — not the week, and not the month / quarter /
//     year either (their anchor is "the `time` of the period's first daily bar,
//     09:30 New York", and a symbol that trades weekends keeps neither that
//     session nor, on a UTC day, that calendar). Every bar, both lanes, withheld
//     and NAMED. There is no capture of such a chart, so the weekend series here
//     is SYNTHETIC — it proves the withholding, never a value.
//
//  2. THE SILENT NON-DAILY CHART. Every bar was already withheld there; nothing
//     said why. The reason now rides out of the same function that makes the
//     decision (`interpret.js::periodAnchorMask` → `nativeRegistry.chartClockReport`,
//     the object reader's `chartClock`), which is what the binder publishes to the
//     member's disclosure strip (`chartClockNotice.test.jsx`).
//
//  3. `time(timeframe.period)` AND `time("60")`. The probe asked both (T05, T06)
//     and both equal `time` on all 900 daily bars AND on all 300 hourly bars of
//     `vw-time-tf-spy-60-2026-09-28.json`. Served on those two chart timeframes,
//     withheld and named on any other, and nothing wider than the rows show.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { validateCapture, sealCapture, sha256Hex } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { translatePine } from '../../ast/pine.js'
import {
  interpret, periodFirstCondition, periodAnchorMask, isPeriodAnchor, isChartOwnTime,
  chartOwnTimeNode, OWN_TIME_WITNESSED_TF, CHART_CLOCK_WITHHELD,
} from '../../ast/interpret.js'

const REPO = path.resolve(process.cwd(), '..')
const load = (name) => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', name), 'utf8'))
const D1 = load('vw-time-tf-spy-1d-2026-09-28.json')
const H60 = load('vw-time-tf-spy-60-2026-09-28.json')
const M5 = load('vw-clock-vwap-spy-5-ext-2026-09-28.json')
const LONG = load('vw-clock-close-tfchange-spy-1d-2026-09-28.json')

const pine = (lines) => ['//@version=6', 'indicator("c36", overlay=true)', ...lines].join('\n')
const on = (capture, src) => runOurSide({ ...capture, source: { ...capture.source, text: src } })
const column = (ours, i = 0) => Array.from(ours.plots[i].column)
const allNaN = (col) => col.length > 0 && col.every(Number.isNaN)
const noteCodes = (ours) => ours.notes.map((n) => (/withheld \(([a-z:-]+)\)/.exec(n) || [])[1]).filter(Boolean)

/** The daily SPY capture with a Saturday and a Sunday bar after every Friday — a
 *  symbol that trades every day. SYNTHETIC: it proves a withholding, not a value. */
function withWeekends(capture, keep = 160) {
  const rows = []
  for (const r of capture.bars.rows.slice(-keep)) {
    rows.push(r)
    const dow = new Date(r[0] * 1000).getUTCDay()
    if (dow === 5) {
      rows.push([r[0] + 86400, ...r.slice(1)])
      rows.push([r[0] + 2 * 86400, ...r.slice(1)])
    }
  }
  return { ...capture, bars: { ...capture.bars, rows } }
}
const WEEKEND = withWeekends(D1)
const WEEKDAYS = { ...D1, bars: { ...D1.bars, rows: D1.bars.rows.slice(-160) } }

/** A capture with `input.time` (T16 — refused by its own rule) cut, re-sealed. */
function derive(capture) {
  const drop = 'T16_input_time_default_DAYS'
  const text = capture.source.text.split('\n')
    .filter((l) => !l.includes(`"${drop}"`) && !l.startsWith('startTime ='))
    .join('\n')
  const plots = capture.study.plots.filter((p) => p.title !== drop)
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

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

describe('C36 · 1 — a daily chart whose bars include a weekend: all four anchors withheld, by name', () => {
  it('the synthetic series really holds Saturdays and Sundays; the capture it is built from holds none', () => {
    const dows = (cap) => new Set(column(on(cap, pine(['plot(dayofweek)']))))
    expect([...dows(WEEKDAYS)].sort()).toEqual([2, 3, 4, 5, 6])
    expect([...dows(WEEKEND)].sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  for (const tf of ['W', 'M', '3M', '12M']) {
    it(`plot(time("${tf}")) — every bar withheld on the weekend series, and the reason is named`, () => {
      const ours = on(WEEKEND, pine([`plot(time("${tf}"), "t")`]))
      expect(ours.ok, ours.refusal).toBe(true)
      expect(allNaN(column(ours))).toBe(true)
      expect(noteCodes(ours)).toEqual(['time-anchor:weekend-bars'])
      expect(ours.notes.join('\n')).toMatch(/daily bars include a Saturday or a Sunday/)
      expect(ours.notes.join('\n')).toMatch(/`vw-time-tf` probe on a 1D chart of a symbol that trades every day/)
    })
  }

  it('⛔ a reader of the anchor is withheld too — never `na(time("W"))` answering a confident true', () => {
    const ours = on(WEEKEND, pine(['plot(na(time("W")) ? 111 : 222, "r")', 'plot(ta.change(time("M")) != 0 ? 1 : 0, "e")']))
    expect(allNaN(column(ours, 0))).toBe(true)
    expect(allNaN(column(ours, 1))).toBe(true)
  })

  it('⛔ the object lane: a last-bar label reading the anchor is withheld, and says why', () => {
    const ours = on(WEEKEND, pine([
      'if barstate.islast',
      '    label.new(bar_index, high, na(time("W")) ? "na" : "known")',
    ]))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.counts.labels).toBe(0)
    expect(ours.objects.chartClock.map((r) => r.code)).toEqual(['time-anchor:weekend-bars'])
    expect(ours.notes.some((n) => n.includes('in the object lane') && n.includes('time-anchor:weekend-bars'))).toBe(true)
  })

  it('CONTROL — the same scripts on the weekday series are SERVED, with no reason given', () => {
    const plot = on(WEEKDAYS, pine(['plot(time("W"), "t")', 'plot(na(time("W")) ? 111 : 222, "r")']))
    const w = column(plot, 0)
    expect(w.filter(Number.isNaN).length).toBeGreaterThan(0)       // the first partial week
    expect(w.filter(Number.isNaN).length).toBeLessThan(6)
    expect(new Set(column(plot, 1).filter((v) => !Number.isNaN(v)))).toEqual(new Set([222]))
    expect(noteCodes(plot)).toEqual([])
    const label = on(WEEKDAYS, pine(['if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    expect(label.objects.texts.labels).toEqual(['known'])
    expect(label.objects.chartClock).toEqual([])
  })

  it('CONTROL — on the weekend series a tree that reads NO anchor is untouched', () => {
    const ours = on(WEEKEND, pine(['plot(close, "c")', 'plot(time, "t")', 'plot(time(timeframe.period), "own")']))
    expect(column(ours, 0).some(Number.isNaN)).toBe(false)
    expect(column(ours, 1).some(Number.isNaN)).toBe(false)
    // the bar's own time is an identity, not a period rule: served on a 1D chart
    expect(column(ours, 2)).toEqual(column(ours, 1))
    expect(noteCodes(ours)).toEqual([])
  })
})

describe('C36 · 1 — C30\'s surviving mutation M5 (a Sunday-first week) is MOOT, and here is why', () => {
  // The week key, with the week starting on Sunday instead of Monday: `+ 5` → `+ 6`.
  const mondayFirst = periodFirstCondition('W')
  // (both copies of the key: the bar's own and the `[1]` it is compared with)
  const sundayFirst = JSON.parse(JSON.stringify(mondayFirst).replace(/"value":5\}/g, '"value":6}'))
  const events = (cond, bars) => Array.from(interpret(cond, bars, {}, undefined, undefined, { tf: 'D' }))
  const anchorOf = (cond) => ({ type: 'call', name: 'valuewhenOccurrence', args: [cond, { type: 'series', name: 'time' }, { type: 'num', value: 0 }] })

  it('the mutation is a real change to the tree (one literal), and is no longer recognised as the anchor', () => {
    expect(sundayFirst).not.toEqual(mondayFirst)
    expect(JSON.stringify(mondayFirst).match(/"value":5\}/g).length).toBe(2)
    expect(JSON.stringify(sundayFirst)).not.toMatch(/"value":5\}/)
    expect(isPeriodAnchor(anchorOf(mondayFirst))).toBe(true)
    expect(isPeriodAnchor(anchorOf(sundayFirst))).toBe(false)
  })

  it('on Monday-to-Friday bars the two keys open a week on EXACTLY the same bars — 900 and 8,473 sessions', () => {
    for (const cap of [D1, LONG]) {
      const bars = toProductBars(cap)
      const a = events(mondayFirst, bars)
      expect(a.filter((v) => v === 1).length).toBeGreaterThan(150)
      expect(events(sundayFirst, bars)).toEqual(a)
    }
    expect(toProductBars(LONG).length).toBe(8473)
  })

  it('⛔ on bars that include a weekend they PART — and that is exactly the series where nothing is served', () => {
    const bars = toProductBars(WEEKEND)
    const a = events(mondayFirst, bars)
    const b = events(sundayFirst, bars)
    const differ = a.filter((v, i) => v !== b[i] && !(Number.isNaN(v) && Number.isNaN(b[i]))).length
    expect(differ).toBeGreaterThan(40)
    // the served anchor on that series: every bar withheld, so no bar can show either answer
    const sink = new Map()
    const mask = periodAnchorMask(anchorOf(mondayFirst), bars, {}, undefined, undefined, { tf: 'D', chartClockSink: sink })
    expect(Array.from(mask).every((m) => m === 1)).toBe(true)
    expect([...sink.keys()]).toEqual(['time-anchor:weekend-bars'])
  })
})

describe('C36 · 2 — a chart that is not daily: withheld as before, and now it says why', () => {
  it('60m: the plot lane names `time-anchor:not-daily`, with the chart\'s own timeframe and the capture that settles it', () => {
    const ours = on(H60, pine(['plot(time("W"), "w")', 'plot(time("12M"), "y")']))
    expect(allNaN(column(ours, 0)) && allNaN(column(ours, 1))).toBe(true)
    expect(noteCodes(ours)).toEqual(['time-anchor:not-daily'])
    const note = ours.notes.find((n) => n.includes('time-anchor:not-daily'))
    expect(note).toMatch(/on 2 plot\(s\)/)
    expect(note).toMatch(/This chart's timeframe is `60`/)
    expect(note).toMatch(/On a 1D chart it draws/)
    expect(note).toMatch(/`vw-time-tf` probe measured on this timeframe/)
  })

  it('60m: the object lane carries the same reason', () => {
    const ours = on(H60, pine(['if barstate.islast', '    label.new(bar_index, high, na(time("W")) ? "na" : "known")']))
    expect(ours.objects.counts.labels).toBe(0)
    expect(ours.objects.chartClock).toEqual([{ code: 'time-anchor:not-daily', reason: CHART_CLOCK_WITHHELD['time-anchor:not-daily']('60') }])
  })

  it('CONTROL — the same plots on the daily chart report nothing (the first partial period is a per-bar matter)', () => {
    const ours = on(D1, pine(['plot(time("W"), "w")', 'plot(time("12M"), "y")']))
    expect(noteCodes(ours)).toEqual([])
    expect(column(ours, 0).filter(Number.isNaN).length).toBe(1)
    expect(column(ours, 1).filter(Number.isNaN).length).toBe(214)
  })

  it('CONTROL — a script with no `time(<timeframe>)` reports nothing on the 60m chart', () => {
    const ours = on(H60, pine(['plot(close)', 'if barstate.islast', '    label.new(bar_index, high, "x")']))
    expect(noteCodes(ours)).toEqual([])
    expect(ours.objects.chartClock).toEqual([])
  })

  it('every sentence names what would settle it, and the timeframe it is told', () => {
    for (const [code, say] of Object.entries(CHART_CLOCK_WITHHELD)) {
      expect(say('5'), code).toMatch(/What would settle it/)
      expect(say('5'), code).toMatch(/withheld/)
    }
    expect(CHART_CLOCK_WITHHELD['time-anchor:not-daily']('W')).toMatch(/timeframe is `W`/)
    expect(CHART_CLOCK_WITHHELD['time-own:chart-unwitnessed'](undefined)).toMatch(/timeframe is not stated/)
  })
})

describe('C36 · 3 — `time(timeframe.period)` and `time("60")`: the bar\'s own time, where a capture shows it', () => {
  it('the two captures are valid, and both rows read 0 on every vendor bar — 900 daily, 300 hourly', () => {
    for (const [cap, n] of [[D1, 900], [H60, 300]]) {
      expect(validateCapture(cap).ok).toBe(true)
      for (const title of ['T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
        const c = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === title).id)
        const col = cap.plotValues.rows.map((r) => r[c])
        expect(col.length).toBe(n)
        expect(new Set(col)).toEqual(new Set([0]))
      }
    }
  })

  describe('the 60m capture through the real member door (T16 cut, re-sealed)', () => {
    const { verdict, integrity } = gradeCapture(derive(H60))
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
    it('⛔ the seven period rows draw NOTHING on the hourly chart — 0 wrong values, every bar withheld', () => {
      for (const title of ['T01_timeW_minus_time_DAYS', 'T02_timeM_minus_time_DAYS', 'T03_time3M_minus_time_DAYS',
        'T04_time12M_minus_time_DAYS', 'T07_newWeek', 'T08_newMonth', 'T09_newQuarter']) {
        const p = byTitle.get(title)
        expect(p.stats.valueMismatches, title).toBe(0)
        expect(p.stats.matching, title).toBe(0)
        expect(p.stats.naMismatches, title).toBe(300)
      }
    })
  })

  it('a 5-minute chart is not one of the two measured: every bar withheld, named, in both lanes', () => {
    expect(OWN_TIME_WITNESSED_TF).toEqual(['D', '60'])
    const ours = on(M5, pine(['plot(time(timeframe.period), "own")', 'plot(time("60"), "sixty")', 'plot(time, "t")']))
    expect(ours.ok, ours.refusal).toBe(true)
    expect(allNaN(column(ours, 0)) && allNaN(column(ours, 1))).toBe(true)
    expect(column(ours, 2).some(Number.isNaN)).toBe(false)
    expect(noteCodes(ours)).toEqual(['time-own:chart-unwitnessed'])
    expect(ours.notes.join('\n')).toMatch(/This chart's timeframe is `5`/)
    const label = on(M5, pine(['if barstate.islast', '    label.new(bar_index, high, na(time(timeframe.period)) ? "na" : "known")']))
    expect(label.objects.counts.labels).toBe(0)
    expect(label.objects.chartClock.map((r) => r.code)).toEqual(['time-own:chart-unwitnessed'])
  })

  it('CONTROL — the same label on the 60m and 1D charts IS drawn, and reads the known answer', () => {
    for (const cap of [H60, D1]) {
      const label = on(cap, pine(['if barstate.islast', '    label.new(bar_index, high, na(time(timeframe.period)) ? "na" : "known")']))
      expect(label.objects.texts.labels).toEqual(['known'])
      expect(label.objects.chartClock).toEqual([])
    }
  })

  it('the tree is the ONE builder\'s, gated on the two measured bar lengths', () => {
    const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
    const own = S('plot(time(timeframe.period))', { strict: true })
    expect(own.ok).toBe(true)
    expect(own.outputs[own.selected].formula).toBe('periodseconds == 86400 || periodseconds == 3600 ? time * 1000 : 0 / 0')
    expect(own.outputs[own.selected].ast).toEqual(chartOwnTimeNode(true))
    expect(isChartOwnTime(own.outputs[own.selected].ast)).toBe(true)
    expect(S('plot(time("60"))', { strict: true }).outputs[0].ast).toEqual(chartOwnTimeNode(true))
    // a name bound to the chart's own timeframe is the same question
    expect(S('tf = timeframe.period\nplot(time(tf))', { strict: true }).outputs[0].ast).toEqual(chartOwnTimeNode(true))
    // a member's own ternary over the same leaves, one literal different, is NOT it
    const near = JSON.parse(JSON.stringify(chartOwnTimeNode(true)).replace('3600', '900'))
    expect(isChartOwnTime(near)).toBe(false)
  })

  it('refused by name — everything the two captures do not show', () => {
    const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
    // any other literal: the probe asked "60" and nothing else below the chart
    for (const tf of ['"15"', '"30"', '"240"', '"1H"', '"5"']) {
      const t = S(`plot(time(${tf}))`, { strict: true })
      expect(t.ok, tf).toBe(false)
      expect(t.refusal.guard, tf).toBe('pine:function')
    }
    // a chart the translation is TOLD is neither 1D nor 60m
    for (const base of ['5', '15', 'W', 'M']) {
      for (const body of ['plot(time(timeframe.period))', 'plot(time("60"))']) {
        const t = S(body, { strict: true, basePeriod: base })
        expect(t.ok, `${body} on ${base}`).toBe(false)
        expect(t.refusal.message, base).toMatch(/1D and 60-minute charts only/)
        expect(t.refusal.message, base).toMatch(/same probe on this timeframe/)
      }
    }
    expect(S('plot(time(timeframe.period))', { strict: true, basePeriod: '60' }).ok).toBe(true)
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
