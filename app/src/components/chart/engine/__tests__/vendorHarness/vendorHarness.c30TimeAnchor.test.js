// ─── ⭐⭐ C30 — `time("W" | "M" | "3M" | "12M")` ON A DAILY CHART, through the member door ──
//
// The capture: `tests/fixtures/vendor/harness/vw-time-tf-spy-1d-2026-09-28.json`
// (probe `tools/visual_conformance/probes/vw-time-tf.pine`, AMEX:SPY 1D, 900 bars
// 2023-02-24 → 2026-09-25). Its rows T01–T04 plot `(time(tf) - time)` in days and
// T07–T09 the new-period idiom `ta.change(time(tf)) != 0`.
//
// THE RULE THE CAPTURE SHOWS (stated once, `pine.js::periodAnchorOf`): `time(tf)` is
// the `time` of the FIRST DAILY BAR of the bar's New York ISO week / month / quarter /
// year — the session open, never the calendar boundary; a holiday-Monday week anchors
// to its Tuesday. Before the first period boundary the series shows, the vendor
// answers an open from bars before our window; those bars (and the bar that reads
// one back through `ta.change`) are WITHHELD — `na` on our side, never a value.
//
// ⚠️ THE PROBE ITSELF STAYS REFUSED AT THE DOOR, on ONE row: T16 (`input.time`,
// `pine:input-kind` — a ruled wall that is not a clock question). So the replay
// grades a DERIVED capture — that one row cut from the source, its column dropped,
// re-sealed — only after the PARENT capture's own receipt and source sha verify.
// Every number compared is the vendor's.
// ⭐ C36 — T05 (`time(timeframe.period)`) and T06 (`time("60")`) were cut here too
// until they were served; they are now graded with the rest, 0 mismatches on all
// 900 bars (`vendorHarness.c36TimeFollowups.test.js` holds their rule and the 60m
// reading). The derived capture cannot be dropped for the original while T16 refuses.
//
// ⭐⭐ C49 (2026-10-01) — RE-PINNED, WITH THE REASON. Capture round 3 showed the rule
// above is a special case: the vendor answers the open of the period's first
// CALENDAR session, bar or no bar (`indicators.js::computePeriodCalendar`;
// `vendorHarness.c49CapturedClock.test.js` holds the captures). On this capture the
// two rules agree on every bar the first-bar rule could answer, and the calendar
// answers the rest: the 1 / 3 / 26 / 214 first-partial-period bars C30 withheld are
// SERVED and equal TradingView (bar 0 reads −3 / −23 / −52 / −52 days, opens this
// series does not hold). What stays withheld is bar 0 of a `ta.change(time(tf))`
// row — it reads the anchor of a bar before the series. And the 60-minute capture
// C30 read as "a different rule" is the same rule: its −1.0417 days on bar 0
// (Tuesday 10:30) is Monday 09:30, that week's open.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { validateCapture, sealCapture, sha256Hex } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { translatePine } from '../../ast/pine.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const REPO = path.resolve(process.cwd(), '..')
const FILE = path.join(REPO, 'tests/fixtures/vendor/harness/vw-time-tf-spy-1d-2026-09-28.json')
const CAPTURE = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const OUT_OF_SCOPE = ['T16_input_time_default_DAYS']

/** The capture with the out-of-scope rows cut, re-sealed. `mutateVendor(title, rows)`
 *  lets a CONTROL corrupt one vendor column. */
function derive(mutateVendor) {
  const drop = new Set(OUT_OF_SCOPE)
  const text = CAPTURE.source.text.split('\n')
    .filter((l) => ![...drop].some((t) => l.includes(`"${t}"`)) && !l.startsWith('startTime ='))
    .join('\n')
  const plots = CAPTURE.study.plots.filter((p) => !drop.has(p.title))
  const ids = new Set(plots.map((p) => p.id))
  const keep = CAPTURE.plotValues.fields.map((f, i) => ((f === 'time' || ids.has(f)) ? i : -1)).filter((i) => i >= 0)
  const fields = keep.map((i) => CAPTURE.plotValues.fields[i])
  const rows = CAPTURE.plotValues.rows.map((r) => keep.map((i) => r[i]))
  if (mutateVendor) mutateVendor(fields, rows, plots)
  return sealCapture({
    ...CAPTURE,
    id: `${CAPTURE.id}-c30-derived`,
    source: { ...CAPTURE.source, text, sha256: sha256Hex(text), chars: text.length },
    study: { ...CAPTURE.study, plots },
    plotValues: { fields, rows },
  })
}

