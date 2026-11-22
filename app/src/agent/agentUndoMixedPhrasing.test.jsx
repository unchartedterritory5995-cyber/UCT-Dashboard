// #1076 AUDIT rail: MIXED phrasings that carry an undo word ("never mind …", "put it back …") make Undo AVAILABLE to the
// planner (v1 routing word rule, routing.js `undo` group) and NOTHING runs it by itself.
//   • Under v1 routing the instant/fast path (fastParse, and every local claim the real panel makes) never claims an
//     undo for them: the sentence reaches the planner (one model turn), with agent.undo in the manifest it was sent.
//   • A scripted plan of JUST the add (or JUST the discard) runs NO undo: the earlier change (an RSI added by the fast
//     path, the newest entry of the undo stack) stays, and no undo outcome or refusal is written.
// The model is scripted (panelHarness v1 envelope queue). No paid model call. Evidence: LOCAL jsdom, BROWSER-MOCK-MODEL.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { fastParse } from './fastPath'
import { selectGroups } from './routing'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const MIXED = ['never mind the rsi, add macd', 'never mind, throw that draft away', 'put it back in my order']
const UNDO_SAID = /nothing of mine to undo|undid|took back|back to (?:how|the way)|removed rsi/i

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const ieRef = (body) => (body.context.indicatorEdits || [])[0]?.ref
const addMacd = (body) => p.env('apply', [{ action: 'indicator.add', target: ieRef(body), args: { defId: 'macd', inputs: null } }])
const discard = () => p.env('apply', [{ action: 'indicator.discardDraft', target: 'draft:new', args: {} }])
const defs = (board) => p.instancesOn(board, 'c').map(i => i.defId)

describe('#1076 — mixed undo phrasings: Undo becomes available, nothing runs it by itself (v1 routing)', () => {
  it.each(MIXED)('"%s": the undo group is selected, and the fast path never claims an undo', (text) => {
    expect(selectGroups(text).selected).toContain('undo')
    const fp = fastParse(text)
    expect(fp?.kind).not.toBe('undo')
    for (const o of fp?.ops || []) expect(o.action).not.toBe('agent.undo')
  })

  it.each([
    ['never mind the rsi, add macd', addMacd, ['rsi', 'macd']],
    ['never mind, throw that draft away', discard, ['rsi']],
    ['put it back in my order', addMacd, ['rsi', 'macd']],
  ])('"%s" through the real panel: one planner turn, a plan without agent.undo runs no undo', async (text, plan, after) => {
    const { say, board } = p.mount(...ONE('BRCB'))
    await say('add rsi')                                        // the fast path's change: the newest entry of the undo stack
    expect(defs(board)).toEqual(['rsi'])
    expect(p.turns()).toBe(0)
    p.st.envelopes.push(plan)
    const out = await say(text)
    expect(p.turns()).toBe(1)                                   // no local claim: the planner was asked
    const body = p.lastTurnBody()
    expect(body.routing?.selected || []).toContain('undo')      // Undo AVAILABLE to the planner …
    expect((body.capabilities || []).map(c => c.name)).toContain('agent.undo')
    expect(defs(board)).toEqual(after)                          // … and nothing ran it: the RSI stays
    expect(out).not.toMatch(UNDO_SAID)
  }, 30000)
})
