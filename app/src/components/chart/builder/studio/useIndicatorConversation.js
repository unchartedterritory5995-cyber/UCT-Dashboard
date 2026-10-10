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
import { readback, isDirty } from '../authoring'
import { converseTurn, transcriptSnippets } from '../authoring/converseClient'
import { writeSession, clearSession, holdInDock, releaseDock } from '../authoring/conversationSessions'
import { logStudioAction } from '../authoring/studioTelemetry'
// ⭐ M3 S1 — the turn / Undo / Save / restore steps live in `authoring/authoringSession.js`
// (moved verbatim) so the dock and UCT Agent run ONE pipeline. This hook is the React
// wrapper: it holds the state, numbers the transcript entries and keeps the session.
import {
  restoreConversation, initialConversationState, initialTranscript, hasSomethingToKeep,
  localTurn, modelTurn, undoTurn, saveConversation, noteDiscarded, previewDefinitionOf,
} from '../authoring/authoringSession'

// Re-exported for existing importers (the functions moved with the pipeline).
export { typeWord, replyLines } from '../authoring/authoringSession'

/**
 * @param {object} p
 * @param {string|null} p.sym / p.tf   the chart the studio was opened over
 * @param {Function} [p.converse]      injectable client (tests / harness)
 * @param {string|null} [p.sessionKey] the opaque authoring context to keep the
 *                                     conversation under while the dock is closed
 * @param {{def: object, defId: string, version: number}|null} [p.open] ⭐ PHASE 4 —
 *   an EXISTING user definition to edit (the store's row). The studio opens it as
 *   its working snapshot: OPEN != MUTATE — nothing is written until Save, and an
 *   opened, untouched definition is clean.
 */
