// app/src/components/chart/engine/__tests__/rsMansfieldDef.test.js
//
// ─── UCT Mansfield RS (`rsMansfield`), 2026-11-18 ────────────────────────────
//
// Weinstein's Mansfield Relative Strength as the sixth RS indicator: the column the rsLine
// row computes under its Mansfield Reading (`view: 'mansfield'`), on a pane of its own,
// because the slim UCT RS Line has no Reading switch. Against the REGISTERED definition
// (never a copy). What this file pins:
//
//   1. the identity: version 1, `compute {server, rsMansfield, rev 1}`, schema-valid,
//      `requiresServer`, an own pane with the U3 floor and a hidden axis, every timeframe;
//   2. the server inputs are the row's five (the benchmark pair and `mansfieldLength`, the
//      rsLine definition's own declaration); the colours and the width never reach the server;
//   3. every scalar path it reads is in the contract the Python provider proves present;
//   4. hidden from every offer surface until the live server lists the id;
//   5. the plots are rsLine's Mansfield plots (the line, the zero guide, the cross-up dot) and
//      the readout is rsLine's Mansfield rows, moved across;
//   6. ⭐ ONE AUTHORITY: a placed instance drawn through the real binder on the committed
//      fixture (`rs_mansfield.json`, the file the Python lane's `mansfield_column` is held to)
//      draws EXACTLY the fixture's Mansfield column and cross dot, no client transform, and
//      fails closed on a blank state. The server half (the wire IS the rsLine Reading, byte for
//      byte, and the fixture to four places) is `tests/test_rs_mansfield_rows.py`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDefinition, SERVER_DEFS, computeFor, resolveInputs } from '../nativeRegistry'
import * as engineRegistry from '../nativeRegistry'
import { RS_LINE_V5_RAW } from '../nativeRegistry'
import { validateDefinition } from '../defSchema'
import {
  isDefinitionOffered, primeServerDefinitions, clearServerDefinitions, pickServerInputs, clearServerColumns, scalarsFor,
} from '../serverCompute'
import { readoutRows } from '../readoutSchema'
import { readoutFallbackValue } from '../readout'
import { validateInstance } from '../instances'
import { eligibleInstances } from '../eligibility'
import { libraryRows } from '../../discoveryCatalog'
import { matches } from '../../IndicatorLibraryDialog'
import { IND_TOKENS } from '../../designTokens'
import {
  RS_SPLIT_CONTRACT, loadCase, scalarPathsOf, labelsOf, wireFrom, primeEnvelope, placed, bindOnce, seriesWithData, CTX,
} from './rsSplitTestKit'

const DEF = getDefinition('rsMansfield')
const RS = getDefinition('rsLine')
const CONTRACT = RS_SPLIT_CONTRACT.rsMansfield

const CASE = loadCase('rs_mansfield')
const BARS = CASE.bars
const EXP = CASE.expected

/** The envelope `rs_mansfield_envelope` sends on the fixture's bars: the rsLine payload's own
 *  `mansfield` block (`_rs_mansfield_scalars`) and a live legend (no blank reason). */
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', name: 'SPY', label: 'S&P 500 (SPY)', fallback: null, note: null, bars: CASE.benchmarkBars.length },
  mansfield: { value: EXP.mansfield.at(-1), aboveZero: EXP.mansfield.at(-1) >= 0, state: EXP.mansfieldState.at(-1),
    stateLabel: 'neutral', crossBarsAgo: EXP.mansfieldCrossBarsAgo.at(-1), length: 10, lengthText: '10 bars', slope: -1,
    crossDirection: 'down', lastCross: 'down, 7 bars ago', summary: '-1.2%, below zero, falling' },
  legend: { summary: '-1.2%, below zero, falling', blankReason: null },
  history: { bars: BARS.length, requested: 452, short: true },
  inputs: { benchmark: 'SPY', customBenchmark: '', sectorBenchmark: '', themeBenchmark: '', mansfieldLength: 10 },
  intraday: false, state: 'short-history',
})
const BLANK = (reason, state) => Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: null, note: null, bars: 0 },
  mansfield: { value: null, aboveZero: null, state: null, stateLabel: null, crossBarsAgo: null, length: 200,
    lengthText: '200 bars', slope: null, crossDirection: null, lastCross: null, summary: null },
  legend: { summary: reason, blankReason: reason },
  history: { bars: BARS.length, requested: 452, short: true },
  inputs: { benchmark: 'SPY', customBenchmark: '', sectorBenchmark: '', themeBenchmark: '', mansfieldLength: 200 },
  intraday: false, state,
})
const wire = () => wireFrom(BARS, { mansfield: EXP.mansfield, dotMansfieldCross: EXP.dotMansfieldCross }, PAYLOAD)
const blankWire = (reason, state) => wireFrom(BARS, Object.fromEntries(CONTRACT.columns.map((k) => [k, BARS.map(() => null)])),
  BLANK(reason, state))

