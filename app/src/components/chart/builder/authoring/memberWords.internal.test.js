// AN INTERNAL ERROR NEVER TELLS THE MEMBER TO REPHRASE (ruling 2026-11-18).
//
// Found live: a remembered choice broke a turn inside the door, and the window said "The UCT Agent
// couldn't produce a valid change for that. Try rephrasing it." No wording of the request would
// have gone differently. The failure is ours, so the sentence says so and says what to do.

import { describe, it, expect } from 'vitest'
import { memberRefusal, INTERNAL } from './memberWords'

describe('internal:error in member words', () => {
  const said = memberRefusal('internal:error', 'anything the server said')

  it('says it was on our side, that nothing changed, and to try again', () => {
    expect(said).toBe("That didn't work on our side and nothing was changed. Try again in a moment.")
    expect(said).toBe(INTERNAL)
  })

  it('never asks the member to rephrase, and never blames the request', () => {
    expect(said).not.toMatch(/rephras|valid change|for that/i)
  })

  it('is said whatever reason the server sent, including none', () => {
    expect(memberRefusal('internal:error')).toBe(INTERNAL)
    expect(memberRefusal('internal:anything-else', 'x')).toBe(INTERNAL)
  })

  it('CONTROL: a fault in the answer itself still gets the rephrase sentence, and an outage its own', () => {
    expect(memberRefusal('envelope:schema', 'x')).toMatch(/Try rephrasing it/)
    expect(memberRefusal('model:no-tool', 'x')).toMatch(/Try rephrasing it/)
    expect(memberRefusal('model:transport', 'x')).toMatch(/briefly unavailable/)
    expect(memberRefusal('model:transport', 'x')).not.toBe(INTERNAL)
  })
})
