// app/src/components/chart/engine/__tests__/rsExitDef.test.js
//
// ─── UCT RS Exit Warnings (`rsExit`), 2026-11-12 ─────────────────────────────
//
// Mike Webster's Quick Break / Quicksand / Grateful Dead Break on the RS line, as the fifth
// RS indicator. Against the REGISTERED definition (never a copy). What this file pins:
//
//   1. the identity: version 1, `compute {server, rsExit, rev 1}`, schema-valid, `requiresServer`,
//      an own pane with the U3 floor and a hidden axis, and DAILY AND WEEKLY ONLY (`meta.timeframes`);
//   2. the server inputs are the row's four (the benchmark pair and the two lengths, where 0 is
//      auto); the three dot switches and the four colours never reach the server;
//   3. every scalar path it reads is in the contract the Python provider proves present;
//   4. hidden from every offer surface until the live server lists the id;
//   5. the plots: the RS line, the two simple averages (the fast one solid, the slow one dashed,
//      both neutral) and three glyph dots climbing a size ramp, each behind its own switch; the
//      readout prints the warning in plain words and no trade word;
//   6. a placed instance drawn through the real binder on the shared golden fixture
//      (`rs_exit_spy.json`), a dot switched off drawing nothing, and fail-closed on blank states.
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
import { resolvePlotForInstance } from '../pool'
import { eligibleInstances } from '../eligibility'
import { libraryRows } from '../../discoveryCatalog'
import { matches } from '../../IndicatorLibraryDialog'
import { IND_TOKENS } from '../../designTokens'
import {
  RS_SPLIT_CONTRACT, loadCase, scalarPathsOf, labelsOf, wireFrom, primeEnvelope, placed, bindOnce, seriesWithData, CTX,
} from './rsSplitTestKit'

const DEF = getDefinition('rsExit')
const RS = getDefinition('rsLine')
const CONTRACT = RS_SPLIT_CONTRACT.rsExit

const CASE = loadCase('rs_exit_spy')
const BARS = CASE.bars
const EVENTS = CASE.eventBars
const NEWEST_WARNING = Math.max(...EVENTS.quickBreak, ...EVENTS.quicksand, ...EVENTS.deadBreak)

/** The envelope `rs_exit_envelope` sends on the golden series: the legend names the newest
 *  warning (bar 166, a Quicksand, 53 bars before the newest bar 219). */
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', name: 'SPY', label: 'S&P 500 (SPY)', fallback: null, note: null, bars: CASE.benchmarkBars.length },
  legend: {
    blankReason: null,
    lastKind: 'quicksand', lastLabel: 'Quicksand', barsAgo: BARS.length - 1 - NEWEST_WARNING, lastAsOf: BARS[NEWEST_WARNING].t,
    chipText: `Quicksand · ${BARS.length - 1 - NEWEST_WARNING} bars ago`,
    status: 'aboveBoth', statusLabel: 'RS is above both averages', rs: 0.2477, fast: 0.2301, slow: 0.2102,
    fastLength: 21, slowLength: 50, asOf: BARS.at(-1).t, stale: false,
    summary: `Last warning: Quicksand, ${BARS.length - 1 - NEWEST_WARNING} bars ago`,
  },
  history: { bars: BARS.length, requested: 852, short: true },
  inputs: { benchmark: 'SPY', customBenchmark: '', fastLength: 21, slowLength: 50, maType: 'SMA' },
  intraday: false, state: 'ok',
})
const BLANK = (reason, state) => Object.freeze({
  benchmark: { requested: 'SPY', resolved: null, label: null, fallback: null, note: null, bars: 0 },
  legend: { blankReason: reason, lastKind: null, lastLabel: null, barsAgo: null, lastAsOf: null, chipText: null, status: null, statusLabel: null,
    rs: null, fast: null, slow: null, fastLength: 21, slowLength: 50, asOf: null, stale: null, summary: reason },
  history: { bars: BARS.length, requested: 852, short: false },
  inputs: { benchmark: 'SPY', customBenchmark: '', fastLength: 21, slowLength: 50, maType: 'SMA' },
  intraday: state === 'daily-weekly-only', state,
})
const wire = () => wireFrom(BARS, CASE.expected, PAYLOAD)
const blankWire = (reason, state) => wireFrom(BARS, Object.fromEntries(CONTRACT.columns.map((k) => [k, BARS.map(() => null)])),
  BLANK(reason, state))

