// app/src/components/chart/engine/__tests__/rsVsEmaDef.test.js
//
// ─── UCT RS vs 21 EMA (`rsVsEma`), unit U6 of the RS split (2026-11-09) ──────
//
// Against the REGISTERED definition (never a copy). What this file pins:
//
//   1. the identity: version 1, `compute {server, rsVsEma, rev 1}`, on the
//      server lane, schema-valid, `meta.requiresServer`, an own pane with the
//      U3 floor and a hidden axis;
//   2. the server inputs are the row's two (the benchmark pair), nothing else;
//   3. every scalar path it reads is in the U4 contract;
//   4. hidden from every offer surface until the live server lists the id;
//   5. the plots: the percent-from-21-EMA histogram blue at or above zero and
//      red below (`colorMode: 'sign'`), the 3 EMA solid and the 13 EMA dashed
//      in the neutral, zero the one guide; the readout prints the RS line's
//      own sentence;
//   6. a placed instance drawn through the real binder on the shared golden
//      fixture (`rs_vs_ema_spy.json`), and fail-closed on a no-benchmark envelope.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDefinition, SERVER_DEFS, computeFor, resolveInputs } from '../nativeRegistry'
import * as engineRegistry from '../nativeRegistry'
import { validateDefinition } from '../defSchema'
import {
  isDefinitionOffered, primeServerDefinitions, clearServerDefinitions, pickServerInputs, clearServerColumns, scalarsFor,
} from '../serverCompute'
import { readoutRows, readoutChipRows } from '../readoutSchema'
import { readoutFallbackValue } from '../readout'
import { validateInstance } from '../instances'
import { libraryRows } from '../../discoveryCatalog'
import { IND_TOKENS } from '../../designTokens'
import {
  RS_SPLIT_CONTRACT, loadCase, scalarPathsOf, labelsOf, wireFrom, primeEnvelope, placed, bindOnce, seriesWithData, CTX,
} from './rsSplitTestKit'

const DEF = getDefinition('rsVsEma')
const RS = getDefinition('rsLine')
const CONTRACT = RS_SPLIT_CONTRACT.rsVsEma

const CASE = loadCase('rs_vs_ema_spy')
const BARS = CASE.bars
const last = (col) => [...col].reverse().find((v) => v !== null)
/** The envelope `rs_vs_ema_envelope` sends: the RS line's own legend (`_rs_legend`)
 *  plus `fast` / `slow` at the newest ratio bar. */
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: null, note: null, bars: CASE.benchmarkBars.length },
  legend: { pctFromMa: 6.8123, above: true, maSlope: 1, index: BARS.length - 1, lastValue: 0.2477, asOf: BARS.at(-1).t, stale: false,
    summary: 'above its 21 EMA by 6.8%', fast: 5.91, slow: 3.2 },
  history: { bars: BARS.length, requested: 852, short: true },
  inputs: { benchmark: 'SPY', customBenchmark: '', maLength: 21, maType: 'EMA' },
  intraday: false, state: 'ok',
})
const NO_BENCH = Object.freeze({
  benchmark: { requested: 'CUSTOM', resolved: 'ZZZQ', label: 'ZZZQ', fallback: null, note: 'No ZZZQ bars yet; loading', bars: 0 },
  legend: { pctFromMa: null, above: null, maSlope: null, index: null, lastValue: null, asOf: null, stale: null,
    summary: 'no benchmark bars', fast: null, slow: null },
  history: { bars: BARS.length, requested: 852, short: false },
  inputs: { benchmark: 'CUSTOM', customBenchmark: 'ZZZQ', maLength: 21, maType: 'EMA' },
  intraday: false, state: 'no-benchmark-bars',
})
const wire = () => wireFrom(BARS, { dist: CASE.expected.dist, fast: CASE.expected.fast, slow: CASE.expected.slow }, PAYLOAD)
const blankWire = () => wireFrom(BARS, { dist: BARS.map(() => null), fast: BARS.map(() => null), slow: BARS.map(() => null) }, NO_BENCH)

beforeEach(() => { clearServerDefinitions(); clearServerColumns() })
afterEach(() => { clearServerDefinitions(); clearServerColumns() })

