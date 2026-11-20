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

import { newAuthoringState, applyTurn, undo as undoState, undoTo as undoToState, readback, isDirty } from './index'
import { openAuthoringState } from './authoringState'
import { converseTurn, STOPPED_GATE, distinctNotUnderstood } from './converseClient'
import { classifyTurn, OUTCOMES } from './turnOutcome'
import { liveOffer, withoutOffer } from './builtInOffer'
import { settleScript, checkScript as defaultCheckScript } from './scriptAnswer'
import { preflight } from './preflight'
import { readSession, clearSession } from './conversationSessions'
import { storeConversation, attachConversation, armConversationAlerts } from '../conversationSave'
import { stampSemantics } from '../../engine/definitionSemantics'
import { OUTPUT_TYPES } from '../../engine/outputType'
import { STUDIO_PREVIEW_DEF_ID } from '../studio/chartPreview'
import { memberError, memberSaveError, memberRefusal, chartRefusalWords } from './memberWords'
import { logStudioAction, definitionKinds, clientFailureOf } from './studioTelemetry'
import { outputNamer, slotWords } from './readback'
import { soleCueName, memberCueNames, derivedRowName } from './derivedName'
import { settingPatch, settingRefusal } from './derivedSettings'
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
    case 'refused-on-chart': return `${c.output} can't be drawn here: ${chartRefusalWords(c.guard, c.text) || c.text}`
    case 'requests-cleared': return `Requests on ${c.output} were cancelled with it.`
    case 'intent-cleared': return `The signal choice on ${c.output} was cleared with it.`
    case 'paint-removed': return c.text ? `${c.output}: ${c.text}` : null
    case 'scan-moved': return `Running this over a list now reads ${c.output}: the line it read (${c.from}) was removed.`
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
/** What the dock says after the member pressed Stop. The request left the browser, so the
 *  server may still have worked on it: said plainly, because it can count toward the day. */
export const STOPPED_LINE = 'Stopped. A request that was already sent can still count toward today\'s allowance.'

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
  // ⭐ A RESTORED CONVERSATION OFFERS NOTHING: an offer was for the chart as it stood when the
  // answer arrived (`builtInOffer.js`, rule 3). The words stay; the button does not come back.
  if (initial && initial.transcript) return initial.transcript.map(withoutOffer)   // a script entry keeps its text: opening it re-checks it
  return open && open.def ? [openedEntry(open)] : []
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
  return renameTurn(before, soleName, { gateCtx, memberWords: words })
}

/**
 * ⭐ THE ONE NAME-ONLY RENAME — the ordinary `rename_definition` op, applied by the engine with
 * no model call (same lineage, one revision, one undo step). `localTurn` runs it for a message
 * that only names the indicator; ⭐ M3 `agentAuthoring.renameDraft` runs it directly.
 * RENAME-ONLY BY CONSTRUCTION: the patch carries that one op, which changes only the name (and
 * the labels derived from it) — `renameOnly: true` marks exactly this path.
 * @returns `{ok, state: next|null, changed, entries, changes?, rename?: {from, to}, renameOnly?}`
 */
export function renameTurn(before, name, { gateCtx = {}, memberWords = null } = {}) {
  const out = applyTurn(before, renamePatch(before, name), { gateCtx, memberWords: memberWords ?? name })
  if (out.result.status === 'refused') {
    return { ok: false, state: null, changed: false, errors: out.result.errors || [],
      entries: [{ role: 'uct', kind: 'refusal', codes: (out.result.errors || []).map((e) => e.code),
        lines: [...(out.result.errors || []).map((e) => errorWords(e, before.working)), NOTHING_CHANGED] }] }
  }
  const changes = (out.result.changes || []).map((c) => ({ ...c }))
  const renamed = changes.find((c) => c.kind === 'renamed')
  return { ok: true, state: out.state, changed: true, changes, renameOnly: true,
    ...(renamed ? { rename: { from: renamed.from ?? null, to: renamed.to } } : {}),
    entries: [{ role: 'uct', kind: 'patched', revision: out.state.revision, updated: true,
      lines: [`Renamed to “${out.readback.name || name}”.`] }] }
}

/**
 * ⭐ ONE SETTING CHANGED BY HAND (2026-11-17, `derivedSettings.js`) — a number of the working
 * indicator set from its own field, with no model call. The ordinary `set_slot` op through the
 * same engine door as a conversation turn: one revision, one Undo step, the name follows the
 * maths, the preview redraws.
 * @returns `{ok, state: next|null, changed, entries, stale?: true, errors?}` — `stale` when the
 *   setting no longer matches the working indicator (the caller re-derives and shows the new list)
 */
