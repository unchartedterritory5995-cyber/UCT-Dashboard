import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import styles from './LinkedNotesPanel.module.css'

const _fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { notes: [] }))

// Wave 3 (Thesis-Trade Link): reverse lookup -- Notebook notes linked to THIS
// trade/strategy. The server scopes the lookup to user_id + trade_ref +
// trade_ref_type together (never trade_ref alone) -- see
// note_trade_links.py::notes_linked_to_trade. A trade may legitimately have
// zero, one, or several linked notes; this never forces a 1:1 relationship.
export default function LinkedNotesPanel({ tradeRef, tradeRefType }) {
  const navigate = useNavigate()
  const key = tradeRef && tradeRefType
    ? `/api/j2/notes/by-trade-ref?tradeRef=${encodeURIComponent(tradeRef)}&tradeRefType=${encodeURIComponent(tradeRefType)}`
    : null
  const { data } = useSWR(key, _fetcher, { revalidateOnFocus: false, dedupingInterval: 15000 })
  const notes = data?.notes || []
  if (!notes.length) return null

  const openNote = (noteId) => navigate(`/journal?j2tab=notebook&note=${noteId}`)

  return (
    <div className={styles.panel} data-testid="linked-notes-panel">
      <div className={styles.heading}>
        Linked research{notes.length > 1 ? ` (${notes.length})` : ''}
      </div>
      <ul className={styles.noteList}>
        {notes.map((n) => (
          <li key={n.id}>
            <button type="button" className={styles.noteRow} onClick={() => openNote(n.id)}>
              {n.title || 'Untitled note'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
