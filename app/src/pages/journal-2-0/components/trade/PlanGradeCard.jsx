/**
 * Wave 13 lane 13A — "Plan vs execution" on the closed-trade page.
 *
 * Four checks against the plan the member wrote BEFORE the trade: Entry, Stop, Size, Target.
 * Every number comes from the server (`plan_grading.py`, deterministic arithmetic); this card
 * only words it. The plan is FROZEN at its first match, so editing the plan note later never
 * changes what this card says — only Re-link does, and it says so.
 *
 * A trade with no plan is labelled Unplanned: flagged, never hidden. Dark behind
 * `notebook_plan_grading_enabled` (renders nothing while off).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import usePlanGrade from '../../hooks/usePlanGrade'
import styles from './PlanGradeCard.module.css'
import { LABEL_TEXT, TIER_TEXT, checkDetail, checkVerdict, px } from '../../lib/planGradeText'

const CHECKS = [
  { key: 'entry', label: 'Entry' },
  { key: 'stop', label: 'Stop' },
  { key: 'size', label: 'Size' },
  { key: 'target', label: 'Target' },
]

function noteHref(id) {
  return `/journal?j2tab=notebook&note=${encodeURIComponent(id)}`
}

function CandidateList({ candidates, busy, onPick, allowNone }) {
  return (
    <ul className={styles.candidates}>
      {candidates.map((c) => (
        <li key={`${c.kind}:${c.id}`}>
          <button type="button" className={styles.candidate} disabled={busy}
            onClick={() => onPick(c.kind === 'verdict' ? { verdictId: c.id } : { noteId: c.id })}>
            <span className={styles.candidateTitle}>{c.title || (c.kind === 'verdict' ? 'Compass verdict' : 'Untitled note')}</span>
            <span className={styles.candidateMeta}>
              Entry {px(c.plan?.entry)} · Stop {px(c.plan?.stop)}
              {c.editedAfterEntry ? ' · edited after entry' : ''}
            </span>
          </button>
        </li>
      ))}
      {allowNone && (
        <li>
          <button type="button" className={styles.candidate} disabled={busy} onClick={() => onPick({ none: true })}>
            <span className={styles.candidateTitle}>This trade had no plan</span>
          </button>
        </li>
      )}
    </ul>
  )
}

/** The review door, loaded on the click (it pulls the chart-embed builder in with it). */
async function defaultWriteReview(grade, trade) {
  const { createPlanReviewNote } = await import('../../lib/planReview')
  return createPlanReviewNote(grade, trade)
}

