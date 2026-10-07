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
    expect(body.conversationId).not.toMatch(/rsi|70|above/i)
    const bad = converseBody({ message: 'x', state: { ...s, lineage: 'has spaces <x>' } })
    expect('conversationId' in bad).toBe(false)
  })
})
