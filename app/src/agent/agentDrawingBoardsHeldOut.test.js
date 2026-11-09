// DRAWING BOARDS — HELD-OUT phrasings (pl-exec round 8, rows C1-167..170). Written and committed BEFORE the capability's tests,
// never used to tune them. The member has boards "Swing" (active) and "Earnings". `op` / `board` / `name`: the plan a correct
// planner sends; `want`: what the board panel must read after.
export const BOARD_HELD_OUT = [
  { id: 'b1', text: 'switch my drawings over to the earnings drawing board', op: 'switch', board: 'Earnings', name: null, want: { active: 'Earnings' } },
  { id: 'b2', text: 'make a fresh drawing board called breakouts', op: 'create', board: null, name: 'Breakouts', want: { has: 'Breakouts' } },
  { id: 'b3', text: 'rename the swing drawing board to swing trades', op: 'rename', board: 'Swing', name: 'Swing trades', want: { has: 'Swing trades', not: 'Swing' } },
  { id: 'b4', text: 'get rid of the earnings drawing board', op: 'delete', board: 'Earnings', name: null, want: { not: 'Earnings' } },
]

import { describe, it, expect } from 'vitest'
describe('drawing boards held-out set is frozen data', () => {
  it('ids are unique', () => { expect(new Set(BOARD_HELD_OUT.map(c => c.id)).size).toBe(BOARD_HELD_OUT.length) })
})
