// INDICATORS M3 (S4) — Agent acceptance for conversational authoring (contract
// docs/indicators/AGENT-M3-CONTRACT.md §15/§16). The REAL Indicators authoring interface
// (`agentAuthoring.js`), the REAL engine, draft store and canonical Save, the REAL M2 mutation
// interface for the chart adds — driven through the Agent's own planner + runtime + Undo. Only
// the model reply (/converse) and the definitions server are stand-ins.
import { describe, it, expect, beforeEach } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability, getTargetKind } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { selectGroups } from './routing'
import { protectionRefusal } from './protectedLayouts'
import { fastParse } from './fastPath'
import { setOwnedDefinitionSource, _resetProposedPlans } from './capabilities/indicatorEdits'
import { setAuthoringSources, _resetAuthoring, indicatorDraftsKind, draftAmbiguity, selectDraft } from './capabilities/indicatorAuthoring'
import * as registry from '../components/chart/engine/nativeRegistry'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { parseFormula } from '../components/chart/engine/ast/parse'
import { storeConversation } from '../components/chart/builder/conversationSave'
import { _simulateReload, STORAGE_KEY, holdInDock, releaseDock } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview, AUTHORING_REASONS as AR, saveDraft, draftStatus, discardDraft } from '../components/chart/builder/agentAuthoring'

registerBuiltins()

const PATCH = 'uct.authoring.patch/1'
const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const TREND = 'ema(close, 9) > ema(close, 20)'
const TREND_RSI = 'ema(close, 9) > ema(close, 20) && rsi(close, 14) > 50'

/** The model, scripted: the member's sentence → the envelope a model would return. */
let calls
function converse({ message, state, gateCtx }) {
  calls.push({ message, revision: state.revision, symbol: gateCtx?.symbol || null })
  const env = (ops) => ({ ok: true, disposition: 'change', turn: 'patch', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, ops, assumptions: [], disposition: 'change' } })
  const m = message.toLowerCase()
  if (m.startsWith('build me an indicator that highlights candles')) {
    return env([
      { op: 'create', name: 'EMA trend candles', placement: 'price', outputs: [{ key: 'fast', label: 'EMA 9', tree: P('ema(close, 9)') }, { key: 'slow', label: 'EMA 20', tree: P('ema(close, 20)') }] },
      { op: 'set_color_states', channel: 'barcolor', states: [{ when: P(TREND), color: '#00c853' }], otherwise: '#787b86' },
    ])
  }
  if (m.includes('recommend')) return { ok: true, disposition: 'answer', turn: 'noop', reply: 'You could add an RSI filter so only candles with momentum are highlighted.', envelope: null }
  if (m.includes('require rsi to be above 50')) {
    return env([{ op: 'set_color_states', channel: 'barcolor', states: [{ when: P(TREND_RSI), color: '#00c853' }], otherwise: '#787b86' }])
  }
  if (m.startsWith('mark pivot highs')) {
    return env([{ op: 'create', name: 'Pivot highs', placement: 'price', outputs: [{ key: 'ph', label: 'Pivot high', tree: P('pivothigh(high, 2, 2)') }] }])
  }
  if (m.startsWith('also mark pivot highs')) return env([{ op: 'add_output', key: 'ph', label: 'Pivot high', tree: P('pivothigh(high, 2, 2)') }])
  if (m.startsWith('which')) return { ok: true, disposition: 'clarify', turn: 'question', reply: '',
    envelope: { contract: PATCH, baseRevision: state.revision, ops: [], assumptions: [], disposition: 'clarify', questions: [{ id: 'q1', text: 'Which EMA lengths?' }] } }
  if (m.startsWith('spend')) return { ok: false, gate: 'cost:user', reason: "you have used up today's allowance" }
  if (m.includes('make the slow line 50')) {
    return env([{ op: 'add_output', key: 'slow50', label: 'EMA 50', tree: P('ema(close, 50)') }])
  }
  return { ok: true, disposition: 'unsupported', turn: 'noop', reply: 'I cannot build that.', envelope: null }
}

// ── the definitions server (the store + the read-back) ──
let server, stored, saveMode
const fakeSave = async (doc, defId, _x, opts) => {
  if (saveMode === 'conflict') return { ok: false, conflict: true, error: 'moved on', conflictInfo: { defId, expectedVersion: opts?.baseVersion, currentVersion: 9 } }
  const id = defId || `u_aaaaaaaaac${String(server.size + 10).padStart(2, '0')}`
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  server.set(id, { def_id: id, version, rev: 1, definition: { ...doc, id, version } })
  stored.push({ doc, defId, opts })
  return { ok: true, row: { def_id: id, version, rev: 1 } }
}
let access
const rows = () => [...server.values()]
const OWNED = () => rows().map(r => r.def_id)

beforeEach(() => {
  calls = []; server = new Map(); stored = []; saveMode = 'ok'; access = true
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans()
  setOwnedDefinitionSource(() => OWNED())
  setAuthoringSources({
    access: () => access, rows,
    extra: {
      converse, readBack: async (id) => (saveMode === 'lost' ? null : server.get(id) || null),
      store: (s, o) => storeConversation(s, { ...o, save: fakeSave }),
    },
  })
})

