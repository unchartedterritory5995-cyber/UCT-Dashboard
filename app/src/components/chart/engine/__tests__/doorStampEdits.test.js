// ⛔⛔ AN EDITED BAND LOSES ITS DOOR STAMP; AN UNEDITED BAND KEEPS IT.
//
// `plots[].fillTransparency` is what lets a later door (`DOOR_VERSION` 2+) upgrade a
// band's `fillOpacity` (`memberDocumentMigration.upgradeFromDoorStamps`). The editors
// never put the stamp in a ROW (`doorStamps.test.js` pins that), but both of them
// CARRY it back from the stored document onto the one they rebuilt — the manual
// Builder through `preservePresentation`, the conversational model through
// `graftCarried`. So a member's chosen opacity used to save beside the stamp, and a
// future door could replace it. These rails go through the two carry paths
// themselves, not the row: the edited band has no stamp, the unedited one keeps it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stampedFillOpacity, upgradeFromDoorStamps, fillStampSurvivesEdit } from '../memberDocumentMigration'
import { preservePresentation } from '../../builder/presentationPreserve'
import { applyPatch } from '../../builder/authoring/applyPatch'
import { modelOf, buildFromModel } from '../../builder/authoring/model'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const docOf = () => JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/door_stamps/v6-fills.json'), 'utf8')).definition
const plot = (doc, k) => doc.plots.find((p) => p.key === k)
const clone = (v) => JSON.parse(JSON.stringify(v))

/** What `buildDefinition` writes for a reopened document: the rows' fields, and never
 *  the stamp (a reopened row does not hold it). */
function rebuilt(prior, edit = () => {}) {
  const next = clone(prior)
  for (const p of next.plots) delete p.fillTransparency
  edit(next)
  return next
}

/** A hypothetical next door that states a v6 stated-nothing band differently, and a
 *  colour band's `t` differently — the case the stamp exists for. */
const NEXT_DOOR = Object.freeze({
  1: stampedFillOpacity,
  2: (stamp, pv) => (stamp.via === 'none' ? 0.42 : stampedFillOpacity(stamp, pv) / 2),
})

const env = (ops) => ({ contract: 'uct.authoring.patch/1', baseRevision: 0, ops, assumptions: [] })

describe('the fixture is the shape the rails need (non-vacuity)', () => {
  it('both bands carry a well-formed stamp and an opacity', () => {
    const doc = docOf()
    expect(plot(doc, 'value').fillTransparency).toEqual({ value: null, via: 'none' })
    expect(plot(doc, 'value').fillOpacity).toBe(1)
    expect(plot(doc, 'out3').fillTransparency).toEqual({ value: 87.5, via: 'color' })
    expect(plot(doc, 'out3').fillOpacity).toBe(0.125)
  })
})

describe('the manual Builder (preservePresentation)', () => {
  it('an unedited reopen-and-save keeps every band stamp', () => {
    const prior = docOf()
    const { doc } = preservePresentation(rebuilt(prior), prior)
    expect(plot(doc, 'value').fillTransparency).toEqual(plot(prior, 'value').fillTransparency)
    expect(plot(doc, 'out3').fillTransparency).toEqual(plot(prior, 'out3').fillTransparency)
  })

  it('⛔ a band whose opacity was edited saves with no stamp; the other band keeps its own', () => {
    const prior = docOf()
    const { doc, dropped } = preservePresentation(rebuilt(prior, (d) => { plot(d, 'out3').fillOpacity = 0.5 }), prior)
    expect(plot(doc, 'out3')).not.toHaveProperty('fillTransparency')
    expect(plot(doc, 'out3').fillOpacity).toBe(0.5)
    expect(plot(doc, 'value').fillTransparency).toEqual({ value: null, via: 'none' })
    expect(dropped).toContain('plots.out3.fillTransparency')
  })

  it('⛔ a cleared opacity is a choice too: no stamp, so no door fills it back in', () => {
    const prior = docOf()
    const { doc } = preservePresentation(rebuilt(prior, (d) => { delete plot(d, 'value').fillOpacity }), prior)
    expect(plot(doc, 'value')).not.toHaveProperty('fillTransparency')
    const up = upgradeFromDoorStamps(doc, NEXT_DOOR)
    expect(plot(up, 'value')).not.toHaveProperty('fillOpacity')
  })

  it('⭐ the point: a future door upgrades the unedited band and never the edited one', () => {
    // Save 1: the member moves out3 to 0.5. Save 2: they move it back to 0.125 —
    // byte-equal to what door 1 derives from out3's stamp, so a surviving stamp
    // would make door 2 read the member's choice as "the old door's own" and
    // replace it. value's band is never edited and must still be upgraded.
    const v0 = docOf()
    const s1 = preservePresentation(rebuilt(v0, (d) => { plot(d, 'out3').fillOpacity = 0.5 }), v0).doc
    const s2 = preservePresentation(rebuilt(s1, (d) => { plot(d, 'out3').fillOpacity = 0.125 }), s1).doc
    expect(s2.meta.doorVersion).toBe(1)
    const up = upgradeFromDoorStamps(s2, NEXT_DOOR)
    expect(plot(up, 'value').fillOpacity).toBe(0.42)       // unedited, stamped: upgraded
    expect(plot(up, 'out3').fillOpacity).toBe(0.125)       // edited: the member's value stays
  })
})

