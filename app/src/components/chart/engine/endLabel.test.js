// app/src/components/chart/engine/endLabel.test.js
//
// ─── UCT RS split, U2 · the line-end label, the pure half ───────────────────
//
// `plots[].endLabel` is a GENERIC engine field; the RS definition is its first
// declarer (`RS 96` at the end of the RS line). Pinned here, with no DOM:
//   1. the text: a scalar source through the readout resolver, the `value`
//      source, prefix / suffix, the three formats and their defaults, the gates;
//      fail-closed on every missing or malformed input;
//   2. the chip model `readout.stampReadout` stamps (`{text}` or `{fromValue, spec}`);
//   3. the last finite point of a series' data, scanning from the end;
//   4. the geometry: right-aligned to the point, centred, kept in the pane, hidden
//      when the point is off the plot or the tag does not fit;
//   5. the RS definition declares it on the RS line and it resolves end to end
//      through `legendChips` on a daily chart (and keeps quiet with Rating off).
import { describe, it, expect } from 'vitest'
import {
  END_LABEL_FIELDS, END_LABEL_FORMATS, END_LABEL_GAP_PX, END_LABEL_AFFIX_MAX,
  parseEndLabelSource, endLabelText, endLabelChipModel, lastFinitePoint, endLabelPlacement, validateEndLabel,
} from './endLabel'
import { getDefinition, resolveInputs } from './nativeRegistry'
import { legendChips } from './readout'

const RS = getDefinition('rsLine')
const SCALARS = { rating: { ibd: 96, fast: 91, asof: '2026-11-06', m1: 91 } }
const DEF = { id: 'probe', inputs: [{ key: 'showRating', type: 'bool', default: true }] }

describe('the source grammar', () => {
  it('reads `value`, `scalar:` and `payload:` paths; refuses an input or garbage', () => {
    expect(parseEndLabelSource('value')).toEqual({ kind: 'value' })
    expect(parseEndLabelSource('scalar:rating.ibd')).toMatchObject({ kind: 'scalar', path: ['rating', 'ibd'] })
    expect(parseEndLabelSource('payload:rating.ibd')).toMatchObject({ kind: 'scalar' })
    for (const bad of ['input:showRating', 'rating.ibd', 'Value', '', null, 3, {}]) {
      expect(parseEndLabelSource(bad), String(bad)).toBeNull()
    }
  })
})

describe('the text', () => {
  const spec = { source: 'scalar:rating.ibd', prefix: 'RS ' }

  it('a scalar source prints prefix + value (`RS 96`); a whole number formats as int by default', () => {
    expect(endLabelText(spec, { scalars: SCALARS, def: DEF, inputs: {} })).toBe('RS 96')
    expect(endLabelText({ source: 'scalar:rating.ibd', suffix: '%' }, { scalars: SCALARS })).toBe('96%')
    expect(endLabelText({ source: 'scalar:rating.ibd' }, { scalars: SCALARS })).toBe('96')
  })

  it('the `value` source prints the plot\'s own value; a non-integer defaults to the ratio format', () => {
    expect(endLabelText({ source: 'value' }, { value: 0.24771 })).toBe('0.2477')
    expect(endLabelText({ source: 'value', format: 'int' }, { value: 1234.6 })).toBe('1,235')
    expect(endLabelText({ source: 'value', format: 'text', prefix: 'x ' }, { value: 7 })).toBe('x 7')
    expect(endLabelText({ source: 'scalar:rating.asof', format: 'text' }, { scalars: SCALARS })).toBe('2026-11-06')
  })

  it('⛔ fails closed: no payload, a key the payload does not carry, null, NaN, an empty string, a bad spec', () => {
    expect(endLabelText(spec, { scalars: null })).toBeNull()
    expect(endLabelText(spec, {})).toBeNull()
    expect(endLabelText({ source: 'scalar:rating.nope' }, { scalars: SCALARS })).toBeNull()
    expect(endLabelText({ source: 'scalar:rating.ibd' }, { scalars: { rating: { ibd: null } } })).toBeNull()
    expect(endLabelText({ source: 'value' }, { value: NaN })).toBeNull()
    expect(endLabelText({ source: 'value' }, { value: Infinity })).toBeNull()
    expect(endLabelText({ source: 'value' }, { value: undefined })).toBeNull()
    expect(endLabelText({ source: 'scalar:rating.asof', format: 'text' }, { scalars: { rating: { asof: '   ' } } })).toBeNull()
    expect(endLabelText({ source: 'input:showRating' }, { scalars: SCALARS, def: DEF })).toBeNull()
    expect(endLabelText(null, { scalars: SCALARS })).toBeNull()
    expect(endLabelText('scalar:rating.ibd', { scalars: SCALARS })).toBeNull()
    // a text format on a number still prints; a ratio format on a string does not
    expect(endLabelText({ source: 'scalar:rating.asof', format: 'ratio' }, { scalars: SCALARS })).toBeNull()
  })

  it('gates: every `when` must hold (an input gate reads the declared default under the stored value)', () => {
    const gated = { ...spec, when: ['input:showRating', 'scalar:rating.asof'] }
    expect(endLabelText(gated, { scalars: SCALARS, def: DEF, inputs: {} })).toBe('RS 96')
    expect(endLabelText(gated, { scalars: SCALARS, def: DEF, inputs: { showRating: false } })).toBeNull()
    expect(endLabelText(gated, { scalars: { rating: { ibd: 96 } }, def: DEF, inputs: {} })).toBeNull()
    expect(endLabelText({ ...spec, when: 'input:showRating' }, { scalars: SCALARS, def: DEF, inputs: {} })).toBe('RS 96')
    // a gate that does not parse is closed
    expect(endLabelText({ ...spec, when: ['nonsense'] }, { scalars: SCALARS, def: DEF, inputs: {} })).toBeNull()
  })
})

