import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import BlockedBadge from './BlockedBadge'
import LockedGlyph from './LockedGlyph'
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
  // F4 / A2R-03 (WCAG 2.4.3): a card moved with its <select> RE-MOUNTS in its new column,
  // and the focused <select> goes with the old node -- lane 10E-2's keyboard walk found focus
  // on <body> after every keyboard move. So the card that moved is remembered, and focus
  // follows it: to its <select> once that is usable again (a move disables it while the write
  // is in flight), to its title in the meantime, never to <body>.
  const wrapRef = useRef(null)
  const groupSelectRef = useRef(null)
  const followRef = useRef(null) // the id of the card a keyboard move is carrying focus with

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

  // ⛔⛔ WAVE 10 D-5 (design review; proof walk 10E-1 6b + F5 + the wave10
  // design-recheck). F5 made the row scroll ALONE and gave it a thin,
  // theme-token thumb -- but the recheck found NO scrollbars-shown capture of
  // the real board proving that thumb paints: at 1200/820 the recheck's own
  // pixel scan under the columns "finds nothing above black". This is a
  // SECOND, OS-independent cue that does not depend on the OS ever painting a
  // scrollbar: a mask on the scroller's own right edge, present only while a
  // column sits past the visible edge and gone once the last one is fully in
  // view -- driven by real scroll position, not a static width guess, so it
  // is honest at 1200, 820 AND 390 with no @media needed (the same scroll
  // arithmetic is correct at every width; see NoteBoardView.module.css
  // `.columns[data-board-scroll-more="true"]`, which is the idiom
  // `VideosSection.module.css` `.chipsFadeR` already uses for exactly this
  // reason: a mask reads correctly against any theme background, where a
  // colour-matched overlay would have to know it).
  //
  // The element is obtained via a CALLBACK ref -> state, not a ref object,
  // for the same reason `Shelf.jsx`'s `useScrollEdges` does: if a parent ever
  // starts async-loading `notes`/`propertyDefs` into an already-mounted
  // `NoteBoardView`, `defs.length` can go from 0 to >0 within the SAME
  // instance and `.columns` mounts for the first time -- a plain `useRef`
  // effect would already have run once against `null` and never re-arm.
  const [columnsEl, setColumnsEl] = useState(null)
  const [moreRight, setMoreRight] = useState(false)
  useEffect(() => {
    const el = columnsEl
    if (!el) {
      setMoreRight((prev) => (prev ? false : prev))
      return
    }
    let dead = false
    const update = () => {
      if (dead) return
      const max = el.scrollWidth - el.clientWidth
      const next = max > 2 && el.scrollLeft < max - 2
      setMoreRight((prev) => (prev === next ? prev : next))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      dead = true
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
    // `columns.length` is the CONTENT key: switching "Group by" (or the
    // notebook gaining/losing a select property) changes the column count --
    // and with it scrollWidth -- without resizing the scroller's own box,
    // which ResizeObserver cannot see (Shelf.jsx's useScrollEdges carries
    // the identical comment for the identical reason).
  }, [columnsEl, columns.length])

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

  // Runs after every render while a keyboard move is carrying focus (see `followRef`).
  // ⛔ It never takes focus from somewhere the member has put it since: it acts only while
  // focus is on <body> (the old node went) or still inside the moved card.
  useEffect(() => {
    const id = followRef.current
    if (!id) return
    const root = wrapRef.current
    const active = document.activeElement
    const card = root ? [...root.querySelectorAll('[data-board-card-id]')].find((el) => el.getAttribute('data-board-card-id') === id) : null
    const lost = !active || active === document.body
    if (!lost && !(card && card.contains(active))) { followRef.current = null; return }
    if (!card) {
      // the card left this board (a view that filters on the value just set)
      followRef.current = null
      groupSelectRef.current?.focus()
      return
    }
    const select = card.querySelector('select')
    if (select && !select.disabled) {
      followRef.current = null
      if (active !== select) select.focus()
      return
    }
    const title = card.querySelector('button')
    if (title && active !== title) title.focus()
  })

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
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.toolbar}>
        <label className={styles.groupLabel} htmlFor="board-group-by">Group by</label>
        <select
          ref={groupSelectRef}
          id="board-group-by"
          className={styles.groupSelect}
          value={def?.id || ''}
          onChange={(e) => setGroupById(e.target.value)}
        >
          {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {error ? <span className={styles.error} role="status">{error}</span> : null}
      </div>

      <div
        ref={setColumnsEl}
        // ⛔ Ground truth for the D-5 cue, read by the rail, the R-RAW probe
        // (tools/notebook_d5_scroll_probe.py) AND the CSS below (an attribute
        // selector, `.columns[data-board-scroll-more="true"]` in
        // NoteBoardView.module.css) -- a `data-*` attribute rather than a
        // second CSS module class because a class name is hashed per-build
        // and this needs to be findable in a real production bundle, not
        // only under vitest's dev transform. It also keeps `className`
        // itself unchanged, which NoteBoardView.scrollsAlone.test.js reads
        // by exact substring.
        data-board-scroll-more={moreRight ? 'true' : 'false'}
        className={styles.columns}
      >
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
                      data-board-card-id={n.id}
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
                      <LockedGlyph note={n} />
                      {n.ticker ? <span className={styles.ticker}>{n.ticker}</span> : null}
                      {isBlocked ? (
                        // UX #15, 2026-09-22: this used to be text-only, the
                        // only one of the four note-list views with no icon.
                        <BlockedBadge className={styles.blocked} />
                      ) : (
                        /* The non-drag door. See the header: touch never fires
                           HTML5 drag events, and drag-only fails WCAG 2.1.1. */
                        <label className={styles.moveWrap}>
                          <span className={styles.srOnly}>{`Move ${n.title || 'Untitled'} to`}</span>
                          <select
                            className={styles.move}
                            value={overrideFor(n.id) !== undefined ? overrideFor(n.id) : columnIdFor(n, def)}
                            disabled={isBusy(n.id)}
                            onChange={(e) => { followRef.current = n.id; move(n, e.target.value) }}
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