beforeEach(() => { clearServerDefinitions(); clearServerColumns() })
afterEach(() => { clearServerDefinitions(); clearServerColumns() })

describe('1 · the identity', () => {
  it('is version 1 on the server lane, registered last, validates, and exists on daily and weekly charts only', () => {
    expect(DEF).toMatchObject({ id: 'rsExit', version: 1, compute: { kind: 'server', fn: 'rsExit', rev: 1 } })
    expect(validateDefinition(DEF).ok).toBe(true)
    expect(SERVER_DEFS.at(-1).id).toBe('rsExit')
    expect(DEF.meta).toMatchObject({ name: 'UCT RS Exit Warnings', shortName: 'UCT RS Exit', category: RS.meta.category,
      tier: 'premium', repaint: 'non-repainting', requiresServer: true, quickMenu: false, legendParams: ['benchmark'],
      timeframes: ['D', 'W'] })
    expect(DEF.meta.presets).toBeUndefined()
    expect(DEF.placement).toEqual({ target: 'pane', pane: { height: 0.20, minPx: 64 }, axis: 'hidden' })
  })

  it('names all three warnings in its description and says nothing about trading', () => {
    for (const w of ['Quick Break', 'Quicksand', 'Grateful Dead Break', 'Mike Webster']) expect(DEF.meta.description).toContain(w)
    expect(DEF.meta.description.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, 'at most two sentences').toBeLessThanOrEqual(2)
  })

  it('every member-facing label is at most 18 characters', () => {
    for (const [kind, key, label] of labelsOf(DEF)) expect(label.length, `${kind} ${key}: "${label}"`).toBeLessThanOrEqual(18)
  })

  it('is searchable by what a member would type, though the tags are never printed', () => {
    for (const word of ['rs', 'relative strength', 'exit', 'webster', 'quicksand', 'grateful dead', 'sell', 'warning']) {
      expect(DEF.meta.tags, word).toContain(word)
    }
  })

  it('is hidden, not dropped, on every other timeframe and drawn again on daily and weekly', () => {
    const inst = placed(DEF)
    for (const tf of ['1', '5', '15', '30', '60', 'M']) {
      expect(eligibleInstances([inst], engineRegistry, { tf }).hidden, tf).toEqual([{ inst, reason: 'timeframe' }])
    }
    for (const tf of ['D', 'W']) {
      expect(eligibleInstances([inst], engineRegistry, { tf }).kept.map((i) => i.instanceId), tf).toEqual([inst.instanceId])
    }
  })
})

describe('2 · the server inputs', () => {
  it('names the row\'s four keys, in the row\'s order; switches and colours stay on the client', () => {
    expect(DEF.meta.serverInputs).toEqual(CONTRACT.inputs)
    expect(DEF.meta.serverInputs).toEqual(['benchmark', 'customBenchmark', 'sectorBenchmark', 'themeBenchmark',
      'fastLength', 'slowLength'])
    const sent = pickServerInputs(DEF, resolveInputs(DEF, {
      benchmark: 'QQQ', fastLength: 10, slowLength: 40, showQuick: false, showQuicksand: false, showDead: false,
      color: '#ffffff', quickColor: '#000000',
    }))
    expect(sent).toEqual({ benchmark: 'QQQ', customBenchmark: '', sectorBenchmark: 'XLK', themeBenchmark: '',
      fastLength: 10, slowLength: 40 })
  })

  it('declares both lengths with 0 as auto and the row\'s 0 to 400 range, and honest copy about where 21 and 50 come from', () => {
    const byKey = Object.fromEntries(DEF.inputs.map((i) => [i.key, i]))
    for (const k of ['fastLength', 'slowLength']) {
      expect(byKey[k]).toMatchObject({ type: 'int', default: 0, min: 0, max: 400, group: 'Averages' })
      expect(byKey[k].tooltip).toMatch(/0 is automatic/)
    }
    expect(byKey.fastLength.tooltip).toMatch(/not a published rule/)
    const rs = Object.fromEntries(RS.inputs.map((i) => [i.key, i]))
    expect(byKey.benchmark.options).toEqual(rs.benchmark.options)
    expect(byKey.customBenchmark).toMatchObject({ requiresServer: true, identityFor: 'benchmark', pattern: rs.customBenchmark.pattern })
  })

  it('the three switches default ON and the dots they own are the three warnings', () => {
    const byKey = Object.fromEntries(DEF.inputs.map((i) => [i.key, i]))
    for (const k of ['showQuick', 'showQuicksand', 'showDead']) expect(byKey[k], k).toMatchObject({ type: 'bool', default: true, group: 'Simple' })
  })
})

