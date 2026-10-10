// ⛔ S6 F6 — APPROVAL INTEGRITY for the M3 Save (docs: S6 report §7, scratchpad F6_design).
// A Save proposal binds to EXACTLY what its card showed: the draft (identity + revision), the
// operation and requested name, the target definition, the repaint acknowledgement, the builder's
// summary, the chart applications and an expiry. Apply plans FROM that seal; anything expired,
// stale or changed refuses BEFORE any rename, model turn, Save or chart add — and a new proposal
// (a new approval) is required. Real Indicators authoring interface, engine and draft store; only
// the model reply (/converse) and the definitions server are stand-ins (as agentIndicatorsM3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getTargetKind } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import {
  setAuthoringSources, _resetAuthoring, indicatorDraftsKind, sealSave, validateSaveSeal, PROPOSAL_TTL_MS,
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
  if (m.startsWith('also add an ema 50')) return env([{ op: 'add_output', key: 'e50', label: 'EMA 50', tree: P('ema(close, 50)') }])
  return { ok: true, disposition: 'unsupported', turn: 'noop', reply: 'I cannot build that.', envelope: null }
}
let server, stored
const fakeSave = async (doc, defId, _x, opts) => {
  const id = defId || `u_aaaaaaaaac${String(server.size + 10).padStart(2, '0')}`
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  server.set(id, { def_id: id, version, rev: 1, definition: { ...doc, id, version } })
  stored.push({ doc, defId, opts })
  return { ok: true, row: { def_id: id, version, rev: 1 } }
}
const rows = () => [...server.values()]

