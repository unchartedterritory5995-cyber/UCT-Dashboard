// app/src/components/chart/engine/__tests__/rsReadout.test.js
//
// ─── UCT Relative Strength · the readout rows, in operator voice (unit 2a-09) ─
//
// A readout block shaped like the plan's Leadership rows (plan §6.6), resolved
// against a fixture of the v2 envelope's scalars exactly as the provider builds
// them (`api/routers/signature.py::_rs_line_provider` — `benchmark`, `legend`,
// `lastRsHigh`, `history`, `inputs`, `intraday`, `state`) plus the 2a `rating`
// the engineering map §4.1.4 adds. The rows are the member copy; the numbers
// are the formats. Unit 2a-14 writes the real `readout[]` against THIS shape,
// and the block here is validated by the schema so it is one the registry
// would accept.
//
// ⛔ The payload carries no "last ratio" scalar — the RS value a member reads is
// the chip's own value off the `rsLine` column — so the `ratio` format is
// exercised on RS-shaped values below rather than on a row.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  readoutRows, readoutChipRows, formatReadoutValue, parseReadoutSource,
  READOUT_FORMATS, MAX_CHIP_ROWS,
} from '../readoutSchema'
import { validateDefinition } from '../defSchema'
import { legendChips, paneReadoutLabel } from '../readout'
import * as engineRegistry from '../nativeRegistry'
import { resolveInputs } from '../nativeRegistry'
import { scalarsFor, primeServerColumns, clearServerColumns, pickServerInputs } from '../serverCompute'

const RS = engineRegistry.getDefinition('rsLine')

/** The v2 payload as `_rs_line_provider` builds it: NVDA against the sector
 *  ETF on a daily chart, 330 of 852 requested bars held, an RS high three bars
 *  ago that came before price and not on a red day. */
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SECTOR', resolved: 'XLK', label: 'Technology (XLK)', fallback: null, bars: 330 },
  legend: { pctFromMa: 1.8421, maSlope: 1, above: true },
  lastRsHigh: { index: 326, time: 20261103, beforePrice: true, redDay: false, barsAgo: 3 },
  history: { bars: 330, requested: 852, short: true },
  inputs: { benchmark: 'SECTOR', maLength: 21, maType: 'EMA', lookback: 252, priceTolerance: 2, redDayThreshold: -0.5 },
  intraday: false,
  state: 'short-history',
  // 2a (engineering map §4.1.4): the IBD-style rating from the web pod's history table
  rating: { ibd: 94, fast: 91, asof: '2026-11-05' },
})

/** The plan's Leadership rows as a definition declares them. Operator voice,
 *  no emoji; `chip: true` on the two the pane label carries. */
const READOUT = Object.freeze([
  { key: 'benchmark', label: 'Benchmark', source: 'scalar:benchmark.resolved', format: 'text', chip: true,
    card: { what: 'What the RS line is measured against.', origin: 'IBD draws RS against the S&P 500; the sector ETF isolates the stock from its group.' } },
  { key: 'benchmarkName', label: 'Benchmark name', source: 'scalar:benchmark.label', format: 'text' },
  { key: 'benchmarkNote', label: 'Benchmark note', source: 'scalar:benchmark.fallback', format: 'text',
    when: 'scalar:benchmark.fallback' },
  { key: 'rating', label: 'Rating', source: 'scalar:rating.ibd', format: 'int', chip: true, fallback: 'not yet rated' },
  { key: 'fastRating', label: 'Fast rating', source: 'scalar:rating.fast', format: 'int' },
  { key: 'phase', label: 'RS line', source: 'scalar:legend.above', format: 'bool',
    words: ['above its average', 'below its average'] },
  { key: 'fromMa', label: 'From average', source: 'scalar:legend.pctFromMa', format: 'pct' },
  { key: 'rsHigh', label: 'RS high', source: 'scalar:lastRsHigh.barsAgo', format: 'barsAgo' },
  { key: 'beforePrice', label: 'Before price', source: 'scalar:lastRsHigh.beforePrice', format: 'bool',
    words: ['before price', ''] },
  { key: 'redDay', label: 'Red day', source: 'scalar:lastRsHigh.redDay', format: 'bool', words: ['red day', ''] },
  { key: 'history', label: 'Bars held', source: 'scalar:history.bars', format: 'int', when: 'scalar:history.short' },
  { key: 'shortHistory', label: 'Note', source: 'scalar:history.short', format: 'bool', when: 'scalar:history.short',
    words: ['short history: dots over every bar we hold, not a full year', ''] },
  { key: 'requested', label: 'Requested', source: 'input:benchmark', format: 'text' },
  { key: 'lookback', label: 'Lookback', source: 'input:lookback', format: 'int' },
])

const RS_READOUT = (() => {
  const r = validateDefinition({ ...RS, readout: READOUT })
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.def
})()

