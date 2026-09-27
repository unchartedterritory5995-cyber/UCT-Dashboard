import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { memberInputTranslation } from '../../builder/builderInputs.js'
import { buildParamManifest, manifestFromPlacements, paramLocatorsIn } from '../../builder/pineParamManifest.js'
import { toGraphDocument, hydrateGraphDocument } from './graphDocument.js'
import { treesHash } from './trees.js'
import { astHash } from './parse.js'
import { applyParamEdit } from '../../builder/paramEdit.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition.js'

/**
 * `plot(x, offset = <input>)` AT THE MEMBER DOOR — 2026-09-26.
 *
 * ⚰️ THE WALL THIS FILE RETIRES. The member door translates with `declareInputs`,
 * which hands an input back as an IDENTIFIER so a chart can bind it later. The
 * displacement reader accepted only a bare `num` (or `u-` over one), so
 * `offset = -rightbars` refused with *"has to reduce to a whole number of bars at
 * translation time"* on a displacement that DOES reduce — at the door, and only
 * there: `translatePine` without `declareInputs` served the same scripts. Measured:
 * 11 corpus scripts, every offending `offset =` an input or arithmetic on inputs.
 *
 * ⭐ PINE'S SEMANTICS ARE THE SPEC. `offset` is a simple int — fixed from inputs and
 * constants before the first bar, never per bar. So it folds at translation from
 * the input's value (the author's default, or the member's own value when the
 * script is re-translated with `inputValues`), and the input cannot ALSO be a
 * per-chart knob: the displacement is a number in the tree by then.
 *
 * ⛔ Every assertion here reads the TRANSLATION'S OUTPUT (the tree, the row, the
 * rendered sentence), never a flag the code under test set on itself.
 */

const src = (body) => `//@version=5\nindicator("t")\n${body}\n`
const DECLARE = { strict: true, declareInputs: 'all' }

const only = (out) => {
  expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
  const row = out.outputs.find((o) => o.refusal === null)
  expect(row, 'no output translated').toBeTruthy()
  return row
}
const barsOf = (closes) => closes.map((c, i) => ({ t: 20260801 + i, o: c, h: c, l: c, c, v: 1000 }))

// ─── the fold, in the mode the member door uses ────────────────────────────────

describe('a displacement written as an INPUT, under declareInputs', () => {
  it('⭐⭐ a NEGATIVE input displacement folds to the default and is recorded as presentation', () => {
    const row = only(translatePine(src('prd = input.int(10)\nplot(close, offset = -prd)'), DECLARE))
    expect(row.displace).toBe(-10)
    expect(row.ast).toEqual({ type: 'series', name: 'close' })
  })

  it('⭐⭐ a POSITIVE input displacement becomes the offset node, at the default', () => {
    const row = only(translatePine(src('len = input.int(3)\nplot(close, offset = len)'), DECLARE))
    expect(row.ast).toEqual({ type: 'offset', value: 3, args: [{ type: 'series', name: 'close' }] })
    expect(row.displace).toBe(0)
    // ⛔ THE VALUE, NOT THE SHAPE: three bars right means bar i draws bar i-3.
    expect(interpret(row.ast, barsOf([10, 11, 12, 13, 14]))[4]).toBe(11)
  })

  it('⭐ arithmetic on an input folds the way Pine computes it — `displacement - 1` is 25', () => {
    // `multicator-table` line 414, verbatim shape.
    const row = only(translatePine(
      src('displacement = input.int(26, minval = 1)\nplot(close, offset = displacement - 1)'), DECLARE))
    expect(row.ast).toEqual({ type: 'offset', value: 25, args: [{ type: 'series', name: 'close' }] })
  })

  it('⭐ the input that fed it is stamped displacementBound on the row', () => {
    const row = only(translatePine(src('prd = input.int(10)\nplot(close, offset = -prd)'), DECLARE))
    const e = row.inputsFolded.find((x) => x.name === 'prd')
    expect(e, JSON.stringify(row.inputsFolded)).toBeTruthy()
    expect(e.displacementBound).toBe(true)
    expect(e.windowBound).toBeUndefined()
  })
})

// ─── a member-changed value moves the displacement ─────────────────────────────

