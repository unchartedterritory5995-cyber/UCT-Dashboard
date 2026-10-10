// app/src/components/chart/builder/authoring/authoringSession.js
//
// ─── ⭐ M3 S1 — THE ONE CONVERSATIONAL AUTHORING PIPELINE, OUT OF REACT ────────────
//
// The Create Indicator conversation's turn, Undo, Save and restore steps, moved VERBATIM
// out of `studio/useIndicatorConversation.js` so the dock and UCT Agent (through
// `builder/agentAuthoring.js`) run the SAME code (AGENT-M3-CONTRACT §1.2, §3.1, D1).
// It owns nothing mathematical — every step is Track A's seams, unchanged:
//
//   preflight → (a name-only message: renamePatch) → converseTurn → classifyTurn →
//   withMemberName → applyTurn → readback → storeConversation / attachConversation /
//   armConversationAlerts
//
// ⛔ NO REACT, NO STATE OF ITS OWN. Each function takes the conversation it works on and
// returns what happened: the next authoring state (or null — untouched), the transcript
// entries to append (without ids; the caller numbers them) and whether the change resets
// the preview acknowledgement. The hook keeps its React state; the Agent keeps nothing
// but the session the store already holds.

import { newAuthoringState, applyTurn, undo as undoState, readback, isDirty } from './index'
import { openAuthoringState } from './authoringState'
import { converseTurn, distinctNotUnderstood } from './converseClient'
import { classifyTurn, OUTCOMES } from './turnOutcome'
import { preflight } from './preflight'
import { readSession, clearSession } from './conversationSessions'
import { storeConversation, attachConversation, armConversationAlerts } from '../conversationSave'
import { stampSemantics } from '../../engine/definitionSemantics'
import { OUTPUT_TYPES } from '../../engine/outputType'
import { STUDIO_PREVIEW_DEF_ID } from '../studio/chartPreview'
import { memberError, memberSaveError, memberRefusal } from './memberWords'
import { logStudioAction, definitionKinds, clientFailureOf } from './studioTelemetry'
import { outputNamer, slotWords } from './readback'
import { soleCueName } from './derivedName'
import { renamePatch, withMemberName } from './memberNamePatch'
import { validateUserDefinitions } from '../../engine/nativeRegistry'
import { saveReceipt } from '../studio/saveOutcomeReceipt'

/** The member-facing type word for an output, keyed by the P1 type authority's own values. */
const TYPE_WORDS = Object.freeze({
  [OUTPUT_TYPES.SERIES]: 'Line', [OUTPUT_TYPES.CONDITION]: 'Condition',
  [OUTPUT_TYPES.EVENTS]: 'Events', [OUTPUT_TYPES.SCALAR]: 'Value',
})
export const typeWord = (t) => TYPE_WORDS[t] || 'Output'

/** The engine's own disclosures, in member words. Deterministic. */
function changeWords(c) {
  switch (c.kind) {
    case 'type-changed': return `${c.output} is now a ${typeWord(c.to).toLowerCase()} (was ${typeWord(c.from).toLowerCase()}).`
    case 'refused-on-chart': return `${c.output} can't be drawn here: ${c.text}`
    case 'requests-cleared': return `Requests on ${c.output} were cancelled with it.`
    case 'intent-cleared': return `The signal choice on ${c.output} was cleared with it.`
    case 'paint-removed': return c.text ? `${c.output}: ${c.text}` : null
    default: return null
  }
}

/** A refused engine error, without engine jargon (P3 UX: the ONE mapping,
 *  `memberError`). The code and the engine's message stay on the entry. */
const errorWords = (e, working = null) => memberError(e, { nameOf: working ? outputNamer(working) : null }).text

/**
 * The deterministic lines a UCT reply carries after a successful turn: what each
 * output now computes, then anything assumed THIS turn.
 */
export function replyLines(rb, state, changes = []) {
  const lines = []
  for (const c of changes) { const w = changeWords(c); if (w) lines.push(w) }
  for (const o of rb.outputs || []) {
    if (o.phrase) lines.push(`${o.name || o.label} — ${o.phrase}`)
    else if (o.sentence) lines.push(o.sentence)
  }
  for (const a of state.assumptions || []) {
    if (a.revision !== state.revision) continue
    if (a.label !== undefined) lines.push(`Using ${slotWords(a.label)} ${a.value}.`)
    else if (a.source === 'engine') lines.push(`Default: ${a.text}.`)
  }
  return lines
}

