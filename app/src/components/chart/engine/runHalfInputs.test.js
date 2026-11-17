// app/src/components/chart/engine/runHalfInputs.test.js
//
// SETTINGS PARITY (2c): a run half's own settings (the inputs only the drawings read).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { projectMemberDocument as migrateMemberDocument } from './memberDocumentProjection'
import { hostReadNames, drawingReadNames, runHalfInputSpecs, withRunHalfInputs, runHalfRunInputs } from './runHalfInputs'
import { stripParamInputs } from './paramInputs'
import { validateDefinition } from './defSchema'
import { fieldsForInstance } from '../indicatorRegistry'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')

// What the script's own text says: the RS line and its two averages (and their fill) read these;
// the rating label and the new-high / new-low dots read the rest.
const PLOT_READS = ['lineTicker', 'SpxValue', 'offset', 'colorRS', 'boolMa', 'lenMa', 'colMa', 'typMa', 'lenMaWe',
  'typMaWe', 'fillMa', 'posCol', 'negCol', 'boolMa2', 'lenMa2', 'colMa2', 'typMa2', 'lenMa2We', 'typMa2We']
const DRAWING_ONLY = ['hideRSRat', 'ratingOnly', 'plotNewHigh', 'rsNewHigh', 'blueDotCol', 'lookback', 'sizeLabHigh', 'plotNewLow', 'redDotCol',
  'rsNewLow', 'lookback2', 'sizeLabLow', 'allowReplay', 'first2', 'scnd2', 'thrd2', 'frth2', 'ffth2', 'sxth2', 'svth2']

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  __resetRuntimePanePermission()
  vi.unstubAllEnvs()
})

const minted = () => {
  const r = memberPaneDefinition({ source: RS, id: 'u_rs2c', name: 'RS Rating' })
  expect(r.ok, JSON.stringify(r.reason || null)).toBe(true)
  return r
}

describe('which settings only the drawings read', () => {
  it('the RS line and its averages read exactly what the script says; the label and dots read the rest', () => {
    const host = hostReadNames(RS)
    for (const n of PLOT_READS) expect(host.has(n), n).toBe(true)
    for (const n of DRAWING_ONLY) expect(host.has(n), n).toBe(false)
  })

  it('the drawings read the RS value and their own switches, never the averages', () => {
    const d = drawingReadNames(RS)
    for (const n of ['offset', 'SpxValue', 'lineTicker', ...DRAWING_ONLY]) expect(d.has(n), n).toBe(true)
    for (const n of ['lenMa', 'lenMaWe', 'lenMa2', 'lenMa2We', 'boolMa', 'boolMa2', 'typMa', 'fillMa']) expect(d.has(n), n).toBe(false)
  })

  it('⛔ CONTROL — the closure follows a value through a call statement, a condition and a block value', () => {
    const src = ['//@version=5', 'indicator("c")', 'a = input.int(3, "a")', 'b = input.int(4, "b")',
      'c = input.bool(false, "c")', 'd = input.int(5, "d")', 'e = input.int(6, "e")', 'arr = array.new_float()',
      'array.push(arr, a)', 'x = 0.0', 'if c', '    x := 1', 'y = switch d', '    5 => close', '    => open',
      'plot(array.get(arr, 0) + x + y)', 'label.new(bar_index, high, str.tostring(b + e))'].join('\n')
    const host = hostReadNames(src)
    for (const n of ['a', 'c', 'd']) expect(host.has(n), n).toBe(true)
    for (const n of ['b', 'e']) expect(host.has(n), n).toBe(false)
  })
})

