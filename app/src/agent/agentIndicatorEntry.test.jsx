// INDICATORS ⇄ UCT AGENT (2026-10-12) — the chart's Create Indicator / Modify door opens the Agent,
// which asks what to build; the member's answer runs the EXISTING `indicator.draft` capability on THAT
// chart (the same engine, draft store, preview and Undo as M3). Only the model reply (/converse) and
// the definitions server are stand-ins — no model call is ever made by the Agent's own planner here.
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
import {
  setIndicatorAgentRoute, routeIndicatorAuthoring, beginAuthoringIntent, peekAuthoringIntent,
  takeAuthoringIntent, authoringPrompt, authoringOp, isCancelWords, openIndicatorDoor, _resetIndicatorEntry,
} from './indicatorEntry'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

const PATCH = 'uct.authoring.patch/1'
const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(src); return r.ast }

let converseCalls, turnCalls
function converse({ message, state }) {
  converseCalls.push({ message, revision: state.revision })
  return { ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
      ops: [{ op: 'create', name: 'EMA 20', placement: 'price', outputs: [{ key: 'ema', label: 'EMA 20', tree: P('ema(close, 20)') }] }] } }
}

function makeHost(refs) {
  const store = Object.fromEntries(refs.map(r => [r, null]))
  const doors = []
  const read = (ref) => (ref in store ? { ref, label: `Chart (${ref})`, position: null, symbol: 'NVDA', tf: 'D', stored: store[ref], cs: mergeChartSettings(store[ref] || {}), linkedCount: 0 } : null)
  return {
    doors,
    charts: {
      list: () => Object.keys(store).map(read), read,
      commit: (ref, patch) => { store[ref] = patch.settings; return true },
      canManageIndicators: () => true,
      canCreateIndicator: () => true,
      openCreateIndicator: () => ({ ok: true }),
      openIndicatorDoor: (ref, door) => { doors.push([ref, door]); return ref in store },
      previewHost: () => ({ showAuthoringPreview: () => ({ ok: true }), clearAuthoringPreview: () => true }),
    },
    otherWidgets: () => [],
  }
}

beforeEach(() => {
  converseCalls = []; turnCalls = []
  _resetIndicatorEntry()
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  _resetAuthoring(); _resetDraftPreview()
  act(() => { setCreateIndicatorFlag(true) })
  setAuthoringSources({ extra: { converse, readBack: async () => null, store: (s, o) => storeConversation(s, { ...o, save: async () => ({ ok: false }) }) } })
  globalThis.fetch = vi.fn(async (url, init) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { turnCalls.push(JSON.parse(init.body)); return json({ conversationId: 'ac_1', turnId: 1, envelope: { disposition: 'answer', reply: 'model', ops: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [] })
    return json({})
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY) } catch { /* */ }
})

function mount(host, request) {
  const tree = (req) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role: 'admin' }, loading: false }}>
        <AgentPanel host={host} request={req} onClose={() => {}} />
      </AuthContext.Provider>
    </SWRConfig>
  )
  const r = render(tree(request))
  return { rerender: (req) => r.rerender(tree(req)) }
}
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('indicatorEntry — the seam', () => {
  it('route: none ⇒ false; a route answers for itself; a throw is a decline; unregister only removes its own', () => {
    expect(routeIndicatorAuthoring({ chartId: 'c1' })).toBe(false)
    const a = vi.fn(() => true)
    const offA = setIndicatorAgentRoute(a)
    expect(routeIndicatorAuthoring({ chartId: 'c1' })).toBe(true)
    expect(routeIndicatorAuthoring({})).toBe(false)              // no chart named ⇒ never routed
    const offB = setIndicatorAgentRoute(() => { throw new Error('x') })
    expect(routeIndicatorAuthoring({ chartId: 'c1' })).toBe(false)
    offA()                                                         // stale unregister: B stays
    setIndicatorAgentRoute(() => 'yes')
    expect(routeIndicatorAuthoring({ chartId: 'c1' })).toBe(false) // only `true` counts
    offB()
  })

  it('intent: one at a time, taken once, expires; prompt and op words', () => {
    expect(beginAuthoringIntent({})).toBe(null)
    const i = beginAuthoringIntent({ chartRef: 'c1' })
    expect(authoringPrompt(i)).toBe('What indicator would you like to build?')
    expect(authoringOp(i, '  RSI 14 ')).toEqual({ action: 'indicator.draft', target: 'draft:new', args: { message: 'RSI 14', chart: 'c1', edit: null } })
    const e = beginAuthoringIntent({ chartRef: 'c1', defId: 'u_1', name: 'Trend One' })
    expect(authoringPrompt(e)).toBe('What would you like to change in “Trend One”?')
    expect(authoringOp(e, 'make it blue').args.edit).toBe('u_1')
    expect(takeAuthoringIntent()).toBe(e)
    expect(takeAuthoringIntent()).toBe(null)
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)
    beginAuthoringIntent({ chartRef: 'c1' })
    spy.mockReturnValue(now + 16 * 60 * 1000)
    expect(peekAuthoringIntent()).toBe(null)
  })

  it('cancel words are whole answers only', () => {
    for (const w of ['no', 'Never mind.', 'cancel', 'not now', 'forget it']) expect(isCancelWords(w)).toBe(true)
    for (const w of ['no repaint RSI', 'cancel the 50 EMA line when below']) expect(isCancelWords(w)).toBe(false)
  })

  it('doors go through the host; a host without the door says so', () => {
    expect(openIndicatorDoor({ charts: { openIndicatorDoor: () => true } }, 'c1', 'pine')).toEqual({ ok: true, text: 'Opened Import on the chart.' })
    expect(openIndicatorDoor({ charts: {} }, 'c1', 'image').ok).toBe(false)
  })
})

