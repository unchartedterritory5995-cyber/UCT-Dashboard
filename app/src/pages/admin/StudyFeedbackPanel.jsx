/**
 * StudyFeedbackPanel — what members and the owner said about Study items,
 * from the reveal card ("Something off?") and from Discord (`/study`), in one
 * list on the review screen (owner 2026-10-21: "a system for reviewing in
 * site or in the discord and giving feedback for the quiz and test so we can
 * manually do this and ingest and update the information").
 *
 *   GET  /api/study/admin/feedback?unhandled=1      open rows, newest first
 *   POST /api/study/admin/feedback/handle           {ids, note}  -> handled
 *
 * A row names the item (ticker, date, subject, the question), the kind, the
 * note, who said it and through which door, and the verdict it carried (an
 * owner's approve / reject is already applied by the store; a fix is a note
 * for the next build). "Open" selects the item in the queue when it is a
 * draft; "Handled" clears the row. The export (`scripts/study/ingest_feedback.py`)
 * carries everything into docs/study so a regeneration keeps the verdicts.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import styles from './StudyReview.module.css'
import { FEEDBACK_EXPORT_URL, FEEDBACK_HANDLE_URL, feedbackKey } from './studyFeedbackHelpers'

const KIND_WORD = {
  wrong_answer: 'wrong answer', bad_chart: 'bad chart', unclear_question: 'question unclear',
  unclear_lesson: 'lesson unclear', too_easy: 'too easy', too_hard: 'too hard', great: 'great example',
  other: 'other',
}

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

function who(row) {
  const door = row.channel === 'discord' ? 'Discord' : row.channel === 'review' ? 'review screen' : 'the site'
  return `${row.role === 'owner' ? 'owner' : 'member'} · ${door}`
}

function when(row) {
  const s = row.at || ''
  return s.length >= 16 ? s.slice(0, 16).replace('T', ' ') : s
}

export default function StudyFeedbackPanel({ queueIds, onOpenItem }) {
  const [showHandled, setShowHandled] = useState(false)
  const key = feedbackKey(showHandled)
  const { data, error, mutate } = useSWR(key, fetcher, { revalidateOnFocus: false })
  const rows = useMemo(() => data?.feedback || [], [data])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  const handle = async (id) => {
    setBusy(id)
    setErr(null)
    try {
      const r = await fetch(FEEDBACK_HANDLE_URL, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      await mutate(
        (cur) => (cur && Array.isArray(cur.feedback)
          ? { ...cur, feedback: showHandled ? cur.feedback : cur.feedback.filter((f) => f.id !== id) }
          : cur),
        { revalidate: showHandled },
      )
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={styles.fbPanel} aria-label="Study feedback" data-testid="feedback-panel">
      <div className={styles.gBar}>
        <span className={styles.gHint}>
          What members and you said from the reveal card and from <code>/study</code> in Discord. An owner approve or
          reject is already applied; a fix is a note for the next build. Handled clears a row.
        </span>
        <label className={styles.fbToggle}>
          <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} />
          <span>Show handled</span>
        </label>
        <a className={styles.exportLink} href={FEEDBACK_EXPORT_URL} target="_blank" rel="noopener noreferrer">
          Export feedback
        </a>
      </div>
      {error && <div className={styles.empty}>Could not load the feedback ({error.message}).</div>}
      {!error && !data && <div className={styles.empty}>Loading the feedback…</div>}
      {data && rows.length === 0 && <div className={styles.empty}>Nothing waiting. Take the quiz, or leave a note from Discord.</div>}
      {err && <span className={styles.err}>{err}</span>}
      <ul className={styles.fbList}>
        {rows.map((row) => {
          const inQueue = queueIds?.has?.(row.item_id)
          return (
            <li key={row.id} className={styles.fbRow} data-testid="feedback-row" data-kind={row.kind}
              data-handled={row.handled_at ? '1' : '0'}>
              <div className={styles.fbHead}>
                <span className={styles.gSym}>{row.sym || row.type || row.item_id}</span>
                {row.asof && <span className={styles.gDate}>{row.asof}</span>}
                {row.subject && <span className={styles.fbSubject}>{row.subject}</span>}
                <span className={styles.fbKind}>{KIND_WORD[row.kind] || row.kind}</span>
                {row.verdict && <span className={`${styles.gGrade} ${styles[`fbV_${row.verdict}`] || ''}`}>{row.verdict}</span>}
                <span className={styles.fbRef}>ref {row.ref}</span>
              </div>
              {row.q && <p className={styles.fbQ}>{row.q}</p>}
              {row.text && <p className={styles.fbText}>{row.text}</p>}
              {row.answer_json != null && (
                <p className={styles.fbMeta}>
                  answered {typeof row.answer_json === 'string' ? row.answer_json : JSON.stringify(row.answer_json)}
                  {row.correct === true ? ' (correct)' : row.correct === false ? ' (not quite)' : ''}
                </p>
              )}
              <p className={styles.fbMeta}>
                {who(row)} · {when(row)}
                {row.handled_at && ` · handled${row.handled_note ? `: ${row.handled_note}` : ''}`}
              </p>
              <div className={styles.fbActions}>
                {inQueue && onOpenItem && (
                  <button type="button" className={styles.gBtn} onClick={() => onOpenItem(row.item_id)}>Open</button>
                )}
                {!row.handled_at && (
                  <button type="button" className={styles.gBtn} disabled={busy === row.id} onClick={() => handle(row.id)}>
                    Handled
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
