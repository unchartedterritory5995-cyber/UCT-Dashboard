import { useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import useJ2PropertyDefs from '../../hooks/useJ2PropertyDefs'
import { createSavedView, updateSavedView } from '../../hooks/useJ2SavedViews'
import UIcon from '../../../../components/ui/UIcon'
import styles from './SavedViewEditor.module.css'

const OPS_BY_TYPE = {
  text: [['eq', 'is'], ['contains', 'contains'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
  url: [['eq', 'is'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
  number: [['eq', '='], ['gte', '≥'], ['lte', '≤'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
  date: [['eq', 'is'], ['gte', 'on or after'], ['lte', 'on or before'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
  checkbox: [['eq', 'is'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
  select: [['eq', 'is'], ['neq', 'is not'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
  multi_select: [['contains', 'includes'], ['is_set', 'is set'], ['is_not_set', 'is not set']],
}

function ValueInput({ def, op, value, onChange }) {
  if (op === 'is_set' || op === 'is_not_set') return null
  if (!def) return null
  if (def.type === 'select' || def.type === 'multi_select') {
    return (
      <select className={styles.input} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {(def.options || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    )
  }
  if (def.type === 'checkbox') {
    return (
      <select className={styles.input} value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="">—</option>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    )
  }
  return (
    <input
      className={styles.input}
      type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(def.type === 'number' ? Number(e.target.value) : e.target.value)}
    />
  )
}

/** Wave E — "configuring a view" (directive §80): a deliberate, secondary
 * surface, never the default state a member lands in. AND-only condition
 * list (directive §39-41, entry checkpoint point 9). */
export default function SavedViewEditor({ open, onClose, existingView, onSaved }) {
  const { properties: allDefs } = useJ2PropertyDefs()
  const filterable = allDefs.filter((d) => !d.derived)

  const [name, setName] = useState(existingView?.name || '')
  const [viewType, setViewType] = useState(existingView?.viewType || 'list')
  const [conditions, setConditions] = useState(existingView?.filter || [])
  const [columns, setColumns] = useState(existingView?.columns || [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const addCondition = () => {
    const first = filterable[0]
    if (!first) return
    setConditions((c) => [...c, { propertyDefId: first.id, op: 'is_set', value: null }])
  }
  const updateCondition = (i, patch) => {
    setConditions((c) => c.map((cond, idx) => (idx === i ? { ...cond, ...patch } : cond)))
  }
  const removeCondition = (i) => setConditions((c) => c.filter((_, idx) => idx !== i))

  const toggleColumn = (defId) => {
    setColumns((cols) => (cols.includes(defId) ? cols.filter((c) => c !== defId) : [...cols, defId]))
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setErr('Name is required'); return }
    setBusy(true)
    setErr(null)
    try {
      const payload = { name: trimmed, viewType, filter: conditions, columns: viewType === 'table' ? columns : [] }
      const view = existingView
        ? await updateSavedView(existingView.id, payload)
        : await createSavedView(payload)
      onSaved(view)
    } catch (e) {
      setErr(e.message || 'Could not save this view')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={existingView ? 'Edit view' : 'New saved view'} variant="auto" maxWidth={520}>
      <div className={styles.wrap}>
        {err && <div className={styles.error} role="alert">{err}</div>}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Name</span>
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Active Theses" autoFocus />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Layout</span>
          <select className={styles.input} value={viewType} onChange={(e) => setViewType(e.target.value)}>
            <option value="list">List</option>
            <option value="table">Table</option>
          </select>
        </label>

        <div className={styles.sectionLabel}>Filter (every condition must match)</div>
        {conditions.map((cond, i) => {
          const def = filterable.find((d) => d.id === cond.propertyDefId)
          const ops = OPS_BY_TYPE[def?.type] || OPS_BY_TYPE.text
          return (
            <div key={i} className={styles.conditionRow}>
              <select
                className={styles.input}
                value={cond.propertyDefId}
                onChange={(e) => updateCondition(i, { propertyDefId: e.target.value, op: 'is_set', value: null })}
              >
                {filterable.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select className={styles.input} value={cond.op} onChange={(e) => updateCondition(i, { op: e.target.value, value: null })}>
                {ops.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
              <ValueInput def={def} op={cond.op} value={cond.value} onChange={(v) => updateCondition(i, { value: v })} />
              <button type="button" className={styles.removeBtn} aria-label="Remove condition" onClick={() => removeCondition(i)}>
                <UIcon name="x" size={12} gold={false} />
              </button>
            </div>
          )
        })}
        {filterable.length > 0 ? (
          <button type="button" className={styles.addBtn} onClick={addCondition}>
            <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
            Add condition
          </button>
        ) : (
          <p className={styles.hint}>Add a property to a note first, then come back to filter by it.</p>
        )}

        {viewType === 'table' && (
          <>
            <div className={styles.sectionLabel}>Columns</div>
            {filterable.length === 0 ? (
              <p className={styles.hint}>No properties yet — Title still shows.</p>
            ) : (
              <div className={styles.columnList}>
                {filterable.map((d) => (
                  <label key={d.id} className={styles.columnItem}>
                    <input type="checkbox" checked={columns.includes(d.id)} onChange={() => toggleColumn(d.id)} />
                    {d.name}
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        <div className={styles.actions}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save view'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