export const NOTHING_CHANGED = 'Nothing on the chart changed.'

/** ⭐ PHASE 4 — the first line of an opened definition's conversation. */
export function openedEntry(open) {
  const def = open.def
  const name = (def && def.meta && def.meta.name) || open.defId
  const st = openAuthoringState(def, { defId: open.defId, version: open.version })
  const rb = readback(st.working, st, {})
  return {
    id: 0, role: 'uct', kind: 'opened',
    lines: [`Opened “${name}” (saved version ${open.version}). Describe a change — nothing is saved until you choose Save.`,
      ...(rb.outputs || []).map((o) => (o.phrase ? `${o.name || o.label} — ${o.phrase}` : o.sentence)).filter(Boolean)],
  }
}

/**
 * The conversation kept under `sessionKey`, as it may be reopened.
 * ⭐ PHASE 4 — an EDIT's draft is restored only while it was opened from the version that
 * is STILL the stored one; a draft of an older version is stale and is dropped.
 * ⭐⭐ BATCH 1 — a draft kept across a reload (`recovered`) must still pass the registry's
 * own validation. Otherwise it is dropped — never opened over a newer saved definition.
 * @returns {{initial: object|null, dropped: {reason, from?, now?}|null}}
 */
export function restoreConversation(sessionKey, open = null) {
  const kept = readSession(sessionKey)
  if (!kept) return { initial: null, dropped: null }
  const st = kept.state
  if (open && !(st && st.defId === open.defId && st.baseVersion === open.version)) {
    clearSession(sessionKey)
    return { initial: null, dropped: kept.recovered || (st && isDirty(st))
      ? { reason: 'stale', from: st && st.baseVersion, now: open.version } : null }
  }
  if (kept.recovered && st && st.working && validateUserDefinitions([st.working]).errors.length) {
    clearSession(sessionKey)
    return { initial: null, dropped: { reason: 'invalid' } }
  }
  return { initial: kept, dropped: null }
}

/** The authoring state a conversation starts from (restored, opened, or new). */
export function initialConversationState(initial, open = null) {
  return (initial && initial.state)
    || (open && open.def ? openAuthoringState(open.def, { defId: open.defId, version: open.version }) : newAuthoringState())
}

/** The transcript a conversation starts from. */
export function initialTranscript(initial, open = null) {
  return (initial && initial.transcript) || (open && open.def ? [openedEntry(open)] : [])
}

/** Is there anything to keep? A fresh, untouched conversation — or an opened, untouched
 *  definition — is not stored, so opening and closing an empty dock leaves no session. */
export function hasSomethingToKeep({ state, transcript, open = null }) {
  if (!transcript.length && !state.working) return false
  if (open && !isDirty(state) && transcript.length <= 1) return false
  return true
}

/**
 * THE LOCAL HALF OF A TURN — no request leaves the browser.
 *  · SLICE 2 PRE-FLIGHT: an explicit other-symbol / other-timeframe request is answered
 *    here (no model call, no cost; the server runs the same rules on every turn).
 *  · BATCH 1: a message that only NAMES it ("Call it Swing Line", any turn) is the
 *    ordinary `rename_definition` op: deterministic, same lineage, one revision, one undo step.
 * @returns null when the model must be asked, else
 *          `{ok, entries, state: next|null, changed}` (see `modelTurn`).
 */
export function localTurn(before, words, { sym = null, tf = null, gateCtx = {} } = {}) {
  const caught = preflight(words, { sym, tf })
  if (caught) {
    return { ok: false, state: null, changed: false,
      entries: [{ role: 'uct', kind: 'unsupported', preflight: true, gate: caught.gate, lines: [caught.reason, NOTHING_CHANGED] }] }
  }
  const soleName = before.working ? soleCueName(words) : null
  if (!soleName) return null
  const out = applyTurn(before, renamePatch(before, soleName), { gateCtx, memberWords: words })
  if (out.result.status === 'refused') {
    return { ok: false, state: null, changed: false,
      entries: [{ role: 'uct', kind: 'refusal', codes: (out.result.errors || []).map((e) => e.code),
        lines: [...(out.result.errors || []).map((e) => errorWords(e, before.working)), NOTHING_CHANGED] }] }
  }
  return { ok: true, state: out.state, changed: true,
    entries: [{ role: 'uct', kind: 'patched', revision: out.state.revision, updated: true,
      lines: [`Renamed to “${out.readback.name || soleName}”.`] }] }
}

