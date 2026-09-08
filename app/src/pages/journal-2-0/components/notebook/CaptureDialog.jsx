import { useCallback, useEffect, useId, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import {
  buildCaptureIntent, captureBlockers, captureConfirmation, captureDestination,
  submitCapture, TIER_PASSAGE, TIER_REFERENCE,
} from '../../lib/capture'
import { looksLikeUrl, submitThought, thoughtBlockers } from '../../lib/thoughtCapture'
import styles from './CaptureDialog.module.css'

/**
 * THE ONE capture surface (Wave L Slice 2b §1). Palette, hotkey, note,
 * research workspace and every in-app door open THIS component. There is no
 * QuickCaptureModal / TickerCaptureModal / NoteCaptureModal — context changes
 * DEFAULTS, never semantics.
 *
 * ⛔ Member-facing language only (§17). "Source", "Selected passage", "Your
 * note", "Save to". The words `capture_type`, `coverage`, `source_kind`,
 * `document_page` and `excerpt` are implementation concepts and never appear on
 * screen.
 *
 * ⛔ This dialog PRESENTS permitted modes; it never decides what is permitted
 * (§18). A full-page attempt is refused by the server, and the refusal is shown
 * verbatim-ish with the permitted alternatives offered as explicit choices —
 * never a silent downgrade, because a member who thinks they saved an article
 * and did not has been lied to.
 */
export default function CaptureDialog({
  open, onClose, destination, initial = {}, onSaved, doorSource = 'unknown',
  recentDestinations = [],
}) {
  const titleId = useId()
  const passageId = useId()
  const annotationId = useId()
  const urlId = useId()
  const destId = useId()
  const thoughtId = useId()

  // ⭐ State is INITIALIZED from the opening context, not synced to it by an
  // effect. CaptureHost gives this component a fresh `key` per opening, so a
  // new capture is a new mount — which removes the whole stale-state class
  // (a second capture inheriting the first one's half-typed passage) instead
  // of trying to reset it correctly on every prop change.
  // ⛔ MODE IS A SEMANTIC CHOICE, NOT A STYLE. 'thought' writes member-authored
  // content through the Notebook path; 'source' writes external material through
  // the web-capture path. They are never silently swapped -- turning a member's
  // own words into a source quotation (or the reverse) is the one thing the
  // provenance line forbids. A door that supplies a URL opens in source mode;
  // everything else opens on the highest-frequency action, a quick thought.
  const [mode, setMode] = useState(initial.url || initial.passage ? 'source' : 'thought')
  // ⭐ A door may prefill the thought box (Wave L Slice 4). The mobile share
  // sheet is the first: a share carrying text but NO url has no citable source,
  // so it cannot be a passage — it opens here, and the member's own Save (or the
  // "Capture a source" switch below) settles what it is. A door that prefilled
  // `passage` instead would open source mode and then block on a missing URL.
  const [thought, setThought] = useState(initial.thought || '')
  const [pickedDest, setPickedDest] = useState(null)
  const [url, setUrl] = useState(initial.url || '')
  const [title, setTitle] = useState(initial.title || '')
  const [passage, setPassage] = useState(initial.passage || '')
  const [annotation, setAnnotation] = useState('')
  const [status, setStatus] = useState('idle')   // idle | saving | saved | error
  const [message, setMessage] = useState('')
  const [refusal, setRefusal] = useState(null)
  const [result, setResult] = useState(null)

  const dialogRef = useRef(null)
  const firstFieldRef = useRef(null)
  const openerRef = useRef(null)

  // Remember who opened us so focus can go home on close (§15).
  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement
    const t = setTimeout(() => firstFieldRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  const close = useCallback(() => {
    onClose?.()
    // Focus returns to the control that opened capture — a keyboard member must
    // not be dumped at the top of the document.
    const opener = openerRef.current
    if (opener && typeof opener.focus === 'function') setTimeout(() => opener.focus(), 0)
  }, [onClose])

  // Escape closes; Tab is trapped inside while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return }
      if (e.key !== 'Tab') return
      const nodes = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')
      if (!nodes || !nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  if (!open) return null

  // The destination in force: the door's default unless the member picked one.
  const dest = pickedDest || destination
  // ⛔ MODE-AWARE, and it has to be. A ticker-only destination ("NVDA
  // Research") is a complete answer for a THOUGHT — the note is created
  // carrying that ticker — but a SOURCE capture writes into an existing note
  // and needs a noteId. Asking `!noteId && !ticker` for both hid the picker on
  // a research page and then blocked Save with "a destination", leaving the
  // member no control that could fix it.
  const needsPicker = mode === 'thought'
    ? (!dest?.noteId && !dest?.ticker)
    : !dest?.noteId

  const intent = buildCaptureIntent({
    tier: passage.trim() ? TIER_PASSAGE : TIER_REFERENCE,
    url, title, passage, annotation, destination: dest,
  })
  const blockers = mode === 'thought'
    ? thoughtBlockers({ text: thought, destination: dest?.noteId || dest?.ticker ? dest : null })
    : captureBlockers(intent)
  const canSave = blockers.length === 0 && status !== 'saving'

  const save = async (override) => {
    setStatus('saving'); setMessage(''); setRefusal(null)
    try {
      const res = mode === 'thought'
        ? await submitThought({ text: thought, destination: dest })
        : await submitCapture(override ? { ...intent, ...override } : intent)
      setResult(res)
      setStatus('saved')
      // Language differs by KIND so the confirmation never hides what happened.
      // The tier passed here is the one actually SENT (an override included), so
      // a link-only save into a note that already holds a passage from the same
      // article is confirmed as a link -- see captureConfirmation.
      const sentTier = (override ? { ...intent, ...override } : intent).tier
      setMessage(mode === 'thought'
        ? `Saved to ${dest?.contextLabel || 'Notebook'}`
        : captureConfirmation(res, dest, sentTier))
      onSaved?.(res)
    } catch (e) {
      // ⛔ NOTHING is cleared here. The member's passage, note, URL and
      // destination all stay exactly as typed — retry must never mean retype.
      setStatus('error')
      if (e.kind === 'rights') { setRefusal(e.message); setMessage('') }
      else setMessage(e.message)
    }
  }

  const saveLinkOnly = () => save({ tier: TIER_REFERENCE, passage: '' })

  // ⛔ An EXPLICIT transition, never an automatic one (ruling §10). Pasting a
  // link into the thought box offers the switch; it does not perform it, and
  // the member's typed words are carried across as their own note rather than
  // becoming a source quotation.
  const switchToSource = () => {
    if (looksLikeUrl(thought)) { setUrl(thought.trim()); setThought('') }
    setMode('source')
  }
  const switchToThought = () => setMode('thought')

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.heading}>Capture</h2>
          <button type="button" className={styles.close} onClick={close} aria-label="Close capture">
            <UIcon name="x" size={14} gold={false} />
          </button>
        </div>

        {/* Destination first and always visible (§4): a fast capture to the
            wrong place is still a bad capture. */}
        <div className={styles.destRow}>
          <span className={styles.destLabel} id={destId}>Save to</span>
          {needsPicker ? (
            /* ⛔ A globally available capture command must actually work
               globally. With no context there is genuinely nowhere obvious to
               put it, so we ASK -- one extra step, and only in the case that
               earns it. This reuses the member's own recent notes rather than
               inventing a second destination store. */
            <select className={styles.destPicker} data-testid="capture-destination-picker"
                    aria-labelledby={destId}
                    value={pickedDest?.noteId || ''}
                    onChange={(e) => {
                      const n = recentDestinations.find((r) => r.id === e.target.value)
                      setPickedDest(n ? captureDestination({ noteId: n.id, noteTitle: n.title }) : null)
                    }}>
              <option value="">Choose a note…</option>
              {recentDestinations.map((n) => (
                <option key={n.id} value={n.id}>{n.title?.trim() || 'Untitled'}</option>
              ))}
            </select>
          ) : (
            <>
              <span className={styles.destValue} aria-labelledby={destId} data-testid="capture-destination">
                {dest?.contextLabel || 'Notebook'}
              </span>
              {recentDestinations.length > 0 && (
                <button type="button" className={styles.change}
                        onClick={() => setPickedDest(captureDestination({}))}>Change</button>
              )}
            </>
          )}
        </div>

        {mode === 'thought' ? (
          <>
            <label className={styles.label} htmlFor={thoughtId}>Quick thought</label>
            <textarea id={thoughtId} ref={firstFieldRef} className={styles.textarea} rows={5}
                      value={thought} onChange={(e) => setThought(e.target.value)}
                      placeholder="What are you thinking?" />
            <p className={styles.hint}>Your own words — saved as a note.</p>
            {looksLikeUrl(thought) && (
              /* Offered, never done for them. */
              <div className={styles.offer} role="status">
                <span>That looks like a link.</span>
                <button type="button" className={styles.link} onClick={switchToSource}>
                  Save it as a source instead
                </button>
              </div>
            )}
            <button type="button" className={styles.modeSwitch} onClick={switchToSource}>
              Saving something from the web? Capture a source
            </button>
          </>
        ) : (
        <>
        <label className={styles.label} htmlFor={urlId}>Source link</label>
        <input id={urlId} ref={firstFieldRef} className={styles.input} type="url"
               value={url} onChange={(e) => setUrl(e.target.value)}
               placeholder="https://…" autoComplete="off" />

        <label className={styles.label} htmlFor={titleId + 't'}>Source title</label>
        <input id={titleId + 't'} className={styles.input} type="text"
               value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder="Optional — we'll use the site name" autoComplete="off" />

        {/* §2 — source material and member thought must LOOK different. Two
            labelled controls, and the passage is visually quoted so nobody
            mistakes it for something they wrote. */}
        <label className={styles.label} htmlFor={passageId}>Selected passage</label>
        <textarea id={passageId} className={`${styles.textarea} ${styles.quoted}`} rows={4}
                  value={passage} onChange={(e) => setPassage(e.target.value)}
                  placeholder="Paste the sentences you want to keep" />
        <p className={styles.hint}>From the source, in its own words.</p>

        <label className={styles.label} htmlFor={annotationId}>Your note</label>
        <textarea id={annotationId} className={styles.textarea} rows={3}
                  value={annotation} onChange={(e) => setAnnotation(e.target.value)}
                  placeholder="What you make of it" />
        <p className={styles.hint}>Your own thinking — kept separate from the source.</p>
        <button type="button" className={styles.modeSwitch} onClick={switchToThought}>
          Just a thought? Write a note instead
        </button>
        </>
        )}

        {refusal && (
          <div className={styles.refusal} role="alert">
            <p className={styles.refusalText}>{refusal}</p>
            {/* ⛔ Never a silent downgrade: the member consciously chooses the
                permitted alternative. */}
            <button type="button" className="btn btn-ghost btn-sm" onClick={saveLinkOnly}>
              Save the link only
            </button>
          </div>
        )}
        {status === 'error' && message && (
          <div className={styles.error} role="alert">{message}</div>
        )}
        {status === 'saved' && (
          <div className={styles.saved} role="status">
            <span>{message}</span>
            {result?.excerptId || result?.documentId ? (
              <button type="button" className={styles.link} onClick={() => { onSaved?.(result, { open: true }); close() }}>
                Open
              </button>
            ) : null}
          </div>
        )}

        <div className={styles.foot}>
          <span className={styles.blockers} aria-live="polite">
            {status === 'saving' ? 'Saving…' : (blockers.length ? `Needs ${blockers.join(' and ')}` : '')}
          </span>
          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              {status === 'saved' ? 'Done' : 'Cancel'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => save()}
                    disabled={!canSave} data-testid="capture-save">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
