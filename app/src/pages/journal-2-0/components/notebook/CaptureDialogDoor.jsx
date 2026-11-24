/**
 * ⭐ First-open bytes (coordinator ruling 2026-11-23, PR #2624; the same pattern as the 2026-10-16 doors,
 * ShortcutCheatSheetDoor and DeleteAccountModalDoor): the capture dialog loads on its first open, never with the
 * page. CaptureHost sits in Layout, so everything it imports statically is in the app's ENTRY chunk, which every
 * page's first open pays for (docs/notebook/perf-budgets.json); the dialog appears only when a capture door fires
 * (Cmd/Ctrl+Shift+Y, a door's openCapture, or a share parked by the mobile share page).
 *
 * CaptureHost keeps exactly what it had: it renders this door where it rendered the dialog, with the same props and
 * the same `key` per opening (every capture starts clean). The first opening after a page load loads `CaptureDialog`
 * through `lib/lazyChunk.importWithOneRetry` (a blip heals in place; never a bare `await import`, never a page
 * reload) and then renders it with those props. The loaded component is kept for the page's life (as React.lazy
 * keeps it), so every later opening renders the dialog in its own commit, exactly as before. While the chunk loads
 * nothing else on the page changes, and nothing is sent.
 *
 * ⛔ A chunk that cannot load is never a silent no-op: the ONE status line (mounted empty while the first opening
 * waits, before any sentence can arrive, so it is announced) says so, with Try again and Close. Nothing is saved, and
 * nothing is lost: a share parked by the mobile share page is taken only once the dialog is on screen (`onShown`).
 * Closed, the door renders nothing and loads nothing. No key listener here (pages/command/keyListenerCensus.test.js).
 * Rails: components/notebook/RefusedCopyOffer.lazy.test.js (no static importer of the dialog),
 * CaptureDialogDoor.test.jsx (first open; a later opening; a failing chunk; Try again; closed loads nothing),
 * CaptureHost.test.jsx (every door still opens the one dialog), a11y/dialogs.a11y.test.jsx (the unavailable line).
 */
import { useEffect, useState } from 'react'
import { RETRY_WAIT_MS, importWithOneRetry } from '../../lib/lazyChunk'
import styles from '../ShortcutCheatSheetDoor.module.css'

/** A property so a rail can fail the fetch (jsdom cannot fetch a chunk), like `chunkRetry`. */
export const captureDialogLoaders = {
  dialog: () => import('./CaptureDialog'),
}
// The dialog once its chunk has arrived: a later opening (a new door, CaptureHost's key) renders it at once.
let loadedDialog = null
const loadDialog = () => importWithOneRetry(() => captureDialogLoaders.dialog(), RETRY_WAIT_MS)
  .then((m) => { loadedDialog = m.default; return loadedDialog })

export const CAPTURE_UNAVAILABLE = 'Capture couldn’t load. Nothing was saved. Try again, or reload the page.'

/** `onShown` (the door's own prop, not the dialog's): called once the dialog is MOUNTED and open. CaptureHost takes a
 *  parked share only then, so a chunk that fails cannot lose it (review of #2624). */
export default function CaptureDialogDoor({ onShown, ...props }) {
  const { open, onClose } = props
  const [Dialog, setDialog] = useState(() => loadedDialog)
  const [failed, setFailed] = useState(false)
  // Try again empties the line until that attempt settles, so a second failure is a NEW sentence and is announced
  // again (review of #2624). The banner and its buttons stay: the button just pressed keeps its place and its focus.
  const [retrying, setRetrying] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const wanted = open && !Dialog

  // A second Try again while one is loading only restarts it: the cleanup drops the first.
  useEffect(() => {
    if (!wanted) return undefined
    let live = true
    loadDialog().then((D) => { if (live) setDialog(() => D) }, () => { if (live) { setFailed(true); setRetrying(false) } })
    return () => { live = false }
  }, [wanted, attempt])

  useEffect(() => { if (Dialog && open) onShown?.() }, [Dialog, open, onShown])

  if (Dialog) return <Dialog {...props} />
  if (!open) return null
  return (
    <div className={failed ? styles.unavailable : styles.quiet} data-testid="capture-dialog-door">
      <p className={styles.status} role="status">{failed && !retrying ? CAPTURE_UNAVAILABLE : ''}</p>
      {failed ? (
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={() => { setRetrying(true); setAttempt((a) => a + 1) }}>Try again</button>
          <button type="button" className={styles.btn} onClick={() => onClose?.()}>Close</button>
        </div>
      ) : null}
    </div>
  )
}