export default function PlanGradeCard({ tradeId, trade, onTagSetup, onOpenNote, onWriteReview = defaultWriteReview }) {
  const { enabled, grade, error, isLoading, relink, mutate } = usePlanGrade(tradeId)
  const [relinking, setRelinking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [reviewState, setReviewState] = useState(null)

  if (!enabled) return null

  const pick = async (choice) => {
    setBusy(true)
    setActionError(null)
    try {
      await relink(choice)
      setRelinking(false)
    } catch (e) {
      setActionError(e.message || 'Could not re-link')
    } finally {
      setBusy(false)
    }
  }

  const writeReview = async () => {
    if (!onWriteReview || !grade) return
    setReviewState('saving')
    setActionError(null)
    try {
      const note = await onWriteReview(grade, trade)
      setReviewState(null)
      if (note?.id && onOpenNote) onOpenNote(note.id)
    } catch (e) {
      setReviewState(null)
      setActionError(e.message || 'Could not write the review note')
    }
  }

  let body
  if (isLoading && !grade) {
    body = <p className={styles.muted} data-testid="plan-grade-loading">Reading your plan…</p>
  } else if (error) {
    body = (
      <p className={styles.muted} role="alert">
        Couldn’t load the plan grade.{' '}
        <button type="button" className={styles.linkBtn} onClick={() => mutate()}>Try again</button>
      </p>
    )
  } else if (!grade) {
    body = null
  } else if (grade.status === 'unplanned' || grade.status === 'member_none') {
    body = (
      <>
        <p className={styles.statusLine}>
          <span className={`${styles.chip} ${styles.chipUnplanned}`} data-testid="plan-grade-unplanned">Unplanned</span>
          {grade.status === 'member_none'
            ? 'You marked this trade as having no plan.'
            : 'No plan for this trade was written before entry. Link a plan note, or write one with Entry, Stop, Target and Shares before your next trade.'}
        </p>
      </>
    )
  } else if (grade.status === 'needs_pick') {
    body = (
      <>
        <p className={styles.statusLine}>More than one plan could be this trade’s. Pick the one you traded:</p>
        <CandidateList candidates={grade.candidates || []} busy={busy} onPick={pick} allowNone />
      </>
    )
  } else {
    const plan = grade.plan || {}
    const checks = grade.checks || {}
    body = (
      <>
        <p className={styles.source}>
          {plan.sourceLabel || 'Plan'}
          {plan.matchTier ? <span className={styles.muted}> · {TIER_TEXT[plan.matchTier] || plan.matchTier}</span> : null}
          {plan.noteId ? (
            <> · <Link className={styles.linkBtn} to={noteHref(plan.noteId)}>{plan.noteTitle || 'Open the plan'}</Link></>
          ) : null}
          {checks.r ? <span className={styles.muted}> · 1R = {px(checks.r)}</span> : null}
        </p>
        <ul className={styles.checks} aria-label="Plan checks">
          {CHECKS.map(({ key, label }) => {
            const c = checks[key]
            const v = checkVerdict(key, c)
            return (
              <li key={key} className={styles.check} data-check={key}>
                <span className={styles.checkName}>{label}</span>
                <span className={`${styles.verdict} ${styles[`tone_${v.tone}`]}`}>{v.word}</span>
                <span className={styles.checkDetail}>{checkDetail(key, c, plan)}</span>
              </li>
            )
          })}
        </ul>
        {grade.labels?.length ? (
          <ul className={styles.labels} aria-label="About this grade">
            {grade.labels.map((l) => <li key={l} className={styles.label}>{LABEL_TEXT[l] || l}</li>)}
          </ul>
        ) : null}
        <p className={styles.frozen}>
          Frozen when it was first matched{plan.relinkedAt ? ', then re-linked by you' : ''}. Editing the plan does not change this grade.
        </p>
        {grade.setupChip && onTagSetup ? (
          <button type="button" className={styles.setupChip} data-testid="plan-setup-chip"
            onClick={async () => { await onTagSetup(grade.setupChip.setup); mutate() }}>
            Tag setup: {grade.setupChip.setup}
          </button>
        ) : null}
      </>
    )
  }

  const canRelink = grade && grade.status !== 'needs_pick'
  const canReview = grade && grade.status === 'planned'

  return (
    <section className={styles.card} aria-labelledby="plan-grade-title" data-testid="plan-grade-card">
      <h2 id="plan-grade-title" className={styles.title}>Plan vs execution</h2>
      {body}
      {actionError && <p className={styles.error} role="alert">{actionError}</p>}
      {(canRelink || canReview) && (
        <div className={styles.actions}>
          {canReview && (
            <button type="button" className={styles.actionBtn} onClick={writeReview} disabled={reviewState === 'saving'}>
              {reviewState === 'saving' ? 'Writing…' : 'Write review note'}
            </button>
          )}
          {canRelink && (
            <button type="button" className={styles.actionBtn} aria-expanded={relinking}
              onClick={() => setRelinking((v) => !v)}>
              {grade.status === 'planned' ? 'Re-link' : 'Link a plan'}
            </button>
          )}
        </div>
      )}
      {relinking && canRelink && (
        (grade.candidates || []).length
          ? <CandidateList candidates={grade.candidates} busy={busy} onPick={pick} allowNone={grade.status === 'planned'} />
          : <p className={styles.muted}>No plan notes on {grade.symbol} from the 30 days before entry. Link one from the note itself.</p>
      )}
    </section>
  )
}
