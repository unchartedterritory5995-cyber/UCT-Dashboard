// SCANNER / FILTER OPERATIONS — HELD-OUT phrasings (pl-exec round 8, family 2; branch agent/pl/r8-scanner-filter). Written and
// committed BEFORE any change of this family and never used to tune it. Evidence class: SIMULATED (scripted model).
// C3-140: apply one of the News (Trade Exchange) widget's own saved filter presets, by its name.
export const PRESET_HELD_OUT = [
  { row: 'C3-140', text: 'use my Earnings Watch preset on the news widget', preset: 'Earnings Watch' },
  { row: 'C3-140', text: 'switch the trade exchange news to the macro only filter set', preset: 'Macro only' },
]
// C3-108: leave the scan a Scanner widget shows, back to its picker
export const SCAN_BACK_HELD_OUT = [
  { row: 'C3-108', text: 'close this scan and show me the scanner list again' },
  { row: 'C3-108', text: 'back to the scan picker on the scanner widget' },
]
// C3-194: the Market Map follows the linked list (its own Follow toggle)
export const FOLLOW_HELD_OUT = [
  { row: 'C3-194', text: 'make the market map follow my linked list', value: true },
  { row: 'C3-194', text: 'stop the market map following the list', value: false },
]

import { describe, it, expect } from 'vitest'
describe('scanner / filter held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...PRESET_HELD_OUT, ...SCAN_BACK_HELD_OUT, ...FOLLOW_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
