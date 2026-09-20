import { useCallback, useEffect, useMemo, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { BLOCKED_BADGE, BLOCKED_TITLE } from '../../lib/offline/unsyncedCopy'
import { useOptimisticNoteProperty } from '../../lib/useOptimisticNoteProperty'
import styles from './NoteBoardView.module.css'

/**
 * Board view — the notes of the current selection, grouped into columns by one
 * `select` property, with a drag (or a tap) to move a note between them.
 *
 * ⛔⛔ EVERY MOVE IS A NOTE WRITE, AND THE WRITE RULES LIVE IN ONE PLACE.
 * `lib/useOptimisticNoteProperty.js` owns the fork-safety (`settleNoteWrite`),
 * the merge-not-replace body, the blocked-note refusal and the
 * override-expiry. The calendar performs the same write, and two copies of a
 * fork guard is a guard neither copy can be mutation-proved in — killing one
 * leaves the other green. Do not re-implement any of it here.
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
  initialGroupById = null,
  onGroupByChange,
}) {
  const defs = useMemo(() => groupableDefs(propertyDefs), [propertyDefs])

  // Default to the select property the member's notes ACTUALLY use, so a fresh
  // board opens on something populated rather than on an empty first column.
  // ⛔ SEEDED FROM A SAVED VIEW, NOT OWNED BY ONE. A saved board carries the
  // property id it was saved with; absent that, the default-picker below still
  // opens on a property the member's notes actually use. Seeding rather than
  // controlling keeps that picker -- and its tests -- intact.
  const [groupById, setGroupById] = useState(initialGroupById)
  const def = useMemo(() => {
    if (!defs.length) return null
    if (groupById) return defs.find((d) => d.id === groupById) || defs[0]
    const used = defs.find((d) =>
      (notes || []).some((n) => n.propertiesJson?.[d.id] !== undefined
        && n.propertiesJson?.[d.id] !== null),
    )
    return used || defs[0]
  }, [defs, groupById, notes])

  const [dragOver, setDragOver] = useState(null)
  const blocked = blockedNoteIds || new Set()

  // ⛔ REPORT THE RESOLVED GROUPING, NOT THE PICKED ONE. `groupById` is null
  // until the member chooses, while `def` is what the board is ACTUALLY drawing
  // (the default-picker's answer). Saving the former would store "whatever the
  // picker decides next time", which is not the view the member saved.
  useEffect(() => {
    if (onGroupByChange) onGroupByChange(def?.id || null)
  }, [def, onGroupByChange])

  // ⛔ One shared implementation — see the header.
  const { setProperty, overrideFor, isBusy, error } = useOptimisticNoteProperty({
    notes, blockedNoteIds, onChanged,
  })

  const columns = useMemo(() => (def ? columnsFor(def) : []), [def])

  const byColumn = useMemo(() => {
    if (!def) return {}
    const out = {}
    for (const c of columns) out[c.id] = []
    for (const n of notes || []) {
      const ov = overrideFor(n.id)
      const col = ov !== undefined ? ov : columnIdFor(n, def)
      ;(out[col] || out[NO_VALUE]).push(n)
    }
    return out
  }, [notes, columns, def, overrideFor])

  const move = useCallback((note, toColumnId) => {
    if (!def || !note) return
    if (columnIdFor(note, def) === toColumnId) return
    // ⛔ The un-set column clears the property, so it sends null rather than
    // the sentinel string the UI uses to name that column.
    setProperty(note, def.id, toColumnId === NO_VALUE ? null : toColumnId)
  }, [def, setProperty])

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
          onChange={(e) => setGroupById(e.target.value)}
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
                      className={`${styles.card} ${isBusy(n.id) ? styles.cardBusy : ''}`}
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
                            value={overrideFor(n.id) !== undefined ? overrideFor(n.id) : columnIdFor(n, def)}
                            disabled={isBusy(n.id)}
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