/** Charts with M2's persist path and the two M3 preview handles. */
function host(specs, { persist = () => ({ ok: true }) } = {}) {
  const store = Object.fromEntries(specs.map(s => [s.ref, JSON.parse(JSON.stringify(s.cs || mergeChartSettings(null)))]))
  const previews = []
  const h = {
    store, previews, access: {}, readonly: {},
    charts: {
      list: () => specs.map(s => ({ ref: s.ref, label: s.label, position: s.position, symbol: s.symbol, tf: 'D', cs: mergeChartSettings(JSON.stringify(store[s.ref])), stored: store[s.ref] })),
      read: (ref) => h.charts.list().find(c => c.ref === ref) || null,
      commit: (ref, patch) => { store[ref] = JSON.parse(JSON.stringify(patch.settings)); return true },
      canManageIndicators: (ref) => h.access[ref] !== false,
      canCreateIndicator: () => true,
      openCreateIndicator: () => ({ ok: true }),
      previewHost: (ref) => (specs.some(s => s.ref === ref) ? {
        showAuthoringPreview: (def, o) => {
          if (h.readonly[ref]) return { ok: false, reason: 'readonly' }
          const from = previews.length ? previews[previews.length - 1].ref : null
          previews.push({ ref, def, o })
          return { ok: true, movedFrom: from && from !== ref ? from : null }
        },
        clearAuthoringPreview: () => { h.cleared = (h.cleared || 0) + 1; return true },
      } : null),
    },
    persist: async () => persist(),
  }
  return h
}
const L = { ref: 'L', label: 'Left chart (NVDA)', position: 'left', symbol: 'NVDA' }
const R = { ref: 'R', label: 'Right chart (AAPL)', position: 'right', symbol: 'AAPL' }
const CTX = { surface: 'charts', createIndicator: true }
const NEW = 'draft:new'

async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return planOps(collectTargets(h, ['indicatorDrafts', 'indicatorEdits', 'indicators', 'chart']), ops, env, CTX)
}
async function run(h, ops) {
  const p = await plan(h, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return { p, res: await commitPlan(h, p, { env: {}, ctx: CTX }) }
}
// ⛔ F6 — exactly what useAgent does: the card's SEAL is kept with the proposal, and Apply plans FROM
// it (env.approved + env.approval). An Apply never re-reads the draft as if it were a new proposal.
const KINDS = ['indicatorDrafts', 'indicatorEdits', 'indicators', 'chart']
async function propose(h, ops) {
  const p = await plan(h, ops)
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return { ops, plan: p, card: p.lines, seals: p.plans.map(x => getTargetKind(x.kind)?.seal?.(x)).filter(Boolean) }
}
async function approve(h, prop) {
  buildContext(h, CTX)
  const env = { ...(await prepareOps(prop.ops)), approved: true, approval: prop.seals }
  const p = planOps(collectTargets(h, KINDS), prop.ops, env, CTX)
  if (!p.ok) return { ok: false, refusedAtPlan: true, lines: [], failed: p.refusals.map(r => ({ reason: r.reason })) }
  return commitPlan(h, p, { env, ctx: CTX })
}
const drafts = (h) => indicatorDraftsKind.list(h).filter(s => !s.new)
const activeRef = (h) => drafts(h).find(s => s.active)?.ref
const say = (target, message, { chart = null, edit = null } = {}) => ({ action: 'indicator.draft', target, args: { message, chart, edit } })
const instancesOn = (h, ref) => (mergeChartSettings(JSON.stringify(h.store[ref])).indicatorInstances || []).filter(i => !i.deleted)

// ── 1. the six-line conversation ─────────────────────────────────────────────────────
describe('⭐ the six-line conversation — one draft, one lineage, typed outcomes only', () => {
  it('build → recommend → RSI > 50 → undo that → preview → save as Bullish Trend + add to my chart', async () => {
    const h = host([L])

    // 1 — "Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA."
    const r1 = await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    expect(r1.res.ok).toBe(true)
    expect(r1.res.lines[0]).toMatch(/^Started .* \(draft — not saved\)\.$/)      // a NEW draft is started, not "updated"
    expect(r1.res.undo).toBeTruthy()                                    // an applied change has the exact Undo
    const ref = activeRef(h)
    expect(ref).toMatch(/^draft:create:/)
    const st1 = drafts(h)[0].status
    expect(st1.revision).toBe(1)
    expect(h.previews).toEqual([])                                     // ⛔ never previewed unasked

    // 2 — "What would you recommend adding?"  (advice: NOTHING changes, no Undo)
    const r2 = await run(h, [say(ref, 'What would you recommend adding?')])
    expect(r2.res.ok).toBe(true)
    expect(r2.res.lines).toEqual(['You could add an RSI filter so only candles with momentum are highlighted.', 'No change was made to the draft.'])
    expect(r2.res.undo).toBe(null)
    expect(drafts(h)[0].status.revision).toBe(1)

    // 3 — "Okay, also require RSI to be above 50."  (same draft: the model saw revision 1 of the SAME lineage)
    const r3 = await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    expect(r3.res.lines[0]).toMatch(/^Updated .* \(draft — not saved\)\.$/)
    expect(calls.map(c => c.revision)).toEqual([0, 1, 1])
    expect(drafts(h)[0].status.revision).toBe(2)
    expect(drafts(h)[0].status.lines.join(' ')).toMatch(/rsi/i)

    // 4 — "Actually, undo that last change."  (fast path → the Agent's Undo → the specialist's exact step)
    expect(fastParse('Actually, undo that last change.')?.kind).toBe('undo')
    const u = await undoEntry(h, r3.res.undo)
    expect(u.ok, u.reason).toBe(true)
    expect(u.lines[0]).toMatch(/^Undid the last change to .* \(draft — not saved\)\.$/)
    const st4 = drafts(h)[0].status
    expect(st4.revision).toBe(3)
    expect(st4.lines.join(' ')).not.toMatch(/rsi/i)                     // the RSI requirement is gone
    expect(st4.lines).toEqual(st1.lines)                                // back to exactly step 1's draft

    // 5 — "Show me the preview."  (asked; on the named / only chart)
    const r5 = await run(h, [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'L' } }])
    expect(r5.res.lines[0]).toMatch(/^Showing .* as a preview on Left chart \(NVDA\) — a preview only, not saved\.$/)
    expect(h.previews).toHaveLength(1)
    expect(h.previews[0].ref).toBe('L')
    expect(r5.res.undo).toBe(null)
    expect(stored).toEqual([])                                          // a preview never saves

    // 6 — "Save it as Bullish Trend and add it to my chart."  (a PROPOSAL: rename + Save, then the add separately)
    const ops6 = [{ action: 'indicator.saveDraft', target: ref, args: { addTo: ['L'], name: 'Bullish Trend' } }]
    expect(getCapability('indicator.saveDraft').risk).toBe('confirm')
    const sealed = await propose(h, ops6)
    const proposal = sealed.plan
    const shown = proposal.lines.join(' | ')
    expect(shown).toMatch(/Save .* as a new indicator as “Bullish Trend” \(renamed first — a name-only step\) \(draft revision 3\) — then add it to Left chart \(NVDA\), each separately/)
    expect(shown).toMatch(/The builder's summary: /)
    expect(stored).toEqual([])                                          // proposing writes nothing
    // Apply re-plans (as useAgent's approve does) — FROM the seal of what the member SAW
    const r6 = await approve(h, sealed)
    expect(r6.ok, JSON.stringify(r6.failed)).toBe(true)
    expect(stored).toHaveLength(1)
    const saved = [...server.values()][0]
    expect(saved.definition.meta.name).toBe('Bullish Trend')
    expect(r6.lines.join(' ')).toMatch(/Saved “Bullish Trend” \(version 1, a new indicator\) — confirmed by reading it back/)
    expect(r6.undo).toBe(null)                                          // a saved version has no Undo (D7)
    expect(r6.lines.join(' ')).not.toMatch(/No chart is open here/)    // Save attaches nothing; the add reports itself
    expect(r6.followUps).toEqual([{ action: 'indicator.add', target: 'ixe:L', args: { defId: saved.def_id }, awaitDefinition: { defId: saved.def_id, version: 1, name: 'Bullish Trend' } }])
    expect(instancesOn(h, 'L').some(i => i.defId === saved.def_id)).toBe(false)   // Save attaches nothing
    expect(drafts(h)).toEqual([])                                       // the draft ended with the Save

    // …the add, as its OWN execution through M2 (planned, permission-checked, persisted, confirmed)
    registry.installUserDefinitions([{ ...saved.definition, id: saved.def_id, version: 1 }])
    const { awaitDefinition: _w, ...addOp } = r6.followUps[0]
    const a = await run(h, [addOp])
    expect(a.res.ok).toBe(true)
    // M2 names the instance by its first output's label, which the specialist's rename re-derived ("Bullish")
    expect(a.res.lines[0]).toMatch(/^Added Bullish.* on Left chart \(NVDA\) \(saved\)\.$/)
    expect(instancesOn(h, 'L').some(i => i.defId === saved.def_id)).toBe(true)
    expect(a.res.undo).toBeTruthy()                                     // the chart add has its own Undo…
    const ua = await undoEntry(h, a.res.undo)
    expect(ua.ok).toBe(true)
    expect(server.has(saved.def_id)).toBe(true)                         // …which never touches the saved definition
  })
})

