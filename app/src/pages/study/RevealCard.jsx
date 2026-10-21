/**
 * RevealCard — the bottom reveal panel (spec §4.6, §4.9, §13.7 D9, D11).
 *
 * Verdict line (gold `check` + "Correct" / muted `x` + "Not quite": words always,
 * never green or red, which mean price direction to a trader) · ticker and
 * dates · the lesson (the six-part lesson when the item carries one, else the
 * one paragraph) · a "Why" disclosure (provenance, what happened next, "Read
 * the lesson") · the feedback door · Continue. For chart items the forward bars
 * print in the SAME chart: that append is the player's (`appendForwardBars`),
 * this card only says what happened.
 *
 * The feedback door (owner 2026-10-21: "a system for reviewing in site or in
 * the discord and giving feedback for the quiz and test"): one tap says what
 * is off (or that the example is great), with an optional note, posted to
 * `POST /api/study/items/{id}/feedback`. A reviewer (an admin) also gets a
 * verdict row, so taking the quiz IS the review: Approve publishes, Reject
 * retires, Needs fix leaves a note for the next build. The card prints the
 * item's short ref ("ref 872a0a") so the same note can be left from Discord.
 *
 * Haptics and the sound fire ONCE, on mount, from `feedbackPrefs(profile)`.
 */
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import { appendForwardBars, studyFetch } from './useStudySession'
import { feedbackPrefs, revealFeedback } from './studyFeedback'
import { FEEDBACK_KINDS, VERDICTS, feedbackUrl, lessonParts } from './revealCardHelpers'
import styles from './RevealCard.module.css'

export { appendForwardBars }

export const CORRECT_WORD = 'Correct'
export const WRONG_WORD = 'Not quite'

export function lessonHrefFor(reveal) {
  const key = reveal?.lesson_key || reveal?.lessonKey
  if (!key) return null
  return `/desk?section=courses&lesson=${encodeURIComponent(key)}`
}

function answerWord(reveal) {
  const a = reveal?.answer
  if (a == null) return null
  if (typeof a === 'string' || typeof a === 'number') return String(a)
  if (typeof a === 'object') {
    if (a.answer != null && typeof a.answer !== 'object') return String(a.answer)
    if (a.shares != null) return `${a.shares} shares${a.dollars != null ? `, $${Math.round(a.dollars)} at risk` : ''}`
  }
  return null
}

function dateRange(reveal) {
  const from = reveal?.start || reveal?.from
  const to = reveal?.asof || reveal?.to
  if (from && to) return `${from} to ${to}`
  return to || from || ''
}

const SENT_WORD = { approve: 'Approved. It is live.', reject: 'Retired from the bank.', fix: 'Noted for the next build.' }

export function FeedbackBar({ itemId, attemptId = null, reviewer = false, post = studyFetch }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState(null)
  const [verdict, setVerdict] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)        // {applied} once sent
  const [err, setErr] = useState(null)

  if (!itemId) return null
  if (done) {
    const word = done.applied ? SENT_WORD[done.applied] : (verdict === 'fix' ? SENT_WORD.fix : 'Thanks, noted.')
    return <p className={styles.fbDone} role="status" data-testid="feedback-done">{word}</p>
  }
  if (!open) {
    return (
      <div className={styles.fbRow}>
        <button type="button" className={styles.fbOpen} onClick={() => setOpen(true)} data-testid="feedback-open">
          {reviewer ? 'Review this one' : 'Something off?'}
        </button>
      </div>
    )
  }
  const canSend = !!kind || !!verdict
  const send = async () => {
    setBusy(true)
    setErr(null)
    try {
      const body = { kind: kind || 'other', text: text.trim() || null }
      if (attemptId != null) body.attempt_id = attemptId
      if (reviewer && verdict) body.verdict = verdict
      const res = await post(feedbackUrl(itemId), { method: 'POST', body })
      setDone({ applied: res?.applied || null })
    } catch {
      setErr('Could not send that. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.fb} data-testid="feedback-form">
      <div className={styles.fbChips} role="group" aria-label="What is off">
        {FEEDBACK_KINDS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k}
            className={`${styles.fbChip} ${kind === k ? styles.fbChipOn : ''}`}
            onClick={() => setKind(kind === k ? null : k)}>{label}</button>
        ))}
      </div>
      {reviewer && (
        <div className={styles.fbChips} role="radiogroup" aria-label="Reviewer verdict" data-testid="verdict-row">
          {VERDICTS.map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={verdict === v}
              className={`${styles.fbChip} ${styles[`fbV_${v}`] || ''} ${verdict === v ? styles.fbChipOn : ''}`}
              onClick={() => setVerdict(verdict === v ? null : v)}>{label}</button>
          ))}
        </div>
      )}
      <textarea className={styles.fbText} aria-label="Your note" rows={2} maxLength={2000}
        placeholder={reviewer ? 'What to change, in your words' : 'Anything else (optional)'}
        value={text} onChange={(e) => setText(e.target.value)} />
      <div className={styles.fbActions}>
        <button type="button" className={styles.fbSend} disabled={busy || !canSend} onClick={send}>Send</button>
        <button type="button" className={styles.fbCancel} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        {err && <span className={styles.fbErr} role="alert">{err}</span>}
      </div>
    </div>
  )
}

