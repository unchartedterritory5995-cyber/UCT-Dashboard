import ResponsiveTable from '../../../../components/mobile/ResponsiveTable'
import useJ2PropertyDefs from '../../hooks/useJ2PropertyDefs'
import useNotePropertiesBatch from '../../hooks/useNotePropertiesBatch'

function renderValue(def, value) {
  if (value === undefined || value === null || value === '') return <span className="text-muted">—</span>
  if (!def) return String(value)
  if (def.type === 'select') {
    const opt = (def.options || []).find((o) => o.id === value)
    return opt ? opt.label : <span className="text-muted">—</span>  // option removed since -- never show a dangling id
  }
  if (def.type === 'multi_select') {
    const byId = Object.fromEntries((def.options || []).map((o) => [o.id, o.label]))
    const labels = (Array.isArray(value) ? value : []).map((v) => byId[v]).filter(Boolean)
    return labels.length ? labels.join(', ') : <span className="text-muted">—</span>
  }
  if (def.type === 'checkbox') return value ? 'Yes' : 'No'
  return String(value)
}

/**
 * Wave E — dynamic-column Table view over a saved view's chosen properties.
 * Desktop/tablet: a real table. Phone: ResponsiveTable's card mode (never a
 * forced desktop data-grid squeezed into 390px — directive §47-49).
 */
export default function NotesTableView({ notes, view, onOpen }) {
  const { properties: allDefs } = useJ2PropertyDefs()
  const defsById = Object.fromEntries(allDefs.map((d) => [d.id, d]))
  const columnDefIds = view?.columns?.length ? view.columns : []
  const { propertiesByNote } = useNotePropertiesBatch(notes.map((n) => n.id))

  const valueFor = (note, defId) => {
    const entries = propertiesByNote[note.id] || []
    const entry = entries.find((e) => e.defId === defId)
    return entry ? entry.value : undefined
  }

  const columns = [
    {
      key: 'title', header: 'Title', primary: true,
      render: (n) => n.title?.trim() || 'Untitled',
    },
    ...columnDefIds.map((defId) => {
      const def = defsById[defId]
      return {
        key: defId,
        header: def?.name || '—',
        render: (n) => renderValue(def, valueFor(n, defId)),
      }
    }),
    {
      key: 'updatedAt', header: 'Updated', hideOnPhone: true,
      render: (n) => (n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : ''),
    },
  ]

  return (
    <ResponsiveTable
      columns={columns}
      rows={notes}
      rowKey={(n) => n.id}
      mode="scroll"
      onRowClick={(n) => onOpen(n)}
      emptyText="No notes match this view yet."
    />
  )
}