// ── 2. typed outcomes: questions / advice / refusals never mutate ──────────────────────
describe('typed outcomes — only an applied change is reported as a change', () => {
  const start = async (h) => { await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')]); return activeRef(h) }
  it('clarification and unsupported: lines say nothing changed; revision and Undo unchanged', async () => {
    const h = host([L])
    const ref = await start(h)
    const q = await run(h, [say(ref, 'which lengths are best?')])
    expect(q.res.lines).toEqual(['Which EMA lengths?', 'No change was made to the draft.'])
    expect(q.res.undo).toBe(null)
    const n = await run(h, [say(ref, 'build me a time machine')])
    expect(n.res.lines).toEqual(['I cannot build that.', 'No change was made to the draft.'])
    expect(drafts(h)[0].status.revision).toBe(1)
  })
  it('a server gate refusal (turn-refused, detail.gate) fails the step with the gate’s sentence; nothing changed', async () => {
    const h = host([L])
    const ref = await start(h)
    const r = await run(h, [say(ref, 'spend more')])
    expect(r.res.ok).toBe(false)
    expect(r.res.failed[0].reason).toMatch(/Today’s indicator-builder allowance is used up — nothing changed/)
    expect(drafts(h)[0].status.revision).toBe(1)
  })
  it('access revoked between plan and Apply → refused at Apply (fresh ctx), nothing written', async () => {
    const h = host([L])
    const ref = await start(h)
    const p = await plan(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    access = false
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/Create Indicator isn’t available for your account/)
    access = true
    expect(drafts(h)[0].status.revision).toBe(1)
  })
})

// ── 3. drafts: opaque refs, several drafts, ambiguity, expiry ──────────────────────────
describe('draft references — opaque, several, never guessed', () => {
  it('two drafts: each is its own published ref; a turn on B never touches A; only one is active', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const a = activeRef(h)
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const b = activeRef(h)
    expect(b).not.toBe(a)
    expect(drafts(h).map(s => s.ref).sort()).toEqual([a, b].sort())
    expect(drafts(h).filter(s => s.active).map(s => s.ref)).toEqual([b])
    await run(h, [say(b, 'Okay, also require RSI to be above 50.')])
    const byRef = Object.fromEntries(drafts(h).map(s => [s.ref, s.status.revision]))
    expect(byRef).toEqual({ [a]: 1, [b]: 2 })
    // the context publishes every draft with a ref (the server accepts only published refs; an
    // unclear "it" with several drafts and none named is asked back — "Which one do you mean?")
    const { context } = buildContext(h, CTX)
    const items = context.indicatorDrafts
    expect(items.filter(i => !i.new).length).toBe(2)
    expect(items.every(i => typeof i.ref === 'string' && i.ref.length)).toBe(true)
    expect(items.filter(i => i.active).length).toBe(1)
  })
  it('an expired draft (new tab / store cleared) is shown as expired and refused — never rebuilt from chat', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    _simulateReload(); try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
    const snap = indicatorDraftsKind.read(h, ref)
    expect(snap).toMatchObject({ expired: true, active: true })
    const p = await plan(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/That draft has expired/)
    expect(calls).toHaveLength(1)                                       // the model was never asked
  })
})

