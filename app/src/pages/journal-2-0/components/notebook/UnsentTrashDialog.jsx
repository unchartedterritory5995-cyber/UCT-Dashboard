/**
 * Wave 6 item 11 — trashing a note that still holds words the server does not
 * have.
 *
 * ⚰️ The editor's Delete used to trash straight away. The note's queued PUT
 * then reached a TRASHED note, `update_note` refused it with a 404, the drain
 * retired it as blocked -- and a trashed note's card never shows the blocked
 * badge, so the words were stranded where nothing would ever show them.
 *
 * So the trash asks the raw signal first (`noteHasUnsentWork`, read through
 * `holdsUnsentWork` so the door-guard mode cannot hide it), names what is not
 * sent, and offers the two honest ways on: **Send first** (the default and the
 * focused button) or **Trash anyway**.
 */
import { useEffect, useId, useRef } from 'react'
import useFocusTrap from '../../../../components/mobile/useFocusTrap'
import shellStyles from '../ModalShell.module.css'
import useBodyScrollLock from '../../lib/useBodyScrollLock'

export const UNSENT_TRASH_TITLE = 'This note has words the server doesn’t have yet'

export default function UnsentTrashDialog({ what, sending = false, still = false, onSendFirst, onTrashAnyway, onClose }) {
  const titleId = useId()
  const sendRef = useRef(null)
  const dialogRef = useRef(null)
  // F4 (A2R-05's second dialog in the same Delete flow): the same two defects as
  // ConfirmModal. The mount work depended on `onClose`, a fresh arrow from the editor on
  // every render, so each re-render pulled focus back to Send first; and Tab walked out of
  // this aria-modal dialog. The focus now opens ONCE on the safe default (Send first), and
  // the ONE trap keeps Tab inside. Rail: UnsentTrashDialog.test.jsx.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.() }
    window.addEventListener('keydown', onKey)
    sendRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useFocusTrap(true, dialogRef)
  useBodyScrollLock()      // the floating buttons hide on this lock (lib/useBodyScrollLock.js)

  return (
    <div
      className={shellStyles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div ref={dialogRef} className={shellStyles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={shellStyles.header}>
          <h2 id={titleId} className={shellStyles.title}>{UNSENT_TRASH_TITLE}</h2>
          <button type="button" className={shellStyles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={shellStyles.body}>
          <p>{what}</p>
          <p>A note in the Trash cannot receive them, so trashing it now loses them.</p>
          {still && <p role="status">Still sending — try again in a moment.</p>}
        </div>
        <div className={shellStyles.footer}>
          <button type="button" className={shellStyles.ghostBtn} onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button type="button" className={shellStyles.dangerBtn} onClick={onTrashAnyway} disabled={sending}>
            Trash anyway
          </button>
          <button ref={sendRef} type="button" className={shellStyles.primaryBtn} onClick={onSendFirst} disabled={sending}>
            {sending ? 'Sending…' : 'Send first'}
          </button>
        </div>
      </div>
    </div>
  )
}
