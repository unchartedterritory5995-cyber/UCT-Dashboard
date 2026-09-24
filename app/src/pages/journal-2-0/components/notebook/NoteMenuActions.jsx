/**
 * Wave 6 (lane E) — the note menu's organisation actions, for the note that is
 * open: Archive / Unarchive and Lock / Unlock (and, as later items land, Save
 * as template and Open to the side).
 *
 * ⛔ WHERE IT RENDERS. The note menu is the editor's header row, and the editor
 * (`NoteEditorPage`) is lane D's file. This component is complete and tested on
 * its own; NotebookTab hands it to the editor as the `noteMenu` render prop:
 *
 *     <NoteEditorPage … noteMenu={(note, { refresh }) => <NoteMenuActions … />} />
 *
 * and the editor renders `{noteMenu?.(note, { refresh })}` in its header row —
 * the one-line mount requested in wave6-E-report.md. Until that line lands the
 * prop is ignored and nothing here is reachable from the editor.
 *
 * ⛔ Every write lands the revision the server reports (`settleNoteWrite`). For
 * the LOCK that is load-bearing: the lock ADVANCES the revision (so another
 * tab's compare-and-set sees it), and an unlock whose revision nobody recorded
 * turns the next keystroke into a 409 that forks the note (lane D's I1). The
 * lock goes through lane D's `setNoteLock` — ONE client door for the value, and
 * that door lands the revision itself (5eb108092) — never a second fetch here.
 *
 * ⛔ The sentence that says what happened is rendered HERE, by a component that
 * stays mounted after the action (neither action closes the note).
 */
import { useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { noteIsArchived, setNoteArchived } from '../../lib/noteArchive'
import { noteIsLocked, setNoteLock } from '../../lib/lockedNote'
import styles from './NoteMenuActions.module.css'

export default function NoteMenuActions({ note, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { message, tone }
  if (!note?.id) return null
  const archived = noteIsArchived(note)
  const locked = noteIsLocked(note)

  const run = async (write, { done, failed }) => {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      const next = await write()
      setStatus({ tone: 'ok', message: done })
      onChanged?.(next)
    } catch {
      setStatus({ tone: 'error', message: failed })
    } finally {
      setBusy(false)
    }
  }

  const toggleArchive = () => run(() => setNoteArchived(note.id, !archived), archived
    ? { done: 'Unarchived. It is back in its folder.',
      failed: "Couldn't unarchive this note. It is still archived." }
    : { done: 'Archived. It is under Archived in the sidebar, still in its folder.',
      failed: "Couldn't archive this note. Nothing changed." })

  const toggleLock = () => run(() => setNoteLock(note.id, !locked), locked
    ? { done: 'Unlocked. You can edit this note again.',
      failed: "Couldn't unlock this note. It is still locked." }
    : { done: 'Locked. Editing is off until you unlock it.',
      failed: "Couldn't lock this note. Nothing changed." })

  return (
    <span className={styles.group} role="group" aria-label="Organise this note">
      <button
        type="button"
        className={`${styles.btn} ${locked ? styles.btnOn : ''}`}
        onClick={toggleLock}
        disabled={busy}
        title={locked
          ? 'Turn editing back on for this note'
          : 'Protect this note from accidental edits'}
      >
        <UIcon name={locked ? 'lock' : 'unlock'} size={13} gold={false} />
        {locked ? 'Unlock' : 'Lock'}
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={toggleArchive}
        disabled={busy}
        title={archived
          ? 'Bring this note back to your notes, in its own folder'
          : 'Take this note out of your lists without deleting it'}
      >
        <UIcon name="library" size={13} gold={false} />
        {archived ? 'Unarchive' : 'Archive'}
      </button>
      {status && (
        <span
          className={status.tone === 'error' ? styles.statusError : styles.status}
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.message}
        </span>
      )}
    </span>
  )
}
