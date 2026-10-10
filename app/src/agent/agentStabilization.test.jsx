// M3 final stabilization (post-release acceptance findings):
//   F2b — "save it" with an indicator draft open is never a layout save (fast path + model path)
//   R1  — "save it as X": the rename is its own draft step FIRST, so the Save card shows the final
//         name and its exact repaint acknowledgement; the F6 seal is unchanged
//   M1  — a preview nobody asked for is never part of indicator creation
// Real Indicators authoring interface, engine, draft store and canonical Save; only the model reply
// (/converse, /api/agent/turn) and the definitions server are stand-ins.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { fastParse } from './fastPath'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import {
  setAuthoringSources, _resetAuthoring, indicatorDraftsKind, saveReferent, splitSaveAs, screenModelOps, asksToPreview, SAVE_ASK_TEXT,
} from './capabilities/indicatorAuthoring'
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

const PATCH = 'uct.authoring.patch/1'
const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
let calls
function converse({ message, state }) {
  calls.push({ message, revision: state.revision })
  const env = (ops) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, ops, assumptions: [], disposition: 'change' } })
  const m = message.toLowerCase()
  if (m.startsWith('build me an ema')) return env([{ op: 'create', name: 'EMA 20', placement: 'price', outputs: [{ key: 'e20', label: 'EMA 20', tree: P('ema(close, 20)') }] }])
  if (m.startsWith('mark pivot highs')) return env([{ op: 'create', name: 'Pivot highs', placement: 'price', outputs: [{ key: 'ph', label: 'Pivot high', tree: P('pivothigh(high, 2, 2)') }] }])
  return { ok: true, disposition: 'unsupported', turn: 'noop', reply: 'I cannot build that.', envelope: null }
}
let server, stored
const fakeSave = async (doc, defId, _x, opts) => {
  const id = defId || `u_aaaaaaaaac${String(server.size + 10).padStart(2, '0')}`
  server.set(id, { def_id: id, version: 1, rev: 1, definition: { ...doc, id, version: 1 } })
  stored.push({ doc, defId, opts })
  return { ok: true, row: { def_id: id, version: 1, rev: 1 } }
}
const rows = () => [...server.values()]
let fetchCalls, envelopes
beforeEach(() => {
  calls = []; server = new Map(); stored = []; fetchCalls = []; envelopes = []
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans()
  setOwnedDefinitionSource(() => rows().map(r => r.def_id))
  setAuthoringSources({
    access: () => true, rows,
    extra: { converse, readBack: async (id) => server.get(id) || null, store: (s, o) => storeConversation(s, { ...o, save: fakeSave }) },
  })
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    fetchCalls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: rows() })
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

