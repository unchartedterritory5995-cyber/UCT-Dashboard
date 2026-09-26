import CollapsibleSection from '../CollapsibleSection'
import UIcon from '../../../../components/ui/UIcon'
import useNoteBacklinksList from '../../hooks/useNoteBacklinksList'
import useNoteRelatedFrom from '../../hooks/useNoteRelatedFrom'
import { useNoteNavigation } from '../../lib/splitView'
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
  // Wave 6 (lane E): "Related from" — notes whose RELATION property holds this
  // one. Its own list with its own rule, shown beside "Linked from" and held to
  // the same "nothing while loading, on error, or at zero" discipline.
  const related = useNoteRelatedFrom(noteId)
  // Wave 6 item 7: a row opens its note in THIS pane when the page is split,
  // beside on Ctrl/Cmd+click, and otherwise by the route it always used.
  const go = useNoteNavigation()
  const showLinked = !(isLoading || error || count === 0)
  const showRelated = !(related.isLoading || related.error || related.count === 0)
  if (!showLinked && !showRelated) return null

  return (
    <div className={styles.wrap} data-export-exclude>
      {showRelated && (
        <CollapsibleSection
          id={`related-from-${noteId}`}
          title={`Related from (${related.count})`}
          defaultOpen={false}
        >
          {/* Wave 8 (8A): each list says what it lists. */}
          <ul className={styles.list} aria-label="Notes whose relation property holds this one">
            {related.notes.map((n) => (
              <li key={n.id}>
                <button type="button" className={styles.row} onClick={(e) => go(n.id, e)}>
                  <UIcon name="link" size={12} style={{ verticalAlign: '-2px', marginRight: 6, flexShrink: 0 }} />
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{n.title}</span>
                    {/* Which relation holds it — "Peers", "Supply chain"… */}
                    <span className={styles.rowContext}>{(n.properties || []).join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}
      {showLinked && (
      <CollapsibleSection
        id={`backlinks-${noteId}`}
        title={`Linked from (${count})`}
        defaultOpen={false}
      >
        <ul className={styles.list} aria-label="Notes that link to this one">
          {notes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={styles.row}
                onClick={(e) => go(n.id, e)}
              >
                <UIcon name="link" size={12} style={{ verticalAlign: '-2px', marginRight: 6, flexShrink: 0 }} />
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{n.title}</span>
                  {/* Obsidian's "Show more context" -- a snippet of the linking
                      note's own prose around the reference, not just its
                      title. Absent (not an empty string) when the link sits
                      entirely alone in its block, or on parse failure --
                      the row still works with title/refs alone either way. */}
                  {n.context && <span className={styles.rowContext}>{n.context}</span>}
                </span>
                {n.refs > 1 && <span className={styles.rowMeta}>{n.refs}×</span>}
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
      )}
    </div>
  )
}
