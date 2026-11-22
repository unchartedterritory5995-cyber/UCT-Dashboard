// app/src/components/chart/engine/paramInputs.test.js
//
// SETTINGS PARITY (2a): a folded parameter is a chart setting, per instance.
import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { applyParamEdit } from '../builder/paramEdit'
import { projectMemberDocument as migrateMemberDocument } from './memberDocumentProjection'
import { validateDefinition } from './defSchema'
import * as registry from './nativeRegistry'
import { checkInstanceInput } from './instanceControls'
import { fieldsForInstance } from '../indicatorRegistry'
import { paramInputSpecs, withParamInputs, stripParamInputs, specializeParams, paramInputKey } from './paramInputs'
import { toGraphDocument, hydrateGraphDocument } from './ast/graphDocument'
import { readAt, literalValueOf } from './paramLiteral.js'

const SRC = `//@version=5
indicator("P", overlay = false)
len = input.int(14, "Length", minval = 2, maxval = 200)
mult = input.float(2.0, "Mult", minval = 0.5, maxval = 5, step = 0.5)
plot(ta.sma(close, len) * mult, "A")
plot(ta.ema(close, len), "B")
`
const BARS = Array.from({ length: 400 }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 9) + i * 0.05
  return { t: 1_700_000_000 + i * 86_400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1000 + i }
})

function minted() {
  const r = memberPaneDefinition({ source: SRC, id: 'u_param2a', name: 'P' })
  expect(r.ok, JSON.stringify(r.reason || null)).toBe(true)
  return r.definition
}
const idOf = (def, title) => Object.entries(def.compute.paramManifest).find(([, e]) => e.title === title)[0]
const cols = (def, inputs) => registry.computeFor(def, BARS, inputs, { tf: 'D' })
const plotKeys = (def) => def.plots.filter((p) => !p.hidden).map((p) => p.key)

describe('the projection: an attached parameter is declared as a setting', () => {
  it('the minted document folds the window length (a manifest parameter) and keeps the multiplier an input; NO projected inputs stored', () => {
    const def = minted()
    expect(Object.values(def.compute.paramManifest).map((e) => e.title)).toEqual(['Length'])
    expect(def.inputs.find((i) => i.key === 'mult')).toMatchObject({ type: 'float', default: 2 })
    expect((def.inputs || []).some((i) => i.fromParam)).toBe(false)
  })

  it('on load each attached parameter is an int / float input with the author\'s title and bounds', () => {
    const def = migrateMemberDocument(minted())
    const specs = paramInputSpecs(def)
    expect(specs.map((s) => [s.label, s.type, s.default, s.min, s.max])).toEqual([['Length', 'int', 14, 2, 200]])
    expect(def.inputs.filter((i) => i.fromParam).map((i) => i.key)).toEqual(specs.map((s) => s.key))
    expect(specs[0].key).toBe(paramInputKey(idOf(def, 'Length')))
    expect(validateDefinition(def).errors || []).toEqual([])
  })

  it('it is idempotent, and stripping it gives back the stored inputs', () => {
    const stored = minted()
    const loaded = migrateMemberDocument(stored)
    expect(withParamInputs(loaded)).toBe(loaded)
    expect(stripParamInputs(loaded).inputs).toEqual(stored.inputs || [])
  })

  it('the settings dialog lists them and the instance validator admits only in-bounds values', () => {
    const def = migrateMemberDocument(minted())
    const key = paramInputSpecs(def)[0].key
    const fields = fieldsForInstance(def, { instanceId: 'i', defId: def.id, inputs: {} })
    expect(fields.all.map((f) => f.key)).toContain(key)
    expect(checkInstanceInput(def, key, 30)).toMatchObject({ ok: true, value: 30 })
    expect(checkInstanceInput(def, key, 1).ok).toBe(false)
    expect(checkInstanceInput(def, key, 201).ok).toBe(false)
    expect(checkInstanceInput(def, key, 7.5).ok).toBe(false)
  })
})

