import { useEditor, EditorContent } from '@tiptap/react'
import { buildExtensions } from '../lib/tiptap'
import { noteContentGuardOptions, useUnreadableNote } from '../lib/noteContentGuard'
import UnreadableNoteNotice from '../lib/UnreadableNoteNotice'
import styles from '../SharedNotePage.module.css'

/**
 * ONE read-only rendering of a PUBLIC note, for both public surfaces (wave 8 lane 8B):
 * a share link (`SharedNotePage`) and a published page (`PublishedPage`). Lifted out of
 * SharedNotePage.jsx unchanged, so the two pages cannot drift into two renderings.
 *
 * It renders the payload the server's ONE reducer produced
 * (`api/services/journal_two/public_note_payload.py`) with the REAL notebook extensions in
 * a non-editable editor. The reducer is the authority on what a stranger may see; this
 * component is the second line, not the first:
 *
 *   ⛔ `shareView` is set BEFORE create, not in onCreate. Node views can mount ahead of
 *   onCreate, and a view that missed the flag would mount a LIVE component on a public
 *   page (the exact class the flag exists to prevent): `WidgetEmbedView` reads it and
 *   keeps every embed on its ARCHIVED IMAGE.
 *
 *   ⛔ A YouTube hero is not shown: a public page loads no third-party frame or image the
 *   owner did not put in the body.
 */
export function isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/.test(String(url || ''))
}

export default function ReadOnlyNote({ note }) {
  const editor = useEditor({
    extensions: buildExtensions(),
    // S1/H14: a note this bundle cannot read says so, instead of rendering empty.
    ...noteContentGuardOptions(),
    content: note.bodyJson || { type: 'doc', content: [] },
    editable: false,
    onBeforeCreate: ({ editor: ed }) => {
      ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), shareView: true }
    },
  }, [note])
  const unreadable = useUnreadableNote(editor)

  return (
    <div className={styles.column}>
      {note.heroImageUrl && !isYouTubeUrl(note.heroImageUrl) && (
        <img className={styles.hero} src={note.heroImageUrl} alt="" />
      )}
      <h1 className={styles.title}>{note.title || 'Untitled'}</h1>
      {note.subtitle && <div className={styles.subtitle}>{note.subtitle}</div>}
      {unreadable && <UnreadableNoteNotice />}
      <EditorContent editor={editor} />
    </div>
  )
}
