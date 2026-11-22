// CAPABILITY REGRESSION · ROUTING COLLISIONS under NLM-1 ROUTING V2 (dark): for every row of the collision table
// (baseline/routingCollisions.json) v2 RECOGNISES the message (no broad fallback), SELECTS the owner group, and ranks
// it within the top two of its scored groups (the row's `also` groups aside) — a scored group never buries the
// owner's language. The words-only table (routingCollision.test.js) is unchanged and still binds v2: v1's regexes
// are v2's boost layer.
import { describe, it, expect } from 'vitest'
import { registerCatalog } from './testing/registry'
import { selectGroupsV2 } from '../../nlm1/routingV2'
import table from './baseline/routingCollisions.json'
import { pinClock } from './testing/clock'

pinClock()
await registerCatalog()

describe('routing collisions (v2) — the owner group is recognised, selected and ranked first or second', () => {
  for (const row of table.rows) {
    it(`"${row.text}" → ${row.owner} (v2)`, () => {
      const s = selectGroupsV2(row.text)
      expect(s.matched, `"${row.text}" fell back to every group`).toBe(true)
      expect(s.selected, `"${row.text}" did not select its owner`).toContain(row.owner)
      const rank = s.ranked.map(([g]) => g).filter(g => !(row.also || []).includes(g)).indexOf(row.owner)
      expect(rank, `"${row.text}": ${row.owner} ranked ${rank}`).toBeGreaterThanOrEqual(0)
      expect(rank, `"${row.text}": ${row.owner} buried at rank ${rank}`).toBeLessThanOrEqual(1)
    })
  }
})
