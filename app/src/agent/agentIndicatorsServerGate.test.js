// app/src/agent/agentIndicatorsServerGate.test.js
//
// ⭐ UCT RS 3-14 — THE AGENT'S SETTINGS MANIFEST FOLLOWS THE SERVER GATE. The catalog line
// the model reads (`addableRows().settings`, `inputsOfDef`) and the write guard
// (`unsettableInput`) use the SAME visibility model as the settings dialog, the phone sheet
// and the inspector (`indicatorRegistry.visibleInputs` over `serverCompute.serverDeclares`):
// fail closed while undeclared, a legacy input only while its successor is still gated off.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { addableRows, inputsOfDef, settableInputs, unsettableInput } from './capabilities/indicatorEdits'
import { primeServerDefinitions, clearServerDefinitions, __setServerDefinitionsFetcherForTests } from '../components/chart/engine/serverCompute'
import * as nativeRegistry from '../components/chart/engine/nativeRegistry'

const RS = nativeRegistry.getDefinition('rsLine')
const PHASE3 = ['view', 'customBenchmark', 'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow',
  'clenowGapPct', 'atrLength', 'varsLookback', 'anchorDate']
const optionValues = (key) => RS.inputs.find((i) => i.key === key).options.map((o) => (Array.isArray(o) ? o[0] : o.value))
const body = (on) => ({
  schemaVersion: 1,
  definitions: [{
    schemaVersion: 1, id: 'rsLine', version: on ? 4 : 3, compute: { kind: 'server', fn: 'rsLine', rev: on ? 4 : 3 },
    inputs: RS.meta.serverInputs.filter((k) => on || !PHASE3.includes(k)).map((key) => ({
      key, type: 'x', default: null,
      ...(key === 'benchmark' ? { options: optionValues('benchmark').filter((v) => on || v !== 'CUSTOM') } : {}),
      ...(key === 'view' ? { options: optionValues('view') } : {}),
    })),
    columns: ['rsLine'],
  }],
})
const rsSettings = () => addableRows().find((r) => r.defId === 'rsLine').settings
const keysOf = (line) => line.split('; ').map((part) => part.split(' ')[0])

beforeEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })
afterEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })

describe('the manifest line for UCT RS', () => {
  it('undeclared (null): fail closed — no Reading, no Phase 3 lengths, no CUSTOM; the legacy Mansfield switch is offered', () => {
    const k = keysOf(rsSettings())
    for (const gated of ['view', 'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow', 'clenowGapPct', 'atrLength', 'varsLookback']) {
      expect(k, gated).not.toContain(gated)
    }
    expect(k).toContain('showMansfield')
    expect(rsSettings()).not.toMatch(/CUSTOM/)
    expect(rsSettings()).toMatch(/benchmark SPY\|/)
  })

  it('V3 off: the same as undeclared', () => {
    const before = rsSettings()
    primeServerDefinitions(body(false))
    expect(rsSettings()).toBe(before)
  })

  it('V3 on: the Reading, CUSTOM and the Phase 3 lengths are offered, the legacy switch is not', () => {
    primeServerDefinitions(body(true))
    const line = rsSettings()
    const k = keysOf(line)
    for (const gated of ['view', 'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow', 'clenowGapPct', 'atrLength', 'varsLookback']) {
      expect(k, gated).toContain(gated)
    }
    expect(k).not.toContain('showMansfield')
    expect(line).toMatch(/\|CUSTOM/)
    expect(inputsOfDef('rsLine').map((i) => i.key)).toContain('view')
  })

  it('every other definition: byte-identical whatever the server declares', () => {
    const others = () => JSON.stringify(addableRows().filter((r) => r.defId !== 'rsLine'))
    const a = others()
    primeServerDefinitions(body(false))
    const b = others()
    primeServerDefinitions(body(true))
    expect(b).toBe(a)
    expect(others()).toBe(a)
    // and settableInputs without a defId is the unfiltered type filter, as before
    expect(settableInputs([{ key: 'x', type: 'int' }, { key: 'c', type: 'color' }])).toEqual([{ key: 'x', type: 'int' }])
  })
})

describe('the write guard writes only what it advertises', () => {
  it('V3 off: a Reading, a Phase 3 length or CUSTOM is refused; the Mansfield switch is not', () => {
    primeServerDefinitions(body(false))
    expect(unsettableInput('rsLine', { view: 'rotation' })).toMatch(/isn't available/)
    expect(unsettableInput('rsLine', { rrgRatioLength: 12 })).toMatch(/isn't available/)
    expect(unsettableInput('rsLine', { benchmark: 'CUSTOM' })).toMatch(/isn't available/)
    expect(unsettableInput('rsLine', { benchmark: 'RSP' })).toBeNull()
    expect(unsettableInput('rsLine', { showMansfield: true })).toBeNull()
  })

  it('V3 on: the Reading is written, the retired switch is refused', () => {
    primeServerDefinitions(body(true))
    expect(unsettableInput('rsLine', { view: 'rotation' })).toBeNull()
    expect(unsettableInput('rsLine', { benchmark: 'CUSTOM' })).toBeNull()
    expect(unsettableInput('rsLine', { showMansfield: true })).toMatch(/isn't available/)
  })

  it('an ungated definition is untouched', () => {
    expect(unsettableInput('rsi', { period: 7 })).toBeNull()
  })
})
