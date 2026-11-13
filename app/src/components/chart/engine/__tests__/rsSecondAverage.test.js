// app/src/components/chart/engine/__tests__/rsSecondAverage.test.js
//
// ─── The UCT RS Line's SECOND average (2026-11-13) ──────────────────────────────
//
// Deepvue's DV Relative Strength Line draws MA1 = 21 EMA (on) and MA2 = 50 SMA
// (off by default); Webster's daily method reads the 21 and the 50 on the RS line.
// The slim UCT RS Line gets the second one as PRESENTATION: a switch, a length and
// a type in the Average group, a column derived on the client from the line as
// drawn (`derivedColumns.derivedAverage`, the server's own arithmetic), no server
// input, no fetch key, no `compute.rev` bump. These rails pin, on the REAL slim
// definition through the lane the binder calls (`serverColumnsFor`) and the
// readout reads (`scalarsFor`):
//
//   1. default OFF, and a saved chart is unchanged (same columns, the payload
//      object itself, the same fetch key; a NEW instance is still born without it);
//   2. the values, hand-derived: SMA and EMA, the 50 SMA default, gaps skipped;
//   3. "Scale to rating": k times the raw average, exactly like the first average,
//      and the forming bar's live value is in it;
//   4. the readout: "above its 50 SMA by 18.2%" beside the server's RS line row,
//      only while drawn;
//   5. the look: dotted, violet, no shade, readable (>= 3:1) on every chart canvas;
//   6. the grammar fails closed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { registerDefinitions, resolveInputs, RS_LINE_SLIM_RAW, RS_LINE_V5_RAW } from '../nativeRegistry'
import { validateDefinition } from '../defSchema'
import { primeServerColumns, clearServerColumns, serverColumnsFor, scalarsFor, pickServerInputs } from '../serverCompute'
import { primeBenchmarkTail, _resetBenchmarkTailsForTests, __setBenchmarkTailFetcherForTests } from '../liveTail'
import { derivedAverage, derivedAverageReading } from '../derivedColumns'
import { readoutRows } from '../readoutSchema'
import { planBindings, seriesOptionsForPlot } from '../pool'
import { CHART_THEMES, legendCanvasRgb, legendTextContrast } from '../../chartThemes'
import { CHART_DEFAULTS } from '../../chartDefaults'

const SLIM = (() => {
  const r = registerDefinitions([RS_LINE_SLIM_RAW])
  if (r.errors.length) throw new Error(`the slim rsLine does not register:\n  ${r.errors.join('\n  ')}`)
  return r.defs[0]
})()
const V5 = (() => registerDefinitions([RS_LINE_V5_RAW]).defs[0])()
const REGISTRY = { getDefinition: (id) => (id === 'rsLine' ? SLIM : null), listDefinitions: () => [SLIM] }
const input = (def, key) => def.inputs.find((i) => i.key === key)
const plot = (def, key) => def.plots.find((p) => p.key === key)

const SYM = 'TGTX'
const TF = 'D'
// Seven sessions; the server's average (`rsMa`) is a 3 EMA here so the two can be compared.
const BARS = [
  { t: '2026-11-03', c: 20 }, { t: '2026-11-04', c: 21 }, { t: '2026-11-05', c: 22 },
  { t: '2026-11-06', c: 25 }, { t: '2026-11-07', c: 24 }, { t: '2026-11-10', c: 25 },
  { t: '2026-11-11', c: 30 },
]
const TIMES = [20261103, 20261104, 20261105, 20261106, 20261107, 20261110, 20261111]
const RS = [0.20, 0.21, 0.22, 0.25, 0.24, 0.25, 0.30]
const EMA3 = [null, null, 0.21, 0.23, 0.235, 0.2425, 0.27125]
const RATING = { ibd: 90, m1: 95, m3: 88, m6: 71, m9: 80, m12: 85, asof: '2026-11-11' }
const wire = (over = {}) => ({
  times: TIMES, rev: SLIM.compute.rev,
  columns: { rsLine: RS, rsMa: EMA3, rsAbove: [0, 0, 1, 1, 1, 1, 1], dotNH: [null, null, null, 0.25, null, null, 0.30],
    dotNHbeforePx: TIMES.map(() => null), dotNHred: TIMES.map(() => null), ...(over.columns || {}) },
  payload: { benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500' }, rating: RATING,
    legend: { pctFromMa: 10.6, above: true, index: 6, asOf: '20261111', stale: false, summary: 'above its 3 EMA by 10.6%' },
    ...(over.payload || {}) },
})