beforeEach(() => {
  calls = []; server = new Map(); stored = []
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans()
  setOwnedDefinitionSource(() => rows().map(r => r.def_id))
  setAuthoringSources({
    access: () => true, rows,
    extra: { converse, readBack: async (id) => server.get(id) || null, store: (s, o) => storeConversation(s, { ...o, save: fakeSave }) },
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

function host(specs) {
  const store = Object.fromEntries(specs.map(s => [s.ref, JSON.parse(JSON.stringify(mergeChartSettings(null)))]))
  const h = {
    specs, store,
    charts: {
      list: () => h.specs.map(s => ({ ref: s.ref, label: s.label, position: s.position, symbol: s.symbol, tf: 'D', cs: mergeChartSettings(JSON.stringify(store[s.ref])), stored: store[s.ref] })),
      read: (ref) => h.charts.list().find(c => c.ref === ref) || null,
      commit: (ref, patch) => { store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: () => true,
      canCreateIndicator: () => true,
      previewHost: () => null,
    },
    persist: async () => ({ ok: true }),
  }
  return h
}
const L = { ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA' }
const R = { ref: 'R', label: 'Right chart (AAPL)', position: 'right', symbol: 'AAPL' }
const CTX = { surface: 'charts', createIndicator: true }
const NEW = 'draft:new'
const KINDS = ['indicatorDrafts', 'indicatorEdits', 'indicators', 'chart']

async function plan(h, ops, extra = {}) {
  buildContext(h, CTX)
  const env = { ...(await prepareOps(ops)), ...extra }
  return { p: planOps(collectTargets(h, KINDS), ops, env, CTX), env }
}
async function run(h, ops) {
  const { p, env } = await plan(h, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return commitPlan(h, p, { env, ctx: CTX })
}
// what useAgent keeps with the card (the seals + the exact lines), and how its Apply plans
async function propose(h, ops) {
  const { p } = await plan(h, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return { ops, card: p.lines, seals: p.plans.map(x => getTargetKind(x.kind)?.seal?.(x)).filter(Boolean) }
}
async function approve(h, prop, { ops = prop.ops, seals = prop.seals } = {}) {
  const { p, env } = await plan(h, ops, { approved: true, approval: seals })
  if (!p.ok) return { ok: false, atPlan: true, failed: p.refusals.map(r => ({ reason: r.reason })) }
  return commitPlan(h, p, { env, ctx: CTX })
}
const drafts = (h) => indicatorDraftsKind.list(h).filter(s => !s.new)
const activeRef = (h) => drafts(h).find(s => s.active)?.ref
const say = (target, message, chart = 'L') => ({ action: 'indicator.draft', target, args: { message, chart, edit: null } })
const save = (ref, { addTo = [], name = null } = {}) => [{ action: 'indicator.saveDraft', target: ref, args: { addTo, name } }]
const at = (ms) => vi.spyOn(Date, 'now').mockReturnValue(ms)

/** Everything a refused Apply must leave alone. */
function snapshot(h) {
  const d = drafts(h)[0]?.status
  return { stored: stored.length, defs: server.size, calls: calls.length, revision: d?.revision, name: d?.name, charts: JSON.stringify(h.store) }
}
const nothingChanged = (h, before) => expect(snapshot(h)).toEqual(before)

async function emaDraft(h) { await run(h, [say(NEW, 'Build me an EMA 20 indicator')]); return activeRef(h) }
async function pivotDraft(h) { await run(h, [say(NEW, 'mark pivot highs')]); return activeRef(h) }

describe('⛔ F6 — a Save applies only what its card showed', () => {
  it('1. valid, unchanged, applied a minute later → saves exactly the sealed revision (no fresh read)', async () => {
    const T = 1_800_000_000_000
    at(T)
    const h = host([L, R])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref, { addTo: ['L'], name: 'S6 EMA' }))
    expect(prop.seals).toHaveLength(1)
    at(T + 60_000)
    const res = await approve(h, prop)
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(stored).toHaveLength(1)
    expect(server.get([...server.keys()][0]).definition.meta.name).toBe('S6 EMA')
    expect(res.followUps.map(f => f.target)).toEqual(['ixe:L'])            // exactly the approved chart
  })
  it('2. valid at 9 min 59 s → still saves (the edge of the window)', async () => {
    const T = 1_800_000_000_000
    at(T)
    const h = host([L])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref))
    at(T + PROPOSAL_TTL_MS - 1000)
    expect((await approve(h, prop)).ok).toBe(true)
    expect(stored).toHaveLength(1)
  })
  it('3. EXPIRED (10 min 1 s) → refused before anything runs: no rename, no model call, no Save, no chart add', async () => {
    const T = 1_800_000_000_000
    at(T)
    const h = host([L])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref, { addTo: ['L'], name: 'Late' }))
    const before = snapshot(h)
    at(T + PROPOSAL_TTL_MS + 1000)
    const res = await approve(h, prop)
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/^That proposal expired \(a proposal is good for 10 minutes\), so nothing was saved or added to a chart — ask me to save it again/)
    nothingChanged(h, before)
    expect(drafts(h)[0].status.name).not.toBe('Late')
  })
  it('4. THE S6 REPRO — expired AND the draft revised meanwhile → refused; the newer revision is never saved', async () => {
    const T = 1_800_000_000_000
    at(T)
    const h = host([L])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref, { name: 'Approved at rev 1' }))
    at(T + PROPOSAL_TTL_MS + 1)
    await run(h, [say(ref, 'also add an EMA 50')])                         // revision 2, a warning-free change
    expect(drafts(h)[0].status.revision).toBe(2)
    const before = snapshot(h)
    const res = await approve(h, prop)
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/expired/)
    nothingChanged(h, before)
    expect(stored).toEqual([])
  })
  it('5. stale revision INSIDE the window → refused (revision 1 → 2); nothing written', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref, { addTo: ['L'] }))
    await run(h, [say(ref, 'also add an EMA 50')])
    const before = snapshot(h)
    const res = await approve(h, prop)
    expect(res.failed[0].reason).toMatch(/The draft changed since you approved it \(revision 1 → 2\), so nothing was saved/)
    nothingChanged(h, before)
  })
  it('6. the repaint warning changed at the SAME revision (e.g. the builder\'s wording was corrected) → refused; also [] → [A] and [A] → [A, B]', async () => {
    const h = host([L])
    const ref = await pivotDraft(h)
    const prop = await propose(h, save(ref))
    const ack = drafts(h)[0].status.ackText
    expect(ack).toHaveLength(1)
    expect(prop.card[0]).toContain(`You are also acknowledging: ${ack[0]}`)
    const before = snapshot(h)
    for (const shown of [[`${ack[0]} (reworded)`], [], [ack[0], 'Another warning']]) {
      const res = await approve(h, prop, { seals: [{ ...prop.seals[0], ackShown: shown }] })
      expect(res.ok).toBe(false)
      expect(res.failed[0].reason).toMatch(/^The repainting warning changed since you approved it, so nothing was saved/)
    }
    nothingChanged(h, before)
    // the card's own warning, unchanged → saves (and the store is told it was acknowledged)
    const ok = await approve(h, prop)
    expect(ok.ok, JSON.stringify(ok.failed)).toBe(true)
    expect(stored[0].opts).toMatchObject({ previewAcked: true })
  })
  it('7. the target definition changed (create ↔ edit, another definition, another base version) → refused', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref))
    const before = snapshot(h)
    const s = prop.seals[0]
    for (const target of [{ mode: 'edit', defId: 'u_aaaaaaaaab01', baseVersion: 3 }, { ...s.target, defId: 'u_other' }, { ...s.target, baseVersion: 4 }]) {
      const res = await approve(h, prop, { seals: [{ ...s, target }] })
      expect(res.failed[0].reason).toMatch(/^The indicator it would save to changed since you approved it/)
    }
    nothingChanged(h, before)
  })
  it('8. the chart applications changed (a chart left the board / a different set) → refused, nothing saved or added', async () => {
    const h = host([L, R])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref, { addTo: ['L', 'R'] }))
    const before = snapshot(h)
    for (const addTo of [['L'], ['R'], []]) {
      const res = await approve(h, prop, { ops: save(ref, { addTo }) })
      expect(res.failed[0].reason).toMatch(/^The charts it would be added to changed since you approved it/)
    }
    h.specs = [L]                                                          // R closed after the card
    const gone = await approve(h, prop)
    expect(gone.ok).toBe(false)
    nothingChanged(h, { ...before, charts: JSON.stringify(h.store) })
  })
  it('9. the operation / requested name changed → refused ("That isn’t the save you approved")', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref, { name: 'Alpha' }))
    const before = snapshot(h)
    for (const name of ['Beta', null]) {
      const res = await approve(h, prop, { ops: save(ref, { name }) })
      expect(res.failed[0].reason).toMatch(/^That isn’t the save you approved/)
    }
    nothingChanged(h, before)
  })
  it('10. the builder\'s summary differs at the same revision → refused (defensive)', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    const prop = await propose(h, save(ref))
    const before = snapshot(h)
    const res = await approve(h, prop, { seals: [{ ...prop.seals[0], linesShown: ['something else'] }] })
    expect(res.failed[0].reason).toMatch(/^The draft’s summary changed since you approved it/)
    nothingChanged(h, before)
  })
  it('11. draft identity — another draft (or a reopened lineage) under the approval → refused; no seal at all → refused', async () => {
    const h = host([L])
    const a = await emaDraft(h)
    const prop = await propose(h, save(a))
    const s = prop.seals[0]
    const before = snapshot(h)
    expect((await approve(h, prop, { seals: [{ ...s, draft: { ...s.draft, lineage: 'auth_000000000000' } }] })).failed[0].reason).toMatch(/^That proposal was for a different draft/)
    expect((await approve(h, prop, { seals: [] })).failed[0].reason).toMatch(/^I can’t check that approval any more/)
    nothingChanged(h, before)
  })
  it('12. zero writes on every refusal — even with a rename turn in the same request (the two-op form)', async () => {
    const h = host([L])
    const ref = await emaDraft(h)
    const ops = [{ action: 'indicator.draft', target: ref, args: { message: 'Name it Turned', chart: null, edit: null } }, ...save(ref)]
    const prop = await propose(h, ops)
    await run(h, [say(ref, 'also add an EMA 50')])
    const before = snapshot(h)
    const res = await approve(h, prop)
    expect(res.ok).toBe(false)
    nothingChanged(h, before)                                              // the turn never ran: no model call, no rename
    expect(drafts(h)[0].status.name).not.toBe('Turned')
  })
  it('13. after a refusal, asking again makes a NEW proposal that applies (a fresh seal, a fresh window)', async () => {
    const T = 1_800_000_000_000
    at(T)
    const h = host([L])
    const ref = await emaDraft(h)
    const stale = await propose(h, save(ref))
    at(T + PROPOSAL_TTL_MS + 1)
    expect((await approve(h, stale)).ok).toBe(false)
    const fresh = await propose(h, save(ref))
    expect(fresh.seals[0].issuedAt).toBe(T + PROPOSAL_TTL_MS + 1)
    expect((await approve(h, fresh)).ok).toBe(true)
    expect(stored).toHaveLength(1)
  })
  it('14. the card shows what is sealed — revision, name, charts, summary and warning — and an approved re-plan reads identically', async () => {
    const h = host([L, R])
    const ref = await pivotDraft(h)
    const prop = await propose(h, save(ref, { addTo: ['R'], name: 'Swing' }))
    const s = prop.seals[0]
    expect(s).toMatchObject({ action: 'indicator.saveDraft', ref, revision: 1, name: 'Swing', addTo: ['R'], target: { mode: 'create', defId: null, baseVersion: null } })
    expect(s.expiresAt - s.issuedAt).toBe(PROPOSAL_TTL_MS)
    expect(Object.isFrozen(s)).toBe(true)
    const card = prop.card[0]
    expect(card).toContain('(draft revision 1)')
    expect(card).toContain('as “Swing”')
    expect(card).toContain('then add it to Right chart (AAPL)')
    expect(card).toContain(`The builder's summary: ${s.linesShown.join(' / ')}`)
    expect(card).toContain(`You are also acknowledging: ${s.ackShown.join(' ')}`)
    const { p } = await plan(h, prop.ops, { approved: true, approval: prop.seals })
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(prop.card)                                     // what runs reads exactly as approved
  })
})

