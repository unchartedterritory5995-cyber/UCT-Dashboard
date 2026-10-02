// app/src/components/chart/engine/ast/paramIdLegacy.test.js
//
// C46 — the frozen legacy parameter-id map, and the three lanes
// `docs/pine/param-ids.json` does not pin.
//
// ⛔⛔ `paramIds.test.js` pins ONE lane: `translatePine(src, {strict, paramManifest})`.
// No member door translates that way. PineBox and the member pane both go through
// `memberInputTranslation`, which DECLARES the inputs a formula can carry as an
// identifier — and a declared input does not mint — so under the old counter the
// same script numbered differently at the door a member saves from. Measured at
// base `e4e24524ef`: 37 corpus scripts hold a different id for the same input in
// the member-pane lane than in the pinned lane (133 of 634 ids). The frozen map
// keeps every lane's numbering; this file is what pins the other three.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { translatePine, lexPine } from './pine.js'
import { memberInputTranslation } from '../../builder/builderInputs.js'
import { LEGACY_PARAM_IDS, LEGACY_LANES } from './paramIdLegacy.js'
import { SOURCE_ID_BASE, scriptKey, decodeLegacyLane, paramIdNumber } from './paramIdSource.js'
import { OOS_ABSENT, partialNote } from './__tests__/oosLocalOnly.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const LANES_FIXTURE = path.join(REPO, 'tests/fixtures/pine_param_ids/legacy-lanes.json')
const PINNED = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/pine/param-ids.json'), 'utf8'))
const FIXTURE = JSON.parse(fs.readFileSync(LANES_FIXTURE, 'utf8'))
const ABSENT = new Set(OOS_ABSENT.map((n) => `tests/fixtures/pine_oos/${n}`))
const present = (k) => !ABSENT.has(k) && fs.existsSync(path.join(REPO, k))
const read = (k) => fs.readFileSync(path.join(REPO, k), 'utf8')

/** id → sourceName, as one lane translates the script today. */
const LANE = {
  plainScreen: (src) => translatePine(src, { paramManifest: true }),
  memberStrict: (src) => memberInputTranslation(translatePine, src, { paramManifest: true, strict: true }),
  memberScreen: (src) => memberInputTranslation(translatePine, src, { paramManifest: true }),
}
const mapOf = (t) => Object.fromEntries((t.inputParams || []).map((p) => [p.id, p.sourceName]))

/** A lane's frozen list differs from the pinned lane's: the scripts the per-lane
 *  map exists for. */
function laneDiffers(script, lane) {
  const enc = LEGACY_PARAM_IDS[scriptKey(lexPine(read(script)).tokens)]
  const a = decodeLegacyLane(enc, 0)
  const b = decodeLegacyLane(enc, LEGACY_LANES.indexOf(lane))
  return JSON.stringify(a) !== JSON.stringify(b)
}

/** ⛔ What may and may not differ from the frozen fixture:
 *   - an id the fixture names must address the SAME input, and must still exist;
 *   - an id the fixture does not name must be a SOURCE id (above the base) — a
 *     script may gain a parameter, it may never gain a second small-number id. */
function drift(script, lane) {
  const was = (FIXTURE[script] || {})[lane] || {}
  const now = mapOf(LANE[lane](read(script)))
  const out = []
  for (const id of Object.keys(was)) {
    if (now[id] !== was[id]) out.push({ script, lane, id, was: was[id], now: now[id] ?? '(absent)' })
  }
  for (const id of Object.keys(now)) {
    if (!(id in was) && paramIdNumber(id) <= SOURCE_ID_BASE) {
      out.push({ script, lane, id, was: '(absent)', now: now[id] })
    }
  }
  return out
}