/**
 * THE MODEL HALF OF A TURN — one `/converse` call; the server declares what the turn is
 * (`classifyTurn`). ANSWER / UNSUPPORTED / REFUSED are the assistant's words and nothing
 * else (the state is not touched); CLARIFY records its questions; only a CHANGE reaches
 * the engine, which refuses a stale or invalid patch atomically.
 * @param {object} before       the state the request was built from
 * @param {Function} current    returns the state NOW (applied against after the await)
 * @returns `{ok, entries, state: next|null, changed}` — `changed`: a new revision of the
 *          definition (the preview acknowledgement resets, the "updated" cue fires).
 */
export async function modelTurn(before, current, words, { snippets = [], gateCtx = {}, converse = converseTurn } = {}) {
  const res = await converse({ message: words, state: before, gateCtx, snippets })
  const gaps = [
    ...distinctNotUnderstood(res).map((n) => `I didn't understand "${n.clause || n.text || ''}"${n.reason ? ` — ${n.reason}` : ''}.`),
    ...((res && res.unavailable) || []).map((n) => `${n.column || n.name || 'That'} isn't available yet${n.reason ? ` — ${n.reason}` : ''}.`),
  ]
  const turn = classifyTurn(res)
  const said = (ok, entry, extra = {}) => ({ ok, state: null, changed: false, entries: [entry], outcome: turn.outcome, ...extra })
  if (turn.outcome === OUTCOMES.ANSWER) {
    return said(true, { role: 'uct', kind: 'answer', reply: turn.reply, lines: [turn.reply, ...gaps] })
  }
  if (turn.outcome === OUTCOMES.UNSUPPORTED) {
    return said(false, { role: 'uct', kind: 'unsupported', preflight: !!turn.preflight, gate: turn.gate || null,
      lines: [turn.reply || memberRefusal(turn.gate, turn.reason), ...gaps, NOTHING_CHANGED] })
  }
  if (turn.outcome === OUTCOMES.REFUSED) {
    const failure = clientFailureOf(turn.gate)
    if (failure) logStudioAction(before.lineage, 'turn_failed', { surface: 'studio', failure })
    return said(false, { role: 'uct', kind: 'refusal', gate: turn.gate,
      lines: [memberRefusal(turn.gate, turn.reason), ...gaps, NOTHING_CHANGED] }, { gate: turn.gate, reason: turn.reason })
  }
  // ⭐ BATCH 1 — a name the member gave in the same message rides in this envelope.
  const envelope = turn.outcome === OUTCOMES.CHANGE ? withMemberName(turn.envelope, words) : turn.envelope
  const now = current()
  const out = applyTurn(now, envelope, { gateCtx, memberWords: words })
  const { result } = out
  if (result.status === 'refused') {
    return said(false, { role: 'uct', kind: 'refusal', codes: (result.errors || []).map((e) => e.code),
      details: (result.errors || []).map((e) => memberError(e).detail),
      lines: [...(result.errors || []).map((e) => errorWords(e, now.working)), ...gaps, NOTHING_CHANGED] }, { errors: result.errors || [] })
  }
  if (result.status === 'question') {
    return { ok: true, state: out.state, changed: false, outcome: turn.outcome,
      entries: [{ role: 'uct', kind: 'question', questions: out.state.questions, reply: turn.reply || '',
        lines: [...(turn.reply ? [turn.reply] : []), ...gaps, ...out.state.questions.map((q) => q.text)] }] }
  }
  logStudioAction(out.state.lineage, 'preview', { surface: 'studio' })
  // ⛔ P3S: a CHANGE shows the deterministic readback of the RESULT and nothing the model wrote.
  return { ok: true, state: out.state, changed: true, outcome: turn.outcome, changes: result.changes || [],
    entries: [{ role: 'uct', kind: before.working ? 'patched' : 'created', revision: out.state.revision, updated: true,
      lines: [...replyLines(out.readback, out.state, result.changes), ...gaps] }] }
}

