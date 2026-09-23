import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import useSavedScreens from '../hooks/useSavedScreens'
import styles from './ScannerShell.module.css'

// "Save as scan" — turns the current filter selection into a named saved screen,
// right where the member built it. Uses the SAME `create` door ScreensManager's
// "Save current" uses (one write path onto a saved screen), so a scan saved here
// shows up in the "Screener ▾" list. Renders nothing until there is a selection
// worth saving — a save with no filters would just store the whole pool.
export default function SaveScanButton({ spec, hasFilters }) {
  const { create } = useSavedScreens()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!hasFilters) return null

  const save = async () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      await create(n, spec)
      setName(''); setOpen(false); setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally { setBusy(false) }
  }

  return (
    <span className={styles.saveScanWrap} ref={wrapRef}>
      {open ? (
        <span className={styles.saveScanForm}>
          <input autoFocus className={styles.saveScanInput} placeholder="Name this scan…"
            value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setOpen(false)
            }} />
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </span>
      ) : (
        <button type="button" className={styles.toolBtn} onClick={() => setOpen(true)}>
          <UIcon name="save" size={13} /> {saved ? 'Saved ✓' : 'Save as scan'}
        </button>
      )}
    </span>
  )
}