describe("the member's own value moves the displacement", () => {
  for (const [mode, opts] of [['declare', DECLARE], ['plain', { strict: true }]]) {
    it(`⭐⭐ positive, ${mode} mode: inputValues {len: 5} draws five bars right, not three`, () => {
      const row = only(translatePine(src('len = input.int(3)\nplot(close, offset = len)'),
        { ...opts, inputValues: { len: 5 } }))
      expect(row.ast.value).toBe(5)
      expect(interpret(row.ast, barsOf([10, 11, 12, 13, 14, 15, 16]))[6]).toBe(11)
    })

    it(`⭐⭐ negative, ${mode} mode: inputValues {prd: 7} records -7, not -10`, () => {
      const row = only(translatePine(src('prd = input.int(10)\nplot(close, offset = -prd)'),
        { ...opts, inputValues: { prd: 7 } }))
      expect(row.displace).toBe(-7)
    })
  }
})

// ─── what still refuses, and says why ──────────────────────────────────────────

describe('what still refuses', () => {
  it('⛔ a displacement that depends on a SERIES still refuses, in declare mode too', () => {
    for (const body of ['plot(close, offset = close > open ? 1 : 2)', 'plot(close, offset = -close)',
      'n = input.int(2)\nplot(close, offset = n + bar_index)']) {
      const out = translatePine(src(body), DECLARE)
      expect(out.refusal, body).toBeTruthy()
      expect(out.refusal.guard, body).toBe('pine:plot-offset')
      expect(out.refusal.message, body).toMatch(/cannot know before there is a chart/)
    }
  })

  it('⛔ a displacement that folds to a FRACTION says so — it did fold, it is not a whole number', () => {
    const out = translatePine(src('len = input.int(21)\nplot(close, offset = len / 2)'), DECLARE)
    expect(out.refusal.guard).toBe('pine:plot-offset')
    expect(out.refusal.message).toMatch(/folds to 10\.5/)
    // ⛔ and not the timeframe-flag sentence, which would be false about this script
    expect(out.refusal.message).not.toMatch(/timeframe flag/)
  })
})

// ─── the member door: the knob is refused BY NAME, with a TRUE sentence ────────

describe('at the member door', () => {
  const SCRIPT = src('prd = input.int(10, "Pivot")\nlen = input.int(14, "Length")\n'
    + 'plot(ta.sma(close, 3) * len / len, offset = -prd)')

  it('⭐⭐ the script translates, and the displacement input is NOT handed out as a knob', () => {
    const t = memberInputTranslation(translatePine, SCRIPT, { strict: true })
    const row = only(t)
    expect(row.displace).toBe(-10)
    expect(row.memberInputs.map((r) => r.key)).not.toContain('prd')
    // `len` is an ordinary knob and stays one — the fix refuses exactly one name
    expect(row.memberInputs.map((r) => r.key)).toContain('len')
    expect(t.declared).not.toContain('prd')
  })

  it('⭐⭐ …and the member is told WHY in a sentence about a DISPLACEMENT, not a window', () => {
    const t = memberInputTranslation(translatePine, SCRIPT, { strict: true })
    const skipped = only(t).skippedInputs.find((s) => s.name === 'prd')
    expect(skipped, JSON.stringify(only(t).skippedInputs)).toBeTruthy()
    expect(skipped.displacementBound).toBe(true)
    expect(skipped.reason).toMatch(/sets a plot DISPLACEMENT/)
    expect(skipped.reason).toMatch(/`10`/)
    expect(skipped.reason).not.toMatch(/lands in a WINDOW/)
    expect(skipped.reason).not.toMatch(/never reads/)
  })
})

// ─── the definition parameter follows a POSITIVE displacement ──────────────────

function realDefinition(body) {
  const out = translatePine(src(body), { paramManifest: true, strict: true })
  expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
  const ast = out.outputs[out.selected].ast
  const paramManifest = buildParamManifest(out.inputParams, [{ treeIndex: null, ast }])
  return {
    id: 'u_0123456789ab',
    compute: { kind: 'ast', ast, source: out.outputs[out.selected].formula, paramManifest },
  }
}

