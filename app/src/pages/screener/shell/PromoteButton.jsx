import { useEffect, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { promoteAvailable, promoteScreen } from './promoteApi'
import styles from './ScannerShell.module.css'

// PromoteButton — turn the whole result set into a new watchlist (FT-027).
// The list holds what the screen shows, in the order it shows it, up to the
// server's cap; the note says when the screen matched more than fit.
// Renders nothing until the server says the door exists.
export default function PromoteButton({ spec, disabled = false, fetcher }) {
  const [avail, setAvail] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    promoteAvailable(fetcher).then(a => { if (live) setAvail(a) })
    return () => { live = false }
  }, [fetcher])

  if (!avail) return null

  const run = async () => {
    const name = window.prompt('Name the new watchlist', 'Screen results')
    if (name == null) return
    setBusy(true)
    setNote('')
    try {
      const out = await promoteScreen({ spec, name }, fetcher)
      setNote(out.truncated
        ? `Added the first ${out.taken.toLocaleString()} of ${out.matched.toLocaleString()} matches.`
        : `Added ${out.added.toLocaleString()} names.`)
    } catch (e) {
      setNote(e?.message || 'Could not create the list.')
    } finally {
      setBusy(false)
      setTimeout(() => setNote(''), 6000)
    }
  }

  return (
    <>
      <button type="button" className={styles.toolBtn} disabled={busy || disabled}
        onClick={run} aria-label="Save results as a watchlist">
        <UIcon name="star" size={13} /> {busy ? 'Saving…' : 'To watchlist'}
      </button>
      {note && <span role="status" className={styles.exportNote}>{note}</span>}
    </>
  )
}
