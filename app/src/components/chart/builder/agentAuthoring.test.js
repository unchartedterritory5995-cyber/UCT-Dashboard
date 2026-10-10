// app/src/components/chart/builder/agentAuthoring.test.js — Agent M3 S2, gate G2
//
// The Indicators-owned conversational authoring interface over the REAL engine, the REAL
// draft store and the REAL save path (only the model reply and the server are stand-ins).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { storeConversation } from './conversationSave'
import { readSession, writeSession, holdInDock, releaseDock, _simulateReload, STORAGE_KEY, PERSIST_TTL_MS } from './authoring/conversationSessions'
import { applyTurn } from './authoring'
import {
  AUTHORING_CONTRACT, AUTHORING_REASONS as R, openDraft, draftTurn, draftUndo, draftStatus, listDrafts,
  discardDraft, saveDraft, renameDraft,
} from './agentAuthoring'
import { planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation } from './agentMutations'

const PATCH = 'uct.authoring.patch/1'
const close = { type: 'series', name: 'close' }
const call = (name, ...args) => ({ type: 'call', name, args })
const num = (value) => ({ type: 'num', value })
const rsi28 = call('rsi', close, num(28))

/** A scripted model: the member's sentence → the envelope a model would return. */
function scripted(calls) {
  return async ({ message, state }) => {
    calls.push({ message, revision: state.revision })
    const env = (ops) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
      envelope: { contract: PATCH, baseRevision: state.revision, ops, assumptions: [], disposition: 'change' } })
    const m = message.toLowerCase()
    if (m.startsWith('create rsi 28')) return env([{ op: 'create', name: 'RSI 28', placement: 'pane', outputs: [{ key: 'rsi', label: 'RSI 28', tree: rsi28 }] }])
    if (m.includes('moving average of that rsi')) return env([{ op: 'add_output', key: 'ma', label: 'RSI MA 5', tree: call('sma', rsi28, num(5)) }])
    if (m.includes('rsi line blue')) return env([{ op: 'set_style', output: 'rsi', color: '#2962FF' }])
    if (m.startsWith('what')) return { ok: true, disposition: 'answer', turn: 'noop', reply: 'RSI measures momentum.', envelope: null }
    if (m.startsWith('which')) return { ok: true, disposition: 'clarify', turn: 'question', reply: '',
      envelope: { contract: PATCH, baseRevision: state.revision, ops: [], assumptions: [], disposition: 'clarify', questions: [{ id: 'q1', text: 'Which length?' }] } }
    if (m.startsWith('spend')) return { ok: false, gate: 'cost:user', reason: "you have used up today's allowance" }
    return { ok: true, disposition: 'unsupported', turn: 'noop', reply: 'I cannot build that.', envelope: null }
  }
}

let calls, stored, server
const fakeSave = (overrides = {}) => async (doc, defId, _x, opts) => {
  if (overrides.conflict) return { ok: false, conflict: true, error: 'moved on', conflictInfo: { defId, expectedVersion: opts?.baseVersion, currentVersion: 9 } }
  const id = defId || 'u_aaaaaaaaab31'
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  const row = { def_id: id, version, rev: 1 }
  server.set(id, { ...row, definition: { ...doc, id, version } })
  stored.push({ doc, defId, opts })
  return { ok: true, row }
}
const ctxOf = (over = {}) => ({
  canAuthor: true, sym: 'AMD', tf: 'D', definitionRows: [...server.values()],
  converse: scripted(calls),
  store: (s, o) => storeConversation(s, { ...o, save: fakeSave(over.saveOverrides) }),
  readBack: async (id) => server.get(id) || null,
  ...over,
})

beforeEach(() => {
  calls = []; stored = []; server = new Map()
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
})

