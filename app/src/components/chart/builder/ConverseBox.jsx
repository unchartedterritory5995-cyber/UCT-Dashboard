// app/src/components/chart/builder/ConverseBox.jsx
//
// ─── ⭐⭐ P2 — BUILD AN INDICATOR BY CONVERSATION (function first) ────────────
//
// THE MODEL DOES NOT OWN THE INDICATOR. Each member turn goes to the server,
// which answers with a structured PATCH envelope (or a refusal). The patch is
// applied here by the deterministic engine (`applyTurn`, atomic) to a WORKING
// definition held in memory, and UCT's reply is the READBACK computed from the
// resulting definition — never the model's prose. The model `note` is not
// shown at all.
//
// ⛔ Nothing is stored until Save, and Save is the existing door
// (`conversationSave.js`: prepareSave → saveUserDefinition → install →
// addInstance → the stored info-value / alert requests).
//
// ⛔ A refused patch changes nothing; the failing op is named. "Apply just the
// valid part" is an explicit member choice that sends a NEW patch through the
// same engine door — never automatic.
//
// ⛔ A question turn applies nothing; its choices are buttons that send the
// answer as the next turn.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  newAuthoringState, openAuthoringState, applyTurn, undo, readback, PATCH_CONTRACT,
} from './authoring'
import { converseTurn } from './authoring/converseClient'
import { storeConversation, attachConversation, armConversationAlerts } from './conversationSave'
import PreviewPane from './editor/PreviewPane'
import { CONVERSE_PREVIEW_DEF_ID } from './editor/previewDefinition'
import { stampSemantics } from '../engine/definitionSemantics'

const S = {
  box: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-surface)' },
  head: { fontSize: 12, color: 'var(--text-muted)', letterSpacing: 0.4 },
  identity: { fontSize: 13, color: 'var(--text-heading)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' },
  muted: { fontSize: 11, color: 'var(--text-muted)' },
  list: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--text)' },
  transcript: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' },
  member: { alignSelf: 'flex-end', fontSize: 13, color: 'var(--text-bright)', background: 'var(--bg-elevated)', padding: '6px 10px', borderRadius: 'var(--radius-md)' },
  uct: { fontSize: 12, color: 'var(--text)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' },
  refusal: { fontSize: 12, color: 'var(--text-bright)', padding: '6px 10px', border: '1px solid var(--loss-border)', background: 'var(--loss-bg)', borderRadius: 'var(--radius-md)' },
  input: { width: '100%', minHeight: 48, padding: '8px 10px', resize: 'vertical', background: 'var(--bg-surface)', color: 'var(--text-bright)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 13 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  button: { minHeight: 'var(--tap-min)', padding: '0 12px', background: 'var(--bg-elevated)', color: 'var(--text-bright)', border: '1px solid var(--border-accent)', borderRadius: 'var(--radius-md)', fontSize: 13, cursor: 'pointer' },
  primary: { minHeight: 'var(--tap-min)', padding: '0 12px', background: 'var(--ut-gold-dim)', color: 'var(--text-heading)', border: '1px solid var(--ut-gold)', borderRadius: 'var(--radius-md)', fontSize: 13, cursor: 'pointer' },
}
const dim = (style, disabled) => (disabled ? { ...style, opacity: 0.45, cursor: 'not-allowed' } : style)

/** Deterministic words for the engine's own disclosures (not model prose). */
function changeLine(c) {
  switch (c.kind) {
    case 'type-changed': return `${c.output} is now ${c.to} (was ${c.from}).`
    case 'refused-on-chart': return `${c.output} cannot be drawn here: ${c.text}`
    case 'foreign-source-replaced': return `${c.output}'s imported ${c.dialect || ''} text is replaced by the canonical formula (the original is kept aside).`
    case 'requests-cleared': return `Requests on ${c.output} were cancelled with it.`
    case 'intent-cleared': return `The signal choice on ${c.output} was cleared with it.`
    case 'paint-removed': return c.text ? `${c.output}: ${c.text}` : null
    default: return null
  }
}

const opWords = (op) => `${op.op}${op.output ? ` on ${op.output}` : ''}`