function host(specs, { layouts = true } = {}) {
  const store = Object.fromEntries(specs.map(s => [s.ref, JSON.parse(JSON.stringify(mergeChartSettings(null)))]))
  const saves = []
  const h = {
    specs, store, saves,
    charts: {
      list: () => h.specs.map(s => ({ ref: s.ref, label: s.label, position: s.position, symbol: s.symbol, tf: 'D', cs: mergeChartSettings(JSON.stringify(store[s.ref])), stored: store[s.ref] })),
      read: (ref) => h.charts.list().find(c => c.ref === ref) || null,
      commit: (ref, patch) => { store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null,
    },
    persist: async () => ({ ok: true }),
  }
  // a saved layout is OPEN (so "save it" COULD mean the layout — the S6 F2b shape)
  if (layouts) {
    h.layouts = {
      snapshot: () => ({ entries: [{ id: '109', name: 'Agent Indicators Acceptance', kind: 'yours', scope: 'user' }], active: { scope: 'user', id: '109', name: 'Agent Indicators Acceptance' }, unsaved: true }),
      saveCurrent: async () => { saves.push('saveCurrent'); return { ok: true } },
      saveAs: async (name) => { saves.push(`saveAs:${name}`); return { ok: true } },
    }
  }
  return h
}
const L = { ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA' }
const CTX = { surface: 'charts', createIndicator: true }
const NEW = 'draft:new'
const KINDS = ['indicatorDrafts', 'indicatorEdits', 'indicators', 'chart']
async function run(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  const p = planOps(collectTargets(h, KINDS), ops, env, CTX)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return commitPlan(h, p, { env, ctx: CTX })
}
const drafts = (h) => indicatorDraftsKind.list(h).filter(s => !s.new)
const activeRef = (h) => drafts(h).find(s => s.active)?.ref
const say = (target, message) => ({ action: 'indicator.draft', target, args: { message, chart: 'L', edit: null } })
const emaDraft = async (h) => { await run(h, [say(NEW, 'Build me an EMA 20 indicator')]); return activeRef(h) }
const pivotDraft = async (h) => { await run(h, [say(NEW, 'mark pivot highs')]); return activeRef(h) }
const unselect = () => { try { sessionStorage.removeItem('uct.agent.activeDraft') } catch { /* */ } ; _resetAuthoringActiveOnly() }
// the selected-draft pointer is cached in the module too: drop it the way a reload does
function _resetAuthoringActiveOnly() { const keep = sessionStorage.getItem(STORAGE_KEY); _resetAuthoring(); if (keep) sessionStorage.setItem(STORAGE_KEY, keep) }

function mount(h) {
  localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
  render(<AuthContext.Provider value={{ user: { role: 'admin' }, cohorts: [] }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  return (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const turns = () => fetchCalls.filter(c => c[1] === '/api/agent/turn').length
const cards = () => screen.queryAllByTestId('agent-proposal').map(e => e.textContent)

// ── F2b ────────────────────────────────────────────────────────────────────────────────
describe('F2b — "save it" with an indicator draft open is never a layout save', () => {
  it('the rule: the selected draft for "save it / save this / save it as X / save the indicator"; explicit layout wording is not decided here', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    for (const t of ['Save it.', 'Save this', 'save it please', 'Save it as Trend', 'save this as “Trend 2”', 'Save the indicator.', 'save the draft as Trend 3']) {
      const r = saveReferent(h, t)
      expect(r?.kind, t).toBe('draft')
      expect(r.target).toBe(ref)
    }
    expect(saveReferent(h, 'Save it as Trend').name).toBe('Trend')
    expect(saveReferent(h, 'save this as “Trend 2”').name).toBe('Trend 2')
    for (const t of ['Save this layout', 'Save it to my layout', 'save this workspace as Morning', 'Save the board', 'save my setup']) expect(saveReferent(h, t), t).toBe(null)
    expect(saveReferent(h, 'save')).toBe(null)
  })
  it('no draft open → unchanged: the rule stays out of it, and "Save it." is still the layout\'s Save', () => {
    const h = host([L])
    for (const t of ['Save it.', 'Save this', 'Save it as Trend']) expect(saveReferent(h, t), t).toBe(null)
    expect(fastParse('Save it.', { host: h })?.ops?.map(o => o.action)).toEqual(['layout.saveCurrent'])
    expect(fastParse('Save this as Morning', { host: h })?.ops?.map(o => o.action)).toEqual(['layout.saveAs'])
  })
  it('the fast path with the selected draft: "Save it." → the indicator Save (its target), never layout.saveCurrent; explicit layout wording still the layout', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    for (const t of ['Save it.', 'Save this.', 'Save it as Trend.']) {
      const hit = fastParse(t, { host: h })
      expect(hit?.ops?.map(o => [o.action, o.target]), t).toEqual([['indicator.saveDraft', ref]])
    }
    expect(fastParse('Save the layout.', { host: h })?.ops?.map(o => o.action)).toEqual(['layout.saveCurrent'])
    expect(fastParse('Save this workspace as Morning', { host: h })?.ops?.map(o => o.action)).toEqual(['layout.saveAs'])
  })
  it('drafts open but NONE selected (after a reload) → the question, with both choices; nothing is proposed', async () => {
    const h = host([L])
    await emaDraft(h)
    unselect()
    expect(drafts(h)).toHaveLength(1)
    const r = saveReferent(h, 'Save it.')
    expect(r).toMatchObject({ kind: 'ask', text: SAVE_ASK_TEXT })
    expect(r.choices.map(c => c.label)).toEqual(['Save the indicator draft', 'Save this workspace layout'])
    expect(saveReferent(h, 'Save it as Trend').choices.map(c => c.label)).toEqual(['Save the indicator draft as Trend', 'Save this workspace as a new layout called Trend'])
    // "save the indicator" with exactly ONE draft open is that draft
    expect(saveReferent(h, 'Save the indicator.')?.kind).toBe('draft')
    expect(fastParse('Save it.', { host: h })).toBe(null)               // neither the layout nor the draft claims it
  })
  it('end to end (the acceptance repro): "Save it." with the draft selected → an INDICATOR Save card; no layout write, no model call', async () => {
    const h = host([L])
    await emaDraft(h)
    const send = mount(h)
    send('Save it.')
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(cards()[0]).toMatch(/^Proposed changesSave “EMA 20” as a new indicator \(draft revision 1\)/)
    expect(cards()[0]).not.toMatch(/layout/i)
    expect(turns()).toBe(0)
    send('do it')
    await waitFor(() => expect(stored).toHaveLength(1), { timeout: 4000 })
    expect(h.saves).toEqual([])                                            // the layout was never saved
  })
  it('end to end: drafts open, none selected → "Save it." asks; no card, no write, no model call', async () => {
    const h = host([L])
    await emaDraft(h)
    unselect()
    const send = mount(h)
    send('Save it.')
    await waitFor(() => expect(transcript()).toContain(SAVE_ASK_TEXT))
    expect(cards()).toHaveLength(0)
    expect(turns()).toBe(0)
    expect(h.saves).toEqual([])
    expect(stored).toEqual([])
  })
  it('end to end: no draft open → "Save it." is still the layout\'s Save card (unchanged behaviour)', async () => {
    const h = host([L])
    const send = mount(h)
    send('Save it.')
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(cards()[0]).toMatch(/Agent Indicators Acceptance/)
  })
})

// ── R1 ─────────────────────────────────────────────────────────────────────────────────
describe('R1 — "save it as X": rename first (its own step), then a Save card that shows the final name AND its exact warning', () => {
  it('splitSaveAs: a new name → the specialist\'s TYPED rename first, then the save with no name; the same name → just the save', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    const sp = splitSaveAs(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: 'Trend' } }])
    expect(sp.rename).toEqual({ target: ref, name: 'Trend' })
    expect(sp.save.args).toEqual({ addTo: [], name: null })
    const same = splitSaveAs(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: 'EMA 20' } }])
    expect(same.rename).toBe(null)
    expect(splitSaveAs(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }])).toBe(null)
  })
  it('end to end on a REPAINTING draft: one rename receipt (with Undo), then ONE card whose warning already carries the new name → Apply saves first time', async () => {
    const h = host([L])
    await pivotDraft(h)
    const n = calls.length
    const send = mount(h)
    send('Save it as Swing Highs.')
    await waitFor(() => expect(cards()).toHaveLength(1), { timeout: 4000 })
    expect(transcript()).toMatch(/Renamed the draft to “Swing Highs” \(draft — not saved\)\./)   // the rename, its own step
    expect(calls.length).toBe(n)                                                  // no model call for the name
    const card = cards()[0]
    expect(card).toMatch(/Save “Swing Highs” as a new indicator \(draft revision 2\)/)
    expect(card).toMatch(/You are also acknowledging: Swing Highs reads .+ ahead, so .+ — confirm below before saving/)
    send('do it')
    await waitFor(() => expect(stored).toHaveLength(1), { timeout: 4000 })
    expect(stored[0].doc.meta.name).toBe('Swing Highs')
    expect(stored[0].opts).toMatchObject({ previewAcked: true })
    expect(transcript()).not.toMatch(/needs your acknowledgement first/)
    expect(transcript()).not.toMatch(/nothing was left changed/)
  })
  it('an unusual name (punctuation, dash, quotes) is still a name-only rename: no model call, the card shows it', async () => {
    const h = host([L])
    await pivotDraft(h)
    const n = calls.length
    const send = mount(h)
    send('Save it as RSI-14 (fast) “v2”.')
    await waitFor(() => expect(cards()).toHaveLength(1), { timeout: 4000 })
    expect(calls.length).toBe(n)                                                  // renameDraft never reaches the model
    const name = drafts(h)[0].status.name
    expect(name).toMatch(/RSI-14 \(fast\)/)
    expect(cards()[0]).toContain(`Save “${name}” as a new indicator`)
    expect(cards()[0]).toContain(`You are also acknowledging: ${name} reads `)
  })
  it('the rename has its own exact Undo (the specialist\'s step): Undo puts the old name back; no Save happened', async () => {
    const h = host([L])
    await emaDraft(h)
    const send = mount(h)
    send('Save it as Trend One.')
    await waitFor(() => expect(cards()).toHaveLength(1), { timeout: 4000 })
    expect(drafts(h)[0].status.name).toBe('Trend One')
    send('cancel')
    await waitFor(() => expect(transcript()).toContain('Okay — nothing changed.'))
    send('undo')
    await waitFor(() => expect(drafts(h)[0].status.name).toBe('EMA 20'), { timeout: 4000 })
    await waitFor(() => expect(transcript()).toMatch(/Undid the last change to/), { timeout: 4000 })
    expect(stored).toEqual([])
  })
  it('Undo of the rename reverses ONLY the rename: an earlier maths edit on the same draft stays', async () => {
    const h = host([L])
    const ref = await pivotDraft(h)                                              // rev 1: pivots
    const before = drafts(h)[0].status
    const send = mount(h)
    send('Save it as Swing Watch.')
    await waitFor(() => expect(cards()).toHaveLength(1), { timeout: 4000 })
    const renamed = drafts(h)[0].status
    expect(renamed.revision).toBe(before.revision + 1)
    send('cancel')
    await waitFor(() => expect(transcript()).toContain('Okay — nothing changed.'))
    send('undo')
    await waitFor(() => expect(drafts(h)[0].status.name).toBe(before.name), { timeout: 4000 })
    const after = drafts(h)[0].status
    expect(after.lines).toEqual(before.lines)                                    // the maths (pivot output) is untouched
    expect(after.ackText).toEqual(before.ackText)                                // and its warning is the pre-rename one again
    expect(drafts(h).map(d => d.ref)).toEqual([ref])                             // same draft, not a new one
    expect(stored).toEqual([])
  })
  it('a refused rename (the draft is open in Create Indicator) → no Save card at all', async () => {
    const h = host([L])
    await emaDraft(h)
    const { holdInDock } = await import('../components/chart/builder/authoring/conversationSessions')
    holdInDock(drafts(h)[0].draftRef.key)
    const send = mount(h)
    send('Save it as Trend Two.')
    await waitFor(() => expect(transcript()).toMatch(/open in Create Indicator/), { timeout: 4000 })
    expect(cards()).toHaveLength(0)
    expect(stored).toEqual([])
  })
  it('the F6 seal still binds: the renamed draft changed after the card → refused, nothing saved', async () => {
    const h = host([L])
    await pivotDraft(h)
    const send = mount(h)
    send('Save it as Swing Highs.')
    await waitFor(() => expect(cards()).toHaveLength(1), { timeout: 4000 })
    await run(h, [say(activeRef(h), 'Name it Other Name')])                   // the draft moves under the card
    send('do it')
    await waitFor(() => expect(transcript()).toMatch(/changed since you approved it|no longer matches what you approved/), { timeout: 4000 })
    expect(stored).toEqual([])
  })
  it('the old one-request rename path (planner direct) never says "nothing was left changed" when the rename stays', async () => {
    const h = host([L])
    const ref = await pivotDraft(h)
    buildContext(h, CTX)
    const ops = [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: 'Swing' } }]
    const p = planOps(collectTargets(h, KINDS), ops, await prepareOps(ops), CTX)
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/Renamed it to “Swing” \(draft — not saved\), but didn’t save it: .* — the draft keeps its new name; nothing was saved$/)
    expect(res.failed[0].reason).not.toMatch(/nothing was left changed/)
    expect(stored).toEqual([])
  })
})

