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

// ═══ 2. PREVIEW INVALIDATION — any content change re-installs the preview ════════
//
// ROOT CAUSE (traced): the registry skipped an install whose key was unchanged, and
// the key was `id@version#compute.fn` — `compute.fn` hashes only the scan/primary
// tree, and the live preview keeps ONE id + version for its whole life. A change to
// a second output's tree, a paint, a style or the levels kept the key, so the chart
// drew the previous document. The key now carries a content fingerprint.

import * as registry from '../nativeRegistry'
import { newAuthoringState, applyTurn } from '../../builder/authoring/authoringState'
import { stampSemantics } from '../definitionSemantics'
import { STUDIO_PREVIEW_DEF_ID } from '../../builder/studio/chartPreview'

const asPreview = (state) => stampSemantics({ ...state.working, id: STUDIO_PREVIEW_DEF_ID }, { prior: null })
const turn = (state, ops) => {
  const out = applyTurn(state, { contract: C, baseRevision: state.revision, ops }, { gateCtx: { symbol: 'XRPN', tf: 'D' } })
  expect(out.result.status).toBe('applied')
  return out.state
}
/** The P3R create: RSI 28 in a pane + an "above 70" condition that paints candles gold. */
const p3rRsi = () => turn(newAuthoringState(), [
  { op: 'create', name: 'RSI 28', placement: 'pane', primary: 'rsi', outputs: [
    { key: 'rsi', label: 'RSI 28', tree: parseFormula('rsi(close, 28)').ast },
    { key: 'overbought', label: 'RSI above 70', tree: parseFormula('rsi(close, 28) > 70').ast }] },
  { op: 'set_levels', values: [70, 30] },
  { op: 'set_paint', output: 'overbought', channel: 'barcolor', color: '#FFD700' },
])
const installed = () => registry.getDefinition(STUDIO_PREVIEW_DEF_ID)
const install = (state) => {
  const before = registry.registryGeneration()
  const { installed: got, errors } = registry.installUserDefinitions([asPreview(state)])
  expect(errors).toEqual([])
  return { bumped: registry.registryGeneration() !== before, got }
}

describe('2. PREVIEW INVALIDATION — a non-primary change re-installs the preview', () => {
  afterEach(() => { registry.clearUserDefinitions() })

  it('the exact P3R transition: "above 70" → "crossing above 70" on the PAINTED output', () => {
    let s = p3rRsi()
    install(s)
    const fnBefore = installed().compute.fn
    expect(JSON.stringify(installed())).not.toContain('crossOver')
    s = turn(s, [{ op: 'set_output_tree', output: 'overbought', tree: parseFormula('crossOver(rsi(close, 28), 70)').ast },
      { op: 'rename_output', output: 'overbought', label: 'RSI 28 crosses above 70' }])
    const r = install(s)
    expect(installed().compute.fn).toBe(fnBefore)          // the primary hash did NOT move…
    expect(r.bumped).toBe(true)                            // …and the preview still re-installed
    expect(JSON.stringify(installed())).toContain('crossOver')
    expect(JSON.stringify(installed())).toContain('RSI 28 crosses above 70')
    expect(JSON.stringify(installed())).toContain('#FFD700')   // the paint is kept
  })

  it.each([
    ['a paint colour', [{ op: 'set_paint', output: 'overbought', channel: 'barcolor', color: '#00FF00' }], '#00FF00'],
    ['a background paint', [{ op: 'set_paint', output: 'overbought', channel: 'bgcolor', color: '#112233' }], '#112233'],
    ['a line style on the primary', [{ op: 'set_style', output: 'rsi', lineStyle: 'dashed' }], '"lineStyle":"dashed"'],
    ['the levels', [{ op: 'set_levels', values: [80, 20] }], '80'],
    ['a marker', [{ op: 'set_marker', output: 'overbought', shape: 'circle', position: 'belowBar' }], 'circle'],
    ['a fill', [{ op: 'add_output', key: 'mid', label: 'Mid', tree: parseFormula('rsi(close, 14)').ast },
      { op: 'set_fill', output: 'rsi', with: 'mid', color: '#334455' }], '#334455'],
  ])('%s re-installs although compute.fn is unchanged', (_label, ops, needle) => {
    let s = p3rRsi()
    install(s)
    const fn = installed().compute.fn
    s = turn(s, ops)
    const r = install(s)
    expect(installed().compute.fn).toBe(fn)
    expect(r.bumped).toBe(true)
    expect(JSON.stringify(installed())).toContain(needle)
  })

  it('an IDENTICAL re-install is still a no-op (the SWR revalidate must not bump)', () => {
    const s = p3rRsi()
    install(s)
    expect(install(s).bumped).toBe(false)
  })

  it('the persisted identity is untouched: id, version, compute.fn and treesHash are the engine\'s', () => {
    const s = p3rRsi()
    install(s)
    const d = installed()
    expect(d.id).toBe(STUDIO_PREVIEW_DEF_ID)
    expect(d.compute.fn).toBe(s.working.compute.fn)
    expect(d.compute.treesHash).toBe(s.working.compute.treesHash)
  })
})

