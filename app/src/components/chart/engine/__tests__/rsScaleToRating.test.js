// app/src/components/chart/engine/__tests__/rsScaleToRating.test.js
//
// ─── "Scale to rating" on the UCT RS Line (owner request, 2026-11-12) ──────────
//
// Deepvue's "Rating Period": the RS line multiplied by ONE number so it reads like
// the stock's rating for that period. These rails pin, on the REAL slim definition
// through the lane the binder calls (`serverColumnsFor`) and the readout reads
// (`scalarsFor`):
//
//   1. the declaration: a presentation enum defaulting to Off, never sent to the
//      server, its own pane with a visible axis while on (`placement.axisWhen`);
//   2. the math, hand-derived (a TGTX-like line): k = rating / (line on the
//      rating's date); the point on that date IS the rating; every ratio between
//      two points is unchanged; the average and the three dot columns get the same
//      k; the 0/1 condition column does not;
//   3. the anchor is the rating's date, not the last bar, and the period picks its
//      own field (6M reads `rating.m6`);
//   4. the live forming bar is raw close / benchClose times the SAME k;
//   5. fail closed: Off, no rating, intraday, no line value on the date → the raw
//      columns BY IDENTITY and a Scale row that says why;
//   6. a saved chart (no key) is byte-identical: same columns, same scalars object.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerDefinitions, resolveInputs, RS_LINE_SLIM_RAW,
} from '../nativeRegistry'
import { validateDefinition } from '../defSchema'
import {
  primeServerColumns, clearServerColumns, serverColumnsFor, scalarsFor, pickServerInputs, barTimeKey,
} from '../serverCompute'
import { primeBenchmarkTail, _resetBenchmarkTailsForTests, __setBenchmarkTailFetcherForTests } from '../liveTail'
import { rescaleFactor, withRescale, shortSessionDate, rescalePriceFormat } from '../rescale'
import { readoutRows } from '../readoutSchema'
import { axisHiddenOf, resolvePlacement } from '../placement'

const SLIM = (() => {
  const r = registerDefinitions([RS_LINE_SLIM_RAW])
  if (r.errors.length) throw new Error(`the slim rsLine does not register:\n  ${r.errors.join('\n  ')}`)
  return r.defs[0]
})()

const SYM = 'TGTX'
const TF = 'D'

