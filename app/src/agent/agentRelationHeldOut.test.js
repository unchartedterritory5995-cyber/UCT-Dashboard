// RELATIVE AND SPATIAL TARGETING — HELD-OUT phrasings (pl-exec, AUDIT S2-B round 2, owner priority 2026-11-08). Written and
// committed BEFORE the general fix and never used to tune it (AUDIT's probe-7 three are included verbatim, as asked). Boards:
//   TWO   A | B                      THREE  L | M | R
//   FOUR  c0 TL | c1 TR              SIX    s0 | s1 | s2
//         c2 BL | c3 BR                     s3 | s4 | s5
// `click`: the chart clicked (null = none); `want`: the chart meant, 'ask' (no single chart), or 'click' (a coordination with a
// non-chart noun: the sentence acts on the click as before). Every outcome is the neighbour or an ask, NEVER the click, except 'click'.
export const REL_HELD_OUT = [
  // AUDIT probe 7
  { id: 'p7a', board: 'FOUR', click: 'c0', text: 'add RSI to the one below', change: 'rsi', want: 'c2' },
  { id: 'p7b', board: 'FOUR', click: 'c0', text: 'put a MACD on the one to the right', change: 'macd', want: 'c1' },
  { id: 'p7c', board: 'FOUR', click: 'c0', text: 'the rsi looks good here, now make the one below weekly', change: 'weekly', want: 'c2' },
  // FOUR, with a click
  { id: 'f1', board: 'FOUR', click: 'c0', text: 'add rsi to the chart below', change: 'rsi', want: 'c2' },
  { id: 'f2', board: 'FOUR', click: 'c0', text: 'make the chart beside it weekly', change: 'weekly', want: 'c1' },
  { id: 'f3', board: 'FOUR', click: 'c0', text: 'log scale on the chart under this one', change: 'log', want: 'c2' },
  { id: 'f4', board: 'FOUR', click: 'c3', text: 'make the chart above weekly', change: 'weekly', want: 'c1' },
  { id: 'f5', board: 'FOUR', click: 'c3', text: 'the one to the left needs an rsi', change: 'rsi', want: 'c2' },
  { id: 'f6', board: 'FOUR', click: 'c3', text: 'put the chart above this one on log scale', change: 'log', want: 'c1' },
  // FOUR, no click
  { id: 'f7', board: 'FOUR', click: null, text: 'make the chart below weekly', change: 'weekly', want: 'ask' },
  { id: 'f8', board: 'FOUR', click: null, text: 'make the bottom left chart weekly', change: 'weekly', want: 'c2' },
  { id: 'f9', board: 'FOUR', click: null, text: 'top right one on log scale', change: 'log', want: 'c1' },
  // TWO
  { id: 't1', board: 'TWO', click: 'A', text: 'make the chart to the right weekly', change: 'weekly', want: 'B' },
  { id: 't2', board: 'TWO', click: 'A', text: 'add a macd to the one next to it', change: 'macd', want: 'B' },
  { id: 't3', board: 'TWO', click: null, text: 'log scale on the chart to the left', change: 'log', want: 'ask' },
  // THREE in a row
  { id: 'r1', board: 'THREE', click: 'M', text: 'make the one to the right weekly', change: 'weekly', want: 'R' },
  { id: 'r2', board: 'THREE', click: 'M', text: 'add rsi to the chart left of this one', change: 'rsi', want: 'L' },
  { id: 'r3', board: 'THREE', click: 'M', text: 'the chart next to this one on log scale', change: 'log', want: 'ask' },
  { id: 'r4', board: 'THREE', click: 'L', text: 'make the one to its right weekly', change: 'weekly', want: 'M' },
  // SIX (two rows of three)
  { id: 's1', board: 'SIX', click: 's1', text: 'make the chart below weekly', change: 'weekly', want: 's4' },
  { id: 's2', board: 'SIX', click: 's1', text: 'add rsi to the one on its left', change: 'rsi', want: 's0' },
  { id: 's3', board: 'SIX', click: 's4', text: 'log scale on the chart above this one', change: 'log', want: 's1' },
  // coordination with a non-chart noun: the sentence acts on the click
  { id: 'k1', board: 'FOUR', click: 'c2', text: 'make it weekly and delete the alert and the one above it', change: 'weekly', want: 'click' },
  { id: 'k2', board: 'FOUR', click: 'c2', text: 'weekly on this one, the levels I drew and the one below stay', change: 'weekly', want: 'click' },
]

import { describe, it, expect } from 'vitest'
describe('relative-targeting held-out set is frozen data', () => {
  it('at least 20 cases, unique ids, probe 7 included', () => {
    expect(REL_HELD_OUT.length).toBeGreaterThanOrEqual(20)
    expect(new Set(REL_HELD_OUT.map(c => c.id)).size).toBe(REL_HELD_OUT.length)
    expect(REL_HELD_OUT.filter(c => c.id.startsWith('p7'))).toHaveLength(3)
  })
})