const rows = (payload, inputs = { benchmark: 'SECTOR' }) => readoutRows(RS_READOUT, payload, { inputs })
const pairs = (list) => list.map((r) => [r.key, r.text])
const EMOJI = /\p{Extended_Pictographic}/u

describe('UCT RS · the readout block is one the schema accepts', () => {
  it('validates on the registered definition, verbatim', () => {
    expect(RS_READOUT.readout).toEqual(READOUT)
    // Unit 2a-14 landed the registered `readout[]`; this file keeps its own block
    // as the schema control (the rows the plan wrote, validated verbatim). The
    // registered block is railed row by row against the live provider payload in
    // `tests/test_rs_columns_provider.py` and its surfaces in `StockChart.rsReadout.test.jsx`.
    expect(Array.isArray(RS.readout) && RS.readout.length > 0, 'the registered definition declares the Leadership readout').toBe(true)
    // VA2: the fast rating rides the label too, under its headline condition
    expect(RS.readout.filter((e) => e.chip).map((e) => e.key)).toEqual(['benchmark', 'rating', 'fastRating'])
  })

  it('operator voice: no emoji in any label, word or fallback', () => {
    for (const e of READOUT) {
      for (const s of [e.label, e.fallback, ...(e.words || []), ...(e.card ? Object.values(e.card) : [])]) {
        if (typeof s === 'string') expect(s, s).not.toMatch(EMOJI)
      }
    }
  })
})

describe('UCT RS · the rows, against the v2 scalars', () => {
  it('says what the plan says, row by row', () => {
    expect(pairs(rows(PAYLOAD))).toEqual([
      ['benchmark', 'XLK'],
      ['benchmarkName', 'Technology (XLK)'],
      // benchmarkNote: no fallback, so no note
      ['rating', '94'],
      ['fastRating', '91'],
      ['phase', 'above its average'],
      ['fromMa', '+1.8%'],
      ['rsHigh', '3 bars ago'],
      ['beforePrice', 'before price'],
      // redDay: false, and its false-word is empty, so the row is omitted
      ['history', '330'],
      ['shortHistory', 'short history: dots over every bar we hold, not a full year'],
      ['requested', 'Sector (auto)'],
      ['lookback', '252'],                    // the declared default — the instance never stored one
    ])
    for (const r of rows(PAYLOAD)) {
      expect(r.muted).toBe(false)
      expect(r.text).not.toMatch(/NaN|undefined|null/)
      expect(r.text).not.toMatch(EMOJI)
    }
  })

  it('the benchmark note appears only when the server fell back, and says why', () => {
    const fellBack = { ...PAYLOAD, benchmark: { ...PAYLOAD.benchmark, resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: 'symbol is an ETF' } }
    const got = pairs(rows(fellBack))
    expect(got).toContainEqual(['benchmarkNote', 'symbol is an ETF'])
    expect(got[0]).toEqual(['benchmark', 'SPY'])
    expect(pairs(rows(PAYLOAD)).some(([k]) => k === 'benchmarkNote')).toBe(false)
  })

  it('a red-day high reads "red day"; a high today reads "today"; the words for both come from the row', () => {
    const red = { ...PAYLOAD, lastRsHigh: { ...PAYLOAD.lastRsHigh, redDay: true, beforePrice: false, barsAgo: 0 } }
    const got = pairs(rows(red))
    expect(got).toContainEqual(['rsHigh', 'today'])
    expect(got).toContainEqual(['redDay', 'red day'])
    expect(got.some(([k]) => k === 'beforePrice')).toBe(false)
    const one = { ...PAYLOAD, lastRsHigh: { ...PAYLOAD.lastRsHigh, barsAgo: 1 } }
    expect(pairs(rows(one))).toContainEqual(['rsHigh', '1 bar ago'])
  })

  it('no high yet, no rating yet, a full history, below the average: the honest subset', () => {
    const bare = {
      benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: null, bars: 852 },
      legend: { pctFromMa: -0.37, maSlope: -1, above: false },
      lastRsHigh: null,
      history: { bars: 852, requested: 852, short: false },
      inputs: PAYLOAD.inputs, intraday: false, state: 'ok',
    }
    const got = rows(bare, { benchmark: 'SPY', lookback: 126 })
    expect(pairs(got)).toEqual([
      ['benchmark', 'SPY'],
      ['benchmarkName', 'S&P 500 (SPY)'],
      ['rating', 'not yet rated'],            // the one declared fallback, muted below
      ['phase', 'below its average'],
      ['fromMa', '-0.4%'],
      ['requested', 'S&P 500 (SPY)'],
      ['lookback', '126'],
    ])
    expect(got.find((r) => r.key === 'rating')).toMatchObject({ value: null, muted: true })
    expect(got.filter((r) => r.muted)).toHaveLength(1)
  })

  it('a legend the server could not compute (no MA yet) prints neither a phase nor a distance — never "NaN"', () => {
    const noMa = { ...PAYLOAD, legend: { pctFromMa: null, maSlope: null, above: null } }
    const keys = rows(noMa).map((r) => r.key)
    expect(keys).not.toContain('phase')
    expect(keys).not.toContain('fromMa')
    expect(rows(noMa).map((r) => r.text).join(' ')).not.toMatch(/NaN|undefined|null/)
  })

  it('an intraday answer blanks the dots, and the rows that read them go with it', () => {
    // `_rs_line_provider` nulls the event columns intraday, so `lastRsHigh` is None.
    const intraday = { ...PAYLOAD, lastRsHigh: null, intraday: true, state: 'intraday' }
    const keys = rows(intraday).map((r) => r.key)
    for (const k of ['rsHigh', 'beforePrice', 'redDay']) expect(keys, k).not.toContain(k)
  })
})

