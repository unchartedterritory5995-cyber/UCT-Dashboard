// app/src/components/chart/builder/agentAuthoring.js
//
// ─── ⭐ AGENT MILESTONE 3 — THE INDICATORS-OWNED CONVERSATIONAL AUTHORING INTERFACE ──────
//
// `docs/indicators/AGENT-M3-CONTRACT.md` §3.2 / §15 (contract `uct.indicators.authoring/1`).
// UCT Agent owns the member-facing conversation; Indicator Intelligence owns the draft:
// its lineage, revision, history, Undo, the model call, validation, Save and read-back.
// The Agent receives an opaque `draftRef` and typed outcomes — never the tree, never a
// formula, never a revision of its own — and never reconstructs an indicator from chat.
//
// ⛔ ONE PIPELINE, ONE STORE. Every turn, Undo and Save runs `authoring/authoringSession.js`
// (the same code the Create Indicator dock runs) over the conversation kept in
// `authoring/conversationSessions.js` (the dock's own per-tab store, D2). Nothing here
// holds state between calls: each call reads the session, acts, and writes it back.
//
// ⛔ EVERY WRITE IS CHECKED AT CALL TIME: Create Indicator access (fresh `ctx.canAuthor`),
// definition ownership (`ctx.definitionRows`), the dock-ownership rule (D6), the draft's
// lineage, its revision (`expectedRevision`) or history step (`expectedStepId`). The model
// call keeps every server gate (paid, access, the hourly window, the daily allowance).

import { readback, isDirty } from './authoring'
import { newAuthoringState } from './authoring/authoringState'
import { converseTurn, transcriptSnippets } from './authoring/converseClient'
import {
  readSession, writeSession, clearSession, createKey, editKey, mintScope, sessionKeys, isHeldInDock,
} from './authoring/conversationSessions'
import {
  restoreConversation, initialConversationState, initialTranscript, hasSomethingToKeep,
  localTurn, modelTurn, renameTurn, undoTurn, saveConversation, noteDiscarded, previewDefinitionOf,
} from './authoring/authoringSession'
import { withPendingInputs } from './studio/editPreview'

export const AUTHORING_CONTRACT = 'uct.indicators.authoring/1'

/** Every refusal this interface returns. Stable strings. Server / engine gates pass through
 *  in `detail.gate` (e.g. `rate:busy`, `cost:user`, `http:429`, `envelope:revision`). */
export const AUTHORING_REASONS = Object.freeze({
  BAD_REQUEST: 'bad-request',
  ACCESS: 'access',                         // no Create Indicator access (fresh ctx.canAuthor)
  UNKNOWN_DEFINITION: 'unknown-definition', // edit of a definition that is not the member's
  DRAFT_EXPIRED: 'draft-expired',           // the tab's store no longer holds this draft
  DRAFT_STALE: 'draft-stale',               // an edit draft whose saved definition moved on
  DRAFT_OPEN_IN_DOCK: 'draft-open-in-dock', // D6: an open dock owns it
  STALE_REVISION: 'stale-revision',
  STALE_STEP: 'stale-step',
  NOTHING_TO_UNDO: 'nothing-to-undo',
  NOT_DIRTY: 'not-dirty',
  NEEDS_ACK: 'needs-ack',
  VALIDATION: 'validation',
  SAVE_CONFLICT: 'save-conflict',
  SAVE_REFUSED: 'save-refused',
  SAVED_UNCONFIRMED: 'saved-unconfirmed',
  TURN_REFUSED: 'turn-refused',             // the server or the engine refused the turn (detail)
  NOTHING_TO_PREVIEW: 'nothing-to-preview', // the draft has no working definition yet
  PREVIEW_READONLY: 'readonly',             // that chart cannot show a preview
  PREVIEW_BUSY: 'busy',                     // a Create Indicator dock holds the tab's preview
  PREVIEW_INVALID: 'invalid',               // the registry refused the working definition
  NAME_UNCHANGED: 'name-unchanged',         // renameDraft: the draft already has that name
  NOTHING_TO_RENAME: 'nothing-to-rename',   // renameDraft: the draft has no definition yet
})
const R = AUTHORING_REASONS

