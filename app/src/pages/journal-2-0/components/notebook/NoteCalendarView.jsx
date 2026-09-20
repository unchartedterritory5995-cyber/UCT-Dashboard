import { useMemo, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { buildMonthGrid, monthLabel, dowLabels, todayET, monthOffset } from '../../lib/calendar'
import styles from './NoteCalendarView.module.css'

/**
 * Calendar view — the notes of the current selection laid on a month grid by
 * one `date` property. The fourth of Notion's core views, after list, table
 * and board.
 *
 * ⛔ THE MONTH GRID IS NOT REDERIVED HERE. `buildMonthGrid` / `monthLabel` /
 * `dowLabels` / `todayET` / `monthOffset` already exist in
 * `journal-2-0/lib/calendar.js` and are what the Journal's own Calendar tab
 * runs on. A second implementation of "what does September look like" is a
 * second authority over one value, and the half that would drift first is
 * `todayET` — which is deliberately Intl-based so it stays correct across DST
 * rather than being `new Date()` with a hand-rolled offset.
 *
 * ⛔ A DATE PROPERTY IS A FREE-FORM STRING. `note_properties` validates only
 * that it is a non-empty string — there is no format check server-side — so a
 * value can be anything. This parses STRICTLY (a leading `YYYY-MM-DD`, which
 * is what the app's own date input produces) and puts everything else in
 * Unscheduled, VISIBLE. The alternative, `new Date(value)`, is worse in the
 * quiet direction: it parses a bare date as UTC, so a member in ET would watch
 * notes land on the previous day.
 *
 * ⛔ UNSCHEDULED NOTES ARE SHOWN, NEVER DROPPED. Same ruling as the board's
 * "No value" column and the graph's unlinked nodes: a note with no review date
 * is exactly what a member opens this view to notice.
 *
 * ⚠️ READ-ONLY BY DESIGN IN v1, and that is a scope decision rather than an
 * oversight. Drag-to-reschedule would be a seventh write door and would need
 * the same `settleNoteWrite` treatment the board carries; shipping half of
 * that is how a note gets forked. The follow-up is named in the board's
 * header, which already documents the safe pattern.
 */

/** A leading YYYY-MM-DD, or null. Deliberately strict — see the header. */
export function noteDateKey(note, def) {
  if (!def) return null
  const raw = note?.propertiesJson?.[def.id]
  if (typeof raw !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const mi = Number(mo)
  const di = Number(d)
  // A well-formed-looking string can still be nonsense (2026-13-40). Reject it
  // rather than render a cell nobody can reach.
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return null
  return `${y}-${mo}-${d}`
}

/** Date properties are the only ones that can lay out a calendar. */
export function datedDefs(propertyDefs) {
  return (propertyDefs || []).filter((d) => d.type === 'date')
}

export default function NoteCalendarView({ notes, propertyDefs, onOpenNote }) {
  const defs = useMemo(() => datedDefs(propertyDefs), [propertyDefs])

  const [pickedId, setPickedId] = useState(null)
  const def = useMemo(() => {
    if (!defs.length) return null
    if (pickedId) return defs.find((d) => d.id === pickedId) || defs[0]
    // Open on a property the notes actually carry, not on an empty month.
    const used = defs.find((d) => (notes || []).some((n) => noteDateKey(n, d)))
    return used || defs[0]
  }, [defs, pickedId, notes])

  const today = todayET()
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }))

  const { byDate, unscheduled } = useMemo(() => {
    const map = {}
    const none = []
    for (const n of notes || []) {
      const key = noteDateKey(n, def)
      if (!key) { none.push(n); continue }
      ;(map[key] = map[key] || []).push(n)
    }
    return { byDate: map, unscheduled: none }
  }, [notes, def])

  const weeks = useMemo(
    () => buildMonthGrid(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  )

  // How many dated notes fall OUTSIDE the month on screen. Without this the
  // member reads an empty month as "I have nothing scheduled".
  const elsewhere = useMemo(() => {
    const prefix = `${cursor.year}-${String(cursor.month).padStart(2, '0')}`
    return Object.entries(byDate)
      .filter(([k]) => !k.startsWith(prefix))
      .reduce((sum, [, list]) => sum + list.length, 0)
  }, [byDate, cursor])

  if (!defs.length) {
    return (
      <div className={styles.state}>
        A calendar lays notes out by a <b>date</b> property, and this notebook
        has none yet. Add one — Review Date is a good first calendar — and it
        will appear here.
      </div>
    )
  }

  const go = (delta) => setCursor((c) => monthOffset(c.year, c.month, delta))

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <button type="button" className={styles.navBtn} onClick={() => go(-1)} aria-label="Previous month">
            <UIcon name="chevronRight" size={14} gold={false} />
          </button>
          <span className={styles.monthLabel}>{monthLabel(cursor.year, cursor.month)}</span>
          <button type="button" className={styles.navBtn} onClick={() => go(1)} aria-label="Next month">
            <UIcon name="chevronRight" size={14} gold={false} />
          </button>
          <button
            type="button"
            className={styles.todayBtn}
            onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}
          >
            Today
          </button>
        </div>
        <label className={styles.byLabel} htmlFor="cal-date-prop">Date</label>
        <select
          id="cal-date-prop"
          className={styles.bySelect}
          value={def?.id || ''}
          onChange={(e) => setPickedId(e.target.value)}
        >
          {defs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {elsewhere > 0 ? (
          <span className={styles.elsewhere}>
            {elsewhere} more in other months
          </span>
        ) : null}
      </div>

      <div className={styles.grid} role="grid" aria-label={monthLabel(cursor.year, cursor.month)}>
        <div className={styles.dowRow} role="row">
          {dowLabels().map((d) => (
            <div key={d} className={styles.dow} role="columnheader">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className={styles.week} role="row">
            {week.map((cell, ci) => {
              if (!cell) return <div key={ci} className={styles.padCell} role="gridcell" />
              const dayNotes = byDate[cell.date] || []
              const isToday = cell.date === today
              return (
                <div
                  key={cell.date}
                  role="gridcell"
                  aria-label={cell.date}
                  className={`${styles.cell} ${isToday ? styles.cellToday : ''}`}
                >
                  <span className={styles.dayNum}>{cell.day}</span>
                  {dayNotes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={styles.chip}
                      title={n.title || 'Untitled'}
                      onClick={() => onOpenNote && onOpenNote(n)}
                    >
                      {n.title || 'Untitled'}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {unscheduled.length ? (
        <section className={styles.unscheduled} aria-label="Unscheduled">
          <h4 className={styles.unschedHead}>
            Unscheduled <span className={styles.count}>{unscheduled.length}</span>
          </h4>
          <div className={styles.unschedList}>
            {unscheduled.map((n) => (
              <button
                key={n.id}
                type="button"
                className={styles.chip}
                onClick={() => onOpenNote && onOpenNote(n)}
              >
                {n.title || 'Untitled'}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
