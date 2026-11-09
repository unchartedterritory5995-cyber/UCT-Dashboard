// SHARED-CHANGE CLAUSES and ANCHORLESS RELATIONS — HELD-OUT phrasings (pl-exec, exec-gen-1, 2026-11-07, after pl-auto's unseen4 /
// unseen5 browser runs). Written and committed BEFORE the change and never used to tune it; pl-auto's own failing sentences are
// the tuning set, so none of theirs is repeated here. Board FOUR: c0 TL SPY, c1 TR NVDA, c2 BL AMD, c3 BR TSLA. Evidence class:
// SIMULATED (scripted model).
// `charts`: the charts the ONE change must land on (in any order); 'ask' = asked, nothing changes.
export const SHARED_HELD_OUT = [
  { id: 's1', click: 'c0', text: 'weekly on the AMD chart and this one as well', change: 'weekly', charts: ['c2', 'c0'] },
  { id: 's2', click: 'c3', text: 'log scale here and on the NVDA chart', change: 'log', charts: ['c3', 'c1'] },
  { id: 's3', click: 'c1', text: 'this chart and the bottom-left one to monthly', change: 'monthly', charts: ['c1', 'c2'] },
]
export const ANCHORLESS_HELD_OUT = [
  { id: 'a1', click: 'c2', text: 'switch the chart above to weekly', change: 'weekly', charts: ['c0'] },
  { id: 'a2', click: 'c0', text: 'log scale on the one to the right', change: 'log', charts: ['c1'] },
  { id: 'a3', click: null, text: 'make the chart below weekly', change: 'weekly', charts: 'ask' },
]

import { describe, it, expect } from 'vitest'
describe('shared-clause / anchorless held-out sets are frozen data', () => {
  it('ids are unique', () => {
    const all = [...SHARED_HELD_OUT, ...ANCHORLESS_HELD_OUT]
    expect(new Set(all.map(c => c.id)).size).toBe(all.length)
  })
})