describe('3 · the scalar paths', () => {
  it('reads only paths the Python provider proves present', () => {
    const paths = scalarPathsOf(DEF)
    expect(paths.length).toBeGreaterThan(8)
    for (const p of paths) expect(CONTRACT.paths, p).toContain(p)
  })
})

describe('4 · the definition gate', () => {
  it('is not offered until the live server lists its id — then it is', () => {
    expect(isDefinitionOffered(DEF)).toBe(false)
    const offered = () => libraryRows(engineRegistry).filter((r) => r.kind === 'technical').map((r) => r.id)
    expect(offered()).not.toContain('rsExit')
    primeServerDefinitions({ schemaVersion: 1, definitions: [{ schemaVersion: 1, id: 'rsExit', version: 1,
      compute: { kind: 'server', fn: 'rsExit', rev: 1 },
      inputs: CONTRACT.inputs.map((key) => ({ key })), columns: CONTRACT.columns }] })
    expect(isDefinitionOffered(DEF)).toBe(true)
    expect(offered()).toContain('rsExit')
  })

  it('the library finds it under Relative Strength by every word a member would type', () => {
    primeServerDefinitions({ schemaVersion: 1, definitions: [{ schemaVersion: 1, id: 'rsExit', version: 1,
      compute: { kind: 'server', fn: 'rsExit', rev: 1 }, inputs: CONTRACT.inputs.map((key) => ({ key })), columns: CONTRACT.columns }] })
    const row = libraryRows(engineRegistry).find((r) => r.id === 'rsExit')
    expect(row, 'offered once the server lists it').toBeTruthy()
    expect(row.category).toBe(RS.meta.category)
    for (const q of ['rs', 'relative strength', 'exit', 'exit warnings', 'warning', 'sell', 'webster', 'quick break', 'quicksand',
      'grateful dead', 'dead', 'trim']) {
      expect(matches(row, q), q).toBe(true)
    }
    for (const q of ['macd', 'bollinger', 'mansfield']) expect(matches(row, q), q).toBe(false)
  })

  it('a placed instance validates (F20 never drops it) whatever the server says', () => {
    const v = validateInstance(placed(DEF, { benchmark: 'RSP', fastLength: 10 }), engineRegistry)
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
  })
})

