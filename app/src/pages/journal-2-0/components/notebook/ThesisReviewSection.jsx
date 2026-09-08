import { useEffect, useMemo, useRef, useState } from 'react'
import CollapsibleSection from '../CollapsibleSection'
import UIcon from '../../../../components/ui/UIcon'
import useThesisReviews from '../../hooks/useThesisReviews'
import styles from './ThesisReviewSection.module.css'

/**
 * Wave O — the finance-native review loop, where the research already is.
 *
 * ⛔ §32: the member does not open a task app, create a task, link a ticker and
 * come back. They are looking at the thesis; the review opens in place and
 * already knows what it is about.
 *
 * ⛔⛔ THE EPISTEMIC LINE THIS COMPONENT DEFENDS (§3). Five different things
 * appear on this one screen and none of them may be dressed as another:
 *
 *   what the SOURCE said        → the evidence rows (owned by ThesisSection)
 *   what the MEMBER wrote       → "Your assessment", their own textarea
 *   the evidence STANCE         → supporting / opposing counts
 *   what UCT NOTICED            → "Since your last review", facts only
 *   what the MEMBER DECIDED     → the outcome they pick
 *
 * ⛔ AND COMPLETING A REVIEW DOES NOT EDIT THE THESIS (§4/§9/§33). There is no
 * control here that writes a thesis status, and the completion summary says so
 * out loud rather than leaving the member to discover it.
 */

/** ⛔ The vocabulary is the server's (§7). No conviction slider, no 1-10 —
 *  evidence quality and independence differ, and a number derived from counting
 *  rows reads as a measurement while being nobody's opinion. */
const OUTCOMES = [
  { id: 'no_change', label: 'No change',
    hint: 'I reconsidered it and I still hold this view.' },
  { id: 'revised', label: 'Revised',
    hint: 'I changed the thesis itself — edit it above, then complete.' },
  { id: 'invalidated', label: 'Invalidated',
    hint: 'This thesis no longer holds.' },
  { id: 'deferred', label: 'Need more work',
    hint: "I couldn't settle it yet." },
]

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString()
}

/** ⛔ §12/§35 — the empty state is a DIFFERENT SENTENCE, not a zero. A thesis
 *  that has never been reviewed has not had "no changes since last review"; it
 *  has had no review, and saying the former makes the feature read as broken. */
function SinceLastReview({ attention }) {
  const ch = attention?.changes
  if (!ch) return null
  if (!ch.hasPriorReview) {
    return (
      <div className={styles.sinceBlock}>
        <div className={styles.sinceTitle}>No completed review yet</div>
        <p className={styles.sinceEmpty}>
          Once you complete one, this will show what changed since then.
        </p>
      </div>
    )
  }
  const facts = []
  if (ch.addedOpposing) facts.push({ k: 'opp', t: `${ch.addedOpposing} opposing evidence item${ch.addedOpposing === 1 ? '' : 's'} added` })
  if (ch.addedSupporting) facts.push({ k: 'sup', t: `${ch.addedSupporting} supporting evidence item${ch.addedSupporting === 1 ? '' : 's'} added` })
  // ⛔ §40 — two different facts. "I changed my mind" and "the world moved
  // under me" must not both read as "evidence removed".
  if (ch.removedByMember) facts.push({ k: 'rm', t: `${ch.removedByMember} evidence relationship${ch.removedByMember === 1 ? '' : 's'} you removed` })
  if (ch.sourcesNoLongerAvailable) facts.push({ k: 'gone', t: `${ch.sourcesNoLongerAvailable} evidence source${ch.sourcesNoLongerAvailable === 1 ? '' : 's'} no longer available` })
  if (ch.thesisEdits) facts.push({ k: 'edit', t: `the thesis was edited ${ch.thesisEdits} time${ch.thesisEdits === 1 ? '' : 's'}` })
  return (
    <div className={styles.sinceBlock}>
      <div className={styles.sinceTitle}>
        Since your last review{fmtDate(ch.since) ? ` (${fmtDate(ch.since)})` : ''}
      </div>
      {facts.length === 0 ? (
        <p className={styles.sinceEmpty}>Nothing has changed.</p>
      ) : (
        <ul className={styles.sinceList}>
          {facts.map((f) => <li key={f.k}>{f.t}</li>)}
        </ul>
      )}
      {/* ⛔ §13: new opposing evidence means THIS MAY DESERVE ATTENTION. It does
          not mean the thesis is invalid, and nothing here says or implies it. */}
      <p className={styles.sinceFooter}>
        What that means is your call.
      </p>
    </div>
  )
}