beforeEach(() => { clearServerDefinitions(); clearServerColumns() })
afterEach(() => { clearServerDefinitions(); clearServerColumns() })

describe('1 · the identity', () => {
  it('is version 1 on the server lane, registered last, validates, and draws on every timeframe', () => {
    expect(DEF).toMatchObject({ id: 'rsMansfield', version: 1, compute: { kind: 'server', fn: 'rsMansfield', rev: 1 } })
    expect(validateDefinition(DEF).ok).toBe(true)
    expect(SERVER_DEFS.at(-1).id).toBe('rsMansfield')
    expect(DEF.meta).toMatchObject({ name: 'UCT Mansfield RS', shortName: 'UCT Mansfield RS', category: RS.meta.category,
      tier: 'premium', repaint: 'non-repainting', requiresServer: true, quickMenu: false, legendParams: ['benchmark'] })
    expect(DEF.meta.presets).toBeUndefined()
    expect(DEF.meta.timeframes, 'every timeframe: intraday the line draws and the dot is blank').toBeUndefined()
    expect(DEF.placement).toEqual({ target: 'pane', pane: { height: 0.20, minPx: 64 }, axis: 'hidden' })
    const inst = placed(DEF)
    for (const tf of ['1', '5', '60', 'D', 'W', 'M']) {
      expect(eligibleInstances([inst], engineRegistry, { tf }).kept.map((i) => i.instanceId), tf).toEqual([inst.instanceId])
    }
  })

  it('names Weinstein and the zero line, in at most two sentences, and no trade word', () => {
    for (const w of ['Weinstein', 'Mansfield Relative Strength', 'zero']) expect(DEF.meta.description).toContain(w)
    expect(DEF.meta.description.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, 'at most two sentences').toBeLessThanOrEqual(2)
    expect(DEF.meta.description).not.toMatch(/\b(buy|sell|RSI)\b/i)
  })

  it('every member-facing label is at most 18 characters', () => {
    for (const [kind, key, label] of labelsOf(DEF)) expect(label.length, `${kind} ${key}: "${label}"`).toBeLessThanOrEqual(18)
  })

  it('has no Reading switch: one indicator, one reading', () => {
    expect(DEF.inputs.map((i) => i.key)).not.toContain('view')
    expect(DEF.inputs.map((i) => i.key)).not.toContain('showMansfield')
  })
})

describe('2 · the server inputs', () => {
  it('names the row\'s five keys, in the row\'s order; colours and width stay on the client', () => {
    expect(DEF.meta.serverInputs).toEqual(CONTRACT.inputs)
    expect(DEF.meta.serverInputs).toEqual(['benchmark', 'customBenchmark', 'sectorBenchmark', 'themeBenchmark', 'mansfieldLength'])
    const sent = pickServerInputs(DEF, resolveInputs(DEF, { benchmark: 'QQQ', mansfieldLength: 52, color: '#ffffff',
      dotColor: '#000000', lineWidth: 3 }))
    expect(sent).toEqual({ benchmark: 'QQQ', customBenchmark: '', sectorBenchmark: 'XLK', themeBenchmark: '', mansfieldLength: 52 })
  })

  it('the length is the rsLine definition\'s own declaration: default 200, 2 to 500; the benchmark pair is the RS line\'s', () => {
    const byKey = Object.fromEntries(DEF.inputs.map((i) => [i.key, i]))
    const v5 = Object.fromEntries(RS_LINE_V5_RAW.inputs.map((i) => [i.key, i]))
    for (const f of ['type', 'default', 'min', 'max', 'step']) expect(byKey.mansfieldLength[f], f).toBe(v5.mansfieldLength[f])
    expect(byKey.mansfieldLength).toMatchObject({ type: 'int', default: 200, min: 2, max: 500 })
    const rs = Object.fromEntries(RS.inputs.map((i) => [i.key, i]))
    expect(byKey.benchmark.options).toEqual(rs.benchmark.options)
    expect(byKey.customBenchmark).toMatchObject({ requiresServer: true, identityFor: 'benchmark', pattern: rs.customBenchmark.pattern })
  })
})