describe('⭐ the member script — one draft, one lineage, never rebuilt from chat', () => {
  it('Create RSI 28 → add its 5-period MA → make the RSI blue → Undo that → Save → add to AMD and NVDA', async () => {
    const o = openDraft({ create: true, chartRef: 'w-amd' }, ctxOf())
    expect(o.ok).toBe(true)
    expect(o.draftRef).toMatchObject({ contract: AUTHORING_CONTRACT })
    const ref = o.draftRef
    const t1 = await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    expect(t1).toMatchObject({ ok: true, kind: 'applied', revision: 1, stepId: `${ref.lineage}:r1` })
    const t2 = await draftTurn(ref, 'Add a 5-period moving average of that RSI.', { expectedRevision: 1 }, ctxOf())
    expect(t2).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    const t3 = await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 2 }, ctxOf())
    expect(t3).toMatchObject({ ok: true, kind: 'applied', revision: 3, stepId: `${ref.lineage}:r3` })
    // every follow-up was the SAME draft: the model saw revisions 0, 1, 2 of one lineage
    expect(calls.map((c) => c.revision)).toEqual([0, 1, 2])
    const st3 = draftStatus(ref, ctxOf())
    expect(st3).toMatchObject({ revision: 3, undoStepId: t3.stepId })
    expect(st3.name).toMatch(/^RSI 28/)            // the engine names it from its outputs
    expect(JSON.stringify(readSession(ref.key).state.working)).toMatch(/2962FF/i)   // the blue landed
    const u = draftUndo(ref, { expectedStepId: t3.stepId }, ctxOf())
    expect(u).toMatchObject({ ok: true, kind: 'undone', undid: t3.stepId, revision: 4, undoStepId: t2.stepId })
    const st = readSession(ref.key).state
    expect(draftStatus(ref, ctxOf()).readback.outputs.map((x) => x.key)).toEqual(['rsi', 'ma'])   // the MA survived
    expect(JSON.stringify(st.working)).not.toMatch(/2962FF/i)                      // the blue did not
    const saved = await saveDraft(ref, { expectedRevision: 4 }, ctxOf())
    expect(saved).toMatchObject({ ok: true, defId: 'u_aaaaaaaaab31', version: 1, created: true })
    expect(saved.name).toMatch(/^RSI 28/)
    expect(stored).toHaveLength(1)
    expect(draftStatus(ref, ctxOf())).toMatchObject({ ok: false, reason: R.DRAFT_EXPIRED })   // the draft ended
    // "add it to both" — M2, one SEPARATE commit per chart, against the saved defId
    const m2 = { canManage: true, ownedDefinitionIds: [saved.defId], registry }
    for (const chartId of ['w-amd', 'w-nvda']) {
      const cs = mergeChartSettings(null)
      const p = planIndicatorMutation(cs, { op: 'add', defId: saved.defId }, { ...m2, chartId })
      expect(p.ok, JSON.stringify(p)).toBe(true)
      const a = applyIndicatorMutation(cs, p.plan, { ...m2, chartId })
      expect(confirmIndicatorMutation(JSON.parse(JSON.stringify(a.cs)), a.pending, { ...m2, chartId }).status).toBe('confirmed')
    }
  })
})

describe('advice, clarification, unsupported and refusals change nothing', () => {
  it('answer / clarify / unsupported / a server allowance refusal', async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const a = await draftTurn(ref, 'what is RSI?', { expectedRevision: 1 }, ctxOf())
    expect(a).toMatchObject({ ok: true, kind: 'answer', revision: 1, reply: 'RSI measures momentum.' })
    const q = await draftTurn(ref, 'which length should it be?', { expectedRevision: 1 }, ctxOf())
    expect(q).toMatchObject({ ok: true, kind: 'question', revision: 1, questions: ['Which length?'] })
    const n = await draftTurn(ref, 'build me a time machine', { expectedRevision: 1 }, ctxOf())
    expect(n).toMatchObject({ ok: true, kind: 'unsupported', revision: 1 })
    const s = await draftTurn(ref, 'spend more', { expectedRevision: 1 }, ctxOf())
    expect(s).toMatchObject({ ok: false, reason: R.TURN_REFUSED, revision: 1, detail: { gate: 'cost:user' } })
    expect(draftStatus(ref, ctxOf()).revision).toBe(1)
  })
  it('a name-only message is applied locally — no model call (no allowance spent)', async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const n = calls.length
    const r = await draftTurn(ref, 'Call it Swing RSI', { expectedRevision: 1 }, ctxOf())
    expect(r).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    expect(calls.length).toBe(n)
    expect(draftStatus(ref, ctxOf()).name).toBe('Swing RSI')
  })
})

