// NEWS FILTER PRESETS: RENAME / DELETE. HELD-OUT phrasings (pl-exec round 8, C3-140 completion; branch agent/pl/r8-presets).
// Written and committed BEFORE the change and never used to tune it. Evidence class: SIMULATED (scripted model).
// The widget's saved presets in every case: "Earnings Watch", "Macro only", "Fed search".
export const PRESET_RENAME_HELD_OUT = [
  { row: 'C3-140', text: 'rename my Earnings Watch preset on the news widget to Earnings Week', preset: 'Earnings Watch', name: 'Earnings Week' },
  { row: 'C3-140', text: 'call the macro only filter set Macro Desk instead', preset: 'Macro only', name: 'Macro Desk' },
]
export const PRESET_DELETE_HELD_OUT = [
  { row: 'C3-140', text: 'delete the Fed search preset from the trade exchange news', preset: 'Fed search' },
  { row: 'C3-140', text: 'get rid of my macro only filter set on the news widget', preset: 'Macro only' },
]

import { describe, it, expect } from 'vitest'
describe('preset rename / delete held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...PRESET_RENAME_HELD_OUT, ...PRESET_DELETE_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