/** New York calendar parts of a unix-second instant. */
const ny = (t) => {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(new Date(t * 1000))
  const g = (k) => s.find((p) => p.type === k).value
  return { y: +g('year'), m: +g('month'), d: +g('day'), wd: g('weekday') }
}
const TIMES = CAPTURE.bars.rows.map((r) => r[0])
/** Bars before the first period boundary the series shows, per period key. */
function firstPeriodBars(key) {
  const k0 = key(ny(TIMES[0]))
  let n = 0
  while (n < TIMES.length && key(ny(TIMES[n])) === k0) n++
  return n
}
const isoWeek = ({ y, m, d }) => {
  const at = Date.UTC(y, m - 1, d) / 86400000
  const dow = (new Date(at * 86400000).getUTCDay() + 6) % 7
  return at - dow
}
const PERIODS = {
  T01_timeW_minus_time_DAYS: isoWeek,
  T02_timeM_minus_time_DAYS: ({ y, m }) => y * 12 + m,
  T03_time3M_minus_time_DAYS: ({ y, m }) => y * 4 + Math.floor((m - 1) / 3),
  T04_time12M_minus_time_DAYS: ({ y }) => y,
}
const CHANGES = {
  T07_newWeek: PERIODS.T01_timeW_minus_time_DAYS,
  T08_newMonth: PERIODS.T02_timeM_minus_time_DAYS,
  T09_newQuarter: PERIODS.T03_time3M_minus_time_DAYS,
}

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

describe('C30 — the parent capture, and the door on the probe as captured', () => {
  it('the parent capture verifies (receipt + source sha) before anything is derived from it', () => {
    const v = validateCapture(CAPTURE)
    expect(v.ok, v.errors && v.errors.join('; ')).toBe(true)
    expect(CAPTURE.bars.rows.length).toBe(900)
  })

  it('the probe as captured still refuses at the door — on a row OUTSIDE this lane, by name', () => {
    const { verdict } = gradeCapture(CAPTURE)
    expect(verdict.verdict).toBe('INCONCLUSIVE')
    expect(verdict.reason).toMatch(/member door refused \(pine:input-kind\)/)
    // the refusal is `input.time` alone — never a `time(<timeframe>)` row (C36 serves T05 / T06)
    const t = translatePine(CAPTURE.source.text, { strict: true, basePeriod: 'D' })
    const refusedTitles = t.outputs.map((o, i) => (o.refusal ? CAPTURE.study.plots[i].title : null)).filter(Boolean)
    expect(refusedTitles).toEqual(OUT_OF_SCOPE)
  })
})

describe('C30 — date for date against TradingView (derived capture, the real member door)', () => {
  const derived = derive()
  const { verdict, integrity } = gradeCapture(derived)
  const byTitle = new Map(verdict.plots.map((p) => [p.title, p]))

  it('the derived capture is sealed and valid', () => {
    expect(integrity.ok, integrity.errors && integrity.errors.join('; ')).toBe(true)
  })

  for (const [title, key] of Object.entries(PERIODS)) {
    it(`${title}: equal to TradingView on all 900 bars — the first partial period included (C49: the calendar's open)`, () => {
      const p = byTitle.get(title)
      expect(p, title).toBeTruthy()
      expect(p.verdict).toBe('MATCH')
      expect(p.stats).toMatchObject({ matching: 900, valueMismatches: 0, naMismatches: 0 })
      // …and the bars C30 withheld are real vendor numbers, not blanks on both sides
      const first = firstPeriodBars(key)
      const c = derived.plotValues.fields.indexOf(derived.study.plots.find((x) => x.title === title).id)
      expect(derived.plotValues.rows.slice(0, first).every((r) => Number.isFinite(r[c]) && r[c] < 0), title).toBe(true)
    })
  }

  for (const title of Object.keys(CHANGES)) {
    it(`${title}: the new-period event agrees on every bar but bar 0, which reads the anchor of a bar before the series`, () => {
      const p = byTitle.get(title)
      expect(p.stats.valueMismatches).toBe(0)
      expect(p.stats.naMismatches).toBe(1)
      expect(p.stats.matching).toBe(899)
      expect(p.stats.firstDivergence).toMatchObject({ bar: 0, kind: 'na', ours: null })
    })
  }

  it('the bars C30 withheld and C49 serves are not vacuous: 1 / 3 / 26 / 214 first-period bars, bar 0 reading −3 / −23 / −52 / −52 days', () => {
    expect(Object.values(PERIODS).map(firstPeriodBars)).toEqual([1, 3, 26, 214])
    const at0 = Object.keys(PERIODS).map((title) => derived.plotValues.rows[0][derived.plotValues.fields.indexOf(derived.study.plots.find((x) => x.title === title).id)])
    expect(at0).toEqual([-3, -23, -52, -52])
  })

  // ⭐ C36 — the two rows that were cut until they were served: the bar's own `time`.
  for (const title of ['T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS']) {
    it(`${title}: equal to TradingView on all 900 bars, nothing withheld`, () => {
      const p = byTitle.get(title)
      expect(p, title).toBeTruthy()
      expect(p.verdict).toBe('MATCH')
      expect(p.stats).toMatchObject({ matching: 900, valueMismatches: 0, naMismatches: 0 })
    })
  }
})

