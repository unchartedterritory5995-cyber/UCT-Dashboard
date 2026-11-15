// Go-live wave 1: "Needs review" and "Notes on your open positions" on the Daily brief (Research home's two note
// sections). Fix round 1 (first-open bytes): a chunk of its own, fetched when the brief draws it -- which is only after
// the cards' own read has answered, so nothing waits on it -- and with it the home read (useNotebookHome).
// ⛔ It imports NOTHING of the Daily brief's: neither TodayHome.jsx nor TodayHome.module.css. Either shared module
// folds the brief into a shared chunk and its manifest entry disappears (the brief is a lazy view and a first-open
// budget root, docs/notebook/perf-budgets.json; measured on the fix-round-1 build). So it draws its own card shell,
// on the brief's classes, which the brief hands in (`styles`).
import { useId } from 'react'
import useNotebookHome from '../../hooks/useNotebookHome'

/** The Daily brief's card shell (TodayHome.jsx `Card`), for these two sections. */
function Card({ styles, id, title, children, testId }) {
  const uid = useId()
  return (
    <section className={`${styles.card} ${styles[`card_${id}`] || ''}`} aria-labelledby={`${uid}-t`}
      data-today-card={id} data-testid={testId}>
      <div className={styles.cardHead}>
        <h3 id={`${uid}-t`} className={styles.cardTitle}>{title}</h3>
      </div>
      {children}
    </section>
  )
}

/** Go-live wave 1: the headings of Research home's two review sections, as the Daily brief names them. */
export const NEEDS_REVIEW_TITLE = 'Needs review'
export const OPEN_POSITIONS_TITLE = 'Notes on your open positions'
export const OPEN_POSITION_TAG = 'Open position'

/** Why a note is in "Needs review": the server's own reasons (notebook_home.py `reviewReasons`), joined. */
export function reviewReasonsLine(note) {
  return (Array.isArray(note?.reviewReasons) ? note.reviewReasons : [])
    .map((r) => (typeof r?.text === 'string' ? r.text.trim() : '')).filter(Boolean).join(' · ')
}

/** One of Research home's note sections. Drawn only when it has rows: no heading, no empty line, no skeleton. The
 *  server already caps each section at five. */
function HomeNotesCard({ styles, id, title, notes, line, onOpenNote }) {
  if (!Array.isArray(notes) || notes.length === 0) return null
  return (
    <Card styles={styles} id={id} title={title} testId={`today-${id}`}>
      <ul className={styles.list}>
        {notes.map((n) => {
          const sub = line(n)
          return (
            <li key={n.id}>
              <button type="button" className={styles.memory} onClick={() => onOpenNote?.({ id: n.id, title: n.title })}>
                <span className={styles.noteTitle}>
                  {n.ticker && <span className={styles.tk}>{n.ticker}</span>} {n.title?.trim() || 'Untitled'}
                </span>
                {sub && <span className={styles.from}>{sub}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** "Needs review" and "Notes on your open positions", after the phase cards. The read waits for the cards' own read
 *  (`ready`), so it never competes with it, and nothing is drawn while it is in flight or when both are empty. A failed
 *  read draws nothing either: these are extras on a page whose cards already answered. */
export default function HomeNotes({ ready, onOpenNote, styles }) {
  const { home } = useNotebookHome({ enabled: ready })
  const review = home?.needsReview || []
  const positions = home?.openPositionResearch || []
  if (!ready || (review.length === 0 && positions.length === 0)) return null
  return (
    <div className={styles.grid} data-today-home-notes="">
      <HomeNotesCard styles={styles} id="needs-review" title={NEEDS_REVIEW_TITLE} notes={review} line={reviewReasonsLine}
        onOpenNote={onOpenNote} />
      <HomeNotesCard styles={styles} id="open-positions" title={OPEN_POSITIONS_TITLE} notes={positions} line={() => OPEN_POSITION_TAG}
        onOpenNote={onOpenNote} />
    </div>
  )
}

