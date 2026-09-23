import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
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

  const firstFieldRef = useRef(null)

  // ⭐ Backdrop-click, Escape, Tab-trap and opener-focus-restore all now live
  // in <Sheet> (competitive-audit UX #13 second half, 2026-09-22) -- this used
  // to hand-roll all four, which is exactly the "four hand-copied focus-trap
  // implementations had already drifted" class Sheet.jsx's own header warns
  // about. What Sheet does NOT know to do is focus the first FIELD rather
  // than the panel container, so that stays here, layered on top of Sheet's
  // own (correct, but less specific) panel-focus.
  // ⛔ MUST be requestAnimationFrame, not setTimeout(fn, 0). Sheet is the
  // CHILD here, so its own mount effect (which focuses the panel via rAF)
  // runs BEFORE this one -- React fires effects bottom-up. Two rAF callbacks
  // scheduled in that order fire in that same order in the next frame, so
  // this one reliably runs second and wins. A setTimeout(0) raced Sheet's
  // rAF instead of following it and lost the race (caught by this file's own
  // "takes initial focus into the first field" test going red).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => firstFieldRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const close = useCallback(() => { onClose?.() }, [onClose])

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
    <Sheet
      open={open}
      onClose={close}
      ariaLabel="Capture"
      title={<h2 id={titleId} className={styles.heading}>Capture</h2>}
      // §15's global hotkey "deliberately works while typing in the editor"
      // -- capture can open over anything, including an active toast
      // (--z-toast, 1100). Preserves the pre-Sheet hardcoded 1200 byte-for-
      // byte rather than inheriting Sheet's shared --z-modal rung (1000),
      // which every OTHER Sheet caller relies on staying put.
      zIndex={1200}
      footer={
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
      }
    >
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
    </Sheet>
  )
}