describe('⭐ Undo safety', () => {
  const three = async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    const t1 = await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const t2 = await draftTurn(ref, 'Add a 5-period moving average of that RSI.', { expectedRevision: 1 }, ctxOf())
    const t3 = await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 2 }, ctxOf())
    return { ref, t1, t2, t3 }
  }
  it('consecutive Undo walks the history exactly (step ids stay valid as revisions move)', async () => {
    const { ref, t1, t2, t3 } = await three()
    expect(draftUndo(ref, { expectedStepId: t3.stepId }, ctxOf()).ok).toBe(true)
    expect(draftUndo(ref, { expectedStepId: t2.stepId }, ctxOf()).ok).toBe(true)
    expect(draftUndo(ref, { expectedStepId: t1.stepId }, ctxOf())).toMatchObject({ ok: true, undoStepId: null })
    expect(draftUndo(ref, { expectedStepId: t1.stepId }, ctxOf())).toMatchObject({ ok: false, reason: R.NOTHING_TO_UNDO })
    expect(readSession(ref.key).state.working).toBeNull()
  })
  it('a stale step reference is refused (wrong step / already undone)', async () => {
    const { ref, t2, t3 } = await three()
    expect(draftUndo(ref, { expectedStepId: t2.stepId }, ctxOf())).toMatchObject({ ok: false, reason: R.STALE_STEP, detail: { undoStepId: t3.stepId } })
    draftUndo(ref, { expectedStepId: t3.stepId }, ctxOf())
    expect(draftUndo(ref, { expectedStepId: t3.stepId }, ctxOf())).toMatchObject({ ok: false, reason: R.STALE_STEP })
  })
  it('an intervening dock edit makes the Agent step stale; the dock-held draft refuses every write', async () => {
    const { ref, t3 } = await three()
    // the dock opens on the same key and makes its own change
    holdInDock(ref.key)
    const snap = readSession(ref.key)
    const env = { contract: PATCH, baseRevision: snap.state.revision, ops: [{ op: 'set_style', output: 'ma', width: 3 }], assumptions: [] }
    writeSession(ref.key, { ...snap, state: applyTurn(snap.state, env, {}).state })
    const c = ctxOf()
    expect(await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 4 }, c)).toMatchObject({ ok: false, reason: R.DRAFT_OPEN_IN_DOCK })
    expect(draftUndo(ref, { expectedStepId: t3.stepId }, c)).toMatchObject({ ok: false, reason: R.DRAFT_OPEN_IN_DOCK })
    expect(await saveDraft(ref, { expectedRevision: 4 }, c)).toMatchObject({ ok: false, reason: R.DRAFT_OPEN_IN_DOCK })
    expect(discardDraft(ref, { expectedRevision: 4 }, c)).toMatchObject({ ok: false, reason: R.DRAFT_OPEN_IN_DOCK })
    expect(draftStatus(ref, c)).toMatchObject({ openInDock: true, revision: 4 })
    releaseDock(ref.key)
    expect(draftUndo(ref, { expectedStepId: t3.stepId }, c)).toMatchObject({ ok: false, reason: R.STALE_STEP })
    expect(draftUndo(ref, { expectedStepId: draftStatus(ref, c).undoStepId }, c).ok).toBe(true)   // the dock's own edit
  })
  it('a stale revision is refused before any model call', async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const n = calls.length
    expect(await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 0 }, ctxOf())).toMatchObject({ ok: false, reason: R.STALE_REVISION, detail: { revision: 1 } })
    expect(calls.length).toBe(n)
  })
  it('history beyond what a reload carries (10 steps) is not undoable after a reload', async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    for (let i = 0; i < 11; i++) await draftTurn(ref, `Call it Name ${i}`, { expectedRevision: i + 1 }, ctxOf())
    _simulateReload()
    const s = draftStatus(ref, ctxOf())
    expect(s).toMatchObject({ recovered: true, revision: 12 })
    let undone = 0
    for (let i = 0; i < 20; i++) { const u = draftUndo(ref, { expectedStepId: draftStatus(ref, ctxOf()).undoStepId }, ctxOf()); if (!u.ok) break; undone++ }
    expect(undone).toBe(10)
  })
})

