/**
 * ⭐ Notebook bytes headroom (controller ruling, 2026-10-16): the Delete Account dialog loads on
 * its first open, never with the page. It appears only after a member asks to delete an account
 * that still holds trades or positions (the DELETE probe answered 409), so it has no business in
 * the Notebook's first-open byte closure (docs/notebook/perf-budgets.json): AccountSelector sits
 * in JournalLayout's header on every Journal route.
 *
 * The callers keep exactly what they had: they mount this door where they mounted the dialog,
 * with the same props, only while a delete is open. It loads `DeleteAccountModal` through
 * `lib/lazyChunk.importWithOneRetry` (a blip heals in place; never a bare `await import`) and then
 * renders it with those props. ⛔ NOTHING about deleting changes: the dialog is the same module, its
 * confirmation and its requests are its own, and this door sends nothing. While the chunk loads
 * nothing else on the page changes.
 *
 * ⛔ A chunk that cannot load is never a silent no-op: the ONE status line (mounted empty with the
 * door, before any sentence can arrive, so it is announced) says so, with Try again and Close.
 * Nothing is deleted. No key listener here (pages/command/keyListenerCensus.test.js).
 * Rails: components/notebook/RefusedCopyOffer.lazy.test.js (no static importer of the dialog),
 * DeleteAccountModalDoor.test.jsx (first open; a failing chunk; Try again).
 */
import { useEffect, useState } from 'react'
import { RETRY_WAIT_MS, importWithOneRetry } from '../../lib/lazyChunk'
// The chunk doors' shared look (quiet while loading, a small banner when the chunk failed).
import styles from '../ShortcutCheatSheetDoor.module.css'

/** A property so a rail can fail the fetch (jsdom cannot fetch a chunk), like `chunkRetry`. */
export const deleteAccountModalLoaders = {
  modal: () => import('./DeleteAccountModal'),
}
const loadModal = () => importWithOneRetry(() => deleteAccountModalLoaders.modal(), RETRY_WAIT_MS)

export const DELETE_ACCOUNT_UNAVAILABLE = 'The delete account dialog couldn’t load. Nothing was deleted. '
  + 'Try again, or reload the page.'

export default function DeleteAccountModalDoor(props) {
  const [Modal, setModal] = useState(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // A second Try again while one is loading only restarts it: the cleanup drops the first.
  useEffect(() => {
    let live = true
    loadModal().then((m) => { if (live) setModal(() => m.default) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [attempt])

  if (Modal) return <Modal {...props} />
  return (
    <div className={failed ? styles.unavailable : styles.quiet} data-testid="delete-account-door">
      <p className={styles.status} role="status">{failed ? DELETE_ACCOUNT_UNAVAILABLE : ''}</p>
      {failed ? (
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          <button type="button" className={styles.btn} onClick={() => props.onClose?.()}>Close</button>
        </div>
      ) : null}
    </div>
  )
}
