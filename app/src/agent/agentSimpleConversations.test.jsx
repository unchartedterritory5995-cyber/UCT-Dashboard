// OWNER 2026-10-12 — "simplify conversations, remove redundant approvals". The REAL AgentPanel, useAgent,
// planner, policy, runtime, the REAL Indicators authoring interface (engine, draft store, canonical
// Save) and the REAL M2 chart adds. Stand-ins: the Agent model (/api/agent/turn), the builder's model
// (/converse) and the definitions server. Every check reads the CHART'S real state and the RENDERED chat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setAuthoringSources, _resetAuthoring, oneLineOf, shownName } from './capabilities/indicatorAuthoring'
import { _resetProposedPlans } from './capabilities/indicatorEdits'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { parseFormula } from '../components/chart/engine/ast/parse'
import { storeConversation } from '../components/chart/builder/conversationSave'
import { _simulateReload, STORAGE_KEY } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview } from '../components/chart/builder/agentAuthoring'
import { CREATE_INDICATOR_FLAG_KEY } from '../components/chart/builder/studio/createIndicatorFlag'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

// ── the builder's model (/converse): the member's sentence → a patch ──
const PATCH = 'uct.authoring.patch/1'
const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const INSIDE = 'high < high[1] && low > low[1]'
function converse({ message, state }) {
  const env = (ops, assumptions = []) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, ops, assumptions, disposition: 'change' } })
  const m = message.toLowerCase()
  const colour = /yellow/.test(m) ? '#ffff00' : '#ffffff'
  if (/inside candles?/.test(m) && !state.working) {
    return env([
      { op: 'create', name: 'Inside Candles', placement: 'price', outputs: [{ key: 'inside', label: 'Inside candle', tree: P(INSIDE) }] },
      { op: 'set_paint', output: 'inside', channel: 'barcolor', color: colour },
    ])
  }
  if (/yellow|white/.test(m)) return env([{ op: 'set_paint', output: 'inside', channel: 'barcolor', color: colour }])
  return { ok: true, disposition: 'unsupported', turn: 'noop', reply: 'I cannot build that.', envelope: null }
}

// ── the definitions server ──
let server
const fakeSave = async (doc, defId, _x, opts) => {
  const id = defId || `u_aaaaaaaaac${String(server.size + 10).padStart(2, '0')}`
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  server.set(id, { def_id: id, version, rev: 1, definition: { ...doc, id, version } })
  return { ok: true, row: { def_id: id, version, rev: 1 } }
}

// ── the Agent model (/api/agent/turn), scripted per test ──
let envelopes, calls
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  server = new Map(); envelopes = []; calls = []
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
    if (String(url).startsWith('/api/ticker-search')) return json({ results: [] })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const turns = () => calls.filter(c => c[1] === '/api/agent/turn').length
