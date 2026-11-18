// EXECUTION FAMILIES, ROUND 7 — HELD-OUT phrasings (pl-exec, exec-gen-1). Written and committed BEFORE any round 7 change and never
// used to change it. Evidence class: SIMULATED (scripted model).
// C3-138: type into a widget's own search box (the News (Trade Exchange) widget's "Search headlines").
export const SEARCH_HELD_OUT = [
  { row: 'C3-138', text: 'look up tariff headlines in the news widget', value: 'tariff' },
  { row: 'C3-138', text: 'search the trade exchange feed for guidance', value: 'guidance' },
]
export const SEARCH_CLEAR_HELD_OUT = [{ row: 'C3-138', text: 'clear the search box on the news widget', value: '' }]

import { describe, it, expect } from 'vitest'
describe('round 7 held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...SEARCH_HELD_OUT, ...SEARCH_CLEAR_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
