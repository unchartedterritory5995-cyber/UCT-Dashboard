// app/src/components/chart/engine/__tests__/instanceInputSurvivesTheMirror.test.js
//
// ─── A PER-INSTANCE INPUT EDIT MUST SURVIVE THE MIRROR ──────────────────────
//
// Measured in production on 2026-08-14, WMT 1D: set MACD Fast to 33 in the
// per-instance settings dialog (the chart recomputed, so the write landed), turn
// MACD off and on again from the Indicators list, reopen settings — **Fast reads
// 20**. Not the 33 just set, and not the definition default of 12. 20 was a value
// written much earlier through the GLOBAL Chart Settings modal.
//
// Why: `setIndicatorEnabled(…, false)` replaces the instance with a TOMBSTONE,
// which is minimal on purpose and carries no inputs. Toggling back on therefore
// takes the rebuild branch and reconstructs `inputs` from
// `inputsFromLegacy(def, cs.indicators[defId])` — the legacy MIRROR. And
// `setInstanceInput`, the single door every generated settings row writes
// through, updated only `indicatorInstances[]`.
//
// ⭐ AND THE TOGGLE IS THE LEAST OF IT. `controlDoorCensus.test.js` records that
// the mirror is what survives a blob round trip: "Drop `indicatorInstances` —
// which is what a share link, a preset and a reset all do — and the read-time
// migrator has to rebuild the instance from the mirror alone." So an edit that
// never reached the mirror is also lost by **share links, presets and resets** —
// the shared chart draws the OLD period. That is the same failure the census
// already guards for `setIndicatorInput` ("an INPUT write mirrors too, or the
// legacy block draws the old period"); the per-instance door was simply never
// held to it.
//
// ⛔ THE DOCUMENTED REASON NOT TO MIRROR IS KEPT, BECAUSE IT IS RIGHT — WHERE IT
// APPLIES. `setInstanceInput` said: "The mirror is per DEFINITION and cannot
// carry two instances' periods; writing one of them there would make the settings
// row and the `?indicators=` route show a number no line on the chart is drawn
// with." That harm needs a SIBLING to exist. With exactly one live instance of a
// definition, and that instance being the legacy one the mirror projects back to,
// the mirror is not ambiguous — it is simply stale. So the write is conditioned
// on precisely the case the objection does not cover, and the sibling cases below
// pin the objection itself so a later change cannot quietly widen the write.
import { describe, it, expect } from 'vitest'
import { CHART_DEFAULTS, mergeChartSettings } from '../../chartDefaults'
import {
  setIndicatorEnabled, setInstanceInput, findInstance, addInstance, removeInstance,
} from '../instanceControls'
import { legacyInstanceId } from '../instances'
import { migrateLegacyToInstances } from '../instances'
import * as engineRegistry from '../nativeRegistry'

/** A valid value for `input` that is NOT `current` — so a preserved value can
 *  never be confused with a default that happened to match. */
function otherValue(input, current) {
  const lo = Number.isFinite(input.min) ? input.min : 1
  const hi = Number.isFinite(input.max) ? input.max : 200
  for (let v = lo; v <= hi; v++) {
    if (v !== current) return v
  }
  return null
}

const NUMERIC = new Set(['int', 'float'])

/** Definitions that declare at least one numeric input, with that input. */
function numericDefs() {
  return engineRegistry.listDefinitions()
    .map(def => ({ def, input: (def.inputs || []).find(i => NUMERIC.has(i.type)) }))
    .filter(x => !!x.input)
}

describe('a per-instance input edit reaches the legacy mirror (sole instance)', () => {
  const cases = numericDefs()

  it('there are definitions to sweep — otherwise every loop below is vacuous', () => {
    expect(cases.length).toBeGreaterThan(8)
  })

  for (const { def, input } of cases) {
    it(`${def.id}.${input.key}: survives an off → on toggle`, () => {
      const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
      const id = legacyInstanceId(def.id)
      const before = findInstance(on, id).inputs?.[input.key]
      const target = otherValue(input, before)
      expect(target, `${def.id}.${input.key}: no alternative value in range`).not.toBeNull()

      const edited = setInstanceInput(on, id, input.key, target, engineRegistry)
      expect(edited, 'the write was refused — the rest of this test proves nothing').not.toBe(on)
      expect(findInstance(edited, id).inputs[input.key]).toBe(target)

      const off = setIndicatorEnabled(edited, def.id, false, engineRegistry)
      const back = setIndicatorEnabled(off, def.id, true, engineRegistry)
      expect(findInstance(back, id).inputs[input.key],
        `${def.id}.${input.key}: the toggle replaced the member's value with the mirror's`)
        .toBe(target)
    })
  }

  for (const { def, input } of cases) {
    it(`${def.id}.${input.key}: survives a blob round trip (share link / preset / reset)`, () => {
      const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
      const id = legacyInstanceId(def.id)
      const target = otherValue(input, findInstance(on, id).inputs?.[input.key])
      const edited = setInstanceInput(on, id, input.key, target, engineRegistry)

      // Exactly what a share link, a preset and a reset do to the blob.
      const rebuilt = migrateLegacyToInstances({ ...edited, indicatorInstances: [] }, engineRegistry)
      const inst = rebuilt.find(i => i && i.defId === def.id && !i.deleted)
      expect(inst, `${def.id}: the mirror did not project the indicator back at all`).toBeTruthy()
      expect(inst.inputs[input.key],
        `${def.id}.${input.key}: a shared chart would draw the OLD period`).toBe(target)
    })
  }
})

