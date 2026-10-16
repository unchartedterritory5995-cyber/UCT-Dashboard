/**
 * ⭐⭐ I-A FIX ROUND 4 (review I-6, I-7): the offer for ONE copy of a note's words the
 * server refused to create (`lib/offline/refusedCopy.js`).
 *
 * ⛔ The member decides what happens to words a swap pushed out of their note, so the
 * offer SHOWS them: title, subtitle and body as plain text, read-only, scrollable,
 * with "Copy text". The Discard confirm shows the same preview and the same button,
 * so nobody deletes words they have not seen.
 *
 * ⛔ "Copy text" calls `navigator.clipboard.writeText` inside the click. When the
 * browser refuses (or has no clipboard), the preview's text is selected so the member
 * can copy it by hand, and the offer says so.
 *
 * ⛔ The sentence is the offer's own (`copy.reason`), never the server's.
 *
 * Focus: when the Discard confirm swaps in, focus moves into it ("Keep it", the safe
 * answer); "Keep it" returns focus to the offer's "Discard".
 *
 * ⭐ Fix round 5 (review C-4, I-8, M-19):
 *   · after a plain save lands the offer STAYS (the copy is kept) and says so; focus
 *     moves to its sentence, since the button that was pressed is gone;
 *   · the status line is ONE element for the offer's whole life, so a note on it is
 *     announced when its text changes, never re-mounted with the confirm;
 *   · the preview says when the copy holds items it cannot show as words, and says
 *     "This copy has no text." only when it truly holds nothing.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { copyClipboardText } from '../../lib/offline/refusedCopy'
import styles from './NoteEditorPage.module.css'

const COPIED = 'The words are on your clipboard.'
// ⛔ Fix round 5 (wording ruling): no keyboard is assumed.
const SELECTED = 'Your browser didn’t allow copying. The words are selected. '
  + 'Use your device’s copy command to copy them.'
const HIDDEN = 'This copy also holds pictures or other items that can’t be shown as text.'

function CopyPreview({ copy, previewRef }) {
  const empty = !copy.title && !copy.subtitle && !copy.bodyText
  return (
    <div
      ref={previewRef}
      className={styles.copyPreview}
      role="region"
      aria-label="Words in this copy"
      tabIndex={0}
      data-testid="refused-copy-preview"
    >
      {copy.title ? <div className={styles.copyPreviewTitle}>{copy.title}</div> : null}
      {copy.subtitle ? <div className={styles.copyPreviewSubtitle}>{copy.subtitle}</div> : null}
      {copy.bodyText ? <div className={styles.copyPreviewBody}>{copy.bodyText}</div> : null}
      {copy.hiddenItems ? <div className={styles.copyPreviewSubtitle}>{HIDDEN}</div> : null}
      {empty && !copy.hiddenItems ? <div className={styles.copyPreviewSubtitle}>This copy has no text.</div> : null}
    </div>
  )
}

export default function RefusedCopyOffer({ copy, busy = false, note = null, onSave, onSavePlain, onDiscard }) {
  const [asking, setAsking] = useState(false)
  const [clip, setClip] = useState(null)
  const previewRef = useRef(null)
  const keepRef = useRef(null)
  const discardRef = useRef(null)
  const reasonRef = useRef(null)
  const focusNext = useRef(null)
  const questionId = useId()
  const wasPlainSaved = useRef(Boolean(copy.plainSaved))

  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    ;(target === 'keep' ? keepRef : discardRef).current?.focus()
  }, [asking])

  // ⛔ Fix round 5 (M-19): a plain save that LANDS removes the button that was pressed;
  // focus moves to the offer's own sentence (which now says what happened), never to
  // the page. Only on the change, so opening a note never moves focus here.
  useEffect(() => {
    const now = Boolean(copy.plainSaved)
    if (now && !wasPlainSaved.current) reasonRef.current?.focus()
    wasPlainSaved.current = now
  }, [copy.plainSaved])

  const ask = () => { focusNext.current = 'keep'; setClip(null); setAsking(true) }
  const keep = () => { focusNext.current = 'discard'; setAsking(false) }

  const selectByHand = () => {
    const el = previewRef.current
    try {
      // Focus FIRST: moving focus can collapse a selection made before it.
      el?.focus?.()
      const sel = typeof window !== 'undefined' ? window.getSelection?.() : null
      if (el && sel) sel.selectAllChildren(el)
    } catch { /* the words are still on screen to select */ }
    setClip(SELECTED)
  }
  const copyText = () => {
    const text = copyClipboardText(copy)
    let pending = null
    try {
      // ⛔ Inside the click: a browser grants the clipboard only to a user gesture.
      pending = navigator.clipboard?.writeText?.(text) ?? null
    } catch {
      pending = null
    }
    if (!pending || typeof pending.then !== 'function') { selectByHand(); return }
    pending.then(() => setClip(COPIED), selectByHand)
  }
  const discard = async () => {
    const ok = await onDiscard?.(copy)
    if (!ok) keep()
  }

  const status = [note, clip].filter(Boolean).join(' ')
  const copyButton = (
    <button type="button" className={styles.draftBannerBtn} onClick={copyText}>
      Copy text
    </button>
  )
  // ⛔ Fix round 5 (C-4): after a plain save the copy's plain text IS saved elsewhere;
  // what plain text cannot hold is not.
  const question = copy.plainSaved
    ? 'Delete this copy from this device? Its plain text is in its own note, but everything plain text can’t hold is saved nowhere else, so this can’t be undone.'
    : 'Delete this copy from this device? Its words aren’t saved anywhere else, so this can’t be undone.'

  return (
    <section
      className={`${styles.draftBanner} ${styles.copyOffer}`}
      data-export-exclude
      data-testid="refused-copy-offer"
      aria-label="A copy of this note’s words"
    >
      {asking ? (
        <div className={styles.copyConfirm} role="group" aria-labelledby={questionId} data-testid="refused-copy-confirm">
          <span id={questionId}>{question}</span>
          <CopyPreview copy={copy} previewRef={previewRef} />
          <div className={styles.draftBannerActions}>
            {copyButton}
            <button
              type="button"
              className={`${styles.draftBannerBtn} ${styles.draftBannerBtnPrimary}`}
              onClick={discard}
              disabled={busy}
            >
              Delete copy
            </button>
            <button ref={keepRef} type="button" className={styles.draftBannerBtn} onClick={keep}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <>
          <span ref={reasonRef} tabIndex={-1} data-testid="refused-copy-reason">{copy.reason}</span>
          <CopyPreview copy={copy} previewRef={previewRef} />
          <div className={styles.draftBannerActions}>
            {copy.offerPlain ? (
              <button
                type="button"
                className={`${styles.draftBannerBtn} ${styles.draftBannerBtnPrimary}`}
                onClick={() => onSavePlain?.(copy)}
                disabled={busy}
              >
                Save as plain text
              </button>
            ) : null}
            {copy.offerSeparate ? (
              <button
                type="button"
                className={`${styles.draftBannerBtn} ${styles.draftBannerBtnPrimary}`}
                onClick={() => onSave?.(copy)}
                disabled={busy}
              >
                Save as a separate note
              </button>
            ) : null}
            {copyButton}
            <button ref={discardRef} type="button" className={styles.draftBannerBtn} onClick={ask} disabled={busy}>
              Discard
            </button>
          </div>
        </>
      )}
      {/* ⛔ Fix round 5 (M-19): ONE status line for the offer's whole life (outside the
          confirm swap), present and empty from the first render; only its text changes. */}
      <p className={styles.copyStatus} role="status">{status}</p>
    </section>
  )
}
