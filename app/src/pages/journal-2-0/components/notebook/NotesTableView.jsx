import { useEffect, useState } from 'react'
import ResponsiveTable from '../../../../components/mobile/ResponsiveTable'
import UIcon from '../../../../components/ui/UIcon'
import BlockedBadge from './BlockedBadge'
import LockedGlyph from './LockedGlyph'
import styles from './NotesTableView.module.css'

function formatCellValue(def, value) {
  if (value === null || value === undefined) return null
  if (def.type === 'checkbox') return value ? 'Yes' : 'No'
  if (def.type === 'select') {
    const opt = (def.options || []).find((o) => o.id === value)
    return opt ? opt.label : null
  }
  if (def.type === 'multi_select') {
    const labels = (value || [])
      .map((id) => (def.options || []).find((o) => o.id === id)?.label)
      .filter(Boolean)
    return labels.length ? labels.join(', ') : null
  }
  if (def.type === 'relation') {
    // Wave 6: a list of note ids — said as a count, never printed as raw ids.
    const n = Array.isArray(value) ? value.length : 0
    return n ? `${n} linked note${n === 1 ? '' : 's'}` : null
  }
  return String(value)
}

/**
 * ⛔ THE OPTION OBJECTS THEMSELVES (id/label/color), not a joined string --
 * `note_properties.py` computes a real color per option and Board's column
 * header already renders it (a dot); the table's value chip did not.
 * `select` resolves to 0-or-1 entries, `multi_select` to N -- both return the
 * same shape so the render side doesn't need to branch on type. Competitive
 * audit finding UX #3, 2026-09-22.
 */
function selectedOptionsFor(def, value) {
  const opts = def.options || []
  const ids = def.type === 'multi_select' ? (value || []) : [value]
  return ids
    .map((id) => opts.find((o) => o.id === id))
    .filter(Boolean)
}

/**
 * Wave E — Table view (checkpoint §16). One row per note; sortable headers
 * (Title/Updated + one column per user-defined property that has at least
 * one note using it, so a member's unused custom properties never clutter
 * the header row). Clicking a select/multi_select cell's rendered value
 * applies a quick equality filter for that property -- a lightweight
 * substitute for a full filter-builder dialog, matching directive §77's
 * "filter-chip summary" spirit without building a second UI surface for it.
 * Responsive via the EXISTING ResponsiveTable primitive (card-mode on
 * phone, checkpoint §23) -- never a bespoke mobile table.
 */