describe('5 · the plots and the readout', () => {
  const plot = (k) => DEF.plots.find((p) => p.key === k)

  it('the RS line and its two simple averages: blue line, the fast average solid, the slow one dashed, both neutral', () => {
    expect(DEF.plots.map((p) => p.key)).toEqual(['rsLine', 'fast', 'slow', 'dotQuick', 'dotQuicksand', 'dotDead'])
    // the registry resolves each `$input` placeholder to the input's default; a member's pick is
    // substituted per instance at draw time (`pool.resolvePlotForInstance`), pinned in the next test
    expect(plot('rsLine')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.info, width: 1, role: 'primary',
      legend: { decimals: 4, showValue: false }, $refs: { color: 'color' } })
    expect(plot('fast')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.neutral, width: 1, legend: { hide: true } })
    expect(plot('fast').lineStyle).toBeUndefined()
    expect(plot('slow')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.neutral, width: 1, lineStyle: 'largeDashed', legend: { hide: true } })
    expect(DEF.inputs.find((i) => i.key === 'color').default).toBe(IND_TOKENS.classic.info)
  })

  it('three circle glyphs ON the line, climbing in size, each behind its own switch, the worst painted last', () => {
    const dots = ['dotQuick', 'dotQuicksand', 'dotDead'].map(plot)
    for (const d of dots) expect(d, d.key).toMatchObject({ style: 'markers', restyle: false, legend: { hide: true },
      marker: { shape: 'circle', position: 'inBar' } })
    const sizes = dots.map((d) => d.marker.size)
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
    expect(new Set(sizes).size, 'three distinct sizes').toBe(3)
    expect(dots.map((d) => d.activeWhen)).toEqual([
      { key: 'showQuick', equals: true }, { key: 'showQuicksand', equals: true }, { key: 'showDead', equals: true }])
    expect(DEF.plots.map((p) => p.key).slice(-3), 'declared quick, quicksand, dead so the worst paints on top')
      .toEqual(['dotQuick', 'dotQuicksand', 'dotDead'])
  })

  it('the dots climb a caution ramp: the brand\'s gold, a warm orange, the bear red; the three colours are distinct', () => {
    const byKey = Object.fromEntries(DEF.inputs.map((i) => [i.key, i]))
    expect(byKey.quickColor.default).toBe(IND_TOKENS.classic.premium)          // `--warn` is the gold
    expect(byKey.deadColor.default).toBe(IND_TOKENS.classic.bear)
    const colours = ['quickColor', 'quicksandColor', 'deadColor'].map((k) => byKey[k].default)
    expect(new Set(colours).size, colours.join(' ')).toBe(3)
    expect(byKey.quicksandColor.default).toMatch(/^#[0-9a-f]{6}$/i)
    // each dot wears its own colour input by default, and a member's pick reaches the plot per instance
    for (const [key, input] of [['dotQuick', 'quickColor'], ['dotQuicksand', 'quicksandColor'], ['dotDead', 'deadColor']]) {
      expect(plot(key).color, key).toBe(byKey[input].default)
      expect(plot(key).$refs, key).toEqual({ color: input })
      expect(resolvePlotForInstance(plot(key), { [input]: '#123456' }).color, key).toBe('#123456')
    }
    expect(resolvePlotForInstance(plot('rsLine'), { color: '#abcdef' }).color).toBe('#abcdef')
  })

  it('the readout says the last warning in plain words, with its short form on the pane label and no trade word', () => {
    const rows = readoutRows(DEF, PAYLOAD, { inputs: resolveInputs(DEF, {}) })
    const glance = rows.filter((r) => !r.detailOf)
    expect(glance.map((r) => r.key)).toEqual(['benchmarkName', 'lastWarning', 'status', 'history'])
    expect(glance[1]).toMatchObject({ label: 'Last warning', text: PAYLOAD.legend.summary, muted: false })
    expect(glance[2]).toMatchObject({ label: 'RS vs averages', text: 'RS is above both averages' })
    expect(readoutChipRows(DEF, rows).map((r) => [r.key, r.text])).toEqual([
      ['benchmark', 'SPY'], ['lastWarningChip', PAYLOAD.legend.chipText]])
    expect(rows.filter((r) => r.detailOf === 'lastWarning').map((r) => r.key)).toEqual(['lastWarningChip', 'barsAgo'])
    expect(rows.filter((r) => r.detailOf === 'status').map((r) => [r.label, r.text])).toEqual([
      ['Fast average', '0.2301'], ['Slow average', '0.2102'], ['Fast length (bars)', '21'], ['Slow length (bars)', '50'],
    ])
    const card = DEF.readout.find((r) => r.key === 'lastWarning').card
    expect(card.what).toMatch(/Quick Break.*Quicksand.*Grateful Dead Break/s)
    expect(card.origin).toMatch(/Mike Webster/)
    expect(card.origin).toMatch(/UCT\'s reading|UCT's reading/)
    expect(card.evidence).toMatch(/not an instruction to act/)
    expect(card.evidence).toMatch(/No published hit rate exists/)
    for (const s of [DEF.meta.description, card.what, card.origin, card.evidence]) expect(s).not.toMatch(/\b(buy|sell|RSI)\b/i)
  })

  it('⛔ fail-closed: every blank state prints the server\'s reason and no number', () => {
    for (const [reason, state] of [['daily and weekly charts only', 'daily-weekly-only'], ['benchmark is the symbol', 'same-symbol'],
      ['no benchmark bars', 'no-benchmark-bars'], ['not enough bars yet', 'ok']]) {
      const payload = BLANK(reason, state)
      const rows = readoutRows(DEF, payload, { inputs: resolveInputs(DEF, {}) })
      expect(rows.find((r) => r.key === 'lastWarning'), reason).toMatchObject({ text: reason })
      expect(rows.find((r) => r.key === 'status'), reason).toBeUndefined()
      expect(readoutFallbackValue(DEF, payload, 4, {}).text, reason).toBe(reason)
    }
  })
})

