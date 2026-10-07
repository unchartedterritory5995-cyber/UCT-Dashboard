// app/src/components/chart/builder/studio/useIndicatorConversation.js
//
// ─── ⭐⭐ P2 TRACK B — ONE CONVERSATION OVER ONE WORKING DEFINITION ──────────
//
// The Create Indicator experience's state machine. It owns NOTHING mathematical:
// every turn goes through Track A's seams, unchanged —
//
//   converseTurn (the ONE client call to POST /converse — returns a patch, never
//   applies it)  →  applyTurn (the deterministic engine; atomic; a refused patch
//   returns the SAME state)  →  readback (computed from the RESULTING definition,
//   never from model prose)  →  storeConversation / attachConversation /
//   armConversationAlerts (the existing save doors; there is no private AI save).
//
// ⭐⭐ SLICE 2 — A TURN IS NOT "CHANGE MY INDICATOR". The server declares what each
// turn is (`classifyTurn`): an ANSWER or an UNSUPPORTED reply is the assistant's
// words and nothing else happens; a CLARIFY records its questions; only a CHANGE
// reaches the engine. What CHANGED is still never the model's prose: the lines
// under a change are built here from the engine's result — the output sentences
// (`sentence.js`), the engine's own disclosures (`result.changes`), assumptions
// recorded against a slot. The model `note` is not read.
//
// ⭐ SLICE 2 — THE CONVERSATION OUTLIVES THE DOCK. Given a `sessionKey` (the
// toolbar's opaque create context), the state, transcript and ack are kept in
// the in-memory session store on every change and restored on the next open.
// Discard and a completed Add to Chart end the session.
//
// ⚠️ `ConverseBox` (Track A's function-first panel inside BuilderSheet) runs the
// same orchestration inline. This hook is the shape it should converge on; it is
// a new file so Track A's files stay untouched while that track is live.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newAuthoringState, applyTurn, undo as undoState, readback, isDirty } from '../authoring'
import { converseTurn, transcriptSnippets, distinctNotUnderstood } from '../authoring/converseClient'
import { classifyTurn, OUTCOMES } from '../authoring/turnOutcome'
import { preflight } from '../authoring/preflight'
import { readSession, writeSession, clearSession } from '../authoring/conversationSessions'
import { storeConversation, attachConversation, armConversationAlerts } from '../conversationSave'
import { stampSemantics } from '../../engine/definitionSemantics'
import { OUTPUT_TYPES } from '../../engine/outputType'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'
import { memberError, memberSaveError } from '../authoring/memberWords'
import { outputNamer, slotWords } from '../authoring/readback'

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

const NOTHING_CHANGED = 'Nothing on the chart changed.'

/**
 * @param {object} p
 * @param {string|null} p.sym / p.tf   the chart the studio was opened over
 * @param {Function} [p.converse]      injectable client (tests / harness)
 * @param {string|null} [p.sessionKey] the opaque authoring context to keep the
 *                                     conversation under while the dock is closed
 */