const refuse = (reason, detail) => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail })
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const KEY_RE = /^(create|edit):[A-Za-z0-9_:.-]{1,80}$/
const nextId = (transcript) => transcript.length
const append = (transcript, entries) => {
  let t = transcript
  for (const e of entries) t = [...t, { id: nextId(t), ...e }]
  return t
}
const rowsOf = (ctx) => (Array.isArray(ctx && ctx.definitionRows) ? ctx.definitionRows : [])
const rowFor = (ctx, defId) => rowsOf(ctx).find((r) => r && r.def_id === defId) || null
const openOf = (row) => (row ? { def: row.definition, defId: row.def_id, version: row.version } : null)
const gateCtxOf = (ctx) => ({ tf: (ctx && ctx.tf) || null, symbol: (ctx && ctx.sym) || null })

/** `<lineage>:r<revision it produced>` — the history step an applied turn created (§15.1). */
const stepIdOf = (lineage, producedRevision) => `${lineage}:r${producedRevision}`
const undoStepIdOf = (state) => (state.history.length
  ? stepIdOf(state.lineage, state.history[state.history.length - 1].revision + 1) : null)

function draftRefOf(key, state) {
  return Object.freeze({ contract: AUTHORING_CONTRACT, key, lineage: state.lineage })
}

/** The repaint acknowledgement sentences a Save needs approved, verbatim (§15.4). */
function ackTextOf(rb) {
  const keys = rb.needsAck || []
  if (!keys.length) return []
  return (rb.lines || []).filter((l) => /confirm below before saving$/.test(l))
}

function statusOf(key, snap, ctx = {}) {
  const st = snap.state
  const rb = readback(st.working, st, gateCtxOf(ctx))
  const editing = !!(st.defId && Number.isInteger(st.baseVersion))
  const dirty = isDirty(st)
  const needsAck = rb.needsAck || []
  const ackText = ackTextOf(rb)
  return Object.freeze({
    draftRef: draftRefOf(key, st),
    mode: editing ? 'edit' : 'create',
    defId: st.defId || null,
    baseVersion: Number.isInteger(st.baseVersion) ? st.baseVersion : null,
    revision: st.revision,
    name: (st.working && st.working.meta && st.working.meta.name) || null,
    dirty,
    canUndo: st.history.length > 0,
    undoStepId: undoStepIdOf(st),
    canSave: !!st.working && dirty,
    needsAck: needsAck.slice(),
    ackText,
    questions: (st.questions || []).map((q) => q.text),
    readback: rb,
    lines: rb.lines.slice(),
    recovered: !!snap.recovered,
    openInDock: isHeldInDock(key),
    origin: (snap.meta && snap.meta.origin) || 'dock',
  })
}

/** Resolve a draftRef to its live session, or a refusal. Read-only. */
function resolve(draftRef, ctx = {}) {
  if (!isObj(draftRef) || draftRef.contract !== AUTHORING_CONTRACT || typeof draftRef.key !== 'string'
    || !KEY_RE.test(draftRef.key) || typeof draftRef.lineage !== 'string') return refuse(R.BAD_REQUEST)
  const snap = readSession(draftRef.key)
  if (!snap || !snap.state || snap.state.lineage !== draftRef.lineage) {
    if (previewing && previewing.key === draftRef.key && previewing.lineage === draftRef.lineage) dropPreview(draftRef.key)
    return refuse(R.DRAFT_EXPIRED)
  }
  const st = snap.state
  if (st.defId && Number.isInteger(st.baseVersion)) {
    const row = rowFor(ctx, st.defId)
    if (!row) return refuse(R.UNKNOWN_DEFINITION)
    if (row.version !== st.baseVersion) return refuse(R.DRAFT_STALE, { baseVersion: st.baseVersion, currentVersion: row.version })
  }
  return { ok: true, key: draftRef.key, snap }
}

