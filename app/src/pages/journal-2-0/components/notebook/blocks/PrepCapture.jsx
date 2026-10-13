// The frame the four daily-prep blocks share (Notebook P2b, Task 10; spec §P2 item 6, R-P2b-6).
// A prep block is a FROZEN snapshot: nothing is read until the member presses "Capture now", the
// answer is written into the block's params through setParams (one editor transaction, the note's own
// save path), and from then on the block shows that snapshot, "Captured {time} ET", and "Capture again".
// ⛔ It never fetches on mount: an older note offered the block by "Update layout" has no snapshot and
// must not quietly show today's data (IR-S11); a new note's create already captured one server-side.
// ⛔ Every gap is named: a snapshot with `missing` shows its `detail`, one with `needs` says what switch
// it needs. An answer that is not this part never lands in the note.
import { useState } from 'react'
import { BlockNeedsSwitch } from './blockStates'
import styles from './Blocks.module.css'

const FAILED = "This couldn't be read just now. Nothing was changed."

/** "Oct 5, 2026, 10:30 AM" in New York, or null for a time that cannot be read. */
function easternTime(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })
}

export default function PrepCapture({ part, params, setParams, editable, children }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const snap = params?.snapshot
  const capture = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/j2/trader-blocks/prep/${part}`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (!body || typeof body !== 'object' || body.part !== part) throw new Error('not this part')
      if (setParams({ snapshot: body }) === false) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const when = snap ? easternTime(snap.capturedAt) : null
  let body = null
  if (snap?.needs) body = <BlockNeedsSwitch what={snap.needs} />
  else if (snap?.missing) body = <p className={styles.muted}>{snap.detail}</p>
  else if (snap) body = children(snap)
  else if (!editable) body = <p className={styles.muted}>Not captured yet.</p>
  return (
    <div>
      {body}
      {when && <p className={styles.muted}>{`Captured ${when} ET`}</p>}
      {failed && <p role="status" className={styles.muted}>{FAILED}</p>}
      {editable && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} disabled={busy} onClick={capture}>
          {snap ? 'Capture again' : 'Capture now'}
        </button>
      )}
    </div>
  )
}
