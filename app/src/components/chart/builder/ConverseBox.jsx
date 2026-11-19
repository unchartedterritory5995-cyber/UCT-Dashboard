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
//
// ⭐⭐ SLICE 2 — A TURN IS NOT "CHANGE MY INDICATOR" (`classifyTurn`): an ANSWER or
// an UNSUPPORTED reply is the assistant's words and nothing else happens; only a
// CHANGE (and a CLARIFY's questions) reaches the engine. "Unsaved" is `isDirty`
// — the working definition against the persisted base — never the transcript.
// The conversation lives under `sessionKey` (in memory, per tab) so closing the
// sheet does not lose it; when the sheet hosts the box (`onCommitState`), its
// commit is the sheet footer's ONE primary button, not a second "Save changes".

import { withoutGuardIds } from '../engine/ast/guardIdText'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  newAuthoringState, openAuthoringState, applyTurn, undo, readback, isDirty, PATCH_CONTRACT,
} from './authoring'
import { converseTurn, transcriptSnippets, distinctNotUnderstood } from './authoring/converseClient'
import { classifyTurn, OUTCOMES } from './authoring/turnOutcome'
import { settleScript, checkScript } from './authoring/scriptAnswer'
import { preflight } from './authoring/preflight'
import { readSession, writeSession, clearSession, editKey } from './authoring/conversationSessions'
import { storeConversation, attachConversation, armConversationAlerts } from './conversationSave'
import PreviewPane from './editor/PreviewPane'
import { CONVERSE_PREVIEW_DEF_ID } from './editor/previewDefinition'
import { stampSemantics } from '../engine/definitionSemantics'
import { memberError, memberSaveError, conversationEditability, memberRefusal, chartRefusalWords } from './authoring/memberWords'
import { logStudioAction, definitionKinds, clientFailureOf } from './authoring/studioTelemetry'
import { outputNamer } from './authoring/readback'
import { nameFromAssistant, settingTurn } from './authoring/authoringSession'
import { settingsOf } from './authoring/derivedSettings'
import SettingsFields from './studio/SettingsFields'
import { keepAssistantName, keepAssistantLabel } from './authoring/readableName'
import { renamePatch } from './authoring/memberNamePatch'
import { ackCheckboxText } from './authoring/repaintWarning'

