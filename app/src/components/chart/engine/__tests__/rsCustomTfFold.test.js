// app/src/components/chart/engine/__tests__/rsCustomTfFold.test.js
//
// ─── THE SERVER LANE ON A CUSTOM TIMEFRAME: ASK THE NATIVE BASE, FOLD IT BY THE CHART'S OWN BUCKET RULE (2026-11-26) ──
//
// The lane was asked with the chart's own custom code ('240'); the server read an unknown code as daily ('Unknown => D')
// and answered DAILY rows under '240', whose times match no 4h bar: the UCT RS line had no value on any custom-timeframe
// bar but the forming one. Now `serverAskOf` asks the native base (60m regular; 30m for an extended 60m-based code, one
// grid in both views) and `foldToCustomTf` folds it with `resampleBars.bucketKeyOf`, the rule the candles are built with.
// On the REAL slim definition through the lane the binder calls (`serverColumnsFor`), synthetic values:
//   F1 a 4h REGULAR chart: the RS line has a value on EVERY bar, equal to the base RS at each bucket's last regular base
//      bar (12:30 and 15:30; the extended rows the page carries are not taken, as the candles do not take them)
//   F2 a 4h EXTENDED chart: every bar valued, equal to the base RS at each bucket's last base bar (07:30, 11:30, 15:30,
//      19:30 on the 30m base: the same closes as the extended view's 60m 07:00, 11:00, 15:00, 19:00 bars)
//   F3 the folds per column, read off the definition's own declarations (`customTfFoldsOf`: the lane names no tenant):
//      rsLine last (its ratio live tail), rsMa rebuilt over the folded line (its average live tail's recipe), rsAbove
//      rebuilt (the fill's colour column), and a column with no fold blank on a custom timeframe; a ratio never averaged
//   F4 the ask: tf=60 (regular) / tf=30 (extended), never the custom code
//   F5 native timeframes unchanged: the envelope aligned as it is, no fold
//   F6 the forming cell unchanged: the live tail's close / benchmark close on the chart's own last bar
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { registerDefinitions, resolveInputs, RS_LINE_SLIM_RAW } from '../nativeRegistry'
import {
  primeServerColumns, clearServerColumns, serverColumnsFor, pickServerInputs, serverAskOf, customTfFoldsOf, alignColumns,
} from '../serverCompute'
import { primeBenchmarkTail, _resetBenchmarkTailsForTests, __setBenchmarkTailFetcherForTests } from '../liveTail'
import { derivedAverage } from '../derivedColumns'
import { resampleForSpec } from '../../../../utils/resampleBars'
import { resampleSpec } from '../../timeframes'

const SLIM = (() => {
  const r = registerDefinitions([RS_LINE_SLIM_RAW])
  if (r.errors.length) throw new Error(`the slim rsLine does not register:\n  ${r.errors.join('\n  ')}`)
  return r.defs[0]
})()
const SYM = 'TGTX'
const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18']            // EST: ET = UTC-5
const at = (day, min) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 5 * 3600 + min * 60
const INPUTS = resolveInputs(SLIM, { showAverage: true, maLength: 3, maType: 'EMA' })
const SENT = pickServerInputs(SLIM, INPUTS)

/** A base page: `mins` per day, RS distinct per row; the candles' own base rows (OHLC) beside it. */
function basePage(minsOf) {
  const times = []
  const rows = []
  let k = 0
  for (const d of DAYS) {
    for (const m of minsOf(d)) {
      const t = at(d, m)
      times.push(t)
      const p = 100 + k
      rows.push({ t, o: p, h: p + 1, l: p - 1, c: p + 0.5, v: 10 })
      k += 1
    }
  }
  const rs = times.map((_, i) => 0.2 + i * 0.001)
  return { times, rows, rs }
}
// 60m, the regular view's session grid: clock hours 04:00-09:00, the session 09:30-15:30, clock hours 16:00-19:00
const SESSION60 = () => [240, 300, 360, 420, 480, 540, 570, 630, 690, 750, 810, 870, 930, 960, 1020, 1080, 1140]
// 30m, one grid in both views: 04:00-19:30
const CLOCK30 = () => Array.from({ length: 32 }, (_, i) => 240 + i * 30)

