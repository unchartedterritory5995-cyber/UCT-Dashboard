// P3 slice "talk" — TALK continuity and truth, the browser half.
// ASKED / CLAIMED / DID per case, classified. No network, no model: every
// converse call is a stub.
//
//   * the pre-flight's SHARED tables (preflightCases.json `cases` + `shapes`) give
//     the browser the same verdicts the server asserts (tests/test_p3_truth_talk.py);
//   * a QUESTION is never intercepted, CAN SLIM is never ticker CAN, possessive /
//     adjacent other-symbol AUTHORING is caught with zero calls;
//   * recent-turn snippets carry the assistant's own replies (answer AND change),
//     bounded at 1200 characters, six turns;
//   * an ANSWER never mutates; a later CHANGE continues the SAME lineage;
//   * ConverseBox shows the model's reply on change / clarify turns as SECONDARY
//     text beside the deterministic readback; a planner refusal is said once.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent, act, renderHook } from '@testing-library/react'
import CASES from '../../builder/authoring/preflightCases.json'
import { preflight, messageShape, isQuestion, otherSymbolNamed, GATE_SYMBOL } from '../../builder/authoring/preflight'
import {
  CONVERSE_LIMITS, boundedSnippets, snippetOf, transcriptSnippets, distinctNotUnderstood, converseTurn,
} from '../../builder/authoring/converseClient'
import { classifyTurn, OUTCOMES } from '../../builder/authoring/turnOutcome'
import { newAuthoringState, applyTurn } from '../../builder/authoring/authoringState'
import { parseFormula } from '../ast/parse'
import { clearUserDefinitions } from '../nativeRegistry'
import { _resetSessions, newKey } from '../../builder/authoring/conversationSessions'
import ConverseBox from '../../builder/ConverseBox'
import useIndicatorConversation from '../../builder/studio/useIndicatorConversation'

const C = 'uct.authoring.patch/1'
const AAPL = { sym: 'AAPL', tf: 'D' }
const createRsi = (rev) => ({ contract: C, baseRevision: rev, ops: [{ op: 'create', name: 'RSI overbought', outputs: [{ tree: parseFormula('rsi(close, 14) > 70').ast }] }] })

// ═══ 1. the shared tables — the SAME verdicts as the server ══════════════════
describe('pre-flight + question detector: the shared tables', () => {
  it.each(CASES.cases.map((c) => [c.message, c.chart, c.gate]))('case %s @ %j → %s', (message, chart, gate) => {
    const got = preflight(message, chart)
    expect(got ? got.gate : null).toBe(gate)
  })
  it.each(CASES.shapes.map((s) => [s.message, s.shape]))('shape %s → %s', (message, shape) => {
    expect(messageShape(message)).toBe(shape)
  })
  it('the tables are not thin', () => {
    expect(CASES.cases.filter((c) => c.p3).length).toBeGreaterThanOrEqual(30)
    expect(CASES.shapes.length).toBeGreaterThanOrEqual(25)
  })
})

describe('the five audit probes: none is intercepted before the model', () => {
  it.each([
    'What period would you recommend for a swing trader?',
    'What would you include in an earnings table for CAN SLIM characteristics?',
    "What's the difference between above 70 and crossing above 70?",
    'Why might that be better?',
    'Make it faster.',
  ])('%s → reaches the model (VALUE: no browser refusal)', (m) => {
    expect(preflight(m, AAPL)).toBeNull()
  })
})

describe('other symbol — questions pass, possessive / adjacent authoring is caught', () => {
  it('CAN SLIM is never ticker CAN (authoring or question)', () => {
    for (const m of ['Build an earnings check for CAN SLIM stocks', 'Add a CAN-SLIM style filter on RSI',
      'What would you include in an earnings table for CAN SLIM characteristics?']) {
      expect(preflight(m, AAPL)).toBeNull()
      expect(otherSymbolNamed(m, AAPL)).toBeNull()
    }
  })
  it.each([
    ["Only when SPY's RSI is above 50", 'SPY'],
    ['SPY RSI above 50', 'SPY'],
    ["use QQQ's close", 'QQQ'],
  ])('%s → refused in the browser, naming %s (REFUSAL, zero calls)', (m, t) => {
    const r = preflight(m, AAPL)
    expect(r.gate).toBe(GATE_SYMBOL)
    expect(r.detail).toBe(t)
    expect(r.reason).toMatch(new RegExp(`${t}, another symbol`))
  })
  it('a QUESTION naming another symbol is NOT intercepted, but the detector still sees it (the server backstop)', () => {
    expect(isQuestion('What does RSI on SPY look like?')).toBe(true)
    expect(preflight('What does RSI on SPY look like?', AAPL)).toBeNull()
    expect(otherSymbolNamed('What does RSI on SPY look like?', AAPL)).toBe('SPY')
  })
  it('the chart\'s own symbol is never another symbol', () => {
    expect(preflight("Only when AAPL's RSI is above 50", AAPL)).toBeNull()
    expect(preflight('AAPL RSI above 50', AAPL)).toBeNull()
  })
})

