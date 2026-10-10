// ── INDICATORS (M3): conversational authoring through the Indicators specialist ────────────
//
// The Agent half of `docs/indicators/AGENT-M3-CONTRACT.md` (§3.5, §15, §16). Indicator
// Intelligence owns the draft — lineage, revision, history, Undo, the model call (/converse),
// validation, preview, Save and read-back — through `components/chart/builder/agentAuthoring.js`
// (contract `uct.indicators.authoring/1`). This file only ROUTES, TARGETS and RECEIPTS:
//
//   indicator.draft         one member turn on ONE draft (new or existing): advice, a question,
//                           or a change — the specialist decides which (`draftTurn`)
//   indicator.previewDraft  the draft as the tab's one live preview on a named chart (asked only)
//   indicator.saveDraft     the canonical Save (always proposed), then — as SEPARATE executions —
//                           an M2 `indicator.add` per requested chart
//   indicator.undoDraft     the draft's own last step, when the Agent's Undo stack has none
//                           (after a reload) — from `draftStatus().undoStepId`
//
// ⛔ NO SECOND ENGINE, NO SECOND STORE. The Agent never reads a tree or a formula, never calls
// /converse, never writes a definition, and never rebuilds a draft from chat. It keeps only the
// OPAQUE `draftRef`s the specialist returned (held as returned; the active one also survives a
// reload in this tab), and asks the specialist again on every call — `ctx` is rebuilt each time
// from the current access, the member's own definition rows and the target chart.
// ⛔ "DONE" ONLY FROM A TYPED OUTCOME. A question or advice reply changes nothing and says so;
// a change is reported from the specialist's own lines; Save only from its read-back-confirmed
// result. Preview is shown only when the member asks for it.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import {
  AUTHORING_CONTRACT, AUTHORING_REASONS as R, openDraft, draftTurn, draftUndo, draftStatus, listDrafts,
  saveDraft, showDraftPreview, renameDraft,
} from '../../components/chart/builder/agentAuthoring'

const NEW = 'draft:new'
const refOf = (key) => `draft:${key}`

// ── fresh sources (useAgent hands them in; read at EVERY call) ──
// `extra` is for tests only (the specialist's injectable `converse` / `store` / `readBack`).
let sources = { access: () => false, rows: () => [], extra: null }
export function setAuthoringSources(s) { sources = { ...sources, ...(s || {}) } }

/** The context for ONE specialist call, built now: access, own rows, and the symbol/tf of the
 *  chart the draft belongs to — ⛔ never a substitute: no chart → no symbol (refinement A). */
export function authoringCtx(host, chartRef = null) {
  const charts = (() => { try { return host?.charts?.list() || [] } catch { return [] } })()
  const c = (chartRef && charts.find(x => x.ref === chartRef)) || null
  let rows = []
  try { rows = [...(sources.rows() || [])] } catch { rows = [] }
  let canAuthor = false
  try { canAuthor = sources.access() === true } catch { canAuthor = false }
  return { canAuthor, definitionRows: rows, sym: c?.symbol || null, tf: c?.tf || null, ...(sources.extra || {}) }
}

// ── the ACTIVE draft of this Agent conversation: the opaque draftRef, as the specialist returned it ──
// per TAB (sessionStorage) — the same lifetime as the specialist's drafts (INDICATORS review N1)
const ACTIVE_KEY = 'uct.agent.activeDraft'
const store = () => globalThis.sessionStorage
let active = null
const readActive = () => {
  if (active) return active
  try { const v = store()?.getItem(ACTIVE_KEY); active = v ? JSON.parse(v) : null } catch { active = null }
  return active
}
function setActive(draftRef) {
  active = draftRef || null
  try {
    if (active) store()?.setItem(ACTIVE_KEY, JSON.stringify(active))
    else store()?.removeItem(ACTIVE_KEY)
  } catch { /* storage is a convenience: the specialist is the authority */ }
}
export function _resetAuthoring() { active = null; try { store()?.removeItem(ACTIVE_KEY); store()?.removeItem(LAST_KEY) } catch { /* */ } }

// ── refinement A: the chart a draft belongs to is the SPECIALIST's association (`status.chartRef`,
// recorded by openDraft). Used while that chart is on the board; otherwise the member names one. ──
const boardCharts = (host) => { try { return host?.charts?.list() || [] } catch { return [] } }
const originOf = (status) => (status && typeof status.chartRef === 'string' ? status.chartRef : null)
/** The chart for a draft request: {ref} or {ask} (a question — never a silent pick). */
/** A chart named through its own indicators / indicatorEdits entry ('ind:<chart>' / 'ixe:<chart>') IS that
 *  chart (S6 probe P9: the model passed the indicatorEdits ref for "add it to the SPY chart"). */
export const asChartRef = (r) => (typeof r === 'string' ? r.replace(/^(?:ind|ixe):/, '') : r)
export function chartForDraft(st, chartArg) {
  chartArg = chartArg == null ? chartArg : asChartRef(chartArg)
  const charts = st.charts || []
  const on = (r) => charts.some(c => c.ref === r)
  if (chartArg != null) return on(chartArg) ? { ref: chartArg } : { ask: 'That chart isn’t on the board — which chart is this indicator for?' }
  if (st.new) {
    if (charts.length === 1) return { ref: charts[0].ref }
    return { ask: charts.length ? 'Which chart is this indicator for?' : 'Open a chart first — an indicator is built on a chart.' }
  }
  const origin = originOf(st.status)
  if (origin && on(origin)) return { ref: origin }
  return { ask: origin ? 'The chart this draft was started on is no longer on the board — which chart should it use?' : 'Which chart is this draft for?' }
}
// the last definition the Agent SAVED (refinement B): kept so a delayed chart add is retried with the
// SAME definition — never a second Save
const LAST_KEY = 'uct.agent.lastSaved'
export function lastSaved() { try { return JSON.parse(store()?.getItem(LAST_KEY) || 'null') } catch { return null } }
function rememberSaved(v) { try { store()?.setItem(LAST_KEY, JSON.stringify(v)) } catch { /* convenience only */ } }

