// SLICE 2 — the dock as an ASSISTANT: answers that change nothing, changes that
// say so, an unsupported pre-flight that never calls the model, and a draft that
// survives closing the dock. The model is scripted; everything else is real
// (engine, readback, registry, save doors with the network spied).
// ASKED / CLAIMED / DID per case.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import { _resetSessions, readSession, createKey } from '../authoring/conversationSessions'

const H = vi.hoisted(() => ({ saves: [] }))
vi.mock('../../../../hooks/useUserDefinitions', async (orig) => ({
  ...(await orig()),
  saveUserDefinition: vi.fn(async (doc, defId) => {
    H.saves.push({ doc, defId })
    return { ok: true, row: { def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1, semantics: 2 } }
  }),
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const previewTree = () => JSON.stringify(registry.getDefinition(STUDIO_PREVIEW_DEF_ID) || null)

function mount({ key = createKey('s_test'), converse = null, sym = 'AAPL', tf = 'D' } = {}) {
  const spy = vi.fn(converse || scriptedConverse)
  const writes = []
  const onClose = vi.fn()
  const utils = render(
    <CreateIndicatorPanel settings={mergeChartSettings({})} onChange={(n) => writes.push(n)}
      sym={sym} tf={tf} onPreview={() => {}} onClose={onClose} converse={spy} sessionKey={key} />,
  )
  return { spy, writes, onClose, ...utils }
}

async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const lastUct = () => [...document.querySelectorAll('[data-role="uct"]')].at(-1)
const panel = () => screen.getByTestId('create-indicator')
const save = () => screen.getByTestId('create-indicator-save')

beforeEach(() => { H.saves.length = 0; _resetSessions() })
afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('FLOW A — questions do not mutate; a change does, and says so', () => {
  it('EMA 20 → "What does this indicator do?" → "Would EMA 50 react more slowly?" → "Make it 50."', async () => {
    const { writes } = mount()
    await say('Add a 20 EMA')
    const tree20 = previewTree()
    const rev = panel().dataset.revision
    const lineage = panel().dataset.lineage
    expect(tree20).toContain('"value":20')
    expect(lastUct().dataset.updated).toBe('true')          // the create said so

    await say('What does this indicator do?')
    expect(lastUct().dataset.kind).toBe('answer')
    expect(lastUct().dataset.updated).toBeUndefined()       // ⛔ no change implied
    expect(lastUct().textContent).toMatch(/EMA 20 draws one line/)
    expect(previewTree()).toBe(tree20)                      // byte-identical preview
    expect(panel().dataset.revision).toBe(rev)              // no revision bump

    await say('Would EMA 50 react more slowly?')
    expect(lastUct().dataset.kind).toBe('answer')
    expect(lastUct().textContent).toMatch(/reacts more slowly/)
    expect(previewTree()).toBe(tree20)
    expect(panel().dataset.revision).toBe(rev)

    await say('Make it 50.')
    expect(lastUct().dataset.kind).toBe('patched')
    expect(lastUct().dataset.updated).toBe('true')
    expect(screen.getAllByTestId('create-indicator-updated').length).toBe(2)   // create + this change
    expect(previewTree()).toContain('"value":50')
    expect(panel().dataset.lineage).toBe(lineage)           // SAME conversation
    expect(writes).toHaveLength(0)                          // nothing saved
    expect(H.saves).toHaveLength(0)
  })

  it('a question before anything exists keeps Add to Chart disabled (nothing to save)', async () => {
    mount()
    await say('What does this indicator do?')
    expect(lastUct().dataset.kind).toBe('answer')
    expect(save().disabled).toBe(true)
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()
  })

  it('a CLARIFY turn applies nothing (same preview, same revision)', async () => {
    const clarify = async ({ state }) => ({
      ok: true, disposition: 'clarify', reply: '', turn: 'question',
      envelope: { contract: 'uct.authoring.patch/1', baseRevision: state.revision, ops: [], questions: [{ id: 'q', text: 'EMA or SMA?', choices: ['EMA', 'SMA'] }] },
    })
    let first = true
    const converse = async (args) => { if (first) { first = false; return scriptedConverse(args) } return clarify(args) }
    mount({ converse })
    await say('Add a 20 EMA')
    const tree = previewTree(); const rev = panel().dataset.revision
    await say('add another average')
    expect(lastUct().dataset.kind).toBe('question')
    expect(previewTree()).toBe(tree)
    expect(panel().dataset.revision).toBe(rev)
  })

  it('a FAILED turn (network) applies nothing and leaves no phantom change', async () => {
    let first = true
    const converse = async (args) => { if (first) { first = false; return scriptedConverse(args) }
      return { ok: false, gate: 'network', reason: 'Could not reach the server — check your connection and try again.', notUnderstood: [], unavailable: [] } }
    mount({ converse })
    await say('Add a 20 EMA')
    const tree = previewTree(); const rev = panel().dataset.revision
    await say('Make it 50')
    expect(lastUct().dataset.kind).toBe('refusal')
    expect(lastUct().textContent).toMatch(/Nothing on the chart changed/)
    expect(previewTree()).toBe(tree)
    expect(panel().dataset.revision).toBe(rev)
  })

  it('a disposition that does not match its payload is REFUSED, never applied', async () => {
    let first = true
    const converse = async (args) => { if (first) { first = false; return scriptedConverse(args) }
      return { ok: true, disposition: 'answer', reply: 'sure', turn: 'patch',
        envelope: { contract: 'uct.authoring.patch/1', baseRevision: args.state.revision, ops: [{ op: 'set_slot', slot: 'value#0.1', value: 99 }] } } }
    mount({ converse })
    await say('Add a 20 EMA')
    const tree = previewTree()
    await say('hmm')
    expect(lastUct().dataset.kind).toBe('refusal')
    expect(previewTree()).toBe(tree)
  })
})

describe('FLOW D — the pre-flight: zero model calls for an explicit other symbol / timeframe', () => {
  // ⭐ PHASE 5: another symbol is AUTHORABLE, so "Compare AAPL with SPY" reaches the
  // model; an AMBIGUOUS spelling is what the browser still answers with zero calls.
  it('"use VIX" on an XRPN chart: answered in the browser, the client is never called; "Compare AAPL with SPY" reaches the model (PHASE 5)', async () => {
    const { spy } = mount({ sym: 'XRPN' })
    await say('Add a 20 EMA')
    const calls = spy.mock.calls.length
    const tree = previewTree(); const rev = panel().dataset.revision
    await say('use VIX')
    expect(spy.mock.calls.length).toBe(calls)                // ⛔ ZERO calls
    expect(lastUct().dataset.kind).toBe('unsupported')
    expect(lastUct().textContent).toMatch(/VIX/)
    expect(lastUct().textContent).not.toMatch(/unsupported:|node/)
    expect(previewTree()).toBe(tree)
    expect(panel().dataset.revision).toBe(rev)
    await say('Compare AAPL with SPY')
    expect(spy.mock.calls.length).toBe(calls + 1)
  })
  it('"on the 5 minute timeframe" on a daily chart: zero calls', async () => {
    const { spy } = mount()
    await say('on the 5 minute timeframe')
    expect(spy).not.toHaveBeenCalled()
    expect(lastUct().textContent).toMatch(/5-minute/)
  })
  it('an AMBIGUOUS request is not intercepted — it goes to the model', async () => {
    const { spy } = mount()
    await say('Can this use another symbol?')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('FLOW B / F — the draft survives closing the dock; Discard ends it', () => {
  it('✕ keeps the draft: reopening the SAME context restores the transcript, the lineage and the preview', async () => {
    const key = createKey('s_a')
    const first = mount({ key })
    await say('Add a 20 EMA')
    await say('What does this indicator do?')
    const lineage = panel().dataset.lineage
    const n = document.querySelectorAll('[data-role]').length
    fireEvent.click(screen.getByTestId('create-indicator-close'))
    expect(first.onClose).toHaveBeenCalled()
    first.unmount()
    expect(registry.getDefinition(STUDIO_PREVIEW_DEF_ID)).toBeFalsy()      // no orphan preview while closed
    expect(readSession(key)).toBeTruthy()

    mount({ key })
    expect(screen.getByTestId('create-indicator-restored')).toBeTruthy()
    expect(panel().dataset.lineage).toBe(lineage)
    expect(document.querySelectorAll('[data-role]').length).toBe(n)
    expect(previewTree()).toContain('"value":20')                       // preview back
    await say('Make it 50')                                             // composer works
    expect(previewTree()).toContain('"value":50')
  })

  it('a DIFFERENT context never inherits the conversation', async () => {
    const a = mount({ key: createKey('s_a') })
    await say('Add a 20 EMA')
    fireEvent.click(screen.getByTestId('create-indicator-close'))
    a.unmount()
    mount({ key: createKey('s_b') })
    expect(screen.queryByTestId('create-indicator-restored')).toBeNull()
    expect(document.querySelectorAll('[data-role]').length).toBe(0)
    expect(screen.getByTestId('create-indicator-intro')).toBeTruthy()
  })

  it('Discard throws the draft away (labelled as such) and writes nothing', async () => {
    const key = createKey('s_d')
    const m = mount({ key })
    expect(screen.getByTestId('create-indicator-cancel').textContent).toBe('Cancel')   // nothing to lose yet
    await say('Add a 20 EMA')
    expect(screen.getByTestId('create-indicator-cancel').textContent).toBe('Discard')
    fireEvent.click(screen.getByTestId('create-indicator-cancel'))
    expect(m.writes).toHaveLength(0)
    expect(H.saves).toHaveLength(0)
    expect(readSession(key)).toBeNull()
    m.unmount()
    mount({ key })
    expect(screen.queryByTestId('create-indicator-restored')).toBeNull()
  })

  it('an untouched dock leaves no session behind', () => {
    const key = createKey('s_e')
    const m = mount({ key })
    fireEvent.click(screen.getByTestId('create-indicator-close'))
    m.unmount()
    expect(readSession(key)).toBeNull()
  })
})

describe('FLOW C — Add to Chart: one save, one instance, and the creation context ends', () => {
  it('saves ONCE; the session ends; reopening starts a NEW definition', async () => {
    const key = createKey('s_c')
    const m = mount({ key })
    await say('Add a 20 EMA')
    await say('What does this indicator do?')               // an answer never blocks or dirties
    expect(save().disabled).toBe(false)
    await act(async () => { fireEvent.click(save()) })
    expect(H.saves).toHaveLength(1)
    expect(m.writes).toHaveLength(1)
    const inst = (m.writes[0].indicatorInstances || []).filter((i) => i && String(i.defId).startsWith('u_'))
    expect(inst).toHaveLength(1)
    expect(m.onClose).toHaveBeenCalled()
    expect(readSession(key)).toBeNull()
    m.unmount()
    mount({ key })
    expect(screen.getByTestId('create-indicator-intro')).toBeTruthy()
  })
})

describe('labels — the dock shows the authored name in full', () => {
  it('"RSI 14 > 70" reads whole, with the full name as its title', async () => {
    mount()
    await say('Build an RSI overbought signal')
    const name = screen.getByTestId('create-indicator-name')
    expect(name.textContent).toMatch(/^RSI 14 . 70$/)
    expect(name.getAttribute('title')).toBe(name.textContent)
  })
})
