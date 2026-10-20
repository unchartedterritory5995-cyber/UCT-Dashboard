// NL-1 × INDICATORS ⇄ AGENT — the chart's Create Indicator door with NL-1 ON, through the real panel and a
// SCRIPTED model (no paid call). Isolated: the legacy door behaviour stays covered by agentIndicatorEntry.test.jsx.
//
// Holds NL-1 to: the door still asks its question with no model call; the member's answer is read by the
// MODEL with that question in front of it (pending_question) — never routed by words — and the plan it
// returns runs the EXISTING indicator.draft on the chart the door was opened on (same engine, draft store,
// nothing written to a chart); "cancel" (exact) sets the question aside with no model call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { parseFormula } from '../components/chart/engine/ast/parse'
import { AuthContext } from '../context/AuthContext'
import { setCreateIndicatorFlag, CREATE_INDICATOR_FLAG_KEY } from '../components/chart/builder/studio/createIndicatorFlag'
import { setAuthoringSources, _resetAuthoring } from './capabilities/indicatorAuthoring'
import { storeConversation } from '../components/chart/builder/conversationSave'
import { _simulateReload, STORAGE_KEY } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview } from '../components/chart/builder/agentAuthoring'
import { _resetIndicatorEntry, peekAuthoringIntent } from './indicatorEntry'
import { NL1_KEY } from './nl1/interpreter'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

const PATCH = 'uct.authoring.patch/1'
const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(src); return r.ast }
const QUESTION = 'What indicator would you like to build?'

let converseCalls, turnCalls, script
function converse({ message, state, gateCtx }) {
  converseCalls.push({ message, revision: state.revision, symbol: gateCtx?.symbol || null })
  return { ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
      ops: [{ op: 'create', name: 'EMA 20', placement: 'price', outputs: [{ key: 'ema', label: 'EMA 20', tree: P('ema(close, 20)') }] }] } }
}

function makeHost(syms) {
  const store = Object.fromEntries(Object.keys(syms).map(r => [r, null]))
  const read = (ref) => (ref in store ? { ref, label: `Chart (${syms[ref]})`, position: null, symbol: syms[ref], tf: 'D', stored: store[ref], cs: mergeChartSettings(store[ref] || {}), linkedCount: 0 } : null)
  return {
    charts: {
      list: () => Object.keys(store).map(read), read,
      commit: (ref, patch) => { store[ref] = patch.settings; return true },
      canManageIndicators: () => true, canCreateIndicator: () => true,
      openCreateIndicator: () => ({ ok: true }), openIndicatorDoor: () => true,
      previewHost: () => ({ showAuthoringPreview: () => ({ ok: true }), clearAuthoringPreview: () => true }),
    },
    otherWidgets: () => [],
  }
}

beforeEach(async () => {
  converseCalls = []; turnCalls = []
  script = () => ({ disposition: 'answer', reply: 'ok', question: null, ops: [], unsupported_category: null, correction: null })
  _resetIndicatorEntry(); _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  localStorage.setItem(NL1_KEY, '1')
  _resetAuthoring(); _resetDraftPreview()
  act(() => { setCreateIndicatorFlag(true) })
  setAuthoringSources({ extra: { converse, readBack: async () => null, store: (s, o) => storeConversation(s, { ...o, save: async () => ({ ok: false }) }) } })
  globalThis.fetch = vi.fn(async (url, init) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { const b = JSON.parse(init.body); turnCalls.push(b); return json({ conversationId: 'ac_1', turnId: 1, envelope: script(b), usage: {} }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (url === '/api/agent/config') return json({ stream: false, nl1: true })     // this server serves NL-1
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
    return json({})
  })
  _resetAgentConfig(); await loadAgentConfig()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY); localStorage.removeItem(NL1_KEY) } catch { /* */ }
})