/** The checks every WRITE makes, in order, at call time. */
function writable(draftRef, ctx) {
  if (!ctx || ctx.canAuthor !== true) return refuse(R.ACCESS)
  const r = resolve(draftRef, ctx)
  if (!r.ok) return r
  if (isHeldInDock(r.key)) return refuse(R.DRAFT_OPEN_IN_DOCK)
  return r
}

function keep(key, snap) {
  if (hasSomethingToKeep({ state: snap.state, transcript: snap.transcript })) writeSession(key, snap, { persist: true })
  else writeSession(key, snap)
}

// ─── the draft preview (S3): which draft the Agent is previewing, on which chart host ─────
// One per tab (the preview channel enforces it); refreshed after every applied change and
// Undo of THAT draft; taken down on Save, Discard and expiry.
let previewing = null // { key, lineage, host, chartRef }

function previewOptsOf(state) {
  const editing = !!(state.defId && Number.isInteger(state.baseVersion))
  return { ...(editing ? { replaces: state.defId, base: state.base || null, shapeEdit: withPendingInputs } : {}),
    calcTf: (state.requests && state.requests.calculationTimeframe) || null }
}
function dropPreview(key) {
  if (!previewing || previewing.key !== key) return false
  const p = previewing
  previewing = null
  try { p.host.clearAuthoringPreview() } catch { /* the chart is gone */ }
  return true
}
/** After a change or Undo of `key`'s draft: redraw the preview it has (if any). */
function refreshPreview(key, state) {
  if (!previewing || previewing.key !== key) return null
  const def = previewDefinitionOf(state)
  if (!def) { dropPreview(key); return { refreshed: false, cleared: true } }
  let res
  try { res = previewing.host.showAuthoringPreview(def, previewOptsOf(state)) } catch { res = { ok: false } }
  if (!res || !res.ok) { previewing = null; return { refreshed: false, cleared: true } }
  return { refreshed: true, chartRef: previewing.chartRef }
}

// ─── open / status / list ────────────────────────────────────────────────────

/**
 * Open a draft to author: a NEW one (`{create: true, chartRef?}`) or an EDIT of one of the
 * member's own saved definitions (`{edit: {defId}}`). An edit is keyed `editKey(defId)` — the
 * SAME draft the dock's Modify opens; an existing, current one is resumed, a stale one is
 * dropped and reopened from the stored version.
 * @param ctx `{canAuthor, definitionRows, sym, tf}`
 * @returns `{ok:true, draftRef, status}` | refusal
 */
export function openDraft(request, ctx) {
  if (!ctx || ctx.canAuthor !== true) return refuse(R.ACCESS)
  const req = isObj(request) ? request : {}
  if (req.create === true) {
    const key = createKey(mintScope())
    const state = newAuthoringState()
    const snap = { state, transcript: [], acked: false,
      meta: { origin: 'agent', ...(typeof req.chartRef === 'string' ? { chartRef: req.chartRef } : {}) } }
    writeSession(key, snap)
    return { ok: true, draftRef: draftRefOf(key, state), status: statusOf(key, snap, ctx) }
  }
  if (isObj(req.edit) && typeof req.edit.defId === 'string') {
    const row = rowFor(ctx, req.edit.defId)
    if (!row || !isObj(row.definition) || !Number.isInteger(row.version)) return refuse(R.UNKNOWN_DEFINITION)
    const key = editKey(row.def_id)
    const open = openOf(row)
    if (isHeldInDock(key)) {
      const held = readSession(key)
      if (held && held.state) return { ok: true, draftRef: draftRefOf(key, held.state), status: statusOf(key, held, ctx) }
      return refuse(R.DRAFT_OPEN_IN_DOCK)
    }
    const { initial } = restoreConversation(key, open)
    const snap = initial
      ? { ...initial, meta: initial.meta || { origin: 'dock' } }
      : { state: initialConversationState(null, open), transcript: initialTranscript(null, open), acked: false, meta: { origin: 'agent' } }
    if (!initial) writeSession(key, snap)
    return { ok: true, draftRef: draftRefOf(key, snap.state), status: statusOf(key, snap, ctx) }
  }
  return refuse(R.BAD_REQUEST)
}

