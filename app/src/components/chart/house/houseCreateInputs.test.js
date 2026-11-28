// app/src/components/chart/house/houseCreateInputs.test.js
//
// ⭐⭐ (owner, 2026-11-27) THE OWNER'S TRADINGVIEW SETTINGS ARE FRED RS'S UCT DEFAULTS (`house/houseNames.js`).
// A NEW Fred RS instance is born with "Approximate Value of Comparative Symbol" 7200, "Offset (%)" 90, the new-high
// "Type" 'Historical RS New Highs' and its "Look-back" 30, through the door every UCT indicator uses for a new copy's
// values (`meta.createInputs`), declared on load. Held here:
//   1. the copy the house tab builds, installed, gives a new instance exactly those four (a folded length found under
//      its `param<N>` key), every other setting at the script's own default, and the declared defaults untouched;
//   2. a copy made any other way of the SAME script (renamed, or pasted as "RS Rating") gets them too, by its script;
//   3. CONTROL: an EDITED copy, and another script, get nothing (the script's defaults);
//   4. the four are moved settings the run half serves only on recorded evidence: the committed allowlist's graded
//      captures at moved settings admit every one of them (`runHalfSettingsAdmitted`), so the drawings are served;
//   5. the script is untouched: the entry's sha256 is still the allowlist's.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import PINE from './housePineIndicators.json'
import { buildPineCopy } from '../IndicatorHouseTab'
import * as registry from '../engine/nativeRegistry'
import { addInstance } from '../engine/instanceControls'
import { fieldsForInstance } from '../indicatorRegistry'
import { runHalfRunInputs } from '../engine/runHalfInputs'
import { setRunHalfObjectEvidence, runHalfSettingsAdmitted } from '../engine/runHalfRailSeam'
import { committedRunHalfEvidence } from '../engine/__tests__/committedRunHalfEvidence'
import { houseCreateInputsOf, isHouseCopyMeta, HOUSE_SCRIPT_SHA256 } from './houseNames'

const FRED = PINE.indicators.find((i) => i.slug === 'fred-rs')
const SHA = crypto.createHash('sha256').update(FRED.pine, 'utf8').digest('hex')
const OWNER = { SpxValue: 7200, offset: 90, rsNewHigh: 'Historical RS New Highs', lookback: 30 }

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
})
afterEach(() => { vi.unstubAllEnvs(); registry.clearUserDefinitions(); setRunHalfObjectEvidence([]) })

/** The member's installed copy (the registry's projection), with its meta changed by `meta`. */
async function installed(meta = {}) {
  const built = await buildPineCopy(FRED, 'u_0123456789ab')
  expect(built.doc, built.error).toBeTruthy()
  const { defs, errors } = registry.validateUserDefinitions([{ ...built.doc, version: 1, meta: { ...built.doc.meta, ...meta } }])
  expect(errors).toEqual([])
  return defs[0]
}
const newInstance = (def) => addInstance({ indicatorInstances: [] }, def.id, (id) => (id === def.id ? def : null))
  .indicatorInstances[0]
/** The instance's values keyed by Pine name (a folded length by its manifest's `sourceName`). */
function byPineName(def, inputs) {
  const manifest = def.compute.paramManifest || {}
  const out = {}
  for (const spec of def.inputs) {
    const name = spec.fromParam ? manifest[spec.fromParam].sourceName : spec.key
    if (Object.prototype.hasOwnProperty.call(inputs, spec.key)) out[name] = inputs[spec.key]
  }
  return out
}

describe("⭐ Fred RS's UCT defaults are the owner's TradingView settings", () => {
  it('a new instance of the house copy is born with the four, every other setting the script\'s own', async () => {
    const def = await installed()
    const inst = newInstance(def)
    const got = byPineName(def, inst.inputs)
    for (const [k, v] of Object.entries(OWNER)) expect(got[k], k).toBe(v)
    // the folded length is set under the key the document declares it as
    const spx = def.inputs.find((s) => s.fromParam && def.compute.paramManifest[s.fromParam].sourceName === 'SpxValue')
    expect(spx && spx.key).toMatch(/^param\d+$/)
    expect(inst.inputs[spx.key]).toBe(7200)
    // the declared defaults stay the script's ("Reset to defaults" restores TradingView's script defaults)
    const declared = byPineName(def, Object.fromEntries(def.inputs.map((s) => [s.key, s.default])))
    expect(declared).toMatchObject({ SpxValue: 4200, offset: 80, rsNewHigh: 'RS New Highs', lookback: 250 })
    // everything else is the script's default
    for (const spec of def.inputs) {
      const name = spec.fromParam ? def.compute.paramManifest[spec.fromParam].sourceName : spec.key
      if (!(name in OWNER)) expect(inst.inputs[spec.key], name).toEqual(spec.default)
    }
    // the settings form shows them
    const form = fieldsForInstance(def, inst)
    expect(form.values.offset).toBe(90)
    expect(form.values.rsNewHigh).toBe('Historical RS New Highs')
  })

  it('a copy of the same script made any other way (renamed) is recognised by its script and gets them too', async () => {
    const def = await installed({ name: 'RS Rating' })
    expect(isHouseCopyMeta(def.meta)).toBe(true)
    const got = byPineName(def, newInstance(def).inputs)
    for (const [k, v] of Object.entries(OWNER)) expect(got[k], k).toBe(v)
  })

  it('CONTROL: an EDITED copy, and another script, are born at the script\'s defaults', async () => {
    const edited = await installed({ scriptEdited: true })
    expect(edited.meta.createInputs).toBeUndefined()
    expect(byPineName(edited, newInstance(edited).inputs)).toMatchObject({ SpxValue: 4200, offset: 80, lookback: 250 })
    expect(houseCreateInputsOf({ name: 'My RS', pineSourceSha256: 'ab'.repeat(32) })).toBeNull()
    expect(houseCreateInputsOf({ name: 'Fred RS', scriptEdited: true, pineSourceSha256: SHA })).toBeNull()
  })

  it('the four are admitted by the committed graded captures at moved settings, so the run half serves its drawings', async () => {
    const def = await installed()
    const inst = newInstance(def)
    const runIn = runHalfRunInputs(def, inst.inputs)
    expect(runIn.ok).toBe(true)
    expect([...runIn.moved].sort()).toEqual(Object.keys(OWNER).sort())
    expect(runIn.needsEvidence.length, 'control: a drawing reads them').toBeGreaterThan(0)
    // the evidence the server serves (`runtime_definitions.run_half_evidence`), from the committed allowlist record
    const entry = committedRunHalfEvidence(SHA)
    // CONTROL: with no evidence the moved settings are refused
    setRunHalfObjectEvidence([])
    expect(runHalfSettingsAdmitted(SHA, runIn.needsEvidence).ok).toBe(false)
    setRunHalfObjectEvidence([entry])
    expect(runHalfSettingsAdmitted(SHA, runIn.needsEvidence)).toEqual({ ok: true, missing: [] })
  })

  it('the script is untouched: the entry is the allowlist\'s script, and the house list names it', () => {
    expect(FRED.pineSha256).toBe(SHA)
    expect(HOUSE_SCRIPT_SHA256).toEqual(PINE.indicators.map((i) => i.pineSha256))
    expect(FRED.pine).toContain('SpxValue    = input(4200')
    expect(FRED.pine).toContain('offset      = input.int(80')
  })
})
