/**
 * THE NAMED-INDICATOR LIBRARY, held by the SHIPPED PARSER.
 *
 * `api/data/named_indicators.json` holds, for every named indicator, the formula as TEXT a person
 * wrote and the TREE the assistant is handed to copy. The server has no formula parser, so the
 * two are held equal here, by the parser the chart runs:
 *
 *   1. the text at its default numbers parses to exactly the stored tree (in the form the
 *      assistant writes: an offered function such as `roc` stays a plain call);
 *   2. the text with a DIFFERENT number for every parameter parses to a tree that differs from
 *      the stored one at exactly the stored `sites`, and nowhere else;
 *   3. every tree is a formula this build can run (it parses with no guard refusing it).
 *
 * `tools/named_indicators_build.py` writes the derived halves; this fails if they drift.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseFormula } from './parse'
import { collapseExpansions } from './callExpansions'

const LIBRARY = JSON.parse(fs.readFileSync(
  path.resolve(globalThis.process.cwd(), '..', 'api/data/named_indicators.json'), 'utf8'))

const numberText = (v) => String(v)
const at = (formula, values) => {
  let out = formula
  for (const [k, v] of Object.entries(values)) out = out.split(`{${k}}`).join(numberText(v))
  if (/[{}]/.test(out)) throw new Error(`an unknown parameter in: ${formula}`)
  return out
}
const written = (text) => {
  const r = parseFormula(text)
  if (!r.ok) throw new Error(`the shipped parser refuses: ${text} -- ${r.error}`)
  return collapseExpansions(r.ast)
}
/** Every place two trees of one shape hold a different number: [path, b's number]. */
function differences(a, b, at = []) {
  if (a.type !== b.type || a.name !== b.name) throw new Error(`shapes differ at [${at}]`)
  const out = []
  if (a.value !== b.value) out.push([at.join('.'), b.value])
  const aa = a.args || []
  const ba = b.args || []
  if (aa.length !== ba.length) throw new Error(`shapes differ at [${at}]`)
  aa.forEach((x, i) => out.push(...differences(x, ba[i], [...at, i])))
  return out
}
// twelve, as the build tool's own pool has (tools/named_indicators_build.py): Know Sure Thing has nine settings
const INT_PROBES = [211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271]
const FLOAT_PROBES = [1.43, 2.43, 3.43, 4.43, 5.43, 6.43]
// For a setting whose own range ends below those (a share between 0 and 1, such as the Laguerre
// pair's gamma): a function that checks its argument refuses 1.43, and no place would be found.
const SMALL_FLOAT_PROBES = [0.143, 0.243, 0.343, 0.443, 0.543, 0.643]
const inside = (p, v) => (p.min === undefined || v >= p.min) && (p.max === undefined || v <= p.max)

describe('the named-indicator library and the shipped parser', () => {
  it('is not empty, and every entry has text, a tree and sites for each output', () => {
    expect(LIBRARY.indicators.length).toBeGreaterThanOrEqual(13)
    for (const e of LIBRARY.indicators) {
      expect(e.outputs.length).toBeGreaterThan(0)
      for (const o of e.outputs) {
        expect(typeof o.formula).toBe('string')
        expect(o.tree && typeof o.tree).toBe('object')
        expect(o.sites && typeof o.sites).toBe('object')
      }
    }
  })

  for (const e of LIBRARY.indicators) {
    const defaults = Object.fromEntries(e.params.map((p) => [p.key, p.default]))
    for (const o of e.outputs) {
      it(`${e.id}.${o.key}: the text at its default numbers parses to exactly the stored tree`, () => {
        expect(written(at(o.formula, defaults))).toEqual(o.tree)
      })

      it(`${e.id}.${o.key}: other numbers land at exactly the stored sites`, () => {
        let ints = 0
        let floats = 0
        let small = 0
        const floatProbe = (p) => {
          const v = FLOAT_PROBES[floats++]
          return inside(p, v) ? v : SMALL_FLOAT_PROBES[small++]
        }
        const probes = Object.fromEntries(e.params.map((p) => [p.key, p.integer ? INT_PROBES[ints++] : floatProbe(p)]))
        for (const p of e.params) expect(inside(p, probes[p.key]) || p.integer, `${p.key}: a probe outside its own range`).toBe(true)
        const byValue = new Map(Object.entries(probes).map(([k, v]) => [v, k]))
        const found = {}
        for (const [where, value] of differences(o.tree, written(at(o.formula, probes)))) {
          const key = byValue.get(value)
          expect(key, `a number at [${where}] moved to ${value}, which is no parameter's`).toBeTruthy()
          ;(found[key] = found[key] || []).push(where)
        }
        const stored = Object.fromEntries(Object.entries(o.sites).map(([k, paths]) => [k, paths.map((p) => p.join('.'))]))
        expect(found).toEqual(stored)
      })
    }
  }

  it('CONTROL: a text that says something else does NOT parse to the stored tree', () => {
    const ao = LIBRARY.indicators.find((e) => e.id === 'awesome_oscillator')
    const defaults = Object.fromEntries(ao.params.map((p) => [p.key, p.default]))
    const other = at(ao.outputs[0].formula, defaults).replace('(high + low) / 2', '(high + low + close) / 3')
    expect(written(other)).not.toEqual(ao.outputs[0].tree)
    expect(written(at(ao.outputs[0].formula, { ...defaults, fast: 6 }))).not.toEqual(ao.outputs[0].tree)
  })
})
