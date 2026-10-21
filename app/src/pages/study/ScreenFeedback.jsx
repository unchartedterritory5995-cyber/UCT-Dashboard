/**
 * ScreenFeedback — "Feedback on this screen" (owner 2026-10-21: "show me
 * everything ... so we can go through it all and continue reviewing and
 * structuring each section properly as well as the overall layout and visual
 * and effects and interactive and learning and everything").
 *
 * A reviewer-only door on every Study screen: one tap says what the note is
 * about (layout, visuals, effects, how it works, teaching, broken, great), a
 * note in the owner's words, and what the screen was showing rides along as
 * `context` (the item, the question number, the open unit). Posted to
 * `POST /api/study/admin/screen-feedback`; it lands in the review screen's
 * Feedback list beside the item notes and the ingest carries it into
 * docs/study/feedback/REPORT.md. Nothing is applied.
 *
 *   <ScreenFeedback screen="landing" context={{ study: 'today' }} />
 *
 * The item door on the reveal card ("Review this one") stays the place for a
 * note on ONE question; this one is for the screen around it.
 */
import { useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { studyFetch } from './useStudySession'
import { SCREEN_FEEDBACK_URL, SCREEN_KINDS, screenLabel } from './screenFeedbackHelpers'
import styles from './ScreenFeedback.module.css'

export default function ScreenFeedback({ screen, context = null, compact = false, align = 'end', up = false,
  className = '', post = studyFetch }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(0)
  const [err, setErr] = useState(null)

  if (!screen) return null
  const close = () => { setOpen(false); setErr(null) }
  const send = async () => {
    setBusy(true)
    setErr(null)
    try {
      await post(SCREEN_FEEDBACK_URL, {
        method: 'POST',
        body: { screen, kind: kind || 'other', text: text.trim() || null, context: context || null },
      })
      setSent((n) => n + 1)
      setKind(null)
      setText('')
      setOpen(false)
    } catch {
      setErr('Could not save that. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const canSend = !!kind || !!text.trim()

  return (
    <div className={`${styles.wrap} ${className}`} data-testid="screen-feedback" data-screen={screen}>
      <button type="button" className={compact ? styles.iconBtn : styles.openBtn}
        aria-expanded={open} aria-label={compact ? 'Feedback on this screen' : undefined}
        title="Feedback on this screen" onClick={() => (open ? close() : setOpen(true))}
        data-testid="screen-feedback-open">
        <UIcon name="chat" size={compact ? 16 : 14} gold={false} />
        {!compact && <span>Feedback on this screen</span>}
        {sent > 0 && <span className={styles.sentDot} data-testid="screen-feedback-sent">{sent}</span>}
      </button>
      {open && (
        <div className={`${styles.panel} ${align === 'start' ? styles.panelStart : ''} ${up ? styles.panelUp : ''}`}
          role="dialog" aria-label={`Feedback on the ${screenLabel(screen)}`} data-testid="screen-feedback-form">
          <p className={styles.title}>
            Feedback on this screen <span className={styles.where}>· {screenLabel(screen)}</span>
          </p>
          <div className={styles.chips} role="group" aria-label="What it is about">
            {SCREEN_KINDS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={kind === k}
                className={`${styles.chip} ${kind === k ? styles.chipOn : ''}`}
                onClick={() => setKind(kind === k ? null : k)}>{label}</button>
            ))}
          </div>
          <textarea className={styles.text} aria-label="Your note" rows={3} maxLength={2000}
            placeholder="What to change, in your words" value={text}
            onChange={(e) => setText(e.target.value)} />
          <div className={styles.actions}>
            <button type="button" className={styles.send} disabled={busy || !canSend} onClick={send}
              data-testid="screen-feedback-send">Save note</button>
            <button type="button" className={styles.cancel} disabled={busy} onClick={close}>Cancel</button>
            {err && <span className={styles.err} role="alert">{err}</span>}
          </div>
          <p className={styles.hint}>Lands in the review screen&apos;s Feedback list.</p>
        </div>
      )}
      {!open && sent > 0 && !compact && (
        <span className={styles.saved} role="status">Saved. It is in the Feedback list.</span>
      )}
    </div>
  )
}
