// EXECUTION FAMILIES, ROUND 6 — HELD-OUT phrasings (pl-exec, exec-gen-1). Written and committed BEFORE any round 6 change and never
// used to change it. Evidence class: SIMULATED (scripted model).
export const NOTE_CREATE_HELD_OUT = [
  { row: 'C3-202', text: 'start a fresh note in the notebook widget' },
  { row: 'C3-202', text: 'open a new blank note for me in the notebook' },
]
export const FLAGGED_HELD_OUT = [
  { row: 'C3-065', text: 'show my flagged names in the watchlist widget' },
  { row: 'C3-065', text: 'switch the watchlist panel over to flagged' },
]
export const EARNINGS_HELD_OUT = [{ text: 'when are NVDA earnings due' }, { text: 'nvda next report date?' }]

import { describe, it, expect } from 'vitest'
describe('round 6 held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...NOTE_CREATE_HELD_OUT, ...FLAGGED_HELD_OUT, ...EARNINGS_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
