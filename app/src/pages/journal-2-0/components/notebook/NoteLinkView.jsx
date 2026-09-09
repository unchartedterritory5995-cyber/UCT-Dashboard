import { NodeViewWrapper } from '@tiptap/react'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import useNoteLinkTarget from '../../hooks/useNoteLinkTarget'
import { notePath } from '../../../../hooks/useNoteBacklinks'
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
  const navigate = useNavigate()

  const onClick = (e) => {
    e.preventDefault()
    if (!noteId || target.status === 'unavailable') return
    navigate(notePath(noteId))
  }

  const unavailable = target.status === 'unavailable'
  const trashed = target.status === 'trashed'
  const label = unavailable
    ? 'Note unavailable'
    : target.status === 'loading'
      ? '…'
      : target.title

  return (
    <NodeViewWrapper as="span" className={styles.wrap} data-note-link>
      <button
        type="button"
        className={`${styles.chip} ${unavailable ? styles.chipUnavailable : ''} ${trashed ? styles.chipTrashed : ''}`}
        onClick={onClick}
        disabled={unavailable}
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
