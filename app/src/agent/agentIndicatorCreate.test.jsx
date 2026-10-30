// LIVE PRODUCTION BUG 2026-10-28 — "Create a custom indicator that shows the difference between the 9ema and 20ema as
// a percentage. Put it in a separate pane." showed a Proposed-changes card, and its Apply answered "I can’t check that
// approval any more". Root causes: (1) the model PROPOSED the build and the browser kept the card although the member's
// own words had asked for it; (2) the card's R1 Save of a NEW draft was never sealed, so no Apply could ever pass
// validateSaveSeal. Through the REAL panel, planner, policy, runtime, receipts and Undo, the REAL Indicators authoring
// interface (engine, draft store, canonical Save) and the REAL chart add. Stand-ins: the Agent model, the builder's
// model and the definitions server. No paid model call.
//   C1  the exact request, the model PROPOSING it → built, saved, on the chart, in its own pane; no card; Undo
//   C2  the model's own extras (its Save with a name, with or without a chart add) never turn it into "Saving only"
//   C3  four charts: the model's guess of the chart is never used — asked; the pick builds, saves and adds it, no card
//   C4  a name the member already has stops at a ready draft; its save is then a card (nothing saved before Apply)
//       #500: so does the same MATHS saved under any name (a legacy formula-style one too); "another" still makes a copy
//   C5  failures: a malformed builder answer, a refused Save — nothing saved or added, nothing reported as done
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setAuthoringSources, _resetAuthoring } from './capabilities/indicatorAuthoring'
import { _resetProposedPlans } from './capabilities/indicatorEdits'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { storeConversation } from '../components/chart/builder/conversationSave'
import { _simulateReload, STORAGE_KEY } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview, AUTHORING_REASONS as AR } from '../components/chart/builder/agentAuthoring'
import { CREATE_INDICATOR_FLAG_KEY } from '../components/chart/builder/studio/createIndicatorFlag'
import { mutate } from 'swr'
import { USER_DEFINITIONS_KEY } from '../hooks/useUserDefinitions'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// ── the builder's model (/converse): the owner's EMA % request → the formula it should produce ──
const PATCH = 'uct.authoring.patch/1'
const close = { type: 'series', name: 'close' }
const call = (name, ...args) => ({ type: 'call', name, args })
const num = (value) => ({ type: 'num', value })
const op = (name, ...args) => ({ type: 'op', name, args })
const E9 = call('ema', close, num(9)), E20 = call('ema', close, num(20))
const PCT = op('*', op('/', op('-', E9, E20), E20), num(100))          // (EMA(9) − EMA(20)) / EMA(20) × 100
let builder
function converse({ message, state }) {
  builder.calls.push(message)
  if (builder.mode === 'malformed') return { ok: false, gate: 'envelope:schema', reason: 'the assistant\'s change did not follow the change format, so nothing was offered to apply' }
  if (builder.mode === 'lower-tf') return { ok: false, gate: 'unsupported:node', reason: 'it reads a lower timeframe; conversational authoring draws on the chart\'s own bars or a higher timeframe only' }
  return { ok: true, disposition: 'change', turn: 'patch', reply: '', envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
    ops: [{ op: 'create', name: 'EMA 9/20 % Diff', placement: 'pane', outputs: [{ key: 'diff', label: 'EMA 9/20 % Diff', tree: builder.tree || PCT }] }] } }
}
// ── the definitions server ──
let server
const fakeSave = async (doc, defId, _x, opts) => {
  if (server.refuse) return { ok: false, status: 500, error: 'the definitions store is unavailable' }
  const id = defId || `u_aaaaaaaaae${String(server.size + 10).padStart(2, '0')}`
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  server.set(id, { def_id: id, version, rev: 1, definition: { ...doc, id, version } })
  return { ok: true, row: { def_id: id, version, rev: 1 } }
}
// ── the Agent model, scripted per test ──
let envelopes, calls, selected
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  server = new Map(); envelopes = []; calls = []; selected = null; builder = { mode: 'ok', calls: [] }
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
  _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans()
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [...server.values()] })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const turns = () => calls.filter(c => c[1] === '/api/agent/turn').length
const transcript = () => screen.getByTestId('agent-transcript').textContent
const proposals = () => screen.queryAllByTestId('agent-proposal')
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(widgets, groupSyms, { decorate = null } = {}) {
  const board = makeBoard(widgets, groupSyms)
  const base = board.host.charts
  const d = decorate || ((s) => s)
  const h = {
    ...board.host,
    charts: { ...base, list: () => base.list().map(d), read: (ref) => d(base.read(ref)), canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => selected },
    persist: async () => ({ ok: true }),
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  setAuthoringSources({ extra: { converse, readBack: async (id) => server.get(id) || null, store: (s, o) => storeConversation(s, { ...o, save: fakeSave }) } })
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { board, h, say }
}


const ASK = 'Create a custom indicator that shows the difference between the 9ema and 20ema as a percentage. Put it in a separate pane.'
const customOn = (board, id) => (mergeChartSettings(JSON.stringify(board.state.widgets.find(w => w.id === id)?.opts?.settings || null)).indicatorInstances || []).filter(i => !i.deleted && /^u_/.test(String(i.defId)))
const label1 = (s) => (s ? { ...s, label: `Chart (${s.symbol})` } : s)
const ONE = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'QQQ' }]
const FOUR = () => [['c0', 'c1', 'c2', 'c3'].map((id, i) => ({ id, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: { settings: mergeChartSettings(null) } })),
  { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }]