describe('C30 — holiday Mondays: the week opens on its first TRADING day', () => {
  const ours = runOurSide(derive())
  const col = (title) => Array.from(ours.plots.find((p) => p.title === title).column)
  const W = col('T01_timeW_minus_time_DAYS')
  const bars = toProductBars(CAPTURE)

  it('17 weeks in the window open on a Tuesday, and each Tuesday reads 0 days (it IS the week\'s open)', () => {
    const tuesdayOpens = []
    for (let i = 1; i < TIMES.length; i++) {
      const a = ny(TIMES[i - 1])
      const b = ny(TIMES[i])
      if (isoWeek(a) !== isoWeek(b) && b.wd === 'Tue') tuesdayOpens.push(i)
    }
    expect(tuesdayOpens.length).toBe(17)
    for (const i of tuesdayOpens) {
      expect(W[i], bars[i].t).toBe(0)
      // and the rest of that week anchors to the Tuesday, not to the calendar Monday
      if (i + 1 < W.length && isoWeek(ny(TIMES[i + 1])) === isoWeek(ny(TIMES[i]))) expect(W[i + 1], bars[i + 1].t).toBe(-1)
    }
  })

  it('CONTROL: a vendor column anchored to the CALENDAR Monday instead is caught on every holiday week', () => {
    const idx = []
    const bad = derive((fields, rows, plots) => {
      const id = plots.find((p) => p.title === 'T01_timeW_minus_time_DAYS').id
      const c = fields.indexOf(id)
      for (let i = 1; i < rows.length; i++) {
        const a = ny(TIMES[i - 1])
        const b = ny(TIMES[i])
        const wk = isoWeek(b)
        const tuesdayWeek = isoWeek(a) !== wk ? b.wd === 'Tue' : false
        if (tuesdayWeek) idx.push(i)
      }
      for (const i of idx) {
        // every bar of that week one day further back
        const wk = isoWeek(ny(TIMES[i]))
        for (let j = i; j < rows.length && isoWeek(ny(TIMES[j])) === wk; j++) rows[j][c] -= 1
      }
    })
    const p = gradeCapture(bad).verdict.plots.find((x) => x.title === 'T01_timeW_minus_time_DAYS')
    expect(idx.length).toBe(17)
    expect(p.verdict).toBe('DIVERGE')
    expect(p.stats.valueMismatches).toBeGreaterThanOrEqual(17)
  })
})

describe('C30 — the object lane withholds what it cannot know, and prints what it can', () => {
  const on = (src) => runOurSide({ ...CAPTURE, source: { ...CAPTURE.source, text: src } })
  const pine = (lines) => ['//@version=6', 'indicator("c30", overlay=true)', ...lines].join('\n')
  const vendorW = CAPTURE.plotValues.rows.map((r) => r[1 + CAPTURE.study.plots.findIndex((p) => p.title === 'T01_timeW_minus_time_DAYS')])

  it('a last-bar label prints the vendor\'s own week offset', () => {
    const ours = on(pine([
      'd = (time("W") - time) / 86400000',
      'if barstate.islast',
      '    label.new(bar_index, high, str.tostring(d))',
    ]))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.texts.labels).toEqual([String(vendorW[vendorW.length - 1])])
  })

  it('⭐ C49 — a label on the FIRST bar (inside the partial week) prints the vendor\'s offset to an open this series does not hold — never an `na`', () => {
    const ours = on(pine([
      'd = na(time("W")) ? -99999 : (time("W") - time) / 86400000',
      'if barstate.isfirst',
      '    label.new(bar_index, high, str.tostring(d))',
    ]))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.texts.labels).not.toContain('-99999')
    // Fri 2023-02-24 → Tue 02-21 (Presidents' Day Monday is a closure the calendar applies)
    expect(vendorW[0]).toBe(-3)
    expect(ours.objects.texts.labels).toEqual([String(vendorW[0])])
  })

  it('CONTROL: the same first-bar label over a known clock IS drawn — the withholding is the anchor\'s', () => {
    const ours = on(pine([
      'if barstate.isfirst',
      '    label.new(bar_index, high, str.tostring(dayofweek))',
    ]))
    expect(ours.objects.counts.labels).toBe(1)
  })
})

