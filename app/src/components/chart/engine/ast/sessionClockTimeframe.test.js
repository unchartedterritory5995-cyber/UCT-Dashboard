// ─── THE SESSION CLOCK ON THE CHART'S OWN TIMEFRAME, AT THE MEMBER DOOR ────────
//
// `time(timeframe.period, "0930-1600")` answers, inside the window, the open of
// the chart-period bar on a grid anchored at the session start. The grid's length
// is the CHART's bar length. The member door translates with no chart in hand
// (default base `'D'`) and saves ONE definition that the binder then evaluates on
// whatever timeframe the chart shows, so a length folded into the tree at
// translation was 1,440 minutes on every chart: through the door S04 was wrong on
// 258 of 300 bars of the SPY 60m RTH capture and 95 of 300 of the extended-hours
// one (vendor 0 against ours −3600). `pineVocabularyWave.test.js` never saw it,
// because it translates with `basePeriod: '60'`.
//
// The grid now reads the `periodseconds` clock column, which `computeClock` fills
// from the timeframe the tree is EVALUATED on. Every test below goes through the
// member door (`ourSide.js`, the harness's own door) on the product's bar shape.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { timeframeSeconds } from './pine.js'
import { CLOCK_PERIOD_SECONDS, computeClock } from '../../indicators.js'
import * as registry from '../nativeRegistry'
import {
  enterMemberDoor, runOurSide, toProductBars, tfCodeOf, HARNESS_DEF_ID,
} from '../__tests__/vendorHarness/ourSide.js'