const resolved = (inputs) => resolveInputs(SLIM, inputs)
const prime = (inputs = {}, w = wire()) => primeServerColumns(SLIM.id, SYM, TF, pickServerInputs(SLIM, resolved(inputs)), w)
const columns = (inputs, ctx = {}) => serverColumnsFor(SLIM, BARS, resolved(inputs), { sym: SYM, tf: TF, newestBarIsForming: false, ...ctx })
const scalars = (inputs) => scalarsFor(SLIM, resolved(inputs), { sym: SYM, tf: TF })
const list = (col) => Array.from(col).map((v) => (Number.isNaN(v) ? null : v))
const close = (a, b) => {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => (b[i] === null ? expect(v, `[${i}]`).toBe(null) : expect(v, `[${i}]`).toBeCloseTo(b[i], 10)))
}
const ON_SMA3 = { showAverage2: true, maLength2: 3, maType2: 'SMA' }
const ON_EMA3 = { showAverage2: true, maLength2: 3, maType2: 'EMA' }

beforeEach(() => {
  clearServerColumns()
  _resetBenchmarkTailsForTests()
  __setBenchmarkTailFetcherForTests(null)
})
afterEach(() => { __setBenchmarkTailFetcherForTests(null) })

describe('1 · default off, and a saved chart is unchanged', () => {
  it('the switch, length and type: in the Average group, OFF / 50 / SMA, presentation only', () => {
    expect(input(SLIM, 'showAverage2')).toMatchObject({ type: 'bool', default: false, group: 'Average', label: 'Second average' })
    expect(input(SLIM, 'maLength2')).toMatchObject({ type: 'int', default: 50, min: 2, max: 200, group: 'Average',
      activeWhen: { key: 'showAverage2', equals: true } })
    expect(input(SLIM, 'maType2')).toMatchObject({ type: 'enum', default: 'SMA', group: 'Average',
      activeWhen: { key: 'showAverage2', equals: true } })
    expect(input(SLIM, 'maType2').options.map((o) => o[0])).toEqual(['EMA', 'SMA'])
    expect(input(SLIM, 'ma2Color')).toMatchObject({ type: 'color', group: 'Average', activeWhen: { key: 'showAverage2', equals: true } })
    for (const k of ['showAverage2', 'maLength2', 'maType2', 'ma2Color']) {
      expect(SLIM.meta.serverInputs, k).not.toContain(k)
      expect(input(SLIM, k).legacy, `${k} is rendered`).toBeUndefined()
      // and v5 declares it legacy with the same type and default, so a stored value survives a rollback
      expect(input(V5, k)).toMatchObject({ legacy: true, type: input(SLIM, k).type, default: input(SLIM, k).default })
    }
    expect(SLIM.meta.createInputs, 'a NEW instance is still born with the first average only').toEqual({ showAverage: true })
    expect(resolved({})).toMatchObject({ showAverage2: false, maLength2: 50, maType2: 'SMA' })
  })

  it('the fetch key does not move, whatever the second average says', () => {
    const base = pickServerInputs(SLIM, resolved({}))
    expect(pickServerInputs(SLIM, resolved({ showAverage2: true, maLength2: 34, maType2: 'EMA', ma2Color: '#ff0000' }))).toEqual(base)
  })

  it('no key and an explicit off: no rsMa2 column, the same columns, and the payload object itself', () => {
    const w = wire()
    prime({}, w)
    const saved = columns({})
    expect(saved).not.toHaveProperty('rsMa2')
    expect(Object.keys(columns({ showAverage2: false })).sort()).toEqual(Object.keys(saved).sort())
    expect(list(saved.rsLine)).toEqual(RS)
    const s = scalars({})
    expect(s).not.toHaveProperty('average2')
    expect(s).toBe(scalars({ showAverage2: false }))
    expect(s.rating).toEqual(RATING)
    // the plan binds no second-average series while off
    const keysOf = (inputs) => planBindings([{ instanceId: 'rs', defId: 'rsLine', inputs }], REGISTRY, [], {}).bind.map((d) => d.plotKey)
    expect(keysOf({ showAverage: true })).not.toContain('rsMa2')
    expect(keysOf({ showAverage: true, showAverage2: true })).toContain('rsMa2')
  })
})