describe('C30 — high-low-open-mid-ranges (NYSE:RDDT 1D): the weekly dividers, against TradingView\'s records', () => {
  // `vline(a) => if ta.change(time(higherTF)) and i_v1  line.new(a, low - ta.tr, a, high + ta.tr, …, extend.both)`
  // with `higherTF = input.timeframe("W")`. Until C30 that op refused
  // (`pine:function time(<timeframe>)`) and the script held NO line; TradingView
  // holds 504 (100 of them the dividers).
  const cap = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness/high-low-open-mid-ranges-rddt-1d-2026-09-28.json'), 'utf8'))
  const bars = toProductBars(cap)
  // built inside the test: the objects-only pane flag is stubbed in `beforeAll`
  const door = () => memberPaneDefinition({ source: cap.source.text, id: 'u_c30_ohlm', name: 'ohlm' })
  const lines = () => {
    const d = door()
    expect(d.ok, d.reason).toBe(true)
    const reader = objectReaderFor(d.definition, bars, {
      tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    return run.live.filter((o) => o.family === 'line').map((o) => o.props)
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4
  const V = cap.objects.records.lines

  it('every line we hold is one TradingView holds — all 504 (C49: its oldest too), none of ours unmatched', () => {
    const ours = lines()
    expect(V.length).toBe(504)
    expect(ours.length).toBe(504)
    const left = new Map()
    for (const l of V) { const k = `${r4(l.y1)}|${r4(l.y2)}`; left.set(k, (left.get(k) || 0) + 1) }
    const unmatched = []
    for (const l of ours) {
      const k = `${r4(l.y1)}|${r4(l.y2)}`
      if (left.get(k)) left.set(k, left.get(k) - 1)
      else unmatched.push(l)
    }
    expect(unmatched).toEqual([])
    // ⭐ C49 — until the first partial week was served the vendor's oldest line (id
    // 2151, y 82.21) was the one we did not hold: its op sat on a withheld bar.
    expect([...left.entries()].filter(([, n]) => n > 0)).toEqual([])
  })

  it('⭐ the 100 dividers: one per week TradingView draws one, at the same place in the sequence, same span', () => {
    const ours = lines()
    const ourV = ours.filter((l) => l.x1 === l.x2)
    const venV = V.filter((l) => l.x1 === l.x2)
    expect(venV.length).toBe(100)
    expect(ourV.length).toBe(100)
    // the capture keeps x as an index into its own point list; ours is the bar
    // index. The two orderings must pair one to one, with the vendor's y span.
    const xs = [...new Set(V.flatMap((l) => [l.x1, l.x2]))].sort((a, b) => a - b)
    const oxs = [...new Set(ours.flatMap((l) => [l.x1, l.x2]))].sort((a, b) => a - b)
    expect(oxs.length).toBe(xs.length)
    const toOurs = new Map(xs.map((x, i) => [x, oxs[i]]))
    const key = (x, l) => `${x}|${r4(l.y1)}|${r4(l.y2)}`
    expect(ourV.map((l) => key(l.x1, l)).sort()).toEqual(venV.map((l) => key(toOurs.get(l.x1), l)).sort())
    for (const l of ourV) {
      expect(l.extend).toBe('both')
      // each sits on the first trading day of its week
      const [y, m, dd] = bars[l.x1].t.split('-').map(Number)
      const [py, pm, pd] = bars[l.x1 - 1].t.split('-').map(Number)
      expect(isoWeek({ y, m, d: dd })).not.toBe(isoWeek({ y: py, m: pm, d: pd }))
    }
  })
})

describe('C30 → C49 — the 60-minute chart: the SAME rule, read off the vendor (C30 took its bar 0 for a different one)', () => {
  // `vw-time-tf-spy-60-2026-09-28` (the same probe on 60m). C30 read bar 0 — Tuesday
  // 2026-07-28 10:30, −1.0417 days — as "not the week's first RTH bar, a different
  // rule" and served nothing off a daily chart. It is Monday 2026-07-27 09:30: the
  // open of that week's first session, 25 hours earlier, a bar the 300-bar window
  // does not hold. Every one of the 300 bars follows the calendar rule (C49).
  const H60 = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness/vw-time-tf-spy-60-2026-09-28.json'), 'utf8'))
  const on60 = (src) => runOurSide({ ...H60, source: { ...H60.source, text: src } })
  const pine = (lines) => ['//@version=6', 'indicator("c30-60", overlay=true)', ...lines].join('\n')
  const c = 1 + H60.study.plots.findIndex((p) => p.title === 'T01_timeW_minus_time_DAYS')

  it('bar 0 reads −1.0417 days: Tuesday 10:30 back to MONDAY 09:30, the week\'s first session open', () => {
    expect(H60.plotValues.rows[0][c]).toBeCloseTo(-1.0417, 3)
    const t0 = H60.bars.rows[0][0]
    expect(ny(t0)).toMatchObject({ y: 2026, m: 7, d: 28, wd: 'Tue' })
    const anchor = Math.round(t0 + H60.plotValues.rows[0][c] * 86400)
    expect(ny(anchor)).toMatchObject({ y: 2026, m: 7, d: 27, wd: 'Mon' })
    expect(new Date(anchor * 1000).toISOString()).toBe('2026-07-27T13:30:00.000Z')      // 09:30 New York
  })

  it('⭐ a plot of time("W") on the 60m chart equals TradingView on all 300 bars', () => {
    const ours = on60(pine(['plot(time("W"), "w")']))
    expect(ours.ok, ours.refusal).toBe(true)
    const col = Array.from(ours.plots[0].column)
    expect(col.length).toBe(300)
    expect(col.filter(Number.isNaN).length).toBe(0)
    const vendor = H60.bars.rows.map((r, i) => Math.round(r[0] + H60.plotValues.rows[i][c] * 86400) * 1000)
    expect(col).toEqual(vendor)
  })

  it('a last-bar label reading `na(time("W"))` prints "known"', () => {
    const ours = on60(pine([
      'if barstate.islast',
      '    label.new(bar_index, high, na(time("W")) ? "na" : "known")',
    ]))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.texts.labels).toEqual(['known'])
  })
})

describe('C30 — refused by name, everything the capture does not witness', () => {
  const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
  it('any other period, on a daily chart', () => {
    // `"60"` left this list with C36: the probe asked it (T06) and it is served.
    for (const tf of ['"6M"', '"2W"', '"1Y"', '"240"', '"15"', '"1H"']) {
      const t = S(`plot(time(${tf}))`, { strict: true, basePeriod: 'D' })
      expect(t.ok, tf).toBe(false)
      expect(t.refusal.guard, tf).toBe('pine:function')
      expect(t.refusal.message, tf).toMatch(/`"W"`, `"M"`, `"3M"` and `"12M"` on 5-minute, 15-minute, 60-minute, 1D, 1W and/)
    }
  })
  it('the four periods on a chart timeframe no capture measured, and on a screen', () => {
    // ⭐ C49 — 60 / 5 / 15 / W / M left this list: each has its capture and is served.
    for (const base of ['60', '5', '15', 'W', 'M']) expect(S('plot(time("W"))', { strict: true, basePeriod: base }).ok, base).toBe(true)
    for (const base of ['1', '30']) {
      const t = S('plot(time("W"))', { strict: true, basePeriod: base })
      expect(t.ok, base).toBe(false)
      expect(t.refusal.message, base).toMatch(/measured on 5-minute, 15-minute, 60-minute, 1D, 1W and 1M charts only/)
    }
    const screen = S('plot(time("M"))', {})
    expect(screen.ok).toBe(false)
    expect(screen.refusal.message).toMatch(/only on a chart\s+pane/)
  })
  it('`time_close("3M")` stays refused — measured since (C36), and there is no quarterly bar to read it from', () => {
    // ⚰️ This said `time_close("W")` "stays refused — the probe did not ask it". A new
    // probe asked (`vw-time-close-tf`), and "W" / "M" are served on a daily chart:
    // `vendorHarness.c36TimeFollowups.test.js`.
    expect(S('plot(time_close("W"))', { strict: true, basePeriod: 'D' }).ok).toBe(true)
    const t = S('plot(time_close("3M"))', { strict: true, basePeriod: 'D' })
    expect(t.ok).toBe(false)
    expect(t.refusal.message).toMatch(/resamples only weeks and months/)
  })
  it('the tree is the one C30 wrote, node for node — so a document saved before C49 is recognised and answered the same', () => {
    const t = S('plot(time("W"))', { strict: true })
    expect(t.ok).toBe(true)
    const f = t.outputs[t.selected].formula
    expect(f.startsWith('periodseconds == 86400 ? valuewhenOccurrence('), f).toBe(true)
    expect(f.endsWith(', time, 0) * 1000 : 0 / 0'), f).toBe(true)
  })
})