// ═══ 5. HARDENING — every non-mutating outcome, then authoring resumes ══════════
//
// Through the REAL studio hook: after a create, each TALK / refusal outcome leaves
// the state object IDENTICAL (not an equal copy) and the revision unmoved; the next
// valid change then applies on that same revision and conversation.

describe('5. TALK → AUTHOR continuity matrix (studio hook)', () => {
  afterEach(() => { cleanup(); clearUserDefinitions() })
  const outcomes = {
    answer: (st) => ok('answer', { contract: C, baseRevision: st.revision, ops: [] }, 'It is an average.'),
    clarify: (st) => ok('clarify', { contract: C, baseRevision: st.revision, ops: [], questions: [{ id: 'q', text: 'Which?' }] }, ''),
    unsupported: () => ({ ok: false, gate: 'unsupported:table', disposition: 'unsupported', reason: 'Tables are not drawable yet.', notUnderstood: [], unavailable: [] }),
    refused: () => ({ ok: false, gate: 'envelope:schema', reason: 'the assistant\'s change did not follow the change format', notUnderstood: [], unavailable: [] }),
    staleRevision: (st) => ok('change', setLen(st.revision + 5, 30), ''),
    malformedOp: (st) => ok('change', { contract: C, baseRevision: st.revision, ops: [{ op: 'set_slot', slot: 'nope#9', value: 3 }] }, ''),
    network: () => ({ ok: false, gate: 'network', reason: 'Could not reach the server.', notUnderstood: [], unavailable: [] }),
  }
  it.each(Object.keys(outcomes))('%s: no mutation, then "Make it 50." applies on the same revision', async (kind) => {
    let mode = 'create'
    const converse = vi.fn(async ({ state }) => {
      if (mode === 'create') return ok('change', createEma(state.revision, 20), '')
      if (mode === 'talk') return outcomes[kind](state)
      return ok('change', setLen(state.revision, 50), '')
    })
    const { result } = renderHook(() => useIndicatorConversation({ sym: 'XRPN', tf: 'D', converse }))
    await act(async () => { await result.current.send('Add a 20 EMA.') })
    const created = result.current.state
    const lineage = created.lineage
    mode = 'talk'
    await act(async () => { await result.current.send('something else') })
    if (kind === 'clarify') {
      // a question is recorded on the state, but the working definition and revision do not move
      expect(result.current.state.working).toBe(created.working)
      expect(result.current.state.revision).toBe(created.revision)
    } else {
      expect(result.current.state).toBe(created)
    }
    expect(result.current.transcript.at(-1).kind).not.toMatch(/created|patched/)
    mode = 'change'
    await act(async () => { await result.current.send('Make it 50.') })
    expect(result.current.transcript.at(-1).kind).toBe('patched')
    expect(result.current.state.revision).toBe(created.revision + 1)
    expect(result.current.state.lineage).toBe(lineage)
    expect(JSON.stringify(result.current.state.working)).toContain('"value":50')
  })
})