describe('2 · the values, hand-derived', () => {
  it('SMA 3 over 0.20 0.21 0.22 0.25 0.24 0.25 0.30', () => {
    prime(ON_SMA3)
    // (0.20+0.21+0.22)/3 = 0.21; (0.21+0.22+0.25)/3 = 0.68/3; 0.71/3; 0.74/3; 0.79/3
    close(list(columns(ON_SMA3).rsMa2), [null, null, 0.21, 0.68 / 3, 0.71 / 3, 0.74 / 3, 0.79 / 3])
  })

  it('EMA 3: seed = the SMA of the first 3, then prev x (1 - k) + v x k with k = 0.5, the server\'s own rsMa', () => {
    prime(ON_EMA3)
    const got = columns(ON_EMA3)
    // 0.21; 0.21/2 + 0.25/2 = 0.23; 0.235; 0.2425; 0.27125
    close(list(got.rsMa2), [null, null, 0.21, 0.23, 0.235, 0.2425, 0.27125])
    close(list(got.rsMa2), EMA3)
  })

  it('the 50 SMA default over a 60-bar line 1.00, 1.01, ...: 1 + 0.01 x (i - 24.5) from bar 49', () => {
    const rs = Array.from({ length: 60 }, (_, i) => 1 + 0.01 * i)
    const ma = derivedAverage(rs, 50, 'SMA')
    for (let i = 0; i < 49; i += 1) expect(Number.isNaN(ma[i]), `[${i}] warm-up`).toBe(true)
    for (let i = 49; i < 60; i += 1) expect(ma[i], `[${i}]`).toBeCloseTo(1 + 0.01 * (i - 24.5), 10)
    // fewer valid values than the length: all NaN (the server returns all None)
    expect(list(derivedAverage(RS, 50, 'SMA'))).toEqual(RS.map(() => null))
  })

  it('a gap is skipped, never fed in as zero, and stays a gap', () => {
    close(list(derivedAverage([0.20, NaN, 0.21, 0.22], 2, 'SMA')), [null, null, 0.205, 0.215])
    close(list(derivedAverage([0.20, NaN, 0.22, 0.24], 2, 'EMA')), [null, null, 0.21, 0.21 / 3 + 0.24 * 2 / 3])
    expect(derivedAverage(RS, 3, 'WMA')).toBeNull()
    expect(derivedAverage(RS, 0, 'SMA')).toBeNull()
  })
})

describe('3 · scales with "Scale to rating" exactly like the first average', () => {
  it('k = 90 / 0.30 = 300: the second average is 300 x the raw one, and the 3 EMA equals the scaled server rsMa', () => {
    prime({ ...ON_SMA3, scaleToRating: 'ibd' })
    const scaled = columns({ ...ON_SMA3, scaleToRating: 'ibd' })
    close(list(scaled.rsMa2), [null, null, 63, 68, 71, 74, 79])
    expect(scaled.rsMa2[6]).toBeCloseTo(300 * (0.79 / 3), 10)
    const ema = columns({ ...ON_EMA3, scaleToRating: 'ibd' })
    close(list(ema.rsMa2), list(ema.rsMa))
    close(list(ema.rsMa2), [null, null, 63, 69, 70.5, 72.75, 81.375])
  })

  it('the forming bar\'s live ratio is in it, on the same k as the line', () => {
    prime({ ...ON_SMA3, scaleToRating: 'ibd' })
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-10', c: 100 }, { t: '2026-11-11', c: 80 }])
    // Nov 11 forming: k = 90 / 0.25 = 360, live 30 / 80 = 0.375 -> 135; Nov 7 = 86.4, Nov 10 = 90
    const live = columns({ ...ON_SMA3, scaleToRating: 'ibd' }, { newestBarIsForming: true })
    expect(live.rsLine[6]).toBeCloseTo(135, 10)
    expect(live.rsMa2[6]).toBeCloseTo((86.4 + 90 + 135) / 3, 10)
  })
})

describe('4 · the readout', () => {
  const rowsOf = (inputs) => readoutRows(SLIM, scalars(inputs), { inputs: resolved(inputs) })

  it('"above its 3 SMA by 13.9%" beside the server\'s RS line row; absent while off', () => {
    prime(ON_SMA3)
    expect(rowsOf({}).some((r) => r.key === 'phase2')).toBe(false)
    const rows = rowsOf(ON_SMA3)
    // 0.30 / (0.79 / 3) - 1 = 13.92%
    expect(rows.find((r) => r.key === 'phase2').text).toBe('above its 3 SMA by 13.9%')
    expect(rows.find((r) => r.key === 'phase').text).toBe('above its 3 EMA by 10.6%')
    const keys = rows.map((r) => r.key)
    expect(keys.indexOf('phase2'), 'right after the RS line row\'s own rows').toBeGreaterThan(keys.indexOf('phase'))
    // 0.30 / 0.27125 - 1 = 10.60%
    expect(rowsOf(ON_EMA3).find((r) => r.key === 'phase2').text).toBe('above its 3 EMA by 10.6%')
    // one object per (envelope, inputs): the readout reads it every paint
    expect(scalars(ON_SMA3)).toBe(scalars(ON_SMA3))
    // scaled or not, the reading is a ratio: the same words
    expect(rowsOf({ ...ON_SMA3, scaleToRating: 'ibd' }).find((r) => r.key === 'phase2').text).toBe('above its 3 SMA by 13.9%')
  })

  it('the default 50 SMA, and "at" / "below" / the stale date in the server\'s words', () => {
    const rs = Array.from({ length: 60 }, (_, i) => 1 + 0.01 * i)
    const ma = derivedAverage(rs, 50, 'SMA')
    // 1.59 / 1.345 - 1 = 18.22%
    expect(derivedAverageReading(rs, ma, 50, 'SMA', null).summary).toBe('above its 50 SMA by 18.2%')
    expect(derivedAverageReading([1, 1, 1], derivedAverage([1, 1, 1], 2, 'SMA'), 2, 'SMA').summary).toBe('at its 2 SMA')
    expect(derivedAverageReading([1, 1, 0.9], derivedAverage([1, 1, 0.9], 2, 'EMA'), 2, 'EMA').summary).toBe('below its 2 EMA by 3.6%')
    // the newest bar has no ratio: read at the last one that does, dated by the server's legend
    const stale = [0.2, 0.22, 0.24, NaN]
    expect(derivedAverageReading(stale, derivedAverage(stale, 2, 'SMA'), 2, 'SMA', { index: 2, asOf: '20261104' }).summary)
      .toBe('above its 2 SMA by 4.3% · as of Nov 4')
    // too short for the length: nothing to say
    expect(derivedAverageReading(RS, derivedAverage(RS, 50, 'SMA'), 50, 'SMA', null).summary).toBeNull()
  })
})

