import { useEffect, useMemo, useState } from 'react'
import useNoteProperties from '../../hooks/useNoteProperties'
import useJ2PropertyDefs from '../../hooks/useJ2PropertyDefs'
import UIcon from '../../../../components/ui/UIcon'
import styles from './PropertiesSection.module.css'

const NEW_PROPERTY_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
]

/**
 * Wave E — the note editor's Properties section. Progressive disclosure by
 * design (checkpoint §21): a note with nothing set shows only a single
 * small "+ Add property" link, not even a header -- calmer than Wave D's
 * own already-conditional Backlinks section, which at least always shows a
 * collapsed header. Once ANYTHING is set (a value, or the member opened the
 * picker), the section becomes a plain list of rows -- no accordion, no
 * extra chrome, matching "structured note: powerful on demand."
 *
 * Native form controls throughout (select/date/checkbox/text) -- a
 * deliberate choice to avoid repeating Wave D's ARIA-combobox debt class
 * (checkpoint §25): a native control gets full keyboard/screen-reader
 * support for free, and nothing here needs a custom listbox.
 */
export default function PropertiesSection({ noteId, updateNote }) {
  const { properties, isLoading, refresh } = useNoteProperties(noteId)
  const { propertyDefs, create: createDef } = useJ2PropertyDefs()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [manuallyShown, setManuallyShown] = useState(() => new Set())
  const [newPropOpen, setNewPropOpen] = useState(false)
  const [newPropName, setNewPropName] = useState('')
  const [newPropType, setNewPropType] = useState('text')
  const [saving, setSaving] = useState(null) // property id currently saving, for a subtle inline state
  const [error, setError] = useState(null)

  const visible = useMemo(
    () => properties.filter((p) => p.value !== null || manuallyShown.has(p.id)),
    [properties, manuallyShown],
  )
  const hidden = useMemo(
    () => properties.filter((p) => p.source === 'user_set' && p.value === null && !manuallyShown.has(p.id)),
    [properties, manuallyShown],
  )

  if (isLoading) return null

  const setValue = async (propertyId, value) => {
    setSaving(propertyId)
    setError(null)
    try {
      await updateNote({ properties: { [propertyId]: value } })
      await refresh()
    } catch (e) {
      setError(e.message || 'Could not save')
    } finally {
      setSaving(null)
    }
  }

  const addExisting = (propertyId) => {
    setManuallyShown((prev) => new Set(prev).add(propertyId))
    setPickerOpen(false)
  }

  const createAndAdd = async () => {
    const name = newPropName.trim()
    if (!name) return
    try {
      const def = await createDef(name, newPropType, newPropType === 'select' || newPropType === 'multi_select' ? [] : undefined)
      setManuallyShown((prev) => new Set(prev).add(def.id))
      setNewPropName('')
      setNewPropType('text')
      setNewPropOpen(false)
      setPickerOpen(false)
    } catch (e) {
      setError(e.message || 'Could not create property')
    }
  }

  if (!visible.length && !pickerOpen) {
    return (
      <div className={styles.emptyWrap}>
        <button type="button" className={styles.addLink} onClick={() => setPickerOpen(true)}>
          <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Add property
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-export-exclude>
      <ul className={styles.list}>
        {visible.map((p) => (
          <li key={p.id} className={styles.row}>
            <span className={styles.label}>{p.name}</span>
            <span className={styles.control}>
              <PropertyControl
                prop={p}
                disabled={p.source !== 'user_set' || saving === p.id}
                onChange={(v) => setValue(p.id, v)}
              />
            </span>
          </li>
        ))}
      </ul>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.pickerWrap}>
        <button type="button" className={styles.addLink} onClick={() => setPickerOpen((o) => !o)}>
          <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Add property
        </button>
        {pickerOpen && (
          <div className={styles.picker}>
            {hidden.map((p) => (
              <button key={p.id} type="button" className={styles.pickerItem} onClick={() => addExisting(p.id)}>
                {p.name}
              </button>
            ))}
            {!newPropOpen ? (
              <button type="button" className={styles.pickerItem} onClick={() => setNewPropOpen(true)}>
                + New property…
              </button>
            ) : (
              <div className={styles.newPropForm}>
                <input
                  type="text"
                  className={styles.newPropInput}
                  placeholder="Property name"
                  value={newPropName}
                  onChange={(e) => setNewPropName(e.target.value)}
                  autoFocus
                />
                <select
                  className={styles.newPropType}
                  value={newPropType}
                  onChange={(e) => setNewPropType(e.target.value)}
                >
                  {NEW_PROPERTY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <button type="button" className={styles.newPropCreate} onClick={createAndAdd} disabled={!newPropName.trim()}>
                  Create
                </button>
              </div>
            )}
            {!hidden.length && !propertyDefs.length && null}
          </div>
        )}
      </div>
    </div>
  )
}

function PropertyControl({ prop, disabled, onChange }) {
  const { type, value } = prop
  if (disabled) {
    // financial_derived (read-only) -- plain text, never an input the member
    // could mistake for editable (checkpoint's "UCT already knows this"
    // properties are never something to fill in by hand).
    return <span className={styles.readonlyValue}>{value === null ? '—' : String(value)}</span>
  }
  if (type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        className={styles.checkbox}
      />
    )
  }
  if (type === 'date') {
    return (
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={styles.input}
      />
    )
  }
  if (type === 'number') {
    return (
      <DeferredTextInput
        type="number"
        value={value ?? ''}
        onCommit={(v) => onChange(v === '' ? null : Number(v))}
        className={styles.input}
      />
    )
  }
  if (type === 'select') {
    return (
      <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} className={styles.select}>
        <option value="">—</option>
        {(prop.options || []).map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    )
  }
  if (type === 'multi_select') {
    const selected = Array.isArray(value) ? value : []
    const toggle = (optId) => {
      const next = selected.includes(optId) ? selected.filter((id) => id !== optId) : [...selected, optId]
      onChange(next.length ? next : null)
    }
    return (
      <div className={styles.multiSelect}>
        {(prop.options || []).map((o) => (
          <label key={o.id} className={styles.multiSelectOption}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
    )
  }
  // text / url -- committed on blur/Enter, never on every keystroke (a
  // property save is a real network PUT, not a local-only edit; keystroke-
  // level saves here would be the exact over-chatty pattern the note body's
  // own 800ms-debounced autosave exists to avoid, just with no debounce
  // benefit since a property value is short and finished quickly).
  return (
    <DeferredTextInput
      type="text"
      value={value || ''}
      onCommit={(v) => onChange(v || null)}
      className={styles.input}
      placeholder={type === 'url' ? 'https://…' : ''}
    />
  )
}

/** Local-state text input that only calls onCommit on blur or Enter --
 * every OTHER property control type commits immediately because each is a
 * single discrete action (a click, a date pick), not continuous typing. */
function DeferredTextInput({ value, onCommit, ...inputProps }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <input
      {...inputProps}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onCommit(local) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur() }
        if (e.key === 'Escape') { setLocal(value); e.currentTarget.blur() }
      }}
    />
  )
}