export default function RevealCard({
  correct, reveal, item, profile, onContinue, fire = true, className = '',
  attemptId = null, reviewer = false, feedback = true, post = studyFetch,
}) {
  const fired = useRef(false)
  useEffect(() => {
    if (!fire || fired.current) return
    fired.current = true
    revealFeedback(!!correct, feedbackPrefs(profile))
  }, [correct, fire, profile])

  const sym = reveal?.sym
  const dates = dateRange(reveal)
  const ref = reveal?.ref || null
  const parts = lessonParts(reveal)
  const lesson = reveal?.lesson || reveal?.mini_lesson || ''
  const next = reveal?.what_happened_next || reveal?.outcome_text || reveal?.next || ''
  const prov = reveal?.provenance || {}
  const href = lessonHrefFor(reveal)
  const key = answerWord(reveal)
  const forwardCount = Array.isArray(reveal?.forward_bars) ? reveal.forward_bars.length : 0

  return (
    <section className={`${styles.card} ${className}`.trim()} data-testid="reveal-card" data-correct={correct ? '1' : '0'}>
      <p className={`${styles.verdict} ${correct ? styles.verdictCorrect : styles.verdictWrong}`} role="status" aria-live="polite">
        <span className={styles.verdictIcon} aria-hidden="true">
          <UIcon name={correct ? 'check' : 'x'} size={20} gold={!!correct} />
        </span>
        <span className={styles.verdictWord}>{correct ? CORRECT_WORD : WRONG_WORD}</span>
        {!correct && key && <span className={styles.verdictKey}>The answer: {key}</span>}
      </p>
      {(sym || dates || ref) && (
        <p className={styles.meta}>
          {sym && <span className={styles.sym}>{sym}</span>}
          {sym && dates && <span className={styles.dot} aria-hidden="true"> · </span>}
          {dates && <span>{dates}</span>}
          {ref && <span className={styles.ref} data-testid="item-ref">ref {ref}</span>}
        </p>
      )}
      {parts ? (
        <dl className={styles.lessonParts} data-testid="lesson-parts">
          {parts.map((p) => (
            <div key={p.key} className={styles.part}>
              <dt className={styles.partLabel}>{p.label}</dt>
              <dd className={styles.partText}>{p.text}</dd>
            </div>
          ))}
        </dl>
      ) : (
        lesson && <p className={styles.lesson}>{lesson}</p>
      )}
      <details className={styles.why}>
        <summary className={styles.whySummary}>Why</summary>
        <div className={styles.whyBody}>
          {(prov.source_kind || prov.source_ref) && (
            <p className={styles.whyLine}>
              <span className={styles.whyLabel}>Source</span>
              {[prov.source_kind, prov.source_ref].filter(Boolean).join(' · ')}
            </p>
          )}
          {next && (
            <p className={styles.whyLine}>
              <span className={styles.whyLabel}>What happened next</span>
              {next}
            </p>
          )}
          {!next && forwardCount > 0 && (
            <p className={styles.whyLine}>
              <span className={styles.whyLabel}>What happened next</span>
              The next {forwardCount} bars are on the chart.
            </p>
          )}
          {href && (
            <a className={styles.lessonLink} href={href}>Read the lesson</a>
          )}
        </div>
      </details>
      {feedback && item?.id && (
        <FeedbackBar itemId={item.id} attemptId={attemptId} reviewer={reviewer} post={post} />
      )}
      {onContinue && (
        <button type="button" className={styles.continue} onClick={onContinue}>Continue</button>
      )}
    </section>
  )
}
