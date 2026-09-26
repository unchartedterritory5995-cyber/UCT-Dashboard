import { NodeViewWrapper } from '@tiptap/react'
import UIcon from '../../../../components/ui/UIcon'
import useNoteLinkTarget from '../../hooks/useNoteLinkTarget'
import { useNoteNavigation } from '../../lib/splitView'
import styles from './NoteLinkView.module.css'

/**
 * Wave D — the React node view for a `noteLink` atom: an inline chip
 * showing the target note's CURRENT title (never a frozen label — see
 * noteLinkNode.jsx's own docstring), navigating in-app on click.
 *
 * `shareView`/`editable:false` contexts (SharedNotePage, NoteVersionPreview)
 * still mount this same node view -- it degrades correctly there too: the
 * title still resolves and renders, and clicking still navigates (a public
 * share reader clicking through to a note they may not have access to will
 * simply hit that route's own auth gate, same as typing the URL directly;
 * this component makes no access-control decision of its own).
 */
export default function NoteLinkView({ node }) {
  const noteId = node.attrs.noteId
  const target = useNoteLinkTarget(noteId)
  // Wave 6 fix round 1, I6 — the same door the switcher and the note list
  // use: Ctrl/Cmd+click opens the target beside (where the page can split),
  // a plain click inside the side pane navigates THAT pane, and otherwise
  // the ordinary route every note link has always used. A bare `navigate`
  // here ignored split view entirely -- Ctrl/Cmd+click did nothing extra,
  // and a click inside the side pane collapsed the split by navigating the
  // whole app to the main route.
  const goToNote = useNoteNavigation()

  const onClick = (e) => {
    e.preventDefault()
    if (!noteId || target.status === 'unavailable') return
    goToNote(noteId, e)
  }

  const unavailable = target.status === 'unavailable'
  const trashed = target.status === 'trashed'
  const label = unavailable
    ? 'Note unavailable'
    : target.status === 'loading'
      ? '…'
      : target.title

  // Wave 8 (8A): what a screen reader hears. The chip's visible text stays its
  // name when it names the note; the states whose text alone misleads get a
  // sentence -- "…" while loading read as "ellipsis", and a trashed chip's
  // title and badge ran together ("NVDA thesisTrashed").
  const spoken = target.status === 'loading'
    ? 'Linked note, loading'
    : trashed ? `Linked note ${target.title}, in Trash` : undefined

  return (
    <NodeViewWrapper as="span" className={styles.wrap} data-note-link>
      <button
        type="button"
        className={`${styles.chip} ${unavailable ? styles.chipUnavailable : ''} ${trashed ? styles.chipTrashed : ''}`}
        onClick={onClick}
        disabled={unavailable}
        aria-label={spoken}
        contentEditable={false}
        title={trashed ? `${target.title} (in Trash)` : unavailable ? 'This note is no longer available' : `Open "${target.title}"`}
      >
        <UIcon name="link" size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />
        {label}
        {trashed && <span className={styles.badge}>Trashed</span>}
      </button>
    </NodeViewWrapper>
  )
}
