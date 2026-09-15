// app/src/components/chart/__tests__/movingAverageDiscovery.test.js
//
// ─── THE CAPABLE MOVING AVERAGE IS THE ONE YOU FIND ─────────────────────────
//
// ⚰️⚰️ THE OWNER WANTED A 50-PERIOD AVERAGE OF QQQ AND CONCLUDED THE PRODUCT
// COULD NOT DO IT. It could, and had been able to for phases: `movingAverage`
// declares `{ key: 'source', type: 'source' }`, Chart Data's inline editor
// renders a `SourceField` for exactly that, and the Display control writes
// through `setInstanceDisplayTarget`. Every piece was shipped and working.
//
// ⛔ WHAT FAILED WAS THE BROWSE LIST. Two rows are called "Moving Average":
//
//     id 'ma'            legacy, PRICE-ONLY, no source input, built-in
//     id 'movingAverage' source-capable
//
// `matches()` is a boolean filter with no scoring, so "ranks above" is decided
// entirely by the order `libraryRows` pushes rows — and built-ins came first
// unconditionally. The member searched "moving average", took the top row, and
// correctly found no Source control on it. Worse, the capable row did not carry
// the tag 'moving average' at all, so it was not even in the result set for the
// most obvious query.
//
// ⚠️ THIS IS A DISCOVERABILITY RAIL, NOT A MIGRATION. Both definitions still
// exist, both keep their ids, and no saved chart changes. If someone ever
// consolidates the two, these cases should be deleted rather than "fixed" —
// they are about the list, not about the engine.

import { describe, it, expect } from 'vitest'
import { libraryRows } from '../discoveryCatalog'
import { matches } from '../IndicatorLibraryDialog'
import { BUILT_IN_ROWS } from '../indicatorCatalog'
import * as registry from '../engine/nativeRegistry'

const rows = () => libraryRows(registry)
const find = (id) => rows().find((r) => r.id === id)
const hit = (q) => rows().filter((r) => matches(r, q))

describe('⚰️⚰️ searching "moving average" reaches the capable one first', () => {
  it('both rows still exist, with their ids unchanged', () => {
    // ⛔ THE COMPATIBILITY ASSERTION. A member workflow that reaches for the
    // legacy row must still find it, and every saved chart addresses these by id.
    expect(find('ma'), 'the legacy Moving Average was removed').toBeTruthy()
    expect(find('movingAverage'), 'the source-capable Moving Average was removed').toBeTruthy()
    expect(BUILT_IN_ROWS.some((r) => r.id === 'ma')).toBe(true)
  })

  it('⭐ the capable row is named for what it DOES, not for its schema field', () => {
    expect(find('movingAverage').name).toBe('Moving Average (Flexible Source)')
    expect(find('movingAverage').name).not.toContain('(Source)')
    // …and the legacy row says what IT is, so the pair is tellable apart.
    expect(find('ma').name).toBe('Moving Average')
    expect(find('ma').description.toLowerCase()).toContain('price')
  })

  for (const q of [
    'moving average', 'ma source', 'moving average source',
    'sma source', 'ema source', 'sma', 'ema', 'average',
  ]) {
    it(`⭐ "${q}" finds the capable row, and ranks it above the legacy one`, () => {
      const found = hit(q)
      const capable = found.findIndex((r) => r.id === 'movingAverage')
      expect(capable, `"${q}" did not match the capable Moving Average at all`).toBeGreaterThanOrEqual(0)
      const legacy = found.findIndex((r) => r.id === 'ma')
      if (legacy >= 0) {
        expect(capable, `"${q}" put the price-only row first: `
          + `${found.slice(0, 3).map((r) => r.name).join(' | ')}`).toBeLessThan(legacy)
      }
    })
  }

  it('⛔ and the legacy row is still REACHABLE by its own searches', () => {
    // Ranking it below the capable one must not mean burying it.
    for (const q of ['moving average', 'ma', 'sma']) {
      expect(hit(q).some((r) => r.id === 'ma'), `"${q}" lost the legacy row`).toBe(true)
    }
  })
})

describe('⛔ the capability the name is now advertising is really there', () => {
  it('⭐⭐ the capable definition declares a canonical `source` input', () => {
    // This is what the rename promises. If the input ever goes away the name is
    // a lie, and this is the case that says so.
    const def = registry.getDefinition
      ? registry.getDefinition('movingAverage')
      : registry.definitionOf?.('movingAverage')
    expect(def, 'movingAverage definition not resolvable').toBeTruthy()
    const inputs = def.inputs || []
    const source = inputs.find((i) => i && i.type === 'source')
    expect(source, 'the "Flexible Source" row has no source input').toBeTruthy()
    expect(source.key).toBe('source')
  })

  it('⛔ the LEGACY row genuinely has none — the distinction is real', () => {
    // If this ever starts passing, the two definitions have converged and the
    // whole discoverability problem is gone; delete these rails then.
    const legacy = find('ma')
    expect(legacy.target, 'the legacy row stopped being price-only').toBe('price')
    expect(legacy.engineOwned, 'the legacy row became engine-owned').toBe(false)
  })
})