describe('R1 — renameDraft is the ONLY rename path', () => {
  it('the model\'s "Name it X" + Save shape is screened into ONE "save as X" (then split into renameDraft + the Save card)', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    const ops = [{ action: 'indicator.draft', target: ref, args: { message: 'Name it “Trend Watch”.', chart: null, edit: null } }, { action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }]
    const s = screenModelOps(h, ops, 'Name it Trend Watch and save it.', CTX)
    expect(s.ops).toEqual([{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: 'Trend Watch' } }])
    // a real maths change + Save is NOT rewritten: it stays two ops, and the planner refuses it
    const maths = [{ action: 'indicator.draft', target: ref, args: { message: 'make the slow line 50', chart: null, edit: null } }, ops[1]]
    expect(screenModelOps(h, maths, 'make the slow line 50 and save it', CTX).ops).toHaveLength(2)
  })
  it('end to end: the model plans the two-op form → one rename receipt (renameDraft, no model call) + one Save card on the renamed draft', async () => {
    const h = host([L])
    await emaDraft(h)
    const n = calls.length
    const send = mount(h)
    envelopes.push(b => {
      const d = b.context.indicatorDrafts.find(e => e.active).ref
      return { disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
        { action: 'indicator.draft', target: d, args: { message: 'Name it Trend Watch', chart: null, edit: null } },
        { action: 'indicator.saveDraft', target: d, args: { addTo: [], name: null } },
      ] }
    })
    send('Call it Trend Watch and save it.')
    await waitFor(() => expect(cards()).toHaveLength(1), { timeout: 4000 })
    expect(transcript()).toMatch(/Renamed the draft to “Trend Watch” \(draft — not saved\)\./)
    expect(cards()[0]).toMatch(/Save “Trend Watch” as a new indicator/)
    expect(calls.length).toBe(n)
    expect(stored).toEqual([])
  })
})