export default function NotesTableView({
  notes,
  propertyDefs,
  sort,
  onSortChange,
  propertySort,
  onPropertySortChange,
  onQuickFilter,
  onOpenNote,
  /** Wave Q1 — note ids whose queued work the drain has retired from retrying.
   *  ⛔ The table is the OTHER list view. A surface built only on the card grid
   *  would be invisible to every member who prefers this one, and "we told
   *  them" would be true of half the product. */
  blockedNoteIds = null,
  /** Wave 5 bulk operations — `{ isSelected(id), onToggle(note, {shift}),
   *  allSelected, someSelected, onToggleAll() }`, or null for no checkboxes.
   *  ⛔ Every checkbox stops its click at its own label: the row opens the
   *  note on click, and selecting must never also navigate away. */
  selection = null,
}) {
  const isBlocked = (id) => Boolean(blockedNoteIds && blockedNoteIds.has(id))
  const rowCheckbox = (n) => (
    <label className={styles.selectBox} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={selection.isSelected(n.id)}
        onChange={(e) => selection.onToggle(n, { shift: Boolean(e.nativeEvent?.shiftKey) })}
        aria-label={`Select ${n.title || 'Untitled'}`}
      />
    </label>
  )
  const userDefs = (propertyDefs || []).filter((d) => d.source === 'user_set')
  const usedDefs = userDefs.filter((d) =>
    notes.some((n) => n.propertiesJson && n.propertiesJson[d.id] !== undefined && n.propertiesJson[d.id] !== null),
  )

  const sortIcon = (active, dir) => (
    <UIcon name={dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={10} style={{ marginLeft: 4, opacity: active ? 1 : 0.3 }} />
  )

  // FX2 (wave 10, proof-walk item 2): which column is the CURRENT sort, and
  // which direction -- one predicate, read by both the header cell's
  // `aria-sort` (WAI-ARIA's own semantic for this, on the `<th>`, never the
  // button inside it) and the chevron. `updated` is this table's resting
  // default (`sort` starts `'updated'` in NotebookTab.jsx, and the `!sort`
  // fallback here matches the OTHER caller that renders this view with no
  // `sort` prop at all -- `sort` is never undefined once NotebookTab has
  // mounted).
  const titleActive = sort === 'title'
  const updatedActive = sort === 'updated' || !sort

  // FX4 (wave 10, proof-walk item 1): Title/Updated are now a TWO-STATE
  // toggle, same shape as every user-defined property column's
  // `propertySort` below -- clicking the header that is ALREADY the active
  // sort reverses direction instead of being a no-op. That no-op was the
  // dead click the L11 sweep found (`docs/notebook/proof/l11-52deeb767/`):
  // FX2's `aria-sort` told assistive tech the CURRENT state, but nothing told
  // a click there was somewhere left to go.
  // `reversed` is local to this mounted table and resets the moment `sort`
  // itself changes -- from EITHER side (the toolbar `<select>` or clicking
  // the OTHER header) -- so a freshly-activated field always starts at its
  // natural direction rather than inheriting the previous field's flip.
  // Natural direction mirrors the server's own fixed `ORDER BY`
  // (`notes.py::list_notes`): title is `COLLATE NOCASE ASC`, updated is
  // `updated_at DESC`. The server has no reverse-direction sort key, so the
  // reversal is applied client-side, over whatever page of `notes` is
  // currently loaded -- computed fresh every render (never a stale snapshot),
  // so a `loadMore` append while reversed stays internally consistent: the
  // WHOLE currently-loaded set flips together, every time.
  const [reversed, setReversed] = useState(false)
  useEffect(() => { setReversed(false) }, [sort])
  const titleDir = titleActive ? (reversed ? 'desc' : 'asc') : null
  const updatedDir = updatedActive ? (reversed ? 'asc' : 'desc') : null

  const titleHeader = (
    <button
      type="button"
      className={styles.sortBtn}
      onClick={() => (titleActive ? setReversed((r) => !r) : onSortChange('title'))}
    >
      Title{sortIcon(titleActive, titleDir || 'asc')}
    </button>
  )
  const updatedHeader = (
    <button
      type="button"
      className={styles.sortBtn}
      onClick={() => (updatedActive ? setReversed((r) => !r) : onSortChange('updated'))}
    >
      Updated {sortIcon(updatedActive, updatedDir || 'desc')}
    </button>
  )

  const columns = [
    ...(selection ? [{
      // Desktop/tablet: its own narrow column with a select-all header. On a
      // phone the card view drops it (a header checkbox repeated as every
      // card's field label would be nonsense) and the box rides in the card
      // title instead — select-all lives in the bulk bar there.
      key: '__select',
      hideOnPhone: true,
      className: styles.selectCol,
      header: (
        <label className={styles.selectBox}>
          <input
            type="checkbox"
            checked={selection.allSelected}
            ref={(el) => { if (el) el.indeterminate = Boolean(selection.someSelected && !selection.allSelected) }}
            onChange={() => selection.onToggleAll()}
            aria-label={selection.allSelected ? 'Clear the selection' : 'Select all notes in view'}
          />
        </label>
      ),
      render: rowCheckbox,
    }] : []),
    {
      key: 'title', header: titleHeader, primary: true,
      ariaSort: titleDir === 'asc' ? 'ascending' : titleDir === 'desc' ? 'descending' : undefined,
      render: (n) => (
        <span className={styles.titleCell}>
          {n.title || 'Untitled'}
          <LockedGlyph note={n} />
          {isBlocked(n.id) && <BlockedBadge className={styles.unsynced} />}
        </span>
      ),
    },
    // ⛔ TICKER IS A FIXED PSEUDO-COLUMN, SAME AS TITLE/UPDATED ABOVE — never
    // gated on `source === 'user_set'` like the usedDefs loop below, because
    // it isn't a user-defined property at all (note_properties.py:47-51:
    // financial_derived, excluded outright by that filter). List and Board
    // views both show it prominently on every card; Table -- the one view
    // built explicitly for sorting/scanning a database -- was the single
    // view that structurally could not. Competitive audit finding UX #2,
    // 2026-09-22. Not sortable (yet) -- sorting by ticker is a new server
    // capability, out of scope for surfacing the column itself.
    {
      key: 'ticker', header: 'Ticker', secondary: true,
      render: (n) => (n.ticker ? <span className={styles.tickerCell}>${n.ticker}</span> : <span className={styles.emptyCell}>—</span>),
    },
    {
      key: 'updated', header: updatedHeader, secondary: true,
      ariaSort: updatedDir === 'asc' ? 'ascending' : updatedDir === 'desc' ? 'descending' : undefined,
      render: (n) => timeAgo(n.updatedAt),
    },
    ...usedDefs.map((def) => ({
      key: def.id,
      // Wave 6: a relation has no order a member means (the server refuses to
      // sort by one), so its header is a label, never a sort button that 400s.
      header: def.type === 'relation' ? def.name : (
        <button
          type="button"
          className={styles.sortBtn}
          onClick={() => onPropertySortChange(def.id)}
        >
          {def.name}
          {sortIcon(propertySort?.propertyId === def.id, propertySort?.direction || 'asc')}
        </button>
      ),
      secondary: true,
      render: (n) => {
        const raw = n.propertiesJson?.[def.id]
        const formatted = formatCellValue(def, raw)
        if (!formatted) return <span className={styles.emptyCell}>—</span>
        if (def.type === 'select' || def.type === 'multi_select') {
          // Same single button, same onClick/title (onQuickFilter is called
          // with the exact same args as before this fix) -- ONLY the visual
          // rendering changed, from one plain-text chip to one dot+label pill
          // per selected option, each colored by its own `option.color`.
          return (
            <button
              type="button"
              className={styles.valueChip}
              onClick={(e) => { e.stopPropagation(); onQuickFilter(def.id, raw) }}
              title={`Filter by ${def.name}: ${formatted}`}
            >
              {selectedOptionsFor(def, raw).map((opt) => (
                <span key={opt.id} className={styles.optionPill}>
                  <span
                    className={`${styles.optionDot} ${styles[`c_${opt.color}`] || ''}`}
                    aria-hidden="true"
                    data-option-color={opt.color || ''}
                  />
                  {opt.label}
                </span>
              ))}
            </button>
          )
        }
        return <span>{formatted}</span>
      },
    })),
  ]

  // FX4: reverse the whole currently-loaded set when the active built-in
  // column has been flipped off its natural direction. Recomputed every
  // render straight from the live `notes` prop -- never a captured snapshot
  // -- so a `loadMore` append while reversed is still showing every row,
  // consistently reversed, on the very next render.
  const displayNotes = reversed && (titleActive || updatedActive) ? [...notes].reverse() : notes

  return (
    <ResponsiveTable
      columns={columns}
      rows={displayNotes}
      rowKey={(n) => n.id}
      mode="card"
      cardTitle={(n) => (selection ? (
        <span className={styles.cardTitleRow}>{rowCheckbox(n)}<span>{n.title || 'Untitled'}<LockedGlyph note={n} /></span></span>
      ) : (<>{n.title || 'Untitled'}<LockedGlyph note={n} /></>))}
      // D-40, 2026-09-22: the joystick hub's cursor (notebookSection.js)
      // queries `[data-note-card-id]` against the WHOLE document -- a
      // global selector, not scoped to the List/NoteCard grid. On a touch
      // device viewing Table (or a tablet, where the hub is active up to
      // 1023px but ResponsiveTable's own phone threshold is 640px, so the
      // DESKTOP <table> markup is what's actually on screen) the hub found
      // zero notes, silently, because neither of ResponsiveTable's two row
      // shapes carried the attribute. Same name NoteCard already uses
      // (R-18) -- never `data-note-id`, which TipTap's inline note-link
      // node already owns.
      rowDataAttrs={(n) => ({ 'data-note-card-id': n.id })}
      // openNote (NotebookTab.jsx) reads note.id itself -- it wants the
      // whole note object, the same contract NoteCard's onOpen already
      // uses. Passing n.id here instead sent openNote a bare string,
      // whose own .id read as undefined -- a real bug caught live via
      // browser E2E (?note=undefined, "Couldn't load this note").
      onRowClick={(n) => onOpenNote(n)}
      // F4 / A2R-02: the row is a Tab stop that opens its note on Enter or
      // Space, and its name says what that does (the title alone reads as data).
      rowLabel={(n) => `Open ${n.title || 'Untitled'}`}
      emptyText="No notes match this view."
    />
  )
}

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}
