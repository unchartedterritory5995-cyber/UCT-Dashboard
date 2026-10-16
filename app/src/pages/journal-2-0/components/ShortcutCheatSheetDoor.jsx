/**
 * ⭐ I-A bytes (controller ruling, 2026-10-16): the keyboard-shortcut cheat sheet loads on its
 * first open, never with the Notebook. It is opened only by `?` or the header's "?" button, so
 * it has no business in the first-open byte closure (docs/notebook/perf-budgets.json).
 *
 * The page keeps exactly what it had: an `open` it toggles and an `onClose`. This door loads
 * `ShortcutCheatSheet` the first time `open` is true, through `lib/lazyChunk.importWithOneRetry`
 * (a blip heals in place; never a bare `await import`), and from then on renders it like the
 * page used to. While the chunk loads NOTHING changes on the page: focus stays where it was,
 * every other shortcut keeps working, and the sheet arrives with `open` already true, so its own
 * open-transition effect records the invoker and focuses Close exactly as before.
 *
 * ⛔ A chunk that cannot load is never a silent no-op: the ONE status line says so, with Try
 * again. It is mounted EMPTY on the first open, before any sentence can arrive (the in-place
 * retry alone waits RETRY_WAIT_MS), so its sentence is announced; it is not on the page before
 * anybody asks for the sheet (a resting Journal page carries no stray live region). Closing
 * (`?` again, or Close) clears it. Nothing here listens to the keyboard
 * (pages/command/keyListenerCensus.test.js counts listeners per file).
 * Rails: components/notebook/RefusedCopyOffer.lazy.test.js (no static importer of the sheet),
 * JournalLayout.test.jsx "loads on its first open" (opens after the chunk resolves; a failing chunk; Try again).
 */
import { useEffect, useState } from 'react'
import { RETRY_WAIT_MS, importWithOneRetry } from '../lib/lazyChunk'
import styles from './ShortcutCheatSheetDoor.module.css'

/** A property so a rail can fail the fetch (jsdom cannot fetch a chunk), like `chunkRetry`. */
export const shortcutSheetLoaders = {
  sheet: () => import('./ShortcutCheatSheet'),
}
const loadSheet = () => importWithOneRetry(() => shortcutSheetLoaders.sheet(), RETRY_WAIT_MS)

export const SHORTCUTS_UNAVAILABLE = 'The keyboard shortcuts couldn’t load. Try again, or reload the page.'

export default function ShortcutCheatSheetDoor({ open, onClose }) {
  const [Sheet, setSheet] = useState(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [asked, setAsked] = useState(false)
  const wanted = open && !Sheet

  // A second Try again while one is loading only restarts it: the cleanup drops the first.
  useEffect(() => {
    if (!wanted) return undefined
    setAsked(true)
    let live = true
    loadSheet().then((m) => { if (live) setSheet(() => m.default) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [wanted, attempt])

  const showFailure = failed && open && !Sheet
  const tryAgain = () => setAttempt((a) => a + 1)
  return (
    <>
      {asked || open ? (
        <div className={showFailure ? styles.unavailable : styles.quiet} data-testid="shortcut-sheet-door">
          <p className={styles.status} role="status">{showFailure ? SHORTCUTS_UNAVAILABLE : ''}</p>
          {showFailure ? (
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={tryAgain}>Try again</button>
              <button type="button" className={styles.btn} onClick={() => onClose?.()}>Close</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {Sheet ? <Sheet open={open} onClose={onClose} /> : null}
    </>
  )
}