const transcript = () => screen.getByTestId('agent-transcript').textContent
const proposals = () => screen.queryAllByTestId('agent-proposal')
// the panel takes the next message only once it is idle (it drops sends while busy)
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(charts = [{ id: 'c', x: 0, sym: 'QQQ' }], { selected = null } = {}) {
  const widgets = charts.map(c => ({ id: c.id, type: 'chart', x: c.x, y: 0, w: 12, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }))
  const board = makeBoard(widgets, Object.fromEntries(charts.map(c => [`N:${c.id}`, c.sym])))
  const pos = charts.length > 1 ? Object.fromEntries(charts.map((c, i) => [c.id, i === 0 ? 'left' : 'right'])) : {}
  const base = board.host.charts
  const decorate = (s) => (s ? { ...s, position: pos[s.ref] || null, label: pos[s.ref] ? `${pos[s.ref][0].toUpperCase()}${pos[s.ref].slice(1)} chart (${s.symbol})` : `Chart (${s.symbol})`, ...(selected === s.ref ? { selected: true } : {}) } : s)
  const h = {
    ...board.host,
    charts: { ...base, list: () => base.list().map(decorate), read: (ref) => decorate(base.read(ref)),
      canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null,
      selected: () => selected },
    persist: async () => ({ ok: true }),
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  // the panel installs its own sources on mount; the definitions server + builder stand-ins ride along
  setAuthoringSources({ extra: { converse, readBack: async (id) => server.get(id) || null, store: (s, o) => storeConversation(s, { ...o, save: fakeSave }) } })
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { board, h, say }
}
const customOn = (board, id) => (mergeChartSettings(JSON.stringify(board.state.widgets.find(w => w.id === id)?.opts?.settings || null)).indicatorInstances || []).filter(i => !i.deleted && /^u_/.test(String(i.defId)))
const newRef = (b) => b.context.indicatorDrafts.find(e => e.new).ref
const activeRef = (b) => b.context.indicatorDrafts.find(e => e.active && !e.new)?.ref
const chartRef = (b, i = 0) => b.context.charts[i].ref
const draftOp = (b, message, target = newRef(b), chart = chartRef(b)) => ({ action: 'indicator.draft', target, args: { message, chart, edit: null } })
// the Agent's OWN wording never carries machinery (the builder's chosen indicator NAME is its own — see report)
const NO_TECH = /&&|\bAST\b|compiler|binding|draft revision|builder's summary|readback|Setting "|Look:|Default:|Used as a/

describe('A — build, then apply in a second message', () => {
  it('"I want all inside candles to be colored white." → one short "Draft ready (not saved yet)…" line; "Apply it to my chart." → applied, ONE message, no card, no model call', async () => {
    const { board, say } = mount()
    envelopes.push(b => env('apply', [draftOp(b, 'I want all inside candles to be colored white.')]))
    await say('I want all inside candles to be colored white.')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready \(not saved yet\): Candles painted white where .+ is true \(normal colour otherwise\)\. Want me to apply it or change anything\?/), { timeout: 6000 })
    expect(transcript()).not.toMatch(NO_TECH)
    expect(customOn(board, 'c')).toHaveLength(0)                         // nothing applied yet
    const before = turns()
    const receiptsBefore = screen.queryAllByTestId('agent-receipt').length
    await say('Apply it to my chart.')
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(1), { timeout: 8000 })
    await waitFor(() => expect(screen.queryAllByTestId('agent-receipt').length).toBe(receiptsBefore + 1), { timeout: 6000 })
    const last = screen.queryAllByTestId('agent-receipt').at(-1).textContent
    expect(last).toMatch(/Chart \(QQQ\)|QQQ/)
    expect(last).toMatch(/Saved to your indicators — that’s permanent; Undo takes it off the chart, the saved indicator stays\./)
    expect(proposals()).toHaveLength(0)                                  // no Apply/Approve click
    expect(turns()).toBe(before)                                         // "Apply it" needed no model call
    expect(server.size).toBe(1)                                          // exactly one definition saved
  }, 20000)
})

describe('B — build and apply in ONE message (R1)', () => {
  it('builds, saves and applies with no question and no card; the message says what was saved', async () => {
    const { board, say } = mount()
    const text = 'Build an indicator that colors inside candles white and apply it to my chart.'
    envelopes.push(b => env('apply', [draftOp(b, text), { action: 'indicator.saveDraft', target: newRef(b), args: { addTo: [chartRef(b)], name: null } }]))
    await say(text)
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(1), { timeout: 8000 })
    await waitFor(() => expect(transcript()).toMatch(/Saved to your indicators — Candles painted white where .+ is true/), { timeout: 6000 })
    expect(proposals()).toHaveLength(0)
    expect(transcript()).not.toMatch(/Want me to apply it/)              // it was applied — never asked
    expect(transcript()).not.toMatch(NO_TECH)
    expect(server.size).toBe(1)
  }, 20000)
  it('the model planning a save WITHOUT the member asking (e.g. "looks good") still shows the card — never inferred', async () => {
    const { board, say } = mount()
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white')]))
    await say('inside candles white')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    envelopes.push(b => env('apply', [{ action: 'indicator.saveDraft', target: activeRef(b), args: { addTo: [chartRef(b)], name: null } }]))
    await say('looks good')
    await waitFor(() => expect(proposals().length).toBe(1), { timeout: 6000 })
    expect(customOn(board, 'c')).toHaveLength(0)
    expect(server.size).toBe(0)
  }, 20000)
})

describe('C — refine the draft before applying', () => {
  it('"Make the candles yellow instead." → "Draft updated (not saved yet): … yellow …"; then "apply it" applies the yellow one', async () => {
    const { board, say } = mount()
    envelopes.push(b => env('apply', [draftOp(b, 'build an inside candles indicator')]))
    await say('build an inside candles indicator')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    envelopes.push(b => env('apply', [draftOp(b, 'Make the candles yellow instead.', activeRef(b), null)]))
    await say('Make the candles yellow instead.')
    await waitFor(() => expect(transcript()).toMatch(/Draft updated \(not saved yet\): Candles painted yellow/), { timeout: 6000 })
    await say('Apply it.')
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(1), { timeout: 8000 })
    expect(JSON.stringify([...server.values()][0].definition)).toMatch(/ffff00/i)
    expect(proposals()).toHaveLength(0)
  }, 20000)
})

