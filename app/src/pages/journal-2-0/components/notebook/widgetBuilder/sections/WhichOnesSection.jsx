import { useEffect, useId, useMemo, useState } from 'react'
import UIcon from '../../../../../../components/ui/UIcon'
import Section, { PickerHead } from './Section'
import {
  filterSentence, filterProblem, opLabel, valueArity, valueLabel, rangeText, rangeIsUnbounded, reasonOf,
  isRightNow, sourceOf, VOCAB_FIELDS, refKindOf, refName, refusedRangesOf, REF_KINDS, ID_NAMED_FIELDS,
  propertyFieldFor, propertyFilterable, PROPERTY_TYPE_WORDS,
} from '../builderCatalog'
import { loadVocabulary } from '../../../../lib/builtWidgets'
import { loadPropertyDefs } from '../propertyDefs'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * "Which ones": the date range chip first, then the filter chips (spec 5.2). Each chip is a button NAMED BY ITS
 * SENTENCE ("Setup is Flag or VCP") that opens it for editing, beside its own "Remove filter: <sentence>" button
 * (spec 5.11). Open positions have no range: they are what is open right now (ruling R-17). A filter may be on one of
 * the member's own row fields (wave 10, Task 10.16: `formula:<id>`): the sheet hands this section a catalog whose
 * fields include them (`formulaFields.withFormulaFields`), so its chip, its editor and "+ Filter" treat it as a field.
 */