describe('1 · the identity', () => {
  it('is version 1 on the server lane, registered last, and validates', () => {
    expect(DEF).toMatchObject({ id: 'rsVsEma', version: 1, compute: { kind: 'server', fn: 'rsVsEma', rev: 1 } })
    expect(validateDefinition(DEF).ok).toBe(true)
    expect(SERVER_DEFS.at(-1).id).toBe('rsVsEma')
    expect(DEF.meta).toMatchObject({ name: 'UCT RS vs 21 EMA', shortName: 'UCT RS vs 21 EMA', category: RS.meta.category,
      tier: 'premium', repaint: 'non-repainting', requiresServer: true, quickMenu: false, legendParams: ['benchmark'] })
    expect(DEF.meta.timeframes, 'every timeframe').toBeUndefined()
    expect(DEF.meta.description.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, 'one sentence').toBe(1)
    expect(DEF.meta.presets).toBeUndefined()
    expect(DEF.meta.searchHint).toBeUndefined()
    expect(DEF.meta.learn.map((l) => l.key)).toEqual(['phase', 'rsLine'])
    expect(DEF.placement).toEqual({ target: 'pane', pane: { height: 0.20, minPx: 64 }, axis: 'hidden' })
  })

  it('every member-facing label is at most 18 characters', () => {
    for (const [kind, key, label] of labelsOf(DEF)) expect(label.length, `${kind} ${key}: "${label}"`).toBeLessThanOrEqual(18)
  })
})

describe('2 · the server inputs', () => {
  it('names the row\'s benchmark pair and nothing else: the 21 is fixed, no length input', () => {
    expect(DEF.meta.serverInputs).toEqual(CONTRACT.inputs)
    expect(DEF.meta.serverInputs).toEqual(['benchmark', 'customBenchmark'])
    expect(DEF.inputs.map((i) => i.key)).toEqual(['benchmark', 'customBenchmark'])
    // (the box upper-cases what is typed, `case: 'upper'`; a stored value is sent as stored)
    expect(pickServerInputs(DEF, resolveInputs(DEF, { benchmark: 'CUSTOM', customBenchmark: 'SMH', maLength: 50 })))
      .toEqual({ benchmark: 'CUSTOM', customBenchmark: 'SMH' })
    const rs = Object.fromEntries(RS.inputs.map((i) => [i.key, i]))
    const byKey = Object.fromEntries(DEF.inputs.map((i) => [i.key, i]))
    expect(byKey.benchmark.options).toEqual(rs.benchmark.options)
    expect(byKey.customBenchmark).toMatchObject({ requiresServer: true, identityFor: 'benchmark', pattern: rs.customBenchmark.pattern })
  })
})

describe('3 · the scalar paths', () => {
  it('reads only paths the U4 contract proves present', () => {
    const paths = scalarPathsOf(DEF)
    expect(paths.length).toBeGreaterThan(6)
    for (const p of paths) expect(CONTRACT.paths, p).toContain(p)
  })
})

describe('4 · the definition gate', () => {
  it('is not offered until the live server lists its id — then it is', () => {
    expect(isDefinitionOffered(DEF)).toBe(false)
    const offered = () => libraryRows(engineRegistry).filter((r) => r.kind === 'technical').map((r) => r.id)
    expect(offered()).not.toContain('rsVsEma')
    primeServerDefinitions({ schemaVersion: 1, definitions: [{ schemaVersion: 1, id: 'rsVsEma', version: 1,
      compute: { kind: 'server', fn: 'rsVsEma', rev: 1 }, inputs: [{ key: 'benchmark' }, { key: 'customBenchmark' }], columns: ['dist', 'fast', 'slow'] }] })
    expect(isDefinitionOffered(DEF)).toBe(true)
    expect(offered()).toContain('rsVsEma')
  })

  it('a placed instance validates (F20 never drops it) whatever the server says', () => {
    const v = validateInstance(placed(DEF, { benchmark: 'RSP' }), engineRegistry)
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
  })
})