describe('3 · the scalar paths', () => {
  it('reads only paths the Python provider proves present', () => {
    const paths = scalarPathsOf(DEF)
    expect(paths.length).toBeGreaterThan(6)
    for (const p of paths) expect(CONTRACT.paths, p).toContain(p)
  })
})

describe('4 · the definition gate', () => {
  const listed = () => primeServerDefinitions({ schemaVersion: 1, definitions: [{ schemaVersion: 1, id: 'rsMansfield', version: 1,
    compute: { kind: 'server', fn: 'rsMansfield', rev: 1 }, inputs: CONTRACT.inputs.map((key) => ({ key })), columns: CONTRACT.columns }] })

  it('is not offered until the live server lists its id — then it is', () => {
    expect(isDefinitionOffered(DEF)).toBe(false)
    const offered = () => libraryRows(engineRegistry).filter((r) => r.kind === 'technical').map((r) => r.id)
    expect(offered()).not.toContain('rsMansfield')
    listed()
    expect(isDefinitionOffered(DEF)).toBe(true)
    expect(offered()).toContain('rsMansfield')
  })

  it('the library finds it under Relative Strength by every word a member would type', () => {
    listed()
    const row = libraryRows(engineRegistry).find((r) => r.id === 'rsMansfield')
    expect(row, 'offered once the server lists it').toBeTruthy()
    expect(row.category).toBe(RS.meta.category)
    for (const q of ['rs', 'relative strength', 'mansfield', 'mansfield rs', 'mansfield relative strength', 'weinstein',
      'stage analysis', 'zero line']) {
      expect(matches(row, q), q).toBe(true)
    }
    for (const q of ['macd', 'bollinger', 'quicksand']) expect(matches(row, q), q).toBe(false)
  })

  it('a placed instance validates (F20 never drops it) whatever the server says', () => {
    const v = validateInstance(placed(DEF, { benchmark: 'RSP', mansfieldLength: 52 }), engineRegistry)
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
  })
})

describe('5 · the plots and the readout are rsLine\'s Mansfield ones', () => {
  const plot = (k) => DEF.plots.find((p) => p.key === k)
  const v5 = (k) => RS_LINE_V5_RAW.plots.find((p) => p.key === k)

  it('the line in the info blue, the solid zero guide in the neutral, the cross-up dot', () => {
    expect(DEF.plots.map((p) => p.key)).toEqual(['mansfield', 'zero', 'dotMansfieldCross'])
    expect(plot('mansfield')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.info, width: 1, role: 'primary',
      precision: v5('mansfield').precision, legend: { decimals: 2 }, $refs: { color: 'color', width: 'lineWidth' } })
    expect(plot('zero')).toMatchObject({ style: 'hlines', levels: [0], color: IND_TOKENS.classic.neutral, width: 1, lineStyle: 'solid' })
    expect(plot('zero').levels).toEqual(v5('mansfieldZero').levels)
    expect(plot('dotMansfieldCross')).toMatchObject({ style: 'markers', width: v5('dotMansfieldCross').width, restyle: false,
      legend: { hide: true }, $refs: { color: 'dotColor' } })
  })

  it('the readout is rsLine\'s Mansfield rows: the sentence, then value, last cross and length', () => {
    const rows = readoutRows(DEF, PAYLOAD, { inputs: resolveInputs(DEF, {}) })
    expect(rows.filter((r) => !r.detailOf).map((r) => r.key)).toEqual(['benchmarkName', 'mansfield', 'history'])
    expect(rows.find((r) => r.key === 'mansfield')).toMatchObject({ label: 'Mansfield RS', text: PAYLOAD.mansfield.summary })
    expect(rows.filter((r) => r.detailOf === 'mansfield').map((r) => [r.label, r.text])).toEqual([
      ['Value', '-1.2%'], ['Last zero cross', 'down, 7 bars ago'], ['Length', '10 bars']])
    const mine = Object.fromEntries(DEF.readout.map((r) => [r.key, r]))
    for (const r of RS_LINE_V5_RAW.readout.filter((row) => /^mansfield/.test(row.key))) {
      expect(mine[r.key], r.key).toBeTruthy()
      expect(mine[r.key].source, r.key).toBe(r.source)
      expect(mine[r.key].format, r.key).toBe(r.format)
    }
    const card = mine.mansfield.card
    expect(card.origin).toBe(RS_LINE_V5_RAW.readout.find((r) => r.key === 'mansfield').card.origin)
    expect(card.evidence).toMatch(/No published hit rate exists/)
    for (const s of [card.what, card.origin, card.evidence]) expect(s).not.toMatch(/\b(buy|sell|RSI)\b/i)
  })

  it('⛔ fail-closed: every blank state prints the server\'s reason on the pane label and no number', () => {
    for (const [reason, state] of [['benchmark is the symbol', 'same-symbol'], ['no benchmark bars', 'no-benchmark-bars'],
      ['not enough bars yet', 'short-history']]) {
      const payload = BLANK(reason, state)
      expect(readoutFallbackValue(DEF, payload, 2, {}).text, reason).toBe(reason)
      const rows = readoutRows(DEF, payload, { inputs: resolveInputs(DEF, {}) })
      expect(rows.find((r) => r.key === 'mansfieldValue'), reason).toBeUndefined()
    }
    // a live answer carries no reason: with no number at hand the label withholds one (F3's dash),
    // it never prints a blank state's words
    expect(readoutFallbackValue(DEF, PAYLOAD, 2, {})).toEqual({ text: '—', muted: true })
  })
})

