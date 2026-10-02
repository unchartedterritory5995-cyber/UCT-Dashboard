import { useEffect, useMemo, useRef, useState } from 'react'
import useNoteProperties from '../../hooks/useNoteProperties'
import LoadFailed from '../LoadFailed'
import useJ2PropertyDefs from '../../hooks/useJ2PropertyDefs'
import UIcon from '../../../../components/ui/UIcon'
import RelationPropertyValue from './RelationPropertyValue'
import {
  AUTOFILL_NOTHING_SENTENCE, AUTOFILL_NOT_SAVED, AUTOFILL_SOURCE_LABEL, autofillAlreadySetSentence,
  autofillCandidates, requestAutofill,
} from '../../lib/propertyAutofill'
import styles from './PropertiesSection.module.css'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'

const NEW_PROPERTY_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
  // Wave 6: links to other notes (a list of note ids).
  { value: 'relation', label: 'Relation' },
]
// ⛔ ONE FACT IN TWO FILES with the server's `note_properties._VALID_TYPES`,
// pinned by tests/test_journal_two_relation_property_router.py (it PARSES this
// list, so keep it a literal array of `{ value: '…', label: '…' }`).

// Wave 11 (lane 11B): the two CALCULATED types, offered only while
// `notebook_formulas_enabled` is on. ⛔ ONE FACT IN TWO FILES with the server's
// `note_computed.COMPUTED_TYPES`, pinned by tests/test_notebook_formula_properties.py
// (which PARSES this literal, same as the list above).
export const COMPUTED_PROPERTY_TYPES = [
  { value: 'formula', label: 'Formula' },
  { value: 'rollup', label: 'Rollup' },
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
export default function PropertiesSection({ noteId, updateNote, ticker, autofillOn = false }) {
  const { properties, isLoading, error: loadError, refresh } = useNoteProperties(noteId)
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
  // Wave 10 (G-165, R-3): Compass's SUGGESTED values -- held here, never in the
  // note, until the member accepts one (lib/propertyAutofill.js says why).
  // 'idle' | 'loading' | 'ready' | 'error'
  const [suggestState, setSuggestState] = useState('idle')
  const [suggestions, setSuggestions] = useState([])
  const [suggestModel, setSuggestModel] = useState(null)
  const [suggestError, setSuggestError] = useState(null)
  const suggestAbortRef = useRef(null)
  // A note switch drops the other note's suggestions (and any request still out).
  useEffect(() => {
    setSuggestState('idle')
    setSuggestions([])
    setSuggestError(null)
    return () => suggestAbortRef.current?.abort()
  }, [noteId])

  const visible = useMemo(
    () => properties.filter((p) => p.value !== null || manuallyShown.has(p.id)),
    [properties, manuallyShown],
  )
  const hidden = useMemo(
    () => properties.filter((p) => p.source === 'user_set' && p.value === null && !manuallyShown.has(p.id)),
    [properties, manuallyShown],
  )

  // ⛔ F4 / A2R-07 (WCAG 2.4.3): "ADD PROPERTY" NEVER DROPS FOCUS. Lane 10E-2's keyboard walk:
  // Enter on "Add property" left focus on <body>. On a note with nothing set, that button is
  // the empty state's, and opening the picker swaps the whole section for the list layout --
  // the focused button goes with it. The same happens when a picked property's button
  // disappears, and when Escape (now handled) closes the picker. After each of those, focus
  // goes where the member's next act is: the re-mounted "Add property" toggle, or the control
  // of the property just added -- and only when focus was LOST, never taken from elsewhere.
  const rootRef = useRef(null)
  const addToggleRef = useRef(null)
  const focusAfterRef = useRef(null) // null | { toggle: true } | { prop: <property id> }
  useEffect(() => {
    const plan = focusAfterRef.current
    if (!plan) return
    focusAfterRef.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    let target = null
    if (plan.prop && rootRef.current) {
      const row = [...rootRef.current.querySelectorAll('[data-prop-row]')]
        .find((el) => el.getAttribute('data-prop-row') === plan.prop)
      target = row?.querySelector('input, select, textarea, button, [tabindex]:not([tabindex="-1"])') || null
    }
    ;(target || addToggleRef.current)?.focus()
  })
  const onPickerKeyDown = (e) => {
    if (e.key !== 'Escape' || !pickerOpen || e.isDefaultPrevented()) return
    e.preventDefault()
    e.stopPropagation()
    focusAfterRef.current = { toggle: true }
    setNewPropOpen(false)
    setPickerOpen(false)
  }

  if (isLoading) return null
  // Wave 10 F7 (Part A, 5d): a failed read is said -- an empty section here would read as
  // "this note has no properties", which is not what happened.
  if (loadError && !properties.length) {
    return <LoadFailed compact what="this note's properties" error={loadError} onRetry={refresh} />
  }

  // The property door: ONE property, through the note's own `update` (which
  // lands its revision). -> true when it saved.
  const setValue = async (propertyId, value) => {
    setSaving(propertyId)
    setError(null)
    try {
      await updateNote({ properties: { [propertyId]: value } })
      await refresh()
      return true
    } catch (e) {
      setError(e.message || 'Could not save')
      return false
    } finally {
      setSaving(null)
    }
  }

  // -- Wave 10 (G-165): Suggest values ----------------------------------------
  const canSuggest = autofillOn && autofillCandidates(properties).length > 0
  const suggest = async () => {
    suggestAbortRef.current?.abort()
    const ctl = new AbortController()
    suggestAbortRef.current = ctl
    setSuggestState('loading')
    setSuggestError(null)
    setSuggestions([])
    try {
      const { suggestions: list, model } = await requestAutofill(noteId, { signal: ctl.signal })
      if (ctl.signal.aborted) return
      setSuggestions(list)
      setSuggestModel(model)
      setSuggestState('ready')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setSuggestError(e.message)
      setSuggestState('error')
    }
  }
  const closeSuggestions = () => {
    suggestAbortRef.current?.abort()
    setSuggestState('idle')
    setSuggestions([])
    setSuggestError(null)
  }
  const dropSuggestion = (propertyId) => {
    setSuggestions((list) => {
      const next = list.filter((x) => x.propertyId !== propertyId)
      // The last one handled closes the panel -- an empty list here would
      // otherwise read as "Compass found nothing".
      if (!next.length) setSuggestState('idle')
      return next
    })
  }
  // ⛔ THE ONLY WRITE A SUGGESTION CAN CAUSE: the member's Accept, one
  // property, through `setValue` (the door above). A failed save keeps the
  // suggestion on screen with the door's own error beside it.
  const acceptSuggestion = async (s) => {
    // ⛔ STILL EMPTY? asked at ACCEPT time, not at Suggest time (review M-2).
    // The member (or another tab) may have set this property while the
    // suggestion sat on screen; a suggestion only ever fills an EMPTY
    // property, so a value set since then wins and nothing is written. The
    // freshest read is the one we fetch now; the render's list is the fallback.
    let current = properties
    try {
      const fresh = await refresh()
      if (Array.isArray(fresh?.properties)) current = fresh.properties
    } catch { /* keep the render's list */ }
    const now = current.find((p) => p.id === s.propertyId)
    if (now && now.value != null) {
      dropSuggestion(s.propertyId)
      setError(autofillAlreadySetSentence(s.name))
      return
    }
    const ok = await setValue(s.propertyId, s.value)
    if (!ok) return
    // Wave 10 (10D, R-16): an autofill suggestion the member ACCEPTED is writing help that
    // reached the note — the action word only, never the property or its value.
    trackNotebookEvent(NOTEBOOK_EVENTS.WRITING_HELP_USED, { action: 'autofill', scope: 'property', replaced: false })
    setManuallyShown((prev) => new Set(prev).add(s.propertyId))
    dropSuggestion(s.propertyId)
  }

  // ⛔ `autofillOn` gates the PANEL too, not only the button (review M-4): a
  // note locked while suggestions sat on screen must not keep an Accept. ONE
  // mechanism, in the render (no reset effect beside it -- two would leave this
  // one unprovable). Unlocked again, the panel the member left open returns;
  // its Accept still asks whether the property is empty (M-2) before writing.
  const autofillControls = autofillOn && (canSuggest || suggestState !== 'idle') && (
    <>
      {canSuggest && (
        <button type="button" className={styles.addLink} onClick={suggest}
          disabled={suggestState === 'loading'} aria-label="Suggest values with Compass">
          <UIcon name="sparkle" size={11} gold={false} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {suggestState === 'loading' ? 'Suggesting…' : 'Suggest values'}
        </button>
      )}
      {(suggestState === 'ready' || suggestState === 'error') && (
        <div className={styles.suggestPanel} role="region" aria-label="Suggested values">
          <div className={styles.suggestHead}>
            <span className={styles.suggestSource}>
              {AUTOFILL_SOURCE_LABEL}{suggestModel ? ` · ${suggestModel}` : ''}
            </span>
            <button type="button" className={styles.suggestBtn} onClick={closeSuggestions}>Close</button>
          </div>
          {suggestState === 'error' ? (
            <div className={styles.error} role="status">{suggestError}</div>
          ) : suggestions.length === 0 ? (
            <div className={styles.suggestNote} role="status">{AUTOFILL_NOTHING_SENTENCE}</div>
          ) : (
            <>
              <p className={styles.suggestNote}>{AUTOFILL_NOT_SAVED}</p>
              <ul className={styles.suggestList}>
                {suggestions.map((s) => (
                  <li key={s.propertyId} className={styles.suggestRow} data-suggestion={s.propertyId}>
                    <span className={styles.suggestName}>{s.name}</span>
                    <span className={styles.suggestValue}>{String(s.display ?? '')}</span>
                    {s.evidence ? <q className={styles.suggestEvidence}>{s.evidence}</q> : null}
                    <span className={styles.suggestActions}>
                      <button type="button" className={styles.suggestBtn} disabled={saving === s.propertyId}
                        onClick={() => acceptSuggestion(s)} aria-label={`Accept ${s.name}: ${String(s.display ?? '')}`}>
                        Accept
                      </button>
                      <button type="button" className={styles.suggestBtn}
                        onClick={() => dropSuggestion(s.propertyId)} aria-label={`Dismiss ${s.name}`}>
                        Dismiss
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  )

  const addExisting = (propertyId) => {
    focusAfterRef.current = { prop: propertyId }
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
      focusAfterRef.current = { prop: def.id }
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
      <div className={styles.emptyWrap} ref={rootRef}>
        <button
          ref={addToggleRef}
          type="button"
          className={styles.addLink}
          aria-expanded={false}
          onClick={() => { focusAfterRef.current = { toggle: true }; setPickerOpen(true) }}
        >
          <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Add property
        </button>
        {autofillControls}
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-export-exclude ref={rootRef}>
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
            <li key={p.id} className={styles.row} data-prop-row={p.id}>
              <span className={styles.label} id={labelId}>{p.name}</span>
              <span className={styles.control}>
                <PropertyControl
                  prop={p}
                  noteId={noteId}
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
      <div className={styles.pickerWrap} onKeyDown={onPickerKeyDown}>
        <button
          ref={addToggleRef}
          type="button"
          className={styles.addLink}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
        >
          <UIcon name="plus" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Add property
        </button>
        {autofillControls}
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

function PropertyControl({ prop, disabled, onChange, labelId, noteId = null }) {
  const { type, value } = prop
  if (disabled && type === 'relation') {
    // (Only while its own save is in flight: never flash raw note ids.)
    return <span className={styles.readonlyValue}>{Array.isArray(value) ? `${value.length} linked` : '—'}</span>
  }
  if (disabled) {
    // financial_derived (read-only) -- plain text, never an input the member
    // could mistake for editable (checkpoint's "UCT already knows this"
    // properties are never something to fill in by hand). Not a form
    // control, so no aria-labelledby needed -- reading order already puts
    // the label span directly before it.
    return <span className={styles.readonlyValue}>{value === null ? '—' : String(value)}</span>
  }
  if (type === 'relation') {
    return (
      <RelationPropertyValue value={value} onChange={onChange} labelId={labelId} currentNoteId={noteId} />
    )
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