describe('5 · the look', () => {
  it('dotted, violet, width 1, no shade, hidden from the pane label like the first; not scaled twice', () => {
    const p = plot(SLIM, 'rsMa2')
    expect(p).toMatchObject({ style: 'line', color: '#9b6fd6', width: 1, lineStyle: 'dotted', role: 'context', legend: { hide: true },
      activeWhen: { key: 'showAverage2', equals: true }, $refs: { color: 'ma2Color' } })
    expect(p.fill).toBeUndefined()
    expect(plot(SLIM, 'rsLine').fill.with, 'the one shade stays the first average\'s').toBe('rsMa')
    expect(seriesOptionsForPlot(p, { scaleId: 'rsLine' })).toMatchObject({ color: '#9b6fd6', lineStyle: 1, lineWidth: 1 })
    expect(SLIM.rescale.plots).not.toContain('rsMa2')
    expect(input(SLIM, 'ma2Color').default).toBe('#9b6fd6')
  })

  it('the violet reads >= 3:1 (WCAG non-text) on every chart canvas, dark and light, gradients both ends', () => {
    const canvases = [['default', CHART_DEFAULTS.background]]
    for (const t of CHART_THEMES) {
      if (t.bgGradient) canvases.push([`${t.id} top`, t.bgGradient.top], [`${t.id} bottom`, t.bgGradient.bottom])
      else canvases.push([t.id, t.bg])
    }
    expect(canvases.length).toBeGreaterThan(40)
    for (const [id, bg] of canvases) {
      const c = legendTextContrast('#9b6fd6', legendCanvasRgb(bg), 1)
      expect(c, `${id} ${bg}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('6 · the grammar fails closed', () => {
  const withMa2 = (patch) => validateDefinition({ ...RS_LINE_SLIM_RAW,
    plots: RS_LINE_SLIM_RAW.plots.map((p) => (p.key === 'rsMa2' ? patch(p) : p)) })
  const errs = (r) => (r.ok ? '' : r.errors.join('\n'))

  it('the shipped declaration validates', () => {
    expect(validateDefinition(RS_LINE_SLIM_RAW).ok).toBe(true)
  })

  it('refuses a markers plot, an unknown kind, an unknown field, a bad source, a bad length or type, and a double scale', () => {
    expect(errs(withMa2((p) => ({ ...p, style: 'markers', marker: { shape: 'circle', position: 'inBar' } })))).toMatch(/derive: a derived average draws as a "line" plot/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, kind: 'wma' } })))).toMatch(/derive\.kind: expected "ma"/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, typo: 1 } })))).toMatch(/derive\.typo: unknown field/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, of: 'nope' } })))).toMatch(/derive\.of: "nope" names no declared plot/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, of: 'rsMa2' } })))).toMatch(/cannot average itself/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, length: 'input:maType2' } })))).toMatch(/derive\.length: "maType2" must be an int input/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, length: 0 } })))).toMatch(/derive\.length: expected a whole number/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, type: 'input:scaleToRating' } })))).toMatch(/derive\.type: every option of "scaleToRating"/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, type: 'WMA' } })))).toMatch(/derive\.type: expected one of/)
    expect(errs(withMa2((p) => ({ ...p, derive: { ...p.derive, activeWhen: { key: 'nope', equals: true } } })))).toMatch(/derive\.activeWhen\.key/)
    const twice = validateDefinition({ ...RS_LINE_SLIM_RAW, rescale: { ...RS_LINE_SLIM_RAW.rescale, plots: [...RS_LINE_SLIM_RAW.rescale.plots, 'rsMa2'] } })
    expect(errs(twice)).toMatch(/may not be in rescale\.plots \(it would be scaled twice\)/)
  })
})