export function settingTurn(before, setting, value, { gateCtx = {} } = {}) {
  const refusal = settingRefusal(setting, value)
  if (refusal) {
    return { ok: false, state: null, changed: false, entries: [], message: refusal }
  }
  const patch = settingPatch(before, setting, value)
  if (!patch) return { ok: false, state: null, changed: false, entries: [], stale: true }
  const out = applyTurn(before, patch, { gateCtx })
  if (out.result.status !== 'applied') {
    const errors = out.result.errors || []
    return { ok: false, state: null, changed: false, entries: [], errors,
      // a `schema:` refusal's sentence is about the assistant's patch; this one was typed by hand
      message: errors.length && !String(errors[0].code || '').startsWith('schema:')
        ? errorWords(errors[0], before.working) : 'That value could not be applied.' }
  }
  return { ok: true, state: out.state, changed: true, changes: (out.result.changes || []).map((c) => ({ ...c })),
    entries: [{ role: 'uct', kind: 'patched', revision: out.state.revision, updated: true, bySetting: true,
      lines: [`Set ${setting.caption} ${setting.role} from ${setting.value} to ${value}.`] }] }
}

/** The longest description of its own work the dock shows from the assistant. */
export const SAID_MAX = 400

/** The assistant's description of a change, as plain bounded text; '' when there is none. */
export function saidOf(reply) {
  const t = typeof reply === 'string' ? reply.replace(/\s+/g, ' ').trim() : ''
  return t.length > SAID_MAX ? `${t.slice(0, SAID_MAX - 1).trimEnd()}…` : t
}

/** PACKAGE 3: `envelope` with its `create` name kept as a custom name (see modelTurn), else the SAME envelope. */
function withCreateName(envelope, words, accept) {
  if (!envelope || !Array.isArray(envelope.ops)) return envelope
  if (soleCueName(words) || memberCueNames(words).length) return envelope
  if (envelope.ops.some((o) => o && o.op === 'rename_definition')) return envelope
  const created = envelope.ops.find((o) => o && o.op === 'create')
  const name = created && typeof created.name === 'string' ? created.name.replace(/\s+/g, ' ').trim() : ''
  let ok = false
  try { ok = !!name && accept(name) === true } catch { ok = false }
  return ok ? { ...envelope, ops: [...envelope.ops, { op: 'rename_definition', name }] } : envelope
}

/** `envelope` with the assistant's label kept, as a CUSTOM label, for each line of its `create` that
 *  `accept(label, key)` takes; else the SAME envelope. A line the patch already renames, or whose
 *  label the member gave in their own words, is the engine's to settle (derivedName.js). */
function withCreateLabels(envelope, words, accept) {
  if (!envelope || !Array.isArray(envelope.ops)) return envelope
  const created = envelope.ops.find((o) => o && o.op === 'create')
  if (!created || !Array.isArray(created.outputs)) return envelope
  const given = new Set(memberCueNames(words).map((t) => t.toLowerCase()))
  const renamed = new Set(envelope.ops.filter((o) => o && o.op === 'rename_output').map((o) => o.output))
  const extra = []
  created.outputs.forEach((o, j) => {
    const key = o && (o.key || (j === 0 ? 'value' : null))
    const label = o && typeof o.label === 'string' ? o.label.replace(/\s+/g, ' ').trim().replace(/[.]+$/, '') : ''
    if (!key || !label || renamed.has(key) || given.has(label.toLowerCase())) return
    let ok = false
    try { ok = accept(label, key) === true } catch { ok = false }
    if (ok) extra.push({ op: 'rename_output', output: key, label })
  })
  return extra.length ? { ...envelope, ops: [...envelope.ops, ...extra] } : envelope
}

/**
 * The envelope a NEW indicator is applied with, once the question "whose name?" is answered.
 * `keep(name, { derivedName })` is asked with the name the engine WOULD derive (a dry run of the same
 * patch against the same state; `applyTurn` writes nothing). Used by the dock (`modelTurn`) and by the
 * New formula window's Describe box (`ConverseBox`), so the two cannot answer differently.
 * ⛔ The caller decides WHETHER this turn creates the indicator; this only decides the name.
 */
