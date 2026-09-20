import { useCallback, useMemo, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { BLOCKED_BADGE, BLOCKED_TITLE } from '../../lib/offline/unsyncedCopy'
import { settleNoteWrite } from '../../lib/offline/settleNoteWrite'
import styles from './NoteBoardView.module.css'

/**
 * Board view — the notes of the current selection, grouped into columns by one
 * `select` property, with a drag (or a tap) to move a note between them.
 *
 * ⛔⛔ EVERY MOVE IS A NOTE WRITE, SO EVERY MOVE MUST RECORD ITS REVISION.
 * `settleNoteWrite` is not optional politeness here. A `PUT /notes/{id}` that
 * advances `updatedAt` and tells the durable layer nothing makes guard 2's
 * `serverCopyIsOurs` answer "not ours" about this browser's own write, and the
 * drain FORKS the note. That is measured, it was live in production, and five
 * of six doors had the bug (see settleNoteWrite's own header). A board drag is
 * door number seven.
 *
 * ⛔ ONLY A `select` PROPERTY CAN GROUP A BOARD. `multi_select` would place one
 * note in several columns at once and leave a drop ambiguous — which of the
 * note's values did you just replace? `text`/`number`/`date` have unbounded
 * distinct values, so the board would grow a column per note. The grouping
 * picker therefore offers select properties and nothing else.
 *
 * ⛔ THE "NO VALUE" COLUMN IS REAL AND DROPPABLE. Without it, a note that has
 * not been triaged yet is invisible on the board that exists to triage it, and
 * there is no gesture that can CLEAR a property once set. Same ruling as the
 * graph view's unlinked notes: the un-set case is the interesting one.
 *
 * ⛔ DRAG IS NOT THE ONLY WAY TO MOVE A CARD. HTML5 drag-and-drop does not fire
 * on touch at all, and this app's touch tier is everything ≤1024px — so a
 * drag-only board is not a board on a phone. It also fails WCAG 2.1.1 outright.
 * Every card carries a real <select> that performs the same move.
 */

const NO_VALUE = '__unset__'

/** A board can only be grouped by these. See the header. */
export function groupableDefs(propertyDefs) {
  return (propertyDefs || []).filter(
    (d) => d.type === 'select' && Array.isArray(d.options) && d.options.length > 0,
  )
}

/**
 * Columns for one def: its declared options IN DECLARED ORDER, plus the
 * un-set column.
 *
 * ⛔ DECLARED ORDER, NEVER SORTED BY COUNT. `thesis_status` reads
 * Watching → Active → Invalidated → Closed because that is the pipeline;
 * re-ordering by how many notes sit in each would make the board rearrange
 * itself under the member as they worked.
 */
export function columnsFor(def) {
  return [
    ...(def.options || []).map((o) => ({ id: o.id, label: o.label, color: o.color })),
    { id: NO_VALUE, label: 'No value', color: 'gray', isUnset: true },
  ]
}

/** Which column a note belongs in. An unknown option id reads as un-set. */
export function columnIdFor(note, def) {
  // ⛔ `def` CAN BE NULL HERE. React runs every hook before the component's
  // "this notebook has no select property" early return, so the grouping memo
  // evaluates once with no def. Reading `def.id` there threw a TypeError and
  // the member got a blank screen instead of the empty state that tells them
  // what to do. Caught by that empty-state test, not by any of the ones about
  // grouping.
  if (!def) return NO_VALUE
  const raw = note?.propertiesJson?.[def.id]
  if (raw === null || raw === undefined || raw === '') return NO_VALUE
  return (def.options || []).some((o) => o.id === raw) ? raw : NO_VALUE
}

export default function NoteBoardView({
  notes,
  propertyDefs,
  onOpenNote,
  blockedNoteIds,
  onChanged,
}) {
  const defs = useMemo(() => groupableDefs(propertyDefs), [propertyDefs])

  // Default to the select property the member's notes ACTUALLY use, so a fresh
  // board opens on something populated rather than on an empty first column.
  const [groupById, setGroupById] = useState(null)
  const def = useMemo(() => {
    if (!defs.length) return null
    if (groupById) return defs.find((d) => d.id === groupById) || defs[0]
    const used = defs.find((d) =>
      (notes || []).some((n) => n.propertiesJson?.[d.id] !== undefined
        && n.propertiesJson?.[d.id] !== null),
    )
    return used || defs[0]
  }, [defs, groupById, notes])

  // Optimistic overrides: noteId -> option id. Cleared when the parent
  // re-fetches and the server's own value agrees.
  const [moved, setMoved] = useState({})
  const [busy, setBusy] = useState({})
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(null)

  const blocked = blockedNoteIds || new Set()

  const columns = useMemo(() => (def ? columnsFor(def) : []), [def])

  const byColumn = useMemo(() => {
    if (!def) return {}
    const out = {}
    for (const c of columns) out[c.id] = []
    for (const n of notes || []) {
      const override = moved[n.id]
      const col = override !== undefined ? override : columnIdFor(n, def)
      ;(out[col] || out[NO_VALUE]).push(n)
    }
    return out
  }, [notes, columns, def, moved])

  const move = useCallback(async (note, toColumnId) => {
    if (!def || !note) return
    const from = columnIdFor(note, def)
    if (from === toColumnId) return
    if (blocked.has?.(note.id)) {
      // ⛔ Not a silent refusal. A note whose words have not reached the server
      // is exactly the note a member must not be told they have filed.
      setError(BLOCKED_TITLE)
      return
    }
    setError('')
    setMoved((m) => ({ ...m, [note.id]: toColumnId }))
    setBusy((b) => ({ ...b, [note.id]: true }))
    try {
      const value = toColumnId === NO_VALUE ? null : toColumnId
      const res = await fetch(`/api/j2/notes/${note.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // MERGE, not replace — `properties` is merged server-side, so moving a
        // card can never clobber a property this board never displayed.
        body: JSON.stringify({ properties: { [def.id]: value } }),
      })
      if (!res.ok) throw new Error(`save failed (${res.status})`)
      // ⛔⛔ THE LINE THAT STOPS A FORK. Never delete it; never move the fetch
      // above it into a helper that forgets it.
      await settleNoteWrite(note.id, res)
      if (onChanged) onChanged()
    } catch (e) {
      // ⛔ Roll back to where it CAME FROM, never to un-set. A failed move that
      // silently lands a card in "No value" is a property the member never
      // cleared.
      setMoved((m) => {
        const next = { ...m }
        delete next[note.id]
        return next
      })
      setError('That did not save. The card has been put back.')
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[note.id]
        return next
      })
    }
  }, [def, blocked, onChanged])

  if (!defs.length) {
    return (
      <div className={styles.state}>
        A board groups notes by a <b>select</b> property, and this notebook has
        none yet. Add one to a note — Thesis Status is a good first board — and
        it will appear here.
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <label className={styles.groupLabel} htmlFor="board-group-by">Group by</label>
        <select
          id="board-group-by"
          className={styles.groupSelect}
          value={def?.id || ''}
          onChange={(e) => { setGroupById(e.target.value); setMoved({}) }}
        >
          {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {error ? <span className={styles.error} role="status">{error}</span> : null}
      </div>

      <div className={styles.columns}>
        {columns.map((col) => {
          const cards = byColumn[col.id] || []
          return (
            <section
              key={col.id}
              aria-label={col.label}
              className={`${styles.column} ${dragOver === col.id ? styles.columnOver : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={() => setDragOver((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                const id = e.dataTransfer.getData('text/plain')
                const note = (notes || []).find((n) => n.id === id)
                if (note) move(note, col.id)
              }}
            >
              <header className={styles.columnHead}>
                <span className={`${styles.dot} ${styles[`c_${col.color}`] || ''}`} aria-hidden="true" />
                <span className={col.isUnset ? styles.unsetName : styles.columnName}>{col.label}</span>
                <span className={styles.count}>{cards.length}</span>
              </header>

              <div className={styles.cards}>
                {cards.map((n) => {
                  const isBlocked = blocked.has?.(n.id)
                  return (
                    <article
                      key={n.id}
                      className={`${styles.card} ${busy[n.id] ? styles.cardBusy : ''}`}
                      draggable={!isBlocked}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', n.id) }}
                    >
                      <button
                        type="button"
                        className={styles.cardTitle}
                        onClick={() => onOpenNote && onOpenNote(n)}
                      >
                        {n.title || 'Untitled'}
                      </button>
                      {n.ticker ? <span className={styles.ticker}>{n.ticker}</span> : null}
                      {isBlocked ? (
                        <span className={styles.blocked} title={BLOCKED_TITLE}>{BLOCKED_BADGE}</span>
                      ) : (
                        /* The non-drag door. See the header: touch never fires
                           HTML5 drag events, and drag-only fails WCAG 2.1.1. */
                        <label className={styles.moveWrap}>
                          <span className={styles.srOnly}>{`Move ${n.title || 'Untitled'} to`}</span>
                          <select
                            className={styles.move}
                            value={moved[n.id] !== undefined ? moved[n.id] : columnIdFor(n, def)}
                            disabled={Boolean(busy[n.id])}
                            onChange={(e) => move(n, e.target.value)}
                          >
                            {columns.map((c) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </select>
                          <UIcon name="chevronDown" size={12} gold={false} />
                        </label>
                      )}
                    </article>
                  )
                })}
                {!cards.length ? <p className={styles.emptyCol}>Nothing here</p> : null}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
