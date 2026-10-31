// app/src/components/chart/engine/__tests__/doorStamps.test.js
//
// ⭐⭐ THE DOOR STAMPS — so the NEXT correction like #513 / #526 reaches a saved
// document with certainty instead of being guessed. The Pine doors stamp what they
// read: `meta.pineVersion` (the script's `//@version`, null for none),
// `meta.doorVersion` (`DOOR_VERSION`) and, on a static band, `fillTransparency`
// (the raw `t` the script wrote, and how). `upgradeFromDoorStamps` resolves a band
// from them (`memberDocumentMigration.js`); the server mirrors it at its save door
// (`user_definitions.refresh_from_door_stamps`). ONE fixture both suites read:
// `tests/fixtures/door_stamp_cases.json`; the pytest twin is `tests/test_door_stamps.py`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOOR_VERSION, DOOR_FILL_RULES, stampedFillOpacity, fillTransparencyStamp, stampedPineVersion,
  upgradeFromDoorStamps, migrateMemberDocument,
} from '../memberDocumentMigration'
import { validateDefinition } from '../defSchema'
import { validateUserDefinitions } from '../nativeRegistry'
import { astHash } from '../ast/parse.js'
import { semanticIdentity, semanticsOf } from '../definitionSemantics'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { pineDoorStampFor, withPineDoorStamp } from '../../builder/BuilderSheet'
import { modelOf } from '../../builder/authoring/model'
import { restorableRowFields } from '../../builder/presentationPreserve'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const FIXTURE = JSON.parse(read('tests/fixtures/door_stamp_cases.json'))
const STAMPED = ['v6-fills', 'v4-fills', 'unversioned-fills']
const docOf = (p) => JSON.parse(read(p)).definition

/** The hypothetical next door the fixture names (both suites define the same one). */
const isLegacy = (v) => !Number.isInteger(v) || v <= 4
const FUTURE_RULES = Object.freeze({
  1: stampedFillOpacity,
  2: (stamp, pv) => ((stamp.via === 'none' && !isLegacy(pv)) ? FIXTURE.future.modernNoneOpacity : stampedFillOpacity(stamp, pv)),
})

function applyOps(doc, ops) {
  const plot = (k) => doc.plots.find((p) => p.key === k)
  for (const op of ops) {
    if (op.op === 'deletePlotField') delete plot(op.plot)[op.field]
    else if (op.op === 'setPlotField') plot(op.plot)[op.field] = JSON.parse(JSON.stringify(op.value))
    else if (op.op === 'deleteMeta') delete doc.meta[op.key]
    else if (op.op === 'setMeta') doc.meta[op.key] = op.value
    else if (op.op === 'setFill') Object.assign(plot(op.plot).fill, op.set)
    else throw new Error(`unknown op ${op.op}`)
  }
  return doc
}

describe('a new save carries the stamps', () => {
  it('DOOR_VERSION is the newest rule the table knows', () => {
    expect(Math.max(...Object.keys(DOOR_FILL_RULES).map(Number))).toBe(DOOR_VERSION)
  })

  for (const name of STAMPED) {
    it(`the member door stamps ${name} exactly as the committed save holds it`, () => {
      const saved = docOf(`tests/fixtures/door_stamps/${name}.json`)
      const b = memberPaneDefinition({ source: read(`tests/fixtures/door_stamps/${name}.pine`), id: saved.id })
      expect(b.ok).toBe(true)
      const d = b.definition
      expect(d.meta.doorVersion).toBe(DOOR_VERSION)
      expect(d.meta.pineVersion).toBe(saved.meta.pineVersion)
      const bands = (doc) => doc.plots.filter((p) => p.fill).map((p) => [p.key, p.fillOpacity, p.fillTransparency])
      expect(bands(d)).toEqual(bands(saved))
      expect(bands(d).length).toBeGreaterThan(0)
      expect(bands(d).every(([, , s]) => s && typeof s.via === 'string')).toBe(true)
    })
  }

  it('the versions are the scripts\' own: 6, 4, and null for a script with no //@version', () => {
    expect(STAMPED.map((n) => docOf(`tests/fixtures/door_stamps/${n}.json`).meta.pineVersion)).toEqual([6, 4, null])
  })

  it('the Builder\'s Pine import writes the same two meta stamps (and none for another dialect)', () => {
    expect(pineDoorStampFor('pine', read('tests/fixtures/door_stamps/v6-fills.pine'))).toEqual({ pineVersion: 6, doorVersion: DOOR_VERSION })
    expect(pineDoorStampFor('pine', read('tests/fixtures/door_stamps/unversioned-fills.pine'))).toEqual({ pineVersion: null, doorVersion: DOOR_VERSION })
    expect(pineDoorStampFor('thinkscript', 'plot x = close;')).toBe(null)
    const doc = { id: 'u_x', meta: { name: 'x', recurrenceOrigin: 'pine' } }
    expect(withPineDoorStamp(doc, null)).toBe(doc)
    expect(withPineDoorStamp(doc, { pineVersion: 4, doorVersion: 1 }).meta)
      .toEqual({ name: 'x', recurrenceOrigin: 'pine', pineVersion: 4, doorVersion: 1 })
  })

  it('⭐ ONE RULE: the stamp reproduces the door\'s own opacity on every band of the corpus', () => {
    const saved = JSON.parse(read('tests/fixtures/pine_param_ids/saved-documents-pre-c46.json'))
    const scripts = [
      ...Object.keys(saved).filter((k) => k !== '_about' && fs.existsSync(path.join(REPO, k)) && read(k).includes('fill(')),
      ...STAMPED.map((n) => `tests/fixtures/door_stamps/${n}.pine`),
      'tests/fixtures/member/uncharted-clouds.pine',
    ]
    const seen = { none: 0, color: 0, transp: 0 }
    const bad = []
    for (const s of scripts) {
      const b = memberPaneDefinition({ source: read(s), id: 'u_door-stamp-corpus' })
      if (!b.ok) continue
      const pv = stampedPineVersion(b.definition)
      for (const p of b.definition.plots) {
        const stamp = fillTransparencyStamp(p)
        if (!stamp) continue
        seen[stamp.via] += 1
        if (stampedFillOpacity(stamp, pv) !== p.fillOpacity) bad.push(`${s} ${p.key}: ${JSON.stringify(stamp)} → ${stampedFillOpacity(stamp, pv)} vs ${p.fillOpacity}`)
      }
    }
    expect(bad).toEqual([])
    expect(seen.none).toBeGreaterThan(0)
    expect(seen.color).toBeGreaterThan(0)
    expect(seen.transp).toBeGreaterThan(0)
  }, 600000)
})