describe('D — modifying an indicator that is already saved keeps ONE short confirmation (Indicators (e))', () => {
  it('a new version changes it everywhere it is used → a one-line card, not silent', async () => {
    const { board, say } = mount()
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white')]))
    await say('inside candles white')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    await say('apply it')
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(1), { timeout: 8000 })
    const defId = [...server.keys()][0]
    envelopes.push(b => env('apply', [{ action: 'indicator.draft', target: newRef(b), args: { message: 'make them yellow', chart: chartRef(b), edit: defId } }]))
    await say('make them yellow')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready \(not saved yet\): Candles painted yellow/), { timeout: 6000 })
    await say('apply it')
    await waitFor(() => expect(proposals().length).toBe(1), { timeout: 6000 })
    // the chart already shows it: a new version updates it there — the card never offers a second copy
    expect(proposals()[0].textContent).toMatch(/This updates (?:“.+”|your saved indicator) everywhere it’s used — save version 2(?! and add)/)
    await say('do it')
    await waitFor(() => expect([...server.values()][0].version).toBe(2), { timeout: 8000 })
    await waitFor(() => expect(transcript()).toMatch(/Updated (?:“.+”|your indicator) to version 2 — every chart using it shows the change now\. That’s permanent \(no Undo\)\./), { timeout: 6000 })
    expect(customOn(board, 'c')).toHaveLength(1)                         // still ONE copy on the chart
  }, 25000)
})

describe('E — Undo a reversible chart change', () => {
  it('"undo that" after applying takes the indicator off the chart (the saved indicator stays, as said)', async () => {
    const { board, say } = mount()
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white')]))
    await say('inside candles white')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    await say('apply it')
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(1), { timeout: 8000 })
    await waitFor(() => expect(screen.queryAllByTestId('agent-receipt').at(-1).getAttribute('data-undoable')).toBe('true'), { timeout: 6000 })
    await say('undo that')
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(0), { timeout: 6000 })
    expect(server.size).toBe(1)
  }, 20000)
})

describe('F — the right chart when several are open', () => {
  const TWO = [{ id: 'l', x: 0, sym: 'NVDA' }, { id: 'r', x: 12, sym: 'QQQ' }]
  it('the chart the member clicked gets it ("apply it to my chart")', async () => {
    const { board, say } = mount(TWO, { selected: 'r' })
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white', newRef(b), chartRef(b, 1))]))
    await say('inside candles white')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    await say('Apply it to my chart.')
    await waitFor(() => expect(customOn(board, 'r')).toHaveLength(1), { timeout: 8000 })
    expect(customOn(board, 'l')).toHaveLength(0)
    expect(proposals()).toHaveLength(0)
  }, 20000)
  it('no click and no chart named → never guessed: the model plans, and a chart the member did not name gets the card', async () => {
    const { board, say } = mount(TWO)
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white', newRef(b), chartRef(b, 0))]))
    await say('inside candles white')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    envelopes.push(b => env('apply', [{ action: 'indicator.saveDraft', target: activeRef(b), args: { addTo: [chartRef(b, 0)], name: null } }]))
    await say('Apply it to my chart.')
    await waitFor(() => expect(proposals().length).toBe(1), { timeout: 6000 })
    expect(customOn(board, 'l')).toHaveLength(0)
  }, 20000)
})

describe('H — routine explicit actions need no click; safety boundaries stay', () => {
  it('"make both charts weekly" (explicit, reversible, two charts) runs at once — no card', async () => {
    const { board, say } = mount([{ id: 'l', x: 0, sym: 'NVDA' }, { id: 'r', x: 12, sym: 'QQQ' }])
    await say('make both charts weekly')
    await waitFor(() => expect(board.state.widgets.every(w => w.opts?.tf === 'W')).toBe(true), { timeout: 6000 })
    expect(proposals()).toHaveLength(0)
  }, 20000)
  it('a model PROPOSAL (taste: "make it cleaner") is still a card', async () => {
    const { say } = mount()
    envelopes.push(b => env('propose', [{ action: 'volume.setState', target: chartRef(b), args: { state: 'hidden' } }], 'A calmer chart.'))
    await say('make it cleaner')
    await waitFor(() => expect(proposals().length).toBe(1), { timeout: 6000 })
  }, 20000)
  it('a bare "On it." before an applied change is not shown — the receipt is the confirmation', async () => {
    const { say } = mount()
    envelopes.push(b => env('apply', [{ action: 'volume.setState', target: chartRef(b), args: { state: 'hidden' } }], 'On it.'))
    await say('could you get the volume out of my way')
    await waitFor(() => expect(screen.queryAllByTestId('agent-receipt').length).toBe(1), { timeout: 6000 })
    expect(transcript()).not.toMatch(/On it\./)
  }, 20000)
})