/** Undo the last applied change. @returns null (nothing to undo) | `{state, entry}`. */
export function undoTurn(cur, gateCtx = {}) {
  if (!cur.history.length) return null
  const next = undoState(cur)
  const after = readback(next.working, next, gateCtx)
  return { state: next, entry: { role: 'uct', kind: 'undo', lines: next.working
    ? ['Undid the last change.', ...(after.outputs || []).map((o) => (o.phrase ? `${o.name || o.label} — ${o.phrase}` : o.sentence)).filter(Boolean)]
    : ['Undid the last change. The chart preview is cleared.'] } }
}

/**
 * Save through the EXISTING doors. `settings` must be the STORED blob (never the preview
 * read view), `onChange` the chart's own settings writer (or null: no chart is attached),
 * `beforeAttach` runs after the server accepted the definition and before the chart gains
 * the durable instance. `arm` false skips arming requested alerts (each is reported).
 * @returns `{ok:false, error, entry, stored}` | `{ok:true, entry, stored, storedDoc, instanceId, outcomes, receipt}`
 */
export async function saveConversation(cur, { acked = false, settings = null, onChange = null, beforeAttach = null,
  sym = null, tf = null, arm = true, store = storeConversation } = {}) {
  const stored = await store(cur, { previewAcked: acked })
  if (!stored.ok) {
    logStudioAction(cur.lineage, 'save_failed', { surface: 'studio' })
    const m = memberSaveError(stored)
    return { ok: false, error: stored.error, stored, entry: { role: 'uct', kind: 'refusal', codes: [m.code], details: [m.detail], lines: ['Not saved.', m.text] } }
  }
  logStudioAction(cur.lineage, 'saved', { surface: 'studio', created: !!stored.created, origin: 'native',
    kinds: definitionKinds(stored.storedDoc, stored.requests) })
  // ⛔ BATCH 1 — FROM HERE THE DEFINITION IS SAVED, WHATEVER FOLLOWS.
  if (typeof beforeAttach === 'function') { try { beforeAttach() } catch { /* the preview teardown */ } }
  let attached
  try {
    attached = attachConversation({ storedDoc: stored.storedDoc, created: stored.created, requests: stored.requests, settings, base: cur.base })
    if (settings && onChange && attached.settings !== settings) onChange(attached.settings)
  } catch {
    attached = { settings, instanceId: null, installed: false,
      outcomes: [{ kind: 'chart', ok: false, text: 'Saved, but it could not be added to the chart. Add it from Indicators.' }] }
  }
  let alerts = []
  if (arm) {
    try {
      alerts = await armConversationAlerts({ storedDoc: stored.storedDoc, requests: stored.requests, sym, tf, instanceId: attached.instanceId })
    } catch {
      alerts = ((stored.requests && stored.requests.alerts) || []).map((a) => ({ kind: 'alert', plotKey: a.plotKey, ok: false,
        text: 'Alert: not created — the alert service could not be reached. Create it from the chart’s alert menu.' }))
    }
  } else {
    alerts = ((stored.requests && stored.requests.alerts) || []).map((a) => ({ kind: 'alert', plotKey: a.plotKey, ok: false,
      text: 'Alert: not created here — create it from the chart’s alert menu.' }))
  }
  const outcomes = [...attached.outcomes, ...alerts]
  const receipt = saveReceipt({ storedDoc: stored.storedDoc, created: stored.created, outcomes })
  return { ok: true, stored, storedDoc: stored.storedDoc, instanceId: attached.instanceId, outcomes, receipt,
    entry: { role: 'uct', kind: 'saved', lines: [receipt.title, ...receipt.items.map((o) => o.text)], outcomes, receipt } }
}

/** Telemetry for a deliberate discard. */
export function noteDiscarded(state) {
  if (state && state.working) logStudioAction(state.lineage, 'discarded', { surface: 'studio' })
}

/** The working definition under the studio's preview id, semantics-stamped the way every
 *  Builder preview is (⭐ PHASE 4 — an edit under the store's rule for an EDIT, prior = the
 *  stored definition). Re-installing under the same id after a patch replaces the copy
 *  (the registry's install key includes `compute.fn`). */
export function previewDefinitionOf(state) {
  if (!state || !state.working) return null
  return stampSemantics({ ...state.working, id: STUDIO_PREVIEW_DEF_ID }, { prior: state.base || null })
}
