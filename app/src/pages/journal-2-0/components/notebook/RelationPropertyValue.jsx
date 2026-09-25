/**
 * Wave 6 (lane E, item 5) — a RELATION property's value: the notes it links,
 * as chips that open them, and a picker to link another.
 *
 * ⛔ A DELETED OR TRASHED TARGET RENDERS AS "missing note", NEVER AS A CRASH.
 * Titles come from the one batched, owner-scoped resolver noteLinks already use
 * (`lib/noteLinkTargetsBatch.js` over `/notes/link-targets`): an id it cannot
 * find — deleted, purged, another member's — resolves to null, and a trashed
 * one to `status: 'trashed'`. Both read "missing note", and the member can
 * still remove it.
 *
 * ⛔ The picker REUSES the quick switcher's search (`/notes/switcher`, titles
 * across the whole library, best match first) — not a second note search.
 *
 * ⛔ The note chip and its remove (×) are two buttons side by side, never one
 * inside the other.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import { requestNoteLinkTarget, subscribeNoteLinkTargets } from '../../lib/noteLinkTargetsBatch'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import styles from './RelationPropertyValue.module.css'

export const MISSING_NOTE_LABEL = 'missing note'
const SEARCH_DEBOUNCE_MS = 150

function useLinkTargets(ids) {
  const [, bump] = useState(0)
  useEffect(() => subscribeNoteLinkTargets(() => bump((n) => n + 1)), [])
  return ids.map((id) => ({ id, target: requestNoteLinkTarget(id) }))
}

export default function RelationPropertyValue({ value, onChange, labelId, currentNoteId = null }) {
  const ids = Array.isArray(value) ? value : []
  const targets = useLinkTargets(ids)
  const navigate = useNavigate()
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchError, setSearchError] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!picking) return undefined
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
        setResults((body.notes || []).filter((n) => n.id !== currentNoteId && !ids.includes(n.id)))
      } catch {
        if (mine === seq.current) { setSearchError(true); setResults([]) }
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, picking])

  const link = (note) => {
    onChange([...ids, note.id])
    setQuery('')
    setResults([])
    setPicking(false)
  }
  const unlink = (id) => {
    const next = ids.filter((x) => x !== id)
    onChange(next.length ? next : null)
  }

  return (
    <div className={styles.wrap} role="group" aria-labelledby={labelId}>
      {targets.map(({ id, target }) => {
        const missing = target === null || target?.status === 'trashed'
        const label = target === undefined ? '…' : missing ? MISSING_NOTE_LABEL : target.title
        return (
          <span key={id} className={styles.chip}>
            <button
              type="button"
              className={`${styles.chipOpen} ${missing ? styles.chipMissing : ''}`}
              onClick={() => navigate(notePath(id))}
              disabled={missing || target === undefined}
              title={missing ? 'This note was deleted or moved to the Trash' : `Open ${label}`}
            >
              {label}
            </button>
            <button
              type="button"
              className={styles.chipRemove}
              onClick={() => unlink(id)}
              aria-label={`Unlink ${label}`}
            >
              <UIcon name="x" size={10} gold={false} />
            </button>
          </span>
        )
      })}
      {picking ? (
        <span className={styles.picker}>
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setPicking(false); setQuery('') }
              if (e.key === 'Enter' && results[0]) { e.preventDefault(); link(results[0]) }
            }}
            placeholder="Find a note…"
            aria-label="Find a note to link"
            autoFocus
          />
          {searchError && <span className={styles.hint} role="alert">Couldn't search your notes.</span>}
          {results.length > 0 && (
            <ul className={styles.results} role="listbox" aria-label="Notes to link">
              {results.map((n) => (
                <li key={n.id} role="option" aria-selected={false}>
                  <button type="button" className={styles.result} onClick={() => link(n)}>
                    {n.title || 'Untitled'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
      ) : (
        <button type="button" className={styles.add} onClick={() => setPicking(true)}>
          <UIcon name="plus" size={10} gold={false} />
          Link a note
        </button>
      )}
    </div>
  )
}
