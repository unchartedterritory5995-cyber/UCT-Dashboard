/**
 * Wave 13 lane 13I-2 — the technical fingerprint beside a chart block in a note.
 *
 * ── VIEWING NEVER WRITES ─────────────────────────────────────────────────────────────────────
 * The freeze is a write into the note (see below), so it happens only when the member caused
 * it: for a chart they added while this note has been open in this tab (`addedThisVisit`: the
 * write rides the save that insert already started), or when they press "Freeze the
 * fingerprint". A chart that was already in the note when it was opened is never frozen by
 * being looked at: no request, no node write, no new "last edited" time.
 *
 * ── THE FREEZE GOES THROUGH THE MEMBER'S OWN SAVE PATH ────────────────────────────────────────
 * When a chart is inserted, the panel asks 13I-1 to freeze the block's fingerprint
 * (`POST /api/j2/notebook-fingerprint/blocks/{note}/{embed}/freeze`). That route answers 404
 * until the note's save has LANDED (the block exists only once the save path's sidecar holds
 * it), so the panel retries on a short backoff — "after the save lands" is the server's answer,
 * not a guess here. The returned fingerprint is then written into the chart's `ta.fingerprint`
 * with `updateAttributes` — an editor transaction on the member's own note, saved by the
 * member's own autosave. ⛔ This file never writes a note over the network (plan R-12): there
 * is no PUT/PATCH to /api/j2/notes here, and a rail holds that.
 *
 * Frozen means frozen: an attr that already carries a fingerprint is shown, never re-fetched
 * or replaced. A chart whose symbol changed after its freeze says so and offers an explicit
 * re-freeze (the one door that replaces).
 *
 * ── THE SETUP TAG ──────────────────────────────────────────────────────────────────────────────
 * The member picks a tag from the ONE alias map (lib/setupTagMap.js). With the visual playbook
 * gate on, the pattern engine's CONFIRMED detections in the frozen fingerprint are OFFERED as
 * suggestions; a suggestion is applied only by the member's click, never automatically.
 *
 * ── THE CHECKLIST AUTOFILL ─────────────────────────────────────────────────────────────────────
 * "Plan this setup" creates a new note from the tag's 12B setup-plan template with each
 * checklist item marked by its fingerprint evidence (lib/fingerprintChecklist.js), through the
 * shared note-creation call (lib/noteCreation.js). It creates; it never edits this note.
 *
 * Gates: `notebook_ta_fingerprint_enabled` (the panel, the freeze, the autofill) and
 * `notebook_visual_playbook_enabled` (the suggestion and the playbook door). Both latched.
 */
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { withFingerprint, withSetupTag } from '../../lib/chartPlan'
import { SETUP_FAMILIES, SETUP_TAGS, setupFamily, suggestTags, planTemplateForTag } from '../../lib/setupTagMap'
import { FIELD_LABELS, annotateSetupPlanDoc, formatFingerprintValue } from '../../lib/fingerprintChecklist'
import { getTemplate } from '../../lib/notebookTemplates'
import { assembleTemplateContext } from '../../lib/templateContext'
import { createNoteViaApi } from '../../lib/noteCreation'
import { lazyLeaf } from '../../lib/lazyChunk'
import { NOTEBOOK_DOORS, onNotebookDoor } from '../../lib/notebookDoors'
import styles from './FingerprintPanel.module.css'

// Through lazyChunk's leaf form (one in-place retry, never a page reload; wave 7 I-1).
const VisualPlaybook = lazyLeaf(() => import('./VisualPlaybook'))

/** A playbook chunk that fails to load says so in the panel instead of reaching the note. */
class PlaybookBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <p className={styles.error} role="alert">The visual playbook could not load. Reload the page to try again.</p>
      : this.props.children
  }
}