describe('⛔ F6 — validateSaveSeal (pure)', () => {
  const snap = (over = {}) => ({ ref: 'draft:k', draftRef: { key: 'k', lineage: 'l' }, status: { revision: 2, mode: 'create', defId: null, baseVersion: null, ackText: ['A'], lines: ['x'], name: 'N', ...over } })
  const seal = sealSave(snap(), { ops: [{ type: 'save', addTo: ['L'], name: null, pinRevision: 2, ackShown: ['A'], linesShown: ['x'], nameShown: 'N' }] }, 1000)
  const req = { name: null, turn: null, addTo: ['L'] }
  it('unchanged → null; each approval-critical field refuses on its own', () => {
    expect(validateSaveSeal(seal, snap(), req, 1000)).toBe(null)
    expect(validateSaveSeal(seal, snap(), req, 1000 + PROPOSAL_TTL_MS + 1)).toMatch(/expired/)
    expect(validateSaveSeal(seal, snap({ revision: 3 }), req, 1000)).toMatch(/revision 2 → 3/)
    expect(validateSaveSeal(seal, snap({ ackText: ['B'] }), req, 1000)).toMatch(/repainting warning/)
    expect(validateSaveSeal(seal, snap({ ackText: [] }), req, 1000)).toMatch(/repainting warning/)
    expect(validateSaveSeal(seal, snap({ mode: 'edit', defId: 'u_x', baseVersion: 1 }), req, 1000)).toMatch(/indicator it would save to/)
    expect(validateSaveSeal(seal, snap(), { ...req, addTo: [] }, 1000)).toMatch(/charts it would be added to/)
    expect(validateSaveSeal(seal, snap(), { ...req, addTo: ['ixe:L'] }, 1000)).toBe(null)          // the same chart, by its entry
    expect(validateSaveSeal(seal, snap(), { ...req, name: 'Other' }, 1000)).toMatch(/isn’t the save you approved/)
    expect(validateSaveSeal(seal, snap({ lines: ['y'] }), req, 1000)).toMatch(/summary changed/)
    expect(validateSaveSeal(null, snap(), req, 1000)).toMatch(/can’t check that approval/)
    expect(validateSaveSeal(seal, { ...snap(), draftRef: { key: 'k', lineage: 'other' } }, req, 1000)).toMatch(/different draft/)
  })
})