// ═══ 2. follow-up context ═══════════════════════════════════════════════════
describe('snippets: the assistant\'s own replies, bounded at 1200', () => {
  it('the client mirrors the server bounds (6 turns, 1200 characters)', () => {
    expect(CONVERSE_LIMITS).toMatchObject({ maxSnippets: 6, maxSnippetChars: 1200 })
    const long = 'x'.repeat(1500)
    const got = boundedSnippets(Array.from({ length: 9 }, () => ({ role: 'assistant', text: long })))
    expect(got).toHaveLength(6)
    expect(got[0].text).toHaveLength(1200)
  })
  it('a CHANGE entry carries its reply FIRST, then the readback; an ANSWER is not repeated', () => {
    expect(snippetOf({ role: 'uct', kind: 'patched', reply: 'Length is now 50.', lines: ['Line: the 50-bar EMA'] }))
      .toEqual({ role: 'assistant', text: 'Length is now 50. · Line: the 50-bar EMA' })
    expect(snippetOf({ role: 'uct', kind: 'answer', reply: 'Shorter reacts faster.', lines: ['Shorter reacts faster.'] }))
      .toEqual({ role: 'assistant', text: 'Shorter reacts faster.' })
    expect(transcriptSnippets([{ role: 'member', text: 'hi' }, { role: 'uct', lines: ['a'] }]))
      .toEqual([{ role: 'member', text: 'hi' }, { role: 'assistant', text: 'a' }])
  })
  it('a planner refusal is said ONCE: the item restated as the reason is not listed again', () => {
    const reason = '"McGinley Dynamic" is not one of this door\'s supported functions or concepts.'
    const res = { ok: false, gate: 'concept:ungrounded', reason, notUnderstood: [{ phrase: 'McGinley Dynamic', reason }, { phrase: 'cheap', reason: 'other' }] }
    expect(distinctNotUnderstood(res).map((n) => n.phrase)).toEqual(['cheap'])
    expect(distinctNotUnderstood({ ok: true, notUnderstood: [{ reason }] })).toHaveLength(1)
  })
})

// ═══ 3. answer → no mutation → later change continues the SAME lineage ════════
describe('client flow: ANSWER then CHANGE on one lineage (stubbed server)', () => {
  it('ASKED: create, then a question, then a change. DID: the answer touched nothing; the change is revision 2 of the same lineage, and its request carried the answer as context', async () => {
    const bodies = []
    const replies = [
      { ok: true, disposition: 'change', reply: 'Created it.', turn: 'patch', envelope: createRsi(0) },
      { ok: true, disposition: 'answer', reply: 'A 21-bar RSI is smoother and slower.', turn: 'noop', envelope: { contract: C, baseRevision: 1, ops: [] } },
      { ok: true, disposition: 'change', reply: 'Threshold is now 80.', turn: 'patch',
        envelope: { contract: C, baseRevision: 1, ops: [{ op: 'set_output_tree', output: 'value', tree: parseFormula('rsi(close, 14) > 80').ast }] } },
    ]
    const fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      const body = replies[bodies.length - 1]
      return { ok: true, status: 200, json: async () => body }
    })
    const transcript = []
    let state = newAuthoringState()
    const lineage = state.lineage
    const turn = async (message) => {
      const res = await converseTurn({ message, state, gateCtx: { symbol: 'AAPL', tf: 'D' }, snippets: transcriptSnippets(transcript), fetchImpl })
      transcript.push({ role: 'member', text: message })
      const t = classifyTurn(res)
      if (t.outcome === OUTCOMES.ANSWER) { transcript.push({ role: 'uct', kind: 'answer', reply: t.reply, lines: [t.reply] }); return t }
      const out = applyTurn(state, t.envelope, { gateCtx: { symbol: 'AAPL', tf: 'D' } })
      expect(out.result.status).toBe('applied')
      state = out.state
      // P3S: a CHANGE entry carries the deterministic lines only -- never the model's prose
      transcript.push({ role: 'uct', kind: 'patched', lines: ['Updated preview.'] })
      return t
    }
    await turn('RSI above 70')
    expect(state.revision).toBe(1)
    const afterCreate = state
    const a = await turn('Would 21 be smoother?')
    expect(a.outcome).toBe(OUTCOMES.ANSWER)
    expect(state).toBe(afterCreate)                       // ⛔ not even an equal copy
    await turn('Make the threshold 80')
    expect(state.revision).toBe(2)
    expect(state.lineage).toBe(lineage)
    expect(bodies.map((b) => b.conversationId)).toEqual([lineage, lineage, lineage])
    const ctx = bodies[2].snippets.map((s) => s.text).join(' | ')
    expect(ctx).not.toMatch(/Created it\./)                // ⛔ P3S: a CHANGE's prose never rides along
    expect(ctx).toMatch(/A 21-bar RSI is smoother and slower\./)  // and the ANSWER
  })
})