// ── 4. preview: asked only, chart-targeted, refusals typed ─────────────────────────────
describe('preview — only when asked, only on a named chart', () => {
  it('no chart named → asked back; a readonly chart → the specialist’s refusal; moving to another chart says so', async () => {
    const h = host([L, R])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.', { chart: 'L' })])
    const ref = activeRef(h)
    const none = await plan(h, [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'nope' } }])
    expect(none.ok).toBe(false)
    expect(none.refusals[0].reason).toMatch(/Which chart should I show the preview on\?/)
    h.readonly.R = true
    const ro = await run(h, [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'R' } }])
    expect(ro.res.ok).toBe(false)
    expect(ro.res.failed[0].reason).toMatch(/That chart can’t show a preview/)
    h.readonly.R = false
    await run(h, [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'L' } }])
    const mv = await run(h, [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'R' } }])
    expect(mv.res.lines[0]).toMatch(/on Right chart \(AAPL\) — a preview only, not saved \(moved from Left chart \(NVDA\)\)\.$/)
  })
  it('a protected layout (Main Trading) open → preview refused by the guard; a draft turn is not', async () => {
    const h = host([L])
    h.layouts = { snapshot: () => ({ entries: [{ id: '1', name: 'Main Trading' }], active: { scope: 'user', id: '1' } }) }
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    const pv = [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'L' } }]
    expect(protectionRefusal(h, await plan(h, pv), pv)).toMatch(/protected layout/)
    const t = [say(ref, 'What would you recommend adding?')]
    expect(protectionRefusal(h, await plan(h, t), t)).toBe(null)
  })
})

// ── 5. Save: exact approval, recheck at Apply, read-back, no rollback ──────────────────
describe('Save — the exact draft and revision the member approved', () => {
  const start = async (h) => { await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')]); return activeRef(h) }
  it('the draft changed after the proposal → Apply refuses (stale-revision), nothing stored', async () => {
    const h = host([L])
    const ref = await start(h)
    const ops = [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }]
    const proposal = await propose(h, ops)
    expect(proposal.card[0]).toMatch(/\(draft revision 1\)/)
    await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])      // revision 2 now
    const res = await approve(h, proposal)
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/The draft changed since you approved it \(revision 1 → 2\)/)
    expect(stored).toEqual([])
    // asked again → a NEW proposal on the current revision
    const again = await plan(h, ops)
    expect(again.lines[0]).toMatch(/\(draft revision 2\)/)
  })
  it('the store accepts but the read-back fails → saved-unconfirmed, never "Saved"', async () => {
    const h = host([L])
    const ref = await start(h)
    saveMode = 'lost'
    const res = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: ['L'], name: null } }]), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/could not read it back, so I am not reporting it as saved/)
    expect(res.followUps).toBeUndefined()                                // no chart add without a confirmed Save
  })
  it('a save conflict → nothing overwritten, typed sentence', async () => {
    const h = host([L])
    const ref = await start(h)
    saveMode = 'conflict'
    const res = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }]), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/saved elsewhere in the meantime/)
  })
  it('nothing new to save → refused at plan (not-dirty)', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'which lengths are best?')])                  // a draft with no change
    const ref = activeRef(h)
    const p = await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/nothing new to save/)
  })
  it('Save + two charts, one refused: separate receipts; the Save is never rolled back', async () => {
    const h = host([L, R])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.', { chart: 'L' })])
    const ref = activeRef(h)
    const ops = [{ action: 'indicator.saveDraft', target: ref, args: { addTo: ['L', 'R'], name: null } }]
    await plan(h, ops)
    const res = await commitPlan(h, await plan(h, ops), { env: {}, ctx: CTX })
    expect(res.ok).toBe(true)
    expect(res.followUps.map(f => f.target)).toEqual(['ixe:L', 'ixe:R'])
    const saved = [...server.values()][0]
    registry.installUserDefinitions([{ ...saved.definition, id: saved.def_id, version: 1 }])
    h.access.R = false                                                  // permission lost on chart R
    const outs = []
    for (const { awaitDefinition: _w, ...op } of res.followUps) {
      const p = await plan(h, [op])
      outs.push(p.ok ? await commitPlan(h, p, { env: {}, ctx: CTX }) : { ok: false, refused: p.refusals[0].reason })
    }
    expect(outs[0].ok).toBe(true)
    expect(outs[1]).toMatchObject({ ok: false })
    expect(outs[1].refused).toMatch(/can't be changed from here/)
    expect(server.has(saved.def_id)).toBe(true)                         // the Save stands
    expect(instancesOn(h, 'L').some(i => i.defId === saved.def_id)).toBe(true)
    expect(instancesOn(h, 'R').some(i => i.defId === saved.def_id)).toBe(false)
  })
  it('a refusal AFTER the rename landed (here: a store conflict) says "renamed, not saved" (INDICATORS review Q3)', async () => {
    const h = host([L])
    const ref = await start(h)
    saveMode = 'conflict'
    const ops = [say(ref, 'Name it Bullish Trend'), { action: 'indicator.saveDraft', target: ref, args: { addTo: ['L'], name: null } }]
    await plan(h, ops)
    const res = await commitPlan(h, await plan(h, ops), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/Renamed it to “Bullish Trend” \(draft — not saved\), but didn’t save it: That indicator was saved elsewhere/)
    expect(res.followUps).toBeUndefined()
    expect(drafts(h)[0].status.name).toBe('Bullish Trend')
  })
  it('two-op form: a MODEL turn is never trusted as a rename (no renameOnly marker) — not saved', async () => {
    const h = host([L])
    const ref = await start(h)
    const ops = [say(ref, 'make the slow line 50'), { action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }]
    await plan(h, ops)
    const res = await commitPlan(h, await plan(h, ops), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/Renamed it to “.*” \(draft — not saved\), but didn’t save it: that wasn’t only a rename/)
    expect(stored).toEqual([])
  })
})

