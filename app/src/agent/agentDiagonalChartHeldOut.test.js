// DIAGONAL RELATIVE REFERENCES: HELD-OUT phrasings (pl-exec, unseen9 P1 fix; branch agent/pl/fix-relative-refs). Written and
// committed BEFORE the fix and never used to tune it. FOUR board: c0 top-left, c1 top-right, c2 bottom-left, c3 bottom-right.
// Evidence class: SIMULATED (scripted model).
export const DIAGONAL_HELD_OUT = [
  { text: 'put the chart across the diagonal from this one on weekly', clicked: 'c1', meant: 'c2' },
  { text: 'switch the kitty corner chart from this one to weekly', clicked: 'c3', meant: 'c0' },
  { text: 'make the one catty-corner to this chart weekly', clicked: 'c2', meant: 'c1' },
]

import { describe, it, expect } from 'vitest'
describe('diagonal held-out set is frozen data', () => {
  it('no phrasing appears twice; each names a different chart than the click', () => {
    expect(new Set(DIAGONAL_HELD_OUT.map(c => c.text)).size).toBe(DIAGONAL_HELD_OUT.length)
    for (const c of DIAGONAL_HELD_OUT) expect(c.meant).not.toBe(c.clicked)
  })
})
