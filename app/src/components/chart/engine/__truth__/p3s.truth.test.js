// app/src/components/chart/engine/__truth__/p3s.truth.test.js
//
// ⭐ P3S — reliability hardening. Each block reproduces a defect measured in the
// P3R real-model acceptance run and pins the fix.
//
//   1. CHANGE-TURN TRUTH. The real model's reply on a change said "Its name still
//      says 'EMA 20'" while the deterministic readback (correctly) said EMA 50. A
//      change now shows the readback of the RESULT only; the prose is neither shown
//      nor carried back to the model as context. ANSWER / CLARIFY / UNSUPPORTED keep
//      their words.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent, act, renderHook } from '@testing-library/react'
import { parseFormula } from '../ast/parse'
import { clearUserDefinitions } from '../nativeRegistry'
import { _resetSessions, newKey } from '../../builder/authoring/conversationSessions'
import ConverseBox from '../../builder/ConverseBox'
import CreateIndicatorPanel from '../../builder/studio/CreateIndicatorPanel'
import useIndicatorConversation from '../../builder/studio/useIndicatorConversation'

const C = 'uct.authoring.patch/1'
const STALE = "Done — the EMA now uses a 50-bar length instead of 20. Its name still says \"EMA 20\", so just say the word if you'd like it renamed."
const createEma = (rev, n) => ({ contract: C, baseRevision: rev, ops: [{ op: 'create', name: `EMA ${n}`, outputs: [{ key: `ema${n}`, tree: parseFormula(`ema(close, ${n})`).ast }] }] })
const setLen = (rev, n) => ({ contract: C, baseRevision: rev, ops: [{ op: 'set_slot', slot: 'ema20#1', value: n }] })
const ok = (disposition, envelope, reply) => ({ ok: true, disposition, reply, turn: disposition === 'change' ? 'patch' : 'noop', envelope, notUnderstood: [], unavailable: [] })

/** The P3R conversation: create EMA 20, then "Make it 50." answered with the stale prose. */
const p3rConverse = () => vi.fn(async ({ message, state }) => {
  if (/faster/.test(message)) {
    return ok('clarify', { contract: C, baseRevision: state.revision, ops: [], questions: [{ id: 'q', text: 'Shorter length, or a quicker average?', choices: ['10', 'Hull'] }] },
      '"Faster" could mean two things, so I haven\'t changed anything yet.')
  }
  if (/\?$/.test(message)) return ok('answer', { contract: C, baseRevision: state.revision, ops: [] }, '50 is the common intermediate-term choice.')
  if (/50/.test(message)) return ok('change', setLen(state.revision, 50), STALE)
  return ok('change', createEma(state.revision, 20), 'I added a 20-bar EMA.')
})

const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }

describe('1. CHANGE-TURN TRUTH — the model is not the authority on applied state', () => {
  beforeEach(() => { _resetSessions(); clearUserDefinitions() })
  afterEach(() => { cleanup(); clearUserDefinitions() })

  it('studio hook: the change entry carries the readback of EMA 50 and none of the stale prose', async () => {
    const converse = p3rConverse()
    const { result } = renderHook(() => useIndicatorConversation({ sym: 'XRPN', tf: 'D', converse }))
    await act(async () => { await result.current.send('Add a 20 EMA.') })
    await act(async () => { await result.current.send('Make it 50.') })
    const entry = result.current.transcript.at(-1)
    expect(entry.kind).toBe('patched')
    expect(entry.reply).toBeUndefined()
    const text = entry.lines.join(' ')
    expect(text).toMatch(/EMA 50/)
    expect(text).toMatch(/50-bar exponential average/)
    expect(text).not.toMatch(/still says/)
    expect(text).not.toMatch(/EMA 20/)
    // …and the stale claim never rides back to the model as context
    await act(async () => { await result.current.send('Why 50?') })
    const ctx = converse.mock.calls.at(-1)[0].snippets.map((s) => s.text).join(' | ')
    expect(ctx).not.toMatch(/still says/)
    expect(ctx).toMatch(/EMA 50/)
  })

  it('studio hook: ANSWER, CLARIFY keep their conversational words', async () => {
    const converse = p3rConverse()
    const { result } = renderHook(() => useIndicatorConversation({ sym: 'XRPN', tf: 'D', converse }))
    await act(async () => { await result.current.send('Add a 20 EMA.') })
    await act(async () => { await result.current.send('What would you use?') })
    expect(result.current.transcript.at(-1)).toMatchObject({ kind: 'answer', lines: ['50 is the common intermediate-term choice.'] })
    await act(async () => { await result.current.send('Make it faster.') })
    const q = result.current.transcript.at(-1)
    expect(q.kind).toBe('question')
    expect(q.lines.join(' ')).toMatch(/haven't changed anything yet/)
  })

  it('studio panel: the rendered change shows "Updated preview" + the readback, never the prose', async () => {
    const converse = p3rConverse()
    render(createElement(CreateIndicatorPanel, { onClose: () => {}, sym: 'XRPN', tf: 'D', converse, onStudioPreview: () => {} }))
    const box = screen.getByRole('textbox')
    for (const text of ['Add a 20 EMA.', 'Make it 50.']) {
      fireEvent.change(box, { target: { value: text } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await flush()
    }
    const log = screen.getByTestId('create-indicator-log').textContent
    expect(log).toMatch(/EMA 50/)
    expect(log).not.toMatch(/still says/)
    expect(log).not.toMatch(/I added a 20-bar EMA/)
  })

  it('ConverseBox: a change renders no "Assistant:" line; a clarify still does', async () => {
    const converse = p3rConverse()
    render(createElement(ConverseBox, { converse, sessionKey: newKey('p3s1') }))
    const send = async (text) => {
      fireEvent.change(screen.getByLabelText(/Describe the indicator|Change it/), { target: { value: text } })
      fireEvent.click(screen.getByTestId('converse-send'))
      await flush()
    }
    await send('Add a 20 EMA.')
    await send('Make it 50.')
    expect(screen.queryAllByTestId('converse-assistant-reply')).toHaveLength(0)
    const t = screen.getByTestId('converse-transcript').textContent
    expect(t).toMatch(/EMA 50/)
    expect(t).not.toMatch(/still says/)
    await send('Make it faster.')
    expect(screen.getAllByTestId('converse-assistant-reply').at(-1).textContent).toMatch(/haven't changed anything yet/)
  })
})