// ── 6. Undo safety + routing ───────────────────────────────────────────────────────────
describe('Undo and routing', () => {
  it('a stale Undo (the draft moved since) is refused by the specialist — nothing undone', async () => {
    const h = host([L])
    const r1 = await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    await run(h, [say(activeRef(h), 'Okay, also require RSI to be above 50.')])
    const u = await undoEntry(h, r1.res.undo)
    expect(u.ok).toBe(false)
    expect(u.reason).toMatch(/can’t be undone exactly — nothing was undone/)
    expect(drafts(h)[0].status.revision).toBe(2)
  })
  it('indicator.undoDraft undoes the draft’s own last step (no Agent Undo entry needed)', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    const r = await run(h, [{ action: 'indicator.undoDraft', target: ref, args: {} }])
    expect(r.res.ok).toBe(true)
    expect(r.res.lines[0]).toMatch(/^Undid the last change/)
    expect(drafts(h)[0].status.revision).toBe(3)
  })
  it('the six lines route to the indicators group (or ride its recent-action pin)', () => {
    const g = (m, recent = []) => selectGroups(m, { recentActions: recent }).priority
    expect(g('Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')).toContain('indicators')
    expect(g('Okay, also require RSI to be above 50.')).toContain('indicators')
    expect(g('Show me the preview.')).toContain('indicators')
    expect(g('Save it as Bullish Trend and add it to my chart.', ['indicator.draft'])).toContain('indicators')
    expect(g('What would you recommend adding?', ['indicator.draft'])).toContain('indicators')
  })
  it('AR reason codes used are the documented ones', () => {
    for (const k of ['ACCESS', 'DRAFT_EXPIRED', 'STALE_REVISION', 'STALE_STEP', 'NEEDS_ACK', 'SAVED_UNCONFIRMED', 'TURN_REFUSED', 'PREVIEW_READONLY', 'PREVIEW_BUSY']) expect(typeof AR[k]).toBe('string')
  })
})

// ── 7. repaint acknowledgement — the Indicators-owned contract (status.ackText / needs-ack) ─────
describe('⭐ repaint acknowledgement — exact text, exact revision, approved, rechecked at Apply', () => {
  const pivots = async (h) => { await run(h, [say(NEW, 'mark pivot highs')]); return activeRef(h) }
  const saveOp = (ref, addTo = []) => [{ action: 'indicator.saveDraft', target: ref, args: { addTo, name: null } }]
  it('the proposal shows the specialist’s acknowledgement VERBATIM and the revision; Save only after approval', async () => {
    const h = host([L])
    const ref = await pivots(h)
    const st = drafts(h)[0].status
    expect(st.needsAck).toEqual(['ph'])
    expect(st.ackText).toHaveLength(1)
    expect(st.ackText[0]).toMatch(/ reads .+ ahead, so .+ — confirm below before saving$/)        // the specialist's wording (Indicators-owned)
    // the specialist itself refuses an unacknowledged Save (the contract the Agent relies on)
    const direct = await saveDraft(st.draftRef, { expectedRevision: st.revision, acknowledged: false }, { canAuthor: true, definitionRows: [], store: () => { throw new Error('must not store') } })
    expect(direct).toMatchObject({ ok: false, reason: AR.NEEDS_ACK, detail: { ackText: st.ackText } })
    const proposal = await plan(h, saveOp(ref, ['L']))
    expect(proposal.ok).toBe(true)
    expect(getCapability('indicator.saveDraft').risk).toBe('confirm')            // never applied unapproved
    expect(proposal.lines[0]).toContain('(draft revision 1)')
    expect(proposal.lines[0]).toContain(`You are also acknowledging: ${st.ackText[0]}`)
    expect(stored).toEqual([])
    const res = await commitPlan(h, await plan(h, saveOp(ref, ['L'])), { env: {}, ctx: CTX })   // Apply = approval
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(stored).toHaveLength(1)
    expect(stored[0].opts).toMatchObject({ previewAcked: true })                 // the store got the acknowledgement
    expect(res.lines[0]).toMatch(/^Saved “.*” \(version 1, a new indicator\)/)
    expect(res.followUps).toHaveLength(1)
  })
  it('the revision changes before Apply → refused: no Save, no success receipt, no chart add', async () => {
    const h = host([L])
    const ref = await pivots(h)
    const proposal = await propose(h, saveOp(ref, ['L']))                         // proposal at revision 1
    await run(h, [say(ref, 'Name it Pivot Watch')])                               // revision 2 (a local rename)
    expect(drafts(h)[0].status.revision).toBe(2)
    const res = await approve(h, proposal)
    expect(res.ok).toBe(false)
    expect(res.lines).toEqual([])
    expect(res.followUps).toBeUndefined()
    expect(stored).toEqual([])
    expect(instancesOn(h, 'L').filter(i => String(i.defId).startsWith('u_'))).toEqual([])
  })
  it('the acknowledgement changes before Apply (a repainting output added) → refused with the NEW text; nothing saved', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    const proposal = await propose(h, saveOp(ref, ['L']))                         // no acknowledgement shown
    expect(proposal.card[0]).not.toContain('acknowledging')
    await run(h, [say(ref, 'also mark pivot highs')])                             // now it needs one
    const now = drafts(h)[0].status
    expect(now.ackText).toHaveLength(1)
    const res = await approve(h, proposal)
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/changed since you approved it.*so nothing was saved or added to a chart/)
    expect(res.followUps).toBeUndefined()
    expect(stored).toEqual([])
    // asked again → a NEW proposal that shows the new acknowledgement and revision
    const again = await plan(h, saveOp(ref, ['L']))
    expect(again.lines[0]).toContain(`(draft revision ${now.revision})`)
    expect(again.lines[0]).toContain(now.ackText[0])
  })
  it('"Save it as X" on a repainting draft: the rename changes the acknowledgement text, so it is refused and re-proposed', async () => {
    const h = host([L])
    const ref = await pivots(h)
    const ops = [say(ref, 'Name it Pivot Watch'), ...saveOp(ref)]
    await plan(h, ops)
    const res = await commitPlan(h, await plan(h, ops), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/needs your acknowledgement first: Pivot Watch reads /)
    expect(stored).toEqual([])
    expect(drafts(h)[0].status.name).toBe('Pivot Watch')                          // renamed (draft), not saved
    const again = await plan(h, saveOp(ref))
    expect(again.lines[0]).toContain('You are also acknowledging: Pivot Watch reads ')
    const ok = await commitPlan(h, await plan(h, saveOp(ref)), { env: {}, ctx: CTX })
    expect(ok.ok).toBe(true)
    expect(stored).toHaveLength(1)
  })
})

