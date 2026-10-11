// app/src/components/chart/builder/memberPane/runtimeRevision.test.js
//
// ⭐⭐ UIE PHASE 5 (M1) — WHAT A SOURCE REVISION DOES TO THE INSTANCES THAT USE IT.
//
// A revision is saved under the SAME id (`BuilderSheet.attachPineAs`, the formula
// edit's semantics), so every instance naming that id draws it. What this pins:
//   * shared documents: two charts' instances, each with its own settings, both draw
//     the revision — with THEIR settings;
//   * settings the revision still declares keep their stored value; one it no longer
//     declares is ignored (the run is the author's default there); one its new bounds
//     no longer admit is REFUSED BY NAME, naming the setting — never clamped, never
//     dropped silently — and the stored instance is untouched until the member fixes it;
//   * a revision that passes the door but passes a resource limit on the chart stops by
//     name, the same as any run;
//   * a document saved before the revision (an old version still held by another
//     member's registry) runs exactly as it did.
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'
import { addInstance, findInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'

const ID = 'u_00000000rv01'
const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { t: 1600000000 + i * 86400, o: c - 0.3, h: c + 1, l: c - 1, c, v: 1000 }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const V1 = '//@version=5\nindicator("Rev")\nlen = input.int(10, "Length", minval = 2, maxval = 50)\nk = input.float(1.0, "Scale")\nfloat s = 0.0\nfor i = 0 to len - 1\n    s += close[i]\nplot(s / len * k)\n'
const V2 = V1.replace('maxval = 50', 'maxval = 20').replace('k = input.float(1.0, "Scale")\n', '').replace(' * k', ' + 1')
const mint = (src) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const b = memberPaneDefinition({ source: src, id: ID })
  expect(b.ok, b.reason).toBe(true)
  return b
}
const install = (b) => {
  registry.uninstallUserDefinition(ID)
  const { installed, errors } = registry.installUserDefinitions([JSON.parse(JSON.stringify(b.definition))])
  expect(errors).toEqual([])
  return installed[0]
}
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

describe('⭐⭐ a revision, and the instances that already use the document', () => {
  it('two charts sharing it both draw the revision, each with its own settings', () => {
    const v1 = install(mint(V1))
    const a = addInstance(mergeChartSettings(null), ID, registry)
    const b = addInstance(mergeChartSettings(null), ID, registry)
    const ia = { ...a.indicatorInstances.find((i) => i.defId === ID), inputs: { len: 15 } }
    const ib = { ...b.indicatorInstances.find((i) => i.defId === ID), inputs: { len: 5 } }
    const key = v1.plots[0].key
    const before = [registry.computeFor(v1, bars, ia.inputs, CTX)[key], registry.computeFor(v1, bars, ib.inputs, CTX)[key]]
    const v2 = install(mint(V2))   // the revision, under the same id
    const after = [registry.computeFor(v2, bars, ia.inputs, CTX)[key], registry.computeFor(v2, bars, ib.inputs, CTX)[key]]
    expect(after[0]).not.toEqual(before[0])
    // the revision's maths (+1 instead of *k), at each instance's own length
    let s = 0
    for (let i = 0; i < 15; i += 1) s += bars[100 - i].c
    expect(after[0][100]).toBeCloseTo(s / 15 + 1, 9)
    s = 0
    for (let i = 0; i < 5; i += 1) s += bars[100 - i].c
    expect(after[1][100]).toBeCloseTo(s / 5 + 1, 9)
  })

  it('a setting the revision dropped is ignored; one its new bounds refuse is refused BY NAME, never clamped', () => {
    install(mint(V1))
    const v2 = install(mint(V2))
    const key = v2.plots[0].key
    // `k` is no longer declared: the stored value reaches nothing
    const dropped = registry.computeFor(v2, bars, { len: 10, k: 3 }, CTX)[key]
    expect(dropped).toEqual(registry.computeFor(v2, bars, { len: 10 }, CTX)[key])
    // len 30 was inside 2..50; the revision bounds it to 2..20
    const cols = registry.computeFor(v2, bars, { len: 30 }, CTX)
    expect(Object.keys(cols)).toEqual([])
    const err = Object.values(registry.columnErrors(cols))[0]
    expect(err.message).toMatch(/len/)
    expect(err.message).toMatch(/20/)
    // the stored instance is untouched: the member's value is still 30 until they change it
    const chart = addInstance(mergeChartSettings(null), ID, registry)
    const inst = findInstance(chart, chart.indicatorInstances.find((i) => i.defId === ID).instanceId)
    expect(inst).toBeTruthy()
  })

  it('a revision that passes a resource limit on the chart stops by name', () => {
    const runaway = '//@version=5\nindicator("Rev")\nfloat s = 0.0\nfor i = 0 to 1000000000\n    s += i\nplot(s)\n'
    const v = install(mint(runaway))
    const err = Object.values(registry.columnErrors(registry.computeFor(v, bars, undefined, CTX)))[0]
    expect(err.guard).toBe('runtime:limit')
    expect(err.message).toMatch(/INSTRUCTIONS_PER_BAR|LOOP_ITERATIONS/)
  })

  it('the version saved before the revision still runs exactly as it did', () => {
    const v1doc = mint(V1)
    const before = registry.computeFor(install(v1doc), bars, { len: 12 }, CTX)
    install(mint(V2))
    const again = registry.computeFor(install(v1doc), bars, { len: 12 }, CTX)
    expect(again[Object.keys(before)[0]]).toEqual(before[Object.keys(before)[0]])
  })
})