const wire = (page, over = {}) => ({
  times: page.times, rev: SLIM.compute.rev,
  columns: { rsLine: page.rs, rsMa: page.rs.map(() => 0.123), rsAbove: page.rs.map(() => 1), dotNH: page.rs.map(() => 0.5),
    dotNHbeforePx: page.rs.map(() => null), dotNHred: page.rs.map(() => null), ...(over.columns || {}) },
  payload: { benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500' } },
})
const finite = (col) => Array.from(col).every((v) => Number.isFinite(v))
const etMin = (t) => ((t - 5 * 3600) % 86400) / 60

beforeEach(() => { clearServerColumns(); _resetBenchmarkTailsForTests(); __setBenchmarkTailFetcherForTests(null) })
afterEach(() => { __setBenchmarkTailFetcherForTests(null) })

describe('the server lane on a custom timeframe: the native base, folded by the chart\'s own bucket rule', () => {
  it('F1 a 4h regular chart: a value on every bar, the base RS at each bucket\'s last regular bar', () => {
    const page = basePage(SESSION60)
    const bars = resampleForSpec(page.rows, resampleSpec('240'))          // the candles: 09:30 and 13:30 each day
    expect(bars.map((b) => etMin(b.t))).toEqual([570, 810, 570, 810, 570, 810])
    primeServerColumns(SLIM.id, SYM, '60', SENT, wire(page))
    const cols = serverColumnsFor(SLIM, bars, INPUTS, { sym: SYM, tf: '240', extended: false, newestBarIsForming: false })
    expect(finite(cols.rsLine)).toBe(true)
    const rsAt = (day, min) => page.rs[page.times.indexOf(at(day, min))]
    expect(Array.from(cols.rsLine)).toEqual(DAYS.flatMap((d) => [rsAt(d, 750), rsAt(d, 930)]))   // 12:30 and 15:30
  })

  it('F2 a 4h extended chart: a value on every bar, the base RS at each bucket\'s last bar (30m base)', () => {
    const page = basePage(CLOCK30)
    const bars = resampleForSpec(page.rows, resampleSpec('240', { extended: true }))   // 04:00, 08:00, 12:00, 16:00
    expect(bars.map((b) => etMin(b.t)).slice(0, 4)).toEqual([240, 480, 720, 960])
    primeServerColumns(SLIM.id, SYM, '30', SENT, wire(page))
    const cols = serverColumnsFor(SLIM, bars, INPUTS, { sym: SYM, tf: '240', extended: true, newestBarIsForming: false })
    expect(finite(cols.rsLine)).toBe(true)
    const rsAt = (day, min) => page.rs[page.times.indexOf(at(day, min))]
    expect(Array.from(cols.rsLine)).toEqual(DAYS.flatMap((d) => [rsAt(d, 450), rsAt(d, 690), rsAt(d, 930), rsAt(d, 1170)]))
  })

  it('F3 the folds: rsMa and rsAbove rebuilt over the folded line, an undeclared column blank, no ratio averaged', () => {
    // read off the definition's own declarations: the ratio live tail, the average live tail, the fill's colour column
    const folds = customTfFoldsOf(SLIM)
    expect(folds.rsLine).toEqual({ kind: 'last' })
    expect(folds.rsMa).toEqual({ kind: 'ma', of: 'rsLine', length: 'input:maLength', type: 'input:maType' })
    expect(folds.rsAbove).toEqual({ kind: 'above', of: 'rsLine', ma: 'rsMa' })
    expect(Object.keys(folds).sort()).toEqual(['rsAbove', 'rsLine', 'rsMa'])
    const page = basePage(SESSION60)
    const bars = resampleForSpec(page.rows, resampleSpec('240'))
    primeServerColumns(SLIM.id, SYM, '60', SENT, wire(page))
    const cols = serverColumnsFor(SLIM, bars, INPUTS, { sym: SYM, tf: '240', extended: false, newestBarIsForming: false })
    const want = derivedAverage(cols.rsLine, 3, 'EMA')                        // the definition's recipe: 3 EMA here
    Array.from(want).forEach((w, i) => (Number.isFinite(w) ? expect(cols.rsMa[i]).toBeCloseTo(w, 12) : expect(cols.rsMa[i]).toBeNaN()))
    expect(Array.from(cols.rsMa).some((v) => v === 0.123)).toBe(false)       // never the base average carried over
    Array.from(cols.rsLine).forEach((v, i) => {
      const m = cols.rsMa[i]
      if (Number.isFinite(m)) expect(cols.rsAbove[i]).toBe(v >= m ? 1 : 0)
      else expect(cols.rsAbove[i]).toBeNaN()
    })
    expect(Array.from(cols.dotNH).every((v) => Number.isNaN(v))).toBe(true)   // no fold declared: blank
  })

  it('F4 the ask is the native base: tf=60 regular, tf=30 extended, never the custom code', async () => {
    expect(serverAskOf('240', false)).toMatchObject({ tf: '60' })
    expect(serverAskOf('240', true)).toMatchObject({ tf: '30' })
    expect(serverAskOf('120', true)).toMatchObject({ tf: '30' })
    expect(serverAskOf('45', true)).toMatchObject({ tf: '15' })
    expect(serverAskOf('65', false)).toMatchObject({ tf: '5' })
    expect(serverAskOf('2D', false)).toMatchObject({ tf: 'D' })
    const asked = []
    const page = basePage(SESSION60)
    const fetcher = (url) => { asked.push(url); return Promise.resolve(wire(page)) }
    const bars = resampleForSpec(page.rows, resampleSpec('240'))
    serverColumnsFor(SLIM, bars, INPUTS, { sym: SYM, tf: '240', extended: false, fetcher })
    await Promise.resolve(); await Promise.resolve()
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain('tf=60')
    expect(asked[0]).not.toContain('tf=240')
  })

  it('F5 native timeframes are unchanged: the envelope aligned as it is', () => {
    for (const tf of ['60', 'D']) expect(serverAskOf(tf, false)).toEqual({ tf, spec: null })
    const page = basePage(SESSION60)
    primeServerColumns(SLIM.id, SYM, '60', SENT, wire(page))
    const cols = serverColumnsFor(SLIM, page.rows, INPUTS, { sym: SYM, tf: '60', extended: false, newestBarIsForming: false })
    const raw = alignColumns({ times: page.times, columns: { rsLine: Float64Array.from(page.rs) } }, page.rows)
    expect(Array.from(cols.rsLine)).toEqual(Array.from(raw.rsLine))
    expect(Array.from(cols.dotNH).every((v) => v === 0.5)).toBe(true)        // kept on a native chart
  })

  it('F6 the forming cell is unchanged: close / benchmark close on the chart\'s own last bar', () => {
    const page = basePage(SESSION60)
    const bars = resampleForSpec(page.rows, resampleSpec('240'))
    primeServerColumns(SLIM.id, SYM, '60', SENT, wire(page))
    const last = bars[bars.length - 1]
    primeBenchmarkTail('SPY', '240', [{ t: bars[bars.length - 2].t, c: 400 }, { t: last.t, c: 500 }])
    const cols = serverColumnsFor(SLIM, bars, INPUTS, { sym: SYM, tf: '240', extended: false, newestBarIsForming: true })
    expect(cols.rsLine[bars.length - 1]).toBeCloseTo(last.c / 500, 12)
    const page2 = basePage(SESSION60)
    expect(cols.rsLine[bars.length - 2]).toBe(page2.rs[page2.times.indexOf(at(DAYS[2], 750))])   // history: the fold
  })
})
