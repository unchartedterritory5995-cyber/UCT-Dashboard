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
 *
 * ⭐⭐ I-A BYTES: THIS FILE IS ITS OWN CHUNK. A refused copy is rare, so the offer, its
 * host (`RefusedCopyOffers`: the busy state, the per-copy notes and the Save / Discard
 * choices that used to sit in the editor) and the display half of the copy
 * (`lib/offline/refusedCopyDisplay.js`) are fetched only when a note HAS an offer:
 * `NoteEditorPage` loads this module through `lib/lazyChunk.importWithOneRetry`, and says
 * so in a fixed sentence (with Try again) when it cannot. ⛔ Nothing may import this file
 * statically (rail: `RefusedCopyOffer.lazy.test.js`). The copy itself is held by the
 * static decision half (`lib/offline/refusedCopy.js`) whether or not this ever loads.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  copyClipboardText, discardRefusedCopy, refusedCopyView, saveRefusedCopy,
} from '../../lib/offline/refusedCopyDisplay'
import { conflictedCopyTitle } from '../../lib/offline/noteCopy'
import styles from './RefusedCopyOffer.module.css'

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

export default function RefusedCopyOffer({
  copy, busy = false, note = null, onSave, onSavePlain, onDiscard, focusReasonOnMount = false,
}) {
  const [asking, setAsking] = useState(false)
  const [clip, setClip] = useState(null)
  const previewRef = useRef(null)
  const keepRef = useRef(null)
  const discardRef = useRef(null)
  const reasonRef = useRef(null)
  const focusNext = useRef(null)
  const questionId = useId()
  const wasPlainSaved = useRef(Boolean(copy.plainSaved))

  // ⭐ I-A bytes: after the member's "Try again" brought the offer in, focus goes to its own
  // sentence (the button they pressed is gone), never to the page. Only on that mount.
  useEffect(() => {
    if (focusReasonOnMount) reasonRef.current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

const SAVE_FAILED = Object.freeze({ outcome: 'failed', offline: false })

/**
 * ⭐ I-A bytes: the editor's refused-copy offers, one per stored copy. Moved here from
 * `NoteEditorPage` (fix rounds 3-5) unchanged in behaviour, so the whole offer loads with
 * this chunk. The editor keeps the stored RECORDS (`entries`, from `recover()`), the
 * page-level "Saved as a separate note" notice and its live region, and the focus move when
 * an offer leaves the page; this host keeps what only an offer needs.
 *   · `withCopyStore(run, fallback)`: the durable layer's door to this account's store;
 *   · `fork`: the sweep's own `forkConflictedCopy` (the create, never a PUT to the source);
 *   · `onEntries(updater)`: replace or drop a record in the editor's list;
 *   · `onSaved(notice)`: the page-level notice once a copy became a note and left;
 *   · `onGone()`: an offer (and the button focused in it) is about to leave the page.
 */
export function RefusedCopyOffers({ entries, withCopyStore, fork, onEntries, onSaved, onGone, focusFirst = false }) {
  const [busy, setBusy] = useState(null)
  const [notes, setNotes] = useState({})
  const views = useMemo(() => (entries || []).map(refusedCopyView), [entries])
  const noteFor = (id, text) => setNotes((m) => ({ ...m, [id]: text }))
  const replace = (id, entry) => onEntries((list) => list.map((e) => (e.mutationId === id ? entry : e)))
  const drop = (id) => onEntries((list) => list.filter((e) => e.mutationId !== id))

  /** ⭐ I-A fix round 3 (C-3): "Save as a separate note" — the create again, as a
   *  NEW note, through the sweep's own `forkConflictedCopy`. The source note is never
   *  written. Refused again ⇒ kept, still offered, with the new reason.
   *  ⭐ Fix round 4 (I-6): with `plain`, "Save as plain text" — the same create, the
   *  body flattened to plain paragraphs (offered after a CONTENT refusal, which the
   *  create as it is can never get past). The stored copy keeps its original words
   *  until a create lands. */
  const save = async (copy, { plain = false } = {}) => {
    if (busy) return
    setBusy(copy.mutationId)
    try {
      const res = await withCopyStore((db) => saveRefusedCopy(db, copy.mutationId, { fork, plain }), SAVE_FAILED)
      // ⛔⛔ Fix round 5 (C-4): a plain save LANDED and the copy is KEPT — still offered,
      // now for Copy text and Discard only, with the offer saying what happened.
      if (res?.outcome === 'plain-saved') {
        if (res.entry) replace(copy.mutationId, res.entry)
        noteFor(copy.mutationId, `Saved as a separate note, as plain text: “${conflictedCopyTitle(copy.title)}”.`)
        return
      }
      if (res?.outcome === 'saved' || res?.outcome === 'gone') {
        // Fix round 5 (M-19): the offer is about to go, with the focused button in it.
        onGone()
        drop(copy.mutationId)
        if (res.outcome === 'saved') {
          onSaved(plain
            ? `Saved as a separate note, as plain text: “${conflictedCopyTitle(copy.title)}”.`
            : `Saved as a separate note: “${conflictedCopyTitle(copy.title)}”.`)
        }
        return
      }
      if (res?.outcome === 'refused') {
        if (res.entry) replace(copy.mutationId, res.entry)
        noteFor(copy.mutationId, plain ? 'Saving it as plain text was refused too.' : 'It still couldn’t be saved as a separate note.')
        return
      }
      // ⛔ Review wording flag: "when you're online" only when the network itself failed.
      noteFor(copy.mutationId, res?.offline
        ? 'It couldn’t be saved right now. The copy stays on this device; try again when you’re online.'
        : 'It couldn’t be saved right now. The copy stays on this device; try again later.')
    } finally {
      setBusy(null)
    }
  }
  /** "Discard" on a refused copy deletes it from this device — only after the
   *  member confirms in the page (never `window.confirm`). Resolves whether it did. */
  const discard = async (copy) => {
    if (busy) return false
    setBusy(copy.mutationId)
    try {
      const ok = await withCopyStore(async (db) => { await discardRefusedCopy(db, copy.mutationId); return true }, false)
      if (ok) {
        onGone()
        drop(copy.mutationId)
      } else {
        noteFor(copy.mutationId, 'The copy couldn’t be deleted. It stays on this device.')
      }
      return ok
    } finally {
      setBusy(null)
    }
  }

  return views.map((copy, i) => (
    <RefusedCopyOffer
      key={copy.mutationId}
      copy={copy}
      busy={busy === copy.mutationId}
      note={notes[copy.mutationId] || null}
      onSave={(c) => save(c)}
      onSavePlain={(c) => save(c, { plain: true })}
      onDiscard={discard}
      focusReasonOnMount={focusFirst && i === 0}
    />
  ))
}
