// A2–A5 — the pure half: which rows are scripts, where a document's Pine lives,
// and the inputs panel's ATOMIC application of values to the preview document.
import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'
import { reconcileParams } from '../paramEdit'
import {
  pineSourceOf, withPineSource, withName, pineScriptsOf, applyInputValues, inputValuesOf,
  withInputValue, storableDefinition, PINE_SOURCE_FIELD,
} from './pineScripts'

const RSI = '//@version=5\nindicator("Mine")\nlength = input.int(14, "Length", minval = 1)\nplot(ta.rsi(close, length), "RSI")'
const built = () => memberPaneDefinition({ source: RSI, id: 'u_member-pane' })
const knobId = (def) => Object.keys(def.compute.paramManifest)[0]
const valueOf = (def) => reconcileParams(def)[knobId(def)].value

describe('pineSourceOf / withPineSource', () => {
  it('reads meta.pineSource first, then the lane source, and nothing from a formula', () => {
    expect(pineSourceOf({ meta: { [PINE_SOURCE_FIELD]: 'A' }, compute: { kind: 'ast', source: 'close > 1' } })).toBe('A')
    expect(pineSourceOf({ meta: {}, compute: { kind: 'runtime', source: 'R' } })).toBe('R')
    expect(pineSourceOf({ meta: {}, compute: { kind: 'ast' }, objectsRun: { source: 'H' } })).toBe('H')
    // ⛔ an ast document's compute.source is a FORMULA, never offered as Pine
    expect(pineSourceOf({ meta: {}, compute: { kind: 'ast', source: 'close > 1' } })).toBe(null)
    expect(pineSourceOf({ meta: { [PINE_SOURCE_FIELD]: '   ' }, compute: {} })).toBe(null)
    expect(pineSourceOf(null)).toBe(null)
  })

  it('writes copies, never the input', () => {
    const d = { meta: { name: 'x' }, compute: {} }
    const out = withName(withPineSource(d, 'SRC'), '  New name  ')
    expect(out.meta).toEqual({ name: 'New name', [PINE_SOURCE_FIELD]: 'SRC' })
    expect(d.meta).toEqual({ name: 'x' })
    expect(withName(d, '   ')).toBe(d)
    expect(withName(d, 'x'.repeat(60)).meta.name).toHaveLength(40)
  })

  it('a document written back drops the server\'s served-only stamps', () => {
    const d = storableDefinition({ meta: { name: 'n', runtimeKilled: 'k', runtimeNotGraded: 'g', pineSourceWithheld: 'w', [PINE_SOURCE_FIELD]: 'S' } })
    expect(d.meta).toEqual({ name: 'n', [PINE_SOURCE_FIELD]: 'S' })
  })
})

describe('pineScriptsOf — the My scripts list', () => {
  it('lists rows the server says carry a source, plus inline ones, newest first, and nothing else', () => {
    const rows = [
      { def_id: 'u_000000000001', version: 3, created_at: 10, pine_source: { bytes: 40, licence: 'MIT' }, definition: { meta: { name: 'Old' } } },
      { def_id: 'u_000000000002', version: 1, created_at: 30, pine_source: null, definition: { meta: { name: 'Formula' }, compute: { kind: 'ast', source: 'close' } } },
      { def_id: 'u_000000000003', version: 2, created_at: 20, definition: { meta: { name: 'Inline', [PINE_SOURCE_FIELD]: 'abc' } } },
      { def_id: 'u_000000000004', version: 2, created_at: 40, deleted_at: 41, pine_source: { bytes: 1 }, definition: { meta: {} } },
    ]
    const out = pineScriptsOf(rows)
    expect(out.map((s) => s.defId)).toEqual(['u_000000000003', 'u_000000000001'])
    expect(out[0]).toMatchObject({ name: 'Inline', bytes: 3, licence: null, version: 2 })
    expect(out[1]).toMatchObject({ name: 'Old', bytes: 40, licence: 'MIT' })
  })
})

describe('applyInputValues — the inputs panel, atomic', () => {
  it('moves the knob by its NAME and leaves the input untouched', () => {
    const b = built()
    expect(b.ok).toBe(true)
    const res = applyInputValues(b.definition, { length: 21 })
    expect(res.ok).toBe(true)
    expect(res.applied).toEqual(['length'])
    expect(valueOf(res.definition)).toBe(21)
    expect(valueOf(b.definition)).toBe(14)
    // the default is a no-op, not an edit
    expect(applyInputValues(b.definition, { length: 14 }).definition).toBe(b.definition)
  })

  it('⛔ a refused value returns the ORIGINAL document — never a half-applied one', () => {
    const b = built()
    const res = applyInputValues(b.definition, { length: 0 })      // below minval
    expect(res.ok).toBe(false)
    expect(res.definition).toBe(b.definition)
    expect(res.error).toMatch(/must be >= 1/)
  })

  it('⛔ a refusal AFTER an applied value still returns the original — the first edit is not kept', () => {
    const TWO = [
      '//@version=5', 'indicator("Two")', 'fast = input.int(5, "Fast", minval = 1)',
      'slow = input.int(20, "Slow", minval = 1)', 'plot(ta.sma(close, fast) - ta.sma(close, slow), "D")',
    ].join('\n')
    const b = memberPaneDefinition({ source: TWO, id: 'u_member-pane' })
    const names = Object.values(b.definition.compute.paramManifest).map((e) => e.sourceName)
    expect(names).toEqual(['fast', 'slow'])                 // both offered: the case is real
    const ok = applyInputValues(b.definition, { fast: 7 })
    expect(ok.ok).toBe(true)
    expect(ok.definition).not.toBe(b.definition)
    const res = applyInputValues(b.definition, { fast: 7, slow: 0 })
    expect(res.ok).toBe(false)
    expect(res.definition).toBe(b.definition)
    expect(res.applied).toEqual([])
  })

  it('a value for an input the script no longer offers is STALE, skipped, never applied elsewhere', () => {
    const b = built()
    const res = applyInputValues(b.definition, { gone: 5 })
    expect(res.ok).toBe(true)
    expect(res.stale).toEqual(['gone'])
    expect(res.definition).toBe(b.definition)
  })

  it('reseeds the panel from a stored document, and clears a value set back to its default', () => {
    const b = built()
    const stored = applyInputValues(b.definition, { length: 30 }).definition
    expect(inputValuesOf(stored)).toEqual({ length: 30 })
    expect(inputValuesOf(b.definition)).toEqual({})
    expect(withInputValue({ length: 30 }, 'length', 14, 14)).toEqual({})
    expect(withInputValue({}, 'length', 9, 14)).toEqual({ length: 9 })
  })
})