// ── 8. several drafts — never a silent pick ─────────────────────────────────────────
describe('⭐ several drafts — the member chooses; nothing is picked for them', () => {
  const two = async (h) => {
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const a = activeRef(h)
    await run(h, [say(NEW, 'mark pivot highs')])
    const b = activeRef(h)
    return { a, b }
  }
  const rev = (h, ref) => drafts(h).find(s => s.ref === ref).status.revision
  it('a request on the draft the member did NOT select → "which one?" with every draft; the selected one passes', async () => {
    const h = host([L])
    const { a, b } = await two(h)
    expect(draftAmbiguity(h, [say(b, 'which lengths are best?')])).toBe(null)    // b: just made, selected
    const amb = draftAmbiguity(h, [say(a, 'Okay, also require RSI to be above 50.')])
    expect(amb.text).toBe('You have 2 indicator drafts open — which one do you mean?')
    expect(amb.choices.map(c => c.ref).sort()).toEqual([a, b].sort())
    expect(amb.choices.map(c => c.label)).toEqual(expect.arrayContaining(['“EMA 9 · EMA 20” (draft)']))
    for (const action of ['indicator.previewDraft', 'indicator.saveDraft', 'indicator.undoDraft']) {
      expect(draftAmbiguity(h, [{ action, target: a, args: {} }]), action).not.toBe(null)
    }
    expect(draftAmbiguity(h, [say(NEW, 'something new')])).toBe(null)           // a NEW draft is never ambiguous
  })
  it('no draft selected (a reload) with two open → every draft request asks', async () => {
    const h = host([L])
    const { a, b } = await two(h)
    _resetAuthoring()                                                            // the selection is gone, the drafts are not
    expect(draftAmbiguity(h, [say(a, 'x')])).not.toBe(null)
    expect(draftAmbiguity(h, [say(b, 'x')])).not.toBe(null)
  })
  it('choosing a draft continues THAT draft only; the other is untouched', async () => {
    const h = host([L])
    const { a, b } = await two(h)
    const before = { a: rev(h, a), b: rev(h, b) }
    expect(selectDraft(h, a)).toBe(true)
    expect(draftAmbiguity(h, [say(a, 'Okay, also require RSI to be above 50.')])).toBe(null)
    await run(h, [say(a, 'Okay, also require RSI to be above 50.')])
    expect({ a: rev(h, a), b: rev(h, b) }).toEqual({ a: before.a + 1, b: before.b })
    expect(draftAmbiguity(h, [say(b, 'x')])).not.toBe(null)                      // b is now the unselected one
  })
  it('unrelated Agent actions never change which draft is selected', async () => {
    const h = host([L])
    const { a, b } = await two(h)
    await run(h, [{ action: 'indicator.add', target: 'ixe:L', args: { defId: 'rsi' } }])   // an M2 chart change
    expect(drafts(h).find(s => s.active).ref).toBe(b)
    expect(draftAmbiguity(h, [say(a, 'x')])).not.toBe(null)
  })
  it('an expired draft is refused safely, and leaves a single usable draft unambiguous', async () => {
    const h = host([L])
    const { a, b } = await two(h)
    const st = drafts(h).find(s => s.ref === b).status
    expect(discardDraft(st.draftRef, { expectedRevision: st.revision }, { canAuthor: true, definitionRows: [] })).toEqual({ ok: true })
    const p = await plan(h, [say(b, 'which lengths are best?')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/That draft has expired/)
    expect(draftAmbiguity(h, [say(a, 'x')])).toBe(null)                          // one usable draft left
    expect(draftStatus(st.draftRef, { canAuthor: true, definitionRows: [] })).toMatchObject({ ok: false, reason: AR.DRAFT_EXPIRED })
  })
  it('inaccessible (Create Indicator access revoked) → the specialist refuses at Apply, nothing changes', async () => {
    const h = host([L])
    const { b } = await two(h)
    const before = rev(h, b)
    const p = await plan(h, [say(b, 'Okay, also require RSI to be above 50.')])
    access = false
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/Create Indicator isn’t available for your account/)
    access = true
    expect(rev(h, b)).toBe(before)
  })
})

