/**
 * Wave 6 (lane E) — the note menu's organisation actions, for the note that is
 * open: Lock / Unlock, Archive / Unarchive, Save as template, and — where
 * the page can split (desktop) — Open a note beside (item 7).
 *
 * ⛔ WHERE IT RENDERS. The note menu is the editor's header row, and the editor
 * (`NoteEditorPage`) is lane D's file. This component is complete and tested on
 * its own; NotebookTab hands it to the editor as the `noteMenu` render prop:
 *
 *     <NoteEditorPage … noteMenu={(note, { refresh }) => <NoteMenuActions … />} />
 *
 * and the editor renders `{noteMenu?.(note, { refresh })}` in its header row,
 * past both of its early returns — wired in wave 6 fix round 1 (I1, M1: this
 * comment used to describe the mount as still pending; it landed), so this
 * component is reachable from the editor today.
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
import { saveNoteAsTemplate } from '../../lib/memberTemplates'
import NoteSearchPicker from './NoteSearchPicker'
import styles from './NoteMenuActions.module.css'

/**
 * @param onOpenBeside  `(note) => void` — shown only when given (NotebookTab
 *   passes it on desktop, for the main pane): no split, no button, no dead click.
 * @param besideExclude  ids the search must not offer besides this note (the
 *   note already beside it).
 * @param onUnlock  M2 (wave 6 fix round 2): `() => Promise<void>` — the
 *   EDITOR's own unlock (NoteEditorPage's `unlockNote`, passed through the
 *   `noteMenu` render prop). Unlocking through `setNoteLock` alone lands the
 *   revision but skips the editor's save-baseline move and its
 *   `settleMetadataRevision` offline-queue settle — the menu's Unlock button
 *   used to do exactly that, costing the member's next keystroke a 409 +
 *   re-fetch. Optional: when omitted (this component's own unit tests,
 *   which never mount a real editor), Unlock falls back to `setNoteLock`
 *   exactly as before. Lock is unaffected either way — a locked note isn't
 *   about to be typed into, so there is no imminent save to protect.
 */
export default function NoteMenuActions({ note, onChanged, onOpenBeside, besideExclude = [], onUnlock }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { message, tone }
  const [templateDraft, setTemplateDraft] = useState(null) // string while naming
  const [pickingBeside, setPickingBeside] = useState(false)
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
      return true
    } catch {
      setStatus({ tone: 'error', message: failed })
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggleArchive = () => run(() => setNoteArchived(note.id, !archived), archived
    ? { done: 'Unarchived. It is back in its folder.',
      failed: "Couldn't unarchive this note. It is still archived." }
    : { done: 'Archived. It is under Archived in the sidebar, still in its folder.',
      failed: "Couldn't archive this note. Nothing changed." })

  // M2 (wave 6 fix round 2): unlocking through the editor's own `onUnlock`
  // when it is given — the one door that also moves the save baseline and
  // settles the offline queue. Locking always uses `setNoteLock` directly:
  // a locked note is not about to be typed into.
  const toggleLock = () => run(
    () => (locked && onUnlock ? onUnlock() : setNoteLock(note.id, !locked)),
    locked
      ? { done: 'Unlocked. You can edit this note again.',
        failed: "Couldn't unlock this note. It is still locked." }
      : { done: 'Locked. Editing is off until you unlock it.',
        failed: "Couldn't lock this note. Nothing changed." },
  )

  // Wave 6 item 3: "Save as template" — the SERVER copies this note's title,
  // body and property values; the name defaults to the title.
  const submitTemplate = (e) => {
    e.preventDefault()
    const name = templateDraft
    run(() => saveNoteAsTemplate(note.id, name), {
      done: `Saved “${(name || '').trim() || note.title?.trim() || 'Untitled template'}” as a template. Pick it under Your templates when you make a new note.`,
      failed: "Couldn't save this note as a template. Nothing was saved.",
    }).then((ok) => { if (ok) setTemplateDraft(null) })
  }

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
      {templateDraft === null ? (
        <button
          type="button"
          className={styles.btn}
          onClick={() => { setStatus(null); setTemplateDraft(note.title || '') }}
          disabled={busy}
          title="Reuse this note's title, body and properties for new notes"
        >
          <UIcon name="copy" size={13} gold={false} />
          Save as template
        </button>
      ) : (
        <form className={styles.templateForm} onSubmit={submitTemplate}>
          <input
            className={styles.templateInput}
            value={templateDraft}
            onChange={(e) => setTemplateDraft(e.target.value)}
            placeholder="Template name"
            aria-label="Template name"
            maxLength={80}
            autoFocus
          />
          <button type="submit" className={styles.btn} disabled={busy}>Save template</button>
          <button type="button" className={styles.btn} onClick={() => setTemplateDraft(null)}>Cancel</button>
        </form>
      )}
      {onOpenBeside && (pickingBeside ? (
        // The quick switcher's own search; the note itself is never offered —
        // a note opens in one pane at a time.
        <NoteSearchPicker
          onPick={(picked) => { setPickingBeside(false); onOpenBeside(picked) }}
          onCancel={() => setPickingBeside(false)}
          exclude={[note.id, ...besideExclude]}
          inputLabel="Find a note to open beside"
          listLabel="Notes to open beside"
          placeholder="Open beside…"
        />
      ) : (
        <button
          type="button"
          className={styles.btn}
          onClick={() => { setStatus(null); setPickingBeside(true) }}
          title="Show another note beside this one"
        >
          <UIcon name="columns" size={13} gold={false} />
          Open a note beside…
        </button>
      ))}
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
