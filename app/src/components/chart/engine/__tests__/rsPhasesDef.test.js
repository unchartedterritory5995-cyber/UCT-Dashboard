// app/src/components/chart/engine/__tests__/rsPhasesDef.test.js
//
// ─── UCT RS Phases (`rsPhases`), unit U6 of the RS split (2026-11-09) ────────
//
// Against the REGISTERED definition (never a copy). What this file pins:
//
//   1. the identity: version 1, `compute {server, rsPhases, rev 1}`, on the
//      server lane, schema-valid, `meta.requiresServer`, an own pane with the
//      U3 floor and a hidden axis (a z-score's level is read in the label);
//   2. the server inputs are the row's four, in order, and nothing else is sent;
//   3. every scalar path it reads is in the U4 contract;
//   4. hidden from every offer surface until the live server lists the id;
//   5. the plots and the paint: the hidden `phase` column drives a `bgcolor`
//      paint (red for 0, the info blue for 1, nothing for null), the
//      divergence is a neutral histogram, zero is the one guide; the readout;
//   6. a placed instance drawn through the real binder on the shared golden
//      fixture (`rs_phases_spy.json`, the Python lane's own output), and
//      fail-closed on a same-symbol envelope.
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

const DEF = getDefinition('rsPhases')
const RS = getDefinition('rsLine')
const CONTRACT = RS_SPLIT_CONTRACT.rsPhases

const CASE = loadCase('rs_phases_spy')
const BARS = CASE.bars
const last = (col) => [...col].reverse().find((v) => v !== null)
/** The envelope `rs_phases_envelope` sends at the fixture's newest bar. */
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: null, note: null, bars: CASE.benchmarkBars.length },
  legend: { phase: 1, phaseLabel: 'RS up while the market is down', divergence: 1.23, rsTrend: 0.0123, benchTrend: -0.0081,
    asOf: BARS.at(-1).t, stale: false, summary: 'RS up while the market is down · divergence +1.2' },
  history: { bars: BARS.length, requested: 852, short: true },
  inputs: { benchmark: 'SPY', customBenchmark: '', shortEma: 3, longEma: 10 },
  intraday: false, state: 'ok',
})
const SAME_SYMBOL = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: null, note: null, bars: 0 },
  legend: { phase: null, phaseLabel: null, divergence: null, rsTrend: null, benchTrend: null, asOf: null, stale: null,
    summary: 'benchmark is the symbol' },
  history: { bars: BARS.length, requested: 852, short: false },
  inputs: { benchmark: 'SPY', customBenchmark: '', shortEma: 3, longEma: 10 },
  intraday: false, state: 'same-symbol',
})
const wire = () => wireFrom(BARS, { phase: CASE.expected.phase, divergence: CASE.expected.divergence }, PAYLOAD)
const blankWire = () => wireFrom(BARS, { phase: BARS.map(() => null), divergence: BARS.map(() => null) }, SAME_SYMBOL)

beforeEach(() => { clearServerDefinitions(); clearServerColumns() })
afterEach(() => { clearServerDefinitions(); clearServerColumns() })

describe('1 · the identity', () => {
  it('is version 1 on the server lane, registered after rsRating, and validates', () => {
    expect(DEF).toMatchObject({ id: 'rsPhases', version: 1, compute: { kind: 'server', fn: 'rsPhases', rev: 1 } })
    expect(validateDefinition(DEF).ok).toBe(true)
    expect(SERVER_DEFS.map((d) => d.id).indexOf('rsPhases')).toBe(2)
    expect(DEF.meta).toMatchObject({ name: 'UCT RS Phases', shortName: 'UCT RS Phases', category: RS.meta.category,
      tier: 'premium', repaint: 'non-repainting', requiresServer: true, quickMenu: false, legendParams: ['benchmark'] })
    expect(DEF.meta.timeframes, 'every timeframe: the ratio exists intraday').toBeUndefined()
    expect(DEF.meta.description.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, 'one sentence').toBe(1)
    expect(DEF.meta.presets).toBeUndefined()
    expect(DEF.meta.searchHint).toBeUndefined()
    expect(DEF.meta.learn.map((l) => l.key)).toEqual(['rsLine'])
    expect(DEF.placement).toEqual({ target: 'pane', pane: { height: 0.20, minPx: 64 }, axis: 'hidden' })
  })

  it('every member-facing label is at most 18 characters, and the two lengths carry their long form in the tooltip', () => {
    for (const [kind, key, label] of labelsOf(DEF)) expect(label.length, `${kind} ${key}: "${label}"`).toBeLessThanOrEqual(18)
    expect(DEF.inputs.find((i) => i.key === 'shortEma').tooltip).toMatch(/^Short average in bars/)
    expect(DEF.inputs.find((i) => i.key === 'longEma').tooltip).toMatch(/^Long average in bars/)
  })
})

