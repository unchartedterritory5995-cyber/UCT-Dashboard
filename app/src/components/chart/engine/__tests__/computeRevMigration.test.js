import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { listDefinitions } from '../nativeRegistry'

// Phase C Task 7 — `compute.rev`, and the alert lane that has to migrate on it.
//
// ⭐ WHY THIS FILE IS HERE AT ALL. `compute.rev` is authored in this registry and
// consumed, for alerts, by a table in ANOTHER LANGUAGE:
// `api/services/alert_rev_migration.ADDRESS_REVS`. The Python rail
// (`tests/test_alert_rev_migration.py::test_the_python_rev_table_matches_the_JS_registry`)
// keeps the two in step by PARSING THIS FILE'S SOURCE — so a future bump lands
// red over there until the migration is actually run.
//
// ⛔ A CROSS-LANGUAGE RAIL THAT PARSES SOURCE HAS A SILENT FAILURE MODE: if the
// shape it greps for changes, the parse matches nothing and the comparison
// degrades to "{} == {}" — green, and blind. The shape is therefore asserted
// HERE, next to the definitions, where a refactor of it would be made.
const REGISTRY = join(process.cwd(), 'src', 'components', 'chart', 'engine', 'nativeRegistry.js')

/** The Python rail's regex, character for character. */
const REV_OVERRIDE = /fn:\s*'([a-zA-Z0-9_]+)'\s*,\s*rev:\s*(\d+)/g

describe('compute.rev — the revision a stored binding migrates on', () => {
  it('every definition carries an integer revision >= 1', () => {
    const defs = listDefinitions()
    expect(defs.length).toBeGreaterThan(0)
    for (const def of defs) {
      expect(Number.isInteger(def.compute.rev), `${def.id} has no usable compute.rev`).toBe(true)
      expect(def.compute.rev).toBeGreaterThanOrEqual(1)
    }
  })

  it('⭐ `vwap` is the ONE definition off the shared revision — and that is the migration population', () => {
    // `VWAP_SESSION_ANCHOR` (2026-08-03) moved the numbers and bumped
    // `compute.rev` to 2. The record's §9f said the bump had "no population to
    // act on today"; §10 records that this stopped being true once `vwap` became
    // an alertable address.
    //
    // ⚠️ Asserted as the WHOLE off-default set, not `vwap === 2`. A second
    // definition quietly bumped without a migration is precisely the event this
    // is watching for, and a single-key assertion cannot see it.
    const offDefault = listDefinitions().filter(d => d.compute.rev !== 1).map(d => d.id)
    expect(offDefault).toEqual(['vwap'])
  })

  it('the SOURCE SHAPE the Python rail parses is still the shape that is authored', () => {
    const src = readFileSync(REGISTRY, 'utf8')
    expect(src, 'nativeDef no longer declares the default revision inline')
      .toContain("compute: { kind: 'native', fn, rev: 1 }")

    const parsed = [...src.matchAll(REV_OVERRIDE)].map(m => [m[1], Number(m[2])])
    expect(parsed.length, 'the cross-lane regex now matches nothing — the Python rail is blind')
      .toBeGreaterThan(0)
    // Only a NON-default revision is a migration; an explicit `rev: 1` (the
    // server lane writes one) is the default spelled out and must not be read as
    // a bump. Both sides filter identically.
    expect(parsed.filter(([, rev]) => rev !== 1)).toEqual([['vwap', 2]])
  })
})