const newRef = (b) => b.context.indicatorDrafts.find(e => e.new).ref
const build = (disposition, { chart = 0, save = null } = {}) => (b) => env(disposition, [
  { action: 'indicator.draft', target: newRef(b), args: { message: ASK, chart: chart == null ? null : b.context.charts[chart].ref, edit: null } },
  ...(save ? [{ action: 'indicator.saveDraft', target: newRef(b), args: { addTo: save.addTo ? [b.context.charts[chart].ref] : [], name: save.name ?? null } }] : []),
])
const DONE = 'Done — created your “EMA 9 vs EMA 20 %” indicator and added it to Chart (QQQ), in its own pane.'
const summaries = () => screen.queryAllByTestId('agent-receipt-summary').map(e => e.textContent)
const NEVER = /can’t check that approval|Saving only|Want me to apply it|There is no draft to save/

describe('C1 · the exact production request', () => {
  it('the model PROPOSES it → no card: built once, saved as a new indicator, on the chart, in its own pane; one short line; Undo takes it off the chart', async () => {
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK)
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(1), { timeout: 12000 })
    await waitFor(() => expect(summaries()).toContain(DONE), { timeout: 8000 })
    expect(proposals()).toHaveLength(0)
    expect(transcript()).not.toMatch(/Proposed changes|Approved/)
    expect(transcript()).not.toMatch(NEVER)
    expect(builder.calls).toEqual([ASK])
    const saved = [...server.values()]
    expect(saved).toHaveLength(1)
    expect(saved[0].definition.placement).toMatchObject({ target: 'pane' })
    expect(turns()).toBe(1)
    await say('undo')
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(0), { timeout: 8000 })
    expect(server.size).toBe(1)
  }, 40000)
  it('the model APPLYING it gives the same result', async () => {
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('apply'))
    await say(ASK)
    await waitFor(() => expect(summaries()).toContain(DONE), { timeout: 12000 })
    expect(customOn(board, 'c')).toHaveLength(1)
    expect(proposals()).toHaveLength(0)
  }, 30000)
})