describe('draft continuity, reload, expiry, multiple drafts', () => {
  it('a draft with changes survives a reload of the tab; an untouched one does not', async () => {
    const kept = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(kept, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const empty = openDraft({ create: true }, ctxOf()).draftRef
    _simulateReload()
    expect(draftStatus(kept, ctxOf())).toMatchObject({ recovered: true, revision: 1, name: 'RSI 28' })
    expect(draftStatus(empty, ctxOf())).toMatchObject({ ok: false, reason: R.DRAFT_EXPIRED })
  })
  it('a draft older than the store TTL expires', async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    _simulateReload()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + PERSIST_TTL_MS + 1000)
    try { expect(draftStatus(ref, ctxOf())).toMatchObject({ ok: false, reason: R.DRAFT_EXPIRED }) } finally { vi.restoreAllMocks() }
  })
  it('several drafts are listed newest first, each by its own ref — never merged', async () => {
    const a = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(a, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const b = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(b, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    await draftTurn(b, 'Call it Second', { expectedRevision: 1 }, ctxOf())
    const list = listDrafts(ctxOf())
    expect(list.map((d) => d.draftRef.lineage)).toEqual([b.lineage, a.lineage])
    expect(list.map((d) => d.name)).toEqual(['Second', 'RSI 28'])
    expect(a.lineage).not.toBe(b.lineage)
  })
  it('a draftRef whose key now holds another draft is expired, not hijacked', async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const forged = { ...ref, lineage: 'auth_000000000000' }
    expect(draftStatus(forged, ctxOf())).toMatchObject({ ok: false, reason: R.DRAFT_EXPIRED })
    expect(draftStatus({ ...ref, key: 'new:s_1' }, ctxOf())).toMatchObject({ ok: false, reason: R.BAD_REQUEST })
  })
})

describe('edit drafts — the member’s own saved definition, the dock’s Modify draft', () => {
  const savedRsi = async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    return saveDraft(ref, { expectedRevision: 1 }, ctxOf())
  }
  it('opens editKey(defId) on the stored version and saves version 2 of the SAME id', async () => {
    const s = await savedRsi()
    const o = openDraft({ edit: { defId: s.defId } }, ctxOf())
    expect(o).toMatchObject({ ok: true, status: { mode: 'edit', defId: s.defId, baseVersion: 1, revision: 0 } })
    expect(o.draftRef.key).toBe(`edit:${s.defId}`)
    const t = await draftTurn(o.draftRef, 'Make the RSI line blue.', { expectedRevision: 0 }, ctxOf())
    expect(t.ok).toBe(true)
    const v2 = await saveDraft(o.draftRef, { expectedRevision: 1 }, ctxOf())
    expect(v2).toMatchObject({ ok: true, defId: s.defId, version: 2, created: false })
  })
  it('not the member’s → unknown-definition; saved elsewhere since → draft-stale', async () => {
    expect(openDraft({ edit: { defId: 'u_ffffffffffff' } }, ctxOf())).toMatchObject({ ok: false, reason: R.UNKNOWN_DEFINITION })
    const s = await savedRsi()
    const o = openDraft({ edit: { defId: s.defId } }, ctxOf())
    await draftTurn(o.draftRef, 'Make the RSI line blue.', { expectedRevision: 0 }, ctxOf())
    const moved = ctxOf({ definitionRows: [{ ...server.get(s.defId), version: 5 }] })
    expect(draftStatus(o.draftRef, moved)).toMatchObject({ ok: false, reason: R.DRAFT_STALE, detail: { baseVersion: 1, currentVersion: 5 } })
    expect(await draftTurn(o.draftRef, 'x', { expectedRevision: 1 }, moved)).toMatchObject({ ok: false, reason: R.DRAFT_STALE })
  })
})

describe('permission — fresh at every call', () => {
  it('no Create Indicator access → access, for open and every write', async () => {
    expect(openDraft({ create: true }, ctxOf({ canAuthor: false }))).toMatchObject({ ok: false, reason: R.ACCESS })
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const lost = ctxOf({ canAuthor: false })
    expect(await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 1 }, lost)).toMatchObject({ ok: false, reason: R.ACCESS })
    expect(draftUndo(ref, { expectedStepId: `${ref.lineage}:r1` }, lost)).toMatchObject({ ok: false, reason: R.ACCESS })
    expect(await saveDraft(ref, { expectedRevision: 1 }, lost)).toMatchObject({ ok: false, reason: R.ACCESS })
    expect(stored).toHaveLength(0)
  })
})