/** The draft as it is now. @returns DraftStatus | refusal (`draft-expired`, `draft-stale`, …) */
export function draftStatus(draftRef, ctx = {}) {
  const r = resolve(draftRef, ctx)
  return r.ok ? statusOf(r.key, r.snap, ctx) : r
}

/** Every authoring draft this member has open in this tab (create and edit; never another
 *  surface's), newest first. An edit draft is listed only for the member's own definition. */
export function listDrafts(ctx = {}) {
  const out = []
  for (const key of sessionKeys()) {
    if (!KEY_RE.test(key)) continue
    const snap = readSession(key)
    if (!snap || !snap.state) continue
    const st = snap.state
    if (st.defId && !rowFor(ctx, st.defId)) continue
    if (!st.working && !(snap.transcript && snap.transcript.length) && !(snap.meta && snap.meta.origin === 'agent')) continue
    out.push(statusOf(key, snap, ctx))
  }
  return out.reverse()
}

// ─── turn / undo / discard ───────────────────────────────────────────────────

function outcomeOf(out, snapBefore, snapAfter) {
  const st = snapAfter.state
  const entry = out.entries[out.entries.length - 1] || {}
  const kind = entry.kind
  const rb = readback(st.working, st, {})
  const base = { revision: st.revision, lines: entry.lines ? entry.lines.slice() : [], readback: rb }
  if (out.ok && out.changed) {
    return { ok: true, kind: 'applied', ...base, stepId: stepIdOf(st.lineage, st.revision), reply: null, questions: [],
      changes: (out.changes || []).map((c) => ({ ...c })),
      // ⭐ M3 typed rename — ONLY the deterministic name-only path sets these (`renameTurn`);
      // a model-applied turn never does, even when its changes include a 'renamed' entry
      ...(out.renameOnly ? { renameOnly: true, rename: out.rename ? { ...out.rename } : null } : {}) }
  }
  if (out.ok && kind === 'question') return { ok: true, kind: 'question', ...base, reply: entry.reply || null, questions: (st.questions || []).map((q) => q.text), changes: [] }
  if (out.ok && kind === 'answer') return { ok: true, kind: 'answer', ...base, reply: entry.reply || null, questions: [], changes: [] }
  if (kind === 'unsupported') {
    return { ok: true, kind: 'unsupported', ...base, reply: entry.lines ? entry.lines[0] : null, questions: [], changes: [],
      ...(entry.gate ? { gate: entry.gate } : {}), ...(entry.preflight ? { preflight: true } : {}) }
  }
  return { ok: false, reason: R.TURN_REFUSED, revision: snapBefore.state.revision, lines: base.lines,
    detail: { ...(out.gate ? { gate: out.gate } : {}), ...(entry.gate && !out.gate ? { gate: entry.gate } : {}),
      ...(entry.codes ? { codes: entry.codes.slice() } : {}) } }
}

/**
 * Continue a draft with one conversational turn — the dock's exact pipeline. ADVICE,
 * CLARIFICATION and UNSUPPORTED replies change nothing; only a CHANGE reaches the engine.
 * @param opts `{expectedRevision}` — must equal the draft's revision (`draftStatus().revision`)
 * @param ctx  `{canAuthor, definitionRows, sym, tf, converse?}`
 * @returns TurnOutcome:
 *   `{ok:true, kind:'applied', revision, stepId, lines, readback, changes}`
 *   `{ok:true, kind:'question'|'answer'|'unsupported', revision, reply, questions, lines, readback, gate?}`
 *   `{ok:false, reason, revision, detail?}`
 */