describe('C2 · the model\'s extras never block the creation', () => {
  for (const [k, save] of [['its Save with a name the member never said', { addTo: true, name: 'EMA 9/20 % Diff' }], ['its Save without the chart add', { addTo: false }], ['its Save with the chart add', { addTo: true }]]) {
    it(`${k} → still built, saved and on the chart, no card`, async () => {
      const { board, say } = mount(...ONE(), { decorate: label1 })
      envelopes.push(build('propose', { save }))
      await say(ASK)
      await waitFor(() => expect(summaries()).toContain(DONE), { timeout: 12000 })
      expect(customOn(board, 'c')).toHaveLength(1)
      expect(server.size).toBe(1)
      expect(proposals()).toHaveLength(0)
      expect(transcript()).not.toMatch(NEVER)
    }, 30000)
  }
})

describe('C3 · a board of four charts', () => {
  it('the model\'s guess of the chart is not the member\'s word: asked first (nothing built); the pick builds, saves and adds it there — no card', async () => {
    const { board, say } = mount(...FOUR(), { decorate: label1 })
    envelopes.push(build('propose', { chart: 0, save: { addTo: true } }))
    await say(ASK)
    await waitFor(() => expect(transcript()).toMatch(/Which chart is this indicator for\?/), { timeout: 8000 })
    expect(builder.calls).toEqual([])
    expect(server.size).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Chart (NVDA)' }))
    await waitFor(() => expect(customOn(board, 'c2')).toHaveLength(1), { timeout: 12000 })
    await waitFor(() => expect(summaries()).toContain('Done — created your “EMA 9 vs EMA 20 %” indicator and added it to Chart (NVDA), in its own pane.'), { timeout: 8000 })
    for (const id of ['c0', 'c1', 'c3']) expect(customOn(board, id)).toHaveLength(0)
    expect(server.size).toBe(1)
    expect(proposals()).toHaveLength(0)
    expect(turns()).toBe(1)
  }, 40000)
  it('the chart the member clicked is used at once', async () => {
    selected = 'c3'
    const { board, say } = mount(...FOUR(), { decorate: label1 })
    envelopes.push(build('propose', { chart: 3 }))
    await say(ASK)
    await waitFor(() => expect(customOn(board, 'c3')).toHaveLength(1), { timeout: 12000 })
    expect(transcript()).not.toMatch(/Which chart/)
    expect(proposals()).toHaveLength(0)
  }, 30000)
})