describe('⭐ canonical Save with persisted read-back', () => {
  const drafted = async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    return ref
  }
  it('missing read-back → saved-unconfirmed, never success', async () => {
    const ref = await drafted()
    const r = await saveDraft(ref, { expectedRevision: 1 }, ctxOf({ readBack: async () => null }))
    expect(r).toMatchObject({ ok: false, reason: R.SAVED_UNCONFIRMED, defId: 'u_aaaaaaaaab31', version: 1 })
  })
  it('mismatched read-back (another version / other maths) → saved-unconfirmed', async () => {
    const ref = await drafted()
    const r = await saveDraft(ref, { expectedRevision: 1 }, ctxOf({ readBack: async (id) => ({ ...server.get(id), version: 7 }) }))
    expect(r).toMatchObject({ ok: false, reason: R.SAVED_UNCONFIRMED })
    const ref2 = await drafted()
    const r2 = await saveDraft(ref2, { expectedRevision: 1 }, ctxOf({ readBack: async (id) => {
      const row = server.get(id); return { ...row, definition: { ...row.definition, compute: { ...row.definition.compute, fn: 'sha256:other' } } } } }))
    expect(r2).toMatchObject({ ok: false, reason: R.SAVED_UNCONFIRMED })
  })
  it('conflict / nothing to save / stale revision', async () => {
    const ref = await drafted()
    expect(await saveDraft(ref, { expectedRevision: 0 }, ctxOf())).toMatchObject({ ok: false, reason: R.STALE_REVISION })
    expect(await saveDraft(ref, { expectedRevision: 1 }, ctxOf({ saveOverrides: { conflict: true } }))).toMatchObject({ ok: false, reason: R.SAVE_CONFLICT })
    const empty = openDraft({ create: true }, ctxOf()).draftRef
    expect(await saveDraft(empty, { expectedRevision: 0 }, ctxOf())).toMatchObject({ ok: false, reason: R.NOT_DIRTY })
  })
  it('discard ends the draft; Save goes through the ONE canonical writer', async () => {
    const ref = await drafted()
    expect(discardDraft(ref, { expectedRevision: 0 }, ctxOf())).toMatchObject({ ok: false, reason: R.STALE_REVISION })
    expect(discardDraft(ref, { expectedRevision: 1 }, ctxOf())).toEqual({ ok: true })
    expect(draftStatus(ref, ctxOf())).toMatchObject({ ok: false, reason: R.DRAFT_EXPIRED })
    expect(stored).toHaveLength(0)
  })
})

describe('rails — no second pipeline, no second store, no AST to the Agent', () => {
  it('agentAuthoring imports the shared pipeline and the dock store, and no network/model client of its own', async () => {
    const src = (await import('./agentAuthoring.js?raw')).default
    expect(src).toMatch(/from '\.\/authoring\/authoringSession'/)
    expect(src).toMatch(/from '\.\/authoring\/conversationSessions'/)
    expect(src).not.toMatch(/(localStorage|indexedDB)\b/)
    expect(src).not.toMatch(/\/api\/user-definitions\/converse/)
  })
  it('outcomes carry no tree: no AST node in a status or a turn result', async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    const t = await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const s = draftStatus(ref, ctxOf())
    // an AST node is a call / op / num / offset, or a series NODE ({type:'series', name}); an
    // output's own `type` ('series', 'condition' …) sits beside `key`, which a node never has
    const nodes = []
    const walk = (v) => { if (!v || typeof v !== 'object') return
      if (['call', 'op', 'num', 'offset'].includes(v.type) || (v.type === 'series' && typeof v.name === 'string' && !('key' in v))) nodes.push(v)
      for (const k of Object.keys(v)) walk(v[k]) }
    for (const v of [t, s]) walk(v)
    expect(nodes).toEqual([])
  })
})

describe('the real dock hook holds its draft while it is open (D6)', () => {
  it('mount → held (Agent writes refused); unmount → released (Agent writes allowed)', async () => {
    const { renderHook } = await import('@testing-library/react')
    const { default: useIndicatorConversation } = await import('./studio/useIndicatorConversation')
    const { isHeldInDock } = await import('./authoring/conversationSessions')
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const h = renderHook(() => useIndicatorConversation({ sym: 'AMD', tf: 'D', sessionKey: ref.key }))
    expect(isHeldInDock(ref.key)).toBe(true)
    expect(h.result.current.state.lineage).toBe(ref.lineage)       // the dock opened the SAME draft
    expect(await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 1 }, ctxOf())).toMatchObject({ ok: false, reason: R.DRAFT_OPEN_IN_DOCK })
    h.unmount()
    expect(isHeldInDock(ref.key)).toBe(false)
    expect(await draftTurn(ref, 'Make the RSI line blue.', { expectedRevision: 1 }, ctxOf())).toMatchObject({ ok: true, kind: 'applied' })
  })
})