export async function draftTurn(draftRef, message, opts = {}, ctx = {}) {
  const words = String(message || '').trim()
  if (!words) return refuse(R.BAD_REQUEST)
  const w = writable(draftRef, ctx)
  if (!w.ok) return { ...w, revision: null }
  const { key, snap } = w
  if (!Number.isInteger(opts.expectedRevision) || opts.expectedRevision !== snap.state.revision) {
    return refuse(R.STALE_REVISION, { revision: snap.state.revision })
  }
  const before = snap.state
  const gateCtx = gateCtxOf(ctx)
  const snippets = transcriptSnippets(snap.transcript)
  const withMember = append(snap.transcript, [{ role: 'member', text: words }])
  let out = localTurn(before, words, { sym: ctx.sym || null, tf: ctx.tf || null, gateCtx })
  if (!out) {
    out = await modelTurn(before, () => {
      const now = readSession(key)
      return now && now.state ? now.state : before
    }, words, { snippets, gateCtx, converse: ctx.converse || converseTurn })
    // ⛔ the dock may have opened, or the draft moved, while the model answered — nothing written then
    const now = readSession(key)
    if (isHeldInDock(key)) return refuse(R.DRAFT_OPEN_IN_DOCK)
    if (!now || !now.state || now.state.lineage !== before.lineage || now.state.revision !== before.revision) {
      return refuse(R.STALE_REVISION, { revision: now && now.state ? now.state.revision : null })
    }
  }
  const next = { ...snap, state: out.state || snap.state, transcript: append(withMember, out.entries), acked: out.changed ? false : snap.acked }
  delete next.recovered
  keep(key, next)
  const outcome = outcomeOf(out, snap, next)
  if (out.state && out.changed) {
    const pv = refreshPreview(key, next.state)
    if (pv) outcome.preview = pv
  }
  return outcome
}

/**
 * Undo the latest specialist history step — exactly. `expectedStepId` must be the step at
 * the top of the history (`draftStatus().undoStepId`, or the `stepId` a turn returned).
 * @returns TurnOutcome `{ok:true, kind:'undone', revision, undid, undoStepId, lines, readback}` | refusal
 */
export function draftUndo(draftRef, opts = {}, ctx = {}) {
  const w = writable(draftRef, ctx)
  if (!w.ok) return w
  const { key, snap } = w
  const top = undoStepIdOf(snap.state)
  if (!top) return refuse(R.NOTHING_TO_UNDO)
  if (opts.expectedStepId !== top) return refuse(R.STALE_STEP, { undoStepId: top })
  const out = undoTurn(snap.state, gateCtxOf(ctx))
  const next = { ...snap, state: out.state, transcript: append(snap.transcript, [out.entry]), acked: false }
  delete next.recovered
  keep(key, next)
  const pv = refreshPreview(key, out.state)
  return { ok: true, kind: 'undone', undid: top, revision: out.state.revision, undoStepId: undoStepIdOf(out.state),
    lines: out.entry.lines.slice(), readback: readback(out.state.working, out.state, gateCtxOf(ctx)), ...(pv ? { preview: pv } : {}) }
}

/**
 * ⭐ M3 TYPED RENAME — rename the draft and NOTHING else: the ordinary `rename_definition` op
 * through the shared pipeline's one name-only step (`renameTurn`), with no model call (no
 * allowance spent). Same lineage, one revision, one history step (undoable like any turn).
 * The display labels derived from the name follow it (meta.name / shortName / an unlabelled
 * first output); keys, trees, inputs, placement, style, requests and repaint mode cannot move.
 * @param name     the member's name (trimmed; clipped to the engine's name limit — see `rename.to`)
 * @param opts     `{expectedRevision}` — must equal the draft's revision
 * @returns `{ok:true, kind:'applied', renameOnly:true, rename:{from, to}, revision, stepId,
 *            changes:[{kind:'renamed', from, to, op}], lines, readback}`
 *        | refusal: `bad-request` (no name), `name-unchanged`, `nothing-to-rename`, `stale-revision`,
 *          `access`, `draft-open-in-dock`, `draft-expired`, `draft-stale`, `unknown-definition`,
 *          `turn-refused` (the engine refused it; `detail.codes`)
 */
