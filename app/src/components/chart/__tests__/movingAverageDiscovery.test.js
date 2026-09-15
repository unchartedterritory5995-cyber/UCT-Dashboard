// app/src/components/chart/__tests__/movingAverageDiscovery.test.js
//
// ─── ONE MOVING AVERAGE, AND IT IS THE CAPABLE ONE ──────────────────────────
//
// ⚰️⚰️ THE OWNER WANTED A 50-PERIOD AVERAGE OF QQQ AND CONCLUDED THE PRODUCT
// COULD NOT DO IT. It could, and had been able to for phases: `movingAverage`
// declares `{ key: 'source', type: 'source' }`, Chart Data's inline editor
// renders a `SourceField` for exactly that, and the Display control writes
// through `setInstanceDisplayTarget`. Every piece was shipped and working.
//
// ⛔ WHAT FAILED WAS THE BROWSE LIST. Two rows were called "Moving Average":
// `ma` (legacy, PRICE-ONLY, no source input, a `cs.overlays` built-in) and
// `movingAverage` (source-capable). Built-ins are pushed first, so the member
// took the price-only one and correctly found no Source control.
//
// ⭐ THERE IS ONE ROW NOW. The capable definition carries the plain name and the
// legacy row is `supersededBy` it — hidden from browsing, still registered, so
// every saved chart keeps working and legacy MAs stay individually manageable
// in Chart Data (which lists them from `liveOverlays`, never from this row).

import { describe, it, expect } from 'vitest'
import { libraryRows } from '../discoveryCatalog'
import { matches } from '../IndicatorLibraryDialog'
import { BUILT_IN_ROWS, discoverableBuiltIns, catalogRows, userCatalogRows } from '../indicatorCatalog'
import * as registry from '../engine/nativeRegistry'

const rows = () => libraryRows(registry)
const hit = (q) => rows().filter((r) => matches(r, q))
const find = (id) => rows().find((r) => r.id === id)

describe('⚰️⚰️ searching "moving average" gives ONE obvious answer', () => {
  for (const q of ['moving average', 'ma', 'sma', 'ema', 'average', 'ma source', 'sma source']) {
    it(`⭐ "${q}" returns exactly one Moving Average row, and it is the capable one`, () => {
      const found = hit(q).filter((r) => /^moving average/i.test(r.name))
      expect(found.length, `"${q}" offered ${found.length}: ${found.map((r) => `${r.name}[${r.id}]`).join(' | ')}`)
        .toBe(1)
      expect(found[0].id).toBe('movingAverage')
      expect(found[0].name).toBe('Moving Average')
    })
  }

  it('⛔ the name carries no engine vocabulary', () => {
    // "(Source)" / "(Flexible Source)" are schema words. A member thinks "I added
    // a Moving Average and chose what it averages", not "I picked the
    // source-aware variant".
    expect(find('movingAverage').name).toBe('Moving Average')
    expect(find('movingAverage').name).not.toMatch(/source/i)
  })

  it('⛔ the legacy row is not offered for browsing…', () => {
    expect(find('ma'), 'the superseded price-only row is still in the browse list').toBeUndefined()
    expect(discoverableBuiltIns().some((r) => r.id === 'ma')).toBe(false)
  })

  it('⭐⭐ …but it is STILL REGISTERED — hidden is not deleted', () => {
    // The compatibility half. Saved charts address it by id; removing it would
    // break them, which is why this is a browse-list statement and not a
    // migration.
    const legacy = BUILT_IN_ROWS.find((r) => r.id === 'ma')
    expect(legacy, 'the legacy definition was deleted').toBeTruthy()
    expect(legacy.supersededBy).toBe('movingAverage')
    expect(legacy.target).toBe('price')
  })

  it('⛔ EVERY browse surface honours it, not just the one I was looking at', () => {
    // `BUILT_IN_ROWS` is unioned separately by three surfaces; a row hidden in
    // one would still be offered by the other two.
    const all = [...discoverableBuiltIns(), ...catalogRows(registry), ...userCatalogRows(registry)]
    expect(all.some((r) => r.id === 'ma')).toBe(false)
    expect(all.some((r) => r.id === 'movingAverage')).toBe(true)
  })
})

describe('⛔ the capability the single row now promises is really there', () => {
  const defOf = (id) => (registry.getDefinition ? registry.getDefinition(id) : registry.definitionOf?.(id))

  it('⭐⭐ it declares a canonical `source` input', () => {
    const def = defOf('movingAverage')
    expect(def, 'movingAverage definition not resolvable').toBeTruthy()
    const source = (def.inputs || []).find((i) => i && i.type === 'source')
    expect(source, 'the only Moving Average row has no source input').toBeTruthy()
    expect(source.key).toBe('source')
  })

  it('⛔ and its DEFAULT is the conventional price average', () => {
    // Adding "a 20-day MA on NVDA" must stay a two-click operation; the new
    // capability may not make the ordinary case feel like a configuration task.
    const def = defOf('movingAverage')
    const source = (def.inputs || []).find((i) => i.type === 'source')
    expect(source.default, 'the default source is no longer price close').toBe('close')
    expect(def.placement?.target, 'the default display is no longer the candles').toBe('price')
  })
})
