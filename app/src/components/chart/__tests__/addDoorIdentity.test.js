// app/src/components/chart/__tests__/addDoorIdentity.test.js
//
// ─── ONE CREATED OBJECT, ONE CANONICAL IDENTITY, MANY UI DOORS ──────────────
//
// ⚰️⚰️ THE SAME DEFINITION ARRIVED AS TWO DIFFERENT KINDS OF OBJECT depending on
// which door the member used:
//
//     catalogue / scenario add   → addInstance()         → inst:dataSeries:1
//     Chart Data browse "+ Add"  → toggledRow()
//                                → setIndicatorEnabled() → legacy:dataSeries
//
// Measured in the harness, same chart, same definition — the second one is
// ABSENT from the normalised engine instances, so `paneOwnKeys` never sees it,
// no pane key is produced and `paneCountRequired` stays 1. The member sets
// "Display in = Own Pane", the intent is stored correctly, and no pane ever
// appears.
//
// ⛔ `legacy:<defId>` IS COMPATIBILITY IDENTITY. It stands for shipped settings
// being adapted into the engine. A member clicking ＋ Add is authoring a NEW
// instance; the UI door must not decide which architecture that object enters.

import { describe, it, expect } from 'vitest'
import { addInstance, findInstance } from '../engine/instanceControls'
import { legacyInstanceId } from '../engine/instances'
import { toggledRow } from '../IndicatorLibraryDialog'
import * as registry from '../engine/nativeRegistry'

/** The exact rule `addRow` and `addAnother` now share. */
const addViaDoor = (row, settings) => {
  const revivable = !row.builtIn && !!findInstance(settings, legacyInstanceId(row.id))
  return (row.builtIn || revivable)
    ? toggledRow(row, settings, registry)
    : addInstance(settings, row.id, registry)
}

const idsOf = (cs) => (cs.indicatorInstances || []).map((i) => i.instanceId)
const DATA_ROW = { id: 'dataSeries', name: 'Data Series', builtIn: false, carvedOut: false }

describe('⚰️⚰️ the browse door mints a MODERN instance', () => {
  it('⛔⛔ THE REGRESSION: the old path minted a legacy identity', () => {
    // The pre-fix call — `toggledRow` unconditionally. Kept as the control so
    // the fix below is not proving something that never went wrong.
    const old = toggledRow(DATA_ROW, { indicatorInstances: [] }, registry)
    expect(idsOf(old), 'the legacy door stopped minting legacy ids — is the bug gone?')
      .toContain(legacyInstanceId('dataSeries'))
  })

  it('⭐⭐ THE FIX: the browse door mints inst:<defId>:<n>', () => {
    const cs = addViaDoor(DATA_ROW, { indicatorInstances: [] })
    const ids = idsOf(cs)
    expect(ids.some((i) => /^inst:dataSeries:\d+$/.test(i)), `got ${JSON.stringify(ids)}`).toBe(true)
    expect(ids).not.toContain(legacyInstanceId('dataSeries'))
  })

  it('⭐ browse and catalogue converge on the same identity FAMILY', () => {
    const viaBrowse = idsOf(addViaDoor(DATA_ROW, { indicatorInstances: [] }))
    const viaCatalogue = idsOf(addInstance({ indicatorInstances: [] }, 'dataSeries', registry))
    const family = (id) => id.replace(/:\d+$/, '')
    expect(viaBrowse.map(family)).toEqual(viaCatalogue.map(family))
  })

  it('⭐⭐ two Data Series get UNIQUE stable ids and coexist', () => {
    // The reason (A) was chosen: one `legacy:dataSeries` cannot represent two
    // independently-sourced series.
    let cs = addViaDoor(DATA_ROW, { indicatorInstances: [] })
    cs = addViaDoor(DATA_ROW, cs)
    const ids = idsOf(cs).filter((i) => i.startsWith('inst:dataSeries:'))
    expect(ids.length, `expected two, got ${JSON.stringify(idsOf(cs))}`).toBe(2)
    expect(new Set(ids).size, 'the two instances share an id').toBe(2)
  })

  it('⛔ a BUILT-IN row still goes through the legacy writer', () => {
    // Moving averages and the volume pane have no definition to instantiate;
    // `addInstance` would return settings by identity and the ＋ would write
    // nowhere. The fix must not touch them.
    const builtIn = { id: 'ma', name: 'Moving Average', builtIn: 'overlay' }
    const before = { overlays: [], indicatorInstances: [] }
    const after = addViaDoor(builtIn, before)
    expect(idsOf(after), 'a built-in row minted an engine instance').toEqual([])
    expect(after).not.toBe(before)
  })

  it('⛔⛔ a REVIVABLE legacy instance is revived, not duplicated', () => {
    // The compatibility half of the same rule: a tombstoned `legacy:<id>` carries
    // the member's edited period and colour. Minting a fresh instance would hand
    // back a default-configured indicator and strand their old one.
    const legacyId = legacyInstanceId('rsi')
    const withLegacy = { indicatorInstances: [{ defId: 'rsi', instanceId: legacyId, inputs: { period: 21 } }] }
    const row = { id: 'rsi', name: 'RSI', builtIn: false, carvedOut: false }
    const after = addViaDoor(row, withLegacy)
    const ids = idsOf(after)
    expect(ids, 'the revivable legacy instance was abandoned').toContain(legacyId)
    expect(ids.filter((i) => i.startsWith('inst:rsi:')).length,
      'a duplicate modern instance was minted alongside the legacy one').toBe(0)
  })
})
