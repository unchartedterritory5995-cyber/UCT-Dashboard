// PROGRAM MD-1: the open turn has one opaque id (the gateway's per-turn budget key); none outside a turn,
// and the next turn gets a new one. Capabilities read it with currentTurnId() — no plumbing through env.
import { describe, it, expect } from 'vitest'
import { turnStart, turnEnd, currentTurnId } from './trace'

describe('turn scope (MD-1 budget key)', () => {
  it('one id per turn, null outside a turn, a fresh id next turn', () => {
    turnEnd()                                   // no open turn left over from another test
    expect(currentTurnId()).toBeNull()
    expect(turnStart('send')).toBe(true)
    const a = currentTurnId()
    expect(a).toMatch(/^t-/)
    expect(turnStart('click')).toBe(false)      // an Apply inside the message's turn keeps the same id
    expect(currentTurnId()).toBe(a)
    turnEnd()
    expect(currentTurnId()).toBeNull()
    turnStart('send')
    expect(currentTurnId()).not.toBe(a)
    turnEnd()
  })
})
