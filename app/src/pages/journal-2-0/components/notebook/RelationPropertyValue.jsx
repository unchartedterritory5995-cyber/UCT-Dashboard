/**
 * Wave 6 (lane E, item 5) — a RELATION property's value: the notes it links,
 * as chips that open them, and a picker to link another.
 *
 * ⛔ A DELETED OR TRASHED TARGET RENDERS AS "missing note", NEVER AS A CRASH.
 * Titles come from the one batched, owner-scoped resolver noteLinks already use
 * (`lib/noteLinkTargetsBatch.js` over `/notes/link-targets`): an id it cannot
 * find — deleted, purged, another member's — resolves to null, and a trashed
 * one to `status: 'trashed'`. Both read "missing note", and the member can
 * still remove it.
 *
 * ⛔ The picker is `NoteSearchPicker` — the QUICK SWITCHER's search — not a
 * second note search.
 *
 * ⛔ The note chip and its remove (×) are two buttons side by side, never one
 * inside the other.
 */
import { useEffect, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { requestNoteLinkTarget, subscribeNoteLinkTargets } from '../../lib/noteLinkTargetsBatch'
import { useNoteNavigation } from '../../lib/splitView'
import NoteSearchPicker from './NoteSearchPicker'
import styles from './RelationPropertyValue.module.css'

export const MISSING_NOTE_LABEL = 'missing note'

function useLinkTargets(ids) {
  const [, bump] = useState(0)
  useEffect(() => subscribeNoteLinkTargets(() => bump((n) => n + 1)), [])
  return ids.map((id) => ({ id, target: requestNoteLinkTarget(id) }))
}

export default function RelationPropertyValue({ value, onChange, labelId, currentNoteId = null }) {
  const ids = Array.isArray(value) ? value : []
  const targets = useLinkTargets(ids)
  // A chip opens its note the Notebook's one way (lib/splitView.js): in this
  // pane when the page is split, beside on Ctrl/Cmd+click.
  const go = useNoteNavigation()
  const [picking, setPicking] = useState(false)

  const link = (note) => {
    onChange([...ids, note.id])
    setPicking(false)
  }
  const unlink = (id) => {
    const next = ids.filter((x) => x !== id)
    onChange(next.length ? next : null)
  }

  return (
    <div className={styles.wrap} role="group" aria-labelledby={labelId}>
      {targets.map(({ id, target }) => {
        const missing = target === null || target?.status === 'trashed'
        const label = target === undefined ? '…' : missing ? MISSING_NOTE_LABEL : target.title
        return (
          <span key={id} className={styles.chip}>
            <button
              type="button"
              className={`${styles.chipOpen} ${missing ? styles.chipMissing : ''}`}
              onClick={(e) => go(id, e)}
              disabled={missing || target === undefined}
              title={missing ? 'This note was deleted or moved to the Trash' : `Open ${label}`}
            >
              {label}
            </button>
            <button
              type="button"
              className={styles.chipRemove}
              onClick={() => unlink(id)}
              aria-label={`Unlink ${label}`}
            >
              <UIcon name="x" size={10} gold={false} />
            </button>
          </span>
        )
      })}
      {picking ? (
        <NoteSearchPicker
          onPick={link}
          onCancel={() => setPicking(false)}
          exclude={[...(currentNoteId ? [currentNoteId] : []), ...ids]}
          inputLabel="Find a note to link"
          listLabel="Notes to link"
        />
      ) : (
        <button type="button" className={styles.add} onClick={() => setPicking(true)}>
          <UIcon name="plus" size={10} gold={false} />
          Link a note
        </button>
      )}
    </div>
  )
}