describe('C46 — the frozen legacy map does not change', () => {
  it('⛔⛔ FROZEN: the data is byte-for-byte what was measured at base e4e24524ef', () => {
    // ⛔ A red here is never fixed by updating the digest. An entry is an address
    // into documents members have saved; a script that gains a parameter gains a
    // SOURCE id, which needs no entry.
    const keys = Object.keys(LEGACY_PARAM_IDS)
    expect(keys.length).toBe(183)
    expect(keys).toEqual([...keys].sort())
    const digest = createHash('sha256').update(JSON.stringify(LEGACY_PARAM_IDS)).digest('hex')
    expect(digest).toBe('8a33a3fad041188a2aaa661c77a9ab3b41c71546a148ddbf547a6136ff0e656c')
  })

  it(`⛔ every script the pinned artifact gives ids to has an entry of that length${partialNote()}`, () => {
    const scripts = Object.keys(PINNED).filter(present)
    expect(scripts.length).toBeGreaterThan(290)
    const wrong = []
    const seen = new Set()
    for (const script of scripts) {
      const key = scriptKey(lexPine(read(script)).tokens)
      const pinnedIds = PINNED[script].threw ? [] : Object.keys(PINNED[script])
      const lane0 = decodeLegacyLane(LEGACY_PARAM_IDS[key], 0) || []
      // dense: the pinned ids are exactly 1..k, and the entry lists k distinct ordinals
      const dense = pinnedIds.every((id) => paramIdNumber(id) >= 1 && paramIdNumber(id) <= pinnedIds.length)
      if (!dense || lane0.length !== pinnedIds.length || new Set(lane0).size !== lane0.length) {
        wrong.push({ script, pinned: pinnedIds.length, entry: lane0.length })
      }
      if (key in LEGACY_PARAM_IDS) seen.add(key)
    }
    expect(wrong).toEqual([])
    // every entry belongs to a corpus script on this machine, or to a named absentee
    expect(Object.keys(LEGACY_PARAM_IDS).length - seen.size).toBeLessThanOrEqual(ABSENT.size)
  })

  it('⛔ the largest legacy id is far below the source-id base, so the two ranges cannot meet', () => {
    let max = 0
    for (const enc of Object.values(LEGACY_PARAM_IDS)) {
      for (let lane = 0; lane < LEGACY_LANES.length; lane += 1) {
        max = Math.max(max, (decodeLegacyLane(enc, lane) || []).length)
      }
    }
    expect(max).toBeGreaterThan(10)
    expect(max).toBeLessThan(SOURCE_ID_BASE / 10)
  })
})

describe('C46 — the lanes a member actually saves from keep their ids', () => {
  const scripts = Object.keys(FIXTURE).filter((k) => k !== '_about' && present(k))

  it('NON-VACUITY — the fixture is here, and the lanes really do disagree with the pinned one', () => {
    expect(scripts.length).toBeGreaterThan(150)
    const differing = scripts.filter((s) => laneDiffers(s, 'memberStrict'))
    expect(differing.length, 'no script differs — the per-lane map would be decoration').toBeGreaterThan(25)
  })

  it('⛔⛔ plain SCREEN lane: every frozen id still addresses the same input', () => {
    const moved = []
    for (const s of scripts.filter((k) => FIXTURE[k].plainScreen)) moved.push(...drift(s, 'plainScreen'))
    expect(moved, `parameter ids moved:\n${JSON.stringify(moved, null, 2)}`).toEqual([])
  }, 600000)

  for (const lane of ['memberStrict', 'memberScreen']) {
    it(`⛔⛔ ${lane}: every frozen id still addresses the same input, through the member door`, () => {
      const targets = scripts.filter((s) => FIXTURE[s][lane])
      // the scripts the per-lane map exists for are in the set, not sampled out
      expect(targets.filter((s) => laneDiffers(s, lane)).length).toBeGreaterThan(25)
      const moved = []
      for (const s of targets) moved.push(...drift(s, lane))
      expect(moved, `parameter ids moved:\n${JSON.stringify(moved, null, 2)}`).toEqual([])
    }, 900000)
  }
})