describe('2 · the server inputs', () => {
  it('names the row\'s four keys in the row\'s order, and the fetch carries only those', () => {
    expect(DEF.meta.serverInputs).toEqual(CONTRACT.inputs)
    expect(DEF.meta.serverInputs).toEqual(['benchmark', 'customBenchmark', 'shortEma', 'longEma'])
    expect(pickServerInputs(DEF, resolveInputs(DEF, { benchmark: 'QQQ', longEma: 12, color: '#fff' })))
      .toEqual({ benchmark: 'QQQ', customBenchmark: '', shortEma: 3, longEma: 12 })
    const byKey = Object.fromEntries(DEF.inputs.map((i) => [i.key, i]))
    expect(byKey.shortEma).toMatchObject({ type: 'int', default: 3, min: 2, max: 20, label: 'Short avg (bars)' })
    expect(byKey.longEma).toMatchObject({ type: 'int', default: 10, min: 3, max: 60, label: 'Long avg (bars)' })
    // the benchmark pair is rsLine's, option for option, gate for gate
    const rs = Object.fromEntries(RS.inputs.map((i) => [i.key, i]))
    expect(byKey.benchmark.options).toEqual(rs.benchmark.options)
    expect(byKey.customBenchmark).toMatchObject({ type: 'string', requiresServer: true, identityFor: 'benchmark',
      activeWhen: rs.customBenchmark.activeWhen, pattern: rs.customBenchmark.pattern, maxLength: 10, case: 'upper' })
    expect(DEF.inputs.map((i) => i.key)).toEqual(['benchmark', 'customBenchmark', 'shortEma', 'longEma', 'color'])
  })
})

describe('3 · the scalar paths', () => {
  it('reads only paths the U4 contract proves present', () => {
    const paths = scalarPathsOf(DEF)
    expect(paths.length).toBeGreaterThan(8)
    for (const p of paths) expect(CONTRACT.paths, p).toContain(p)
  })
})

describe('4 · the definition gate', () => {
  it('is not offered until the live server lists its id — then it is', () => {
    expect(isDefinitionOffered(DEF)).toBe(false)
    const offered = () => libraryRows(engineRegistry).filter((r) => r.kind === 'technical').map((r) => r.id)
    expect(offered()).not.toContain('rsPhases')
    primeServerDefinitions({ schemaVersion: 1, definitions: [{ schemaVersion: 1, id: 'rsPhases', version: 1,
      compute: { kind: 'server', fn: 'rsPhases', rev: 1 },
      inputs: DEF.meta.serverInputs.map((key) => ({ key })), columns: ['phase', 'divergence'] }] })
    expect(isDefinitionOffered(DEF)).toBe(true)
    expect(offered()).toContain('rsPhases')
  })

  it('a placed instance validates (F20 never drops it) whatever the server says', () => {
    const v = validateInstance(placed(DEF, { benchmark: 'CUSTOM', customBenchmark: 'SMH', longEma: 12 }), engineRegistry)
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
  })
})

