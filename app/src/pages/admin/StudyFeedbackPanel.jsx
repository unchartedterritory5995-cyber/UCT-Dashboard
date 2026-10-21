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
 *
 * Notes on a whole SCREEN (the "Feedback on this screen" door: layout,
 * visuals, effects, how it works, teaching) sit in the same list, marked with
 * the screen they were left on and what it was showing; the scope select
 * narrows the list to questions or to screens.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import styles from './StudyReview.module.css'
import { FEEDBACK_EXPORT_URL, FEEDBACK_HANDLE_URL, FEEDBACK_SCOPES, feedbackKey } from './studyFeedbackHelpers'
import { screenLabel } from '../study/screenFeedbackHelpers'

const KIND_WORD = {
  wrong_answer: 'wrong answer', bad_chart: 'bad chart', unclear_question: 'question unclear',
  unclear_lesson: 'lesson unclear', too_easy: 'too easy', too_hard: 'too hard', great: 'great example',
  other: 'other',
  // notes on a whole screen (study_store.SCREEN_KINDS)
  layout: 'layout', visuals: 'visuals', effects: 'effects', interaction: 'how it works',
  learning: 'teaching', broken: 'broken',
}

function contextLine(ctx) {
  if (!ctx || typeof ctx !== 'object') return ''
  return Object.entries(ctx).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k} ${v}`).join(' · ')
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
  const [scope, setScope] = useState('all')
  const key = feedbackKey(showHandled, scope)
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
        <select aria-label="Show notes" className={styles.select} value={scope}
          onChange={(e) => setScope(e.target.value)} data-testid="feedback-scope">
          {FEEDBACK_SCOPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
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
          const inQueue = !row.screen && queueIds?.has?.(row.item_id)
          const where = row.screen ? contextLine(row.context) : ''
          return (
            <li key={row.id} className={styles.fbRow} data-testid="feedback-row" data-kind={row.kind}
              data-handled={row.handled_at ? '1' : '0'} data-screen={row.screen || undefined}>
              <div className={styles.fbHead}>
                {row.screen ? (
                  <span className={styles.gSym}>Screen · {screenLabel(row.screen)}</span>
                ) : (
                  <>
                    <span className={styles.gSym}>{row.sym || row.type || row.item_id}</span>
                    {row.asof && <span className={styles.gDate}>{row.asof}</span>}
                    {row.subject && <span className={styles.fbSubject}>{row.subject}</span>}
                  </>
                )}
                <span className={styles.fbKind}>{KIND_WORD[row.kind] || row.kind}</span>
                {row.verdict && <span className={`${styles.gGrade} ${styles[`fbV_${row.verdict}`] || ''}`}>{row.verdict}</span>}
                {row.ref && <span className={styles.fbRef}>ref {row.ref}</span>}
              </div>
              {row.q && <p className={styles.fbQ}>{row.q}</p>}
              {row.text && <p className={styles.fbText}>{row.text}</p>}
              {where && <p className={styles.fbMeta}>on {where}</p>}
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
