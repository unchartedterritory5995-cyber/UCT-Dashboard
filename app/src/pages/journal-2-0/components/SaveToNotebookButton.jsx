import { useEffect, useRef, useState } from 'react'
import ContextPopover from '../../../components/mobile/ContextPopover'
import UIcon from '../../../components/ui/UIcon'
import { useJournalToast, JournalToast } from '../lib/useJournalToast'
import styles from './SaveToNotebookButton.module.css'

/**
 * G-040 (wave 10, lane CX) — the ONE "Save to Notebook" control the three
 * trader-specific doors share: the Screener page, the COT tab's positioning rail
 * and the Model Book. Rulings: docs/notebook/future-internal-capture-expansion.md.
 *
 * ⭐ NO NEW WRITE PATH. A press builds the surface's capture and hands it to
 * `sendCaptureToJournal` — the chokepoint every widget door already funnels
 * through: the unsent-work door guard, the current-note → inbox route, the
 * `append_widget_embed` call site that `f5Freeze.test.js` freezes, and its
 * `settleNoteWrite`. So a capture from these surfaces lands its revision exactly
 * like every other door (no fork), and a LOCKED note answers with the same visible
 * message the other doors use (ruling 149): the capture waits in the inbox and the
 * toast says the note is locked.
 *
 * ⛔ THE CAPTURE IS BUILT ON PRESS, ONCE. With `withAnnotation` the member types
 * their words in a small box before it is sent; the capture was frozen when the box
 * opened, so a rail that scrubbed or a list that re-sorted meanwhile cannot change
 * what is saved (the CaptureMenu rule, same reason).
 *
 * ⛔ `sendCaptureToJournal` is imported ON PRESS. It pulls the embed core and the
 * offline store opener, and none of the three host pages needs either until a member
 * actually saves something.
 *
 * @param {string}   widgetId        the registry id ('screener' | 'cot' | 'modelbook')
 * @param {Function} buildCapture    () => loose capture | null — null means "nothing to save"
 * @param {string}   label           names the capture in the toast
 * @param {string}   ariaLabel       the button's accessible name
 * @param {boolean}  withAnnotation  ask for the member's optional words first (Model Book)
 */
export default function SaveToNotebookButton({
  widgetId, buildCapture, label, ariaLabel, withAnnotation = false, disabled = false,
}) {
  const [msg, setMsg] = useJournalToast()
  const [pending, setPending] = useState(null) // {anchor, capture} while the annotation box is open
  const [annotation, setAnnotation] = useState('')
  const [busy, setBusy] = useState(false)
  const noteRef = useRef(null)

  // ⭐ KEYBOARD FIRST: the box takes focus as soon as it is on screen, so a member who
  // opened it with Enter can type at once. ⚠️ Measured in a real Chromium on the lane CX
  // walk (2026-10-01): the anchored ContextPopover rendered with focus left on the
  // trigger, while jsdom reported the textarea focused. The popover is measured before
  // it is shown (`visibility: hidden`), and focusing a hidden node is a silent no-op, so
  // this waits for the box to be visible and focuses it itself.
  useEffect(() => {
    if (!pending) return undefined
    let tries = 0
    let raf = 0
    const tick = () => {
      const el = noteRef.current
      const shown = el && el.isConnected && getComputedStyle(el).visibility !== 'hidden'
      if (shown) {
        if (document.activeElement !== el) el.focus()
        return
      }
      tries += 1
      if (tries < 60) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pending])

  const send = async (capture) => {
    setBusy(true)
    setMsg('Saving…')
    try {
      const { sendCaptureToJournal } = await import('../lib/sendToJournal')
      setMsg(await sendCaptureToJournal(widgetId, capture, { label }))
    } catch {
      setMsg('Capture failed — try again')
    } finally {
      setBusy(false)
    }
  }

  const onPress = (e) => {
    if (busy) return
    const capture = buildCapture()
    if (!capture) return
    if (!withAnnotation) { send(capture); return }
    // Anchor on the BUTTON, not the pointer: a keyboard press reports clientX 0.
    const r = e.currentTarget.getBoundingClientRect()
    setAnnotation('')
    setPending({ anchor: { x: r.left, y: r.bottom + 4 }, capture })
  }

  const confirm = () => {
    if (!pending) return
    const text = annotation.trim()
    const capture = text ? { ...pending.capture, annotation: text } : pending.capture
    setPending(null)
    send(capture)
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        onClick={onPress}
        disabled={disabled || busy}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <UIcon name="journal" size={13} />
        <span className={styles.btnLabel}>Save to Notebook</span>
      </button>
      <JournalToast msg={msg} />
      {pending && (
        <ContextPopover open onClose={() => setPending(null)} anchor={pending.anchor}
          title="Save to Notebook" width={280}>
          <div className={styles.box}>
            <textarea
              ref={noteRef}
              className={styles.note}
              value={annotation}
              onChange={(ev) => setAnnotation(ev.target.value)}
              placeholder="Your note on this (optional)"
              rows={3}
              aria-label="Your note on this (optional)"
            />
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={confirm}>Save</button>
              <button type="button" className={styles.secondary} onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </ContextPopover>
      )}
    </span>
  )
}
