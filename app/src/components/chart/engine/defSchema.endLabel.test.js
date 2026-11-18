// app/src/components/chart/engine/defSchema.endLabel.test.js
//
// ─── UCT RS split, U2 · `plots[].endLabel` in the schema ────────────────────
//
// Accept and refuse PAIRS through `validateDefinition`, so the hook in
// `validatePlot` is what is pinned (the validator's own cases are in
// `endLabel.test.js`): the field survives onto the registered definition, a
// gate must name a DECLARED input of this definition, and every refusal carries
// the plot path.
import { describe, it, expect } from 'vitest'
import { validateDefinition } from './defSchema'
import { getDefinition } from './nativeRegistry'

const def = (endLabel, patch = {}) => ({
  schemaVersion: 1, id: 'probeEnd', version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Probe', shortName: 'P', category: 'Momentum', repaint: 'non-repainting' },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [
    { key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
    { key: 'showTag', type: 'bool', label: 'Tag', default: true },
  ],
  plots: [{ key: 'rsi', label: 'RSI', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 },
    ...(endLabel === undefined ? {} : { endLabel }) }],
  events: [],
  ...patch,
})
const ok = (d) => { const r = validateDefinition(d); expect(r.ok, JSON.stringify(r.errors)).toBe(true); return r.def }
const refused = (d, re) => {
  const r = validateDefinition(d)
  expect(r.ok, 'expected a refusal').toBe(false)
  expect(r.errors.join(' | ')).toMatch(re)
}

describe('plots[].endLabel through validateDefinition', () => {
  it('absent: byte-identical plots, no field invented', () => {
    expect(ok(def(undefined)).plots[0]).not.toHaveProperty('endLabel')
  })

  it('accepts the three sources and keeps the field on the registered definition', () => {
    expect(ok(def({ source: 'value' })).plots[0].endLabel).toEqual({ source: 'value' })
    expect(ok(def({ source: 'scalar:rating.ibd', prefix: 'RS ', when: ['input:showTag'] })).plots[0].endLabel)
      .toEqual({ source: 'scalar:rating.ibd', prefix: 'RS ', when: ['input:showTag'] })
    expect(ok(def({ source: 'payload:x.y', suffix: '%', format: 'ratio' })).plots[0].endLabel.format).toBe('ratio')
  })

  it('refuses at the plot path: a non-object, a bad source, an unknown field, a bad format', () => {
    refused(def(true), /plots\[0\]\.endLabel: expected an object/)
    refused(def({ source: 'input:showTag' }), /plots\[0\]\.endLabel\.source: expected 'value'/)
    refused(def({ source: 'value', colour: 'red' }), /plots\[0\]\.endLabel\.colour: unknown end label field/)
    refused(def({ source: 'value', format: 'pct' }), /plots\[0\]\.endLabel\.format: expected one of int, text, ratio/)
    refused(def({ source: 'value', prefix: 'Relative Strength ' }), /plots\[0\]\.endLabel\.prefix: expected a string of at most 8/)
  })

  it('a `when` input gate must name an input THIS definition declares', () => {
    ok(def({ source: 'value', when: 'input:showTag' }))
    refused(def({ source: 'value', when: ['input:showRating'] }), /plots\[0\]\.endLabel\.when\[0\]: "input:showRating" names no declared input/)
  })

  it('is exhaustive with the other plot faults: one pass reports both', () => {
    const r = validateDefinition(def({ source: 'nope' }, { plots: [{ key: 'rsi', label: 'RSI', style: 'line', color: 'token:info', width: 1, hidden: 'yes', endLabel: { source: 'nope' } }] }))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' | ')).toMatch(/plots\[0\]\.hidden/)
    expect(r.errors.join(' | ')).toMatch(/plots\[0\]\.endLabel\.source/)
  })

  it('the shipped RS definition validates with its end label on the `rsLine` plot', () => {
    const RS = getDefinition('rsLine')
    const r = validateDefinition(RS)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.def.plots.find((p) => p.key === 'rsLine').endLabel).toEqual({ source: 'scalar:rating.ibd', prefix: 'RS ', when: ['input:showRating'] })
  })
})