describe('the legend chip’s Remove is no longer destructive to settings', () => {
  // ⭐ A CONSEQUENCE OF THE FIX ABOVE, PINNED SO IT CANNOT SILENTLY GO AWAY.
  //
  // `removeInstance` tombstones the instance and sets only `enabled: false` on the
  // mirror — it spreads the rest of the mirror through — so once an input edit
  // reaches the mirror, Remove-then-re-add restores the member's periods instead
  // of resetting to stock. That matters because the chip's Remove button MOVES:
  // measured on production 2026-08-14, every control on the MACD chip shifted
  // +5.4px when the printed value gained a minus sign, and page-x 430.1–434.5 is
  // `Remove` at one value and `Settings` at the next. Mis-aiming is therefore a
  // real event on a live chart, and this is what keeps it cheap.
  const cases = numericDefs()

  for (const { def, input } of cases) {
    it(`${def.id}.${input.key}: survives Remove → re-add`, () => {
      const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
      const id = legacyInstanceId(def.id)
      const target = otherValue(input, findInstance(on, id).inputs?.[input.key])
      const edited = setInstanceInput(on, id, input.key, target, engineRegistry)

      const removed = removeInstance(edited, id, engineRegistry)
      expect(findInstance(removed, id), `${def.id}: Remove left the instance live`).toBeNull()

      const readded = setIndicatorEnabled(removed, def.id, true, engineRegistry)
      expect(findInstance(readded, id).inputs[input.key],
        `${def.id}.${input.key}: a mis-aimed Remove still costs the member their settings`)
        .toBe(target)
    })
  }
})

describe('…and it still refuses to write the mirror when a sibling exists', () => {
  // This is the documented objection, kept as a rail: the mirror is per
  // DEFINITION and cannot represent two instances' periods.
  const cases = numericDefs()

  for (const { def, input } of cases.slice(0, 6)) {
    it(`${def.id}: a SECOND instance's edit never reaches the mirror`, () => {
      const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
      const two = addInstance(on, def.id, engineRegistry)
      const ids = (two.indicatorInstances || []).filter(i => i && i.defId === def.id && !i.deleted)
      expect(ids.length, `${def.id}: addInstance did not create a sibling`).toBe(2)

      const sibling = ids.find(i => i.instanceId !== legacyInstanceId(def.id))
      expect(sibling, `${def.id}: no non-legacy sibling`).toBeTruthy()

      const mirrorBefore = { ...(two.indicators?.[def.id] || {}) }
      const target = otherValue(input, sibling.inputs?.[input.key])
      const edited = setInstanceInput(two, sibling.instanceId, input.key, target, engineRegistry)

      expect(findInstance(edited, sibling.instanceId).inputs[input.key]).toBe(target)
      expect(edited.indicators[def.id][input.key],
        `${def.id}.${input.key}: a sibling's period leaked into the per-definition mirror`)
        .toBe(mirrorBefore[input.key])
    })
  }

  for (const { def, input } of cases.slice(0, 6)) {
    it(`${def.id}: even the LEGACY instance stops mirroring once a sibling exists`, () => {
      const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
      const two = addInstance(on, def.id, engineRegistry)
      const id = legacyInstanceId(def.id)
      const mirrorBefore = { ...(two.indicators?.[def.id] || {}) }
      const target = otherValue(input, findInstance(two, id).inputs?.[input.key])

      const edited = setInstanceInput(two, id, input.key, target, engineRegistry)
      expect(findInstance(edited, id).inputs[input.key]).toBe(target)
      expect(edited.indicators[def.id][input.key],
        `${def.id}.${input.key}: the mirror now names one of two drawn periods`)
        .toBe(mirrorBefore[input.key])
    })
  }
})

describe('the write door still refuses what it always refused', () => {
  it('an undeclared key returns the blob BY IDENTITY', () => {
    const def = numericDefs()[0].def
    const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
    expect(setInstanceInput(on, legacyInstanceId(def.id), '__nope__', 5, engineRegistry)).toBe(on)
  })

  it('an out-of-range value returns the blob BY IDENTITY and moves no mirror', () => {
    const { def, input } = numericDefs().find(x => Number.isFinite(x.input.max))
    const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
    const out = setInstanceInput(on, legacyInstanceId(def.id), input.key, input.max + 1000, engineRegistry)
    expect(out).toBe(on)
  })

  it('a tombstoned instance is not revived by a write to it', () => {
    const def = numericDefs()[0].def
    const on = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
    const off = setIndicatorEnabled(on, def.id, false, engineRegistry)
    expect(setInstanceInput(off, legacyInstanceId(def.id), numericDefs()[0].input.key, 7, engineRegistry)).toBe(off)
  })

  it('CHART_DEFAULTS is not mutated by any of this', () => {
    expect(CHART_DEFAULTS.indicatorInstances === undefined
      || Array.isArray(CHART_DEFAULTS.indicatorInstances)).toBe(true)
  })
})
