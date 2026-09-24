/**
 * Wave 6 (lane E) — the note menu's organisation actions, for the note that is
 * open: Archive / Unarchive (and, as later items land, Lock, Save as template
 * and Open to the side).
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
 * ⛔ Every write goes through the lib that settles it (`lib/noteArchive.js`),
 * and the sentence that says what happened is rendered HERE, by a component
 * that stays mounted after the action (archiving does not close the note).
 */
import { useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { noteIsArchived, setNoteArchived } from '../../lib/noteArchive'
import styles from './NoteMenuActions.module.css'

export default function NoteMenuActions({ note, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { message, tone }
  if (!note?.id) return null
  const archived = noteIsArchived(note)

  const toggleArchive = async () => {
    if (busy) return
    setBusy(true)
    setStatus(null)
    try {
      const next = await setNoteArchived(note.id, !archived)
      setStatus({
        tone: 'ok',
        message: archived
          ? 'Unarchived. It is back in its folder.'
          : 'Archived. It is under Archived in the sidebar, still in its folder.',
      })
      onChanged?.(next)
    } catch {
      setStatus({
        tone: 'error',
        message: archived
          ? "Couldn't unarchive this note. It is still archived."
          : "Couldn't archive this note. Nothing changed.",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={styles.group} role="group" aria-label="Organise this note">
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
