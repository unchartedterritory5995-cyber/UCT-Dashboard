// ANSWERS TO THE AGENT'S OWN CHOICE QUESTION — HELD-OUT phrasings (pl-exec round 8, family 4, unseen8 class 2). Written after
// the mechanism (pickOffered) but BEFORE any test of it ran, and never used to tune it. Board FOUR (TL SPY, TR QQQ, BL NVDA,
// BR TSLA), no click; the request "make this chart weekly" makes UCT ask, offering the four charts in board order.
// `want`: the option the answer picks (its position in the offered list, 1-based), or 'ask' (two fit: asked again with them).
export const CHOICE_HELD_OUT = [
  { id: 'a1', answer: '3', want: 3 },
  { id: 'a2', answer: 'the second one', want: 2 },
  { id: 'a3', answer: 'option 4', want: 4 },
  { id: 'a4', answer: 'the last one', want: 4 },
  { id: 'a5', answer: 'top right', want: 2 },
  { id: 'a6', answer: 'the TSLA one', want: 4 },
  { id: 'a7', answer: 'the top one', want: 'ask' },
  { id: 'a8', answer: 'left', want: 'ask' },
]

import { describe, it, expect } from 'vitest'
describe('choice-answer held-out set is frozen data', () => {
  it('ids are unique', () => { expect(new Set(CHOICE_HELD_OUT.map(c => c.id)).size).toBe(CHOICE_HELD_OUT.length) })
})