export function renameDraft(draftRef, name, opts = {}, ctx = {}) {
  const w = writable(draftRef, ctx)
  if (!w.ok) return w
  const { key, snap } = w
  const st = snap.state
  if (!Number.isInteger(opts.expectedRevision) || opts.expectedRevision !== st.revision) {
    return refuse(R.STALE_REVISION, { revision: st.revision })
  }
  const wanted = typeof name === 'string' ? name.trim() : ''
  if (!wanted) return refuse(R.BAD_REQUEST)
  if (!st.working) return refuse(R.NOTHING_TO_RENAME)
  const current = (st.working.meta && st.working.meta.name) || ''
  if (current === wanted) return refuse(R.NAME_UNCHANGED, { name: current })
  const out = renameTurn(st, wanted, { gateCtx: gateCtxOf(ctx) })
  if (!out.ok) {
    return refuse(R.TURN_REFUSED, { codes: (out.errors || []).map((e) => e.code) })
  }
  // the engine may clip a long name: a clipped name equal to the current one changed nothing
  if (out.rename && out.rename.to === current) return refuse(R.NAME_UNCHANGED, { name: current })
  const next = { ...snap, state: out.state, transcript: append(snap.transcript, [{ role: 'member', text: `Name it ${wanted}` }, ...out.entries]), acked: false }
  delete next.recovered
  keep(key, next)
  const outcome = outcomeOf(out, snap, next)
  const pv = refreshPreview(key, next.state)
  if (pv) outcome.preview = pv
  return outcome
}

/** Throw the draft away. @returns `{ok:true}` | refusal */
export function discardDraft(draftRef, opts = {}, ctx = {}) {
  const w = writable(draftRef, ctx)
  if (!w.ok) return w
  if (!Number.isInteger(opts.expectedRevision) || opts.expectedRevision !== w.snap.state.revision) {
    return refuse(R.STALE_REVISION, { revision: w.snap.state.revision })
  }
  noteDiscarded(w.snap.state)
  dropPreview(w.key)
  clearSession(w.key)
  return { ok: true }
}

// ─── save ────────────────────────────────────────────────────────────────────

/** The stored row, read back from the server (the authority). Injectable for tests. */
export async function readStoredDefinition(defId, fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
  if (!fetchImpl) return null
  try {
    const r = await fetchImpl(`/api/user-definitions/${encodeURIComponent(defId)}`, { credentials: 'include', cache: 'no-store' })
    if (!r || !r.ok) return null
    const row = await r.json()
    return isObj(row) ? row : null
  } catch { return null }
}

function readBackMatches(row, storedDoc) {
  if (!isObj(row) || !isObj(storedDoc)) return false
  if (row.def_id !== storedDoc.id || row.version !== storedDoc.version) return false
  // ⭐ the name the member approved is the name the store holds (a saved rename is confirmed here)
  const storedName = row.definition && row.definition.meta && row.definition.meta.name
  const sentName = storedDoc.meta && storedDoc.meta.name
  if (typeof storedName === 'string' && typeof sentName === 'string' && storedName !== sentName) return false
  const a = row.definition && row.definition.compute && row.definition.compute.fn
  const b = storedDoc.compute && storedDoc.compute.fn
  return !(typeof a === 'string' && typeof b === 'string' && a !== b)
}

/**
 * Save through the canonical definition writer (`storeConversation` → `saveUserDefinition`).
 * Explicit member approval is the Agent's (risk confirm); `acknowledged: true` only from the
 * approval that showed `ackText` verbatim. No chart is attached here (add it with M2), and
 * requested alerts are not armed here (each is reported).
 * ⛔ SUCCESS ONLY AFTER THE STORED ROW IS READ BACK: same id, version and maths identity.
 * @param ctx `{canAuthor, definitionRows, sym, tf, store?, readBack?}`
 * @returns `{ok:true, defId, version, created, name, receipt, outcomes}`
 *        | `{ok:false, reason:'saved-unconfirmed', defId, version}` (stored, not verified — never a success)
 *        | refusal (`not-dirty`, `needs-ack`, `validation`, `save-conflict`, `save-refused`, …)
 */