// ── 9. typed rename (contract §16.1): renameDraft + renameOnly, consumed — never inferred ──────────
describe('⭐ typed rename — the specialist’s renameOnly marker is the only proof', () => {
  const start = async (h) => { await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')]); return activeRef(h) }
  const saveAs = (ref, name, addTo = []) => [{ action: 'indicator.saveDraft', target: ref, args: { addTo, name } }]
  it('"Save it as X": renameDraft (no model call) on the pinned revision, then Save at +1; the saved name is X', async () => {
    const h = host([L])
    const ref = await start(h)
    const n = calls.length
    await plan(h, saveAs(ref, 'Bullish Trend'))
    const res = await commitPlan(h, await plan(h, saveAs(ref, 'Bullish Trend')), { env: {}, ctx: CTX })
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(calls.length).toBe(n)                                                  // no model call for the name
    expect(res.lines[0]).toBe('Renamed it to “Bullish Trend” (draft).')
    expect(res.lines[1]).toMatch(/^Saved “Bullish Trend” \(version 1, a new indicator\)/)
    expect([...server.values()][0].definition.meta.name).toBe('Bullish Trend')
  })
  it('the draft moved after the proposal → renameDraft refuses (stale-revision): nothing renamed or saved', async () => {
    const h = host([L])
    const ref = await start(h)
    const proposal = await propose(h, saveAs(ref, 'Bullish Trend'))
    await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    const res = await approve(h, proposal)
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/The draft changed since you approved it .*so nothing was saved/)
    expect(drafts(h)[0].status.name).not.toBe('Bullish Trend')
    expect(stored).toEqual([])
  })
  it('a repainting draft: the rename moves the ack text → "renamed, not saved"; the next proposal shows the new text', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'mark pivot highs')])
    const ref = activeRef(h)
    await plan(h, saveAs(ref, 'Swing Highs'))
    const res = await commitPlan(h, await plan(h, saveAs(ref, 'Swing Highs')), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/^failed \(Renamed it to “Swing Highs” \(draft — not saved\), but didn’t save it: Saving it needs your acknowledgement first: Swing Highs reads /)
    expect(stored).toEqual([])
    const again = await plan(h, saveAs(ref, null))
    expect(again.lines[0]).toContain('You are also acknowledging: Swing Highs reads ')
    expect((await commitPlan(h, await plan(h, saveAs(ref, null)), { env: {}, ctx: CTX })).ok).toBe(true)
  })
  it('the same name → name-unchanged is not an error: it simply saves', async () => {
    const h = host([L])
    const ref = await start(h)
    const cur = drafts(h)[0].status.name
    const res = await commitPlan(h, await plan(h, saveAs(ref, cur)), { env: {}, ctx: CTX })
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(res.lines[0]).toMatch(/^Saved /)
  })
  it('a name AND a separate rename turn in one request is refused (name it in the save itself)', async () => {
    const h = host([L])
    const ref = await start(h)
    const p = await plan(h, [say(ref, 'Name it A'), ...saveAs(ref, 'B')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/Name it in the save itself/)
  })
})

// ── 10. INDICATORS review N1/N2/N3 ───────────────────────────────────────────────────
describe('review follow-ups — per-tab pointer, the draft keeps its chart', () => {
  it('N1: the selected-draft pointer lives in sessionStorage (the drafts’ own lifetime), never localStorage', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    expect(sessionStorage.getItem('uct.agent.activeDraft')).toMatch(/"lineage"/)
    expect(localStorage.getItem('uct.agent.activeDraft')).toBe(null)
  })
  it('A: a NEW draft on a multi-chart board with no chart named → "Which chart is this indicator for?" (never the first chart)', async () => {
    const h = host([L, R])
    const p = await plan(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toBe('Which chart is this indicator for?')
    expect(calls).toEqual([])
  })
  it('A: the draft keeps the chart it was begun on (the specialist’s DraftStatus.chartRef), whatever the board order', async () => {
    const specs = [L, R]
    const h = host(specs)
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.', { chart: 'R' })])
    const ref = activeRef(h)
    expect(drafts(h)[0].status.chartRef).toBe('R')
    specs.reverse()
    await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    expect(calls.map(c => c.symbol)).toEqual(['AAPL', 'AAPL'])
  })
  it('A: the originating chart was removed → asked which chart; naming one continues on it', async () => {
    const specs = [L, R]
    const h = host(specs)
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.', { chart: 'R' })])
    const ref = activeRef(h)
    specs.splice(specs.indexOf(R), 1)                                            // chart R removed from the board
    const p = await plan(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/no longer on the board — which chart should it use\?/)
    await run(h, [say(ref, 'Okay, also require RSI to be above 50.', { chart: 'L' })])
    expect(calls.map(c => c.symbol)).toEqual(['AAPL', 'NVDA'])
  })
  it('A: a chart removed between plan and Apply → refused at Apply, nothing sent', async () => {
    const specs = [L, R]
    const h = host(specs)
    const p = await plan(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.', { chart: 'R' })])
    specs.splice(specs.indexOf(R), 1)
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/That chart is no longer on the board, so nothing was sent/)
    expect(calls).toEqual([])
  })

})