// ═══ 4. the surfaces ═════════════════════════════════════════════════════════
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }

describe('ConverseBox: the model reply is SECONDARY text beside the readback', () => {
  beforeEach(() => { _resetSessions(); clearUserDefinitions() })
  afterEach(() => { cleanup(); clearUserDefinitions() })
  const send = async (text) => {
    fireEvent.change(screen.getByLabelText(/Describe the indicator|Change it/), { target: { value: text } })
    fireEvent.click(screen.getByTestId('converse-send'))
    await flush()
  }
  it('change: the readback lines ONLY (P3S: no model prose); clarify: the reply beside the questions', async () => {
    const converse = vi.fn(async ({ message, state }) => (/average/.test(message)
      ? { ok: true, disposition: 'clarify', reply: 'Two averages fit.', turn: 'question', notUnderstood: [], unavailable: [],
        envelope: { contract: C, baseRevision: state.revision, ops: [], questions: [{ id: 'q1', text: 'Which average?', choices: ['EMA', 'SMA'] }] } }
      : { ok: true, disposition: 'change', reply: 'I built an RSI above 70.', turn: 'patch', notUnderstood: [], unavailable: [], envelope: createRsi(state.revision) }))
    render(createElement(ConverseBox, { converse, sessionKey: newKey('p3a') }))
    await send('RSI above 70')
    // ⛔ P3S: the change's prose is not shown -- the readback is the whole entry
    expect(screen.queryAllByTestId('converse-assistant-reply')).toHaveLength(0)
    const t = screen.getByTestId('converse-transcript').textContent
    expect(t).toMatch(/Updated preview\./)
    expect(t).not.toMatch(/I built an RSI above 70/)
    await send('add an average')
    expect(screen.getAllByTestId('converse-assistant-reply').at(-1).textContent).toBe('Assistant: Two averages fit.')
    expect(screen.getByTestId('converse-transcript').textContent).toMatch(/Which average\?/)
    // ⛔ P3S: and the next request does NOT carry the change's prose as context
    await send('EMA')
    const ctx = converse.mock.calls.at(-1)[0].snippets.map((s) => s.text).join(' | ')
    expect(ctx).not.toMatch(/I built an RSI above 70\./)
    expect(ctx).toMatch(/Two averages fit\./)
  })
  it('a planner refusal reads its sentence ONCE', async () => {
    const reason = '"McGinley Dynamic" is not one of this door\'s supported functions or concepts, so there is no formula to expand it into.'
    const converse = vi.fn(async () => ({ ok: false, gate: 'concept:ungrounded', reason,
      notUnderstood: [{ phrase: 'McGinley Dynamic', clause: 'Add the McGinley Dynamic', gate: 'concept:ungrounded', reason }], unavailable: [] }))
    render(createElement(ConverseBox, { converse, sessionKey: newKey('p3b') }))
    await send('Add the McGinley Dynamic')
    const text = screen.getByTestId('converse-transcript').textContent
    expect(text.split('supported functions or concepts').length - 1).toBe(1)
  })
})

describe('studio hook: a CHANGE reaches the next turn as its deterministic readback (P3S)', () => {
  afterEach(() => { cleanup(); clearUserDefinitions() })
  it('the snippet for a CHANGE entry is the readback, never the model prose; an answer leaves state untouched', async () => {
    const seen = []
    const converse = vi.fn(async ({ message, state, snippets }) => {
      seen.push(snippets)
      if (/\?$/.test(message)) return { ok: true, disposition: 'answer', reply: 'Higher thresholds fire less often.', turn: 'noop', envelope: { contract: C, baseRevision: state.revision, ops: [] }, notUnderstood: [], unavailable: [] }
      return { ok: true, disposition: 'change', reply: 'Built RSI above 70.', turn: 'patch', envelope: createRsi(state.revision), notUnderstood: [], unavailable: [] }
    })
    const { result } = renderHook(() => useIndicatorConversation({ sym: 'AAPL', tf: 'D', converse }))
    await act(async () => { await result.current.send('RSI above 70') })
    const after = result.current.state
    await act(async () => { await result.current.send('Why 70?') })
    expect(result.current.state).toBe(after)
    await act(async () => { await result.current.send('make it 80') })
    const ctx = seen.at(-1).map((s) => s.text)
    expect(ctx.some((t) => t.includes('Built RSI above 70.'))).toBe(false)   // ⛔ the prose
    expect(ctx.some((t) => /RSI/.test(t) && /70/.test(t))).toBe(true)        // the readback of the result
    expect(ctx).toContain('Higher thresholds fire less often.')
  })
})