describe('the chip model (what `readout.stampReadout` stamps)', () => {
  it('a scalar source resolves to {text}, or nothing', () => {
    expect(endLabelChipModel({ source: 'scalar:rating.ibd', prefix: 'RS ' }, SCALARS, DEF, {})).toEqual({ text: 'RS 96' })
    expect(endLabelChipModel({ source: 'scalar:rating.ibd' }, {}, DEF, {})).toBeNull()
    expect(endLabelChipModel({ source: 'scalar:rating.ibd', when: 'input:showRating' }, SCALARS, DEF, { showRating: false })).toBeNull()
  })

  it('a `value` source defers the number to the series ({fromValue, spec}) but answers its gates now', () => {
    const spec = { source: 'value', when: 'input:showRating' }
    expect(endLabelChipModel(spec, SCALARS, DEF, {})).toEqual({ fromValue: true, spec })
    expect(endLabelChipModel(spec, null, DEF, {})).toEqual({ fromValue: true, spec })
    expect(endLabelChipModel(spec, SCALARS, DEF, { showRating: false })).toBeNull()
    expect(endLabelChipModel({ source: 'input:x' }, SCALARS, DEF, {})).toBeNull()
    expect(endLabelChipModel(null, SCALARS, DEF, {})).toBeNull()
  })
})

describe('the last finite point', () => {
  it('scans from the end past whitespace rows and non-finite values', () => {
    const pts = [
      { time: 1, value: 0.2 }, { time: 2, value: 0.25 }, { time: 3 }, { time: 4, value: NaN }, { time: 5, value: null },
    ]
    expect(lastFinitePoint(pts)).toEqual({ index: 1, time: 2, value: 0.25 })
    expect(lastFinitePoint([{ time: '2026-11-06', value: 1.5 }])).toEqual({ index: 0, time: '2026-11-06', value: 1.5 })
  })

  it('⛔ nothing finite, nothing at all, or not an array → null', () => {
    expect(lastFinitePoint([{ time: 1 }, { time: 2, value: NaN }])).toBeNull()
    expect(lastFinitePoint([])).toBeNull()
    expect(lastFinitePoint(null)).toBeNull()
    expect(lastFinitePoint('abc')).toBeNull()
  })
})

describe('the geometry', () => {
  const box = { plotLeft: 0, plotWidth: 800, paneTop: 100, paneHeight: 300, width: 40, height: 16 }

  it('right-aligned to the point, `END_LABEL_GAP_PX` left of it, centred on it, in container px', () => {
    expect(END_LABEL_GAP_PX).toBe(4)
    expect(endLabelPlacement({ ...box, x: 700, y: 150 })).toEqual({ hidden: false, left: 700 - 4 - 40, top: 100 + 150 - 8 })
    // a left price scale shifts the plot right by its width
    expect(endLabelPlacement({ ...box, plotLeft: 60, x: 700, y: 150 })).toEqual({ hidden: false, left: 60 + 700 - 44, top: 242 })
  })

  it('kept inside its pane: clamped at the pane\'s top and bottom', () => {
    expect(endLabelPlacement({ ...box, x: 700, y: 3 }).top).toBe(100)
    expect(endLabelPlacement({ ...box, x: 700, y: 298 }).top).toBe(100 + 300 - 16)
  })

  it('⛔ hidden while the point is off the plot (scrolled or zoomed away) or outside its pane', () => {
    expect(endLabelPlacement({ ...box, x: -1, y: 150 })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 801, y: 150 })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 700, y: -1 })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 700, y: 301 })).toEqual({ hidden: true })
  })

  it('⛔ hidden when the tag would not fit between the plot\'s left edge and the point (never slid to another bar)', () => {
    expect(endLabelPlacement({ ...box, x: 43, y: 150 })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 44, y: 150 })).toEqual({ hidden: false, left: 0, top: 242 })
  })

  it('⛔ hidden on any non-finite or empty measurement (an unmeasured box in jsdom, a disposed chart)', () => {
    expect(endLabelPlacement({ ...box, x: null, y: 150 })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 700, y: undefined })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 700, y: 150, width: 0 })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 700, y: 150, plotWidth: 0 })).toEqual({ hidden: true })
    expect(endLabelPlacement({ ...box, x: 700, y: 150, paneHeight: NaN })).toEqual({ hidden: true })
  })
})