describe('6 · ⭐ ONE AUTHORITY: the committed fixture, drawn through the real binder', () => {
  /** The last setData payload of the series with `id`, keyed by time. */
  const drawnOf = (fake, s) => {
    const call = fake.calls.filter((c) => c.id === s.__id && c.method === 'setData').at(-1)
    return new Map(call.args[0].map((p) => [p.time, p.value]))
  }

  it('the fixture is the shared Mansfield case: weekly, length 10, a benchmark gap, crosses both ways', () => {
    expect(CASE.kind).toBe('rs_mansfield')
    expect(CASE.params).toEqual({ length: 10 })
    for (const key of CONTRACT.columns) expect(EXP[key].length, key).toBe(BARS.length)
    expect(EXP.mansfieldCrossUp.filter((v) => v === 1).length).toBeGreaterThan(0)
    expect(EXP.mansfieldCrossDown.filter((v) => v === 1).length).toBeGreaterThan(0)
  })

  it('draws EXACTLY the fixture\'s Mansfield column and cross dot: no client transform', () => {
    primeEnvelope(DEF, wire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.keys(cols).sort()).toEqual([...CONTRACT.columns].sort())
    EXP.mansfield.forEach((e, i) => {
      if (e === null) expect(Number.isNaN(cols.mansfield[i]), `mansfield[${i}]`).toBe(true)
      else expect(cols.mansfield[i], `mansfield[${i}]`).toBe(e)
    })
    expect(scalarsFor(DEF, resolveInputs(DEF, {}), CTX)).toEqual(PAYLOAD)

    const { fake } = bindOnce([placed(DEF)], BARS)
    const drawn = seriesWithData(fake)
    expect(drawn.length, 'the line and the dot series').toBe(2)
    const finite = (s) => [...drawnOf(fake, s).values()].filter(Number.isFinite).length
    const [line, dot] = [...drawn].sort((a, b) => finite(b) - finite(a))
    const lineData = drawnOf(fake, line)
    const dotData = drawnOf(fake, dot)
    let points = 0
    EXP.mansfield.forEach((e, i) => {
      const got = lineData.get(BARS[i].t)
      if (e === null) expect(Number.isFinite(got), `no point on bar ${i}`).toBe(false)
      else { expect(got, `line on bar ${i}`).toBe(e); points += 1 }
    })
    expect(points, 'not vacuous: the warm-up and the gap are the only holes').toBe(EXP.mansfield.filter((v) => v !== null).length)
    const dotBars = BARS.map((b, i) => i).filter((i) => Number.isFinite(dotData.get(BARS[i].t)))
    expect(dotBars).toEqual(EXP.dotMansfieldCross.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0))
    for (const i of dotBars) expect(dotData.get(BARS[i].t), `dot on bar ${i}`).toBe(0)
  })

  it('⛔ fail-closed: a blank envelope binds series with NO value and no guess', () => {
    primeEnvelope(DEF, blankWire('benchmark is the symbol', 'same-symbol'))
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.values(cols).every((col) => col.every(Number.isNaN))).toBe(true)
    const { fake } = bindOnce([placed(DEF)], BARS)
    expect(fake.seriesCreated.some((s) => s.__hasValue)).toBe(false)
  })
})
