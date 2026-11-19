// ⭐⭐ PARITY UNIT LF (2026-11-18) — who draws a run-owned document's objects on THIS chart
// (`runtime/runtimeObjects.js::drawsRunObjectsOn`), the one answer the binder and the vendor harness ask.
// A run-owned document that carries its clean host program beside the run never loses a drawing that
// program showed: whenever the run holds back a family the program draws (or its drawings whole), the
// program draws instead.
import { describe, it, expect } from 'vitest'
import { drawsRunObjectsOn, drawsRuntimeObjects, withRuntimeObjects, scriptSettingsMoved } from '../runtimeObjects'

const program = { ops: [{ k: 'create', family: 'line', site: 's1' },
  { k: 'loop', body: [{ k: 'create', family: 'linefill', site: 's2' }] }] }
const runOwned = (objects) => ({ id: 'u_x', compute: { kind: 'runtime', source: 'x', outputs: {}, objects: true },
  ...(objects ? { objects } : {}) })
const cols = (payload) => withRuntimeObjects({ value: [1, 2] }, payload)
const ok = (withheld = {}) => ({ status: 'ok', live: [], withheld })

describe('drawsRunObjectsOn', () => {
  it('a document that does not own its drawings never draws the run\'s', () => {
    expect(drawsRunObjectsOn({ compute: { kind: 'ast' }, objects: program }, cols(ok()))).toBe(false)
    expect(drawsRunObjectsOn({ compute: { kind: 'runtime', outputs: { v: 0 } }, objects: program }, cols(ok()))).toBe(false)
  })

  it('a run-owned document with no host program beside it: always the run\'s (unchanged)', () => {
    const def = runOwned(null)
    expect(drawsRuntimeObjects(def)).toBe(true)
    expect(drawsRunObjectsOn(def, cols(ok({ line: 3 })))).toBe(true)
    expect(drawsRunObjectsOn(def, cols({ status: 'WITHHELD', live: [], guard: 'runtime:objects' }))).toBe(true)
  })

  it('with the clean host program beside it: the run\'s while it holds back nothing the program draws', () => {
    const def = runOwned(program)
    expect(drawsRunObjectsOn(def, cols(ok()))).toBe(true)
    expect(drawsRunObjectsOn(def, cols(ok({ label: 2 }))), 'a family the program never draws').toBe(true)
  })

  it('⛔ the program instead when the run holds back a family it draws (loop bodies included)', () => {
    const def = runOwned(program)
    expect(drawsRunObjectsOn(def, cols(ok({ line: 1 })))).toBe(false)
    expect(drawsRunObjectsOn(def, cols(ok({ linefill: 'more than 500 live linefills' })))).toBe(false)
  })

  it('⛔ the program instead when the run withholds its drawings whole; a run still in flight stays the run\'s', () => {
    const def = runOwned(program)
    expect(drawsRunObjectsOn(def, cols({ status: 'WITHHELD', live: [], guard: 'runtime:limit' }))).toBe(false)
    expect(drawsRunObjectsOn(def, cols({ status: 'WITHHELD', live: [], guard: 'runtime:request-pending', pending: true }))).toBe(true)
    expect(drawsRunObjectsOn(def, null), 'no record yet: empty until the run lands').toBe(true)
    expect(drawsRunObjectsOn(def, { value: [1] }), 'a record with no drawings attached yet').toBe(true)
  })

  it('an empty host program beside the run is no program', () => {
    expect(drawsRunObjectsOn(runOwned({ ops: [] }), cols(ok({ line: 1 })))).toBe(true)
  })
})

// ⭐⭐ LF step 1 (coordinator, 2026-11-18): the host program is the author's-settings picture, so a moved setting of
// the SCRIPT (never a Style knob) sends the instance to the run's picture.
describe('scriptSettingsMoved / drawsRunObjectsOn(def, cols, inputs)', () => {
  const stored = {
    compute: { kind: 'runtime', objects: true },
    objects: { ops: [{ k: 'create', family: 'line' }] },
    inputs: [{ key: 'color', type: 'color', default: '#4CAF50' }, { key: 'lineColor', type: 'color', default: '#B2B5BE' },
      { key: 'len', type: 'int', default: 10 }],
    plots: [{ key: 'value', color: '$color' }],
  }
  const installed = { ...stored, plots: [{ key: 'value', color: '#4CAF50', $refs: { color: 'color' } }] }
  const heldBack = cols({ status: 'WITHHELD', live: [] })

  it('no inputs, or every setting at its default (colours without case): not moved', () => {
    expect(scriptSettingsMoved(stored, null)).toBe(false)
    expect(scriptSettingsMoved(stored, { lineColor: '#b2b5be', len: 10 })).toBe(false)
    expect(scriptSettingsMoved(stored, {})).toBe(false)
  })
  it('a setting of the script moved: moved, in the stored and the installed form', () => {
    for (const def of [stored, installed]) {
      expect(scriptSettingsMoved(def, { lineColor: '#FF00FF' })).toBe(true)
      expect(scriptSettingsMoved(def, { len: 11 })).toBe(true)
    }
  })
  it('a Style knob is not a setting of the script, in either form', () => {
    for (const def of [stored, installed]) expect(scriptSettingsMoved(def, { color: '#123456' })).toBe(false)
  })
  it('the run held back whole: the host program at the author\'s settings, the run\'s picture once a setting moved', () => {
    expect(drawsRunObjectsOn(installed, heldBack, { color: '#123456' })).toBe(false)
    expect(drawsRunObjectsOn(installed, heldBack, { lineColor: '#FF00FF' })).toBe(true)
  })
})