describe('UCT RS · the chip rows and the pane label', () => {
  it('the chip carries the benchmark and the rating — the flagged rows — and never a muted fallback', () => {
    expect(readoutChipRows(RS_READOUT, rows(PAYLOAD)).map((r) => r.text)).toEqual(['XLK', '94'])
    const unrated = { ...PAYLOAD, rating: undefined }
    expect(readoutChipRows(RS_READOUT, rows(unrated)).map((r) => r.text)).toEqual(['XLK'])
  })

  it('a block that flags nothing feeds the first rows, and never more than MAX_CHIP_ROWS', () => {
    const unflagged = { ...RS_READOUT, readout: READOUT.map((e) => { const c = { ...e }; delete c.chip; return c }) }
    const got = readoutChipRows(unflagged, readoutRows(unflagged, PAYLOAD, { inputs: {} }))
    expect(got).toHaveLength(MAX_CHIP_ROWS)
    expect(MAX_CHIP_ROWS).toBe(3)
    expect(got.map((r) => r.key)).toEqual(['benchmark', 'benchmarkName', 'rating'])
  })

  it('⭐ end to end through the real `scalarsFor`: the pane reads `UCT Relative Strength · XLK · 94`', () => {
    clearServerColumns()
    const ctx = { sym: 'NVDA', tf: 'D' }
    const stored = { benchmark: 'SECTOR' }
    // what `computeFor` keyed the fetch with: the RESOLVED inputs, server keys only
    primeServerColumns('rsLine', ctx.sym, ctx.tf, pickServerInputs(RS, resolveInputs(RS, stored)),
      { columns: { rsLine: [0.2477] }, times: [20261105], rev: RS.compute.rev, payload: { ...PAYLOAD } })
    const registry = {
      getDefinition: (id) => (id === 'rsLine' ? RS_READOUT : engineRegistry.getDefinition(id)),
      listDefinitions: () => engineRegistry.listDefinitions(),
    }
    const scalarsOf = (def, inputs) => scalarsFor(def, inputs, ctx)
    const b = { instanceId: 'inst:rsLine:1', defId: 'rsLine', plotKey: 'rsLine', series: { __id: 'rs' }, lastValue: 0.2477 }
    const inst = { instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs: stored, hidden: false }
    const chip = legendChips([b], null, registry, [inst], { scalarsOf })[0]
    expect(chip.text, 'the strip says what was asked for').toBe('UCT RS(SECTOR) 0.2477')
    expect(chip.suffix).toBe(' · XLK · 94')
    expect(paneReadoutLabel(chip, RS_READOUT, null)).toBe(`${RS.meta.name} · XLK · 94`)
    expect(chip.readout).toHaveLength(12)
    // the control: an instance on ANOTHER benchmark has no landed envelope, so
    // it prints the requested one and no rows — the lookup really is keyed
    const other = legendChips([b], null, registry, [{ ...inst, inputs: { benchmark: 'QQQ' } }], { scalarsOf })[0]
    expect(other.suffix).toBe(' · QQQ')
    expect(other.readout).toEqual([])
    clearServerColumns()
  })
})