export default function ThesisReviewSection({ noteId, evidence = [] }) {
  const { draft, completed, attention, refresh } = useThesisReviews(noteId)
  const [open, setOpen] = useState(false)
  const [memberNote, setMemberNote] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [nextReviewAt, setNextReviewAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const triggerRef = useRef(null)
  const reviewIdRef = useRef(null)

  const counts = useMemo(() => ({
    supports: evidence.filter((e) => e.stance === 'supports').length,
    opposes: evidence.filter((e) => e.stance === 'opposes').length,
  }), [evidence])

  // Resume the member's own work if a draft already exists.
  useEffect(() => {
    if (!open || !draft) return
    reviewIdRef.current = draft.id
    setMemberNote((v) => v || draft.memberNote || '')
    setOutcome((v) => v || draft.outcome || null)
    setNextReviewAt((v) => v || draft.nextReviewAt || '')
  }, [open, draft])

  const start = async () => {
    setError(null)
    setOpen(true)
    try {
      const r = await fetch(`/api/j2/notes/${noteId}/reviews`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      })
      if (!r.ok) throw new Error('Could not open a review')
      reviewIdRef.current = (await r.json()).review.id
      await refresh()
    } catch (e) {
      setError(e.message)
    }
  }

  // ⛔ §34 — the member's writing must survive a closed modal, a route change
  // or a failed request. Autosaved to the DRAFT, which can never become a
  // completed review on its own.
  useEffect(() => {
    if (!open || !reviewIdRef.current) return undefined
    const t = setTimeout(() => {
      fetch(`/api/j2/reviews/${reviewIdRef.current}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberNote, outcome, nextReviewAt: nextReviewAt || null }),
      }).catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [open, memberNote, outcome, nextReviewAt])

  const close = () => {
    setOpen(false)
    setError(null)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const complete = async () => {
    if (!outcome || !reviewIdRef.current) return
    setSaving(true)
    setError(null)
    try {
      const r = await fetch(`/api/j2/reviews/${reviewIdRef.current}/complete`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberNote, outcome, nextReviewAt: nextReviewAt || null }),
      })
      if (!r.ok) throw new Error((await r.json()).detail || 'Could not complete the review')
      setAnnouncement(`Review completed: ${OUTCOMES.find((o) => o.id === outcome)?.label}.`)
      setMemberNote(''); setOutcome(null); setNextReviewAt('')
      reviewIdRef.current = null
      await refresh()
      close()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const last = completed[0] || null

  return (
    <div className={styles.wrap} data-export-exclude>
      <div className={styles.srOnly} role="status" aria-live="polite"
           aria-label="Review status">{announcement}</div>

      {!open ? (
        <div className={styles.summaryRow}>
          <span className={styles.summaryText}>
            {last
              ? <>Last reviewed {fmtDate(last.completedAt)} — {OUTCOMES.find((o) => o.id === last.outcome)?.label || last.outcome}</>
              : 'This thesis has not been reviewed yet.'}
          </span>
          <button type="button" ref={triggerRef} className={styles.reviewBtn}
                  onClick={start}>
            <UIcon name="check" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            Review thesis
          </button>
        </div>
      ) : (
        <div className={styles.panel} role="group" aria-label="Thesis review">
          {/* WHAT AM I REVIEWING — evidence state first, because it is the
              thing the member is being asked to weigh. */}
          <div className={styles.contextRow}>
            <span className={`${styles.countPill} ${styles.supports}`}>
              {counts.supports} supporting
            </span>
            <span className={`${styles.countPill} ${styles.opposes}`}>
              {counts.opposes} opposing
            </span>
          </div>

          <SinceLastReview attention={attention} />

          <label className={styles.label} htmlFor={`review-note-${noteId}`}>
            Your assessment
          </label>
          <textarea
            id={`review-note-${noteId}`}
            className={styles.textarea}
            rows={4}
            value={memberNote}
            onChange={(e) => setMemberNote(e.target.value)}
            placeholder="What do you make of it now?"
          />
          <p className={styles.hint}>Your own words — kept separate from the sources.</p>

          <div className={styles.label} id={`review-outcome-${noteId}`}>Your decision</div>
          <div className={styles.outcomes} role="radiogroup"
               aria-labelledby={`review-outcome-${noteId}`}>
            {OUTCOMES.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={outcome === o.id}
                title={o.hint}
                className={`${styles.outcomeBtn} ${outcome === o.id ? styles.outcomeBtnActive : ''}`}
                onClick={() => setOutcome(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {outcome && (
            <p className={styles.hint}>{OUTCOMES.find((o) => o.id === outcome)?.hint}</p>
          )}

          <label className={styles.label} htmlFor={`review-next-${noteId}`}>
            Next review
          </label>
          <input
            id={`review-next-${noteId}`}
            type="date"
            className={styles.dateInput}
            value={nextReviewAt}
            onChange={(e) => setNextReviewAt(e.target.value)}
          />

          {/* ⛔ §33 — say what completing does, and what it does NOT do. A
              member should never discover afterwards that the thesis was or
              was not touched. */}
          <p className={styles.sideEffects}>
            Completing records your decision and this note in your review history.
            It does not change the thesis itself — edit the thesis above if you
            want it to change.
          </p>

          {error && <div className={styles.error} role="alert">{error}</div>}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={close}>
              Cancel
            </button>
            <button type="button" className={styles.completeBtn}
                    onClick={complete} disabled={!outcome || saving}>
              {saving ? 'Completing…' : 'Complete review'}
            </button>
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <CollapsibleSection id={`thesis-reviews-${noteId}`} title="Review history"
                            defaultOpen={false}>
          <ul className={styles.historyList}>
            {completed.map((r) => (
              <li key={r.id} className={styles.historyRow}>
                <span className={styles.historyDate}>{fmtDate(r.completedAt)}</span>
                <span className={styles.historyOutcome}>
                  {OUTCOMES.find((o) => o.id === r.outcome)?.label || r.outcome}
                </span>
                {/* ⛔ §26 — labelled as the member's own writing, never shown
                    as though it were a source. */}
                {r.memberNote && (
                  <span className={styles.historyNote}>“{r.memberNote}”</span>
                )}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </div>
  )
}
