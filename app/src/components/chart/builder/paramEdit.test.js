// 🎯 TRACK F (DEC-006) — applying a member's parameter edit, client-side.
//
// ⭐⭐ NO PINE INVOLVED ANYWHERE IN THIS FILE. Every fixture below either
// starts from a REAL `translatePine`+`buildParamManifest` output (so the
// locator shapes are exactly what the translator actually produces, not
// hand-guessed) or a hand-built multi-tree document (mirroring `tests/
// test_param_manifest.py`'s own `_multitree_definition` on the Python side)
// — but the EDIT itself never touches `pine.js`'s translation path, only
// `compute.ast`/`compute.trees` already sitting in the document. That is
// the whole point this module exists to prove: editing a saved parameter
// needs no Pine machinery at all.

import { describe, it, expect } from 'vitest'
import { translatePine } from '../engine/ast/pine.js'
import { buildParamManifest } from './pineParamManifest.js'
import { applyParamEdit } from './paramEdit.js'
import { treesHash } from '../engine/ast/trees.js'

function realSingleTreeDefinition(src) {
  const out = translatePine(src, { paramManifest: true })
  expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
  const ast = out.outputs[out.selected].ast
  const paramManifest = buildParamManifest(out.inputParams, [{ treeIndex: null, ast }])
  return {
    id: 'u_0123456789ab',
    compute: {
      kind: 'ast', ast, source: out.outputs[out.selected].formula,
      paramManifest,
    },
  }
}

describe('a real length parameter, edited end to end', () => {
  it('⭐⭐ 14 → 21 updates the literal, re-derives source, and round-trips', () => {
    const def = realSingleTreeDefinition(`//@version=5
indicator("t")
length = input.int(14, "Length", minval=1, maxval=200, step=1)
plot(rsi(close, length))
`)
    const result = applyParamEdit(def, '__uct_param_1', 21)
    expect(result.ok, result.error).toBe(true)
    expect(result.definition.compute.ast.args[1]).toEqual({ type: 'num', value: 21 })
    expect(result.definition.compute.source).toBe('rsi(close, 21)')
    // ⛔ THE ORIGINAL OBJECT IS UNTOUCHED — copy-on-write throughout.
    expect(def.compute.ast.args[1].value).toBe(14)
  })

  it('⛔ an out-of-range value is REJECTED, never clamped', () => {
    const def = realSingleTreeDefinition(`//@version=5
indicator("t")
length = input.int(14, "Length", minval=1, maxval=200, step=1)
plot(rsi(close, length))
`)
    const result = applyParamEdit(def, '__uct_param_1', 500)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/<= 200/)
    // Nothing changed.
    expect(def.compute.ast.args[1].value).toBe(14)
  })

  it('⛔ a non-integer value on an int parameter is refused', () => {
    const def = realSingleTreeDefinition(`//@version=5
indicator("t")
length = input.int(14, "Length")
plot(rsi(close, length))
`)
    const result = applyParamEdit(def, '__uct_param_1', 14.5)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/whole number/)
  })

  it('⭐ "Reset to Default" is not a special code path — just applyParamEdit(id, entry.default)', () => {
    const def = realSingleTreeDefinition(`//@version=5
indicator("t")
length = input.int(14, "Length")
plot(rsi(close, length))
`)
    const changed = applyParamEdit(def, '__uct_param_1', 30)
    expect(changed.ok).toBe(true)
    const entry = def.compute.paramManifest.__uct_param_1
    const reset = applyParamEdit(changed.definition, '__uct_param_1', entry.default)
    expect(reset.ok).toBe(true)
    expect(reset.definition.compute.source).toBe(def.compute.source)
  })

  it('⭐ a float parameter accepts a non-integer value', () => {
    const def = realSingleTreeDefinition(`//@version=5
indicator("t")
mult = input.float(2.0, "Mult", minval=0.1, maxval=10.0)
plot(close * mult)
`)
    const result = applyParamEdit(def, '__uct_param_1', 2.5)
    expect(result.ok, result.error).toBe(true)
    expect(result.definition.compute.source).toBe('close * 2.5')
  })

  it('⛔ an unknown parameter id is refused by name', () => {
    const def = realSingleTreeDefinition(`//@version=5
indicator("t")
length = input.int(14, "Length")
plot(rsi(close, length))
`)
    const result = applyParamEdit(def, '__uct_param_9', 21)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no such parameter/)
  })
})

// --------------------------------------------------------------------------- //
// multi-tree atomicity (ADR V2.2 §1/§2)
// --------------------------------------------------------------------------- //

function multiTreeDefinition(period) {
  const scanAst = { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: period }] }
  const plot2Ast = { type: 'call', name: 'rsi', args: [{ type: 'series', name: 'close' }, { type: 'num', value: period }] }
  const trees = { scan: scanAst, plot2: plot2Ast }
  return {
    id: 'u_0123456789ab',
    compute: {
      kind: 'ast', ast: scanAst, source: `sma(close,${period})`,
      trees, treesHash: treesHash(trees), scanPlot: 'scan',
      sources: { scan: `sma(close,${period})`, plot2: `rsi(close,${period})` },
      paramManifest: {
        __uct_param_1: {
          sourceName: 'length', title: 'Length', type: 'int', default: period,
          min: 1, max: 200, step: 1, options: null,
          locators: [
            { treeIndex: 'scan', astPath: ['args', 1] },
            { treeIndex: 'plot2', astPath: ['args', 1] },
          ],
        },
      },
    },
    plots: [{ key: 'scan', style: 'line' }, { key: 'plot2', style: 'line' }],
  }
}

describe('one parameter feeding two trees updates both, atomically', () => {
  it('⭐⭐ both trees change, treesHash changes, scanPlot mirrors compute.ast', () => {
    const def = multiTreeDefinition(14)
    const result = applyParamEdit(def, '__uct_param_1', 21)
    expect(result.ok, result.error).toBe(true)
    const d = result.definition
    expect(d.compute.trees.scan.args[1].value).toBe(21)
    expect(d.compute.trees.plot2.args[1].value).toBe(21)
    expect(d.compute.ast.args[1].value).toBe(21) // scanPlot === 'scan', mirrored
    expect(d.compute.treesHash).not.toBe(def.compute.treesHash)
    expect(d.compute.treesHash).toBe(treesHash(d.compute.trees))
  })

  it('⛔⛔ a locator that cannot round-trip refuses the WHOLE edit, leaving BOTH trees untouched', () => {
    const def = multiTreeDefinition(14)
    // Corrupt one locator's astPath so its target is not a {type:'num'} node.
    def.compute.paramManifest.__uct_param_1.locators[1] = { treeIndex: 'plot2', astPath: ['args', 0] }
    const result = applyParamEdit(def, '__uct_param_1', 21)
    expect(result.ok).toBe(false)
    // Neither tree changed -- atomicity, not a partial write.
    expect(def.compute.trees.scan.args[1].value).toBe(14)
    expect(def.compute.trees.plot2.args[1].value).toBe(14)
  })

  it('⛔ a detached locator (its tree no longer exists) is skipped, not fatal, if others survive', () => {
    const def = multiTreeDefinition(14)
    def.compute.paramManifest.__uct_param_1.locators[1] = { treeIndex: 'nonexistent', astPath: ['args', 1] }
    const result = applyParamEdit(def, '__uct_param_1', 21)
    expect(result.ok, result.error).toBe(true)
    expect(result.definition.compute.trees.scan.args[1].value).toBe(21)
  })
})
