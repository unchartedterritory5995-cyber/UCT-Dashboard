// UCT RS Phase 3, unit 3-09b — `identityFor` in the schema.
//
// A `string` input that names one option of an enum identity input: the typed
// text replaces the option's raw code wherever the enum prints as identity
// (`readout.legendIdentityParts`). Accept and refuse PAIRS, so a validator that
// refused everything (or nothing) fails here.
import { describe, it, expect } from 'vitest'
import { validateDefinition } from './defSchema'
import * as engineRegistry from './nativeRegistry'

const BENCH = { key: 'benchmark', type: 'enum', default: 'SPY',
  options: [['SPY', 'S&P 500'], ['CUSTOM', 'Your symbol']] }
const BOX = { key: 'customBenchmark', type: 'string', default: '',
  activeWhen: { key: 'benchmark', equals: 'CUSTOM' }, identityFor: 'benchmark' }

const def = ({ inputs, legendParams = ['benchmark'] } = {}) => ({
  schemaVersion: 1, id: 'probeIdentity', version: 1,
  compute: { kind: 'native', fn: 'sma', rev: 1 },
  meta: { name: 'Probe', shortName: 'P', category: 'Momentum', legendParams },
  placement: { target: 'pane' },
  inputs: inputs || [BENCH, BOX, { key: 'length', type: 'int', default: 14, min: 2, max: 200 }],
  plots: [{ key: 'line', label: 'Line', style: 'line', color: 'token:info', width: 1 }],
  events: [],
})

const ok = (d) => {
  const r = validateDefinition(d)
  expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  return r.def
}
const refused = (d, re) => {
  const r = validateDefinition(d)
  expect(r.ok).toBe(false)
  expect(r.errors.join('\n')).toMatch(re)
}
const withBox = (patch) => def({ inputs: [BENCH, { ...BOX, ...patch }] })

describe('identityFor — the declared pair is accepted', () => {
  it('a string box, an enum in legendParams, activeWhen on one labelled option', () => {
    const d = ok(def())
    expect(d.inputs[1].identityFor).toBe('benchmark')
  })

  it('the object option form is read the same way', () => {
    ok(def({ inputs: [{ ...BENCH, options: ['SPY', { value: 'CUSTOM', label: 'Your symbol' }] }, BOX] }))
  })

  it('the registered rsLine declares it and validates', () => {
    const rs = engineRegistry.getDefinition('rsLine')
    const box = rs.inputs.find((i) => i.key === 'customBenchmark')
    expect(box.identityFor).toBe('benchmark')
    ok(rs)
  })
})

describe('identityFor — fail closed', () => {
  it('not a non-empty string', () => {
    refused(withBox({ identityFor: '' }), /identityFor: expected the key of the enum input/)
    refused(withBox({ identityFor: true }), /identityFor: expected the key of the enum input/)
  })
  it('only on a string or enum input', () => {
    refused(def({ inputs: [BENCH, { key: 'n', type: 'int', default: 1, activeWhen: BOX.activeWhen, identityFor: 'benchmark' }] }),
      /only a "string" or "enum" input stands in for an option/)
    refused(def({ inputs: [BENCH, { key: 'b', type: 'bool', default: true, activeWhen: BOX.activeWhen, identityFor: 'benchmark' }] }),
      /only a "string" or "enum" input stands in for an option/)
  })
  it('never on a legacy input', () => {
    refused(withBox({ legacy: true }), /a legacy input is never rendered/)
  })
  it('names a declared input, not itself', () => {
    refused(withBox({ identityFor: 'nope' }), /"nope" names no declared input/)
    refused(withBox({ identityFor: 'customBenchmark' }), /is the input itself/)
  })
  it('names an enum', () => {
    refused(def({ inputs: [BENCH, { key: 'tag', type: 'string', default: '' },
      { ...BOX, identityFor: 'tag' }], legendParams: ['tag'] }),
    /only an enum's option has a name/)
  })
  it('the enum must be a legendParams entry, or the field reads nothing', () => {
    refused(def({ legendParams: [] }), /is not a meta.legendParams entry/)
  })
  it('activeWhen must name the enum and the option', () => {
    refused(withBox({ activeWhen: undefined }), /must declare activeWhen \{key: "benchmark", equals: <option>\}/)
    refused(withBox({ activeWhen: { key: 'benchmark', notEquals: 'SPY' } }), /must declare activeWhen/)
  })
  it('the option needs a label (the empty-box text)', () => {
    refused(def({ inputs: [{ ...BENCH, options: ['SPY', 'CUSTOM'] }, BOX] }), /carries no label/)
  })
  it('one companion per option', () => {
    refused(def({ inputs: [BENCH, BOX, { ...BOX, key: 'customBenchmark2' }] }), /already has a companion at inputs\[1\]/)
  })
})
