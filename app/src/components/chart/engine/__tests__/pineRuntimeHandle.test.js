// app/src/components/chart/engine/__tests__/pineRuntimeHandle.test.js
//
// ─── THE RUNTIME-LANE HANDLE, HELD TO THE VECTORS THE STORE IS HELD TO ──────
//
// `compute.fn` of a `pine` document is re-derived by the store on every save
// (`api/services/user_definitions.py::runtime_lane_handle`) and a disagreement
// is a refusal. So the two lanes must agree byte for byte, and they are held to
// ONE committed table (`tests/fixtures/pine_store/handle_vectors.json`) from both
// sides — this file is the JS half, `tests/test_user_definitions_pine_store.py`
// the Python half.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runtimeLaneHandle, runtimeLaneHandleOf, canonicalJson } from '../pineRuntimeHandle'

const REPO = path.resolve(process.cwd(), '..')
const VECTORS = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/pine_store/handle_vectors.json'), 'utf8')).vectors

/** Every object's keys re-inserted in SORTED order, deeply — what a document
 *  looks like after the store's `json.dumps(..., sort_keys=True)` round trip. */
function sortedDeep(v) {
  if (Array.isArray(v)) return v.map(sortedDeep)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedDeep(v[k])]))
  }
  return v
}

describe('the committed vectors', () => {
  it('there are vectors, and they are not all one answer', () => {
    expect(VECTORS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(VECTORS.map((v) => v.handle)).size).toBeGreaterThanOrEqual(5)
  })

  for (const v of VECTORS) {
    it(`${v.name} → ${v.handle}`, () => {
      expect(runtimeLaneHandleOf(v.compute)).toBe(v.handle)
    })
  }
})

describe('⛔ the handle survives the store\'s sorted-key round trip', () => {
  it('a document read back with every key sorted hashes to the handle it was minted with', () => {
    for (const v of VECTORS) {
      const back = JSON.parse(JSON.stringify(sortedDeep(v.compute)))
      expect(runtimeLaneHandleOf(back), v.name).toBe(v.handle)
    }
  })

  it('CONTROL — the insertion-order JSON this replaced does NOT survive it (so the test above can fail)', () => {
    const v = VECTORS.find((x) => x.name.startsWith('insertion order does not matter (1)'))
    const c = v.compute
    const legacy = (x) => runtimeLaneHandle(JSON.stringify([x.source, x.columns, x.inputs || {},
      x.lane.plotColours, x.lane.ownsDrawing]))
    const back = JSON.parse(JSON.stringify(sortedDeep(c)))
    expect(legacy(back)).not.toBe(legacy(c))
  })

  it('a changed script, map, input or lane option is a changed handle', () => {
    const base = VECTORS[0].compute
    const h = runtimeLaneHandleOf(base)
    expect(runtimeLaneHandleOf({ ...base, source: `${base.source} ` })).not.toBe(h)
    expect(runtimeLaneHandleOf({ ...base, columns: { value: { ...base.columns.value, output: 1 } } })).not.toBe(h)
    expect(runtimeLaneHandleOf({ ...base, inputs: { pine_x: 'x' } })).not.toBe(h)
    expect(runtimeLaneHandleOf({ ...base, lane: { ...base.lane, plotColours: !base.lane.plotColours } })).not.toBe(h)
    expect(runtimeLaneHandleOf({ ...base, lane: { ...base.lane, ownsDrawing: !base.lane.ownsDrawing } })).not.toBe(h)
  })

  it('a non-integral number is refused rather than formatted two ways', () => {
    expect(() => canonicalJson([1.5])).toThrow(/not an integer/)
    expect(canonicalJson([3, true, null, 'a'])).toBe('[3,true,null,"a"]')
  })
})
