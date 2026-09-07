import { useEffect, useMemo, useRef, useState } from 'react'
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
export default function PropertiesSection({ noteId, updateNote, ticker }) {
  const { properties, isLoading, refresh } = useNoteProperties(noteId)
  // The Ticker/Sector/Industry/Theme/Trade rows are computed server-side
  // from the note's OWN ticker field (a DIFFERENT save path -- the header's
  // Ticker input, not this section) -- this section's own SWR cache has no
  // way to know that field changed underneath it. Refetch whenever the
  // caller's own note.ticker changes so the derived rows never sit stale
  // until a full reload (same principle as Wave D's rename-staleness fix,
  // applied here before it could ever be reported as a real gap).
  const prevTickerRef = useRef(ticker)
  useEffect(() => {
    if (prevTickerRef.current !== ticker) {
      prevTickerRef.current = ticker
      refresh()
    }
  }, [ticker, refresh])
  const { propertyDefs, create: createDef } = useJ2PropertyDefs()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [manuallyShown, setManuallyShown] = useState(() => new Set())
  const [newPropOpen, setNewPropOpen] = useState(false)
  const [newPropName, setNewPropName] = useState('')
  const [newPropType, setNewPropType] = useState('text')
  const [newPropOptions, setNewPropOptions] = useState('')
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

  const isChoiceType = newPropType === 'select' || newPropType === 'multi_select'

  const createAndAdd = async () => {
    const name = newPropName.trim()
    if (!name) return
    try {
      // A select/multi_select property created with zero options renders a
      // dropdown/checklist with nothing pickable -- collect the labels here
      // rather than shipping a property type nothing can ever set (option
      // rename/add-later is still a known frontend gap, tracked separately;
      // this is what makes the type usable at all on creation).
      const options = isChoiceType
        ? newPropOptions.split(',').map((s) => s.trim()).filter(Boolean).map((label) => ({ label }))
        : undefined
      const def = await createDef(name, newPropType, options)
      // createDef only invalidates the property-defs list -- this note's OWN
      // resolved-properties cache (useNoteProperties, a separate SWR key) has
      // no way to know a new def now exists. Without this refresh the new
      // property is server-created but invisible here until a full reload
      // (caught live: the picker's own "+ New property..." flow left the new
      // property vanished until F5, the same staleness shape as the
      // ticker-change fix above).
      await refresh()
      setManuallyShown((prev) => new Set(prev).add(def.id))
      setNewPropName('')
      setNewPropType('text')
      setNewPropOptions('')
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
        {visible.map((p) => {
          // The label span is only VISUALLY beside its control -- without an
          // explicit association a screen reader announces each row's
          // select/input/checkbox with no name at all ("combobox, Active" vs
          // "Thesis Status, combobox, Active"). id/aria-labelledby closes that
          // gap without a <label> wrapper (which would need its own layout
          // rework of this label/control split).
          const labelId = `j2-prop-label-${p.id}`
          return (
            <li key={p.id} className={styles.row}>
              <span className={styles.label} id={labelId}>{p.name}</span>
              <span className={styles.control}>
                <PropertyControl
                  prop={p}
                  disabled={p.source !== 'user_set' || saving === p.id}
                  onChange={(v) => setValue(p.id, v)}
                  labelId={labelId}
                />
              </span>
            </li>
          )
        })}
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
                {isChoiceType && (
                  <input
                    type="text"
                    className={styles.newPropInput}
                    placeholder="Options, comma separated (e.g. Low, Medium, High)"
                    value={newPropOptions}
                    onChange={(e) => setNewPropOptions(e.target.value)}
                  />
                )}
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

function PropertyControl({ prop, disabled, onChange, labelId }) {
  const { type, value } = prop
  if (disabled) {
    // financial_derived (read-only) -- plain text, never an input the member
    // could mistake for editable (checkpoint's "UCT already knows this"
    // properties are never something to fill in by hand). Not a form
    // control, so no aria-labelledby needed -- reading order already puts
    // the label span directly before it.
    return <span className={styles.readonlyValue}>{value === null ? '—' : String(value)}</span>
  }
  if (type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange(e.target.checked)}
        className={styles.checkbox}
        aria-labelledby={labelId}
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
        aria-labelledby={labelId}
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
        aria-labelledby={labelId}
      />
    )
  }
  if (type === 'select') {
    return (
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={styles.select}
        aria-labelledby={labelId}
      >
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
      <div className={styles.multiSelect} role="group" aria-labelledby={labelId}>
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
      aria-labelledby={labelId}
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
