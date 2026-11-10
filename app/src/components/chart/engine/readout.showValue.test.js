// app/src/components/chart/engine/readout.showValue.test.js
//
// ─── UCT RS split, F3 (2026-11-10) · `plots[].legend.showValue: false` ─────────
//
// Real screen (sandbox, desktop dark): the slim RS line's pane label read
// `UCT RS · SPY · 82  0.4378`. The ratio means nothing to a member; the rating
// beside it is the number. The grammar gained one field: a plot whose legend
// declares `showValue: false` keeps its chip (the name, the chip rows' suffix,
// the line-end tag, the readout menu) and prints NO number, on every surface
// that reads `chipValueText` (the strip's chip, the pane row, the popover
// header, the phone text chip), and no dated last value either. Everything
// else is byte-identical: a plot without the field reads as before.
import { describe, it, expect } from 'vitest'
import {
  chipsFrom, chipValueText, legendHidesValue, readoutFallbackValue, readoutChipName, declaresReadout,
} from './readout'
import { readoutChipRows, readoutRows } from './readoutSchema'
import { validateDefinition } from './defSchema'
import { getDefinition, RS_LINE_SLIM_RAW, RS_LINE_V5_RAW, SERVER_DEFS } from './nativeRegistry'

const FIX = Object.freeze({
  schemaVersion: 1, id: 'u_quiet', version: 1, compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Quiet Line', shortName: 'QL', category: 'Momentum', repaint: 'non-repainting', legendParams: [] },
  placement: { target: 'pane' },
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 }],
  plots: [
    { key: 'quiet', label: 'Quiet', style: 'line', color: '#4ea1ff', width: 1, legend: { decimals: 4, showValue: false } },
    { key: 'loud', label: 'Loud', style: 'line', color: '#ff0000', width: 1, legend: { decimals: 4 } },
  ],
  readout: [
    { key: 'benchmarkName', label: 'Benchmark', source: 'scalar:benchmark.label', format: 'text', note: 'scalar:benchmark.note' },
    { key: 'rating', label: 'Rating', source: 'scalar:rating.ibd', format: 'int', chip: true },
  ],
})
const registry = (id) => (id === FIX.id ? FIX : null)
const entry = (plotKey) => ({ defId: FIX.id, plotKey, series: { __id: plotKey }, instanceId: `q:${plotKey}` })
const seriesData = (pairs) => new Map(pairs.map(([e, v]) => [e.series, { value: v }]))
const SCALARS = { rating: { ibd: 82 }, benchmark: { label: 'S&P 500 (SPY)' } }

