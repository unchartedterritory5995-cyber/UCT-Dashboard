import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import CollapsibleSection from '../CollapsibleSection'
import UIcon from '../../../../components/ui/UIcon'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import styles from './UnlinkedMentions.module.css'

/**
 * Unlinked mentions (wave 6, Phase 2) — the member's other notes that NAME
 * this note in their text without linking to it. Sits beside "Linked from",
 * and follows its conventions: nothing while loading, nothing on a fetch
 * error (a secondary pane must never block the note), nothing when there is
 * nothing to show.
 *
 * ⛔ DECISION, v1: THERE IS NO "LINK IT" BUTTON — ONLY "OPEN".
 * Linking from here would write into ANOTHER note from outside that note's
 * editor. That is a second writer: the other note may be open in another tab,
 * or have unsent words queued in its outbox, and the offline layer resolves a
 * write it did not originate by FORKING the note. A convenience that can fork
 * a member's note is not a convenience. The member opens the note and links it
 * there, where the editor owns the write. Revisit only with a server-side
 * merge that the offline layer can see as its own.
 *
 * Server: GET /api/j2/notes/{id}/unlinked-mentions
 * (api/services/journal_two/note_mentions.py — word-bounded, case-insensitive,
 * titles under 3 characters skipped, notes already linking here excluded).
 */
const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { count: 0, notes: [] }))

export default function UnlinkedMentions({ noteId }) {
  const key = noteId ? `/api/j2/notes/${encodeURIComponent(noteId)}/unlinked-mentions` : null
  const { data, isLoading, error } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const navigate = useNavigate()
  const notes = data?.notes ?? []
  const count = data?.count ?? 0
  if (!key || isLoading || error || count === 0 || notes.length === 0) return null

  return (
    <div className={styles.wrap} data-export-exclude>
      <CollapsibleSection
        id={`unlinked-mentions-${noteId}`}
        title={`Unlinked mentions (${count})`}
        defaultOpen={false}
      >
        <p className={styles.hint}>
          These notes mention “{data.title}” without linking to it. Open one to add the link there.
        </p>
        <ul className={styles.list} aria-label="Notes that mention this one">
          {notes.map((n) => (
            <li key={n.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {n.title}
                  {n.occurrences > 1 && <span className={styles.rowMeta}> · {n.occurrences} mentions</span>}
                </span>
                {n.snippet && (
                  <span className={styles.snippet}>
                    {n.snippet.before}
                    <mark className={styles.match}>{n.snippet.match}</mark>
                    {n.snippet.after}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={styles.open}
                onClick={() => navigate(notePath(n.id))}
                aria-label={`Open ${n.title}`}
              >
                <UIcon name="chevronRight" size={12} gold={false} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                Open
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  )
}
