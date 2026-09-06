import { useNavigate } from 'react-router-dom'
import CollapsibleSection from '../CollapsibleSection'
import UIcon from '../../../../components/ui/UIcon'
import useNoteBacklinksList from '../../hooks/useNoteBacklinksList'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import styles from './NoteBacklinksSection.module.css'

/**
 * Wave D — "Linked from (N)" footer section, directly below the editor
 * body (directive §44's own suggested placement; no new sidebar/permanent
 * UI region). Reuses the existing `CollapsibleSection` (Analytics' own
 * accordion component) rather than a bespoke collapsible -- one fewer UI
 * pattern in the app, not a new one.
 *
 * Renders NOTHING while loading or on a fetch error (directive §71:
 * backlinks are secondary, a failure here must never block the note) and
 * NOTHING when there are zero backlinks (directive §70/§16 -- matches
 * JournalBacklinks.jsx's own "0 is noise, not information" convention;
 * an empty "No notes link here yet" state would be permanent clutter on
 * the vast majority of notes, which have no backlinks yet).
 */
export default function NoteBacklinksSection({ noteId }) {
  const { count, notes, isLoading, error } = useNoteBacklinksList(noteId)
  const navigate = useNavigate()
  if (isLoading || error || count === 0) return null

  return (
    <div className={styles.wrap} data-export-exclude>
      <CollapsibleSection
        id={`backlinks-${noteId}`}
        title={`Linked from (${count})`}
        defaultOpen={false}
      >
        <ul className={styles.list}>
          {notes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={styles.row}
                onClick={() => navigate(notePath(n.id))}
              >
                <UIcon name="link" size={12} style={{ verticalAlign: '-2px', marginRight: 6, flexShrink: 0 }} />
                <span className={styles.rowTitle}>{n.title}</span>
                {n.refs > 1 && <span className={styles.rowMeta}>{n.refs}×</span>}
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  )
}