// ── M1 ─────────────────────────────────────────────────────────────────────────────────
describe('M1 — no unrequested preview in indicator creation; asked-for previews still work', () => {
  const draftOp = { action: 'indicator.draft', target: NEW, args: { message: 'x', chart: 'L', edit: null } }
  const previewOp = (t = 'draft:k') => ({ action: 'indicator.previewDraft', target: t, args: { chart: 'L' } })
  it('asksToPreview reads the member\'s words (negation aware)', () => {
    for (const t of ['Show me the preview on the QQQ chart.', 'build it and preview it', 'let me see it on the chart', 'show me how it looks']) expect(asksToPreview(t), t).toBe(true)
    for (const t of ['Build me an indicator that marks pivot highs on the QQQ chart.', 'build an indicator that shows when RSI crosses 50', 'No preview.', 'build it, don\'t preview it']) expect(asksToPreview(t), t).toBe(false)
  })
  it('the S6 shape: a new draft + an unrequested preview → the preview is dropped (with a note); the draft runs', () => {
    const h = host([L])
    const s = screenModelOps(h, [draftOp, previewOp(NEW)], 'Build me an indicator that marks pivot highs with 5 bars on each side on the QQQ chart.', CTX)
    expect(s.ops.map(o => o.action)).toEqual(['indicator.draft'])
    expect(s.notes).toContain('I won’t show a preview unless you ask for one.')
  })
  it('an explicit preview request is kept (alone, or with a change)', () => {
    const h = host([L])
    expect(screenModelOps(h, [previewOp()], 'Show me the preview on the left chart.', CTX).ops.map(o => o.action)).toEqual(['indicator.previewDraft'])
    expect(screenModelOps(h, [draftOp, previewOp()], 'Make it blue and preview it.', CTX).ops.map(o => o.action)).toEqual(['indicator.draft', 'indicator.previewDraft'])
  })
  it('end to end: the model plans a draft + an unasked preview → the draft is built, no preview shown, nothing refused', async () => {
    const h = host([L])
    let previews = 0
    h.charts.previewHost = () => ({ showAuthoringPreview: () => { previews += 1; return { ok: true } }, clearAuthoringPreview: () => true })
    const send = mount(h)
    envelopes.push(b => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
      { action: 'indicator.draft', target: b.context.indicatorDrafts.find(e => e.new).ref, args: { message: 'Build me an EMA 20 indicator', chart: b.context.charts?.[0]?.ref ?? 'L', edit: null } },
      { action: 'indicator.previewDraft', target: b.context.indicatorDrafts.find(e => e.new).ref, args: { chart: 'L' } },
    ] }))
    send('Build me an EMA 20 indicator on the left chart.')
    await waitFor(() => expect(transcript()).toMatch(/Started “EMA 20” \(draft — not saved\)/), { timeout: 4000 })
    expect(transcript()).toContain('I won’t show a preview unless you ask for one.')
    expect(transcript()).not.toMatch(/There is no draft to preview yet/)
    expect(previews).toBe(0)
  })
})