export const FINGERPRINT_FLAG = 'notebook_ta_fingerprint_enabled'
export const VISUAL_PLAYBOOK_FLAG = 'notebook_visual_playbook_enabled'
const BASE = '/api/j2/notebook-fingerprint'

/** The retry schedule while the note's save has not landed yet (ms; ~45 s in all). */
export const FREEZE_RETRY_MS = Object.freeze([1500, 2500, 4000, 6000, 8000, 10000, 13000])

/** The fields the collapsed panel shows first. */
const SUMMARY_FIELDS = ['rs_rank', 'adr_pct', 'base_depth_pct', 'pole_pct', 'ma_stack']

const SOURCE_LABELS = {
  screener_row: 'nightly screener row',
  bars: 'computed on stored daily bars',
  pattern_vision: 'pattern engine, confirmed only',
}

export const fingerprintEnabled = () => notebookFlag(FINGERPRINT_FLAG) === true
export const visualPlaybookEnabled = () => notebookFlag(VISUAL_PLAYBOOK_FLAG) === true

/** The block's identity in 13I-1's index: its embedId, else the legacy key. */
export function embedKeyFor(attrs) {
  return attrs?.embedId || `chart|${attrs?.capturedAt || ''}`
}

/**
 * Whether this block was added while the member has had this note open in this tab: its own
 * `capturedAt` (stamped when the block is built) is not older than the moment the note's
 * editor opened (`openedAt`, set once per editor in NoteEditorPage). Fails closed: with either
 * time missing the answer is no, and the freeze waits for the button.
 */