// Indicators' conditions (2026-10-12), each through the same real panel
describe('the card stays where the member must see something (Indicators (a)/(b), R1)', () => {
  const pivot = (state) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, ops: [{ op: 'create', name: 'Pivot highs', placement: 'price', outputs: [{ key: 'ph', label: 'Pivot high', tree: P('pivothigh(high, 2, 2)') }] }], assumptions: [], disposition: 'change' } })
  it('a draft that needs an ACKNOWLEDGEMENT (it repaints) keeps the card, showing the warning — "apply it" never skips it', async () => {
    const { board, say } = mount()
    setAuthoringSources({ extra: { converse: ({ state }) => pivot(state), readBack: async (id) => server.get(id) || null, store: (s, o) => storeConversation(s, { ...o, save: fakeSave }) } })
    envelopes.push(b => env('apply', [draftOp(b, 'mark pivot highs')]))
    await say('mark pivot highs')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    await say('apply it')
    await waitFor(() => expect(proposals().length).toBe(1), { timeout: 6000 })
    expect(proposals()[0].textContent).toMatch(/You are also acknowledging:/)
    expect(customOn(board, 'c')).toHaveLength(0)
    expect(server.size).toBe(0)
  }, 20000)
  it('BUILD AND APPLY of something that needs an acknowledgement STOPS at a ready draft (nothing saved), saying why', async () => {
    const { board, say } = mount()
    setAuthoringSources({ extra: { converse: ({ state }) => pivot(state), readBack: async (id) => server.get(id) || null, store: (s, o) => storeConversation(s, { ...o, save: fakeSave }) } })
    const text = 'Build an indicator that marks pivot highs and apply it to my chart.'
    envelopes.push(b => env('apply', [draftOp(b, text), { action: 'indicator.saveDraft', target: newRef(b), args: { addTo: [chartRef(b)], name: null } }]))
    await say(text)
    await waitFor(() => expect(transcript()).toMatch(/Not saved or applied yet — it needs your acknowledgement first: .+ Say “apply it” when you’re ready\./), { timeout: 8000 })
    expect(server.size).toBe(0)
    expect(customOn(board, 'c')).toHaveLength(0)
  }, 20000)
  it('a NEW indicator under a name the member already has keeps the card (duplicate)', async () => {
    const { say } = mount()
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white')]))
    await say('inside candles white')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    await say('apply it')
    await waitFor(() => expect(server.size).toBe(1), { timeout: 8000 })
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white')]))
    await say('build inside candles white again')
    await waitFor(() => expect(transcript().match(/Draft ready/g)?.length).toBe(2), { timeout: 6000 })
    await say('apply it')
    await waitFor(() => expect(proposals().length).toBe(1), { timeout: 6000 })
    expect(server.size).toBe(1)
  }, 25000)
  it('a NAME the member never said (model-invented) keeps the card', async () => {
    const { say } = mount()
    envelopes.push(b => env('apply', [draftOp(b, 'inside candles white')]))
    await say('inside candles white')
    await waitFor(() => expect(transcript()).toMatch(/Draft ready/), { timeout: 6000 })
    envelopes.push(b => env('apply', [{ action: 'indicator.saveDraft', target: activeRef(b), args: { addTo: [], name: 'Golden Inside Bars' } }]))
    await say('save the indicator please')
    await waitFor(() => expect(proposals().length).toBe(1), { timeout: 6000 })
    expect(server.size).toBe(0)
  }, 20000)
})

describe('formula-like builder names never reach chat (Indicators 10-12)', () => {
  it('a derived name that reads like a formula is replaced; plain names are shown', () => {
    expect(shownName('EMA 9 > EMA 20', 'your indicator')).toBe('your indicator')
    expect(shownName('EMA 9 · EMA 20 +3', 'it')).toBe('it')
    expect(shownName('9/20 EMA trend', 'it')).toBe('“9/20 EMA trend”')
    expect(shownName('RSI (14)', 'it')).toBe('“RSI (14)”')
    const st = { name: 'High < High[1] and Low > Low[1]', readback: { outputs: [{ name: 'High <', phrase: 'marks inside candles' }] } }
    expect(oneLineOf(st)).toBe('marks inside candles')
    expect(oneLineOf({ name: 'EMA 9 > EMA 20', readback: {} })).toBe('your indicator')
  })
})
