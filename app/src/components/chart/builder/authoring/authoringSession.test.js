// app/src/components/chart/builder/authoring/authoringSession.test.js
//
// ⭐ M3 S1 (gate G1) — ONE conversational authoring pipeline. The Create Indicator dock's
// hook is a React wrapper over `authoringSession.js`; it carries none of the pipeline
// itself, so UCT Agent (through `agentAuthoring.js`) and the dock cannot drift apart.
import { describe, it, expect } from 'vitest'
import HOOK_SRC from '../studio/useIndicatorConversation.js?raw'
import SESSION_SRC from './authoringSession.js?raw'
import { newAuthoringState } from './index'
import { localTurn, modelTurn, undoTurn, hasSomethingToKeep, previewDefinitionOf, NOTHING_CHANGED } from './authoringSession'
import { STUDIO_PREVIEW_DEF_ID } from '../studio/chartPreview'
import CASES from './preflightCases.json'

describe('the dock runs the shared pipeline (source rails)', () => {
  it('the hook imports the pipeline from authoringSession and calls none of its seams itself', () => {
    expect(HOOK_SRC).toMatch(/from '\.\.\/authoring\/authoringSession'/)
    for (const seam of ['classifyTurn(', 'applyTurn(', 'preflight(', 'storeConversation(', 'attachConversation(',
      'armConversationAlerts(', 'renamePatch(', 'withMemberName(', 'undoState(', 'stampSemantics(']) {
      const name = seam.slice(0, -1)
      expect(new RegExp(`(?<![A-Za-z_$])${name}\\(`).test(HOOK_SRC), `the hook calls ${seam} directly — a second copy of the pipeline`).toBe(false)
    }
    for (const fn of ['localTurn(', 'modelTurn(', 'undoTurn(', 'saveConversation(', 'restoreConversation(']) {
      expect(HOOK_SRC.includes(fn), `the hook no longer calls ${fn}`).toBe(true)
    }
  })
  it('the pipeline module is React-free', () => {
    expect(SESSION_SRC).not.toMatch(/from 'react'/)
    expect(SESSION_SRC).not.toMatch(/\buse(State|Effect|Ref|Callback|Memo)\(/)
  })
})

describe('the moved steps behave as the hook did', () => {
  it('a pre-flighted other-symbol request is answered locally, nothing changes', () => {
    const c = CASES.cases.find((x) => x.gate)
    const out = localTurn(newAuthoringState(), c.message, { sym: c.chart.sym, tf: c.chart.tf })
    expect(out).toMatchObject({ ok: false, state: null, changed: false })
    expect(out.entries[0]).toMatchObject({ kind: 'unsupported', preflight: true, gate: c.gate })
    expect(out.entries[0].lines.at(-1)).toBe(NOTHING_CHANGED)
  })
  it('an ordinary request is not local (the model is asked)', () => {
    expect(localTurn(newAuthoringState(), 'Add a 20 EMA.', { sym: 'AAPL', tf: 'D' })).toBeNull()
  })
  it('an ANSWER leaves the state untouched; a refused turn returns no state', async () => {
    const st = newAuthoringState()
    const answer = await modelTurn(st, () => st, 'what is RSI?', {
      converse: async () => ({ ok: true, disposition: 'answer', reply: 'RSI is a momentum oscillator.', turn: 'noop', envelope: null }) })
    expect(answer).toMatchObject({ ok: true, state: null, changed: false })
    const refused = await modelTurn(st, () => st, 'x', { converse: async () => ({ ok: false, gate: 'cost:user', reason: 'allowance used' }) })
    expect(refused).toMatchObject({ ok: false, state: null, changed: false, gate: 'cost:user' })
  })
  it('undo of nothing is null; nothing to keep for a fresh conversation; no preview without a definition', () => {
    const st = newAuthoringState()
    expect(undoTurn(st)).toBeNull()
    expect(hasSomethingToKeep({ state: st, transcript: [] })).toBe(false)
    expect(previewDefinitionOf(st)).toBeNull()
    expect(STUDIO_PREVIEW_DEF_ID).toBe('u_studio-preview')
  })
})