export function nameFromAssistant(state, envelope, words, gateCtx, keep, keepLabel = null) {
  // ⭐ 2026-11-17 — `keepLabel(label, { derivedLabel })` asks the same of each LINE's label, with
  // the label the engine would derive for that line in the same dry run. A patch the engine would
  // refuse derives nothing, and then no label is kept: the refusal is the turn's answer.
  const wantsName = typeof keep === 'function'
  const wantsLabels = typeof keepLabel === 'function'
  if (!wantsName && !wantsLabels) return envelope
  let ctx = { derivedName: null }
  let derivedLabels = null
  try {
    const dry = applyTurn(state, envelope, { gateCtx, memberWords: words })
    const w = dry && dry.state && dry.state.working
    ctx = { derivedName: (w && w.meta && typeof w.meta.name === 'string') ? w.meta.name : null }
    if (w && Array.isArray(w.plots)) {
      derivedLabels = new Map(w.plots.map((p) => [p.key, typeof p.label === 'string' ? p.label : null]))
      // ⚠️ THE FIRST LINE IS ASKED DIFFERENTLY. Its stored label is empty, which means "follow the
      // indicator's name" (derivedName.js), so what the document shows for it is the NAME, not
      // this line's own maths. Of ONE line that is right, and its label is left alone: the
      // indicator's name is the line's name. Of SEVERAL, "Stochastic Oscillator" beside "%D" is
      // the wrong pair, so the first line is asked against its own formula's label.
      const first = w.plots[0]
      if (first) {
        const compute = w.compute || {}
        const ast = (compute.trees && compute.trees[first.key]) || compute.ast || null   // one line stores `ast` alone
        if (w.plots.length > 1 && ast) derivedLabels.set(first.key, derivedRowName({ key: first.key, ast }))
        else derivedLabels.delete(first.key)
      }
    }
  } catch { ctx = { derivedName: null }; derivedLabels = null }
  const named = wantsName ? withCreateName(envelope, words, (n) => keep(n, ctx)) : envelope
  if (!wantsLabels || !derivedLabels) return named
  return withCreateLabels(named, words, (label, key) => derivedLabels.has(key) && keepLabel(label, { derivedLabel: derivedLabels.get(key) }))
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
export async function modelTurn(before, current, words, { snippets = [], gateCtx = {}, converse = converseTurn, keepCreateName = null, keepCreateLabel = null, signal = null, browserRefusal = null, checkScript = undefined, chartOf = undefined } = {}) {
  const res = await converse({ message: words, state: before, gateCtx, snippets, signal, ...(browserRefusal ? { browserRefusal } : {}) })
  // ⭐ STOP (2026-11-16) — the member stopped waiting. Whatever came back (or did not) is
  // NOT read: no reply, no patch, no refusal. Checked on the signal as well as the gate,
  // so an answer that landed in the same instant as the press is dropped too.
  if ((signal && signal.aborted) || (res && res.gate === STOPPED_GATE)) {
    return { ok: false, state: null, changed: false, outcome: 'stopped', stopped: true,
      entries: [{ role: 'uct', kind: 'stopped', lines: [STOPPED_LINE, NOTHING_CHANGED] }] }
  }
  const unclear = distinctNotUnderstood(res).map((n) => `I didn't understand "${n.clause || n.text || ''}"${n.reason ? ` — ${n.reason}` : ''}.`)
  const gaps = [...unclear, ...unavailableLines(res)]
  const turn = classifyTurn(res)
  const said = (ok, entry, extra = {}) => ({ ok, state: null, changed: false, entries: [entry], outcome: turn.outcome, ...extra })
  if (turn.outcome === OUTCOMES.ANSWER && res && res.script) {
    // ⭐ THE ANSWER IS A SCRIPT (`scriptAnswer.js`): this window's own engine judges it. While it
    // does not run fully the engine's refusal goes back for a repair, a bounded number of times;
    // the entry leads with the ENGINE's verdict, whatever it is. The working indicator is not
    // touched: a script is opened in the script editor, never applied as a patch.
    // ⭐ `chartOf()` is the chart's bars and compute context NOW (asked per check: a repair is checked
    // on the bars of that moment), so the verdict is a real run on this chart (`scriptAnswer.checkScript`)
    const onChart = typeof chartOf === 'function'
      ? (pine, script) => (checkScript || defaultCheckScript)(pine, { chart: chartOf(), admission: script && script.admission })
      : checkScript
    const settled = await settleScript(res,
      (refusal) => converse({ message: words, state: before, gateCtx, snippets, signal, scriptRefusal: refusal }),
      { ...(onChart ? { check: onChart } : {}), cancelled: () => !!(signal && signal.aborted) })
    if (signal && signal.aborted) {
      return { ok: false, state: null, changed: false, outcome: 'stopped', stopped: true,
        entries: [{ role: 'uct', kind: 'stopped', lines: [STOPPED_LINE, NOTHING_CHANGED] }] }
    }
    return said(settled.verdict.runs, { ...settled.entry, lines: [...settled.entry.lines, ...gaps] }, { script: true, rounds: settled.rounds })
  }
  if (turn.outcome === OUTCOMES.ANSWER) {
    // ⭐ an answer may OFFER one action (add one of UCT's own built-in indicators): kept on the
    // entry only when it names a built-in this window shipped with
    const offer = liveOffer(res && res.offer)
    return said(true, { role: 'uct', kind: 'answer', reply: turn.reply, lines: [turn.reply, ...gaps], ...(offer ? { offer } : {}) })
  }
  if (turn.outcome === OUTCOMES.UNSUPPORTED) {
    return said(false, { role: 'uct', kind: 'unsupported', preflight: !!turn.preflight, gate: turn.gate || null,
      lines: [turn.reply || memberRefusal(turn.gate, turn.reason), ...gaps, NOTHING_CHANGED] })
  }
  if (turn.outcome === OUTCOMES.REFUSED) {
    const failure = clientFailureOf(turn.gate)
    if (failure) logStudioAction(before.lineage, 'turn_failed', { surface: 'studio', failure })
    return said(false, { role: 'uct', kind: 'refusal', gate: turn.gate,
      lines: [memberRefusal(turn.gate, turn.reason, { retryAfterS: res && res.retryAfterS }), ...gaps, NOTHING_CHANGED] }, { gate: turn.gate, reason: turn.reason })
  }
  // ⭐ BATCH 1 — a name the member gave in the same message rides in this envelope.
  const named = turn.outcome === OUTCOMES.CHANGE ? withMemberName(turn.envelope, words) : turn.envelope
  // ⭐ PACKAGE 3 seam (Agent, 2026-11-04 — AGENT-M3-CONTRACT §17): a caller that asks for it (`keepCreateName`, a
  // predicate — only UCT Agent passes one) keeps the model's `create` name as the definition's CUSTOM name, in the SAME
  // patch (an appended `rename_definition`: one revision, one Undo step). Only for the turn that CREATES the definition,
  // only when the member named nothing, and only for a name the predicate accepts. The dock never passes it: there,
  // `create` still takes the derived name (derivedName.js).
  // ⭐ 2026-11-16 — the predicate is also told the name the engine WOULD derive (a dry run of
  // the same patch against the same state; `applyTurn` writes nothing), so a caller can keep
  // the assistant's name only where the derived one is unreadable (`readableName.js`, the dock).
  // ⭐ 2026-11-17 — `keepCreateLabel` is the same seam for each line's label (`readableName.js`).
  const wantsName = (typeof keepCreateName === 'function' || typeof keepCreateLabel === 'function') && !before.working
  const envelope = wantsName ? nameFromAssistant(current(), named, words, gateCtx, keepCreateName, keepCreateLabel) : named
  const now = current()
  const out = applyTurn(now, envelope, { gateCtx, memberWords: words })
  const { result } = out
  if (result.status === 'refused') {
    const refusal = said(false, { role: 'uct', kind: 'refusal', codes: (result.errors || []).map((e) => e.code),
      details: (result.errors || []).map((e) => memberError(e).detail),
      lines: [...(result.errors || []).map((e) => errorWords(e, now.working)), ...gaps, NOTHING_CHANGED] }, { errors: result.errors || [] })
    // ⭐ 2026-11-17 — ONE REPAIR, WITH THIS ENGINE'S OWN WORDS. The door offered a change and this
    // engine refused it: before the member reads "Nothing was changed" for a request the assistant
    // built, the same turn goes back once with the refused patch and why (`converseClient.
    // browserRefusalBlock`). Once: a turn that is already that repair is never repaired again, so a
    // request costs at most one extra round trip. Whatever the repair turn says is what the member
    // reads, except the door's own refusal of it (an allowance, the network): that says nothing
    // about the request, so the member reads this engine's refusal instead.
    const repairable = turn.outcome === OUTCOMES.CHANGE && !browserRefusal && !(signal && signal.aborted)
      && turn.envelope && (result.errors || []).length > 0
    if (!repairable) return refusal
    const again = await modelTurn(before, current, words, { snippets, gateCtx, converse, keepCreateName, keepCreateLabel, signal,
      browserRefusal: { envelope: turn.envelope, errors: (result.errors || []).map((e) => memberError(e).detail) } })
    if (again.stopped) return again
    return again.outcome === OUTCOMES.REFUSED ? refusal : { ...again, repairedAfterRefusal: true }
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
      lines: [...replyLines(out.readback, out.state, result.changes), ...unclear],
      // ⭐ 2026-11-16 (Studio plan, section 5) — WHAT THE ASSISTANT SAYS IT BUILT, kept apart from
      // the engine's words above and labelled as the assistant's by the dock. The engine's lines
      // stay the authority; this is the plain sentence a member checks their request against
      // (a read-back like "1 when (the 10-bar exponential average ...) and 0 otherwise" is true
      // and hard to read). ⛔ Its own field, NOT `reply`: `snippetOf` reads `reply`, and what is
      // sent back to the model as context must not change.
      ...(saidOf(turn.reply) ? { said: saidOf(turn.reply) } : {}) }] }
}