// the name the builder's engine gives this formula (plain derived names, #500)
const DRAFT_NAME = 'EMA 9 vs EMA 20 %'
// #500: the name the SAME formula was saved under before plain names — a legacy auto name, kept as stored
const LEGACY_NAME = '(EMA 9 − EMA 20) ÷ EMA 20 × 100'
// a real saved definition (built and saved through the real builder and Save), then stored under `name`
async function savedBefore(name, tree = PCT) {
  builder.tree = tree
  const { say } = mount(...ONE(), { decorate: label1 })
  envelopes.push(build('propose'))
  await say(ASK)
  await waitFor(() => expect(summaries().join(' ')).toMatch(/Done — created your/), { timeout: 12000 })
  const [row] = [...server.values()]
  server.set(row.def_id, { ...row, definition: { ...row.definition, meta: { ...row.definition.meta, name } } })
  // the member's saved rows are re-read from the server, so the next panel has the row exactly as stored
  await act(() => mutate(USER_DEFINITIONS_KEY))
  cleanup(); _simulateReload(); _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  envelopes = []; calls = []; builder = { mode: 'ok', calls: [] }
  return row.def_id
}
describe('C4 · confirmations that stay', () => {
  it('a name the member already has: stops at a ready draft (nothing saved, nothing added); "apply it" is then a card, nothing saved before Apply', async () => {
    server.set('u_existing0001', { def_id: 'u_existing0001', version: 1, rev: 1, definition: { id: 'u_existing0001', version: 1, meta: { name: DRAFT_NAME } } })
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK)
    await waitFor(() => expect(transcript()).toMatch(/Not saved or applied yet — you already have an indicator named “EMA 9 vs EMA 20 %”/), { timeout: 12000 })
    expect(server.size).toBe(1)
    expect(customOn(board, 'c')).toHaveLength(0)
    expect(summaries().join(' ')).not.toMatch(/^Done/)
    await say('apply it')
    await waitFor(() => expect(proposals()).toHaveLength(1), { timeout: 8000 })
    expect(server.size).toBe(1)
    expect(customOn(board, 'c')).toHaveLength(0)
  }, 40000)

  // #500 (owner ruling 2026-10-29): the same MATHS is the same indicator, whatever name it was saved under
  it('the same maths saved before #500 under its legacy formula name: stops at a ready draft — nothing saved, nothing added; "apply it" is then a card', async () => {
    await savedBefore(LEGACY_NAME)
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK)
    await waitFor(() => expect(transcript()).toMatch(/Not saved or applied yet — you already have an indicator that calculates exactly this\. Say “apply it”/), { timeout: 12000 })
    expect(transcript()).not.toMatch(/EMA 20 × 100/)                       // a formula-style name is never put in chat
    expect(server.size).toBe(1)
    expect(customOn(board, 'c')).toHaveLength(0)
    expect(summaries().join(' ')).not.toMatch(/^Done/)
    await say('apply it')
    await waitFor(() => expect(proposals()).toHaveLength(1), { timeout: 8000 })
    expect(server.size).toBe(1)
  }, 60000)

  it('the same maths under a plain name the member typed: the stop names it', async () => {
    await savedBefore('My Trend Gap')
    const { say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK)
    await waitFor(() => expect(transcript()).toMatch(/Not saved or applied yet — you already have an indicator that calculates exactly this \(“My Trend Gap”\)/), { timeout: 12000 })
    expect(server.size).toBe(1)
  }, 60000)

  it('an explicit copy ("create another …") of the legacy-named one is still made: a second indicator, on the chart, no card', async () => {
    const first = await savedBefore(LEGACY_NAME)
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK.replace('Create a custom indicator', 'Create another custom indicator'))
    await waitFor(() => expect(summaries()).toContain(DONE), { timeout: 12000 })
    expect(server.size).toBe(2)
    expect(server.get(first).definition.meta.name).toBe(LEGACY_NAME)       // the saved one is never rewritten
    expect(customOn(board, 'c')).toHaveLength(1)
    expect(proposals()).toHaveLength(0)
  }, 60000)

  it('different maths (EMA 9 vs EMA 50) under a legacy formula name: no stop — built, saved and on the chart', async () => {
    await savedBefore('(EMA 9 − EMA 50) ÷ EMA 50 × 100', op('*', op('/', op('-', E9, call('ema', close, num(50))), call('ema', close, num(50))), num(100)))
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK)
    await waitFor(() => expect(summaries()).toContain(DONE), { timeout: 12000 })
    expect(server.size).toBe(2)
    expect(customOn(board, 'c')).toHaveLength(1)
  }, 60000)
})

describe('C5 · failures are never reported as done', () => {
  it('a malformed builder answer (model proposing) → the builder failure, plainly; nothing saved or added; no card', async () => {
    builder.mode = 'malformed'
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK)
    await waitFor(() => expect(transcript()).toMatch(/The indicator builder’s answer wasn’t a valid indicator, so nothing was saved\./), { timeout: 10000 })
    expect(transcript()).not.toMatch(/can’t check that approval|Done —|Saved to your indicators/)
    expect(server.size).toBe(0)
    expect(customOn(board, 'c')).toHaveLength(0)
    expect(proposals()).toHaveLength(0)
  }, 30000)
  it('a Save the store refuses → said; nothing on the chart, nothing reported as saved', async () => {
    server.refuse = true
    const { board, say } = mount(...ONE(), { decorate: label1 })
    envelopes.push(build('propose'))
    await say(ASK)
    await waitFor(() => expect(builder.calls).toEqual([ASK]), { timeout: 10000 })
    await idle()
    await waitFor(() => expect(transcript()).toMatch(/refused to save it|not saved|nothing was saved/i), { timeout: 10000 })
    expect(transcript()).not.toMatch(/Done —|Saved to your indicators|added it to/)
    expect(customOn(board, 'c')).toHaveLength(0)
    expect(proposals()).toHaveLength(0)
  }, 30000)
})