describe('the chart computes the instance\'s value, exactly as a Builder edit to that value would', () => {
  it('at the default the definition is computed unchanged (same object)', () => {
    const def = migrateMemberDocument(minted())
    const key = paramInputSpecs(def)[0].key
    expect(specializeParams(def, {})).toBe(def)
    expect(specializeParams(def, { [key]: 14 })).toBe(def)
  })

  it('at length 30 (mult 3, an ordinary input) every column equals the Builder-edited definition\'s', () => {
    const stored = minted()
    const def = migrateMemberDocument(stored)
    const [len] = paramInputSpecs(def)
    const viaSetting = cols(def, { [len.key]: 30, mult: 3 })
    const edited = applyParamEdit(stored, len.fromParam, 30)
    expect(edited.ok, edited.error).toBe(true)
    const viaEdit = cols(migrateMemberDocument(edited.definition), { mult: 3 })
    const atDefault = cols(def, {})
    for (const k of plotKeys(def)) {
      expect(Array.from(viaSetting[k]), k).toEqual(Array.from(viaEdit[k]))
      expect(Array.from(viaSetting[k]), `${k} moved off the default`).not.toEqual(Array.from(atDefault[k]))
    }
  })

  it('two instances of ONE definition at different values compute different columns', () => {
    const def = migrateMemberDocument(minted())
    const key = paramInputSpecs(def)[0].key
    const a = cols(def, { [key]: 10 })
    const b = cols(def, { [key]: 50 })
    const k = plotKeys(def)[1]
    expect(Array.from(a[k])).not.toEqual(Array.from(b[k]))
  })

  it('the specialised copy is memoised per value (a redraw at the same value computes no new tree)', () => {
    const def = migrateMemberDocument(minted())
    const key = paramInputSpecs(def)[0].key
    expect(specializeParams(def, { [key]: 30 })).toBe(specializeParams(def, { [key]: 30 }))
    expect(specializeParams(def, { [key]: 30 })).not.toBe(specializeParams(def, { [key]: 31 }))
  })

  it('⛔ a stored value the bounds refuse is refused by name on every column, never computed', () => {
    const def = migrateMemberDocument(minted())
    const key = paramInputSpecs(def)[0].key
    const out = cols(def, { [key]: 500 })
    const errs = registry.columnErrors(out)
    expect(Object.keys(errs).sort()).toEqual(plotKeys(def).sort())
    const text = JSON.stringify(errs)
    expect(text).toMatch(/setting:param-refused/)
    expect(text).toMatch(/Length must be at most 200/)
  })
})

// ─── THE SERVER TWIN READS THE SAME CASES (`api/services/param_inputs.py`) ─────────
// `tests/fixtures/ast/param_inputs_parity.json` is WRITTEN here (PARAM_INPUTS_PARITY_WRITE=1)
// from this lane's own answers and READ by `tests/test_param_inputs.py`: the same stored
// document, the same settings, the same specialised trees (or the same refusal), and the
// chart's column at a NON-DEFAULT value, which the alert lane must reproduce.
import fs from 'node:fs'
import path from 'node:path'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'param_inputs_parity.json')

/** The document a member's browser holds after a save: stored as a shared graph, read back hydrated
 *  (`useUserDefinitions` → `hydrateGraphDocument`). */
function roundTripped(stored) {
  const g = toGraphDocument(stored)
  expect(g.ok, g.reason).toBe(true)
  return hydrateGraphDocument(JSON.parse(JSON.stringify(g.definition)))
}

