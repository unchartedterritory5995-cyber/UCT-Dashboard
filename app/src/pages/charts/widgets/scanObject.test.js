// TERM-087 — the AI Search answer's `scan_object`, re-checked by the BUILDER'S
// OWN validator before anything offers to open it.
//
// ⛔ EVERY EXPECTATION IS TAKEN FROM THE SHIPPED DOORS, NEVER FROM A COPY:
// `evaluateFormula` is the builder's gate, `parseFormula`/`astHash` its tree and
// identity, `yieldsOf` the JS lane's one condition classifier. A test that
// retyped any of them would be a second authority over a value they own.

import { describe, it, expect } from 'vitest'
import { readScanObject } from './scanObject'
import { evaluateFormula } from '../../../components/chart/builder/FormulaField'
import { BUILDER_INPUT_SCOPE } from '../../../components/chart/builder/builderInputs'
import { parseFormula } from '../../../components/chart/engine/ast/parse'

const CONDITION = '(close > sma(close, 50))'

function objectFor(source, extra = {}) {
  const parsed = parseFormula(source)
  expect(parsed.ok, `fixture does not parse: ${source}`).toBe(true)
  return {
    ok: true, kind: 'scan', source, ast: parsed.ast,
    repaint: 'non-repainting', freshness: 'live', cadence: null,
    not_understood: [], unavailable: [], import_id: 'imp-1', ...extra,
  }
}

const REFUSAL_KEYS = ['gate', 'ok', 'reason']

describe('flag off / not a screen ask', () => {
  it.each([undefined, null, 'prose', 42])('%p reads as NOTHING to show, not as a refusal', (v) => {
    expect(readScanObject(v)).toBeNull()
  })
})

describe('a whole object round-trips through the builder validator', () => {
  it('is offered, with the read-back derived from the TREE', () => {
    const obj = objectFor(CONDITION)
    const view = readScanObject(obj)
    expect(view.ok).toBe(true)
    expect(view.source).toBe(CONDITION)
    expect(view.importId).toBe('imp-1')
    const expected = evaluateFormula(CONDITION, BUILDER_INPUT_SCOPE)
    expect(expected.ok, expected.error || '').toBe(true)
    expect(view.readback).toBe(expected.readback)
  })

  it('carries the parts of the question that did NOT make it into the maths', () => {
    const view = readScanObject(objectFor(CONDITION, {
      not_understood: [{ text: 'cheap', reason: 'ambiguous' }],
      unavailable: [{ name: 'pe_ttm', reason: 'not carried' }],
    }))
    expect(view.ok).toBe(true)
    expect(view.notUnderstood).toHaveLength(1)
    expect(view.unavailable).toHaveLength(1)
  })
})

describe('anything less than a whole, valid object is REFUSED — never half-offered', () => {
  const refused = (v) => {
    expect(v.ok).toBe(false)
    expect(Object.keys(v).sort()).toEqual(REFUSAL_KEYS)
    expect(v.reason).toBeTruthy()
    return v
  }

  it("the server's own refusal passes through with its gate and reason", () => {
    const v = refused(readScanObject({ ok: false, kind: 'scan', gate: 'scan:not-a-condition',
      reason: 'compare it to something' }))
    expect(v.gate).toBe('scan:not-a-condition')
    expect(v.reason).toBe('compare it to something')
  })

  it('a refusal that smuggles a tree still offers nothing', () => {
    const v = refused(readScanObject({ ok: false, gate: 'lint:repaint', reason: 'repaints',
      source: CONDITION, ast: parseFormula(CONDITION).ast }))
    expect(v).not.toHaveProperty('source')
  })

  it.each([
    ['no source', (o) => { delete o.source }],
    ['blank source', (o) => { o.source = '   ' }],
    ['no tree', (o) => { delete o.ast }],
  ])('%s is incomplete', (_label, mutate) => {
    const obj = objectFor(CONDITION)
    mutate(obj)
    expect(refused(readScanObject(obj)).gate).toBe('object:incomplete')
  })

  it('a source the builder cannot parse is refused by the builder, not by a copy', () => {
    const obj = objectFor(CONDITION)
    obj.source = '(close > '
    const v = refused(readScanObject(obj))
    const expected = evaluateFormula('(close > ', BUILDER_INPUT_SCOPE)
    expect(expected.ok).toBe(false)
    expect(v.gate).toBe(expected.guard)
  })

  it('⛔ a source that is valid but is NOT the tree it came with is a half-object', () => {
    // Each half is fine on its own; together they are two different scans, and
    // opening the text would edit something the member was never shown.
    const obj = objectFor(CONDITION)
    obj.ast = parseFormula('(close < sma(close, 50))').ast
    expect(refused(readScanObject(obj)).gate).toBe('object:round-trip')
  })

  it('a NUMBER is not a scan, however valid it is as a formula', () => {
    const v = refused(readScanObject(objectFor('sma(close, 20)')))
    expect(v.gate).toBe('scan:not-a-condition')
  })
})