describe('one upgrade from the stamps, by one fixture', () => {
  for (const c of FIXTURE.cases) {
    it(`${c.name}`, () => {
      const doc = applyOps(docOf(c.base), c.ops)
      const before = JSON.stringify(doc)
      const rules = c.rules === 'future' ? FUTURE_RULES : DOOR_FILL_RULES
      const out = upgradeFromDoorStamps(doc, rules)
      expect(JSON.stringify(doc), 'pure').toBe(before)
      const keys = Object.keys(c.expect)
      if (!keys.length) {
        expect(out).toBe(doc)
      } else {
        const want = JSON.parse(before)
        for (const k of keys) want.plots.find((p) => p.key === k).fillOpacity = c.expect[k]
        expect(out).toEqual(want)
        expect(out.compute).toBe(doc.compute)
        expect(out.meta).toBe(doc.meta)
      }
      // ⭐ idempotent: a second load changes nothing
      expect(upgradeFromDoorStamps(out, rules)).toBe(out)
      if (c.validates) {
        const v = validateDefinition(doc)
        expect(v.ok, (v.errors || []).join(' ')).toBe(true)
        expect(validateDefinition(out).ok).toBe(true)
      }
    })
  }
})

describe('on load, the hashes, and the editors', () => {
  it('the chart installs a stamped document with its stamps intact, and resolves a stated-nothing band', () => {
    const doc = docOf('tests/fixtures/door_stamps/v6-fills.json')
    delete doc.plots.find((p) => p.key === 'value').fillOpacity
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors).toEqual([])
    const inst = defs.find((d) => d.id === doc.id)
    expect(inst.meta.pineVersion).toBe(6)
    expect(inst.meta.doorVersion).toBe(DOOR_VERSION)
    expect(inst.plots.find((p) => p.key === 'value').fillOpacity).toBe(1)
    expect(inst.plots.find((p) => p.key === 'out3').fillTransparency).toEqual({ value: 87.5, via: 'color' })
    // the composite seam is idempotent too
    const once = migrateMemberDocument(doc)
    expect(migrateMemberDocument(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('⛔ an UNSTAMPED old save is never guessed (the pre-#526 Clouds document)', () => {
    const old = JSON.parse(read('tests/fixtures/pine_param_ids/clouds-saved-master-e3-edit.json')).definition
    expect(upgradeFromDoorStamps(old)).toBe(old)
  })

  it('⭐ the stamps are in NO hash: tree hash, trees hash, semantic identity are the unstamped document\'s', () => {
    // meta and plots[].fillTransparency ride OUTSIDE the trees; `def_hash` is
    // astHash(compute.ast) + meta.semantics only, so two saves of one script — one
    // stamped, one from before the stamps — file their results under ONE name.
    const stamped = docOf('tests/fixtures/door_stamps/v6-fills.json')
    const bare = applyOps(docOf('tests/fixtures/door_stamps/v6-fills.json'), FIXTURE.cases[1].ops)
    expect(bare.meta.pineVersion).toBeUndefined()
    expect(astHash(stamped.compute.ast)).toBe(astHash(bare.compute.ast))
    expect(stamped.compute).toEqual(bare.compute)
    expect(semanticIdentity(astHash(stamped.compute.ast), semanticsOf(stamped)))
      .toBe(semanticIdentity(astHash(bare.compute.ast), semanticsOf(bare)))
  })

  it('⛔ every editor that rebuilds a band drops its stamp, so an edited band is never upgraded', () => {
    const doc = docOf('tests/fixtures/door_stamps/v6-fills.json')
    const band = doc.plots.find((p) => p.key === 'out3')
    expect(band.fillTransparency).toBeTruthy()
    // the manual Builder's reopen
    expect(restorableRowFields(band)).not.toHaveProperty('fillTransparency')
    // the conversational model
    const m = modelOf(doc)
    expect(m.rows.find((r) => r.key === 'out3')).not.toHaveProperty('fillTransparency')
    expect(m.rows.find((r) => r.key === 'out3').fillOpacity).toBe(0.125)
  })
})
