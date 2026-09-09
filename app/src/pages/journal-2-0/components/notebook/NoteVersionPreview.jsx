import { useEditor, EditorContent } from '@tiptap/react'
import { buildExtensions } from '../../lib/tiptap'
import styles from './NoteVersionPreview.module.css'

/**
 * Wave C (Version History) — read-only render of ONE historical version's
 * body, using the REAL notebook extensions so formatting (headings, bold,
 * lists, tables, callouts) looks exactly like the live editor.
 *
 * Reuses SharedNotePage's `editable:false` + `shareView:true` recipe
 * (SharedNotePage.jsx's own header explains why) rather than inventing a
 * second read-only mode: `shareView` makes WidgetEmbedView render its
 * archived image instead of mounting a live chart/breadth/etc. component.
 * That is exactly what a historical version needs too, for a stronger
 * reason than the public-share case -- a live widget reflects CURRENT
 * data, not what the note showed at the version's timestamp, and directive
 * §85 requires a historical preview never mount live components that would
 * poll auth-scoped APIs or spend quota just from opening History. The same
 * flag also means NoteFind's decorations and Ask-this-note's DOM-walk never
 * see this editor instance (a separate `useEditor` call, not the live doc),
 * so a historical version can never leak into search or AI context by
 * construction, without a second guard to remember.
 */
export default function NoteVersionPreview({ title, subtitle, bodyJson }) {
  const editor = useEditor({
    extensions: buildExtensions(),
    content: bodyJson || { type: 'doc', content: [] },
    editable: false,
    // BEFORE create, not onCreate -- node views can mount ahead of onCreate,
    // and a view that misses the flag would mount a live component for one
    // tick (see SharedNotePage.jsx's identical comment).
    onBeforeCreate: ({ editor: ed }) => {
      ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), shareView: true }
    },
  }, [bodyJson])

  return (
    <div className={styles.wrap} data-testid="note-version-preview">
      <div className={styles.title}>{title || 'Untitled'}</div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      <EditorContent editor={editor} className={styles.body} />
    </div>
  )
}
