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
// ⛔ THE MODEL'S PROSE IS NEVER SHOWN. Every UCT line in the transcript is built
// here from the engine's result: the output sentences (`sentence.js`), the
// engine's own disclosures (`result.changes`), assumptions recorded against a
// slot. The model `note` is not read.
//
// ⚠️ `ConverseBox` (Track A's function-first panel inside BuilderSheet) runs the
// same orchestration inline. This hook is the shape it should converge on; it is
// a new file so Track A's files stay untouched while that track is live.

import { useCallback, useMemo, useRef, useState } from 'react'
import { newAuthoringState, applyTurn, undo as undoState, readback } from '../authoring'
import { converseTurn } from '../authoring/converseClient'
import { storeConversation, attachConversation, armConversationAlerts } from '../conversationSave'
import { stampSemantics } from '../../engine/definitionSemantics'
import { OUTPUT_TYPES } from '../../engine/outputType'
import { STUDIO_PREVIEW_DEF_ID } from './chartPreview'

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

/** A refused engine error, without engine jargon. The code stays on the entry. */
const errorWords = (e) => String((e && e.message) || 'That change could not be applied.')

/**
 * The deterministic lines a UCT reply carries after a successful turn: what each
 * output now computes, then anything assumed THIS turn.
 */
export function replyLines(rb, state, changes = []) {
  const lines = []
  for (const c of changes) { const w = changeWords(c); if (w) lines.push(w) }
  for (const o of rb.outputs || []) {
    if (o.sentence) lines.push(o.sentence)
  }
  for (const a of state.assumptions || []) {
    if (a.revision !== state.revision) continue
    if (a.label !== undefined) lines.push(`Using ${a.label} = ${a.value}.`)
    else if (a.source === 'engine') lines.push(`Default: ${a.text}.`)
  }
  return lines
}

/**
 * @param {object} p
 * @param {string|null} p.sym / p.tf   the chart the studio was opened over
 * @param {Function} [p.converse]      injectable client (tests / harness)
 */
export default function useIndicatorConversation({ sym = null, tf = null, converse = converseTurn } = {}) {
  const [state, setState] = useState(() => newAuthoringState())
  const stateRef = useRef(state)
  const commit = useCallback((next) => { stateRef.current = next; setState(next) }, [])
  const [transcript, setTranscript] = useState([])
  const transcriptRef = useRef(transcript)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acked, setAcked] = useState(false)
  /** Bumped on every applied change — the "Updated on chart" cue keys off it. */
  const [changeSeq, setChangeSeq] = useState(0)
  const gateCtx = useMemo(() => ({ tf, symbol: sym }), [tf, sym])

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
    setBusy(true)
    const before = stateRef.current
    const snippets = transcriptRef.current.slice(-6).map((t) => (t.role === 'member'
      ? { role: 'member', text: t.text }
      : { role: 'assistant', text: (t.lines || []).join(' · ') }))
    say({ role: 'member', text: words })
    try {
      const res = await converse({ message: words, state: before, gateCtx, snippets })
      const gaps = [
        ...((res && res.notUnderstood) || []).map((n) => `I didn't understand "${n.clause || n.text || ''}"${n.reason ? ` — ${n.reason}` : ''}.`),
        ...((res && res.unavailable) || []).map((n) => `${n.column || n.name || 'That'} isn't available yet${n.reason ? ` — ${n.reason}` : ''}.`),
      ]
      if (!res || !res.ok) {
        say({ role: 'uct', kind: 'refusal', gate: res && res.gate,
          lines: [(res && res.reason) || 'UCT Intelligence could not answer that.', ...gaps, 'Nothing on the chart changed.'] })
        return false
      }
      // ⛔ THE ENGINE DECIDES. A stale or invalid patch is refused atomically and
      // the working definition is untouched (`applyTurn` returns the same state).
      const out = applyTurn(stateRef.current, res.envelope, { gateCtx })
      const { result } = out
      if (result.status === 'refused') {
        say({ role: 'uct', kind: 'refusal', codes: (result.errors || []).map((e) => e.code),
          lines: [...(result.errors || []).map(errorWords), ...gaps, 'Nothing on the chart changed.'] })
        return false
      }
      commit(out.state)
      setAcked(false)
      if (result.status === 'question') {
        say({ role: 'uct', kind: 'question', questions: out.state.questions,
          lines: [...gaps, ...out.state.questions.map((q) => q.text)] })
        return true
      }
      setChangeSeq((n) => n + 1)
      say({ role: 'uct', kind: before.working ? 'patched' : 'created', revision: out.state.revision,
        lines: [...replyLines(out.readback, out.state, result.changes), ...gaps] })
      return true
    } finally {
      setBusy(false)
    }
  }, [busy, converse, gateCtx, commit, say])

  const undo = useCallback(() => {
    const cur = stateRef.current
    if (!cur.history.length || busy || saving) return false
    const next = undoState(cur)
    commit(next)
    setAcked(false)
    setChangeSeq((n) => n + 1)
    const after = readback(next.working, next, gateCtx)
    say({ role: 'uct', kind: 'undo', lines: next.working
      ? ['Undid the last change.', ...(after.outputs || []).map((o) => o.sentence).filter(Boolean)]
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
        say({ role: 'uct', kind: 'refusal', lines: ['Not saved.', stored.error] })
        return { ok: false, error: stored.error }
      }
      if (typeof beforeAttach === 'function') beforeAttach()
      const attached = attachConversation({ storedDoc: stored.storedDoc, created: stored.created, requests: stored.requests, settings })
      if (settings && onChange && attached.settings !== settings) onChange(attached.settings)
      const alerts = await armConversationAlerts({ storedDoc: stored.storedDoc, requests: stored.requests, sym, tf, instanceId: attached.instanceId })
      const outcomes = [...attached.outcomes, ...alerts]
      say({ role: 'uct', kind: 'saved', lines: outcomes.map((o) => o.text), outcomes })
      return { ok: true, storedDoc: stored.storedDoc, instanceId: attached.instanceId, outcomes }
    } finally {
      setSaving(false)
    }
  }, [saving, busy, acked, sym, tf, say])

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

  return {
    state, transcript, rb, busy, saving, acked, setAcked, needsAck, questions, changeSeq,
    previewDefinition, send, undo, save,
    canUndo: state.history.length > 0 && !busy && !saving,
    canSave: !!state.working && !busy && !saving && (!needsAck.length || acked),
  }
}