// ⭐ UCT Signature (Direction A, owner 2026-11-16): sentence-case labels, an input well,
// soft buttons — the primary one step brighter, never gold. Gold is only the ✦ mark.
const S = {
  box: { display: 'flex', flexDirection: 'column', gap: 8 },
  head: { fontSize: 11.5, fontWeight: 600, color: '#c9c6be' },
  identity: { fontSize: 13, color: '#f8f7f3', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' },
  muted: { fontSize: 11.5, color: '#93939a' },
  script: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  pre: { margin: '6px 0 0', maxHeight: 220, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap', color: '#c9c6be' },
  list: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#c9c6be' },
  transcript: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' },
  member: { alignSelf: 'flex-end', fontSize: 13, color: '#f8f7f3', background: '#222327', padding: '6px 10px', borderRadius: 9 },
  uct: { fontSize: 12, color: '#c9c6be', padding: '8px 10px', background: '#1a1b1f', borderRadius: 9 },
  /** ⭐ P3: the agent's own words beside the readback — clearly SECONDARY. */
  assistantReply: { margin: '4px 0 0', fontSize: 11.5, fontStyle: 'italic', color: '#93939a' },
  refusal: { fontSize: 12, color: '#ededed', padding: '8px 10px', border: '1px solid var(--loss-border)', background: 'var(--loss-bg)', borderRadius: 9 },
  well: { display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 10px', background: '#0f1012', border: '1px solid #26282c', borderRadius: 9 },
  input: { width: '100%', minHeight: 44, padding: 0, resize: 'none', background: 'transparent', color: '#ededed', border: 0, outline: 'none', font: '500 13.5px/1.45 var(--font-sans, inherit)' },
  wellRow: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  hint: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#93939a' },
  spark: { color: 'var(--ut-gold, #dcbb5e)' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  button: { minHeight: 28, padding: '0 12px', background: 'rgba(248,247,243,.06)', color: '#ededed', border: 0, borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  primary: { minHeight: 28, padding: '0 12px', background: 'rgba(248,247,243,.08)', color: '#f8f7f3', border: 0, borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
}
const dim = (style, disabled) => (disabled ? { ...style, opacity: 0.45, cursor: 'not-allowed' } : style)

/** Deterministic words for the engine's own disclosures (not model prose). */
function changeLine(c) {
  switch (c.kind) {
    case 'type-changed': return `${c.output} is now ${c.to} (was ${c.from}).`
    case 'refused-on-chart': return `${c.output} cannot be drawn here: ${chartRefusalWords(c.guard, c.text) || withoutGuardIds(c.text)}`
    case 'foreign-source-replaced': return `${c.output}'s imported ${c.dialect || ''} text is replaced by the canonical formula (the original is kept aside).`
    case 'requests-cleared': return `Requests on ${c.output} were cancelled with it.`
    case 'intent-cleared': return `The signal choice on ${c.output} was cleared with it.`
    case 'paint-removed': return c.text ? `${c.output}: ${withoutGuardIds(c.text)}` : null
    case 'scan-moved': return `Running this over a list now reads ${c.output}: the line it read (${c.from}) was removed.`
    default: return null
  }
}

/** ⭐ P2X: a member reads a plain name for each patch op, never the wire id
 *  (`request_alert`). The engine's machine code stays in brackets for support. */
const OP_WORDS = Object.freeze({
  create: 'create the indicator', rename_definition: 'rename', add_output: 'add a line',
  remove_output: 'remove a line', rename_output: 'rename a line', set_output_tree: 'change the formula',
  set_slot: 'change a number', add_clause: 'add a condition', remove_clause: 'remove a condition',
  set_intent: 'set what it is for', set_placement: 'move it', set_style: 'change the style',
  set_marker: 'add a marker', remove_marker: 'remove a marker', set_paint: 'add a color',
  remove_paint: 'remove a color', request_info_value: 'header value request',
  request_alert: 'alert request', cancel_request: 'cancel a request',
})
const opWords = (op) => `${OP_WORDS[op.op] || 'a change'}${op.output ? ` on ${op.output}` : ''}`

/** One errors[] entry → a member sentence that names the op (P3 UX: the
 *  engine's code and message are the entry's secondary detail, `memberError`). */
function errorLine(e, ops, working = null) {
  const op = Number.isInteger(e.op) && ops && ops[e.op] ? ops[e.op] : null
  const { text } = memberError(e, { nameOf: working ? outputNamer(working) : null })
  return op ? `Change ${e.op + 1} (${opWords(op)}): ${text}` : text
}

/**
 * @param {object} props
 * @param {object|null} props.settings  the chart's settings (null off-chart)
 * @param {Function|null} props.onChange the chart's settings writer
 * @param {string|null} props.sym / props.tf  the chart the sheet was opened over
 * @param {{defId, version, prior}|null} props.editing the sheet's stored definition being edited
 * @param {boolean} props.disabled
 * @param {Function} props.converse  injectable converse client (tests)
 * @param {Function|null} props.onSaved `(defId, version)` after a conversational save
 * @param {string|null} props.sessionKey  SLICE 2 — the opaque authoring context (`edit:<defId>` /
 *                                       `new:<scope>`) the conversation is kept under
 * @param {Function|null} props.onCommitState SLICE 2 — the host footer owns the ONE save button:
 *                                       `({dirty, canSave, saving, label})` on every change
 * @param {{current: object|null}|null} props.commitRef SLICE 2 — `{save}` for that button
 * @param {{text: string}|null} props.prefill UCT Signature R2 — words to PUT in the input (a fresh
 *                                       object per opening); never sent, the member presses Send
 */
export default function ConverseBox({
  settings = null, onChange = null, sym = null, tf = null, editing = null, disabled = false,
  converse = converseTurn, onSaved = null, sessionKey = null, onCommitState = null, commitRef = null,
  variant = 'ask', prefill = null, onOpenScript = null, engineChart = null,
}) {
  /** ⭐ DIRECTION A — 'start' is the start view's "Describe it" well (nothing to undo,
   *  no identity line until there is an indicator); 'ask' is the editor's Ask tab. */
  const startWell = variant === 'start'
  // ⭐ 2026-11-17 — THE START VIEW OPENS WITH THE CURSOR IN "DESCRIBE IT". Measured on production: the
  // window opened with focus on the dialog itself, so after "Create indicator" (or the palette's
  // "Describe an indicator") a member still had to click the box before typing. After the sheet's own
  // focus handling has run (a tick later), and never over something the member is already typing in.
  // ⛔ NOT ON A TOUCH SCREEN: a keyboard that opens by itself covers the four doors under the box.
  const inputRef = useRef(null)
  useEffect(() => {
    if (!startWell) return undefined
    const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches
    if (coarse) return undefined
    const t = setTimeout(() => {
      const el = inputRef.current
      const at = typeof document !== 'undefined' ? document.activeElement : null
      const typing = at && at !== el && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable)
      if (el && !el.disabled && !typing) el.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [startWell])
  const [initial] = useState(() => readSession(sessionKey))
  /** The key this conversation is kept under. A NEW definition's conversation
   *  moves to its `edit:<id>` key once saved, so "New formula" later starts clean
   *  and editing that definition later continues it. */
  const [activeKey, setActiveKey] = useState(sessionKey)
  const [state, setState] = useState(() => (initial && initial.state) || newAuthoringState())
  const stateRef = useRef(state)
  const commit = useCallback((next) => { stateRef.current = next; setState(next) }, [])
  const [savedVersion, setSavedVersion] = useState(() => (initial ? initial.savedVersion : null))
  const [transcript, setTranscript] = useState(() => (initial && initial.transcript) || [])
  const [message, setMessage] = useState(() => (prefill && typeof prefill.text === 'string' ? prefill.text : ''))
  // ⭐ UCT SIGNATURE R2 — a new prefill (each opening hands a fresh object) replaces what is in the
  // box. It is only TYPED: no request is made until the member presses Send.
  useEffect(() => { if (prefill && typeof prefill.text === 'string') setMessage(prefill.text) }, [prefill])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acked, setAcked] = useState(false)
  /** The last refused envelope, for the explicit "apply just the valid part". */
  const [partial, setPartial] = useState(null)
  /** The stored document this session last opened or saved — the `prior` the
   *  preview's semantics rule reads, exactly as the sheet's preview does. */
  const storedRef = useRef(null)
  // ⭐ A SCRIPT ANSWER, HERE TOO (2026-11-19). This box sits beside the script editor: a script the
  // assistant writes is checked by this window's engine (the dock's own check and repair loop,
  // `scriptAnswer.settleScript`), shown with the engine's verdict, and opened IN the script editor
  // (`onOpenScript`, the host's). ⛔ It tells the door it accepts a script ONLY where it can open one:
  // the start view of a NEW indicator, with a host that handed it the opener. The editor's Ask tab
  // changes an indicator that exists; a script would replace it, so it stays on the formula turn.
  const opensScripts = startWell && !editing && typeof onOpenScript === 'function'
  const gateCtx = useMemo(() => (opensScripts ? { tf, symbol: sym, showsScripts: true } : { tf, symbol: sym }),
    [tf, sym, opensScripts])
  /** The chart's bars and compute context, as they are when a script is checked (`runsHere.js`). */
  const chartRef = useRef(engineChart)
  useEffect(() => { chartRef.current = engineChart }, [engineChart])
  const say = useCallback((entry) => setTranscript((t) => [...t, { id: t.length, ...entry }]), [])

  const rb = useMemo(() => readback(state.working, state, gateCtx), [state, gateCtx])
  // ⭐ SLICE 2 — the ONE dirty authority (definition vs persisted base).
  const unsaved = isDirty(state)

  useEffect(() => {
    if (!activeKey) return
    if (!transcript.length && !state.working) return
    writeSession(activeKey, { state, transcript, savedVersion })
  }, [activeKey, state, transcript, savedVersion])
  const name = state.working && state.working.meta ? state.working.meta.name : null

  // ⭐ P3 UX — the conversation lives in this tab's memory only: a reload or a
  // closed tab would lose unsaved changes silently, so the browser asks first.
  useEffect(() => {
    if (!unsaved || typeof window === 'undefined') return undefined
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

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
          ...result.errors.map((e) => errorLine(e, ops, cur.working)),
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
    // ⭐ P3: a CLARIFY's reply rides beside its questions. ⛔ P3S: a CHANGE carries
    // none -- the deterministic readback of the result is the whole entry (the model
    // once claimed "Its name still says 'EMA 20'" beside a readback of EMA 50).
    const reply = typeof extra.reply === 'string' ? extra.reply.trim() : ''
    if (result.status === 'question') {
      say({ role: 'uct', kind: 'question', questions: out.state.questions, reply, lines: out.readback.questions })
      return
    }
    const disclosed = (result.changes || []).map(changeLine).filter(Boolean)
    logStudioAction(out.state.lineage, 'preview', { surface: 'sheet' })
    say({ role: 'uct', kind: extra.kind || 'readback', updated: true, lines: ['Updated preview.', ...disclosed, ...out.readback.lines] })
  }, [gateCtx, commit, say])

  /** The envelope as this sheet applies it: the turn that CREATES the indicator keeps the
   *  assistant's name when the derived one is unreadable. */
  const offeredEnvelope = useCallback((turn, words) => (
    turn.outcome === OUTCOMES.CHANGE && !stateRef.current.working
      ? nameFromAssistant(stateRef.current, turn.envelope, words, gateCtx, keepAssistantName, keepAssistantLabel)
      : turn.envelope
  ), [gateCtx])

  const send = useCallback(async (text) => {
    const words = String(text || '').trim()
    if (!words || busy) return
    const before = stateRef.current
    // ⭐ P3: the assistant's own replies (answer AND change) ride along as context.
    const snippets = transcriptSnippets(transcript)
    say({ role: 'member', text: words })
    setMessage('')
    // ⭐ SLICE 2 PRE-FLIGHT — an explicit other-symbol / timeframe request: no call.
    const caught = preflight(words, { sym, tf })
    if (caught) {
      say({ role: 'uct', kind: 'unsupported', preflight: true, gate: caught.gate, lines: [caught.reason, 'Nothing was changed.'] })
      setPartial(null)
      return
    }
    setBusy(true)
    try {
      let res = await converse({ message: words, state: before, gateCtx, snippets })
      let turn = classifyTurn(res)
      // ⭐ THE ANSWER IS A SCRIPT: this window's own engine judges it. While it does not run fully the
      // engine's refusal goes back for a repair, a bounded number of times; the entry leads with the
      // ENGINE's verdict, whatever it is. The working indicator is not touched: the script is opened
      // in the script editor, never applied as a patch. (Asked for only when `opensScripts`.)
      if (turn.outcome === OUTCOMES.ANSWER && res && res.script && opensScripts) {
        const settled = await settleScript(res,
          (refusal) => converse({ message: words, state: before, gateCtx, snippets, scriptRefusal: refusal }),
          chartRef.current ? { check: (pine) => checkScript(pine, { chart: chartRef.current }) } : {})
        say(settled.entry)
        setPartial(null)
        return
      }
      // ⭐ 2026-11-18 — ONE REPAIR, WITH THIS ENGINE'S OWN WORDS, HERE TOO. The dock has sent its
      // engine's refusal back to the door for one repair since 2026-11-17 (`authoringSession.
      // modelTurn`). This sheet did not: it applied the door's patch itself, so a change the door
      // accepted and this engine refused went straight to "Nothing was changed". Measured live
      // (the overnight re-checks): a squeeze with dots on zero was built by the assistant and
      // refused here ("dots is a yes/no ..."), with no second try. Same rule as the dock: once per
      // request; the patch is tried against the state WITHOUT writing it (`applyTurn` is pure);
      // whatever the repair turn says is what the member reads, except the door's own refusal of
      // it (an allowance, the network), which says nothing about the request.
      if (turn.outcome === OUTCOMES.CHANGE && turn.envelope) {
        const dry = applyTurn(stateRef.current, offeredEnvelope(turn, words), { gateCtx })
        const errors = dry.result && dry.result.status === 'refused' ? (dry.result.errors || []) : []
        if (errors.length) {
          const again = await converse({ message: words, state: before, gateCtx, snippets,
            browserRefusal: { envelope: turn.envelope, errors: errors.map((e) => memberError(e).detail) } })
          const second = classifyTurn(again)
          if (second.outcome !== OUTCOMES.REFUSED) { res = again; turn = second }
        }
      }
      const gaps = [
        ...distinctNotUnderstood(res).map((n) => `Not understood: "${n.clause || n.text || ''}" — ${n.reason || ''}`),
        ...((res && res.unavailable) || []).map((n) => `Not available: ${n.column || n.name || ''} — ${n.reason || ''}`),
      ]
      if (turn.outcome === OUTCOMES.ANSWER) {
        say({ role: 'uct', kind: 'answer', reply: turn.reply, lines: [turn.reply, ...gaps] })
        return
      }
      if (turn.outcome === OUTCOMES.UNSUPPORTED || turn.outcome === OUTCOMES.REFUSED) {
        const failure = clientFailureOf(turn.gate)
        if (failure) logStudioAction(stateRef.current.lineage, 'turn_failed', { surface: 'sheet', failure })
        say({ role: 'uct', kind: turn.outcome === OUTCOMES.UNSUPPORTED ? 'unsupported' : 'refusal',
          lines: ['Nothing was changed.', turn.reply || memberRefusal(turn.gate, turn.reason), ...gaps], gate: turn.gate || null })
        setPartial(null)
        return
      }
      if (gaps.length) say({ role: 'uct', kind: 'gaps', lines: gaps })
      // ⭐ 2026-11-17 — THE ASSISTANT'S NAME, HERE TOO. The turn that CREATES the indicator keeps the
      // assistant's name when the derived one is unreadable (`readableName.js`, the dock's rule): a
      // member read "EMA 10 · EMA 21 +2" on the chart for "EMA 10/21 Trend". The host shows it in its
      // name field, where the member can change it before saving.
      applyEnvelope(offeredEnvelope(turn, words), turn.outcome === OUTCOMES.CHANGE ? { updated: true } : { reply: turn.reply })
    } finally {
      setBusy(false)
    }
  }, [busy, transcript, converse, gateCtx, sym, tf, say, applyEnvelope, offeredEnvelope, opensScripts])

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

  // ⭐ SETTINGS (2026-11-17) — the tunable numbers of the indicator this conversation built, derived
  // from its own formula and stored nowhere (`authoring/derivedSettings.js`). One number set from
  // its field is the ordinary slot edit: no request to the assistant, one Undo step.
  const numberSettings = useMemo(() => settingsOf(state.working), [state.working])
  const setNumber = useCallback((setting, value) => {
    const cur = stateRef.current
    if (busy || saving || !cur.working) return { ok: false }
    const out = settingTurn(cur, setting, value, { gateCtx })
    if (!out.ok) return out
    commit(out.state)
    setPartial(null)
    setAcked(false)
    for (const e of out.entries) say(e)
    return out
  }, [busy, saving, commit, say, gateCtx])

  const openEditing = useCallback(() => {
    if (!editing || !editing.prior) return
    const next = openAuthoringState(editing.prior, { defId: editing.defId, version: editing.version })
    storedRef.current = editing.prior
    commit(next)
    setSavedVersion(editing.version)
    setPartial(null)
    say({ role: 'uct', kind: 'opened', lines: [`Opened “${(editing.prior.meta && editing.prior.meta.name) || editing.defId}” (saved version ${editing.version}).`, ...readback(next.working, next, gateCtx).lines] })
  }, [editing, commit, say, gateCtx])

  const save = useCallback(async (hostName) => {
    let cur = stateRef.current
    if (!cur.working || saving) return
    setSaving(true)
    try {
      // ⭐ 2026-11-17 — THE NAME IN THE HOST'S FIELD IS THE NAME SAVED. It was ignored: a member who
      // typed a name into the window and saved from the conversation got the derived one. A string
      // only (a click event is not a name); an unchanged or empty field changes nothing.
      const wanted = typeof hostName === 'string' ? hostName.replace(/\s+/g, ' ').trim() : ''
      const has = (cur.working.meta && cur.working.meta.name) || ''
      if (wanted && wanted !== has) {
        const renamed = applyTurn(cur, renamePatch(cur, wanted), { gateCtx })
        if (renamed.result.status === 'applied') { commit(renamed.state); cur = renamed.state }
      }
      const stored = await storeConversation(cur, { previewAcked: acked })
      if (!stored.ok) {
        logStudioAction(cur.lineage, 'save_failed', { surface: 'sheet' })
        const m = memberSaveError(stored)
        say({ role: 'uct', kind: 'refusal', lines: ['Not saved.', m.text], errors: [{ code: m.code, message: m.detail }] })
        return
      }
      logStudioAction(cur.lineage, 'saved', { surface: 'sheet', created: !!stored.created,
        origin: cur.defId ? undefined : 'native', kinds: definitionKinds(stored.storedDoc, stored.requests) })
      const attached = attachConversation({ storedDoc: stored.storedDoc, created: stored.created, requests: stored.requests, settings })
      if (settings && onChange && attached.settings !== settings) onChange(attached.settings)
      const alerts = await armConversationAlerts({ storedDoc: stored.storedDoc, requests: stored.requests, sym, tf, instanceId: attached.instanceId })
      // ⭐ THE STORE'S ROW IS NOW THE AUTHORITY: reopen from it, same lineage.
      const next = openAuthoringState(stored.storedDoc, {
        defId: stored.storedDoc.id, version: stored.storedDoc.version, lineage: cur.lineage,
      })
      storedRef.current = stored.storedDoc
      commit(next)
      setSavedVersion(stored.storedDoc.version)
      setPartial(null)
      // ⭐ SLICE 2 — a NEW definition is now stored: its conversation continues
      // under that definition's own context; the new-formula context is free.
      if (activeKey && activeKey !== editKey(stored.storedDoc.id)) {
        clearSession(activeKey)
        setActiveKey(editKey(stored.storedDoc.id))
      }
      // tell the host sheet — its own form may now be an older version of this row
      if (typeof onSaved === 'function') onSaved(stored.storedDoc.id, stored.storedDoc.version)
      say({
        role: 'uct', kind: 'saved',
        lines: [`Saved — version ${stored.storedDoc.version}.`, ...[...attached.outcomes, ...alerts].map((o) => o.text)],
        outcomes: [...attached.outcomes, ...alerts],
      })
    } finally {
      setSaving(false)
    }
  }, [saving, acked, settings, onChange, sym, tf, commit, say, onSaved, activeKey])

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
  // ⭐ P3 UX — the engine's own first-turn guards, run BEFORE the member types:
  // a definition the conversation cannot edit is said so up front.
  const editability = useMemo(() => (editing && editing.prior ? conversationEditability(editing.prior) : null), [editing])
  const notEditable = !!(editability && !editability.editable && state.defId !== editing.defId)
  const offerOpen = editing && editing.prior && state.defId !== editing.defId && !notEditable
  const saveLabel = state.defId ? 'Save changes' : 'Save and add to chart'
  /** What the conversation's indicator is called now (the host shows it in its name field). */
  const workingName = (state.working && state.working.meta && typeof state.working.meta.name === 'string') ? state.working.meta.name : ''

  // ⭐ SLICE 2 — HOSTED: the sheet footer is the ONE primary save. It shows this
  // conversation's commit while the conversation has unsaved changes.
  const hosted = typeof onCommitState === 'function'
  useLayoutEffect(() => { if (commitRef) commitRef.current = { save, setNumber } })
  useEffect(() => {
    // `numbers`: the indicator's own settings, so the host's Inputs tab counts and shows them
    if (hosted) onCommitState({ dirty: unsaved, canSave, saving, label: saveLabel, name: workingName, numbers: numberSettings })
  }, [hosted, onCommitState, unsaved, canSave, saving, saveLabel, workingName, numberSettings])
  useEffect(() => () => { if (hosted) onCommitState(null) }, [hosted, onCommitState])

  return (
    <section style={S.box} aria-label="Build it by conversation" data-guide="builder.conversation" data-testid="converse">
      <div style={startWell && !state.working ? { ...S.identity, display: 'none' } : S.identity} data-testid="converse-identity" hidden={startWell && !state.working}
        data-def-id={state.defId || ''} data-lineage={state.lineage} data-revision={state.revision}
        data-saved={unsaved ? 'unsaved' : (state.defId ? 'saved' : 'none')}>
        <strong>{name || 'No indicator yet'}</strong>
        {state.defId && savedVersion !== null && <span style={S.muted}>saved version {savedVersion}</span>}
        {state.working && <span style={S.muted}>{unsaved ? 'Unsaved changes' : 'Saved'}</span>}
      </div>

      {notEditable && (
        <div style={S.muted} role="note" data-testid="converse-not-editable" data-code={editability.code}>
          {withoutGuardIds(editability.text)} Anything you describe here starts a new indicator.
        </div>
      )}

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
              <>
                <ul style={S.list}>{(t.lines || []).map((l, i) => <li key={i}>{l}</li>)}</ul>
                {t.reply && t.kind !== 'answer' && (
                  <p style={S.assistantReply} data-testid="converse-assistant-reply">UCT Agent: {t.reply}</p>
                )}
                {/* ⭐ A SCRIPT ANSWER: the lines above are the ENGINE's verdict. The script opens in the
                    script editor, where it is checked again, previewed and saved like any pasted script. */}
                {t.script && typeof t.script.pine === 'string' && (
                  <div style={S.script} data-testid="converse-script" data-runs={t.script.runs ? 'true' : 'false'}>
                    {t.said ? <p style={S.assistantReply} data-testid="converse-script-said">UCT Agent: {t.said}</p> : null}
                    {typeof onOpenScript === 'function' && (
                      <button type="button" style={S.button} data-testid="converse-open-script" disabled={busy || saving}
                        onClick={() => onOpenScript({ pine: t.script.pine, name: t.script.name })}>
                        {t.script.runs ? 'Open this script in the editor' : 'Open this script in the editor to fix it'}
                      </button>
                    )}
                    <details style={S.muted} data-testid="converse-script-text">
                      <summary>The script the assistant wrote</summary>
                      <pre style={S.pre}>{t.script.pine}</pre>
                    </details>
                  </div>
                )}
              </>
            )}
            {t.role !== 'member' && Array.isArray(t.errors) && t.errors.length > 0 && (
              <details style={S.muted} data-testid="converse-error-detail">
                <summary>Details for support</summary>
                {t.errors.map((e, i) => <div key={i}>{memberError(e).detail}</div>)}
              </details>
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

      <label style={S.head} htmlFor="converse-input">{state.working ? 'Change it' : 'Describe it'}</label>
      {/* ⭐ SLICE 2 — NOT disabled while a turn runs (only Send is): a disabled
          field drops focus, and the member's next keystrokes then fall through
          to whatever is underneath (measured: the drill board's list moved).
          `send` already refuses a second turn while one is in flight. */}
      <div style={S.well}>
        <textarea id="converse-input" ref={inputRef} style={S.input} value={message} disabled={disabled} rows={2}
          placeholder={state.working ? 'e.g. make it 80 · paint the candles gold · alert me when it becomes true' : 'e.g. RSI under 30 while price is above its 200-day average'}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(message) } }} />
        <div style={S.wellRow}>
          <span style={S.hint}><span style={S.spark} aria-hidden="true">✦</span>The UCT Agent writes it — you check the plain-English read-back</span>
          <span style={S.row}>
            <button type="button" style={dim(S.button, !canUndo)} data-testid="converse-undo" data-guide="builder.undo" disabled={!canUndo} onClick={undoLast}>
              Undo last change
            </button>
            <button type="button" style={dim(S.primary, busy || !message.trim())} data-testid="converse-send"
              disabled={busy || disabled || !message.trim()} onClick={() => send(message)}>
              {busy ? 'Working…' : (state.working ? 'Send' : 'Write it')}
            </button>
          </span>
        </div>
      </div>

      {state.working && (
        <div data-testid="converse-readback" data-status={rb.status}>
          <div style={S.head}>What will run (from the definition itself)</div>
          <ul style={S.list}>{rb.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}

      {/* ⭐ 2026-11-18: a checked library indicator says what it is in one phrase (`readback.js`).
          Its formula in words is one tap away, here; the formula itself is in the Formula tab. */}
      {state.working && rb.outputs.some((o) => o.formulaWords) && (
        <details data-testid="converse-formula-words" style={{ fontSize: 12, color: '#a9a59b' }}>
          <summary style={{ cursor: 'pointer' }}>The full formula, in words</summary>
          <ul style={S.list}>
            {rb.outputs.filter((o) => o.formulaWords).map((o) => <li key={o.key}>{o.name}: {o.formulaWords}</li>)}
          </ul>
        </details>
      )}

      {/* ⭐ every length, level and multiple of what was built, as a field (the preview below follows) */}
      {state.working && (
        <SettingsFields settings={numberSettings} onSet={setNumber} disabled={busy || saving} label="Numbers in this indicator" />
      )}

      {state.working && (
        <PreviewPane sym={sym} tf={tf} settings={settings} definition={previewDefinition} previewId={CONVERSE_PREVIEW_DEF_ID} />
      )}

      {state.working && needsAck.length > 0 && (
        <label style={S.muted}>
          <input type="checkbox" data-testid="converse-ack" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
          {/* ⭐ S6 — the measured window, the same items the readback line states */}
          {' '}{ackCheckboxText(rb.ack)}
        </label>
      )}

      {state.working && !hosted && (
        <div style={S.row}>
          <button type="button" style={dim(S.primary, !canSave)} data-testid="converse-save" disabled={!canSave} onClick={save}>
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      )}
    </section>
  )
}