describe('the manual Builder through the REAL buildDefinition (L4)', () => {
  it('an unedited reopen-and-save keeps every band stamp and every band opacity', () => {
    // `buildFromModel` IS `buildDefinition` over the stored rows (it writes no stamp);
    // `preservePresentation` is the Builder's save-time carry.
    const prior = docOf()
    const built = buildFromModel(modelOf(prior))
    expect(plot(built, 'out3')).not.toHaveProperty('fillTransparency')   // the rebuild drops it…
    const { doc } = preservePresentation(built, prior)                   // …the carry restores it
    for (const k of ['value', 'out3']) {
      expect(plot(doc, k).fillTransparency).toEqual(plot(prior, k).fillTransparency)
      expect(plot(doc, k).fillOpacity).toBe(plot(prior, k).fillOpacity)
    }
  })
})

describe('the conversational model (applyPatch → graftCarried)', () => {
  it('a turn that does not touch the band keeps both stamps', () => {
    const r = applyPatch(docOf(), env([{ op: 'rename_output', output: 'out2', label: 'Lower' }]))
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    expect(plot(r.definition, 'value').fillTransparency).toEqual({ value: null, via: 'none' })
    expect(plot(r.definition, 'out3').fillTransparency).toEqual({ value: 87.5, via: 'color' })
  })

  it('⭐ H1 — a COLOUR-only turn ("make the cloud red") keeps the band\'s drawn opacity AND its stamp', () => {
    const r = applyPatch(docOf(), env([{ op: 'set_fill', output: 'out3', with: 'out4', color: '#FF0000' }]))
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    expect(plot(r.definition, 'out3').fillColor).toBe('#FF0000')
    expect(plot(r.definition, 'out3').fillOpacity).toBe(0.125)
    expect(plot(r.definition, 'out3').fillTransparency).toEqual({ value: 87.5, via: 'color' })
  })

  it('⭐ H1 — the same on an OPAQUE band: it stays at 1, never the 0.15 default, and keeps its stamp', () => {
    const r = applyPatch(docOf(), env([{ op: 'set_fill', output: 'value', with: 'out2', color: '#FF0000' }]))
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    expect(plot(r.definition, 'value').fillOpacity).toBe(1)
    expect(plot(r.definition, 'value').fillTransparency).toEqual({ value: null, via: 'none' })
  })

  it('⛔ an opacity the member NAMES drops the stamp even when it restates the stored value', () => {
    const r = applyPatch(docOf(), env([{ op: 'set_fill', output: 'out3', with: 'out4', opacity: 0.125 }]))
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    expect(plot(r.definition, 'out3').fillOpacity).toBe(0.125)
    expect(plot(r.definition, 'out3')).not.toHaveProperty('fillTransparency')
    expect(plot(r.definition, 'value').fillTransparency).toEqual({ value: null, via: 'none' })
  })

  it('⛔ a turn that sets a band\'s opacity drops THAT band\'s stamp and keeps the other', () => {
    const r = applyPatch(docOf(), env([{ op: 'set_fill', output: 'out3', with: 'out4', color: '#2962FF', opacity: 0.5 }]))
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    expect(plot(r.definition, 'out3').fillOpacity).toBe(0.5)
    expect(plot(r.definition, 'out3')).not.toHaveProperty('fillTransparency')
    expect(plot(r.definition, 'value').fillTransparency).toEqual({ value: null, via: 'none' })
  })
})

describe('the one predicate', () => {
  it('survives only while the band exists and its opacity is unchanged', () => {
    expect(fillStampSurvivesEdit({ fill: { with: 'b' }, fillOpacity: 0.3 }, { fill: { with: 'b' }, fillOpacity: 0.3 })).toBe(true)
    expect(fillStampSurvivesEdit({ fill: { with: 'b' } }, { fill: { with: 'b' } })).toBe(true)
    expect(fillStampSurvivesEdit({ fill: { with: 'b' }, fillOpacity: 0.3 }, { fill: { with: 'b' }, fillOpacity: 0.4 })).toBe(false)
    expect(fillStampSurvivesEdit({ fill: { with: 'b' }, fillOpacity: 0.3 }, { fill: { with: 'b' } })).toBe(false)
    expect(fillStampSurvivesEdit({ fill: { with: 'b' }, fillOpacity: 0.3 }, { fillOpacity: 0.3 })).toBe(false)
  })
})
