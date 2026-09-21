import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { useFlagged } from '../../../hooks/useFlagged'
import styles from './ScannerShell.module.css'

// ── Flagged → watchlist ──────────────────────────────────────────────────────
// The end of the flag-while-scrolling flow: the shared "Flagged" set (written by
// the ⚑ on every result row via `useFlagged`) is MOVED into a real watchlist.
// "Move" = bulk-add the symbols to the chosen (or a new) list, then clear the
// flags — the staging set empties so the next scan starts clean.
//
// Renders nothing until something is flagged. Lists are fetched lazily on open
// (a member who never flags pays no request), and the Flagged shadow list is
// excluded as a target — you don't move flags into flags.
export default function FlaggedActions() {
  const { flagged, clearAll } = useFlagged()
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState(null)   // null = not loaded yet
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const rootRef = useRef(null)
  const n = flagged.length

  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Lazy load — only when the menu opens, and only once.
  useEffect(() => {
    if (!open || lists !== null) return
    fetch('/api/watchlists?include_items=0&include_prebuilt=0', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        const arr = Array.isArray(data) ? data : (data?.watchlists || [])
        setLists(arr.filter(w => w && !w.is_flagged_list))
      })
      .catch(() => setLists([]))
  }, [open, lists])

  if (n === 0) return null

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  async function moveTo(wlId, label) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/watchlists/${wlId}/items/bulk`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: flagged }),
      })
      if (!res.ok) throw new Error(String(res.status))
      clearAll()               // moved, so the staging flags empty
      setOpen(false)
      flash(`Moved ${n} to ${label}`)
    } catch {
      flash('Could not move — try again')
    } finally {
      setBusy(false)
    }
  }

  async function createAndMove() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const wl = await res.json()
      setNewName('')
      setBusy(false)           // let moveTo own the busy flag
      await moveTo(wl.id, name)
    } catch {
      setBusy(false)
      flash('Could not create — try again')
    }
  }

  return (
    <span className={styles.flaggedWrap} ref={rootRef}>
      <button type="button" className={styles.toolBtn} aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen(o => !o)}>
        <UIcon name="flag" size={12} /> Flagged <b>{n}</b> <UIcon name="chevronDown" size={10} />
      </button>
      {toast && <span className={styles.flaggedToast}>{toast}</span>}
      {open && (
        <div className={styles.flaggedMenu} role="menu">
          <div className={styles.uMenuHd}>Move {n} flagged to a watchlist</div>
          {lists === null ? (
            <div className={styles.flaggedHint}>Loading your lists…</div>
          ) : lists.length === 0 ? (
            <div className={styles.flaggedHint}>No watchlists yet — create one below.</div>
          ) : lists.map(w => (
            <button key={w.id} type="button" className={styles.uMenuItem} disabled={busy}
              onClick={() => moveTo(w.id, w.name)}>{w.name}</button>
          ))}
          <div className={styles.flaggedNewRow}>
            <input className={styles.flaggedInput} placeholder="New watchlist…"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createAndMove() }} />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !newName.trim()}
              onClick={createAndMove}>Create + move</button>
          </div>
          <button type="button" className={styles.flaggedClear} disabled={busy}
            onClick={() => { clearAll(); setOpen(false); flash('Flags cleared') }}>
            Clear flags without moving
          </button>
        </div>
      )}
    </span>
  )
}
