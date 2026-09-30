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
// ⚠️ THE PROBE ITSELF STAYS REFUSED AT THE DOOR: T05 (`time(timeframe.period)`), T06
// (`time("60")`) and T16 (`input.time`) refuse by their own rules, which refuses the
// whole script. The replay grades a DERIVED capture — those three rows cut from the
// source, their columns dropped, re-sealed — only after the PARENT capture's own
// receipt and source sha verify. Every number compared is the vendor's.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { validateCapture, sealCapture, sha256Hex } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { translatePine } from '../../ast/pine.js'

const REPO = path.resolve(process.cwd(), '..')
const FILE = path.join(REPO, 'tests/fixtures/vendor/harness/vw-time-tf-spy-1d-2026-09-28.json')
const CAPTURE = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const OUT_OF_SCOPE = ['T05_timeSelf_minus_time_MUST_BE_0', 'T06_time60_minus_time_DAYS', 'T16_input_time_default_DAYS']

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
    expect(verdict.reason).toMatch(/member door refused \(pine:function\)/)
    // the refusal is time(timeframe.period) / time("60"), never one of the four served periods
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
    it(`${title}: 0 wrong values; exactly the first partial period withheld`, () => {
      const p = byTitle.get(title)
      expect(p, title).toBeTruthy()
      const first = firstPeriodBars(key)
      expect(p.stats.valueMismatches).toBe(0)
      expect(p.stats.naMismatches).toBe(first)
      expect(p.stats.matching).toBe(900 - first)
      // every na mismatch is OURS withheld against a vendor value — never the reverse
      expect(p.stats.firstDivergence).toMatchObject({ bar: 0, kind: 'na', ours: null })
    })
  }

  for (const [title, key] of Object.entries(CHANGES)) {
    it(`${title}: the new-period event agrees on every bar but the withheld ones (first period + its boundary)`, () => {
      const p = byTitle.get(title)
      const first = firstPeriodBars(key)
      expect(p.stats.valueMismatches).toBe(0)
      expect(p.stats.naMismatches).toBe(first + 1)
      expect(p.stats.matching).toBe(900 - first - 1)
    })
  }

  it('the counts above are not vacuous: 1 / 3 / 26 / 214 first-period bars', () => {
    expect(Object.values(PERIODS).map(firstPeriodBars)).toEqual([1, 3, 26, 214])
  })
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

  it('⛔ a label on the FIRST bar (inside the partial week) is withheld, never drawn off an `na`', () => {
    const ours = on(pine([
      'd = na(time("W")) ? -99999 : (time("W") - time) / 86400000',
      'if barstate.isfirst',
      '    label.new(bar_index, high, str.tostring(d))',
    ]))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.texts.labels).not.toContain('-99999')
    expect(ours.objects.counts.labels).toBe(0)
  })

  it('CONTROL: the same first-bar label over a known clock IS drawn — the withholding is the anchor\'s', () => {
    const ours = on(pine([
      'if barstate.isfirst',
      '    label.new(bar_index, high, str.tostring(dayofweek))',
    ]))
    expect(ours.objects.counts.labels).toBe(1)
  })
})

describe('C30 — an intraday chart: the vendor answers a DIFFERENT rule there, so nothing is drawn', () => {
  // `vw-time-tf-spy-60-2026-09-28` (the same probe on 60m): the Tuesday 09:30 bar
  // reads −1.0417 days for time("W") — not the week's first RTH bar. Unmeasured as
  // a rule, so the member door (which translates once, for every chart) must draw
  // nothing there: every plot bar withheld, every object reading it withheld.
  const H60 = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness/vw-time-tf-spy-60-2026-09-28.json'), 'utf8'))
  const on60 = (src) => runOurSide({ ...H60, source: { ...H60.source, text: src } })
  const pine = (lines) => ['//@version=6', 'indicator("c30-60", overlay=true)', ...lines].join('\n')

  it('the vendor\'s 60m reading is not the daily rule (so serving it would be a guess)', () => {
    const c = 1 + H60.study.plots.findIndex((p) => p.title === 'T01_timeW_minus_time_DAYS')
    expect(H60.plotValues.rows[0][c]).toBeCloseTo(-1.0417, 3)
  })

  it('a plot of time("W") on the 60m chart is withheld on every bar', () => {
    const ours = on60(pine(['plot(time("W"), "w")']))
    expect(ours.ok, ours.refusal).toBe(true)
    const col = Array.from(ours.plots[0].column)
    expect(col.length).toBe(300)
    expect(col.every(Number.isNaN)).toBe(true)
  })

  it('⛔ a last-bar label reading `na(time("W"))` is withheld, never printed off the gate\'s NaN', () => {
    const ours = on60(pine([
      'if barstate.islast',
      '    label.new(bar_index, high, na(time("W")) ? "na" : "known")',
    ]))
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.counts.labels).toBe(0)
  })
})

describe('C30 — refused by name, everything the capture does not witness', () => {
  const S = (body, opts) => translatePine(`//@version=6\nindicator("t")\n${body}\n`, opts)
  it('any other period, on a daily chart', () => {
    for (const tf of ['"6M"', '"2W"', '"1Y"', '"60"', '"240"']) {
      const t = S(`plot(time(${tf}))`, { strict: true, basePeriod: 'D' })
      expect(t.ok, tf).toBe(false)
      expect(t.refusal.guard, tf).toBe('pine:function')
      expect(t.refusal.message, tf).toMatch(/`"W"`, `"M"`, `"3M"` and `"12M"` on a daily chart/)
    }
  })
  it('the four periods on an intraday or weekly chart, and on a screen', () => {
    for (const base of ['60', '5', 'W', 'M']) {
      const t = S('plot(time("W"))', { strict: true, basePeriod: base })
      expect(t.ok, base).toBe(false)
      expect(t.refusal.message, base).toMatch(/measured on a DAILY chart only/)
    }
    const screen = S('plot(time("M"))', {})
    expect(screen.ok).toBe(false)
    expect(screen.refusal.message).toMatch(/only on a chart\s+pane/)
  })
  it('`time_close("W")` stays refused — the probe did not ask it', () => {
    const t = S('plot(time_close("W"))', { strict: true, basePeriod: 'D' })
    expect(t.ok).toBe(false)
    expect(t.refusal.message).toMatch(/only "D"/)
  })
  it('a daily-translated tree drawn on a non-daily chart reads nothing (the member door translates once)', () => {
    const t = S('plot(time("W"))', { strict: true })
    expect(t.ok).toBe(true)
    const f = t.outputs[t.selected].formula
    expect(f.startsWith('periodseconds == 86400 ? valuewhenOccurrence('), f).toBe(true)
    expect(f.endsWith(', time, 0) * 1000 : 0 / 0'), f).toBe(true)
  })
})
