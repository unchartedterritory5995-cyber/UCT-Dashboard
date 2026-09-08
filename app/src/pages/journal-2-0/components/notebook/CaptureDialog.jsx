import { useCallback, useEffect, useId, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import {
  buildCaptureIntent, captureBlockers, captureConfirmation, captureDestination,
  submitCapture, TIER_PASSAGE, TIER_REFERENCE,
} from '../../lib/capture'
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
}) {
  const titleId = useId()
  const passageId = useId()
  const annotationId = useId()
  const urlId = useId()
  const destId = useId()

  // ⭐ State is INITIALIZED from the opening context, not synced to it by an
  // effect. CaptureHost gives this component a fresh `key` per opening, so a
  // new capture is a new mount — which removes the whole stale-state class
  // (a second capture inheriting the first one's half-typed passage) instead
  // of trying to reset it correctly on every prop change.
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

  const intent = buildCaptureIntent({
    tier: passage.trim() ? TIER_PASSAGE : TIER_REFERENCE,
    url, title, passage, annotation, destination,
  })
  const blockers = captureBlockers(intent)
  const canSave = blockers.length === 0 && status !== 'saving'

  const save = async (override) => {
    setStatus('saving'); setMessage(''); setRefusal(null)
    try {
      const res = await submitCapture(override ? { ...intent, ...override } : intent)
      setResult(res)
      setStatus('saved')
      setMessage(captureConfirmation(res, destination))
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
          <span className={styles.destValue} aria-labelledby={destId} data-testid="capture-destination">
            {destination?.contextLabel || 'Notebook'}
          </span>
        </div>

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