describe('the schema half', () => {
  const errs = (spec, keys = ['showRating']) => { const e = []; validateEndLabel(spec, 'plots[0].endLabel', keys, e); return e }

  it('the closed field and format sets', () => {
    expect(END_LABEL_FIELDS).toEqual(['source', 'prefix', 'suffix', 'format', 'when'])
    expect(END_LABEL_FORMATS).toEqual(['int', 'text', 'ratio'])
    expect(END_LABEL_AFFIX_MAX).toBe(8)
  })

  it('accepts the RS spelling and every optional field', () => {
    expect(errs({ source: 'scalar:rating.ibd', prefix: 'RS ', when: ['input:showRating'] })).toEqual([])
    expect(errs({ source: 'value', suffix: '%', format: 'ratio', when: 'scalar:rating.asof' })).toEqual([])
  })

  it('refuses, by name: an unknown field, a bad source, a long affix, a bad format, an undeclared gate input, an empty gate list', () => {
    expect(errs({ source: 'value', colour: 'red' }).join(' | ')).toMatch(/endLabel\.colour: unknown end label field/)
    expect(errs({ source: 'input:showRating' }).join(' | ')).toMatch(/endLabel\.source: expected 'value'/)
    expect(errs({}).join(' | ')).toMatch(/endLabel\.source/)
    expect(errs({ source: 'value', prefix: 'Relative Strength ' }).join(' | ')).toMatch(/endLabel\.prefix: expected a string of at most 8/)
    expect(errs({ source: 'value', suffix: 3 }).join(' | ')).toMatch(/endLabel\.suffix/)
    expect(errs({ source: 'value', format: 'pct' }).join(' | ')).toMatch(/endLabel\.format: expected one of int, text, ratio/)
    expect(errs({ source: 'value', when: ['input:nope'] }).join(' | ')).toMatch(/endLabel\.when\[0\]: "input:nope" names no declared input/)
    expect(errs({ source: 'value', when: [] }).join(' | ')).toMatch(/endLabel\.when: an empty list/)
    expect(errs({ source: 'value', when: ['???'] }).join(' | ')).toMatch(/endLabel\.when\[0\]: expected a readout source/)
    expect(errs('scalar:rating.ibd').join(' | ')).toMatch(/endLabel: expected an object/)
  })
})

describe('the RS definition declares it, and it resolves end to end', () => {
  it('on the `rsLine` plot only: `RS ` + rating.ibd, gated on the RS Rating switch', () => {
    const declared = RS.plots.filter((p) => p.endLabel)
    expect(declared.map((p) => p.key)).toEqual(['rsLine'])
    expect(declared[0].endLabel).toEqual({ source: 'scalar:rating.ibd', prefix: 'RS ', when: ['input:showRating'] })
  })

  it('through `legendChips`: the RS line chip carries {text: "RS 96"}; no payload or Rating off, no field at all', () => {
    const inst = { instanceId: 'rs-1', defId: 'rsLine', inputs: {}, hidden: false }
    const chipsWith = (scalars, inputs = {}) => legendChips([], null, { getDefinition }, [{ ...inst, inputs }], {
      scalarsOf: () => scalars,
    })
    const line = (chips) => chips.find((c) => c.plotKey === 'rsLine')
    expect(line(chipsWith(SCALARS)).endLabel).toEqual({ text: 'RS 96' })
    expect(line(chipsWith(null))).not.toHaveProperty('endLabel')
    expect(line(chipsWith({ rating: { ibd: null } }))).not.toHaveProperty('endLabel')
    expect(line(chipsWith(SCALARS, { showRating: false }))).not.toHaveProperty('endLabel')
    // a HIDDEN instance's chip still carries the model (the pane suffix and the table
    // ride a hidden chip too: "a hidden RS pane still says which benchmark it is");
    // the surface is what skips hidden chips (`StockChart.priceHostChips`)
    const hidden = legendChips([], null, { getDefinition }, [{ ...inst, hidden: true }], { scalarsOf: () => SCALARS })
    expect(hidden.find((c) => c.plotKey === 'rsLine')).toMatchObject({ hidden: true, endLabel: { text: 'RS 96' } })
    // the resolved inputs are the compute's: a stored legacy spelling reads as today's
    expect(resolveInputs(RS, {}).showRating).toBe(true)
  })
})
