import ResponsiveTable from '../../../../components/mobile/ResponsiveTable'
import UIcon from '../../../../components/ui/UIcon'
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
  return String(value)
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
}) {
  const userDefs = (propertyDefs || []).filter((d) => d.source === 'user_set')
  const usedDefs = userDefs.filter((d) =>
    notes.some((n) => n.propertiesJson && n.propertiesJson[d.id] !== undefined && n.propertiesJson[d.id] !== null),
  )

  const sortIcon = (active, dir) => (
    <UIcon name={dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={10} style={{ marginLeft: 4, opacity: active ? 1 : 0.3 }} />
  )

  const titleHeader = (
    <button
      type="button"
      className={styles.sortBtn}
      onClick={() => onSortChange(sort === 'title' ? 'title' : 'title')}
    >
      Title
    </button>
  )
  const updatedHeader = (
    <button
      type="button"
      className={styles.sortBtn}
      onClick={() => onSortChange('updated')}
    >
      Updated {sortIcon(sort === 'updated' || !sort, 'desc')}
    </button>
  )

  const columns = [
    {
      key: 'title', header: titleHeader, primary: true,
      render: (n) => <span className={styles.titleCell}>{n.title || 'Untitled'}</span>,
    },
    { key: 'updated', header: updatedHeader, secondary: true, render: (n) => timeAgo(n.updatedAt) },
    ...usedDefs.map((def) => ({
      key: def.id,
      header: (
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
          return (
            <button
              type="button"
              className={styles.valueChip}
              onClick={(e) => { e.stopPropagation(); onQuickFilter(def.id, raw) }}
              title={`Filter by ${def.name}: ${formatted}`}
            >
              {formatted}
            </button>
          )
        }
        return <span>{formatted}</span>
      },
    })),
  ]

  return (
    <ResponsiveTable
      columns={columns}
      rows={notes}
      rowKey={(n) => n.id}
      mode="card"
      cardTitle={(n) => n.title || 'Untitled'}
      // openNote (NotebookTab.jsx) reads note.id itself -- it wants the
      // whole note object, the same contract NoteCard's onOpen already
      // uses. Passing n.id here instead sent openNote a bare string,
      // whose own .id read as undefined -- a real bug caught live via
      // browser E2E (?note=undefined, "Couldn't load this note").
      onRowClick={(n) => onOpenNote(n)}
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