/**
 * ⭐ 2026-11-01 — the planner's `unavailable` notes, in member words, and ONLY beside a turn
 * that built nothing. They name a SCREENER column the formula grammar cannot read (a text
 * label: `candle_matches`, `bar_character`, `sector`). On a chart the model often builds the
 * idea from bars instead ("mark a doji", "every inside day"), and the old line then sat
 * under a working indicator saying "candle_matches isn't available yet — TEXT -- the
 * Candle Matches column…": an internal column name, manifest prose, and false. The model
 * is never told these notes (`definition_conversation._language_notes`), so a change it
 * made is its own answer; the read-back above describes exactly what was built.
 */
export function unavailableLines(res) {
  const seen = new Set()
  const out = []
  for (const n of (res && res.unavailable) || []) {
    const phrase = String((n && (n.phrase || n.column || n.name)) || '').trim()
    if (!phrase || seen.has(phrase.toLowerCase())) continue
    seen.add(phrase.toLowerCase())
    // ⛔ NOT "a text label": most excluded columns are numbers (enterprise value, EPS), live-only or
    // dates. And never the manifest's `reason`, which is internal prose ("TEXT -- ...").
    out.push(`“${phrase}” is in UCT's screener data, which a chart formula can't read.`)
  }
  return out
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

/** One line per output, as the read-back says it. */
const outputLinesOf = (rb) => (rb.outputs || [])
  .map((o) => (o.phrase ? `${o.name || o.label} — ${o.phrase}` : o.sentence)).filter(Boolean)

/**
 * ⭐ V1 (2026-11-16) — THE EARLIER STEPS OF THIS DRAFT, oldest first: what the indicator
 * WAS before each applied change, said by the same read-back the card uses (never model
 * prose, never the member's words). `index` is the place in `state.history` that
 * `goBackToTurn` takes. A step with no indicator yet (before the first build) is `empty`.
 * @returns {{index: number, step: number, empty: boolean, name: string|null, lines: string[]}[]}
 */
export function historySteps(cur, gateCtx = {}) {
  return ((cur && cur.history) || []).map((snap, index) => {
    if (!snap.working) return { index, step: index + 1, empty: true, name: null, lines: [] }
    const rb = readback(snap.working, snap, gateCtx)
    return { index, step: index + 1, empty: false, name: rb.name || null, lines: outputLinesOf(rb) }
  })
}

/** Go back to an earlier step. @returns null (no such step) | `{state, entry, steps}` where
 *  `steps` is how many applied changes were taken back. */
export function goBackToTurn(cur, index, gateCtx = {}) {
  if (!cur || !Number.isInteger(index) || index < 0 || index >= cur.history.length) return null
  const steps = cur.history.length - index
  const next = undoToState(cur, index)
  const after = readback(next.working, next, gateCtx)
  const head = steps === 1 ? 'Undid the last change.' : `Went back ${steps} changes.`
  return { state: next, steps, entry: { role: 'uct', kind: 'undo', lines: next.working
    ? [head, ...outputLinesOf(after)]
    : [`${head} The chart preview is cleared.`] } }
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
  // ⭐ L7: the stored definition's own id (its strict shape, never a name), so the owner report
  // can ask a week later whether it is still kept
  const savedId = stored.row && typeof stored.row.def_id === 'string' && /^u_[0-9a-f]{12}$/.test(stored.row.def_id)
    ? stored.row.def_id : undefined
  logStudioAction(cur.lineage, 'saved', { surface: 'studio', created: !!stored.created, origin: 'native',
    kinds: definitionKinds(stored.storedDoc, stored.requests), def_id: savedId })
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