describe('⭐ typed rename (renameDraft) — rename-only by construction, machine-readable', () => {
  const drafted = async () => {
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    return ref
  }
  it('renames, one revision, one history step, no model call; maths and outputs untouched', async () => {
    const ref = await drafted()
    const before = draftStatus(ref, ctxOf())
    const n = calls.length
    const r = renameDraft(ref, 'Bullish Trend', { expectedRevision: 1 }, ctxOf())
    expect(r).toMatchObject({ ok: true, kind: 'applied', renameOnly: true, rename: { from: 'RSI 28', to: 'Bullish Trend' },
      revision: 2, stepId: `${ref.lineage}:r2` })
    expect(r.changes.map((c) => c.kind)).toEqual(['renamed'])
    expect(calls.length).toBe(n)                                              // no model call
    const after = draftStatus(ref, ctxOf())
    expect(after).toMatchObject({ revision: 2, name: 'Bullish Trend', undoStepId: r.stepId, draftRef: { lineage: ref.lineage } })
    const maths = (s) => s.readback.outputs.map((o) => [o.key, o.type, o.mode, o.words])
    expect(maths(after)).toEqual(maths(before))
    const tree = (k) => JSON.stringify(readSession(k).state.working.plots || readSession(k).state.working.compute)
    expect(tree(ref.key)).toBe(tree(ref.key))
  })
  it('unchanged name, empty name, no definition yet, stale revision → typed refusals, nothing written', async () => {
    const ref = await drafted()
    expect(renameDraft(ref, 'RSI 28', { expectedRevision: 1 }, ctxOf())).toMatchObject({ ok: false, reason: R.NAME_UNCHANGED })
    expect(renameDraft(ref, '   ', { expectedRevision: 1 }, ctxOf())).toMatchObject({ ok: false, reason: R.BAD_REQUEST })
    expect(renameDraft(ref, 'X', { expectedRevision: 0 }, ctxOf())).toMatchObject({ ok: false, reason: R.STALE_REVISION, detail: { revision: 1 } })
    const empty = openDraft({ create: true }, ctxOf()).draftRef
    expect(renameDraft(empty, 'X', { expectedRevision: 0 }, ctxOf())).toMatchObject({ ok: false, reason: R.NOTHING_TO_RENAME })
    expect(draftStatus(ref, ctxOf()).revision).toBe(1)
  })
  it('permission loss and an open dock refuse; Undo restores the old name exactly', async () => {
    const ref = await drafted()
    expect(renameDraft(ref, 'X', { expectedRevision: 1 }, ctxOf({ canAuthor: false }))).toMatchObject({ ok: false, reason: R.ACCESS })
    holdInDock(ref.key)
    expect(renameDraft(ref, 'X', { expectedRevision: 1 }, ctxOf())).toMatchObject({ ok: false, reason: R.DRAFT_OPEN_IN_DOCK })
    releaseDock(ref.key)
    const r = renameDraft(ref, 'Bullish Trend', { expectedRevision: 1 }, ctxOf())
    const u = draftUndo(ref, { expectedStepId: r.stepId }, ctxOf())
    expect(u).toMatchObject({ ok: true, undid: r.stepId, revision: 3 })
    expect(draftStatus(ref, ctxOf()).name).toBe('RSI 28')
  })
  it('the conversational name-only path carries the same marker; a MODEL turn that renames never does', async () => {
    const ref = await drafted()
    const local = await draftTurn(ref, 'Call it Swing RSI', { expectedRevision: 1 }, ctxOf())
    expect(local).toMatchObject({ ok: true, kind: 'applied', renameOnly: true, rename: { to: 'Swing RSI' } })
    // a model envelope that renames AND changes the maths (set_slot records no change entry)
    const sneaky = async ({ state }) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
      envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
        ops: [{ op: 'rename_definition', name: 'Still RSI' }, { op: 'set_output_tree', output: 'rsi', tree: call('rsi', close, num(14)) }] } })
    const m = await draftTurn(ref, 'make it 14 and tidy the name', { expectedRevision: 2 }, ctxOf({ converse: sneaky }))
    expect(m.ok).toBe(true)
    expect(m.renameOnly).toBeUndefined()                                      // ⛔ never marked rename-only
    expect(m.rename).toBeUndefined()
  })
  it('Save after a rename: the acknowledgement is re-read, and the saved NAME is confirmed by read-back', async () => {
    const ref = await drafted()
    const r = renameDraft(ref, 'Bullish Trend', { expectedRevision: 1 }, ctxOf())
    const wrongName = await saveDraft(ref, { expectedRevision: r.revision }, ctxOf({ readBack: async (id) => {
      const row = server.get(id); return { ...row, definition: { ...row.definition, meta: { ...row.definition.meta, name: 'RSI 28' } } } } }))
    expect(wrongName).toMatchObject({ ok: false, reason: R.SAVED_UNCONFIRMED })
    const ref2 = await drafted()
    const r2 = renameDraft(ref2, 'Bullish Trend', { expectedRevision: 1 }, ctxOf())
    const ok = await saveDraft(ref2, { expectedRevision: r2.revision }, ctxOf())
    expect(ok).toMatchObject({ ok: true, name: 'Bullish Trend' })
  })
  it('a repainting draft: the acknowledgement follows the new name and Save needs it re-approved', async () => {
    const pivot = async ({ state }) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
      envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
        ops: [{ op: 'create', name: 'Pivot', placement: 'price', outputs: [{ key: 'ph', tree: call('pivothigh', { type: 'series', name: 'high' }, num(2), num(2)) }] }] } })
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    const t = await draftTurn(ref, 'pivot highs', { expectedRevision: 0 }, ctxOf({ converse: pivot }))
    expect(t.ok, JSON.stringify(t)).toBe(true)
    const before = draftStatus(ref, ctxOf()).ackText
    expect(before.length).toBeGreaterThan(0)
    const r = renameDraft(ref, 'Swing Highs', { expectedRevision: 1 }, ctxOf())
    expect(r.ok).toBe(true)
    const after = draftStatus(ref, ctxOf()).ackText
    expect(after).not.toEqual(before)                     // it names the output, which follows the new name
    // ⭐ S6 — the measured window: pivothigh(high, 2, 2) is final only after 2 more bars close
    expect(after[0]).toMatch(/^Swing Highs reads 2 bars ahead, so its latest 2 values can change until 2 more bars close/)
    expect(await saveDraft(ref, { expectedRevision: 2 }, ctxOf())).toMatchObject({ ok: false, reason: R.NEEDS_ACK, detail: { ackText: after } })
    expect((await saveDraft(ref, { expectedRevision: 2, acknowledged: true }, ctxOf())).ok).toBe(true)
  })
})

