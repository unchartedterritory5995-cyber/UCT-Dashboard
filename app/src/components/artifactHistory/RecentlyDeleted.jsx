// app/src/components/artifactHistory/RecentlyDeleted.jsx
//
// COV-06 follow-up — bring back a DELETED screen, layout or watchlist.
//
// A delete while `ARTIFACT_VERSIONS_ENABLED` is armed leaves a tombstone in the
// artefact's history, so the history outlives it. `GET /{kind}/deleted` lists
// the member's own artefacts that no longer exist but kept a history;
// "Bring back" POSTs `/undelete` with the newest version (how it was when it
// was deleted), and "Earlier versions" opens the history in deleted mode so
// an older one can be brought back instead.
//
// ⛔ HIDDEN, NOT DISABLED: dark (404), unreadable, or nothing deleted, this
// renders nothing. No read here ever writes; the undelete is an explicit POST.

import { useCallback, useEffect, useRef, useState } from 'react'
import ArtifactHistory, { ARTIFACT_VERSIONS_URL, formatVersionTime, requestJson } from './ArtifactHistory'
import styles from './ArtifactHistory.module.css'

export default function RecentlyDeleted({ kind, noun = 'item', refreshKey = 0, onBroughtBack }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)
  const [historyId, setHistoryId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [note, setNote] = useState('')
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])

  const base = `${ARTIFACT_VERSIONS_URL}/${kind}`

  const load = useCallback(async () => {
    const r = await requestJson(`${base}/deleted`)
    if (!aliveRef.current) return
    setRows(r.ok && Array.isArray(r.body?.deleted) ? r.body.deleted : null)
  }, [base])

  useEffect(() => { load() }, [load, refreshKey])

  const broughtBack = useCallback((res, label) => {
    setHistoryId(null)
    setNote(`“${label}” is back.`)
    onBroughtBack?.(res)
    load()
  }, [load, onBroughtBack])

  const bringBack = useCallback(async (row) => {
    if (busyId != null) return
    setBusyId(row.artifact_id)
    setNote('')
    const r = await requestJson(`${base}/${encodeURIComponent(row.artifact_id)}/undelete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: row.head, base_version: row.head }),
    })
    if (!aliveRef.current) return
    setBusyId(null)
    if (r.ok && r.body) { broughtBack(r.body, row.label); return }
    await load()
    if (!aliveRef.current) return
    setNote(r.status === 409
      ? `“${row.label}” changed or is already back, so nothing was restored. The list has been refreshed.`
      : 'Bringing it back did not go through. Try again in a moment.')
  }, [base, broughtBack, busyId, load])

  if (!rows || (rows.length === 0 && !note)) return null

  return (
    <section className={styles.panel} aria-label={`Recently deleted ${noun}s`} data-testid={`recently-deleted-${kind}`}>
      <button type="button" className={styles.restore} aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        Recently deleted ({rows.length})
      </button>
      {note && <div className={styles.note} role="status">{note}</div>}
      {open && rows.length > 0 && (
        <ol className={styles.list}>
          {rows.map(row => (
            <li key={row.artifact_id} data-testid={`deleted-${kind}-${row.artifact_id}`}>
              <div className={styles.row}>
                <span className={styles.meta}>
                  <span className={styles.when}>{row.label || `Untitled ${noun}`}</span>
                  <span className={styles.what}>
                    {row.deleted_at ? `Deleted ${formatVersionTime(row.deleted_at)}` : 'Deleted'}
                  </span>
                </span>
                <button type="button" className={styles.restore}
                  aria-expanded={historyId === row.artifact_id}
                  aria-label={`Earlier versions of ${row.label}`}
                  onClick={() => setHistoryId(id => (id === row.artifact_id ? null : row.artifact_id))}
                >Earlier versions</button>
                <button type="button" className={styles.restore}
                  disabled={busyId != null}
                  aria-label={`Bring back ${row.label}`}
                  onClick={() => bringBack(row)}
                >Bring back</button>
              </div>
              {historyId === row.artifact_id && (
                <ArtifactHistory kind={kind} artifactId={row.artifact_id} deleted
                  title={`Versions of “${row.label}”`}
                  onRestored={(res) => broughtBack(res, row.label)}
                  onUnavailable={() => setHistoryId(null)} />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