describe('⭐ Create Indicator opens UCT Agent', () => {
  it('asks "What indicator would you like to build?", offers the four doors, calls no model', async () => {
    const host = makeHost(['c1'])
    mount(host, { id: 1, chartRef: 'c1', defId: null, name: null })
    expect(await screen.findByText('What indicator would you like to build?')).toBeTruthy()
    const doors = [...document.querySelectorAll('[data-door]')].map(b => [b.dataset.door, b.textContent])
    expect(doors).toEqual([['formula', 'Formula'], ['pine', 'Import'], ['library', 'Library'], ['image', 'Screenshot']])
    expect(turnCalls).toHaveLength(0)
  })

  it('the answer runs the existing indicator.draft on THAT chart — no planner model call', async () => {
    const host = makeHost(['c1', 'c2'])
    mount(host, { id: 1, chartRef: 'c2', defId: null, name: null })
    await screen.findByText('What indicator would you like to build?')
    await act(async () => { type('plot the EMA 20 of close') })
    await waitFor(() => expect(converseCalls).toHaveLength(1))
    expect(converseCalls[0].message).toBe('plot the EMA 20 of close')
    expect(await screen.findByText(/Started .*\(draft — not saved\)/)).toBeTruthy()
    expect(turnCalls).toHaveLength(0)                  // the Agent's planner model was never asked
    expect(host.charts.list().every(c => c.stored == null)).toBe(true)   // a draft, nothing written to a chart
  })

  it('one message answers the question: the NEXT message is an ordinary Agent turn', async () => {
    const host = makeHost(['c1'])
    mount(host, { id: 1, chartRef: 'c1', defId: null, name: null })
    await screen.findByText('What indicator would you like to build?')
    await act(async () => { type('plot the EMA 20 of close') })
    await screen.findByText(/Started .*\(draft — not saved\)/)
    await waitFor(() => expect(screen.getByLabelText('Message UCT Agent').disabled).toBe(false))
    await act(async () => { type('what is an EMA, in plain words?') })
    await waitFor(() => expect(turnCalls).toHaveLength(1))
    expect(converseCalls).toHaveLength(1)
  })

  it('"never mind" builds nothing', async () => {
    const host = makeHost(['c1'])
    mount(host, { id: 1, chartRef: 'c1', defId: null, name: null })
    await screen.findByText('What indicator would you like to build?')
    await act(async () => { type('never mind') })
    expect(await screen.findByText('OK — nothing was built.')).toBeTruthy()
    expect(converseCalls).toHaveLength(0)
    expect(turnCalls).toHaveLength(0)
  })

  it('a door opens the existing builder on that chart and ends the question', async () => {
    const host = makeHost(['c1'])
    mount(host, { id: 1, chartRef: 'c1', defId: null, name: null })
    await screen.findByText('What indicator would you like to build?')
    await act(async () => { document.querySelector('[data-door="formula"]').click() })
    expect(await screen.findByText('Opened Formula on the chart.')).toBeTruthy()
    expect(host.doors).toEqual([['c1', 'formula']])
    await act(async () => { type('what is an EMA?') })
    await waitFor(() => expect(turnCalls).toHaveLength(1))     // the question was ended by the door
    expect(converseCalls).toHaveLength(0)
  })

  it('the same request is asked once; a NEW request (a second click) asks again', async () => {
    const host = makeHost(['c1'])
    const m = mount(host, { id: 1, chartRef: 'c1', defId: null, name: null })
    await screen.findByText('What indicator would you like to build?')
    m.rerender({ id: 1, chartRef: 'c1', defId: null, name: null })
    expect(screen.getAllByText('What indicator would you like to build?')).toHaveLength(1)
    m.rerender({ id: 2, chartRef: 'c1', defId: null, name: null })
    await waitFor(() => expect(screen.getAllByText('What indicator would you like to build?')).toHaveLength(2))
  })
})

describe('Modify opens UCT Agent with the indicator selected', () => {
  it('asks what to change in it, by name, with no doors; the answer is an EDIT of that definition', async () => {
    const host = makeHost(['c1'])
    mount(host, { id: 1, chartRef: 'c1', defId: 'u_ffffffffffff', name: 'Trend One' })
    expect(await screen.findByText('What would you like to change in “Trend One”?')).toBeTruthy()
    expect(document.querySelectorAll('[data-door]')).toHaveLength(0)
    // not among this member's own definitions ⇒ the capability's own refusal (the edit reached it)
    await act(async () => { type('make it blue') })
    expect(await screen.findByText(/I don.t know that indicator on your account/)).toBeTruthy()
    expect(converseCalls).toHaveLength(0)
    expect(turnCalls).toHaveLength(0)
  })
})