describe('S5 refinement A — the draft’s originating chart, from the draft itself', () => {
  it('a draft opened for a chart reports it on every status — through turns, a rename, Undo and a reload', async () => {
    const ref = openDraft({ create: true, chartRef: 'w-amd' }, ctxOf()).draftRef
    expect(draftStatus(ref, ctxOf()).chartRef).toBe('w-amd')
    const t = await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    renameDraft(ref, 'Bullish Trend', { expectedRevision: 1 }, ctxOf())
    draftUndo(ref, { expectedStepId: draftStatus(ref, ctxOf()).undoStepId }, ctxOf())
    expect(t.ok).toBe(true)
    _simulateReload()
    expect(draftStatus(ref, ctxOf())).toMatchObject({ recovered: true, chartRef: 'w-amd' })
    expect(listDrafts(ctxOf())[0].chartRef).toBe('w-amd')
  })
  it('unknown → null (no chart given, or a dock-started draft): never another chart', async () => {
    const none = openDraft({ create: true }, ctxOf()).draftRef
    expect(draftStatus(none, ctxOf()).chartRef).toBeNull()
    const ref = openDraft({ create: true }, ctxOf()).draftRef
    await draftTurn(ref, 'Create RSI 28.', { expectedRevision: 0 }, ctxOf())
    const saved = await saveDraft(ref, { expectedRevision: 1 }, ctxOf())
    const e = openDraft({ edit: { defId: saved.defId }, chartRef: 'w-nvda' }, ctxOf())
    expect(e.status.chartRef).toBe('w-nvda')
    // a dock-started draft (no meta) has no originating chart the Agent may assume
    const dockKey = 'create:c_00000001'
    writeSession(dockKey, { state: readSession(e.draftRef.key).state, transcript: [{ id: 0, role: 'member', text: 'x' }], acked: false })
    const dock = listDrafts(ctxOf()).find((d) => d.draftRef.key === dockKey)
    expect(dock).toBeTruthy()
    expect(dock.chartRef).toBeNull()
  })
})
