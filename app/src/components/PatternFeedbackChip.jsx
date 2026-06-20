import { useContext, useState } from 'react'
import { AuthContext } from '../context/AuthContext'
import styles from './PatternFeedbackChip.module.css'

// Compact admin-only 👍/👎 + note + "refine" chip. Drop it anywhere a pattern or
// scanner item shows. Posts to the shared pattern-feedback store; "refine" opens
// the full draw-the-ideal review page. Renders nothing for non-admins.
export default function PatternFeedbackChip({ ticker, tf = 'D', setup, asofDate = null,
                                              source = 'chart', compact = false }) {
  const ctx = useContext(AuthContext)  // defensive: null outside a provider (e.g. unit tests)
  const user = ctx?.user
  const [sent, setSent] = useState(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')

  if (user?.role !== 'admin' || !ticker || !setup) return null

  async function send(rating) {
    setSent(rating)
    try {
      await fetch('/api/patterns/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker, tf, setup, asof_date: asofDate, rating,
          note: note || null, source,
        }),
      })
    } catch {
      setSent(null)
    }
  }

  const stop = (e) => { e.stopPropagation(); e.preventDefault() }

  return (
    <span className={`${styles.chip} ${compact ? styles.compact : ''}`} onClick={stop}>
      <button
        className={`${styles.btn} ${sent === 'up' ? styles.upOn : ''}`}
        title="Agree — good call" aria-label="thumbs up"
        onClick={(e) => { stop(e); send('up') }}
      >👍</button>
      <button
        className={`${styles.btn} ${sent === 'down' ? styles.downOn : ''}`}
        title="Wrong — bad call" aria-label="thumbs down"
        onClick={(e) => { stop(e); send('down') }}
      >👎</button>
      <button
        className={styles.link} title="Add a note"
        onClick={(e) => { stop(e); setNoteOpen((v) => !v) }}
      >note</button>
      <a
        className={styles.link} href="/admin/pattern-review"
        title="Open Pattern Review to draw the ideal"
        onClick={(e) => e.stopPropagation()}
      >refine ↗</a>
      {sent && <span className={styles.ok}>✓</span>}
      {noteOpen && (
        <input
          className={styles.note} value={note} autoFocus
          placeholder="why? (optional)"
          onClick={stop}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { stop(e); setNoteOpen(false) } }}
        />
      )}
    </span>
  )
}
