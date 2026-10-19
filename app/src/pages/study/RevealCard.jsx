/**
 * RevealCard — the bottom reveal panel (spec §4.6, §4.9, §13.7 D9, D11).
 *
 * Verdict line (gold `check` + "Correct" / muted `x` + "Not quite": words always,
 * never green or red, which mean price direction to a trader) · ticker and
 * dates · the one-line lesson · a "Why" disclosure (provenance, what happened
 * next, "Read the lesson") · Continue. For chart items the forward bars print
 * in the SAME chart: that append is the player's (`appendForwardBars`), this
 * card only says what happened.
 *
 * Haptics and the sound fire ONCE, on mount, from `feedbackPrefs(profile)`.
 */
import { useEffect, useRef } from 'react'
import UIcon from '../../components/ui/UIcon'
import { appendForwardBars } from './useStudySession'
import { feedbackPrefs, revealFeedback } from './studyFeedback'
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

export default function RevealCard({ correct, reveal, item, profile, onContinue, fire = true, className = '' }) {
  const fired = useRef(false)
  useEffect(() => {
    if (!fire || fired.current) return
    fired.current = true
    revealFeedback(!!correct, feedbackPrefs(profile))
  }, [correct, fire, profile])

  const sym = reveal?.sym
  const dates = dateRange(reveal)
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
      {(sym || dates) && (
        <p className={styles.meta}>
          {sym && <span className={styles.sym}>{sym}</span>}
          {sym && dates && <span className={styles.dot} aria-hidden="true"> · </span>}
          {dates && <span>{dates}</span>}
        </p>
      )}
      {lesson && <p className={styles.lesson}>{lesson}</p>}
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
      {onContinue && (
        <button type="button" className={styles.continue} onClick={onContinue}>Continue</button>
      )}
    </section>
  )
}
