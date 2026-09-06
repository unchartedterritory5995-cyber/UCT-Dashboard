import { useState } from 'react'
import useNoteProperties from '../../hooks/useNoteProperties'
import useJ2PropertyDefs from '../../hooks/useJ2PropertyDefs'
import { createPropertyDef } from '../../hooks/useJ2PropertyDefs'
import UIcon from '../../../../components/ui/UIcon'
import styles from './PropertiesSection.module.css'

const TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
]

function ValueControl({ prop, onChange }) {
  const { type, options, value } = prop
  if (type === 'text' || type === 'url') {
    return (
      <input
        className={styles.input}
        type="text"
        defaultValue={value || ''}
        placeholder={type === 'url' ? 'https://…' : 'Value'}
        onBlur={(e) => onChange(e.target.value || null)}
      />
    )
  }
  if (type === 'number') {
    return (
      <input
        className={styles.input}
        type="number"
        defaultValue={value ?? ''}
        onBlur={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    )
  }
  if (type === 'date') {
    return (
      <input
        className={styles.input}
        type="date"
        defaultValue={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    )
  }
  if (type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    )
  }
  if (type === 'select') {
    return (
      <select className={styles.input} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {(options || []).map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    )
  }
  if (type === 'multi_select') {
    const selected = new Set(Array.isArray(value) ? value : [])
    return (
      <div className={styles.chipRow}>
        {(options || []).map((o) => {
          const active = selected.has(o.id)
          return (
            <button
              key={o.id}
              type="button"
              className={`${styles.chip} ${active ? styles.chipActive : ''}`}
              aria-pressed={active}
              onClick={() => {
                const next = new Set(selected)
                if (active) next.delete(o.id)
                else next.add(o.id)
                onChange([...next])
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    )
  }
  return null
}

function AddPropertyPicker({ noteId, existingDefIds, onAdded, onClose }) {
  const { properties: allDefs, refresh: refreshDefs } = useJ2PropertyDefs()
  const [mode, setMode] = useState('pick')  // 'pick' | 'create'
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('text')
  const [busy, setBusy] = useState(false)
  const { setValue } = useNoteProperties(noteId)

  const candidates = allDefs.filter((d) => !d.derived && !existingDefIds.has(d.id))

  const pick = async (defId) => {
    setBusy(true)
    try {
      await setValue(defId, defaultValueFor(allDefs.find((d) => d.id === defId)))
      onAdded()
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const prop = await createPropertyDef({ name, type: newType })
      refreshDefs()
      await setValue(prop.id, defaultValueFor(prop))
      onAdded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.picker}>
      {mode === 'pick' ? (
        <>
          {candidates.length > 0 && (
            <ul className={styles.pickerList}>
              {candidates.map((d) => (
                <li key={d.id}>
                  <button type="button" className={styles.pickerItem} disabled={busy} onClick={() => pick(d.id)}>
                    {d.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={styles.pickerCreate} onClick={() => setMode('create')}>
            + New property…
          </button>
          <button type="button" className={styles.pickerCancel} onClick={onClose}>Cancel</button>
        </>
      ) : (
        <>
          <input
            className={styles.input}
            placeholder="Property name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
          />
          <select className={styles.input} value={newType} onChange={(e) => setNewType(e.target.value)}>
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" className={styles.pickerCreate} disabled={busy || !newName.trim()} onClick={create}>
            Add
          </button>
          <button type="button" className={styles.pickerCancel} onClick={onClose}>Cancel</button>
        </>
      )}
    </div>
  )
}

function defaultValueFor(def) {
  if (!def) return null
  if (def.type === 'checkbox') return false
  if (def.type === 'multi_select') return []
  return null  // text/number/select/date/url start unset until the member types something
}

/**
 * Wave E — progressive-disclosure properties block. Placed in the note's
 * existing metadata zone (title/subtitle area), NOT a new toolbar button
 * (directive §30-32). Renders a minimal "+ Add property" affordance when
 * the note has none set yet; once at least one exists (real or derived),
 * shows the full row list. A pristine note therefore looks near-identical
 * to before Wave E -- one small text link, not a whole new chrome region.
 */
export default function PropertiesSection({ noteId, ticker }) {
  const { properties, setValue } = useNoteProperties(noteId)
  const [adding, setAdding] = useState(false)

  const existingDefIds = new Set(properties.filter((p) => !p.derived).map((p) => p.defId))

  if (properties.length === 0 && !adding) {
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.addLink} onClick={() => setAdding(true)}>
          <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Add property
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {properties.map((p) => (
        <div key={p.defId} className={styles.row}>
          <span className={styles.label}>{p.name}</span>
          {p.derived ? (
            <span className={styles.derivedValue} title="Derived from this note's ticker — not editable">
              {p.value}
            </span>
          ) : (
            <ValueControl prop={p} onChange={(v) => setValue(p.defId, v)} />
          )}
        </div>
      ))}
      {adding ? (
        <AddPropertyPicker
          noteId={noteId}
          existingDefIds={existingDefIds}
          onAdded={() => setAdding(false)}
          onClose={() => setAdding(false)}
        />
      ) : (
        <button type="button" className={styles.addLink} onClick={() => setAdding(true)}>
          <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Add property
        </button>
      )}
    </div>
  )
}