// ── ⛔ NEVER A SILENT PICK BETWEEN DRAFTS ──
// The SELECTED draft of this conversation (`active`) is set only by the member: the Agent made it
// for them (a new-draft request), they chose it from the "which one?" list, or they acted on it
// while it was the only one. With two or more usable drafts, a request on any OTHER draft (or with
// none selected) is not planned: the member is shown the drafts and picks one. Unrelated Agent
// actions never touch the selection.
const DRAFT_ACTIONS = new Set(['indicator.draft', 'indicator.previewDraft', 'indicator.saveDraft', 'indicator.undoDraft'])
const labelOf = (s) => (s.status?.name ? `“${s.status.name}” (draft)` : 'Untitled draft')
export function draftAmbiguity(host, ops) {
  const on = (ops || []).filter(o => o && DRAFT_ACTIONS.has(o.action) && o.target !== NEW)
  if (!on.length) return null
  let snaps
  try { snaps = snapshots(host) } catch { return null }
  const usable = snaps.filter(s => !s.new && !s.expired)
  if (usable.length < 2) return null
  if (on.every(o => snaps.some(s => s.ref === o.target && s.active && !s.expired))) return null
  return { text: `You have ${usable.length} indicator drafts open — which one do you mean?`, choices: usable.map(s => ({ ref: s.ref, label: labelOf(s) })) }
}
/** The member chose this draft (from the "which one?" list). */
export function selectDraft(host, ref) {
  const s = snapshots(host).find(x => x.ref === ref && x.draftRef && !x.expired)
  if (s) setActive(s.draftRef)
  return !!s
}
export const isDraftAction = (name) => DRAFT_ACTIONS.has(name)
/** Usable (not expired) drafts in this tab. */
export function hasUsableDraft(host) {
  try { return snapshots(host).some(s => !s.new && !s.expired) } catch { return false }
}

