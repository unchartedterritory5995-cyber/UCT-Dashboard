// P2 integration — the conversation's opaque telemetry id on the wire.
import { describe, it, expect } from 'vitest'
import { converseBody, CONVERSATION_ID_RE } from './converseClient'
import { newAuthoringState, openAuthoringState } from './authoringState'

describe('conversationId (cost telemetry only)', () => {
  it('is the conversation lineage, stable across turns of ONE conversation', () => {
    const s = newAuthoringState()
    const a = converseBody({ message: 'RSI 14', state: s })
    const b = converseBody({ message: 'make it 21', state: s })
    expect(a.conversationId).toBe(s.lineage)
    expect(b.conversationId).toBe(a.conversationId)
    expect(CONVERSATION_ID_RE.test(a.conversationId)).toBe(true)
  })

  it('a NEW conversation gets a NEW id; a post-save reopen keeps it when the lineage is passed', () => {
    const one = newAuthoringState()
    const two = newAuthoringState()
    expect(converseBody({ message: 'x', state: two }).conversationId).not.toBe(one.lineage)
    const reopened = openAuthoringState(null, { lineage: one.lineage })
    expect(converseBody({ message: 'x', state: reopened }).conversationId).toBe(one.lineage)
  })

  it('holds no message or formula text, and a malformed lineage is omitted', () => {
    const s = newAuthoringState()
    const body = converseBody({ message: 'RSI 14 above 70', state: s })
    // ⛔ THE SHAPE, NOT A SEARCH FOR DIGITS. The id is random hex (`auth_` + 12), so a test for
    // "no 70" failed whenever the hex happened to contain 70 (about 4% of runs, 2026-11-16).
    // An id of exactly this shape cannot carry the member's words; a hex-only alphabet has no
    // room for "RSI" or "above", and the control below shows the check can fail.
    expect(body.conversationId).toMatch(/^auth_[0-9a-f]{12}$/)
    expect(body.conversationId).not.toMatch(/rsi|above/i)
    expect('auth_rsi14above70').not.toMatch(/^auth_[0-9a-f]{12}$/)   // control: words break the shape
    const bad = converseBody({ message: 'x', state: { ...s, lineage: 'has spaces <x>' } })
    expect('conversationId' in bad).toBe(false)
  })
})