describe('the grammar: `legend.showValue: false` keeps the chip and withholds the number', () => {
  it('the schema admits a boolean and refuses anything else', () => {
    expect(validateDefinition(FIX).ok).toBe(true)
    const bad = validateDefinition({ ...FIX, plots: [{ ...FIX.plots[0], legend: { showValue: 'no' } }] })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toMatch(/plots\[0\]\.legend\.showValue: expected true or false/)
  })

  it('the chip: its label alone as text, `valueHidden` stamped, the VALUE kept, every formatter silent', () => {
    const q = entry('quiet'), l = entry('loud')
    const chips = chipsFrom([q, l], seriesData([[q, 0.4378], [l, 1.2345]]), registry, () => ({}))
    expect(chips).toHaveLength(2)
    const [quiet, loud] = chips
    expect(quiet.valueHidden).toBe(true)
    expect(quiet.value).toBe(0.4378)
    expect(quiet.text).toBe(quiet.label)
    expect(quiet.text).not.toMatch(/\d/)
    expect(chipValueText(quiet)).toBe('')
    // a resolved text (the volume strip's copy) does not bring the number back
    expect(chipValueText({ ...quiet, valueText: '0.4378' })).toBe('')
    // the sibling of it reads exactly as every chip always has
    expect(loud.valueHidden).toBeUndefined()
    expect(loud.text).toBe(`${loud.label} 1.2345`)
    expect(chipValueText(loud)).toBe('1.2345')
  })

  it('the chip rows still ride the pane suffix: `QL · 82`, with no number after it', () => {
    const q = entry('quiet')
    const chips = chipsFrom([q], seriesData([[q, 0.4378]]), registry, () => ({}), undefined, undefined,
      { scalarsOf: () => SCALARS })
    expect(chips[0].suffix).toBe(' · 82')
    expect(readoutChipName(chips[0], FIX)).toBe('QL · 82')
    expect(declaresReadout(FIX)).toBe(true)
  })

  it('`chip: false` names the chip rows (none); a readout that writes no `chip` keeps the first-rows rule', () => {
    const rows = [{ key: 'a', text: 'first' }, { key: 'b', text: 'second' }, { key: 'c', text: 'third' }, { key: 'd', text: 'fourth' }]
    const unnamed = { readout: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }] }
    expect(readoutChipRows(unnamed, rows).map((r) => r.key)).toEqual(['a', 'b', 'c'])
    const named = { readout: [{ key: 'a', chip: false }, { key: 'b' }, { key: 'c' }, { key: 'd' }] }
    expect(readoutChipRows(named, rows)).toEqual([])
    const mixed = { readout: [{ key: 'a', chip: false }, { key: 'b', chip: true }, { key: 'c' }] }
    expect(readoutChipRows(mixed, rows).map((r) => r.key)).toEqual(['b'])
    expect(validateDefinition({ ...FIX, readout: [{ ...FIX.readout[1], chip: false }] }).ok).toBe(true)
  })

  it('legendHidesValue names the plot', () => {
    expect(legendHidesValue(FIX, 'quiet')).toBe(true)
    expect(legendHidesValue(FIX, 'loud')).toBe(false)
    expect(legendHidesValue(FIX, 'nope')).toBe(false)
    expect(legendHidesValue(null, 'quiet')).toBe(false)
  })

  it('the dated last value is withheld too (null, never a dash); the server\'s note still prints', () => {
    const payload = { legend: { lastValue: 0.47, asOf: 20261106 } }
    expect(readoutFallbackValue(FIX, payload, 4, {}, { plotKey: 'quiet' })).toBeNull()
    expect(readoutFallbackValue(FIX, null, 4, {}, { plotKey: 'quiet' })).toBeNull()
    // the sibling plot, and a call without the plot, keep A8 byte for byte
    expect(readoutFallbackValue(FIX, payload, 4, {}, { plotKey: 'loud' })).toEqual({ text: '0.4700 · Nov 6', muted: true })
    expect(readoutFallbackValue(FIX, payload, 4, {})).toEqual({ text: '0.4700 · Nov 6', muted: true })
    expect(readoutFallbackValue(FIX, null, 4, {}, { plotKey: 'loud' })).toEqual({ text: '—', muted: true })
    // 3-14: an empty pane still says why
    const noted = { legend: {}, benchmark: { label: 'XYZQ', note: 'No XYZQ bars yet; they usually load within a minute' } }
    expect(readoutFallbackValue(FIX, noted, 4, {}, { plotKey: 'quiet' }))
      .toEqual({ text: 'No XYZQ bars yet; they usually load within a minute', muted: true, note: true })
  })
})

describe('the shipped definitions', () => {
  const plotOf = (def, key) => def.plots.find((p) => p.key === key)

  it('the slim RS line withholds its ratio; v5 and the three new panes print their numbers', () => {
    expect(plotOf(RS_LINE_SLIM_RAW, 'rsLine').legend).toEqual({ decimals: 4, showValue: false })
    expect(validateDefinition(RS_LINE_SLIM_RAW).ok).toBe(true)
    expect(plotOf(RS_LINE_V5_RAW, 'rsLine').legend.showValue).toBeUndefined()
    for (const def of SERVER_DEFS) {
      if (def.id === 'rsLine') continue
      for (const p of def.plots) expect(p.legend && p.legend.showValue, `${def.id}.${p.key}`).toBeUndefined()
    }
  })

  it('UCT RS Rating declares no chip number: the pane label is `UCT RS Rating  <rating>`, the fallback leads with it', () => {
    const def = getDefinition('rsRating')
    expect(def.readout.filter((r) => r.chip === true)).toEqual([])
    expect(def.readout.find((r) => r.key === 'rating').chip).toBe(false)
    expect(readoutChipName({ label: 'x', suffix: '' }, def)).toBe('UCT RS Rating')
    const summary = '82, up 2 in 20 sessions · as of Nov 6'
    const scalars = { ratingHistory: { summary, value: 82, average: 79.4, change20: 2, sessions: 187, asof: '2026-11-06' } }
    expect(readoutFallbackValue(def, scalars, 0, {}, { plotKey: 'ratingLine' })).toEqual({ text: summary, muted: false })
    // and no row rides the suffix: `chip: false` names the chip rows (none), so the
    // first-rows rule never promotes the summary sentence into the pane label
    const rows = readoutRows(def, scalars, { inputs: {} })
    expect(rows.length).toBeGreaterThan(2)
    expect(readoutChipRows(def, rows)).toEqual([])
    // the three panes read alike: `<name> · <benchmark>  <value>`, one number each
    for (const id of ['rsPhases', 'rsVsEma']) {
      const d = getDefinition(id)
      expect(d.readout.filter((r) => r.chip).map((r) => r.key), id).toEqual(['benchmark'])
    }
  })
})