// ── ⛔ S6 F1–F3: the EXECUTION BOUNDARY for model-planned ops (useAgent.send, before anything is
// planned or proposed). Deterministic, from the member's own words — the model's choice is checked,
// never trusted, for the three intents real-model acceptance got wrong. ──
const PANEL_WORDS = /\b(create indicator|indicator (?:builder|panel|editor|window)|(?:visual|the) builder|builder (?:panel|window|interface|view)|panel|dock|editor|interface)\b/i
const LAYOUT_WORDS = /\b(layouts?|workspace|board|setup)\b/i
const INDICATOR_WORDS = /\b(indicators?|draft|study|formula)\b/i
const APPLY_WORDS = /\b(add|apply|put|place|attach|load|plot|show)\b[^.;!?]*\b(charts?|both|all of them)\b|\b(?:to|on|onto) (?:my|the|both|all|this|that|these|those)\b[^.;!?]*\bcharts?\b/i
const NEGATION = /\b(don['’]?t|do not|not|no|without|never|neither|nor)\b/i
/** Did the member ask, in THIS message, to put the indicator on a chart? (a negated clause is not a request) */
export function asksToApply(text) {
  return String(text || '').split(/[.;!?\n]+|,\s*(?:but|then)\b/i).some(c => APPLY_WORDS.test(c) && !NEGATION.test(c))
}
/** F5: null when "both / all charts" names exactly the charts the plan adds to; else the question to ask. */
export function multiChartAmbiguity(host, adds, text) {
  // every chart on the board (a chart that can't take it is refused by the add itself, by name)
  const charts = boardCharts(host)
  const targets = [...new Set(adds.map(o => asChartRef(o.target)))]
  const both = /\bboth\b/i.test(text)
  const ask = both ? 'Which two charts should it go on?' : 'Which charts should it go on?'
  if (targets.length < 2 || !targets.every(t => charts.some(c => c.ref === t))) return ask
  if (both && targets.length !== 2) return ask
  // "all charts" = every chart here; "both" on a two-chart board is those two
  if (targets.length === charts.length) return null
  // otherwise the member must have named each one (its symbol or its position)
  const named = (c) => [c.symbol, c.position].filter(Boolean).some(w => new RegExp(`\\b${String(w).replace(/[^A-Za-z0-9]/g, '')}\\b`, 'i').test(text))
  return targets.every(t => named(charts.find(c => c.ref === t))) ? null : ask
}
/**
 * @returns `{ ops, ask?: {text, choices}, notes: string[] }` — ops possibly corrected; `ask` = do not
 *          plan anything, ask this instead (nothing changes).
 */
export function screenModelOps(host, ops, text, capCtx = {}) {
  const notes = []
  const words = String(text || '')
  let out = (ops || []).map(o => ({ ...o, args: o && o.args ? { ...o.args } : o?.args }))
  // F1 — a plain "build me an indicator" is built HERE (indicator.draft), not handed to the panel —
  // only for a member who CAN author (else the op is left alone and refused exactly as before)
  const canAuthor = capCtx.surface === 'charts' && capCtx.createIndicator === true
  out = out.map(o => {
    if (!canAuthor || o?.action !== 'indicator.openCreate' || o.args?.defId != null || PANEL_WORDS.test(words)) return o
    const chartRef = typeof o.target === 'string' && o.target.startsWith('ind:') ? o.target.slice(4) : null
    notes.push('Building it with you here in the chat (say “open Create Indicator” if you want the panel instead).')
    return { action: 'indicator.draft', target: NEW, args: { message: words.trim(), chart: chartRef, edit: null } }
  })
  // F2 — "save it as X" with an indicator draft open: never a silent layout save (and never the reverse)
  const usable = hasUsableDraft(host)
  const layoutSave = out.find(o => o?.action === 'layout.saveAs' || o?.action === 'layout.saveCurrent')
  const draftSave = out.find(o => o?.action === 'indicator.saveDraft')
  const explicitLayout = LAYOUT_WORDS.test(words)
  const explicitIndicator = INDICATOR_WORDS.test(words)
  if ((layoutSave && usable && !explicitLayout) || (draftSave && explicitLayout && !explicitIndicator)) {
    const name = (layoutSave && layoutSave.args && layoutSave.args.name) || (draftSave && draftSave.args && draftSave.args.name) || null
    return { ops: [], notes, ask: {
      text: 'Do you want to save the indicator you’re building, or this workspace as a layout?',
      choices: [{ label: name ? `Save the indicator draft as ${name}` : 'Save the indicator draft' },
        { label: name ? `Save this workspace as a new layout called ${name}` : 'Save this workspace layout' }],
    } }
  }
  // S6 nit — a NEW draft with no chart on a board of several: ask with the charts as choices (the
  // member's pick fills `chart`; nothing is sent to the builder until then)
  // ⛔ only for a member who CAN author: without access the op is left alone and refused, never asked about
  const unplaced = out.find(o => o?.action === 'indicator.draft' && o.target === NEW && o.args?.chart == null)
  if (canAuthor && unplaced && out.length === 1) {
    const charts = boardCharts(host)
    if (charts.length > 1) {
      return { ops: [], notes, ask: { text: 'Which chart is this indicator for?',
        choices: charts.map(c => ({ ref: c.ref, label: c.label })), pick: { ops: out, action: 'indicator.draft', arg: 'chart' } } }
    }
  }
  // F5 — "add it to both / all charts": the charts must be unambiguous before anything is proposed
  const adds = out.filter(o => o?.action === 'indicator.add')
  const many = /\b(both|all|every|each)\b[^.;!?]*\bcharts?\b/i.test(words)
  if (adds.length && many) {
    const why = multiChartAmbiguity(host, adds, words)
    if (why) return { ops: [], notes, ask: { text: why, choices: [] } }
  }
  // F3 — Save and "add to a chart" are separate intents: an unrequested chart add is dropped
  out = out.map(o => {
    if (o?.action !== 'indicator.saveDraft' || !Array.isArray(o.args?.addTo) || !o.args.addTo.length || asksToApply(words)) return o
    notes.push('Saving only — I won’t add it to a chart unless you ask.')
    return { ...o, args: { ...o.args, addTo: [] } }
  })
  return { ops: out, notes }
}

// ── what the member is told when the specialist refuses (every reason in §10/§16) ──
export function refusalSentence(res) {
  const r = res && res.reason
  const gate = res?.detail?.gate || ''
  switch (r) {
    case R.ACCESS: return 'Create Indicator isn’t available for your account.'
    case R.DRAFT_EXPIRED: return 'That draft has expired — drafts are kept only in this browser tab. Start a new one and I’ll pick it up from there.'
    case R.DRAFT_STALE: return 'That indicator was saved again elsewhere since this draft was opened, so I won’t change the old draft — reopen it to continue.'
    case R.DRAFT_OPEN_IN_DOCK: return 'That draft is open in Create Indicator — continue there, or close it and ask me again.'
    case R.STALE_REVISION: return 'The draft changed since I planned this, so I didn’t send anything — ask again to work on the current draft.'
    case R.STALE_STEP: return 'The draft changed since that step, so it can’t be undone exactly — nothing was undone.'
    case R.NOTHING_TO_UNDO: return 'There is no change to undo in that draft.'
    case R.NOT_DIRTY: return 'There is nothing new to save in that draft.'
    case R.NEEDS_ACK: return `Saving it needs your acknowledgement first: ${(res?.detail?.ackText || []).map(t => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ')} Ask me to save it again and approve that.`
    case R.VALIDATION: return `UCT refused to save it — it isn’t valid yet${res?.detail?.error ? `: ${res.detail.error}` : ''}.`
    case R.SAVE_CONFLICT: return `That indicator was saved elsewhere in the meantime${res?.detail?.conflict?.currentVersion ? ` (now version ${res.detail.conflict.currentVersion})` : ''} — nothing was overwritten.`
    case R.SAVE_REFUSED: return `UCT refused to save it${res?.detail?.error ? `: ${res.detail.error}` : ''}.`
    case R.SAVED_UNCONFIRMED: return 'It was sent to the store, but UCT could not read it back, so I am not reporting it as saved. The draft is closed — check your indicators before saving again.'
    case R.NAME_UNCHANGED: return 'It already has that name.'
    case R.NOTHING_TO_RENAME: return 'The draft has nothing to name yet — describe the indicator first.'
    case R.NOTHING_TO_PREVIEW: return 'The draft has nothing to preview yet.'
    case R.PREVIEW_READONLY: return 'That chart can’t show a preview.'
    case R.PREVIEW_BUSY: return 'Create Indicator is open and holds this tab’s preview — close it first.'
    case R.PREVIEW_INVALID: return 'The draft isn’t valid enough to draw yet.'
    case R.UNKNOWN_DEFINITION: return 'I don’t know that indicator on your account.'
    case R.TURN_REFUSED:
      if (/^rate:hour|^http:429/.test(gate)) return 'The indicator builder’s hourly limit is reached — nothing changed. Try again later.'
      if (gate === 'rate:busy') return 'The indicator builder is still working on another request — nothing changed. Try again in a moment.'
      if (gate === 'cost:user') return 'Today’s indicator-builder allowance is used up — nothing changed.'
      if (gate === 'cost:global') return 'The indicator builder is paused for today — nothing changed.'
      if (/^network|^http:/.test(gate)) return 'The indicator builder couldn’t be reached — nothing changed.'
      return `The indicator builder refused that${gate ? ` (${gate})` : ''} — nothing changed.`
    case R.BAD_REQUEST: return 'That isn’t a valid request for the indicator builder.'
    default: return 'That did not work — nothing changed.'
  }
}

const nameOf = (s) => (s?.status?.name ? `“${s.status.name}”` : 'the draft')

// ── ⛔ F6 — APPROVAL INTEGRITY. A Save is always proposed, and the proposal's Apply RE-PLANS. What
// the member approved is SEALED when the card is made (`sealSave`, kept by useAgent with the
// proposal — never in a cache that can lapse into a fresh read): the draft's identity and
// revision, the operation and requested name, the target definition, the exact acknowledgement,
// the builder's summary, the charts to add it to, and an expiry. Apply plans FROM the seal and
// refuses (`validateSaveSeal`) unless the draft is still exactly that — before any rename, turn,
// Save or chart add. Nothing is ever rebuilt from the draft as it is now. ──
export const PROPOSAL_TTL_MS = 10 * 60 * 1000
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
const sortedRefs = (xs) => [...new Set((xs || []).map(asChartRef))].sort()
/** The approval-critical facts of ONE planned Save (the indicatorDrafts plan's after-state). */
export function sealSave(snap, after, now = Date.now()) {
  const op = (after?.ops || []).find(o => o.type === 'save')
  if (!op || !snap?.draftRef || !snap.status) return null
  const turn = after.ops.find(o => o.type === 'turn')
  const s = snap.status
  return Object.freeze({
    action: 'indicator.saveDraft', ref: snap.ref,
    draft: { key: snap.draftRef.key, lineage: snap.draftRef.lineage },
    revision: op.pinRevision, name: op.name, turn: turn ? turn.message : null,
    target: { mode: s.mode, defId: s.defId ?? null, baseVersion: s.baseVersion ?? null },
    addTo: sortedRefs(op.addTo),
    ackShown: op.ackShown.slice(), linesShown: op.linesShown.slice(), nameShown: op.nameShown,
    issuedAt: now, expiresAt: now + PROPOSAL_TTL_MS,
  })
}
const STALE_SAVE = 'so nothing was saved or added to a chart — ask me to save it again and I’ll show you the current version.'
/** null when the draft is still EXACTLY what the member approved; else the refusal sentence. */
export function validateSaveSeal(seal, snap, req, now = Date.now()) {
  if (!seal || seal.action !== 'indicator.saveDraft') return `I can’t check that approval any more, ${STALE_SAVE}`
  if (!(now <= seal.expiresAt)) return `That proposal expired (a proposal is good for 10 minutes), ${STALE_SAVE}`
  const s = snap?.status
  if (!snap?.draftRef || !s || snap.ref !== seal.ref || snap.draftRef.key !== seal.draft.key || snap.draftRef.lineage !== seal.draft.lineage) return `That proposal was for a different draft, ${STALE_SAVE}`
  if (s.revision !== seal.revision) return `The draft changed since you approved it (revision ${seal.revision} → ${s.revision}), ${STALE_SAVE}`
  if (s.mode !== seal.target.mode || (s.defId ?? null) !== seal.target.defId || (s.baseVersion ?? null) !== seal.target.baseVersion) return `The indicator it would save to changed since you approved it, ${STALE_SAVE}`
  if ((req.name ?? null) !== seal.name || (req.turn ?? null) !== seal.turn) return `That isn’t the save you approved, ${STALE_SAVE}`
  if (!sameList(sortedRefs(req.addTo), seal.addTo)) return `The charts it would be added to changed since you approved it, ${STALE_SAVE}`
  if (!sameList(s.ackText, seal.ackShown)) return `The repainting warning changed since you approved it, ${STALE_SAVE}`
  if (!sameList(s.lines || [], seal.linesShown) || (s.name || null) !== seal.nameShown) return `The draft’s summary changed since you approved it, ${STALE_SAVE}`
  return null
}
const sealFor = (env, ref) => (Array.isArray(env?.approval) ? env.approval.find(x => x && x.ref === ref && x.action === 'indicator.saveDraft') : null) || null

// "Save it as Bullish Trend": a rename is trusted ONLY from the specialist's typed marker
// `renameOnly === true` (contract §16.1) — from `renameDraft`, or from `draftTurn`'s local
// name-only path. ⛔ NEVER from `changes` containing 'renamed': a model turn can rename AND change
// the maths while reporting only that (the specialist's own test proves it).
const fail = (msg, extra = {}) => Object.assign(new Error(msg), extra)

// ── target kind: one snapshot per draft in this tab, plus the "new draft" entry ──
function snapshots(host) {
  const ctx = authoringCtx(host)
  const act = readActive()
  const charts = (() => { try { return host?.charts?.list() || [] } catch { return [] } })().map(c => ({
    ref: c.ref, label: c.label,
    canPreview: (() => { try { return host.charts.canManageIndicators?.(c.ref) === true && host.charts.canCreateIndicator?.(c.ref) === true } catch { return false } })(),
    canAdd: (() => { try { return host.charts.canManageIndicators?.(c.ref) === true } catch { return false } })(),
  }))
  const list = (() => { try { return listDrafts(ctx) } catch { return [] } })()
  const out = [{ ref: NEW, label: 'New indicator draft', new: true, charts }]
  for (const st of list) {
    out.push({ ref: refOf(st.draftRef.key), label: st.name ? `Draft “${st.name}”` : 'Untitled draft', draftRef: st.draftRef, status: st,
      active: !!act && act.key === st.draftRef.key && act.lineage === st.draftRef.lineage, charts })
  }
  // the active draft the specialist no longer holds (expired, new tab): kept so it can be SAID
  if (act && !out.some(s => s.draftRef && s.draftRef.key === act.key && s.draftRef.lineage === act.lineage)) {
    const st = draftStatus(act, ctx)
    if (st && st.draftRef) out.push({ ref: refOf(act.key), label: st.name ? `Draft “${st.name}”` : 'Untitled draft', draftRef: st.draftRef, status: st, active: true, charts })
    else out.push({ ref: refOf(act.key), label: 'Your earlier draft', draftRef: act, expired: true, expiredReason: st?.reason || R.DRAFT_EXPIRED, active: true, charts })
  }
  return out
}

export const indicatorDraftsKind = {
  name: 'indicatorDrafts',
  boardScoped: false,        // a draft lives in this tab, not on a board (survives layout switches)
  selfDescribing: true,
  list: (host) => snapshots(host),
  read: (host, ref) => snapshots(host).find(s => s.ref === ref) || null,
  stateOf: (s) => ({ ...s, ops: [] }),
  patch: (before, after) => (after.ops.length ? { ops: after.ops } : null),
  async commit(host, ref, patch) {
    // ── authoring Undo (from the Agent's Undo stack): the exact step, or refused ──
    if (patch.undo) {
      const st0 = draftStatus(patch.undo.draftRef, authoringCtx(host))
      const ctx = authoringCtx(host, originOf(st0))
      const st = st0
      const out = draftUndo(patch.undo.draftRef, { expectedStepId: patch.undo.stepId }, ctx)
      if (!out.ok) throw fail(refusalSentence(out))
      return { lines: [`Undid the last change to ${st?.name ? `“${st.name}”` : 'the draft'} (draft — not saved).`, ...(out.lines || [])] }
    }
    const snap = snapshots(host).find(s => s.ref === ref)
    if (!snap) throw fail('that draft is no longer available')
    // ⛔ F6: an approved Save is re-checked against its seal HERE, before the first op runs (a
    // rename turn in the same request included) — the planner's check ran a moment ago, this is the
    // last word before anything is written
    const sealedSave = patch.ops.find(o => o.type === 'save' && o.seal)
    if (sealedSave) {
      const t = patch.ops.find(o => o.type === 'turn')
      const why = validateSaveSeal(sealedSave.seal, snap, { name: sealedSave.name, turn: t ? t.message : null, addTo: sealedSave.addTo })
      if (why) throw fail(why)
    }
    let draftRef = snap.draftRef || null
    let revision = snap.status ? snap.status.revision : null
    let name = snap.status?.name || null
    const lines = []
    let undoData = null
    const followUps = []
    for (const op of patch.ops) {
      if (op.type === 'turn') {
        if (!op.chartRef || !boardCharts(host).some(c => c.ref === op.chartRef)) throw fail('That chart is no longer on the board, so nothing was sent — say which chart this indicator is for.')
        const ctx = authoringCtx(host, op.chartRef)
        const opened = !draftRef
        if (!draftRef) {
          const o = openDraft(op.edit ? { edit: { defId: op.edit }, chartRef: op.chartRef } : { create: true, chartRef: op.chartRef }, ctx)
          if (!o.ok) throw fail(refusalSentence(o))
          draftRef = o.draftRef
          revision = o.status.revision
          name = o.status.name || name
        }
        setActive(draftRef)
        const out = await draftTurn(draftRef, op.message, { expectedRevision: op.pinRevision ?? revision }, ctx)
        if (!out.ok) throw fail(refusalSentence(out), lines.length ? { unreverted: true } : {})
        revision = out.revision
        op.outcome = out.kind
        op.renameOnly = out.ok && out.kind === 'applied' && out.renameOnly === true
        const st = draftStatus(draftRef, authoringCtx(host))
        name = st?.name || name
        if (out.kind === 'applied') {
          // a draft this request opened was STARTED, not updated (S6 wording nit)
          lines.push(`${opened ? 'Started' : 'Updated'} ${name ? `“${name}”` : 'the draft'} (draft — not saved).`, ...(out.lines || []))
          undoData = { draftRef, stepId: out.stepId }
        } else if (out.kind === 'question') {
          lines.push(...(out.reply ? [out.reply] : []), ...(out.questions || []), 'No change was made to the draft.')
        } else {
          lines.push(...(out.reply ? [out.reply] : out.lines || []), 'No change was made to the draft.')
        }
      } else if (op.type === 'preview') {
        const ctx = authoringCtx(host, op.chartRef)
        const ph = host?.charts?.previewHost?.(op.chartRef) || null
        if (!ph) throw fail('that chart can’t show a preview')
        const out = showDraftPreview(draftRef, { host: ph, chartRef: op.chartRef }, ctx)
        if (!out.ok) throw fail(refusalSentence(out))
        setActive(draftRef)
        // movedFrom is the preview channel's chart id (a widget id); Agent refs are `<id>` / `<id>~<tab>`
        const label = (c) => {
          try {
            const all = host.charts.list() || []
            return (all.find(x => x.ref === c) || all.find(x => String(x.ref).split('~')[0] === c))?.label || 'another chart'
          } catch { return 'another chart' }
        }
        lines.push(`Showing ${name ? `“${name}”` : 'the draft'} as a preview on ${label(op.chartRef)} — a preview only, not saved${out.movedFrom ? ` (moved from ${label(out.movedFrom)})` : ''}.`)
      } else if (op.type === 'save') {
        const ctx = authoringCtx(host, originOf(draftStatus(draftRef, authoringCtx(host))))
        const st = draftStatus(draftRef, ctx)
        const keep = lines.length ? { unreverted: true } : {}
        const turn = patch.ops.find(o => o.type === 'turn')
        let renamedTo = null
        // a refusal AFTER a rename landed (dock opened, access lost, conflict…) says so plainly
        const notSaved = (m) => (renamedTo || (turn && turn.outcome === 'applied')
          ? fail(`Renamed it to “${renamedTo || (st && st.name) || name || 'the new name'}” (draft — not saved), but didn’t save it: ${m}`, keep)
          : fail(m, keep))
        if (!st || !st.draftRef) throw notSaved(refusalSentence(st))
        let pin = op.pinRevision
        if (turn) {
          // the two-op form ("Name it X" turn, then Save): only the typed rename-only marker counts
          if (turn.outcome !== 'applied') throw fail('The builder didn’t rename it, so I didn’t save it — say the name again, then ask me to save.', keep)
          if (st.revision !== op.pinRevision + 1) throw notSaved(refusalSentence({ reason: R.STALE_REVISION }))
          if (turn.renameOnly !== true) throw notSaved('that wasn’t only a rename — check the draft, then ask me to save it again.')
          pin = st.revision
        } else if (op.name) {
          // "Save it as X": the specialist's own name-only step (no model call), pinned to the approved revision
          const r = renameDraft(draftRef, op.name, { expectedRevision: pin }, ctx)
          if (!r.ok && r.reason !== R.NAME_UNCHANGED) throw fail(`${refusalSentence(r)} Nothing was renamed or saved.`, keep)
          if (r.ok) {
            if (r.renameOnly !== true || r.revision !== pin + 1) throw fail('That wasn’t a rename only, so I didn’t save it — check the draft, then ask me to save it again.', keep)
            renamedTo = (r.rename && r.rename.to) || op.name
            lines.push(`Renamed it to “${renamedTo}” (draft).`)
            pin = r.revision
          }
        }
        const now = renamedTo ? draftStatus(draftRef, ctx) : st
        if (!now || !now.draftRef) throw notSaved(refusalSentence(now))
        // ⛔ acknowledged only if the approval showed EXACTLY the acknowledgement the draft needs now
        const shown = op.ackShown || []
        const ackNow = now === st ? st.ackText : now.ackText
        const acknowledged = !ackNow.length || (ackNow.length === shown.length && ackNow.every((t, i) => t === shown[i]))
        if (!acknowledged) throw notSaved(refusalSentence({ reason: R.NEEDS_ACK, detail: { ackText: ackNow } }))
        const out = await saveDraft(draftRef, { expectedRevision: pin, acknowledged: ackNow.length > 0 }, ctx)
        if (!out.ok) {
          if (out.reason === R.SAVED_UNCONFIRMED) setActive(null)
          throw notSaved(refusalSentence(out))
        }
        setActive(null)
        rememberSaved({ defId: out.defId, version: out.version, name: out.name || name || null })
        lines.push(`Saved “${out.name || name || 'the indicator'}” (version ${out.version}${out.created ? ', a new indicator' : ''}) — confirmed by reading it back from your saved indicators.`)
        // the specialist's own receipt + outcomes, once each — but NOT its chart outcome: Save never
        // attaches a chart here (§16), so "no chart is open here" would contradict the adds below
        const chartTexts = new Set((out.outcomes || []).filter(o => o && o.kind === 'chart').map(o => o.text))
        for (const t of [...(out.receipt?.items || []), ...(out.outcomes || []).map(o => o && o.text)]) {
          if (t && !chartTexts.has(t) && !lines.includes(t)) lines.push(t)
        }
        if (!op.addTo?.length) lines.push('It is not on a chart — ask me to add it to one.')
        for (const c of op.addTo || []) followUps.push({ action: 'indicator.add', target: `ixe:${c}`, args: { defId: out.defId }, awaitDefinition: { defId: out.defId, version: out.version, name: out.name || name || null } })
        if (op.addTo?.length) lines.push(`Next: adding it to ${op.addTo.length === 1 ? 'the chart' : `${op.addTo.length} charts`} — each gets its own receipt.`)
        undoData = null
      }
    }
    return { lines, ...(undoData ? { undoData } : {}), ...(followUps.length ? { followUps } : {}) }
  },
  landed: () => true,
  // ⛔ F6: what an approval of this plan binds to (useAgent keeps it with the proposal card)
  seal: (p) => sealSave(p.snap, p.after),
  // Authoring Undo = the specialist's exact step (stepId); a Save has none (D7); advice/questions none.
  undoPatch: (item) => (item.undoData ? { undo: item.undoData } : null),
  // staleness is the specialist's (expectedRevision / expectedStepId at call time)
  fingerprint: (s) => (s ? s.ref : 'gone'),     // a saved draft is gone (read → null)
}

const common = { target: 'indicatorDrafts', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' && ctx.createIndicator === true }
function usable(st) {
  if (st.expired) return refusalSentence({ reason: st.expiredReason || R.DRAFT_EXPIRED })
  if (st.status?.openInDock) return refusalSentence({ reason: R.DRAFT_OPEN_IN_DOCK })
  return null
}
const has = (st, type) => st.ops.some(o => o.type === type)

let registered = false
export function registerIndicatorAuthoringCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(indicatorDraftsKind)
  registerContextProvider({
    key: 'indicatorDrafts',
    // every item publishes its `ref` (the server accepts only published refs as targets)
    build: (host, refFor) => {
      const list = indicatorDraftsKind.list(host)
      let own = []
      try { own = (sources.rows() || []).slice(0, 50).map(r => ({ defId: r.def_id, name: r.definition?.meta?.name || null })) } catch { own = [] }
      const last = lastSaved()
      const chartLabel = (r) => (s0) => (s0.charts || []).find(c => c.ref === r)?.label || null
      return list.map(s => (s.new ? { ref: refFor('indicatorDrafts', s.ref), new: true, label: 'start a NEW indicator draft (or edit one of yourIndicators)', yourIndicators: own, ...(last ? { lastSaved: last } : {}) }
        : { ref: refFor('indicatorDrafts', s.ref), name: s.status?.name || null, mode: s.status?.mode || null, active: !!s.active,
          chart: originOf(s.status) ? chartLabel(originOf(s.status))(s) || 'not on this board' : null,
          ...(s.expired ? { expired: true } : {
            revision: s.status.revision, dirty: s.status.dirty, canSave: s.status.canSave, canUndo: s.status.canUndo,
            needsAcknowledgement: s.status.ackText.length > 0, openQuestions: s.status.questions, openInCreateIndicator: s.status.openInDock,
            summary: (s.status.lines || []).slice(0, 6),
          }) }))
    },
    compact: (sec) => (sec || []).map(e => ({ ref: e.ref, name: e.name || null, new: e.new || undefined, active: e.active || undefined })),
  })

  registerCapability({
    ...common,
    name: 'indicator.draft',
    exclusive: true,
    exclusiveReason: 'Work on one indicator draft at a time, on its own — ask for anything else separately.',
    summary: 'THE DEFAULT for building a custom indicator: build it WITH the member right here in this chat ("build/make me an indicator that…", "also require RSI above 50", "what would you add?") — one draft, through Create Indicator\'s own engine. Questions and advice change nothing. Never saves (indicator.saveDraft does).',
    hints: 'target = the ACTIVE draft\'s ref to continue it (follow-ups like "also…", "make it…", "what would you add?" go to the active draft); the NEW-draft entry only when the member starts a different indicator or edits one of yourIndicators (edit = its defId, else null). With an active draft, "this indicator" / "the indicator" / "it" means that draft — do not ask which. If several drafts could be meant and none is active or named, ask which. chart = the ref of the chart the member names for it, else null (a draft keeps its own chart). message = the member\'s words, verbatim — never your own formula or interpretation.',
    argRefs: { chart: ['chart', 'indicators', 'indicatorEdits'] },
    args: { type: 'object', properties: { message: { type: 'string' }, chart: { type: ['string', 'null'] }, edit: { type: ['string', 'null'] } }, required: ['message', 'chart', 'edit'], additionalProperties: false },
    check(st, { message, chart, edit }) {
      if (!String(message || '').trim()) return 'Say what the indicator should do.'
      if (!st.new) { const u = usable(st); if (u) return u }
      if (edit != null) {
        if (!st.new) return 'To edit one of your saved indicators, start from the new-draft entry.'
        let own = []
        try { own = (sources.rows() || []).map(r => r && r.def_id) } catch { own = [] }
        if (!own.includes(edit)) return refusalSentence({ reason: R.UNKNOWN_DEFINITION })
      }
      const c = chartForDraft(st, chart ?? null)
      if (c.ask) return c.ask
      if (has(st, 'turn')) return 'One message to the indicator builder at a time.'
      if (has(st, 'save') || has(st, 'preview')) return 'Ask for the change first, then preview or save it.'
      return null
    },
    apply(st, { message, chart, edit }) {
      const c = chartForDraft(st, chart ?? null)
      return { ...st, ops: [...st.ops, { type: 'turn', message: String(message).trim(), chartRef: c.ref, edit: edit || null, pinRevision: st.status ? st.status.revision : null }] }
    },
    describe: (b, a) => {
      const op = a.ops.find(o => o.type === 'turn')
      const where = (b.charts || []).find(c => c.ref === op?.chartRef)?.label
      return op ? `Ask the indicator builder${b.new ? (op.edit ? ' (editing your saved indicator)' : ' (new draft)') : ` about ${nameOf(b)}`}${where ? ` on ${where}` : ''}: “${op.message}”` : null
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.previewDraft',
    undo: 'none',
    exclusive: true,
    exclusiveReason: 'Show the preview on its own — ask for anything else separately.',
    argRefs: { chart: ['chart', 'indicators', 'indicatorEdits'] },
    summary: 'Show an indicator draft as this tab\'s ONE live preview on a chart (not saved; moves off any other chart). Only when the member asks to see it.',
    hints: 'target = the draft\'s ref (usually the active one). chart = the ref of the chart to preview on — the one the member names, or the only chart; if several charts and none named, ask which. Never preview unasked.',
    args: { type: 'object', properties: { chart: { type: 'string' } }, required: ['chart'], additionalProperties: false },
    check(st, { chart }) {
      if (st.new) return 'There is no draft to preview yet — describe the indicator first.'
      const u = usable(st); if (u) return u
      const c = st.charts.find(x => x.ref === asChartRef(chart))
      if (!c) return 'Which chart should I show the preview on?'
      if (!c.canPreview) return `${c.label} can’t show a preview.`
      if (st.ops.length) return 'Show the preview on its own.'
      return null
    },
    apply: (st, { chart }) => ({ ...st, ops: [{ type: 'preview', chartRef: asChartRef(chart) }] }),
    describe: (b, a) => {
      const op = a.ops[0]
      const c = b.charts.find(x => x.ref === op?.chartRef)
      return op ? `Show ${nameOf(b)} as a preview on ${c ? c.label : 'the chart'} (not saved)` : null
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.saveDraft',
    risk: 'confirm',             // always proposed: the member approves the exact draft and revision
    undo: 'none',                // a saved version is permanent history (D7)
    reversible: false,
    exclusive: true,
    exclusiveReason: 'Save the indicator on its own — ask for anything else separately.',
    argRefs: { addTo: ['chart', 'indicators', 'indicatorEdits'] },
    summary: 'Save an indicator draft as one of the member\'s indicators (Create Indicator\'s own Save; a new indicator, or a new version of the one being edited) — always shown as a proposal with the builder\'s own summary first. addTo: charts to add the SAVED indicator to afterwards (each added separately, with its own receipt).',
    hints: 'Use when the member saves THE INDICATOR: "save it", "save it as X", "save the indicator/draft" while an indicator draft is active (the active indicatorDrafts entry) — that "it" is the draft, NOT the workspace layout (layout.saveAs is only for an explicit layout/workspace/board). target = the draft\'s ref (usually the active one). name = the name the member gave ("save it as Bullish Trend" → "Bullish Trend"), else null — never a separate indicator.draft op for the name. addTo = [] UNLESS the member asked in this message to add/apply/put it on a chart; then only the charts\' refs from the charts section that they named. Saving and adding to a chart are separate intents. "Save the indicator" with one active draft is that draft — do not ask which.',
    args: { type: 'object', properties: { addTo: { type: 'array', items: { type: 'string' } }, name: { type: ['string', 'null'] } }, required: ['addTo', 'name'], additionalProperties: false },
    check(st, { addTo, name }, env) {
      if (st.new) return 'There is no draft to save yet — describe the indicator first.'
      if (name != null && (typeof name !== 'string' || !name.trim() || name.length > 120)) return 'Say the name to save it as.'
      if (name != null && has(st, 'turn')) return 'Name it in the save itself, not as a separate change.'
      const u = usable(st); if (u) return u
      if (has(st, 'save')) return 'One save at a time.'
      if (!has(st, 'turn') && !st.status.canSave) return refusalSentence({ reason: R.NOT_DIRTY })
      for (const r of addTo || []) {
        const c = st.charts.find(x => x.ref === asChartRef(r))
        if (!c) return 'That isn’t a chart on this board, so nothing was saved or added — name the chart (or just say “save it”).'
        if (!c.canAdd) return `Indicators on ${c.label} can’t be changed from here.`
      }
      // ⛔ F6: an APPROVAL is only of what the card showed — checked before anything is planned
      if (env?.approved) {
        const turn = st.ops.find(o => o.type === 'turn')
        const nm = typeof name === 'string' && name.trim() ? name.trim() : null
        return validateSaveSeal(sealFor(env, st.ref), st, { name: nm, turn: turn ? turn.message : null, addTo })
      }
      return null
    },
    apply(st, { addTo, name }, env) {
      const add = [...new Set((addTo || []).map(asChartRef))]
      const nm = typeof name === 'string' && name.trim() ? name.trim() : null
      // approved: EXACTLY the sealed values (check() proved the draft still matches them);
      // proposing: the draft as it is now, which is what the card will show and the seal will keep
      const seal = env?.approved ? sealFor(env, st.ref) : null
      const s = st.status
      const pin = seal
        ? { revision: seal.revision, ackShown: seal.ackShown.slice(), lines: seal.linesShown.slice(), name: seal.nameShown }
        : { revision: s.revision, ackShown: s.ackText.slice(), lines: (s.lines || []).slice(), name: s.name || null }
      // a rename in the same request is pinned to the revision the member saw, too
      const ops = st.ops.map(o => (o.type === 'turn' ? { ...o, pinRevision: pin.revision } : o))
      return { ...st, ops: [...ops, { type: 'save', addTo: add, name: nm, pinRevision: pin.revision, ackShown: pin.ackShown, linesShown: pin.lines, nameShown: pin.name, ...(seal ? { seal } : {}) }] }
    },
    describe: (b, a) => {
      const op = a.ops.find(o => o.type === 'save')
      if (!op) return null
      const s = b.status
      const turn = a.ops.find(o => o.type === 'turn')
      const what = s.mode === 'edit' ? `a new version of ${nameOf(b)}` : `${nameOf(b)} as a new indicator`
      const after = op.addTo.length ? ` — then add it to ${op.addTo.map(r => b.charts.find(c => c.ref === r)?.label || r).join(', ')}, each separately` : ''
      const summary = op.linesShown.length ? ` · The builder's summary: ${op.linesShown.join(' / ')}` : ''
      const ack = op.ackShown.length ? ` · You are also acknowledging: ${op.ackShown.join(' ')}` : ''
      const as = op.name ? ` as “${op.name}” (renamed first — a name-only step)` : ''
      return `Save ${what}${as} (draft revision ${op.pinRevision}${turn ? ', after that rename only' : ''})${after}${summary}${ack}`
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.undoDraft',
    undo: 'none',
    exclusive: true,
    summary: 'Undo the last change in an indicator draft, exactly, when there is nothing of mine to Undo (e.g. after a reload). Never touches a chart or a saved indicator.',
    hints: 'target = the draft\'s ref. Only for "undo the last change to my draft" when the normal Undo has nothing.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check(st) {
      if (st.new) return 'There is no draft to undo.'
      const u = usable(st); if (u) return u
      if (!st.status.canUndo || !st.status.undoStepId) return refusalSentence({ reason: R.NOTHING_TO_UNDO })
      return null
    },
    apply: (st) => ({ ...st, ops: [{ type: 'undoStep', stepId: st.status.undoStepId }] }),
    describe: (b) => `Undo the last change to ${nameOf(b)}`,
  })
}

// `undoStep` (indicator.undoDraft) is the same exact Undo as the stack's: route it through commit.
const _commit = indicatorDraftsKind.commit
indicatorDraftsKind.commit = async function commit(host, ref, patch) {
  const step = patch?.ops?.find?.(o => o.type === 'undoStep')
  if (step) {
    const snap = snapshots(host).find(s => s.ref === ref)
    if (!snap?.draftRef) throw fail('that draft is no longer available')
    const res = await _commit.call(this, host, ref, { undo: { draftRef: snap.draftRef, stepId: step.stepId } })
    setActive(snap.draftRef)
    return res
  }
  return _commit.call(this, host, ref, patch)
}

export { AUTHORING_CONTRACT }