describe('a positive displacement is a definition parameter too', () => {
  it("⭐⭐ `offset = len` is located at the offset node's own `value`", () => {
    const def = realDefinition('len = input.int(3, "Shift", minval = 1)\nplot(close, offset = len)')
    const entries = Object.values(def.compute.paramManifest)
    expect(entries).toHaveLength(1)
    expect(entries[0].locators).toEqual([{ treeIndex: null, astPath: ['value'] }])
  })

  it('⭐⭐ editing it moves the displacement — 3 → 6 — and the column with it', () => {
    const def = realDefinition('len = input.int(3, "Shift", minval = 1)\nplot(close, offset = len)')
    const id = Object.keys(def.compute.paramManifest)[0]
    const r = applyParamEdit(def, id, 6)
    expect(r.ok, r.error).toBe(true)
    expect(r.definition.compute.ast.value).toBe(6)
    expect(interpret(r.definition.compute.ast, barsOf([10, 11, 12, 13, 14, 15, 16]))[6]).toBe(10)
  })

  it('⛔ an edit to zero or below is refused whole, never half-written', () => {
    const def = realDefinition('len = input.int(3, "Shift", minval = -5)\nplot(close, offset = len)')
    const id = Object.keys(def.compute.paramManifest)[0]
    const r = applyParamEdit(def, id, 0)
    expect(r.ok).toBe(false)
    expect(def.compute.ast.value).toBe(3)
  })

  it('⛔ a COMPUTED displacement (`len - 1`) is not advertised as that input', () => {
    const def = realDefinition('len = input.int(4, "Shift")\nplot(close, offset = len - 1)')
    expect(def.compute.ast.value).toBe(3)
    expect(Object.keys(def.compute.paramManifest)).toHaveLength(0)
  })
})

describe('an edit to a parameter used twice in ONE tree rewrites both uses', () => {
  it('⛔⛔ `sma(close, len) - ema(close, len)`, 14 → 21: both lengths move', () => {
    const def = realDefinition('len = input.int(14, "Length", minval = 1)\n'
      + 'plot(ta.sma(close, len) - ta.ema(close, len))')
    const id = Object.keys(def.compute.paramManifest)[0]
    expect(def.compute.paramManifest[id].locators).toHaveLength(2)
    const r = applyParamEdit(def, id, 21)
    expect(r.ok, r.error).toBe(true)
    expect(r.definition.compute.source).toBe('sma(close, 21) - ema(close, 21)')
  })
})

// ─── the wall directly behind it: a pivot's bar counts from an input ───────────

describe('a pivot whose bar counts are inputs, under declareInputs', () => {
  const PIVOT = src('lb = input.int(2)\nrb = input.int(3)\nplot(ta.pivothigh(lb, rb), offset = -rb)')

  it('⭐⭐ translates — the counts fold as window lengths and the knob is refused', () => {
    const row = only(translatePine(PIVOT, DECLARE))
    expect(row.ast.type).toBe('offset')
    expect(row.ast.value).toBe(3)
    expect(row.ast.args[0].args.slice(1)).toEqual([{ type: 'num', value: 2 }, { type: 'num', value: 3 }])
    expect(row.displace).toBe(-3)
    const rb = row.inputsFolded.find((e) => e.name === 'rb')
    expect(rb.windowBound).toBe(true)
  })

  it('⭐⭐ and editing `rightbars` moves the pivot AND its confirmation shift together', () => {
    const def = realDefinition('rb = input.int(3, "Right", minval = 1)\nplot(ta.pivothigh(high, 2, rb))')
    const id = Object.keys(def.compute.paramManifest)[0]
    const paths = def.compute.paramManifest[id].locators.map((l) => JSON.stringify(l.astPath)).sort()
    expect(paths).toEqual([JSON.stringify(['args', 0, 'args', 2]), JSON.stringify(['value'])].sort())
    const r = applyParamEdit(def, id, 5)
    expect(r.ok, r.error).toBe(true)
    expect(r.definition.compute.ast.value).toBe(5)
    expect(r.definition.compute.ast.args[0].args[2]).toEqual({ type: 'num', value: 5 })
  })
})

