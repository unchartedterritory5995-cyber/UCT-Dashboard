import { useEffect, useState } from 'react'
import { timeAgo, formatET } from '../../../../utils/timeAgo'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { describeUndo, listAiChangeSets, undoAiChangeSet } from '../../lib/aiActions'
import styles from './AiActionsPanel.module.css'

/**
 * Wave 11 lane 11C — the AI change sets that changed THIS note, in its version
 * history: each labelled with the change set and the request that made it, and
 * undoable from here in one click (the whole set, through the same paths).
 *
 * ⛔ A tag, a folder or a property change makes no text checkpoint of its own
 * (`_maybe_capture_version` versions title/body/properties only, and coalesces),
 * so the change set is listed here from its OWN record — never inferred from
 * the version rows. Hidden while the flag is off.
 */
export default function AiChangeSetHistory({ noteId, open, onUndone }) {
  if (notebookFlag('notebook_ai_actions_enabled') !== true) return null
  return <AiChangeSetHistoryList noteId={noteId} open={open} onUndone={onUndone} />
}

export function AiChangeSetHistoryList({ noteId, open, onUndone }) {
  const [sets, setSets] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open || !noteId) return undefined
    let live = true
    setError('')
    listAiChangeSets(noteId)
      .then((s) => { if (live) setSets(s) })
      .catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [open, noteId])

  if (error) return <p role="alert" className={styles.error}>{error}</p>
  if (!sets || sets.length === 0) return null

  const undo = async (id) => {
    setBusy(id)
    setMessage('')
    try {
      const body = await undoAiChangeSet(id)
      const mine = (body.results || []).filter((r) => r.noteId === noteId)
      const refused = mine.find((r) => r.status !== 'undone')
      setMessage(refused ? refused.message : describeUndo(body))
      setSets((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'undone' } : s)))
      onUndone?.(body)
    } catch (e) {
      setMessage(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="AI change sets on this note" className={styles.review} style={{ marginBottom: 12 }}>
      <ul className={styles.changes}>
        {sets.map((s) => (
          <li key={s.id} className={styles.change}>
            <div className={styles.changeBody}>
              <span className={styles.changeLabel}>
                AI change set <span className={styles.aiBadge}>AI</span> · “{s.request}”
              </span>
              <div className={styles.diff}>
                <span className={styles.before} title={formatET(s.appliedAt || s.createdAt)}>
                  {s.appliedChanges} {s.appliedChanges === 1 ? 'change' : 'changes'} · {timeAgo(s.appliedAt || s.createdAt)}
                  {s.status === 'undone' ? ' · undone' : ''}
                </span>
              </div>
            </div>
            {s.status !== 'undone' && (
              <button type="button" className="btn btn-ghost" disabled={busy === s.id}
                aria-label={`Undo AI change set “${s.request}”`} onClick={() => undo(s.id)}>
                {busy === s.id ? 'Undoing…' : 'Undo change set'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && <p role="status" className={styles.status}>{message}</p>}
    </section>
  )
}