describe('⭐⭐ a SAVED copy computes the instance\'s value too (the shared-graph round trip, 2026-11-18)', () => {
  // Hydration names the scan plot's locators `treeIndex: null`; the specialiser wrote those into `ast` only,
  // while a multi-tree document runs its scan plot from `trees[scanPlot]`: a moved setting did nothing to the
  // first plot of every saved Pine copy (Fred RS, found by the 10-member sweep on production).
  it('the round trip names the scan plot\'s locators null, and the saved copy computes what the fresh one does', () => {
    const stored = minted()
    const back = roundTripped(stored)
    const id = idOf(back, 'Length')
    expect(back.compute.paramManifest[id].locators.map((l) => l.treeIndex)).toContain(null)
    const saved = migrateMemberDocument(back)
    const [len] = paramInputSpecs(saved)
    const viaSaved = cols(saved, { [len.key]: 30 })
    const viaFresh = cols(migrateMemberDocument(stored), { [len.key]: 30 })
    for (const k of plotKeys(saved)) expect(Array.from(viaSaved[k]), k).toEqual(Array.from(viaFresh[k]))
    expect(Array.from(viaSaved.value), 'the scan plot moved off the default').not.toEqual(Array.from(cols(saved, {}).value))
  })

  it('⛔ CONTROL: a null locator is never written blind into a scan tree that holds another literal there', () => {
    const back = roundTripped(minted())
    const id = idOf(back, 'Length')
    const loc = back.compute.paramManifest[id].locators.find((l) => l.treeIndex === null)
    const path = loc.astPath
    const scan = back.compute.scanPlot
    // a scan tree that differs from `ast` at that path (a hand-made document: no door writes one)
    const odd = JSON.parse(JSON.stringify(back))
    const node = readAt(odd.compute.trees[scan], path)
    node.value = 99
    const def = migrateMemberDocument(odd)
    const s = specializeParams(def, { [paramInputSpecs(def)[0].key]: 30 })
    expect(literalValueOf(readAt(s.compute.ast, path))).toBe(30)
    expect(literalValueOf(readAt(s.compute.trees[scan], path))).toBe(99)
  })
})

describe('the parity fixture both lanes read', () => {
  it('⭐ the JS lane reproduces the committed fixture exactly (regenerate with PARAM_INPUTS_PARITY_WRITE=1)', () => {
    const stored = minted()
    const def = migrateMemberDocument(stored)
    const key = paramInputSpecs(def)[0].key
    const cases = [{}, { [key]: 14 }, { [key]: 30 }, { [key]: 2 }, { [key]: 500 }, { [key]: 7.5 }].map((params) => {
      const s = specializeParams(def, params)
      if (s && s.refused) return { params, refused: s.refused }
      return { params, ast: s.compute.ast, trees: s.compute.trees || null }
    })
    const bars = BARS.slice(0, 120)
    const k = plotKeys(def)[1]
    const column = Array.from(registry.computeFor(def, bars, { [key]: 30 }, { tf: 'D' })[k]).map((v) => (Number.isFinite(v) ? v : null))
    const doc = {
      _about: 'SETTINGS PARITY (2a). Written by app/src/components/chart/engine/paramInputs.test.js '
        + '(PARAM_INPUTS_PARITY_WRITE=1) and read by tests/test_param_inputs.py.',
      stored, specs: paramInputSpecs(def).map(({ key: kk, label, type, default: d, min, max, step, fromParam }) => ({ key: kk, label, type, default: d, min, max, step, fromParam })),
      cases, chart: { plot: k, treeKey: k, params: { [key]: 30 }, bars, column },
    }
    if (process.env.PARAM_INPUTS_PARITY_WRITE === '1') fs.writeFileSync(FIXTURE, `${JSON.stringify(doc, null, 1)}\n`)
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(JSON.parse(JSON.stringify(doc))).toEqual(committed)
  })
})

describe('speed: a settings change recomputes one pane, well inside a second on 5,000 bars', () => {
  it('change -> new columns on 5,000 bars, warm (the engine has computed this pane once)', () => {
    const def = migrateMemberDocument(minted())
    const key = paramInputSpecs(def)[0].key
    const bars = Array.from({ length: 5000 }, (_, i) => {
      const c = 100 + 10 * Math.sin(i / 9) + i * 0.01
      return { t: 1_000_000_000 + i * 86_400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1000 + i }
    })
    registry.computeFor(def, bars, {}, { tf: 'D' })                     // warm: the pane as first drawn
    const times = []
    for (const v of [20, 30, 40, 50, 60]) {
      const t0 = performance.now()
      const out = registry.computeFor(def, bars, { [key]: v }, { tf: 'D' })
      times.push(performance.now() - t0)
      expect(out[plotKeys(def)[1]].length).toBe(5000)
    }
    const worst = Math.max(...times)
    // eslint-disable-next-line no-console
    console.log(`[2a speed] change -> columns, 5,000 bars, warm: ${times.map((t) => t.toFixed(1)).join(' / ')} ms (worst ${worst.toFixed(1)})`)
    expect(worst).toBeLessThan(1000)
  })
})