export async function saveDraft(draftRef, opts = {}, ctx = {}) {
  const w = writable(draftRef, ctx)
  if (!w.ok) return w
  const { key, snap } = w
  const st = snap.state
  if (!Number.isInteger(opts.expectedRevision) || opts.expectedRevision !== st.revision) {
    return refuse(R.STALE_REVISION, { revision: st.revision })
  }
  if (!st.working || !isDirty(st)) return refuse(R.NOT_DIRTY)
  const rb = readback(st.working, st, gateCtxOf(ctx))
  if ((rb.needsAck || []).length && opts.acknowledged !== true) return refuse(R.NEEDS_ACK, { ackText: ackTextOf(rb) })
  const out = await saveConversation(st, { acked: opts.acknowledged === true, settings: null, onChange: null, arm: false,
    sym: ctx.sym || null, tf: ctx.tf || null, ...(ctx.store ? { store: ctx.store } : {}) })
  if (!out.ok) {
    const s = out.stored || {}
    const reason = s.stage === 'conflict' ? R.SAVE_CONFLICT : s.stage === 'ack' ? R.NEEDS_ACK
      : s.stage === 'validate' ? R.VALIDATION : R.SAVE_REFUSED
    return refuse(reason, { error: out.error || null, ...(s.refusal ? { refusal: s.refusal } : {}), ...(s.conflictInfo ? { conflict: s.conflictInfo } : {}) })
  }
  // the store accepted it: the draft ends either way (a retry would create a second definition),
  // and its preview goes (the saved indicator is added to charts through M2)
  dropPreview(key)
  clearSession(key)
  const doc = out.storedDoc
  const row = await (ctx.readBack || readStoredDefinition)(doc.id)
  if (!readBackMatches(row, doc)) {
    return { ok: false, reason: R.SAVED_UNCONFIRMED, defId: doc.id, version: doc.version, created: !!out.stored.created }
  }
  return { ok: true, defId: doc.id, version: doc.version, created: !!out.stored.created,
    name: (doc.meta && doc.meta.name) || null,
    receipt: { title: out.receipt.title, items: out.receipt.items.map((i) => i.text) },
    outcomes: out.outcomes.map((o) => ({ ...o })) }
}

// ─── preview (S3) ────────────────────────────────────────────────────────────

/**
 * Show the draft's working definition as the tab's ONE live preview on a chart — only when
 * the member asked, or named a chart for the draft (§15.3). `host` is that chart's
 * ChartPane handle (`showAuthoringPreview` / `clearAuthoringPreview`); `chartRef` is the
 * Agent's ref for it (receipts). The preview is refreshed after every applied change and
 * Undo of this draft and taken down on Save / Discard / expiry; it is never persisted.
 * @returns `{ok:true, chartRef, movedFrom}` | refusal (`nothing-to-preview`, `readonly`,
 *          `busy` — a dock holds the preview, `invalid`, `draft-open-in-dock`, `access`, …)
 */
export function showDraftPreview(draftRef, { host, chartRef = null } = {}, ctx = {}) {
  const w = writable(draftRef, ctx)
  if (!w.ok) return w
  if (!host || typeof host.showAuthoringPreview !== 'function' || typeof host.clearAuthoringPreview !== 'function') return refuse(R.BAD_REQUEST)
  const def = previewDefinitionOf(w.snap.state)
  if (!def) return refuse(R.NOTHING_TO_PREVIEW)
  let res
  try { res = host.showAuthoringPreview(def, previewOptsOf(w.snap.state)) } catch { res = { ok: false, reason: 'readonly' } }
  if (!res || !res.ok) return refuse((res && res.reason) || R.PREVIEW_READONLY)
  previewing = { key: w.key, lineage: w.snap.state.lineage, host, chartRef }
  return { ok: true, chartRef, movedFrom: res.movedFrom ?? null }
}

/** Take the draft's preview down (no-op when it has none). @returns `{ok:true, cleared}` */
export function clearDraftPreview(draftRef) {
  if (!isObj(draftRef) || typeof draftRef.key !== 'string') return refuse(R.BAD_REQUEST)
  return { ok: true, cleared: dropPreview(draftRef.key) }
}

/** Tests only. */
export function _resetDraftPreview() { previewing = null }
