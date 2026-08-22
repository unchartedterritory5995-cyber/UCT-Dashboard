import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { buildExtensions } from './lib/tiptap'
import { SHARED_NOTE_ENDPOINT } from './lib/noteShareLink'
import styles from './SharedNotePage.module.css'

/**
 * 🔴 THE FAR END OF A NOTE SHARE LINK — public, read-only, shell-less.
 *
 * Renders the sanitized payload from `GET /api/j2/shared/{token}` with the
 * REAL notebook extensions in a non-editable editor, so prose, tables and
 * embeds look exactly like the notebook — with one deliberate difference:
 * `shareView` on editor storage makes every widget embed render its ARCHIVED
 * IMAGE (the durable-image substrate doing the job it was built for). A
 * public reader never mounts live components, never polls auth-scoped APIs,
 * never spends quota. Attachment URLs arrive already rewritten to the
 * token-scoped proxy.
 */
export default function SharedNotePage() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading', note: null })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading', note: null })
    fetch(`${SHARED_NOTE_ENDPOINT}/${encodeURIComponent(token || '')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body) => { if (alive) setState({ status: 'ok', note: body.note }) })
      .catch(() => { if (alive) setState({ status: 'gone', note: null }) })
    return () => { alive = false }
  }, [token])

  if (state.status === 'loading') {
    return <div className={styles.page}><div className={styles.centered}>Loading…</div></div>
  }
  if (state.status !== 'ok' || !state.note) {
    return (
      <div className={styles.page}>
        <div className={styles.centered} data-testid="shared-note-gone">
          <div className={styles.goneTitle}>This link is no longer available.</div>
          <div className={styles.goneWhy}>The note may have been unshared or removed.</div>
        </div>
      </div>
    )
  }
  return (
    <div className={styles.page} data-testid="shared-note">
      <ReadOnlyNote note={state.note} />
      <div className={styles.brandFoot}>
        Written in <span className={styles.brandName}>UCT Intelligence</span> — Navigate the market, effectively.
      </div>
    </div>
  )
}

function ReadOnlyNote({ note }) {
  const editor = useEditor({
    extensions: buildExtensions(),
    content: note.bodyJson || { type: 'doc', content: [] },
    editable: false,
    // BEFORE create, not onCreate: node views can mount ahead of onCreate,
    // and a view that misses the flag would mount a LIVE component on a
    // public page (the exact class the flag exists to prevent).
    onBeforeCreate: ({ editor: ed }) => {
      ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), shareView: true }
    },
  }, [note])

  return (
    <div className={styles.column}>
      {note.heroImageUrl && !/youtube\.com|youtu\.be/.test(note.heroImageUrl) && (
        <img className={styles.hero} src={note.heroImageUrl} alt="" />
      )}
      <h1 className={styles.title}>{note.title || 'Untitled'}</h1>
      {note.subtitle && <div className={styles.subtitle}>{note.subtitle}</div>}
      <EditorContent editor={editor} />
    </div>
  )
}