describe('the projection', () => {
  it('a minted RS Rating carries a run half, and its drawing-only settings are declared on load', () => {
    const r = minted()
    expect(r.definition.compute.runtimeObjects, JSON.stringify(r.runHalfDeclined || null)).toBeTruthy()
    const def = migrateMemberDocument(r.definition)
    const keys = runHalfInputSpecs(def).map((s) => s.key)
    for (const n of keys) expect(DRAWING_ONLY, n).toContain(n)
    for (const n of ['hideRSRat', 'ratingOnly', 'plotNewHigh', 'rsNewHigh', 'lookback', 'sizeLabHigh', 'plotNewLow',
      'rsNewLow', 'lookback2', 'sizeLabLow', 'allowReplay', 'first2', 'svth2']) expect(keys, n).toContain(n)
    expect(def.inputs.filter((i) => i.fromRunHalf).map((i) => i.key)).toEqual(keys)
    expect(def.inputs.find((i) => i.key === 'rsNewHigh')).toMatchObject({ type: 'enum', default: 'RS New Highs' })
    expect(def.inputs.find((i) => i.key === 'lookback')).toMatchObject({ type: 'int', default: 250, min: 1, max: 252 })
    expect(validateDefinition(def).errors || []).toEqual([])
    const fields = fieldsForInstance(def, { instanceId: 'i', defId: def.id, inputs: {} })
    expect(fields.all.map((f) => f.key)).toEqual(expect.arrayContaining(['hideRSRat', 'lookback', 'param1018']))
  })

  it('idempotent, never stored: stripping gives back the stored inputs', () => {
    const stored = minted().definition
    const loaded = migrateMemberDocument(stored)
    expect(withRunHalfInputs(loaded)).toBe(loaded)
    expect(stripParamInputs(loaded).inputs).toEqual(stored.inputs || [])
  })

  it('a document without a run half declares nothing', () => {
    const r = memberPaneDefinition({ source: RS, id: 'u_rs2c-nohalf', name: 'RS Rating', routeHostPartial: false })
    const def = migrateMemberDocument(r.definition)
    expect(runHalfInputSpecs(def)).toEqual([])
    expect(def.inputs.some((i) => i.fromRunHalf)).toBe(false)
  })
})

describe('the run is handed the chart\'s values, in its own names', () => {
  it('a host input, a folded length and a drawing-only setting, each by its Pine name; a switch as a bool', () => {
    const def = migrateMemberDocument(minted().definition)
    const r = runHalfRunInputs(def, { offset: 60, param1018: 30, boolMa: 1, hideRSRat: true, lookback: 100, lineWidth: 3 })
    expect(r.ok).toBe(true)
    expect(r.values).toEqual({ offset: 60, lenMa: 30, boolMa: true, hideRSRat: true, lookback: 100 })
    expect(r.moved.sort()).toEqual(['boolMa', 'hideRSRat', 'lenMa', 'lookback', 'offset'])
    // the rating label reads the RS value (so its offset) and its own switches; no drawing reads an average
    expect(r.needsEvidence.sort()).toEqual(['hideRSRat', 'lookback', 'offset'])
  })

  it('at every default nothing is handed (the author\'s program)', () => {
    const def = migrateMemberDocument(minted().definition)
    const none = { ok: true, values: {}, moved: [], needsEvidence: [] }
    expect(runHalfRunInputs(def, { offset: 80, param1018: 21, hideRSRat: false })).toEqual(none)
    expect(runHalfRunInputs(def, undefined)).toEqual(none)
  })

  it('⛔ a moved plot colour the run cannot be handed is named, never dropped', () => {
    // (the line colour IS handed since the colour links, `runHalfColours.test.js`; the fill's helper
    // plot `out3` draws in a literal, so its colour setting has no input behind it)
    const def = migrateMemberDocument(minted().definition)
    const r = runHalfRunInputs(def, { out3Color: '#FF0000' })
    expect(r).toMatchObject({ ok: false, key: 'out3Color' })
  })
})

// ⭐ SOUNDNESS — the static closure must contain every input the TRANSLATOR folded into a plot.
// Over the committed corpus (all of it with RUN_HALF_INPUTS_FULL=1; a fixed slice by default).
describe('soundness over the committed corpus', () => {
  it('every input a plot folds is in hostReadNames', () => {
    const dir = path.join(REPO, 'corpus', 'committed')
    let files = fs.readdirSync(dir).filter((f) => f.endsWith('.pine')).sort()
    if (process.env.RUN_HALF_INPUTS_FULL !== '1') files = files.filter((_, i) => i % 6 === 0)
    let checked = 0
    const misses = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      let r
      try { r = memberPaneDefinition({ source: src, id: 'u_sound', name: 's', routeHostPartial: false }) } catch { continue }
      if (!r || !r.ok || !r.translation) continue
      const host = hostReadNames(src)
      if (!host) continue
      for (const o of r.translation.outputs || []) {
        for (const x of o.inputsFolded || []) {
          if (!x || typeof x.name !== 'string') continue
          checked += 1
          if (!host.has(x.name)) misses.push(`${f}: ${x.name}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(50)
    expect(misses).toEqual([])
  }, 600000)
})