describe('a shift locator survives the shared-graph round trip', () => {
  // ⛔ A V1 manifest is converted to a graph document when it is large, and read
  // back to V1 for every builder surface. Both directions must know the offset
  // shape, or the parameter is dropped on the way in (the tag cannot be placed)
  // or mis-addressed on the way out (a locator ending at the node, not its number).
  function twoPlotPivotDefinition() {
    const out = translatePine(src('rb = input.int(3, "Right", minval = 1)\n'
      + 'plot(ta.pivothigh(high, 2, rb))\nplot(ta.pivotlow(low, 2, rb))'), { paramManifest: true, strict: true })
    expect(out.ok, JSON.stringify(out.refusal)).toBe(true)
    const keys = ['value', 'out2']
    const trees = Object.fromEntries(out.outputs.map((o, i) => [keys[i], o.ast]))
    const paramManifest = manifestFromPlacements(out.inputParams, keys.map((k) => ({
      treeIndex: k, locators: paramLocatorsIn(out.inputParams, trees[k]) })))
    return {
      id: 'u_doc000000002', schemaVersion: 2, label: 'fixture',
      plots: keys.map((k) => ({ key: k, label: k, style: 'line', legend: { decimals: 2 } })),
      compute: {
        kind: 'ast', ast: trees.value, trees, scanPlot: 'value', treesHash: treesHash(trees),
        fn: astHash(trees.value), source: 'placeholder',
        sources: Object.fromEntries(keys.map((k) => [k, 'placeholder'])), paramManifest,
      },
    }
  }

  it('⭐⭐ V1 → graph → V1 keeps every locator, the shift included', () => {
    const def = twoPlotPivotDefinition()
    const [id, entry] = Object.entries(def.compute.paramManifest)[0]
    expect(entry.locators.filter((l) => l.astPath[l.astPath.length - 1] === 'value')).toHaveLength(2)
    const g = toGraphDocument(def)
    expect(g.ok, g.reason).toBe(true)
    expect(Object.keys(g.definition.compute.graph.parameters)).toContain(id)
    const back = hydrateGraphDocument(JSON.parse(JSON.stringify(g.definition)))
    const norm = (ls) => ls.map((l) => JSON.stringify([l.treeIndex, l.astPath])).sort()
    // the scan plot's locators come back as `treeIndex: null`, its V1 alias
    const want = entry.locators.map((l) => ({ ...l, treeIndex: l.treeIndex === 'value' ? null : l.treeIndex }))
    expect(norm(back.compute.paramManifest[id].locators)).toEqual(norm(want))
    const r = applyParamEdit(back, id, 5)
    expect(r.ok, r.error).toBe(true)
    expect(r.definition.compute.trees.out2.value).toBe(5)
  })
})

// ─── the corpus, through the door members actually use ─────────────────────────

describe('the eleven corpus scripts that refused here', () => {
  const REPO = path.resolve(process.cwd(), '..')
  const CORPUS = path.join(REPO, 'corpus/committed')
  const ELEVEN = ['bolingger-bands-inside-bar-boxes__3294017d4f', 'extrapolated-pivot-connector__vROeQSQlNs',
    'multicator-table__486858895c', 'multiple-mtf-moving-average-xdecow__aArjfk9ShG',
    'pivot-high-low-points__hoTsDQRY3L',
    'price-action-as-in-book-fibonacci-supportresistant-trendline__31c2c4b9a7',
    'support-and-resistance__UgNPprOr8h', 'swing-points-and-liquidity-by-leviathan__919c1fd9c6',
    'trend-lines-supports-and-resistances__413ee2ee3b', 'trendlines__43QQg9nDN0',
    'wyckoff-accumulation-distribution__d9ae726e21']
  const ATTACH = new Set(['extrapolated-pivot-connector__vROeQSQlNs',
    'price-action-as-in-book-fibonacci-supportresistant-trendline__31c2c4b9a7',
    'trend-lines-supports-and-resistances__413ee2ee3b'])
  const door = (n) => memberPaneDefinition({
    source: fs.readFileSync(path.join(CORPUS, `${n}.pine`), 'utf8'), id: 'u_p', name: 'P' })

  it('⛔⛔ NON-VACUITY — the corpus is on disk and the door really runs', () => {
    for (const n of ELEVEN) expect(fs.existsSync(path.join(CORPUS, `${n}.pine`)), n).toBe(true)
  })

  it('⭐⭐ none of the eleven refuses on a plot displacement any more', () => {
    for (const n of ELEVEN) expect(door(n).guard, n).not.toBe('pine:plot-offset')
  }, 120000)

  it('⭐⭐ the three with nothing else in the way ATTACH', () => {
    for (const n of ATTACH) {
      const d = door(n)
      expect(d.ok, `${n}: ${d.guard} ${d.reason}`).toBe(true)
    }
  }, 120000)
})