export function addedThisVisit(attrs, editor) {
  const openedAt = editor?.storage?.uctJournalWidgets?.openedAt
  const captured = Date.parse(attrs?.capturedAt || '')
  return Number.isFinite(openedAt) && Number.isFinite(captured) && captured >= openedAt
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Fingerprint request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function postFreeze(noteId, embedKey) {
  const res = await fetch(`${BASE}/blocks/${encodeURIComponent(noteId)}/${encodeURIComponent(embedKey)}/freeze`, {
    method: 'POST', credentials: 'include',
  })
  if (!res.ok) {
    const err = new Error(`Freeze failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function FieldRow({ field, cell, reasons }) {
  const shown = formatFingerprintValue(field, cell?.value)
  const why = cell?.missing ? (reasons?.[cell.missing] || cell.missing) : null
  return (
    <tr data-fp-field={field}>
      <th scope="row" className={styles.fieldName}>{FIELD_LABELS[field] || field}</th>
      <td className={shown == null ? styles.missing : styles.value}>
        {shown == null ? <>Not available: {why || 'no value'}</> : shown}
      </td>
      <td className={styles.source}>{SOURCE_LABELS[cell?.source] || cell?.source || '—'}</td>
    </tr>
  )
}

export default function FingerprintPanel({ attrs, updateAttributes, editor, shareView = false }) {
  const editable = editor?.isEditable !== false && !shareView
  const ta = attrs?.ta || null
  const frozen = ta?.fingerprint && Object.keys(ta.fingerprint).length ? ta.fingerprint : null
  const symbol = attrs?.params?.symbol ? String(attrs.params.symbol).toUpperCase() : null
  const embedKey = embedKeyFor(attrs)
  const vpOn = visualPlaybookEnabled()
  const attrsRef = useRef(attrs)
  attrsRef.current = attrs

  // Decided once, when the panel mounts: was this chart added during this visit?
  const autoRef = useRef(null)
  if (autoRef.current === null) autoRef.current = addedThisVisit(attrs, editor)
  const [asked, setAsked] = useState(false)       // the member pressed the button
  const [state, setState] = useState(frozen ? 'frozen' : autoRef.current ? 'idle' : 'unfrozen')
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState([])
  const [planMsg, setPlanMsg] = useState(null)
  const [creating, setCreating] = useState(false)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  // Lane KEYS3 (Q22): the command palette's "Visual playbook" opens this chart's own sheet,
  // exactly as the button below does. One panel answers: a chart with a setup tag is asked
  // first (its sheet offers "Only this chart's setup"); an untagged one answers only when no
  // tagged chart did. With the gate off nobody listens.
  const hasTag = Boolean(ta?.setupTag)
  useEffect(() => {
    if (!vpOn) return undefined
    return onNotebookDoor(NOTEBOOK_DOORS.VISUAL_PLAYBOOK, (d) => {
      if (!hasTag && !d.anyChart) return false
      setPlaybookOpen(true)
      return true
    })
  }, [vpOn, hasTag])
  const [nonce, setNonce] = useState(0)
  const timer = useRef(null)
  const attempts = useRef(0)
  const latch = useRef(null)

  const { data: meta } = useSWR(`${BASE}/meta`, getJson, { revalidateOnFocus: false })
  const reasons = meta?.missingReasons || {}

  const write = useCallback((fingerprint, replace = false) => {
    // ⛔ THE ONE WRITE: an attr on the member's own node, saved by the member's own autosave.
    updateAttributes?.({ ta: withFingerprint(attrsRef.current?.ta, fingerprint, { replace }) })
  }, [updateAttributes])

  const freezeNow = useCallback(async ({ replace = false } = {}) => {
    const noteId = editor?.storage?.uctJournalWidgets?.noteId
    if (!noteId) {
      setState('waiting')
      return 'retry'
    }
    try {
      const { block } = await postFreeze(noteId, embedKey)
      if (block?.fingerprint) {
        write(block.fingerprint, replace)
        setState('frozen')
        return 'done'
      }
      setState('error')
      return 'stop'
    } catch (e) {
      if (e.status === 404) { setState('waiting'); return 'retry' }   // the save has not landed yet
      if (e.status === 422) { setState('unfreezable'); return 'stop' }
      if (e.status === 503) { setState('unreadable'); return 'stop' }
      setState('error')
      return 'stop'
    }
  }, [editor, embedKey, write])

  // Freeze once per block, after the save lands (the route's 404 until then drives the retry).
  // ⛔ Only for a chart added during this visit, or after the member asked: viewing never writes.
  useEffect(() => {
    if (frozen || !editable || !symbol || !fingerprintEnabled()) return undefined
    if (!autoRef.current && !asked) return undefined
    if (latch.current === embedKey) return undefined
    latch.current = embedKey
    attempts.current = 0
    let cancelled = false
    let settled = false
    const run = async () => {
      if (cancelled) return
      const out = await freezeNow()
      if (cancelled) return
      if (out !== 'retry') { settled = true; return }
      const delay = FREEZE_RETRY_MS[attempts.current]
      attempts.current += 1
      if (delay == null) { settled = true; setState('notSaved'); return }
      timer.current = setTimeout(run, delay)
    }
    run()
    return () => {
      cancelled = true
      clearTimeout(timer.current)
      // A run cut short mid-retry frees the latch, so the next pass picks the freeze up again
      // instead of leaving "Waiting for this note to save" on screen with no way forward.
      if (!settled && latch.current === embedKey) latch.current = null
    }
  }, [frozen, editable, symbol, embedKey, freezeNow, nonce, asked])

  const retry = () => { latch.current = null; setAsked(true); setState('idle'); setNonce((n) => n + 1) }

  const setTag = (tag) => updateAttributes?.({ ta: withSetupTag(attrsRef.current?.ta, tag || null) })
  // FIN-A11Y (review R4, M-7): Use and Dismiss remove the suggestion row their button sits
  // in. Focus goes to the Setup picker, the control a suggestion is about.
  const focusSetupPicker = () => document.getElementById(`fp-tag-${embedKey}`)?.focus()

  const suggestions = useMemo(() => (vpOn && frozen ? suggestTags(frozen) : [])
    .filter((s) => s.tag !== ta?.setupTag && !dismissed.includes(s.tag)), [vpOn, frozen, ta?.setupTag, dismissed])

  const templateKey = planTemplateForTag(ta?.setupTag)
  const symbolMoved = frozen && symbol && frozen.symbol && String(frozen.symbol).toUpperCase() !== symbol

  const planThisSetup = async () => {
    const tpl = getTemplate(templateKey)
    if (!tpl || !frozen) return
    setCreating(true)
    setPlanMsg(null)
    try {
      let ctx
      try { ctx = await assembleTemplateContext({ ticker: symbol, needs: tpl.needs }) } catch { ctx = { ticker: symbol } }
      const created = await createNoteViaApi({
        title: tpl.defaultTitle(ctx),
        bodyJson: annotateSetupPlanDoc(tpl.build(ctx), templateKey, frozen, reasons),
        tags: tpl.tags,
        ticker: ctx.ticker || symbol,
      })
      setPlanMsg({ ok: true, id: created?.id, title: tpl.defaultTitle(ctx) })
    } catch (e) {
      setPlanMsg({ ok: false, text: e?.message || 'Could not create the plan' })
    } finally {
      setCreating(false)
    }
  }

  if (!fingerprintEnabled()) return null

  const fields = frozen?.fields || {}
  const statusLine = {
    unfrozen: 'No fingerprint is frozen for this chart yet.',
    idle: 'Freezing the fingerprint for this chart…',
    waiting: 'Waiting for this note to save, then the fingerprint freezes…',
    notSaved: 'This note has not saved yet, so the fingerprint is not frozen.',
    unfreezable: 'This chart names no symbol or day, so it has no fingerprint.',
    unreadable: 'The chart data could not be read just now.',
    error: 'The fingerprint could not be frozen.',
  }[state]

  return (
    <section className={styles.panel} contentEditable={false} data-testid="fingerprint-panel"
      aria-label={`Technical fingerprint${symbol ? ` for ${symbol}` : ''}`}>
      <div className={styles.head}>
        <h3 className={styles.title}>Technical fingerprint</h3>
        {frozen ? (
          <span className={styles.meta}>
            {frozen.symbol || symbol} · as of {frozen.as_of || '—'} · {frozen.mode === 'nightly' ? 'nightly row' : 'stored bars'} · frozen
          </span>
        ) : (
          <span className={styles.meta} role="status">{statusLine}</span>
        )}
      </div>

      {!frozen && state === 'unfrozen' && editable && symbol && (
        <button type="button" className={styles.btn} onClick={retry}>Freeze the fingerprint</button>
      )}
      {!frozen && ['notSaved', 'unreadable', 'error'].includes(state) && editable && (
        <button type="button" className={styles.btn} onClick={retry}>Try again</button>
      )}

      {frozen && (
        <>
          {symbolMoved && (
            <p className={styles.warn}>
              Frozen for {frozen.symbol}; this chart now shows {symbol}.{' '}
              {editable && (
                <button type="button" className={styles.linkBtn} onClick={() => freezeNow({ replace: true })}>
                  Freeze for {symbol}
                </button>
              )}
            </p>
          )}
          <ul className={styles.summary} aria-label="Fingerprint summary" data-tour="fp-summary">
            {SUMMARY_FIELDS.map((f) => {
              const shown = formatFingerprintValue(f, fields[f]?.value)
              return (
                <li key={f} className={styles.chip} data-fp-summary={f}>
                  <span className={styles.chipLabel}>{FIELD_LABELS[f]}</span>{' '}
                  <span className={shown == null ? styles.missing : styles.value}>{shown ?? 'n/a'}</span>
                </li>
              )
            })}
          </ul>
          <button type="button" className={styles.linkBtn} aria-expanded={expanded} data-tour="fp-all-fields"
            onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide all fields' : 'Show all fields and sources'}
          </button>
          {expanded && (
            <table className={styles.table}>
              <caption className={styles.srOnly}>Every fingerprint field, its value and where it came from</caption>
              <thead>
                <tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Source</th></tr>
              </thead>
              <tbody>
                {Object.keys(FIELD_LABELS).map((f) => <FieldRow key={f} field={f} cell={fields[f]} reasons={reasons} />)}
              </tbody>
            </table>
          )}
        </>
      )}

      <div className={styles.tagRow} data-tour="fp-setup-tag">
        <label className={styles.tagLabel} htmlFor={`fp-tag-${embedKey}`}>Setup</label>
        {editable ? (
          <select id={`fp-tag-${embedKey}`} className={styles.select} value={ta?.setupTag || ''}
            onChange={(e) => setTag(e.target.value)}>
            <option value="">No setup tag</option>
            {ta?.setupTag && !SETUP_TAGS.includes(ta.setupTag) && <option value={ta.setupTag}>{ta.setupTag}</option>}
            {SETUP_FAMILIES.map((fam) => (
              <optgroup key={fam} label={fam}>
                {SETUP_TAGS.filter((t) => setupFamily(t) === fam).map((t) => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            ))}
          </select>
        ) : (
          <span id={`fp-tag-${embedKey}`} className={styles.value}>{ta?.setupTag || 'No setup tag'}</span>
        )}
      </div>

      {editable && suggestions.length > 0 && (
        <ul className={styles.suggestions} aria-label="Suggested setup tags">
          {suggestions.slice(0, 2).map((s) => (
            <li key={s.tag} className={styles.suggestion} data-testid="tag-suggestion">
              <span>
                The pattern engine confirmed <strong>{s.tag}</strong>
                {typeof s.confidence === 'number' ? ` (${Math.round(s.confidence)}% confidence` : ' ('}
                {s.asOf ? `, ${s.asOf})` : ')'}. Suggested tag — not applied.
              </span>
              <span className={styles.suggestionActions}>
                <button type="button" className={styles.btn}
                  onClick={() => { setTag(s.tag); focusSetupPicker() }}>Use “{s.tag}”</button>
                <button type="button" className={styles.btnQuiet} aria-label={`Dismiss the suggested tag ${s.tag}`}
                  onClick={() => { setDismissed((d) => [...d, s.tag]); focusSetupPicker() }}>
                  Dismiss
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {(editable || vpOn) && (
        <div className={styles.actions}>
          {editable && frozen && templateKey && (
            <button type="button" className={styles.btn} onClick={planThisSetup} disabled={creating} data-tour="fp-plan">
              {creating ? 'Creating the plan…' : `Plan this setup (${getTemplate(templateKey)?.label || templateKey})`}
            </button>
          )}
          {vpOn && (
            <button type="button" className={styles.btn} onClick={() => setPlaybookOpen(true)} data-tour="fp-visual-playbook">
              Visual playbook
            </button>
          )}
        </div>
      )}
      {/* Always mounted and refilled: a status that mounts with its text is often not
          announced (FIN-A11Y, review R4 M-16). */}
      <p className={`${styles.note} ${styles.statusLine}`} role="status">
        {planMsg?.ok && (
          <>
          Created “{planMsg.title}” with the checklist marked from this fingerprint.{' '}
          {planMsg.id && (
            <a className={styles.linkBtn} href={`/journal?j2tab=notebook&note=${encodeURIComponent(planMsg.id)}`}>
              Open the plan
            </a>
          )}
          </>
        )}
      </p>
      {planMsg && !planMsg.ok && <p className={styles.error} role="alert">{planMsg.text}</p>}

      {playbookOpen && (
        <PlaybookBoundary>
          <Suspense fallback={null}>
            <VisualPlaybook open={playbookOpen} onClose={() => setPlaybookOpen(false)}
              initialSetup={ta?.setupTag || null} landOnSetup />
          </Suspense>
        </PlaybookBoundary>
      )}
    </section>
  )
}