export default function WhichOnesSection({ cat, plan, accounts, toolNames, onOpenRange, onAddFilter, onEditFilter, onRemoveFilter }) {
  const src = sourceOf(cat, plan)
  const full = plan.filters.length >= cat.maxFilters
  const fullId = useId()
  return (
    <Section id="which" title="Which ones">
      <div className={styles.chipRow}>
        {isRightNow(cat, plan) ? (
          <p className={styles.staticChip}>Right now</p>
        ) : (
          <button type="button" className={styles.chip} onClick={(e) => onOpenRange(e.currentTarget)}
            aria-label={`Date range: ${rangeText(cat, plan.range)}. Change`}>
            <UIcon name="calendar" size={14} gold={false} aria-hidden="true" />
            <span>{rangeText(cat, plan.range)}</span>
          </button>
        )}
      </div>
      {plan.filters.length > 0 && (
        <ul className={styles.filterList}>
          {plan.filters.map((f, i) => {
            const field = src?.fields.get(f.field)
            const sentence = filterSentence(field, f, { accounts, toolNames })
            const badgeId = `${fullId}-b${i}`
            return (
              // Index keys: two filters can read the same; a filter's place in the plan is its identity here.
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className={styles.filterItem}>
                {/* Named by its sentence alone (spec 5.11); the badge is its description. */}
                <button type="button" className={styles.chip} aria-label={sentence}
                  aria-describedby={f.overridable ? badgeId : undefined}
                  onClick={(e) => onEditFilter(i, e.currentTarget)}>
                  <span>{sentence}</span>
                  {f.overridable && <span className={styles.chipBadge} id={badgeId}>Changeable in the note</span>}
                </button>
                <button type="button" className={styles.chipRemove} aria-label={`Remove filter: ${sentence}`}
                  onClick={() => onRemoveFilter(i)}>
                  <UIcon name="x" size={14} gold={false} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className={styles.addBtn} disabled={full} aria-describedby={full ? fullId : undefined}
        onClick={(e) => onAddFilter(e.currentTarget)}>
        <UIcon name="plus" size={14} gold={false} aria-hidden="true" />
        <span>Filter</span>
      </button>
      {full && <p className={styles.reason} id={fullId}>{reasonOf(cat, 'too_many_filters')}</p>}
    </Section>
  )
}

/** The date range picker: every relative range, then "Fixed dates". With "Number with comparison" set to the period
 *  before, a range that has no period before it (all time, the last N trades) is disabled with the engine's own
 *  sentence (ruling R-12). A routine or tracker source counts days, not trades: its "last N trades" ranges are
 *  aria-disabled with the engine's sentence (plan.S_UNKNOWN_RANGE, wave 9). */
export function RangePicker({ cat, plan, onPick, onBack }) {
  const fixed = plan.range && plan.range.from ? plan.range : null
  const [from, setFrom] = useState(fixed?.from || '')
  const [to, setTo] = useState(fixed?.to || '')
  const reasonId = useId()
  const toolReasonId = useId()
  const fixedReasonId = useId()
  const refusedTokens = refusedRangesOf(cat, plan.source)
  const tool = refusedTokens.length > 0
  const previous = plan.view?.type === 'compare' && (plan.compare?.mode || 'previous') === 'previous'
  const noEarlier = reasonOf(cat, 'no_earlier')
  const badSpan = from && to && from > to
  return (
    <div>
      <PickerHead title="Date range" onBack={onBack} />
      <ul className={styles.pickerList} aria-label="Date ranges">
        {cat.ranges.map((r) => {
          const on = plan.range?.token === r.token
          const disabled = previous && rangeIsUnbounded(cat, { token: r.token })
          // ⛔ aria-disabled, never `disabled`, for the tool sources' refusal: it keeps focus, so its reason reads.
          const refused = refusedTokens.includes(r.token)
          const why = [disabled ? reasonId : null, refused ? toolReasonId : null].filter(Boolean).join(' ')
          return (
            <li key={r.token}>
              <button type="button" className={`${styles.option} ${on ? styles.optionOn : ''}`} aria-pressed={on}
                disabled={disabled} aria-disabled={refused || undefined} aria-describedby={why || undefined}
                onClick={() => { if (!refused) onPick({ token: r.token }) }}>
                <span className={styles.optionLabel}>{rangeText(cat, { token: r.token })}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {previous && <p className={styles.reason} id={reasonId}>{noEarlier}</p>}
      {tool && <p className={styles.reason} id={toolReasonId}>{reasonOf(cat, 'unknown_range')}</p>}
      <fieldset className={styles.fieldset}>
        <legend className={styles.fieldLabel}>Fixed dates</legend>
        <div className={styles.pair}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>From</span>
            <input type="date" className={styles.input} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>To</span>
            <input type="date" className={styles.input} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <button type="button" className={styles.btn} disabled={!from || !to || badSpan}
          aria-describedby={badSpan ? fixedReasonId : undefined} onClick={() => onPick({ from, to })}>
          Use these dates
        </button>
        {badSpan && <p className={styles.reason} id={fixedReasonId}>{reasonOf(cat, 'start_after_end')}</p>}
      </fieldset>
    </div>
  )
}

/** "+ Filter", step one: which field. */
export function FieldPicker({ cat, plan, onPick, onBack }) {
  // A split-only field (be `filter: false`, routine history's Item) is never offered here.
  const fields = [...(sourceOf(cat, plan)?.fields.values() || [])].filter((f) => f.filter !== false)
  return (
    <div>
      <PickerHead title="Filter by" onBack={onBack} />
      <ul className={styles.pickerList} aria-label="Fields">
        {fields.map((f) => (
          <li key={f.key}>
            <button type="button" className={styles.option} onClick={() => onPick(f.key)}>
              <span className={styles.optionLabel}>{f.label}</span>
              {f.needsTimes && <span className={styles.optionMeta}>Only trades with entry and exit times</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The fields whose loaded list also names the ids in the builder's chips (`onToolNames`). */
const NAMED_LISTS = Object.freeze([...REF_KINDS, ...ID_NAMED_FIELDS])

/** The member's own values for a field, or the catalog's fixed list, as `[{value, label}]`; null while loading. A note
 *  property filter's field is not a value list: its values are the named property's (`PropertyFilterEditor`). */
function useValueList(field, onToolNames) {
  const fixed = Array.isArray(field?.values) ? field.values : null
  const own = !fixed && !field?.prop && !field?.propertyOf && VOCAB_FIELDS.includes(field?.key)
  const [state, setState] = useState(() => (fixed ? { list: fixed, failed: false } : null))
  useEffect(() => {
    if (fixed || !own) return undefined
    let alive = true
    setState(null)
    // A routine or tracker list is read again on each open (one made in My tools since is listed).
    loadVocabulary(field.key, { fresh: REF_KINDS.includes(field.key) }).then(
      (values) => {
        if (!alive) return
        const fallback = field.key === 'account' ? 'Account' : null
        const list = values.map((v) => (v && typeof v === 'object'
          ? { value: String(v.id), label: typeof v.name === 'string' && v.name ? v.name : fallback || String(v.id) }
          : { value: v, label: String(v) }))
        setState({ list, failed: false })
        // Fix 1, I-2: a routine or tracker list names the ids in every sentence the builder shows (the chips and the
        // live preview line read the same `toolNames`); so does a strategy, folder or note kind list (wave 10).
        if (NAMED_LISTS.includes(field.key)) onToolNames?.(field.key, list.map((o) => ({ id: o.value, name: o.label })))
      },
      () => {
        if (!alive) return
        setState({ list: [], failed: true })
        if (NAMED_LISTS.includes(field.key)) onToolNames?.(field.key, null)     // W9-R51
      },
    )
    return () => { alive = false }
    // onToolNames is the sheet's merge; a new identity must not re-read the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.key, fixed, own])
  if (fixed) return { list: fixed, failed: false, loading: false }
  if (!own) return { list: null, failed: false, loading: false }
  return { list: state?.list || [], failed: !!state?.failed, loading: state === null }
}

/**
 * One filter, new or being edited. A note property filter (the catalog field with `prop: true`, wave 10) is two steps:
 * which property, then its comparison and value (`PropertyFilterEditor`); every other field is one
 * (`FieldFilterEditor`).
 */
export function FilterEditor(props) {
  const field = sourceOf(props.cat, props.plan)?.fields.get(props.fieldKey)
  return field?.prop === true ? <PropertyFilterEditor {...props} field={field} /> : <FieldFilterEditor {...props} />
}

/**
 * Wave 10 (Task 10.17): a filter on one of the member's note properties. Step one, "Which property": the member's own
 * properties by name (`GET /vocabulary?field=property`, the notes source's own rule; read again on each open), of a
 * type a filter can ask (`propertyFilterable`). Step two: the comparison and a value picker typed by the property's
 * type (a number, a date, yes or no, text, a select's options), with "Change property" back to step one. Several
 * property filters may sit in one widget. The definitions read here (names, types, a select's options) are handed to
 * the builder (`onToolNames('propertyDefs', ...)`) so the chips name the property and its value.
 */
export function PropertyFilterEditor(props) {
  const { initial, onBack, onToolNames, field } = props
  const [prop, setProp] = useState(typeof initial?.prop === 'string' && initial.prop ? initial.prop : null)
  const [state, setState] = useState(null)       // null while loading, then {list, defs, failed}
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setState(null)
    Promise.allSettled([loadVocabulary('property', { fresh: true }), loadPropertyDefs()]).then(([v, d]) => {
      if (!alive) return
      const defs = d.status === 'fulfilled' ? d.value : null
      if (defs) onToolNames?.('propertyDefs', defs)
      const list = v.status === 'fulfilled' && Array.isArray(v.value)
        ? v.value.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id)
          .map((x) => ({ id: x.id, name: typeof x.name === 'string' && x.name ? x.name : '', type: x.type }))
          .filter((x) => x.name && propertyFilterable(x.type))
        : []
      setState({ list, defs, failed: v.status !== 'fulfilled' })
    })
    return () => { alive = false }
    // onToolNames is the sheet's merge; a new identity must not re-read the lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const retry = <button type="button" className={styles.btn} onClick={() => setTick((n) => n + 1)}>Try again</button>
  if (!prop) {
    return (
      <div>
        <PickerHead title="Which property" onBack={onBack} />
        {state === null && <p className={styles.sectionHint} role="status">Loading your properties…</p>}
        {state?.failed && <div><p className={styles.reason} role="alert">{"Couldn't load your properties."}</p>{retry}</div>}
        {state && !state.failed && state.list.length === 0 && (
          <p className={styles.sectionHint}>{"You don't have a note property to filter by yet."}</p>
        )}
        {state && state.list.length > 0 && (
          <ul className={styles.pickerList} aria-label="Properties">
            {state.list.map((x) => (
              <li key={x.id}>
                <button type="button" className={styles.option} onClick={() => setProp(x.id)}>
                  <span className={styles.optionLabel}>{x.name}</span>
                  <span className={styles.optionMeta}>{PROPERTY_TYPE_WORDS[x.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  // The named property's own definition (its select options); else its row in the pick list (no options needed).
  const row = state?.list.find((x) => x.id === prop) || null
  const def = state?.defs?.get(prop) || (row ? { name: row.name, type: row.type, options: [] } : null)
  const needsOptions = def?.type === 'select' || def?.type === 'multi_select'
  if (state === null || !def || !propertyFilterable(def.type) || (needsOptions && !state.defs)) {
    return (
      <div>
        <PickerHead title={def?.name || field.label} onBack={onBack} />
        {state === null && <p className={styles.sectionHint} role="status">Loading your properties…</p>}
        {state && (!state.defs || !def) && (
          <div><p className={styles.reason} role="alert">{"Couldn't load this property."}</p>{retry}</div>
        )}
        {state && def && state.defs && !propertyFilterable(def.type) && (
          <p className={styles.reason}>{"This property can't be used to filter a widget."}</p>
        )}
        <button type="button" className={styles.btn} onClick={() => setProp(null)}>Change property</button>
      </div>
    )
  }
  // A filter on another property keeps none of this one's comparison or values.
  const same = initial && initial.prop === prop
  const start = initial ? { ...initial, ...(same ? {} : { op: undefined, values: [] }) } : undefined
  return (
    <FieldFilterEditor key={prop} {...props} initial={start} draft={undefined} field={propertyFieldFor(field, def)}
      prop={prop} onChangeProp={() => setProp(null)} />
  )
}

/**
 * One filter, new or being edited: its comparison, its values, and whether a note may change it. Values come from a
 * list wherever one exists (the member's own setups, tags, symbols and accounts; a field's fixed buckets), never a
 * blank text box where a list exists (spec 5.2). `field` (a note property as one field, wave 10) replaces the
 * catalog's, and the filter carries `prop`.
 */
function FieldFilterEditor({
  cat, plan, fieldKey, initial, draft, refValue, accounts, toolNames, onApply, onRemove, onBack, onChangeRef, onToolNames,
  field: given = null, prop = null, onChangeProp,
}) {
  const field = given || sourceOf(cat, plan)?.fields.get(fieldKey)
  // Wave 9: a field that names a routine or tracker carries which one (picked in the step before, or the filter's).
  const refKind = refKindOf(field)
  const ref = refKind ? (refValue ?? initial?.ref ?? null) : null
  const ops = Array.isArray(field?.ops) && field.ops.length ? field.ops : ['in']
  // Fix 1, M-5: back from "Change routine", the editor starts from what was picked before (`draft`), keeping every
  // value the new routine or tracker can still have (a fixed list keeps only its own values).
  const start = draft || initial
  const keepable = (vs) => {
    const list = Array.isArray(field?.values) ? field.values.map((x) => x?.value) : null
    return list ? vs.filter((v) => list.includes(v)) : vs
  }
  const [op, setOp] = useState(start?.op && ops.includes(start.op) ? start.op : ops[0])
  const [values, setValues] = useState(Array.isArray(start?.values) ? keepable(start.values) : [])
  const [overridable, setOverridable] = useState(start?.overridable === true)
  const [query, setQuery] = useState('')
  const [typed, setTyped] = useState('')
  const opId = useId()
  const problemId = useId()
  const overId = useId()
  const listState = useValueList(field, onToolNames)
  const arity = valueArity(op)
  const type = field?.type
  // Only one filter may be changed from the note (plan.py MAX_OVERRIDABLE): another one already is.
  const otherOver = plan.filters.some((f, i) => f.overridable && (initial?.index === undefined || i !== initial.index))
  // A number box holds what was typed ("1.", "-"); the filter holds numbers, and an unfinished one is caught by
  // filterProblem rather than shown as NaN.
  const clean = type === 'number' ? values.map((v) => (v === '' || v === null || v === undefined ? '' : Number(v))) : values
  const filter = { field: fieldKey, op, values: clean, overridable, ...(ref ? { ref } : {}), ...(prop ? { prop } : {}) }
  const problem = filterProblem(cat, field, filter)
  const shown = useMemo(() => {
    const list = listState.list || []
    const q = query.trim().toLowerCase()
    return q ? list.filter((x) => String(x.label).toLowerCase().includes(q)) : list
  }, [listState.list, query])

  if (!field) return null
  const setOpTo = (next) => {
    setOp(next)
    const a = valueArity(next)
    // Keep what still fits the new comparison: a list stays a list, a pair keeps its two, one keeps its first.
    setValues((vs) => (a === 'many' ? vs : vs.slice(0, a)))
  }
  const toggle = (v) => setValues((vs) => (vs.includes(v) ? vs.filter((x) => x !== v) : [...vs, v]))
  const pick = (v) => setValues((vs) => (arity === 'many' ? (vs.includes(v) ? vs : [...vs, v]) : [v]))
  const addTyped = () => {
    const t = typed.trim()
    if (!t) return
    pick(t)
    setTyped('')
  }
  const sentence = filterSentence(field, filter, { accounts, toolNames })
  // What the filter is about: the routine or tracker it names (W9-R51 wording when the list failed), else the field.
  const subject = ref ? refName(field, ref, toolNames) : field.label

  let body
  if (type === 'bool') {
    const opts = Array.isArray(field.values) ? field.values : [{ value: true, label: 'Yes' }, { value: false, label: 'No' }]
    body = (
      <div role="radiogroup" aria-label={field.label} className={styles.optionGrid}>
        {opts.map((o) => (
          <label key={String(o.value)} className={`${styles.option} ${values[0] === o.value ? styles.optionOn : ''}`}>
            <input type="radio" className={styles.srOnlyInput} name={opId} checked={values[0] === o.value}
              onChange={() => setValues([o.value])} />
            <span className={styles.optionLabel}>{o.label}</span>
          </label>
        ))}
      </div>
    )
  } else if (type === 'number' || type === 'day') {
    const kind = type === 'day' ? 'date' : 'number'
    const set = (i, raw) => setValues((vs) => {
      const next = [...vs]
      next[i] = raw
      return next.slice(0, arity === 2 ? 2 : 1)
    })
    body = (
      <div className={styles.pair}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{arity === 2 ? (kind === 'date' ? 'From' : 'Low') : 'Value'}</span>
          <input type={kind} inputMode={kind === 'number' ? 'decimal' : undefined} className={styles.input}
            value={values[0] ?? ''} onChange={(e) => set(0, e.target.value)} />
        </label>
        {arity === 2 && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{kind === 'date' ? 'To' : 'High'}</span>
            <input type={kind} inputMode={kind === 'number' ? 'decimal' : undefined} className={styles.input}
              value={values[1] ?? ''} onChange={(e) => set(1, e.target.value)} />
          </label>
        )}
      </div>
    )
  } else if (listState.list && op !== 'contains') {
    body = (
      <div>
        {listState.list.length > 8 && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Search</span>
            <input type="search" className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
        {listState.loading && <p className={styles.sectionHint}>Loading your values…</p>}
        {listState.failed && <p className={styles.reason}>{"Couldn't load your values. Type one instead."}</p>}
        {!listState.loading && !listState.failed && listState.list.length === 0 && (
          <p className={styles.sectionHint}>Nothing to pick from yet.</p>
        )}
        <ul className={styles.pickerList} aria-label={`${field.label} values`}>
          {shown.map((o) => {
            const on = values.includes(o.value)
            return (
              <li key={String(o.value)}>
                <button type="button" className={`${styles.option} ${on ? styles.optionOn : ''}`} aria-pressed={on}
                  onClick={() => (arity === 'many' ? toggle(o.value) : setValues([o.value]))}>
                  <span className={styles.optionLabel}>{o.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {listState.failed && (
          <TypedValue typed={typed} setTyped={setTyped} onAdd={addTyped} label={field.label} />
        )}
      </div>
    )
  } else {
    // A typed value only where the values are genuinely open (a symbol "contains"), or the list could not load;
    // a month is picked with the browser's month picker (fix 1, I-8).
    body = (
      <div>
        {field.input === 'month'
          ? <TypedValue typed={typed} setTyped={setTyped} onAdd={addTyped} label={field.label} type="month"
            title={`Pick a ${field.label.toLowerCase()}`} />
          : <TypedValue typed={typed} setTyped={setTyped} onAdd={addTyped} label={field.label} />}
        {values.length > 0 && (
          <ul className={styles.filterList} aria-label="Values">
            {values.map((v) => (
              <li key={String(v)} className={styles.filterItem}>
                <span className={styles.staticChip}>{valueLabel(field, v, { accounts, toolNames })}</span>
                <button type="button" className={styles.chipRemove}
                  aria-label={`Remove ${valueLabel(field, v, { accounts, toolNames })}`}
                  onClick={() => setValues((vs) => vs.filter((x) => x !== v))}>
                  <UIcon name="x" size={14} gold={false} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div>
      <PickerHead title={subject} onBack={onBack} />
      {ref && onChangeRef && (
        <button type="button" className={styles.btn} onClick={() => onChangeRef({ op, values, overridable })}>
          {refKind === 'tracker' ? 'Change tracker' : 'Change routine'}
        </button>
      )}
      {prop && onChangeProp && (
        <button type="button" className={styles.btn} onClick={onChangeProp}>Change property</button>
      )}
      {ops.length > 1 && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={opId}>Comparison</label>
          <select id={opId} className={styles.select} value={op} onChange={(e) => setOpTo(e.target.value)}>
            {ops.map((o) => <option key={o} value={o}>{`${subject} ${opLabel(o, type)}`}</option>)}
          </select>
        </div>
      )}
      {body}
      <label className={styles.check}>
        <input type="checkbox" checked={overridable} disabled={otherOver && !overridable}
          aria-describedby={otherOver && !overridable ? overId : undefined}
          onChange={(e) => setOverridable(e.target.checked)} />
        <span>Let each note change this filter</span>
      </label>
      {otherOver && !overridable && <p className={styles.reason} id={overId}>{reasonOf(cat, 'one_overridable')}</p>}
      <p className={styles.filterPreview}>{problem ? '' : sentence}</p>
      <div className={styles.pickerActions}>
        <button type="button" className={styles.btnPrimary} disabled={!!problem}
          aria-describedby={problem ? problemId : undefined} onClick={() => onApply(filter)}>
          {initial?.index === undefined ? 'Add filter' : 'Update filter'}
        </button>
        {initial?.index !== undefined && (
          <button type="button" className={styles.btn} onClick={onRemove}>Remove filter</button>
        )}
      </div>
      {problem && <p className={styles.reason} id={problemId}>{problem}</p>}
    </div>
  )
}

/** "Setup" -> "setup", but an acronym keeps its case ("ET hour", "R bucket"): the server's own _lower_first. */
export function lowerFirst(s) {
  const t = String(s || '')
  return t.length >= 2 && t[0] === t[0].toUpperCase() && t[1] !== t[1].toUpperCase() ? t[0].toLowerCase() + t.slice(1) : t
}

/** "a" or "an" before a word, by its SOUND: "an emotion", "a setup", and for an acronym the letter's name
 *  ("an ET hour", "an R bucket", "a P&L"). */
export function article(word) {
  const w = String(word || '').trim()
  const acronym = /^[A-Z](?:[A-Z&]|\b|$)/.test(w)
  if (acronym) return 'AEFHILMNORSX'.includes(w[0]) ? 'an' : 'a'
  return /^[aeiou]/i.test(w) ? 'an' : 'a'
}

/** "Type a setup", "Type an ET hour". */
export const typePrompt = (label) => `Type ${article(lowerFirst(label))} ${lowerFirst(label)}`

function TypedValue({ typed, setTyped, onAdd, label, type = 'text', title }) {
  const id = useId()
  return (
    <div className={styles.typed}>
      <label className={styles.fieldLabel} htmlFor={id}>{title || typePrompt(label)}</label>
      <div className={styles.typedRow}>
        <input id={id} type={type} className={styles.input} value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }} />
        <button type="button" className={styles.btn} onClick={onAdd} disabled={!typed.trim()}>Add</button>
      </div>
    </div>
  )
}