function mount(host, request) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
        <AgentPanel host={host} request={request} onClose={() => {}} />
      </AuthContext.Provider>
    </SWRConfig>,
  )
}
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('NL-1 × the Create Indicator door', () => {
  it('the door asks its question with no model call; the answer is read by the model WITH that question, and runs the existing indicator.draft on that chart', async () => {
    const host = makeHost({ c1: 'NVDA', c2: 'AMD' })
    // the scripted model plans what the question asks: a new draft, on the chart the question was about
    script = (b) => {
      const draft = b.context.indicatorDrafts.find(d => /new/i.test(d.label))
      const chart = b.context.charts.find(c => c.symbol === 'AMD')
      return { disposition: 'apply', reply: '', question: null, unsupported_category: null, correction: null,
        ops: [{ action: 'indicator.draft', target: draft.ref, args: { message: b.message, chart: chart.ref, edit: null } }] }
    }
    mount(host, { id: 1, chartRef: 'c2', defId: null, name: null })
    expect(await screen.findByText(QUESTION)).toBeTruthy()
    expect(turnCalls).toHaveLength(0)                                // asking is free
    await act(async () => { type('plot the EMA 20 of close') })
    await waitFor(() => expect(converseCalls).toHaveLength(1))
    // one model call, with the question it answers and the core (indicators always among it)
    expect(turnCalls).toHaveLength(1)
    expect(turnCalls[0]).toMatchObject({ interpreter: 'nl1', message: 'plot the EMA 20 of close' })
    expect(turnCalls[0].routing.selected).toContain('indicators')
    expect(turnCalls[0].context.pending_question.text).toBe(QUESTION)
    expect(turnCalls[0].capabilities.some(c => c.name === 'indicator.draft')).toBe(true)
    // the existing engine built the draft on THAT chart (AMD), from the member's own words
    expect(converseCalls[0]).toMatchObject({ message: 'plot the EMA 20 of close', symbol: 'AMD' })
    expect(await screen.findByText(/Draft ready \(not saved yet\)/)).toBeTruthy()
    expect(host.charts.list().every(c => c.stored == null)).toBe(true)          // a draft: nothing written to a chart
    expect(peekAuthoringIntent()).toBe(null)                                   // one message answered the question
  })

  it('the question is asked once: the next message is an ordinary NL-1 turn without it', async () => {
    const host = makeHost({ c1: 'NVDA' })
    script = (b) => (b.context.pending_question
      ? { disposition: 'apply', reply: '', question: null, unsupported_category: null, correction: null,
          ops: [{ action: 'indicator.draft', target: b.context.indicatorDrafts.find(d => /new/i.test(d.label)).ref, args: { message: b.message, chart: null, edit: null } }] }
      : { disposition: 'answer', reply: 'An EMA weights recent prices more.', question: null, ops: [], unsupported_category: null, correction: null })
    mount(host, { id: 1, chartRef: 'c1', defId: null, name: null })
    await screen.findByText(QUESTION)
    await act(async () => { type('plot the EMA 20 of close') })
    await screen.findByText(/Draft ready \(not saved yet\)/)
    await waitFor(() => expect(screen.getByLabelText('Message UCT Agent').disabled).toBe(false))
    await act(async () => { type('what is an EMA, in plain words?') })
    await screen.findByText('An EMA weights recent prices more.')
    expect(turnCalls).toHaveLength(2)
    expect(turnCalls[1].context.pending_question).toBeUndefined()
    expect(converseCalls).toHaveLength(1)
  })

  it('an exact "cancel" sets the question aside with no model call and builds nothing', async () => {
    const host = makeHost({ c1: 'NVDA' })
    mount(host, { id: 1, chartRef: 'c1', defId: null, name: null })
    await screen.findByText(QUESTION)
    await act(async () => { type('cancel') })
    await waitFor(() => expect(screen.getByLabelText('Message UCT Agent').disabled).toBe(false))
    expect(turnCalls).toHaveLength(0)
    expect(converseCalls).toHaveLength(0)
    expect(await screen.findByText('OK — nothing was built.')).toBeTruthy()
    expect(peekAuthoringIntent()).toBe(null)
  })
})