describe('5 · the plots and the readout', () => {
  const plot = (k) => DEF.plots.find((p) => p.key === k)

  it('the histogram is signed blue/red, the 3 EMA solid and the 13 EMA dashed in the neutral, zero the guide', () => {
    expect(plot('dist')).toMatchObject({ style: 'histogram', colorMode: 'sign', colorUp: IND_TOKENS.classic.info,
      colorDown: IND_TOKENS.classic.bear, precision: 2, role: 'primary', legend: { decimals: 2 } })
    expect(plot('fast')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.neutral, width: 1, precision: 2, legend: { hide: true } })
    expect(plot('fast').lineStyle).toBeUndefined()
    expect(plot('slow')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.neutral, width: 1, lineStyle: 'largeDashed', precision: 2, legend: { hide: true } })
    expect(plot('zero')).toMatchObject({ style: 'hlines', levels: [0], color: IND_TOKENS.classic.neutral, width: 1, lineStyle: 'solid' })
    expect(DEF.plots.map((p) => p.key)).toEqual(['dist', 'fast', 'slow', 'zero'])
    // no gold, no green anywhere on this pane
    for (const p of DEF.plots) {
      for (const c of [p.color, p.colorUp, p.colorDown]) {
        if (typeof c === 'string') expect([IND_TOKENS.classic.premium, IND_TOKENS.classic.bull], p.key).not.toContain(c)
      }
    }
  })

  it('the readout: the Benchmark card, the RS line\'s own sentence as the glance row, the three percents, the benchmark on the label', () => {
    const rows = readoutRows(DEF, PAYLOAD, { inputs: resolveInputs(DEF, {}) })
    const glance = rows.filter((r) => !r.detailOf)
    expect(glance.map((r) => r.key)).toEqual(['benchmarkName', 'phase', 'history'])
    expect(glance[1]).toMatchObject({ label: 'RS vs 21 EMA', text: 'above its 21 EMA by 6.8%', muted: false })
    expect(rows.filter((r) => r.detailOf === 'phase').map((r) => [r.label, r.text])).toEqual([
      ['From 21 EMA', '+6.8%'], ['Fast (3 EMA)', '+5.9%'], ['Slow (13 EMA)', '+3.2%'],
    ])
    expect(readoutChipRows(DEF, rows).map((r) => [r.key, r.text])).toEqual([['benchmark', 'SPY']])
    // the same lesson the RS line's own phase row opens (Manrav on the 21 EMA)
    expect(DEF.readout.find((r) => r.key === 'phase').card.learn).toBe('phase')
    expect(RS.readout.find((r) => r.key === 'phase').card.learn).toBe('phase')
    const card = DEF.readout.find((r) => r.key === 'phase').card
    expect(card.evidence).toMatch(/No published hit rate exists/)
    for (const s of [DEF.meta.description, card.what, card.origin]) expect(s).not.toMatch(/\b(buy|sell|RSI)\b/i)
  })

  it('⛔ fail-closed: a no-benchmark envelope prints the reason, the benchmark note, and no number', () => {
    const rows = readoutRows(DEF, NO_BENCH, { inputs: resolveInputs(DEF, { benchmark: 'CUSTOM', customBenchmark: 'ZZZQ' }) })
    expect(rows.find((r) => r.key === 'phase')).toMatchObject({ text: 'no benchmark bars' })
    expect(rows.find((r) => r.key === 'fromMa')).toBeUndefined()
    expect(rows.find((r) => r.key === 'benchmarkName').note).toBe('No ZZZQ bars yet; loading')
    expect(readoutFallbackValue(DEF, NO_BENCH, 2, {}).text).toBe('no benchmark bars')
  })
})

describe('6 · a placed instance through the real binder, on the shared golden fixture', () => {
  it('the fixture is the two-series shape with the three wire columns null-padded, the histogram crossing zero', () => {
    expect(CASE.kind).toBe('rs_vs_ema')
    expect(CASE.params).toEqual({ ema: 21, fast: 3, slow: 13 })
    for (const key of CONTRACT.columns) expect(CASE.expected[key].length, key).toBe(BARS.length)
    expect(CASE.expected.dist.slice(0, 20).every((v) => v === null) && CASE.expected.dist[20] !== null).toBe(true)
    expect(CASE.expected.dist.some((v) => v > 0) && CASE.expected.dist.some((v) => v < 0)).toBe(true)
  })

  it('draws the histogram and the two averages from the landed envelope', () => {
    primeEnvelope(DEF, wire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.keys(cols).sort()).toEqual(['dist', 'fast', 'slow'])
    expect(cols.dist.at(-1)).toBe(last(CASE.expected.dist))
    expect(cols.fast.slice(0, 22).every(Number.isNaN) && Number.isFinite(cols.fast[22])).toBe(true)
    expect(scalarsFor(DEF, resolveInputs(DEF, {}), CTX)).toEqual(PAYLOAD)

    const { fake } = bindOnce([placed(DEF)], BARS)
    const drawn = seriesWithData(fake)
    expect(drawn.map((s) => s.__ctor.__type).sort()).toEqual(['HistogramSeries', 'LineSeries', 'LineSeries'])
    expect(drawn.every((s) => s.__hasValue)).toBe(true)
    expect(fake.calls.filter((c) => c.method === 'createPriceLine').map((c) => c.args[0].price)).toEqual([0])
    expect(fake.calls.filter((c) => c.method === 'attachPrimitive'), 'no paint on this pane').toEqual([])
  })

  it('⛔ fail-closed: a no-benchmark envelope binds series with NO value and no guess', () => {
    primeEnvelope(DEF, blankWire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.values(cols).every((col) => col.every(Number.isNaN))).toBe(true)
    const { fake } = bindOnce([placed(DEF)], BARS)
    expect(fake.seriesCreated.some((s) => s.__hasValue)).toBe(false)
  })
})