// ── 11. editing an existing saved indicator; refinement B ─────────────────────────────
describe('edit an existing saved indicator; a saved definition is never saved twice', () => {
  const saveNew = async (h) => {
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    const r = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: 'Trend One' } }]), { env: {}, ctx: CTX })
    expect(r.ok, JSON.stringify(r.failed)).toBe(true)
    return [...server.values()][0]
  }
  it('edit: the member’s own definition opens as an EDIT draft on the named chart; Save writes version 2 of the SAME id', async () => {
    const h = host([L])
    const row = await saveNew(h)
    expect(row.version).toBe(1)
    await run(h, [say(NEW, 'Okay, also require RSI to be above 50.', { edit: row.def_id })])
    const st = drafts(h).find(d => d.active).status
    expect(st).toMatchObject({ mode: 'edit', defId: row.def_id, baseVersion: 1, chartRef: 'L' })
    const ref = activeRef(h)
    const p = await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }])
    expect(p.lines[0]).toMatch(/^Save a new version of “Trend One”/)
    const res = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }]), { env: {}, ctx: CTX })
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(res.lines[0]).toMatch(/^Saved “Trend One” \(version 2\)/)
    expect(server.get(row.def_id).version).toBe(2)
    expect(stored.at(-1)).toMatchObject({ defId: row.def_id, opts: { baseVersion: 1 } })
  })
  it('edit: someone else’s / an unknown definition id is refused at plan', async () => {
    const h = host([L])
    const p = await plan(h, [say(NEW, 'make it blue', { edit: 'u_ffffffffffff' })])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/I don’t know that indicator on your account/)
  })
  it('edit: a version conflict (saved elsewhere meanwhile) → nothing overwritten, typed sentence', async () => {
    const h = host([L])
    const row = await saveNew(h)
    await run(h, [say(NEW, 'Okay, also require RSI to be above 50.', { edit: row.def_id })])
    saveMode = 'conflict'
    const res = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: activeRef(h), args: { addTo: [], name: null } }]), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/saved elsewhere in the meantime \(now version 9\) — nothing was overwritten/)
  })
  it('a mismatched read-back (a different version comes back) → saved-unconfirmed, never "Saved"', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    setAuthoringSources({ extra: { converse, store: (s0, o) => storeConversation(s0, { ...o, save: fakeSave }), readBack: async (id) => ({ ...server.get(id), version: 99 }) } })
    const res = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: ['L'], name: null } }]), { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/could not read it back, so I am not reporting it as saved/)
    expect(res.followUps).toBeUndefined()
  })
  it('B: after a Save the context keeps lastSaved {defId, version, name} so a delayed add is retried with the SAME definition', async () => {
    const h = host([L])
    const row = await saveNew(h)
    const { context } = buildContext(h, CTX)
    const neu = context.indicatorDrafts.find(e => e.new)
    expect(neu.lastSaved).toEqual({ defId: row.def_id, version: 1, name: 'Trend One' })
    expect(neu.yourIndicators).toEqual([{ defId: row.def_id, name: 'Trend One' }])
    // the retry is an ordinary M2 add of that defId — no Save involved
    registry.installUserDefinitions([{ ...row.definition, id: row.def_id, version: 1 }])
    const n = stored.length
    const a = await run(h, [{ action: 'indicator.add', target: 'ixe:L', args: { defId: neu.lastSaved.defId } }])
    expect(a.res.ok).toBe(true)
    expect(stored.length).toBe(n)
  })
})

// ── 12. S5 behaviours: consecutive Undo, dock ownership, preview lifecycle, independent add Undo ──
describe('S5 — Undo chain, dock ownership, preview lifecycle, independent chart receipts', () => {
  it('consecutive Undo walks the draft back exactly (newest first); each entry is the specialist’s own step', async () => {
    const h = host([L])
    const r1 = await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    const r2 = await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    const s1 = drafts(h)[0].status.lines
    const u2 = await undoEntry(h, r2.res.undo)
    expect(u2.ok, u2.reason).toBe(true)
    const u1 = await undoEntry(h, r1.res.undo)
    expect(u1.ok, u1.reason).toBe(true)
    const st = drafts(h)[0].status
    expect(st.revision).toBe(4)                                                  // 2 turns + 2 undos
    expect(st.canUndo).toBe(false)
    expect(s1.join(' ')).toMatch(/rsi/i)
    expect((await undoEntry(h, r1.res.undo)).ok).toBe(false)                     // a spent step is refused
  })
  it('dock ownership: a draft open in Create Indicator is refused at plan and at Apply; released → continues', async () => {
    const h = host([L])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.')])
    const ref = activeRef(h)
    const key = drafts(h)[0].status.draftRef.key
    const p = await plan(h, [say(ref, 'Okay, also require RSI to be above 50.')])  // planned while free
    holdInDock(key)
    const res = await commitPlan(h, p, { env: {}, ctx: CTX })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/open in Create Indicator/)
    const p2 = await plan(h, [say(ref, 'Okay, also require RSI to be above 50.')])
    expect(p2.ok).toBe(false)
    expect(p2.refusals[0].reason).toMatch(/open in Create Indicator/)
    releaseDock(key)
    expect((await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])).res.ok).toBe(true)
  })
  it('preview: one per tab, replaced across charts, refreshed by a change, taken down by the Save; never persisted', async () => {
    const h = host([L, R])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.', { chart: 'L' })])
    const ref = activeRef(h)
    const boardBefore = JSON.stringify(h.store)
    await run(h, [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'L' } }])
    const mv = await run(h, [{ action: 'indicator.previewDraft', target: ref, args: { chart: 'R' } }])
    expect(mv.res.lines[0]).toMatch(/moved from Left chart \(NVDA\)/)
    const n = h.previews.length
    await run(h, [say(ref, 'Okay, also require RSI to be above 50.')])          // the change redraws the preview
    expect(h.previews.length).toBe(n + 1)
    expect(h.previews.at(-1).ref).toBe('R')
    const cleared = h.cleared || 0
    const res = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: [], name: null } }]), { env: {}, ctx: CTX })
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(h.cleared).toBe(cleared + 1)                                           // Save takes the preview down
    expect(JSON.stringify(h.store)).toBe(boardBefore)                             // no chart was written by any of it
  })
  it('partial application: two adds, each its own receipt and Undo — undoing one leaves the other and the Save', async () => {
    const h = host([L, R])
    await run(h, [say(NEW, 'Build me an indicator that highlights candles when the 9 EMA is above the 20 EMA.', { chart: 'L' })])
    const ref = activeRef(h)
    const res = await commitPlan(h, await plan(h, [{ action: 'indicator.saveDraft', target: ref, args: { addTo: ['L', 'R'], name: null } }]), { env: {}, ctx: CTX })
    const saved = [...server.values()][0]
    registry.installUserDefinitions([{ ...saved.definition, id: saved.def_id, version: 1 }])
    const adds = []
    for (const { awaitDefinition: _w, ...op } of res.followUps) adds.push((await run(h, [op])).res)
    expect(adds.map(a => a.ok)).toEqual([true, true])
    expect(adds[0].undo.id).not.toBe(adds[1].undo.id)
    expect((await undoEntry(h, adds[0].undo)).ok).toBe(true)
    expect(instancesOn(h, 'L').some(i => i.defId === saved.def_id)).toBe(false)
    expect(instancesOn(h, 'R').some(i => i.defId === saved.def_id)).toBe(true)
    expect(server.has(saved.def_id)).toBe(true)
  })
})