export default function useIndicatorConversation({ sym = null, tf = null, converse = converseTurn, sessionKey = null } = {}) {
  // ⭐ Restored once, at mount — the same key reopened is the same conversation.
  const [initial] = useState(() => readSession(sessionKey))
  const [state, setState] = useState(() => (initial && initial.state) || newAuthoringState())
  const stateRef = useRef(state)
  const commit = useCallback((next) => { stateRef.current = next; setState(next) }, [])
  const [transcript, setTranscript] = useState(() => (initial && initial.transcript) || [])
  const transcriptRef = useRef(transcript)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acked, setAcked] = useState(() => !!(initial && initial.acked))
  /** Bumped on every applied change — the "Updated preview" cue keys off it. */
  const [changeSeq, setChangeSeq] = useState(0)
  const restored = !!(initial && ((initial.transcript && initial.transcript.length) || (initial.state && initial.state.working)))
  const gateCtx = useMemo(() => ({ tf, symbol: sym }), [tf, sym])

  // Keep the session current. Nothing to keep (a fresh, untouched dock) is not
  // stored, so opening and closing an empty dock leaves no session behind.
  const ended = useRef(false)
  useEffect(() => {
    if (!sessionKey || ended.current) return
    if (!transcript.length && !state.working) return
    writeSession(sessionKey, { state, transcript, acked })
  }, [sessionKey, state, transcript, acked])

  const say = useCallback((entry) => {
    setTranscript((t) => {
      const next = [...t, { id: t.length, ...entry }]
      transcriptRef.current = next
      return next
    })
  }, [])

  const rb = useMemo(() => readback(state.working, state, gateCtx), [state, gateCtx])

  const send = useCallback(async (text) => {
    const words = String(text || '').trim()
    if (!words || busy) return false
    const before = stateRef.current
    // ⭐ P3: the assistant's own replies (answer AND change) ride along as context.
    const snippets = transcriptSnippets(transcriptRef.current)
    say({ role: 'member', text: words })

    // ⭐ SLICE 2 PRE-FLIGHT — an explicit other-symbol / other-timeframe request is
    // answered here: no request leaves the browser, so no model call, no cost.
    // (A latency shortcut: the server runs the same rules on every turn.)
    const caught = preflight(words, { sym, tf })
    if (caught) {
      say({ role: 'uct', kind: 'unsupported', preflight: true, gate: caught.gate, lines: [caught.reason, NOTHING_CHANGED] })
      return false
    }

    setBusy(true)
    try {
      const res = await converse({ message: words, state: before, gateCtx, snippets })
      const gaps = [
        ...distinctNotUnderstood(res).map((n) => `I didn't understand "${n.clause || n.text || ''}"${n.reason ? ` — ${n.reason}` : ''}.`),
        ...((res && res.unavailable) || []).map((n) => `${n.column || n.name || 'That'} isn't available yet${n.reason ? ` — ${n.reason}` : ''}.`),
      ]
      const turn = classifyTurn(res)
      // ⛔ ANSWER / UNSUPPORTED / REFUSED: the assistant's words, and NOTHING else.
      // `state` is not touched — not even replaced with an equal copy.
      if (turn.outcome === OUTCOMES.ANSWER) {
        say({ role: 'uct', kind: 'answer', reply: turn.reply, lines: [turn.reply, ...gaps] })
        return true
      }
      if (turn.outcome === OUTCOMES.UNSUPPORTED) {
        say({ role: 'uct', kind: 'unsupported', preflight: !!turn.preflight, gate: turn.gate || null,
          lines: [turn.reply || turn.reason, ...gaps, NOTHING_CHANGED] })
        return false
      }
      if (turn.outcome === OUTCOMES.REFUSED) {
        say({ role: 'uct', kind: 'refusal', gate: turn.gate,
          lines: [turn.reason, ...gaps, NOTHING_CHANGED] })
        return false
      }
      // ⛔ CLARIFY / CHANGE: THE ENGINE DECIDES. A stale or invalid patch is refused
      // atomically and the working definition is untouched (`applyTurn` returns
      // the same state).
      const out = applyTurn(stateRef.current, turn.envelope, { gateCtx })
      const { result } = out
      if (result.status === 'refused') {
        say({ role: 'uct', kind: 'refusal', codes: (result.errors || []).map((e) => e.code),
          details: (result.errors || []).map((e) => memberError(e).detail),
          lines: [...(result.errors || []).map((e) => errorWords(e, stateRef.current.working)), ...gaps, NOTHING_CHANGED] })
        return false
      }
      if (result.status === 'question') {
        commit(out.state)
        say({ role: 'uct', kind: 'question', questions: out.state.questions, reply: turn.reply || '',
          lines: [...(turn.reply ? [turn.reply] : []), ...gaps, ...out.state.questions.map((q) => q.text)] })
        return true
      }
      commit(out.state)
      setAcked(false)
      setChangeSeq((n) => n + 1)
      say({ role: 'uct', kind: before.working ? 'patched' : 'created', revision: out.state.revision, updated: true,
        reply: turn.reply || '',
        lines: [...replyLines(out.readback, out.state, result.changes), ...gaps] })
      return true
    } finally {
      setBusy(false)
    }
  }, [busy, converse, gateCtx, sym, tf, commit, say])

  const undo = useCallback(() => {
    const cur = stateRef.current
    if (!cur.history.length || busy || saving) return false
    const next = undoState(cur)
    commit(next)
    setAcked(false)
    setChangeSeq((n) => n + 1)
    const after = readback(next.working, next, gateCtx)
    say({ role: 'uct', kind: 'undo', lines: next.working
      ? ['Undid the last change.', ...(after.outputs || []).map((o) => (o.phrase ? `${o.name || o.label} — ${o.phrase}` : o.sentence)).filter(Boolean)]
      : ['Undid the last change. The chart preview is cleared.'] })
    return true
  }, [busy, saving, commit, gateCtx, say])

  /**
   * Commit through the EXISTING doors. `settings` must be the STORED blob (never
   * the preview read view) and `onChange` the chart's own settings writer.
   * `beforeAttach` runs after the server accepted the definition and before the
   * chart gains the durable instance — the moment the preview must go, so the
   * chart never draws the preview and the saved indicator together.
   */
  const save = useCallback(async ({ settings = null, onChange = null, beforeAttach = null } = {}) => {
    const cur = stateRef.current
    if (!cur.working || saving || busy) return { ok: false }
    setSaving(true)
    try {
      const stored = await storeConversation(cur, { previewAcked: acked })
      if (!stored.ok) {
        const m = memberSaveError(stored)
        say({ role: 'uct', kind: 'refusal', codes: [m.code], details: [m.detail], lines: ['Not saved.', m.text] })
        return { ok: false, error: stored.error }
      }
      if (typeof beforeAttach === 'function') beforeAttach()
      const attached = attachConversation({ storedDoc: stored.storedDoc, created: stored.created, requests: stored.requests, settings })
      if (settings && onChange && attached.settings !== settings) onChange(attached.settings)
      const alerts = await armConversationAlerts({ storedDoc: stored.storedDoc, requests: stored.requests, sym, tf, instanceId: attached.instanceId })
      const outcomes = [...attached.outcomes, ...alerts]
      say({ role: 'uct', kind: 'saved', lines: outcomes.map((o) => o.text), outcomes })
      // Creation is complete (the dock closes on it): this context's session ends,
      // so the next Create Indicator starts a new definition.
      ended.current = true
      clearSession(sessionKey)
      return { ok: true, storedDoc: stored.storedDoc, instanceId: attached.instanceId, outcomes }
    } finally {
      setSaving(false)
    }
  }, [saving, busy, acked, sym, tf, say, sessionKey])

  /** Discard: the member threw this draft away on purpose. */
  const discard = useCallback(() => {
    ended.current = true
    clearSession(sessionKey)
  }, [sessionKey])

  /** The working definition, under the studio's preview id, semantics-stamped the
   *  way every Builder preview is (no prior: this is a new indicator).
   *  ⭐ Re-installing it under the same id after a patch DOES replace the copy:
   *  the registry's install key includes `compute.fn`, the tree's sha256
   *  (pinned in `chartPreview.test.js`). */
  const previewDefinition = useMemo(() => {
    if (!state.working) return null
    return stampSemantics({ ...state.working, id: STUDIO_PREVIEW_DEF_ID }, { prior: null })
  }, [state.working])

  const lastEntry = transcript.length ? transcript[transcript.length - 1] : null
  const questions = lastEntry && lastEntry.kind === 'question' ? (lastEntry.questions || []) : []
  const needsAck = rb.needsAck || []
  const dirty = isDirty(state)

  // ⭐ P3 UX — the draft lives in this tab's memory only (✕ keeps it, by design):
  // a reload or a closed tab would lose an unsaved draft silently, so ask first.
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  return {
    state, transcript, rb, busy, saving, acked, setAcked, needsAck, questions, changeSeq,
    previewDefinition, send, undo, save, discard, dirty, restored,
    canUndo: state.history.length > 0 && !busy && !saving,
    canSave: dirty && !busy && !saving && (!needsAck.length || acked),
  }
}
