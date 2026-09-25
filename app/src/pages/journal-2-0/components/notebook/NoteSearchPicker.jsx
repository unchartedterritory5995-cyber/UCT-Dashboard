/**
 * Wave 6 (lane E) — ONE small "find a note" picker, over the QUICK SWITCHER's
 * search (`/notes/switcher`: titles across the whole library, best match
 * first). Used by the relation property (link a note) and by split view (open a
 * note beside) — never a second note search.
 *
 * Enter takes the first result; Escape cancels. `exclude` hides notes the
 * caller cannot use (the note itself, ones already linked or open).
 */
import { useEffect, useRef, useState } from 'react'
import styles from './RelationPropertyValue.module.css'

const SEARCH_DEBOUNCE_MS = 150

export default function NoteSearchPicker({
  onPick, onCancel, exclude = [], inputLabel = 'Find a note', listLabel = 'Notes', placeholder = 'Find a note…',
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchError, setSearchError] = useState(false)
  const seq = useRef(0)
  const excludeKey = exclude.join('|')

  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); return undefined }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/j2/notes/switcher?q=${encodeURIComponent(q)}&limit=8`, { credentials: 'include' })
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.json()
        if (mine !== seq.current) return
        setSearchError(false)
        const skip = new Set(exclude)
        setResults((body.notes || []).filter((n) => !skip.has(n.id)))
      } catch {
        if (mine === seq.current) { setSearchError(true); setResults([]) }
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, excludeKey])

  return (
    <span className={styles.picker}>
      <input
        className={styles.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setQuery(''); onCancel?.() }
          if (e.key === 'Enter' && results[0]) { e.preventDefault(); onPick(results[0]) }
        }}
        placeholder={placeholder}
        aria-label={inputLabel}
        autoFocus
      />
      {searchError && <span className={styles.hint} role="alert">Couldn't search your notes.</span>}
      {results.length > 0 && (
        <ul className={styles.results} role="listbox" aria-label={listLabel}>
          {results.map((n) => (
            <li key={n.id} role="option" aria-selected={false}>
              <button type="button" className={styles.result} onClick={() => onPick(n)}>
                {n.title || 'Untitled'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