export default function useIndicatorConversation({ sym = null, tf = null, converse = converseTurn, sessionKey = null, open = null } = {}) {
  // ⭐ Restored once, at mount — the same key reopened is the same conversation.
  // ⭐ PHASE 4 — an EDIT's draft is restored only while it was opened from the
  // version that is STILL the stored one; a draft of an older version is stale
  // and the studio reopens the definition as it is now.
  // ⭐⭐ BATCH 1 — …AND A DRAFT KEPT ACROSS A RELOAD (`recovered`) IS CHECKED BEFORE IT
  // OPENS: its working definition must still pass the registry's own validation, and
  // an edit's base version must still be the stored one. Otherwise it is dropped —
  // never opened over a newer saved definition — and the member is told why.
  const [{ initial, dropped }] = useState(() => restoreConversation(sessionKey, open))
  const [state, setState] = useState(() => initialConversationState(initial, open))
  const stateRef = useRef(state)
  const commit = useCallback((next) => { stateRef.current = next; setState(next) }, [])
  const [transcript, setTranscript] = useState(() => initialTranscript(initial, open))
  const transcriptRef = useRef(transcript)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acked, setAcked] = useState(() => !!(initial && initial.acked))
  /** Bumped on every applied change — the "Updated preview" cue keys off it. */
  const [changeSeq, setChangeSeq] = useState(0)
  const restored = !!(initial && ((initial.transcript && initial.transcript.length) || (initial.state && initial.state.working)))
  /** ⭐ BATCH 1 — restored from before a page reload (not just a closed dock). */
  const recovered = restored && !!initial.recovered
  /** ⭐ PHASE 4 — true while this studio edits a stored definition. */
  const editing = !!(state.defId && Number.isInteger(state.baseVersion))
  const gateCtx = useMemo(() => ({ tf, symbol: sym }), [tf, sym])

  // Keep the session current. Nothing to keep (a fresh, untouched dock) is not
  // stored, so opening and closing an empty dock leaves no session behind.
  // ⭐ PHASE 4 — an opened, untouched definition is "nothing to keep" too.
  const ended = useRef(false)
  useEffect(() => {
    if (!sessionKey || ended.current) return
    if (!hasSomethingToKeep({ state, transcript, open })) return
    // ⭐ BATCH 1 — mirrored into this tab's sessionStorage, so a reload keeps it too
    // (an answer-only conversation included).
    writeSession(sessionKey, { state, transcript, acked }, { persist: true })
  }, [sessionKey, state, transcript, acked, open])

  // ⭐ M3 (D6) — while this dock is open on `sessionKey` it OWNS that draft: UCT Agent's
  // writes on the same draft are refused until it closes.
  useEffect(() => {
    if (!sessionKey) return undefined
    holdInDock(sessionKey)
    return () => releaseDock(sessionKey)
  }, [sessionKey])

  const say = useCallback((entry) => {
    setTranscript((t) => {
      const next = [...t, { id: t.length, ...entry }]
      transcriptRef.current = next
      return next
    })
  }, [])

  // ⭐ ROLLOUT FUNNEL — the dock was opened on this conversation (once; de-duplicated
  // server-side per lineage).
  useEffect(() => { logStudioAction(stateRef.current.lineage, 'opened', { surface: 'studio' }) }, [])

  const rb = useMemo(() => readback(state.working, state, gateCtx), [state, gateCtx])

  /** One outcome of the shared pipeline, applied to this hook's React state. */
  const take = useCallback((out) => {
    if (out.state) commit(out.state)
    if (out.changed) { setAcked(false); setChangeSeq((n) => n + 1) }
    for (const e of out.entries) say(e)
    return out.ok
  }, [commit, say])

  const send = useCallback(async (text) => {
    const words = String(text || '').trim()
    if (!words || busy) return false
    const before = stateRef.current
    // ⭐ P3: the assistant's own replies (answer AND change) ride along as context.
    const snippets = transcriptSnippets(transcriptRef.current)
    say({ role: 'member', text: words })
    // the local half (pre-flight, a name-only message) — no request leaves the browser
    const local = localTurn(before, words, { sym, tf, gateCtx })
    if (local) return take(local)
    setBusy(true)
    try {
      return take(await modelTurn(before, () => stateRef.current, words, { snippets, gateCtx, converse }))
    } finally {
      setBusy(false)
    }
  }, [busy, converse, gateCtx, sym, tf, say, take])

  const undo = useCallback(() => {
    const cur = stateRef.current
    if (!cur.history.length || busy || saving) return false
    const out = undoTurn(cur, gateCtx)
    commit(out.state)
    setAcked(false)
    setChangeSeq((n) => n + 1)
    say(out.entry)
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
      const out = await saveConversation(cur, { acked, settings, onChange, beforeAttach, sym, tf })
      say(out.entry)
      if (!out.ok) return { ok: false, error: out.error }
      // Creation is complete (the dock closes on it): this context's session ends,
      // so the next Create Indicator starts a new definition. ⭐ PHASE 4 — an edit
      // ends the same way: the store's row is the authority again.
      ended.current = true
      clearSession(sessionKey)
      return { ok: true, storedDoc: out.storedDoc, instanceId: out.instanceId, outcomes: out.outcomes, receipt: out.receipt }
    } finally {
      setSaving(false)
    }
  }, [saving, busy, acked, sym, tf, say, sessionKey])

  /** Discard: the member threw this draft away on purpose. */
  const discard = useCallback(() => {
    noteDiscarded(stateRef.current)
    ended.current = true
    clearSession(sessionKey)
  }, [sessionKey])

  /** The working definition, under the studio's preview id, semantics-stamped the
   *  way every Builder preview is (no prior: this is a new indicator).
   *  ⭐ Re-installing it under the same id after a patch DOES replace the copy:
   *  the registry's install key includes `compute.fn`, the tree's sha256
   *  (pinned in `chartPreview.test.js`). */
  const previewDefinition = useMemo(() => previewDefinitionOf({ working: state.working, base: state.base }), [state.working, state.base])

  // ⭐ BATCH 1 — the OPEN questions are the state's (`applyTurn` clears them when a
  // change lands; undo restores them), not the last transcript entry's: a question
  // answered with "what does that mean?" keeps its choice buttons.
  const questions = state.questions || []
  const needsAck = rb.needsAck || []
  const dirty = isDirty(state)
  const unsaved = dirty || transcript.some((t) => t && t.role === 'member')

  // ⭐ P3 UX — ✕ keeps the draft by design, and BATCH 1 keeps it across a reload of
  // this tab (sessionStorage). Closing the TAB still ends it, so ask first — for an
  // answer-only conversation too, which would otherwise vanish without a word.
  useEffect(() => {
    if (!unsaved || typeof window === 'undefined') return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  return {
    state, transcript, rb, busy, saving, acked, setAcked, needsAck, questions, changeSeq,
    previewDefinition, send, undo, save, discard, dirty, restored, recovered, dropped, editing,
    canUndo: state.history.length > 0 && !busy && !saving,
    canSave: dirty && !busy && !saving && (!needsAck.length || acked),
  }
}