describe('5 · the plots, the paint and the readout', () => {
  const plot = (k) => DEF.plots.find((p) => p.key === k)

  it('a hidden phase column, a neutral divergence histogram and a zero guide; the paint reads the phase', () => {
    expect(plot('phase')).toMatchObject({ style: 'line', hidden: true, role: 'context', legend: { hide: true } })
    expect(plot('divergence')).toMatchObject({ style: 'histogram', precision: 2, role: 'primary', legend: { decimals: 2 } })
    expect(plot('divergence').$refs).toEqual({ color: 'color' })
    expect(plot('divergence').colorMode, 'no up/down colour: a "how unusual" measure, not a direction').not.toBe('sign')
    expect(DEF.inputs.find((i) => i.key === 'color').default).toBe(IND_TOKENS.classic.neutral)
    expect(plot('zero')).toMatchObject({ style: 'hlines', levels: [0], color: IND_TOKENS.classic.neutral, width: 1, lineStyle: 'solid' })
    expect(DEF.plots.map((p) => p.key)).toEqual(['phase', 'divergence', 'zero'])
    // ⭐ index 0 = phase 0 (RS down while the market is up) is the bear red; index 1
    // = phase 1 (RS up while the market is down) is the INFO BLUE, the RS hue —
    // green/red stay reserved for the line-vs-average band (money direction).
    expect(DEF.paints).toEqual([{ kind: 'bgcolor', colorMode: 'column:phase',
      colorPalette: [IND_TOKENS.classic.bear, IND_TOKENS.classic.info], opacity: 0.18 }])
    expect(DEF.paints[0].colorPalette).not.toContain(IND_TOKENS.classic.bull)
    expect(DEF.paints[0].colorPalette).not.toContain(IND_TOKENS.classic.premium)
  })

  it('the readout: the Benchmark card, the phase sentence as the glance row, its numbers, the benchmark on the label', () => {
    const rows = readoutRows(DEF, PAYLOAD, { inputs: resolveInputs(DEF, {}) })
    const glance = rows.filter((r) => !r.detailOf)
    expect(glance.map((r) => r.key)).toEqual(['benchmarkName', 'phases', 'history'])
    expect(glance[0]).toMatchObject({ label: 'Benchmark', text: 'S&P 500 (SPY)' })
    expect(glance[1]).toMatchObject({ label: 'Phase', text: 'RS up while the market is down · divergence +1.2', muted: false })
    expect(rows.filter((r) => r.detailOf === 'phases').map((r) => [r.label, r.text])).toEqual([
      ['Phase', 'RS up while the market is down'], ['Divergence', '1.23'], ['RS trend', '0.0123'], ['Market trend', '-0.0081'],
    ])
    expect(rows.filter((r) => r.detailOf === 'benchmarkName').map((r) => [r.key, r.text])).toEqual([
      ['benchmarkRequested', 'S&P 500 (SPY)'], ['benchmark', 'SPY'],
    ])
    expect(readoutChipRows(DEF, rows).map((r) => [r.key, r.text])).toEqual([['benchmark', 'SPY']])
    expect(DEF.readout.find((r) => r.key === 'benchmarkName').card.learn).toBe('rsLine')
    const card = DEF.readout.find((r) => r.key === 'phases').card
    expect(card.evidence).toMatch(/No published hit rate exists/)
    for (const s of [DEF.meta.description, card.what, card.origin]) expect(s).not.toMatch(/\b(buy|sell|RSI)\b/i)
  })

  it('⛔ fail-closed: a same-symbol envelope prints the server\'s reason on the label and no number', () => {
    const rows = readoutRows(DEF, SAME_SYMBOL, { inputs: resolveInputs(DEF, {}) })
    expect(rows.find((r) => r.key === 'phases')).toMatchObject({ text: 'benchmark is the symbol' })
    expect(rows.find((r) => r.key === 'divergence')).toBeUndefined()
    expect(readoutFallbackValue(DEF, SAME_SYMBOL, 2, {}).text).toBe('benchmark is the symbol')
  })
})

describe('6 · a placed instance through the real binder, on the shared golden fixture', () => {
  it('the fixture is the two-series shape with the two wire columns null-padded and in range', () => {
    expect(CASE.kind).toBe('rs_phases')
    expect(CASE.params).toMatchObject({ short: 3, long: 10 })
    for (const key of CONTRACT.columns) expect(CASE.expected[key].length, key).toBe(BARS.length)
    expect(new Set(CASE.expected.phase)).toEqual(new Set([null, 0, 1]))
    expect(CASE.expected.divergence.every((v) => v === null || (v >= -3 && v <= 3))).toBe(true)
  })

  it('draws the divergence histogram and paints the phases from the landed envelope', () => {
    primeEnvelope(DEF, wire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.keys(cols).sort()).toEqual(['divergence', 'phase'])
    expect(cols.divergence.at(-1)).toBe(last(CASE.expected.divergence))
    expect(cols.phase.filter((v) => v === 1).length).toBe(CASE.expected.phase.filter((v) => v === 1).length)
    expect(cols.phase.filter(Number.isNaN).length, 'null → NaN leaves the bar unpainted').toBe(CASE.expected.phase.filter((v) => v === null).length)
    expect(scalarsFor(DEF, resolveInputs(DEF, {}), CTX)).toEqual(PAYLOAD)

    const { fake } = bindOnce([placed(DEF)], BARS)
    const drawn = seriesWithData(fake)
    expect(drawn.length, 'the histogram; the hidden phase column binds no series').toBe(1)
    expect(drawn[0].__ctor.__type).toBe('HistogramSeries')
    expect(drawn[0].__hasValue).toBe(true)
    expect(fake.calls.filter((c) => c.method === 'createPriceLine').map((c) => c.args[0].price)).toEqual([0])
    // the background paint rides the histogram's own series
    const painted = fake.calls.filter((c) => c.method === 'attachPrimitive')
    expect(painted.length).toBe(1)
    expect(painted[0].id).toBe(drawn[0].__id)
  })

  it('⛔ fail-closed: a same-symbol envelope binds a histogram with NO value and no guess', () => {
    primeEnvelope(DEF, blankWire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(cols.phase.every(Number.isNaN) && cols.divergence.every(Number.isNaN)).toBe(true)
    const { fake } = bindOnce([placed(DEF)], BARS)
    expect(fake.seriesCreated.some((s) => s.__hasValue)).toBe(false)
  })
})