describe('6 · a placed instance through the real binder, on the shared golden fixture', () => {
  it('the fixture is the daily 21 / 50 pair with all three warnings, the dots riding the line', () => {
    expect(CASE.kind).toBe('rs_exit')
    expect(CASE.params).toEqual({ fast: 21, slow: 50 })
    for (const key of CONTRACT.columns) expect(CASE.expected[key].length, key).toBe(BARS.length)
    expect(EVENTS.quickBreak.length).toBeGreaterThan(1)
    expect(EVENTS.quicksand.length).toBeGreaterThan(0)
    expect(EVENTS.deadBreak.length).toBeGreaterThan(0)
    for (const [dot, key] of [['dotQuick', 'quickBreak'], ['dotQuicksand', 'quicksand'], ['dotDead', 'deadBreak']]) {
      expect(CASE.expected[dot].map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0), dot).toEqual(EVENTS[key])
    }
  })

  it('draws the line, both averages and the three dot series from the landed envelope', () => {
    primeEnvelope(DEF, wire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.keys(cols).sort()).toEqual([...CONTRACT.columns].sort())
    expect(cols.rsLine.at(-1)).toBe(CASE.expected.rsLine.at(-1))
    expect(cols.fast.slice(0, 20).every(Number.isNaN) && Number.isFinite(cols.fast[20])).toBe(true)
    expect(cols.slow.slice(0, 49).every(Number.isNaN) && Number.isFinite(cols.slow[49])).toBe(true)
    for (const i of EVENTS.deadBreak) expect(cols.dotDead[i]).toBe(CASE.expected.rsLine[i])
    expect(scalarsFor(DEF, resolveInputs(DEF, {}), CTX)).toEqual(PAYLOAD)

    const { fake } = bindOnce([placed(DEF)], BARS)
    const drawn = seriesWithData(fake)
    expect(drawn.length, 'the line, two averages and three dot series').toBe(6)
    expect(drawn.every((s) => s.__hasValue)).toBe(true)
    expect(drawn.filter((s) => s.__ctor.__type === 'LineSeries').length).toBeGreaterThanOrEqual(3)
  })

  it('a dot switched off draws nothing, and the other two still do', () => {
    primeEnvelope(DEF, wire())
    const all = seriesWithData(bindOnce([placed(DEF)], BARS).fake).length
    for (const key of ['showQuick', 'showQuicksand', 'showDead']) {
      primeEnvelope(DEF, wire())
      const fewer = seriesWithData(bindOnce([placed(DEF, { [key]: false })], BARS).fake).length
      expect(fewer, key).toBe(all - 1)
    }
  })

  it('⛔ fail-closed: a blank envelope binds series with NO value and no guess', () => {
    primeEnvelope(DEF, blankWire('daily and weekly charts only', 'daily-weekly-only'))
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.values(cols).every((col) => col.every(Number.isNaN))).toBe(true)
    const { fake } = bindOnce([placed(DEF)], BARS)
    expect(fake.seriesCreated.some((s) => s.__hasValue)).toBe(false)
  })
})