const REPO = path.resolve(process.cwd(), '..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const load = (f) => JSON.parse(fs.readFileSync(path.join(HARNESS, f), 'utf8'))
const RTH = 'vw-time-session-spy-60-rth-2026-09-28.json'
const EXT = 'vw-time-session-spy-60-ext-2026-09-28.json'
const DAILY = 'vw-time-session-spy-1d-2026-09-28.json'

afterEach(() => { registry.uninstallUserDefinition(HARNESS_DEF_ID) })

/** The probe without its S15 row: `"2000-0000"` refuses by name
 *  (`pineVocabularyWave.test.js` holds why), and in strict mode one refused
 *  output refuses the whole script at the door. The other rows are untouched. */
function withoutS15(capture) {
  const text = capture.source.text.split('\n')
    .filter((l) => !l.startsWith('tJ = ') && !l.includes('S15_na')).join('\n')
  return { ...capture, source: { ...capture.source, text } }
}

/** Bars off by `title`, our column against the vendor's, bar for bar. */
function countBad(capture, column, title) {
  const colIx = 1 + capture.study.plots.map((p) => p.title).indexOf(title)
  expect(colIx, `${title} is not in the capture`).toBeGreaterThan(0)
  const byTime = new Map(capture.plotValues.rows.map((r) => [r[0], r[colIx]]))
  let bad = 0
  let first = null
  capture.bars.rows.forEach(([t], i) => {
    if (!byTime.has(t)) return
    const want = byTime.get(t)
    const got = column[i]
    const same = (want === null || want === undefined) ? Number.isNaN(got) : got === want
    if (!same) { bad += 1; if (!first) first = { t, want, got } }
  })
  return { bad, first, n: byTime.size }
}

function colFor(built, cols, title) {
  const out = built.translation.outputs.find((o) => o.title === title)
  const row = (built.rows || []).find((r) => r.ast === out.ast)
  expect(row, `${title} was not carried`).toBeTruthy()
  return cols[row.key]
}

describe('⭐ the bar length is the vendor\'s, and one number per code', () => {
  it('agrees with the translator\'s `timeframe.in_seconds(<code>)` for every code the clock declares', () => {
    const codes = Object.keys(CLOCK_PERIOD_SECONDS)
    expect(codes.sort()).toEqual(['1', '15', '30', '5', '60', 'D', 'M', 'W'])
    for (const code of codes) expect(CLOCK_PERIOD_SECONDS[code], code).toBe(timeframeSeconds(code))
  })

  it('reproduces the vendor\'s own `timeframe.in_seconds` readings (T10–T14)', () => {
    const d = load('vw-time-tf-spy-1d-2026-09-28.json')
    const titles = d.study.plots.map((p) => p.title)
    const read = (title) => d.plotValues.rows[0][1 + titles.indexOf(title)]
    expect(CLOCK_PERIOD_SECONDS['1']).toBe(read('T10_in_seconds_1'))
    expect(CLOCK_PERIOD_SECONDS['60']).toBe(read('T11_in_seconds_60'))
    expect(CLOCK_PERIOD_SECONDS.D).toBe(read('T12_in_seconds_D'))
    expect(CLOCK_PERIOD_SECONDS.W).toBe(read('T13_in_seconds_W'))
    expect(CLOCK_PERIOD_SECONDS.M).toBe(read('T14_in_seconds_M'))
  })

  it('is flat per timeframe, blank for a code nobody ships, and reads no bar', () => {
    const bars = [{ t: 1785249000 }, { t: 1785252600 }]
    expect(Array.from(computeClock(bars, '60').periodseconds)).toEqual([3600, 3600])
    expect(Array.from(computeClock(bars, '5').periodseconds)).toEqual([300, 300])
    for (const tf of [undefined, '3', '1H', '2D', '']) {
      expect(Array.from(computeClock(bars, tf).periodseconds).every(Number.isNaN), String(tf)).toBe(true)
    }
    // ⭐ ABOVE THE UNIT GATE: a weekly series keyed by dates blanks every
    // time-derived column, and its bar length is still known.
    const weekly = computeClock([{ t: '2026-09-21' }], 'W')
    expect(Number.isNaN(weekly.time[0])).toBe(true)
    expect(weekly.periodseconds[0]).toBe(604800)
  })
})

describe('⭐⭐ the member door answers the session clock on the chart\'s own grid', () => {
  for (const [rel, before] of [[RTH, 258], [EXT, 95]]) {
    it(`S03–S11 match every bar of ${rel} (S04 was wrong on ${before})`, () => {
      const cap = withoutS15(load(rel))
      const side = runOurSide(cap)
      expect(side.ok, side.refusal).toBe(true)
      expect(side.ctx.tf).toBe('60')
      for (const title of ['S03_na_0930_1600', 'S04_secs_0930_1600', 'S05_na_0930_1000_OR_window',
        'S06_secs_0930_1000', 'S07_na_1000_1100_EXCLUDES_OPEN', 'S08_secs_1000_1100',
        'S09_na_0930_1000_ALLDAYS', 'S11_na_OR_GMTminus4_CORPUS_FORM']) {
        const plot = side.plots.find((p) => p.title === title)
        expect(plot && plot.column, `${title}: ${plot && plot.missingReason}`).toBeTruthy()
        const r = countBad(cap, plot.column, title)
        expect(r.n).toBe(300)
        expect(r.bad, `${title}: ${r.bad}/${r.n} differ, first ${JSON.stringify(r.first)}`).toBe(0)
      }
      // ⛔ NON-VACUITY: S04 answers in session on at least as many bars as the
      // defect touched (the probe writes −1 for `na`), so "always out of session"
      // could not have matched. That the fold answers these same bars WRONGLY is
      // the control below.
      const s04 = 1 + cap.study.plots.map((p) => p.title).indexOf('S04_secs_0930_1600')
      expect(cap.plotValues.rows.filter((r) => r[s04] !== -1).length).toBeGreaterThanOrEqual(before)
    })
  }

  it('⭐ ONE saved tree is right on daily AND hourly bars — the definition is never re-translated', () => {
    const daily = withoutS15(load(DAILY))
    const hourly = withoutS15(load(RTH))
    expect(daily.source.text).toBe(hourly.source.text)
    const door = enterMemberDoor(daily.source.text)
    expect(door.def, door.refusal).toBeTruthy()
    for (const cap of [daily, hourly]) {
      const cols = registry.computeFor(door.def, toProductBars(cap), undefined,
        { tf: tfCodeOf(cap.timeframe), symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: null })
      const r = countBad(cap, colFor(door.built, cols, 'S04_secs_0930_1600'), 'S04_secs_0930_1600')
      expect(r.bad, `${cap.timeframe}: ${r.bad}/${r.n}, first ${JSON.stringify(r.first)}`).toBe(0)
    }
  })

  it('⛔ CONTROL — the same tree told it is on a DAILY chart reproduces the published defect exactly', () => {
    // The only difference from the test above is the timeframe the binding
    // reports, so the 258 is carried by `periodseconds` and nothing else.
    const cap = withoutS15(load(RTH))
    const door = enterMemberDoor(cap.source.text)
    const cols = registry.computeFor(door.def, toProductBars(cap), undefined,
      { tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: null })
    const r = countBad(cap, colFor(door.built, cols, 'S04_secs_0930_1600'), 'S04_secs_0930_1600')
    expect(r.bad).toBe(258)
    expect(r.first).toEqual({ t: cap.bars.rows[0][0], want: 0, got: -3600 })
  })
})

describe('⛔ a LITERAL period answers only on a chart of that length', () => {
  const SRC = '//@version=6\nindicator("literal period")\n'
    + 'plot(na(time("D", "0930-1600")) ? 0 : 1, "literal_D")\n'
    + 'plot(na(time(timeframe.period, "0930-1600")) ? 0 : 1, "own")\n'

  const run = (cap) => {
    const door = enterMemberDoor(SRC)
    expect(door.def, door.refusal).toBeTruthy()
    const cols = registry.computeFor(door.def, toProductBars(cap), undefined,
      { tf: tfCodeOf(cap.timeframe), symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: null })
    return { lit: Array.from(colFor(door.built, cols, 'literal_D')), own: Array.from(colFor(door.built, cols, 'own')) }
  }

  it('on daily bars `time("D", …)` is the chart\'s own clock', () => {
    const { lit, own } = run(load(DAILY))
    expect(lit).toEqual(own)
    expect(lit.every((v) => v === 1)).toBe(true)
  })

  it('on hourly bars `time("D", …)` is `na` — a daily question on bars that are not daily', () => {
    const { lit, own } = run(load(RTH))
    expect(lit.every((v) => v === 0)).toBe(true)
    // the control: the chart's-own form is in session on hourly bars, so the
    // literal's `na` is the gate, not a blank clock
    expect(own.filter((v) => v === 1).length).toBeGreaterThan(200)
  })
})