describe('the formats, on RS-shaped values', () => {
  beforeEach(() => clearServerColumns())

  it('ratio · pct · int · barsAgo · text · bool', () => {
    expect(READOUT_FORMATS).toEqual(['ratio', 'pct', 'int', 'barsAgo', 'text', 'bool'])
    expect(formatReadoutValue('ratio', 0.2477)).toBe('0.2477')
    expect(formatReadoutValue('ratio', 1.02345)).toBe('1.023')
    expect(formatReadoutValue('ratio', 12.3456)).toBe('12.35')
    expect(formatReadoutValue('ratio', 1)).toBe('1')
    expect(formatReadoutValue('pct', 1.8421)).toBe('+1.8%')
    expect(formatReadoutValue('pct', -2.5)).toBe('-2.5%')
    expect(formatReadoutValue('pct', 0)).toBe('0.0%')
    expect(formatReadoutValue('pct', -0.04), 'never "-0.0%"').toBe('0.0%')
    expect(formatReadoutValue('int', 3600)).toBe('3,600')
    expect(formatReadoutValue('int', 94.4)).toBe('94')
    expect(formatReadoutValue('int', -1234567)).toBe('-1,234,567')
    expect(formatReadoutValue('barsAgo', 0)).toBe('today')
    expect(formatReadoutValue('barsAgo', 1)).toBe('1 bar ago')
    expect(formatReadoutValue('barsAgo', 3)).toBe('3 bars ago')
    expect(formatReadoutValue('text', ' S&P 500 (SPY) ')).toBe('S&P 500 (SPY)')
    expect(formatReadoutValue('text', 252)).toBe('252')
    expect(formatReadoutValue('bool', true)).toBe('yes')
    expect(formatReadoutValue('bool', false)).toBe('no')
    expect(formatReadoutValue('bool', true, { words: ['above', 'below'] })).toBe('above')
  })

  it('⛔ fail closed: anything a format cannot honestly print is null, so the row is omitted', () => {
    for (const f of ['ratio', 'pct', 'int', 'barsAgo']) {
      for (const bad of [NaN, Infinity, -Infinity, null, undefined, '94', true, {}, []]) {
        expect(formatReadoutValue(f, bad), `${f}(${String(bad)})`).toBe(null)
      }
    }
    expect(formatReadoutValue('barsAgo', -1)).toBe(null)
    expect(formatReadoutValue('barsAgo', 2.5)).toBe(null)
    expect(formatReadoutValue('text', '')).toBe(null)
    expect(formatReadoutValue('text', '   ')).toBe(null)
    expect(formatReadoutValue('text', true)).toBe(null)
    expect(formatReadoutValue('text', null)).toBe(null)
    expect(formatReadoutValue('bool', 1)).toBe(null)
    expect(formatReadoutValue('bool', 'true')).toBe(null)
    expect(formatReadoutValue('bool', false, { words: ['red day', ''] }), 'an empty word omits the row').toBe(null)
    expect(formatReadoutValue('money', 5)).toBe(null)
    expect(formatReadoutValue(undefined, 5)).toBe(null)
  })

  it('the source grammar: scalar: and payload: are one path, input: is one key, anything else is not a source', () => {
    expect(parseReadoutSource('scalar:benchmark.resolved')).toEqual({ kind: 'scalar', path: ['benchmark', 'resolved'] })
    expect(parseReadoutSource('payload:benchmark.resolved')).toEqual({ kind: 'scalar', path: ['benchmark', 'resolved'] })
    expect(parseReadoutSource('input:benchmark')).toEqual({ kind: 'input', path: ['benchmark'] })
    for (const bad of ['column:rsLine', 'scalar:', 'scalar:a..b', 'scalar:a.', 'benchmark', '', null, 7, 'scalar:a-b'])
      expect(parseReadoutSource(bad), String(bad)).toBe(null)
  })

  it('⛔ `readoutRows` never throws and answers [] to junk', () => {
    expect(readoutRows(null, PAYLOAD, {})).toEqual([])
    expect(readoutRows({}, PAYLOAD, {})).toEqual([])
    expect(readoutRows({ readout: 'benchmark' }, PAYLOAD, {})).toEqual([])
    expect(readoutRows(RS_READOUT, PAYLOAD, null)).toHaveLength(12)      // a missing ctx is "no stored inputs"
    // with no scalars only the input rows and the declared fallback can print
    expect(pairs(rows(null))).toEqual([['rating', 'not yet rated'], ['requested', 'Sector (auto)'], ['lookback', '252']])
    expect(pairs(rows([1, 2]))).toEqual(pairs(rows(null)))
    expect(pairs(rows('junk'))).toEqual(pairs(rows(null)))
    // junk ENTRIES are skipped, never fatal, and never printed
    const junk = { ...RS_READOUT, readout: [null, 7, 'x', { key: 'a' }, { key: 'b', label: 'B', source: 'scalar:', format: 'text' },
      { key: 'c', label: 'C', source: 'scalar:legend.above', format: 'hologram' },
      { key: 'd', label: 'D', source: 'scalar:legend.above', format: 'bool', when: 'nonsense' },
      { key: 'ok', label: 'OK', source: 'scalar:legend.above', format: 'bool' }] }
    expect(pairs(readoutRows(junk, PAYLOAD, {}))).toEqual([['ok', 'yes']])
    // a prototype key is not a scalar
    expect(pairs(readoutRows({ ...RS_READOUT, readout: [{ key: 'p', label: 'P', source: 'scalar:constructor.name', format: 'text' }] }, {}, {})))
      .toEqual([])
  })
})