// ── the real panel: the expiry is enforced at Apply, the card is marked, nothing is written ──
let fetchCalls, envelopes
function mockFetch() {
  fetchCalls = []; envelopes = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    fetchCalls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: rows() })
    return json({ conversations: [] })
  })
}
const envOf = (disposition, ops) => ({ disposition, reply: '', question: null, ops, unsupported_category: null })

describe('⛔ F6 in the real panel', () => {
  it('a Save card applied after 10 minutes → "That proposal expired", the card says so, nothing saved; asking again works', async () => {
    mockFetch()
    localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
    const h = host([L])
    let T = 1_800_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => T)
    const ref = await emaDraft(h)
    render(<AuthContext.Provider value={{ user: { role: 'admin' }, cohorts: [] }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
    const box = screen.getByLabelText('Message UCT Agent')
    const send = (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
    const saveEnv = (b) => envOf('propose', [{ action: 'indicator.saveDraft', target: b.context.indicatorDrafts.find(e => e.active).ref, args: { addTo: [], name: 'Late Save' } }])
    envelopes.push(saveEnv)
    send('Save it as Late Save.')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(1))
    expect(ref).toBeTruthy()
    T += PROPOSAL_TTL_MS + 1000
    send('do it')
    await screen.findByText(/^That proposal expired \(a proposal is good for 10 minutes\), so nothing was changed/)
    expect(screen.getByText('Expired — ask again')).toBeTruthy()
    expect(stored).toEqual([])
    expect(drafts(h)[0].status.name).not.toBe('Late Save')
    // asked again → a new card → applies
    envelopes.push(saveEnv)
    send('Save it as Late Save.')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(2))
    send('do it')
    await waitFor(() => expect(stored).toHaveLength(1), { timeout: 4000 })
  })
})
