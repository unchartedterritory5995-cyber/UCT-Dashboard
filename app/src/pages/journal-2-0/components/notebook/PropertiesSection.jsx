import { useEffect, useMemo, useRef, useState } from 'react'
import useNoteProperties from '../../hooks/useNoteProperties'
import LoadFailed from '../LoadFailed'
import useJ2PropertyDefs from '../../hooks/useJ2PropertyDefs'
import UIcon from '../../../../components/ui/UIcon'
import RelationPropertyValue from './RelationPropertyValue'
import ComputedValue from './ComputedValue'
import FormulaEditor from './FormulaEditor'
import RollupEditor, { rollupReady } from './RollupEditor'
import useSWR from 'swr'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { checkFormula, displayExpression, formulaInputIds } from '../../lib/formula/computed'
import { templateRevealFor } from '../../lib/templatePropertyDefs'
import {
  AUTOFILL_NOTHING_SENTENCE, AUTOFILL_NOT_SAVED, AUTOFILL_SOURCE_LABEL, autofillAlreadySetSentence,
  autofillCandidates, requestAutofill,
} from '../../lib/propertyAutofill'
import styles from './PropertiesSection.module.css'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'

const savedViewsFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

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
  const { propertyDefs, create: createDef, updateConfig, refresh: refreshDefs } = useJ2PropertyDefs()
  // Wave 11 (lane 11B): formula + rollup properties, offered only while the flag
  // is on (latched per tab). Off, the type list and every row are exactly as before
  // -- the server hides computed definitions too, so there is nothing to render.
  const formulasOn = notebookFlag('notebook_formulas_enabled') === true
  // The member's saved views, for a rollup over one -- fetched ONLY while the flag
  // is on (same SWR key as useJ2SavedViews, so it shares that cache), so a member
  // without the feature makes no new request when a note opens.
  const { data: viewsData } = useSWR(formulasOn ? '/api/j2/saved-views' : null, savedViewsFetcher)
  const savedViews = viewsData?.savedViews ?? []
  const [newFormula, setNewFormula] = useState('')
  const [newRollup, setNewRollup] = useState({})
  // The computed property being edited in place: { id, type, text | config, error }.
  const [editing, setEditing] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Wave 12 (12B-2): a note just made from a template that declares property
  // definitions (the Position Tracker) shows them while still empty -- this tab only.
  const [manuallyShown, setManuallyShown] = useState(() => new Set(templateRevealFor(noteId)))
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

  // Wave 11: a formula shows once any input it reads has a value on this note, a
  // rollup once its set has rows -- so a trade plan shows its R-multiple without
  // the member adding it, and an unrelated note is not cluttered by it.
  const valuesById = useMemo(
    () => Object.fromEntries(properties.filter((p) => p.source === 'user_set' && !p.computed).map((p) => [p.id, p.value])),
    [properties],
  )
  const shown = (p) => {
    if (p.value !== null || manuallyShown.has(p.id)) return true
    if (!p.computed) return false
    if (p.type === 'rollup') return (p.computedValue?.setSize || 0) > 0
    return formulaInputIds(p.config?.expression).some((id) => valuesById[id] !== null && valuesById[id] !== undefined)
  }
  const visible = useMemo(
    () => properties.filter(shown),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [properties, manuallyShown, valuesById],
  )
  const hidden = useMemo(
    () => properties.filter((p) => p.source === 'user_set' && !shown(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [properties, manuallyShown, valuesById],
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
  const isFormula = newPropType === 'formula'
  const isRollup = newPropType === 'rollup'
  const typeChoices = formulasOn ? [...NEW_PROPERTY_TYPES, ...COMPUTED_PROPERTY_TYPES] : NEW_PROPERTY_TYPES
  const canCreate = Boolean(newPropName.trim())
    && (!isFormula || checkFormula(newFormula, propertyDefs).ok)
    && (!isRollup || rollupReady(newRollup))

  // A starter formula names the number properties it reads; this makes the ones
  // the member does not have yet, so a first formula is one click from working.
  const createMissing = async (names) => {
    setError(null)
    try {
      for (const name of names) await createDef(name, 'number')
      await refresh()
    } catch (e) {
      setError(e.message || 'Could not create those properties')
    }
  }

  const startEdit = (p) => {
    setError(null)
    setEditing(p.type === 'formula'
      ? { id: p.id, type: 'formula', name: p.name, text: displayExpression(p.config?.expression, propertyDefs), error: null }
      : { id: p.id, type: 'rollup', name: p.name, config: { ...(p.config || {}) }, error: null })
  }
  const saveEdit = async () => {
    if (!editing) return
    let config
    if (editing.type === 'formula') {
      const checked = checkFormula(editing.text, propertyDefs, editing.id)
      if (!checked.ok) { setEditing({ ...editing, error: checked.message }); return }
      config = { expression: checked.stored }
    } else {
      config = editing.config
    }
    try {
      await updateConfig(editing.id, config)
      await refresh()
      focusAfterRef.current = { prop: editing.id }
      setEditing(null)
    } catch (e) {
      setEditing({ ...editing, error: e.message || 'Could not save' })
    }
  }

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
      let config
      if (isFormula) {
        const checked = checkFormula(newFormula, propertyDefs)
        if (!checked.ok) { setError(checked.message); return }
        config = { expression: checked.stored }
      } else if (isRollup) {
        config = newRollup
      }
      // An ordinary property is created with exactly the call it always was; only a
      // computed one carries a fourth argument.
      const def = config ? await createDef(name, newPropType, options, config) : await createDef(name, newPropType, options)
      if (config) await refreshDefs()
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
      setNewFormula('')
      setNewRollup({})
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
          if (p.computed) {
            const isEditing = editing?.id === p.id
            return (
              <li key={p.id} className={`${styles.row} ${isEditing ? styles.rowEditing : ''}`} data-prop-row={p.id}>
                <span className={styles.label} id={labelId}>{p.name}</span>
                <span className={styles.control}>
                  <span className={styles.readonlyValue}>
                    <ComputedValue cell={p.computedValue} />
                  </span>
                  <button type="button" className={styles.editComputed} onClick={() => (isEditing ? setEditing(null) : startEdit(p))}
                    aria-expanded={isEditing} aria-label={`Edit ${p.type} ${p.name}`}>
                    {isEditing ? 'Close' : 'Edit'}
                  </button>
                </span>
                {isEditing && (
                  <div className={styles.computedEditor}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); focusAfterRef.current = { prop: p.id } } }}>
                    {p.type === 'formula' ? (
                      <FormulaEditor value={editing.text} onChange={(text) => setEditing({ ...editing, text, error: null })}
                        defs={propertyDefs} previewProps={valuesById} selfId={p.id} onCreateMissing={createMissing} />
                    ) : (
                      <RollupEditor value={editing.config} onChange={(config) => setEditing({ ...editing, config, error: null })}
                        defs={propertyDefs} savedViews={savedViews} selfId={p.id} />
                    )}
                    {editing.error && <div className={styles.error} role="alert">{editing.error}</div>}
                    <div className={styles.editActions}>
                      <button type="button" className={styles.newPropCreate} onClick={saveEdit}
                        disabled={p.type === 'rollup' && !rollupReady(editing.config)}>Save</button>
                      <button type="button" className={styles.suggestBtn} onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            )
          }
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
          <div className={`${styles.picker} ${isFormula || isRollup ? styles.pickerWide : ''}`}>
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
                  aria-label="Property name"
                  value={newPropName}
                  onChange={(e) => setNewPropName(e.target.value)}
                  autoFocus
                />
                <select
                  className={styles.newPropType}
                  value={newPropType}
                  aria-label="Property type"
                  onChange={(e) => setNewPropType(e.target.value)}
                >
                  {typeChoices.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {isFormula && (
                  <FormulaEditor value={newFormula} onChange={setNewFormula} defs={propertyDefs}
                    previewProps={valuesById} onCreateMissing={createMissing}
                    onStarter={(st) => { if (!newPropName.trim()) setNewPropName(st.name) }} />
                )}
                {isRollup && (
                  <RollupEditor value={newRollup} onChange={setNewRollup} defs={propertyDefs} savedViews={savedViews} />
                )}
                {isChoiceType && (
                  <input
                    type="text"
                    className={styles.newPropInput}
                    placeholder="Options, comma separated (e.g. Low, Medium, High)"
                    value={newPropOptions}
                    onChange={(e) => setNewPropOptions(e.target.value)}
                  />
                )}
                <button type="button" className={styles.newPropCreate} onClick={createAndAdd} disabled={!canCreate}>
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
