// P3b Task 5: the picker "Add an example note" opens (plan R-P3b-9): the author's live notes of the style item's
// kind (its listed payload's `kindId`, the kind the server checks a note against), newest first, with a search
// box; each row is a button named by the note's title and date. Picking one hands `{id, title}` up; the door
// (AddExampleNoteDoor.jsx) then opens the preview sheet.
// ⛔ Lazy-only: AddExampleNoteDoor.jsx imports this, and that door is itself loaded on demand (lazyChunk) by the
//    lazy styles chunk and the lazy gallery; nothing in the Notebook's first open does (P3b-R9, +0 B).
import { useEffect, useId, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { getStyleItemKind, useExampleCandidates } from '../../../lib/styleLibrary'
import { libraryError } from './styleErrors'
import styles from './ExampleNote.module.css'

export const PICKER_TITLE = 'Pick a note for your example'
const NO_KIND_SENTENCE = "This style has no kind of note, so it can't have an example."
const KIND_FAILED = "Couldn't read this style's kind of note. Try again."
const NOTES_FAILED = "Couldn't load your notes. Try again."

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
export function noteDate(iso) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? DATE_FORMAT.format(new Date(t)) : ''
}

/**
 * The picker: the member's notes of the style item's kind.
 * @param styleItemId the author's style item
 * @param onPick      `(note) => void` with `{id, title}`
 * @param onClose     Escape, Cancel, or the Sheet's own close
 */
export default function ExampleNotePicker({ styleItemId, onPick, onClose }) {
  const uid = useId()
  const [kind, setKind] = useState({ phase: 'loading' })      // loading | ready | none | error
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    setKind({ phase: 'loading' })
    getStyleItemKind(styleItemId).then(
      (id) => { if (live) setKind(id ? { phase: 'ready', id } : { phase: 'none' }) },
      (err) => { if (live) setKind({ phase: 'error', message: libraryError(err, KIND_FAILED) }) },
    )
    return () => { live = false }
  }, [styleItemId])

  const { notes, error, isLoading } = useExampleCandidates(kind.phase === 'ready' ? kind.id : null)
  const q = query.trim().toLowerCase()
  const shown = q ? notes.filter((n) => String(n.title || '').toLowerCase().includes(q)) : notes
  const loading = kind.phase === 'loading' || (kind.phase === 'ready' && isLoading && !notes.length)

  return (
    <Sheet open onClose={onClose} title={PICKER_TITLE} labelledByTitle variant="auto" maxWidth={560}
      footer={(
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
        </div>
      )}>
      <div className={styles.picker}>
        <p className={styles.hint} id={`${uid}-what`}>Your notes of this style's kind, newest first.</p>
        <input type="search" className={styles.search} value={query} onChange={(e) => setQuery(e.target.value)}
          aria-label="Search your notes" aria-describedby={`${uid}-what`} placeholder="Search your notes…" />
        {kind.phase === 'none' && <p className={styles.error} role="alert">{NO_KIND_SENTENCE}</p>}
        {kind.phase === 'error' && <p className={styles.error} role="alert">{kind.message}</p>}
        {error && <p className={styles.error} role="alert">{libraryError(error, NOTES_FAILED)}</p>}
        {loading && <p className={styles.hint} role="status">Loading your notes…</p>}
        {kind.phase === 'ready' && !loading && !error && !shown.length && (
          <p className={styles.hint} role="status">
            {q ? 'None of your notes of this kind match.' : "You don't have a note of this kind yet."}
          </p>
        )}
        {shown.length > 0 && (
          <ul className={styles.noteList} aria-label="Your notes">
            {shown.map((n) => {
              const title = n.title || 'Untitled note'
              const date = noteDate(n.createdAt)
              return (
                <li key={n.id}>
                  <button type="button" className={styles.noteRow} data-example-note={n.id}
                    aria-label={date ? `${title}, ${date}` : title}
                    onClick={() => onPick?.({ id: n.id, title: n.title || '' })}>
                    <span className={styles.noteTitle}>{title}</span>
                    {date && <span className={styles.noteDate}>{date}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