// Seven sessions. The RS line climbs from 0.20 to 0.30; the nightly rating is
// dated the last session (2026-11-11): RS Rating 90, 6M rank 71.
const BARS = [
  { t: '2026-11-03', c: 20 }, { t: '2026-11-04', c: 21 }, { t: '2026-11-05', c: 22 },
  { t: '2026-11-06', c: 25 }, { t: '2026-11-07', c: 24 }, { t: '2026-11-10', c: 25 },
  { t: '2026-11-11', c: 30 },
]
const TIMES = [20261103, 20261104, 20261105, 20261106, 20261107, 20261110, 20261111]
const RS = [0.20, 0.21, 0.22, 0.25, 0.24, 0.25, 0.30]
const MA = [null, null, 0.21, 0.23, 0.235, 0.2425, 0.27125]
const ABOVE = [0, 0, 1, 1, 1, 1, 1]
const DOT = [null, null, null, 0.25, null, null, 0.30]
const GOLD = [null, null, null, null, null, null, 0.30]
const RATING = { ibd: 90, m1: 95, m3: 88, m6: 71, m9: 80, m12: 85, asof: '2026-11-11' }
const wire = (rating = RATING) => ({
  times: TIMES, rev: SLIM.compute.rev,
  columns: { rsLine: RS, rsMa: MA, rsAbove: ABOVE, dotNH: DOT, dotNHbeforePx: GOLD, dotNHred: TIMES.map(() => null) },
  payload: { benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500' }, rating },
})

const resolved = (inputs) => resolveInputs(SLIM, inputs)
const prime = (inputs, w = wire(), tf = TF) => primeServerColumns(SLIM.id, SYM, tf, pickServerInputs(SLIM, resolved(inputs)), w)
const columns = (inputs, ctx = {}) => serverColumnsFor(SLIM, BARS, resolved(inputs), { sym: SYM, tf: TF, newestBarIsForming: false, ...ctx })
const scalars = (inputs, tf = TF) => scalarsFor(SLIM, resolved(inputs), { sym: SYM, tf })
const list = (col) => Array.from(col).map((v) => (Number.isNaN(v) ? null : v))
const close = (a, b) => a.forEach((v, i) => (b[i] === null ? expect(v, `[${i}]`).toBe(null) : expect(v, `[${i}]`).toBeCloseTo(b[i], 10)))

beforeEach(() => {
  clearServerColumns()
  _resetBenchmarkTailsForTests()
  __setBenchmarkTailFetcherForTests(null)
})
afterEach(() => { __setBenchmarkTailFetcherForTests(null) })

describe('1 · the declaration', () => {
  it('a presentation enum: Off by default, the composite rating and the five periods, never a server input', () => {
    const input = SLIM.inputs.find((i) => i.key === 'scaleToRating')
    expect(input.type).toBe('enum')
    expect(input.default).toBe('off')
    expect(input.label).toBe('Scale to rating')
    expect(input.options.map((o) => o[0])).toEqual(['off', 'ibd', 'm1', 'm3', 'm6', 'm9', 'm12'])
    expect(input.tooltip.split('. ').length, 'one sentence').toBe(1)
    expect(SLIM.meta.serverInputs).not.toContain('scaleToRating')
    // so choosing a rating keys no new fetch
    expect(pickServerInputs(SLIM, resolved({ scaleToRating: 'm6' }))).toEqual(pickServerInputs(SLIM, resolved({})))
  })

  it('the grammar fails closed: a server input, a non-off default, a missing period, an unknown field', () => {
    const bad = (patch) => validateDefinition({ ...RS_LINE_SLIM_RAW, ...patch(RS_LINE_SLIM_RAW) })
    expect(bad(() => ({})).ok).toBe(true)
    expect(bad((d) => ({ meta: { ...d.meta, serverInputs: [...d.meta.serverInputs, 'scaleToRating'] } })).errors.join(' ')).toMatch(/server input/)
    expect(bad((d) => ({ inputs: d.inputs.map((i) => (i.key === 'scaleToRating' ? { ...i, default: 'ibd' } : i)) })).errors.join(' ')).toMatch(/must default to "off"/)
    expect(bad((d) => ({ rescale: { ...d.rescale, to: (({ m9: _drop, ...rest }) => rest)(d.rescale.to) } })).errors.join(' ')).toMatch(/option "m9" names no rating/)
    expect(bad((d) => ({ rescale: { ...d.rescale, typo: 1 } })).errors.join(' ')).toMatch(/rescale\.typo: unknown field/)
    expect(bad((d) => ({ rescale: { ...d.rescale, anchor: 'rsAboveX' } })).errors.join(' ')).toMatch(/rescale\.anchor/)
    expect(bad((d) => ({ placement: { ...d.placement, axisWhen: { key: 'nope', equals: 1 } } })).errors.join(' ')).toMatch(/placement\.axisWhen/)
  })

  it('off: under the bars on the invisible scale; on: its own pane with the axis showing', () => {
    const off = { instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs: {} }
    const on = { ...off, inputs: { scaleToRating: 'ibd' } }
    expect(axisHiddenOf(SLIM, off)).toBe(true)
    expect(axisHiddenOf(SLIM, on)).toBe(false)
    expect(axisHiddenOf(SLIM), 'a context-free read keeps the declaration').toBe(true)
    const layout = { panes: [{ key: 'inst:rsLine:1', index: 2 }] }
    const ctx = (target) => ({ targetOf: () => target, paneLayout: layout, priceIndex: 0 })
    expect(resolvePlacement(off, SLIM, ctx('pane')).scaleId).toBe('uct-axis-hidden')
    expect(resolvePlacement(on, SLIM, ctx('pane')).scaleId).toBe('right')
    expect(resolvePlacement(on, SLIM, ctx('pane')).lastValue).not.toBe(false)
  })
})

describe('2 · the math, hand-derived', () => {
  it('RS Rating 90 on a line ending at 0.30: k = 300, the last point is 90, 0.20 reads 60', () => {
    prime({ scaleToRating: 'ibd' })
    const out = columns({ scaleToRating: 'ibd' })
    close(list(out.rsLine), [60, 63, 66, 75, 72, 75, 90])
    expect(list(out.rsLine).at(-1)).toBeCloseTo(RATING.ibd, 10)
  })

  it('the shape is the shape: every ratio between two points is unchanged', () => {
    prime({ scaleToRating: 'ibd' })
    const raw = RS
    const scaled = list(columns({ scaleToRating: 'ibd' }).rsLine)
    for (let i = 1; i < raw.length; i += 1) expect(scaled[i] / scaled[0]).toBeCloseTo(raw[i] / raw[0], 12)
  })

  it('the average and the three dot columns take the same k; the 0/1 condition column does not', () => {
    prime({ scaleToRating: 'ibd' })
    const out = columns({ scaleToRating: 'ibd' })
    close(list(out.rsMa), MA.map((v) => (v === null ? null : v * 300)))
    close(list(out.dotNH), DOT.map((v) => (v === null ? null : v * 300)))
    close(list(out.dotNHbeforePx), [null, null, null, null, null, null, 90])
    expect(list(out.rsAbove)).toEqual(ABOVE)
    // a dot still sits ON the scaled line
    list(out.dotNH).forEach((d, i) => { if (d !== null) expect(d).toBeCloseTo(list(out.rsLine)[i], 10) })
  })

  it('the period picks its own field: 6M reads rating.m6 (71), 12M rating.m12 (85)', () => {
    prime({ scaleToRating: 'm6' })
    expect(list(columns({ scaleToRating: 'm6' }).rsLine).at(-1)).toBeCloseTo(71, 10)
    expect(list(columns({ scaleToRating: 'm12' }).rsLine).at(-1)).toBeCloseTo(85, 10)
    expect(list(columns({ scaleToRating: 'm1' }).rsLine).at(-1)).toBeCloseTo(95, 10)
    expect(scalars({ scaleToRating: 'm6' }).rescale.summary).toBe('Scaled to 6M rank: 71 on Nov 11')
    expect(scalars({ scaleToRating: 'ibd' }).rescale.summary).toBe('Scaled to RS Rating: 90 on Nov 11')
  })

  it('the anchor is the rating\'s DATE: rated on Nov 10 (line 0.25), k = 360 and the Nov 10 point is 90', () => {
    prime({ scaleToRating: 'ibd' }, wire({ ...RATING, asof: '2026-11-10' }))
    const out = list(columns({ scaleToRating: 'ibd' }).rsLine)
    expect(out[5]).toBeCloseTo(90, 10)
    expect(out[6]).toBeCloseTo(0.30 * 360, 10)
  })

  it('a blank line cell on the rating\'s date (benchmark bar not in yet) anchors on the line\'s last value before it', () => {
    const rs = Float64Array.from([...RS.slice(0, 6), NaN])
    const f = rescaleFactor(SLIM, { times: TIMES, columns: { rsLine: rs }, payload: { rating: RATING } },
      resolved({ scaleToRating: 'ibd' }), 'D', barTimeKey)
    expect(f.state).toBe('applied')
    expect(f.k).toBeCloseTo(90 / 0.25, 12)
  })

  it('a rating dated on a non-session day anchors on the newest bar before it (the weekly rule)', () => {
    const f = rescaleFactor(SLIM, { times: TIMES, columns: { rsLine: Float64Array.from(RS) }, payload: { rating: { ibd: 90, asof: '2026-11-09' } } },
      resolved({ scaleToRating: 'ibd' }), 'W', barTimeKey)
    expect(f.state).toBe('applied')
    expect(f.k).toBeCloseTo(90 / 0.24, 12)   // Nov 7's value: the newest bar on or before Nov 9
  })
})

describe('3 · the live forming bar moves with price on the same k', () => {
  it('last = (close / SPY close) x k, where k is read off the server cells, never off the live point', () => {
    prime({ scaleToRating: 'ibd' })
    primeBenchmarkTail('SPY', TF, [{ t: '2026-11-10', c: 100 }, { t: '2026-11-11', c: 80 }])
    // live close 30, SPY 80 → raw 0.375; k stays 90 / 0.30 = 300 → 112.5
    const out = list(columns({ scaleToRating: 'ibd' }, { newestBarIsForming: true }).rsLine)
    expect(out[6]).toBeCloseTo(0.375 * 300, 10)
    close(out.slice(0, 6), [60, 63, 66, 75, 72, 75])
  })
})

describe('4 · fail closed, and say so', () => {
  it('not yet rated: the raw columns by identity and "Not yet rated: showing the RS line unscaled"', () => {
    prime({ scaleToRating: 'ibd' }, wire({ ibd: null, m6: null, asof: null }))
    const raw = columns({})
    const on = columns({ scaleToRating: 'ibd' })
    expect(list(on.rsLine)).toEqual(list(raw.rsLine))
    const s = scalars({ scaleToRating: 'ibd' })
    expect(s.rescale).toEqual({ state: 'unrated', unscaled: true, summary: 'Not yet rated: showing the RS line unscaled' })
  })

  it('intraday: raw, and the row says daily and weekly only', () => {
    prime({ scaleToRating: 'ibd' }, wire(), '5')
    const on = serverColumnsFor(SLIM, BARS.map((b, i) => ({ ...b, t: TIMES[i] })), resolved({ scaleToRating: 'ibd' }),
      { sym: SYM, tf: '5', newestBarIsForming: false })
    expect(list(on.rsLine), 'the raw line, unscaled').toEqual(RS)
    expect(scalars({ scaleToRating: 'ibd' }, '5').rescale.summary).toBe('Daily and weekly charts only: showing the RS line unscaled')
  })

  it('no line value on the rating\'s date: raw, and the row says so', () => {
    prime({ scaleToRating: 'ibd' }, wire({ ...RATING, asof: '2026-10-01' }))
    expect(list(columns({ scaleToRating: 'ibd' }).rsLine)).toEqual(RS)
    expect(scalars({ scaleToRating: 'ibd' }).rescale.state).toBe('noAnchor')
  })

  it('the Scale row prints the state, muted when unscaled, and is absent while off', () => {
    prime({})
    const rowsOf = (inputs) => readoutRows(SLIM, scalars(inputs), { inputs: resolved(inputs) })
    expect(rowsOf({}).some((r) => r.key === 'scale')).toBe(false)
    const on = rowsOf({ scaleToRating: 'ibd' }).find((r) => r.key === 'scale')
    expect(on.text).toBe('Scaled to RS Rating: 90 on Nov 11')
    expect(!!on.muted).toBe(false)
    // one object per (envelope, choice, timeframe): the readout reads it every paint
    expect(scalars({ scaleToRating: 'ibd' })).toBe(scalars({ scaleToRating: 'ibd' }))
  })
})

describe('5 · a saved chart is byte-identical', () => {
  it('no key and an explicit Off: the same columns object and the payload itself', () => {
    const w = wire()
    prime({}, w)
    const saved = columns({})
    expect(columns({ scaleToRating: 'off' })).toEqual(saved)
    expect(list(saved.rsLine)).toEqual(RS)
    const s = scalars({})
    expect(s).toBe(scalars({ scaleToRating: 'off' }))
    expect(s.rescale).toBeUndefined()
    expect(s.rating).toEqual(RATING)
  })

  it('withRescale returns its columns by identity unless the factor is applied', () => {
    const cols = { rsLine: Float64Array.from(RS) }
    for (const f of [null, { state: 'off' }, { state: 'unrated' }, { state: 'applied', k: NaN }]) expect(withRescale(SLIM, cols, f)).toBe(cols)
    const out = withRescale(SLIM, cols, { state: 'applied', k: 2 })
    expect(out).not.toBe(cols)
    expect(list(cols.rsLine), 'the cached column is never mutated').toEqual(RS)
  })

  it('the axis reads two decimals while the scale is APPLIED; unscaled or Off keeps the declared four', () => {
    prime({ scaleToRating: 'ibd' })
    const on = { inputs: { scaleToRating: 'ibd' } }
    const applied = scalars({ scaleToRating: 'ibd' })
    expect(rescalePriceFormat(SLIM, on, 'rsLine', applied)).toEqual({ type: 'price', precision: 2, minMove: 0.01 })
    expect(rescalePriceFormat(SLIM, on, 'rsMa', applied)).toEqual({ type: 'price', precision: 2, minMove: 0.01 })
    expect(rescalePriceFormat(SLIM, on, 'rsAbove', applied)).toBe(null)
    expect(rescalePriceFormat(SLIM, { inputs: {} }, 'rsLine', applied)).toBe(null)
    expect(rescalePriceFormat(SLIM, { inputs: { scaleToRating: 'off' } }, 'rsLine', applied)).toBe(null)
    // intraday (or not yet rated): the raw ratio near 0.47 keeps four decimals
    expect(rescalePriceFormat(SLIM, on, 'rsLine', scalars({ scaleToRating: 'ibd' }, '5'))).toBe(null)
    expect(rescalePriceFormat(SLIM, on, 'rsLine', null)).toBe(null)
  })

  it('the short date is string surgery: 2026-11-11 and 20261111 both read Nov 11', () => {
    expect(shortSessionDate('2026-11-11')).toBe('Nov 11')
    expect(shortSessionDate('20260105')).toBe('Jan 5')
    expect(shortSessionDate('nope')).toBe(null)
  })
})