/** One errors[] entry → a sentence that names the op. */
function errorLine(e, ops) {
  const op = Number.isInteger(e.op) && ops && ops[e.op] ? ops[e.op] : null
  const where = op ? `Change ${e.op + 1} (${opWords(op)})` : `The result as a whole${e.output ? ` (output ${e.output})` : ''}`
  return `${where} was refused: ${e.message} [${e.code}]`
}

/**
 * @param {object} props
 * @param {object|null} props.settings  the chart's settings (null off-chart)
 * @param {Function|null} props.onChange the chart's settings writer
 * @param {string|null} props.sym / props.tf  the chart the sheet was opened over
 * @param {{defId, version, prior}|null} props.editing the sheet's stored definition being edited
 * @param {boolean} props.disabled
 * @param {Function} props.converse  injectable converse client (tests)
 */
export default function ConverseBox({
  settings = null, onChange = null, sym = null, tf = null, editing = null, disabled = false,
  converse = converseTurn,
}) {
  const [state, setState] = useState(() => newAuthoringState())
  const stateRef = useRef(state)
  const commit = useCallback((next) => { stateRef.current = next; setState(next) }, [])
  /** The revision at the last save/open; `null` = never saved. */
  const [savedRevision, setSavedRevision] = useState(null)
  const [savedVersion, setSavedVersion] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acked, setAcked] = useState(false)
  /** The last refused envelope, for the explicit "apply just the valid part". */
  const [partial, setPartial] = useState(null)
  /** The stored document this session last opened or saved — the `prior` the
   *  preview's semantics rule reads, exactly as the sheet's preview does. */
  const storedRef = useRef(null)
  const gateCtx = useMemo(() => ({ tf, symbol: sym }), [tf, sym])
  const say = useCallback((entry) => setTranscript((t) => [...t, { id: t.length, ...entry }]), [])

  const rb = useMemo(() => readback(state.working, state, gateCtx), [state, gateCtx])
  const unsaved = !!state.working && state.revision !== savedRevision
  const name = state.working && state.working.meta ? state.working.meta.name : null

  // A fresh ack per working definition: the member acknowledges what they see.
  useEffect(() => { setAcked(false) }, [state.working])

  /** Run one envelope through the engine and report. */
  const applyEnvelope = useCallback((envelope, extra = {}) => {
    const cur = stateRef.current
    const out = applyTurn(cur, envelope, { gateCtx })
    const { result } = out
    if (result.status === 'refused') {
      const ops = Array.isArray(envelope && envelope.ops) ? envelope.ops : []
      const alone = Array.isArray(result.wouldApplyAlone) ? result.wouldApplyAlone : []
      say({
        role: 'uct', kind: 'refusal',
        lines: [
          'Nothing was changed.',
          ...result.errors.map((e) => errorLine(e, ops)),
          // ⭐ the engine's own advisory: which ops fail even on their own
          ...(alone.length && alone.length < ops.length
            ? [`Cannot apply: ${ops.map((op, i) => (alone.includes(i) ? null : `change ${i + 1} (${opWords(op)})`)).filter(Boolean).join(', ')}.`]
            : []),
        ],
        errors: result.errors,
      })
      setPartial(alone.length > 0 && alone.length < ops.length
        ? { envelope, alone, baseRevision: cur.revision }
        : null)
      return
    }
    setPartial(null)
    commit(out.state)
    if (result.status === 'question') {
      say({ role: 'uct', kind: 'question', questions: out.state.questions, lines: out.readback.questions })
      return
    }
    const disclosed = (result.changes || []).map(changeLine).filter(Boolean)
    say({ role: 'uct', kind: extra.kind || 'readback', lines: [...disclosed, ...out.readback.lines] })
  }, [gateCtx, commit, say])

  const send = useCallback(async (text) => {
    const words = String(text || '').trim()
    if (!words || busy) return
    setBusy(true)
    const before = stateRef.current
    const snippets = transcript.slice(-6).map((t) => (t.role === 'member'
      ? { role: 'member', text: t.text }
      : { role: 'assistant', text: (t.lines || []).join(' · ') }))
    say({ role: 'member', text: words })
    setMessage('')
    try {
      const res = await converse({ message: words, state: before, gateCtx, snippets })
      const gaps = [
        ...((res && res.notUnderstood) || []).map((n) => `Not understood: "${n.clause || n.text || ''}" — ${n.reason || ''}`),
        ...((res && res.unavailable) || []).map((n) => `Not available: ${n.column || n.name || ''} — ${n.reason || ''}`),
      ]
      if (!res || !res.ok) {
        say({ role: 'uct', kind: 'refusal', lines: ['Nothing was changed.', (res && res.reason) || 'The assistant gave no usable answer.', ...gaps], gate: res && res.gate })
        setPartial(null)
        return
      }
      if (gaps.length) say({ role: 'uct', kind: 'gaps', lines: gaps })
      applyEnvelope(res.envelope)
    } finally {
      setBusy(false)
    }
  }, [busy, transcript, converse, gateCtx, say, applyEnvelope])

  const applyValidPart = useCallback(() => {
    if (!partial) return
    const cur = stateRef.current
    if (cur.revision !== partial.baseRevision) { setPartial(null); return }
    const ops = partial.alone.map((i) => partial.envelope.ops[i])
    say({ role: 'member', text: `Apply just the valid part (${ops.length} of ${partial.envelope.ops.length} changes).` })
    setPartial(null)
    applyEnvelope({
      contract: PATCH_CONTRACT, baseRevision: cur.revision, ops,
      assumptions: Array.isArray(partial.envelope.assumptions) ? partial.envelope.assumptions : [],
    })
  }, [partial, say, applyEnvelope])

  const undoLast = useCallback(() => {
    const cur = stateRef.current
    if (!cur.history.length) return
    const next = undo(cur)
    commit(next)
    setPartial(null)
    say({ role: 'uct', kind: 'undo', lines: ['Undid the last change.', ...readback(next.working, next, gateCtx).lines] })
  }, [commit, say, gateCtx])

  const openEditing = useCallback(() => {
    if (!editing || !editing.prior) return
    const next = openAuthoringState(editing.prior, { defId: editing.defId, version: editing.version })
    storedRef.current = editing.prior
    commit(next)
    setSavedRevision(next.revision)
    setSavedVersion(editing.version)
    setPartial(null)
    say({ role: 'uct', kind: 'opened', lines: [`Opened “${(editing.prior.meta && editing.prior.meta.name) || editing.defId}” (saved version ${editing.version}).`, ...readback(next.working, next, gateCtx).lines] })
  }, [editing, commit, say, gateCtx])

  const save = useCallback(async () => {
    const cur = stateRef.current
    if (!cur.working || saving) return
    setSaving(true)
    try {
      const stored = await storeConversation(cur, { previewAcked: acked })
      if (!stored.ok) {
        say({ role: 'uct', kind: 'refusal', lines: ['Not saved.', stored.error] })
        return
      }
      const attached = attachConversation({ storedDoc: stored.storedDoc, created: stored.created, requests: stored.requests, settings })
      if (settings && onChange && attached.settings !== settings) onChange(attached.settings)
      const alerts = await armConversationAlerts({ storedDoc: stored.storedDoc, requests: stored.requests, sym, tf, instanceId: attached.instanceId })
      // ⭐ THE STORE'S ROW IS NOW THE AUTHORITY: reopen from it, same lineage.
      const next = openAuthoringState(stored.storedDoc, {
        defId: stored.storedDoc.id, version: stored.storedDoc.version, lineage: cur.lineage,
      })
      storedRef.current = stored.storedDoc
      commit(next)
      setSavedRevision(next.revision)
      setSavedVersion(stored.storedDoc.version)
      setPartial(null)
      say({
        role: 'uct', kind: 'saved',
        lines: [`Saved — version ${stored.storedDoc.version}.`, ...[...attached.outcomes, ...alerts].map((o) => o.text)],
        outcomes: [...attached.outcomes, ...alerts],
      })
    } finally {
      setSaving(false)
    }
  }, [saving, acked, settings, onChange, sym, tf, commit, say])

  /** The preview draws the WHOLE working definition (every output, its
   *  presentation and placement) under its own transient id. */
  const previewDefinition = useMemo(() => {
    if (!state.working) return null
    return stampSemantics({ ...state.working, id: CONVERSE_PREVIEW_DEF_ID }, { prior: storedRef.current })
  }, [state.working])

  const lastQuestions = transcript.length && transcript[transcript.length - 1].kind === 'question'
    ? transcript[transcript.length - 1].questions : null
  const canUndo = state.history.length > 0 && !busy && !saving
  const needsAck = rb.needsAck || []
  const canSave = !!state.working && unsaved && !busy && !saving && !disabled && (!needsAck.length || acked)
  const offerOpen = editing && editing.prior && state.defId !== editing.defId

  return (
    <section style={S.box} aria-label="Build it by conversation" data-testid="converse">
      <div style={S.head}>Describe the indicator, then refine it — UCT shows exactly what will run</div>

      <div style={S.identity} data-testid="converse-identity"
        data-def-id={state.defId || ''} data-lineage={state.lineage} data-revision={state.revision}
        data-saved={unsaved ? 'unsaved' : (state.defId ? 'saved' : 'none')}>
        <strong>{name || 'No indicator yet'}</strong>
        {state.working && <span style={S.muted}>revision {state.revision}</span>}
        {state.defId && savedVersion !== null && <span style={S.muted}>saved version {savedVersion}</span>}
        {state.working && <span style={S.muted}>{unsaved ? 'Unsaved changes' : 'Saved'}</span>}
      </div>

      {offerOpen && (
        <button type="button" style={S.button} data-testid="converse-open-editing" onClick={openEditing} disabled={busy || saving}>
          Continue “{(editing.prior.meta && editing.prior.meta.name) || editing.defId}” in this conversation
        </button>
      )}

      <ol style={S.transcript} data-testid="converse-transcript" aria-live="polite">
        {transcript.map((t) => (
          <li key={t.id} data-role={t.role} data-kind={t.kind || 'member'}
            style={t.role === 'member' ? S.member : (t.kind === 'refusal' ? S.refusal : S.uct)}>
            {t.role === 'member' ? t.text : (
              <ul style={S.list}>{(t.lines || []).map((l, i) => <li key={i}>{l}</li>)}</ul>
            )}
          </li>
        ))}
      </ol>

      {lastQuestions && lastQuestions.some((q) => Array.isArray(q.choices) && q.choices.length) && (
        <div style={S.row} data-testid="converse-choices">
          {lastQuestions.flatMap((q) => (q.choices || []).map((c) => (
            <button key={`${q.id}:${c}`} type="button" style={S.button} disabled={busy} onClick={() => send(c)}>{c}</button>
          )))}
        </div>
      )}

      {partial && (
        <div style={S.row}>
          <button type="button" style={S.button} data-testid="converse-apply-valid" onClick={applyValidPart} disabled={busy}>
            Apply just the valid part ({partial.alone.length} of {partial.envelope.ops.length} changes)
          </button>
        </div>
      )}

      <label style={S.head} htmlFor="converse-input">{state.working ? 'Change it' : 'Describe the indicator'}</label>
      <textarea id="converse-input" style={S.input} value={message} disabled={busy || disabled}
        placeholder={state.working ? 'e.g. make it 80 · paint the candles gold · alert me when it becomes true' : 'e.g. RSI overbought'}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(message) } }} />
      <div style={S.row}>
        <button type="button" style={dim(S.primary, busy || !message.trim())} data-testid="converse-send"
          disabled={busy || disabled || !message.trim()} onClick={() => send(message)}>
          {busy ? 'Working…' : 'Send'}
        </button>
        <button type="button" style={dim(S.button, !canUndo)} data-testid="converse-undo" disabled={!canUndo} onClick={undoLast}>
          Undo last change
        </button>
      </div>

      {state.working && (
        <div data-testid="converse-readback" data-status={rb.status}>
          <div style={S.head}>What will run (from the definition itself)</div>
          <ul style={S.list}>{rb.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}

      {state.working && (
        <PreviewPane sym={sym} tf={tf} settings={settings} definition={previewDefinition} previewId={CONVERSE_PREVIEW_DEF_ID} />
      )}

      {state.working && needsAck.length > 0 && (
        <label style={S.muted}>
          <input type="checkbox" data-testid="converse-ack" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
          {' '}I understand {needsAck.join(', ')} is not final until more bars close.
        </label>
      )}

      {state.working && (
        <div style={S.row}>
          <button type="button" style={dim(S.primary, !canSave)} data-testid="converse-save" disabled={!canSave} onClick={save}>
            {saving ? 'Saving…' : (state.defId ? 'Save changes' : 'Save and add to chart')}
          </button>
        </div>
      )}
    </section>
  )
}
