// Notebook widgets phase 2 (wave 8, Task 8.15): what the builder reads from the catalog
// (`GET /api/j2/widget-definitions/vocabulary`, lib/builtWidgets.js loadCatalog).
//
// ⛔ THE ENGINE OWNS THE RULES. `sources.WidgetCatalog.view_allowed` and `plan.validate_plan` decide what a plan
// may be; the builder only GREYS OUT the choices the engine would refuse, so no invalid combination is reachable by
// clicking (spec 5.2). Every reason shown is the engine's own sentence, read from the catalog's `reasons` (one
// authority for the copy), and the preview still validates every plan on the server: a rule mirrored here wrongly
// costs a refusal sentence in the preview, never a saved bad widget.
//
// ⛔ Member text (setups, tags, symbols, account names) is never used as an object key here: lookups go through
// `Map`, so a setup named "__proto__" is an ordinary string.

// The W10.3 walk fix: a coverage line counts in the source's own served unit ("of 12 notes"), the one noun table.
import { unitWord, emptySentenceOf } from '../widgets/builtViews/builtModel'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Measure themes in the order the picker shows them (spec 5.2). */
export const THEMES = Object.freeze([
  ['results', 'Results'], ['winloss', 'Win/loss'], ['risk', 'Risk'], ['time', 'Time'], ['process', 'Process'],
])

/** Views in the order the thumbnails show them, with their plain names. */
export const VIEW_LABELS = Object.freeze([
  ['number', 'Number'], ['compare', 'Number with comparison'], ['table', 'Table'], ['bar', 'Bar'],
  ['line', 'Line'], ['scatter', 'Scatter'], ['heat', 'Calendar heat map'], ['list', 'List'],
  ['progress', 'Progress bar'],
])

/** A reason the catalog did not send (an older server): still a sentence, never a blank greyed control. */
export const FALLBACK_REASON = "This doesn't fit what you picked."

/** The fields the server lists the member's own values for (`?field=`). `routine` and `tracker` answer
 *  `{id, name}` and are listed only while wave 9 is on (be router `VOCAB_TOOL_FIELDS`). Wave 10 (Task 10.17, be router
 *  `VOCAB_W10_FIELDS`, listed only while wave 10 is on): the options source's `underlying` (text) and `strategy`
 *  (`{id, name}`), the notes source's `folder` and `kind` (`{id, name}`), `tag` and `ticker` (text), and `property`
 *  (`{id, name, type}`: the member's note properties, the first step of a property filter, never a value list). Each
 *  key is the source field's OWN key. */
export const VOCAB_FIELDS = Object.freeze([
  'setup', 'mistake', 'emotion', 'symbol', 'account', 'routine', 'tracker',
  'underlying', 'strategy', 'folder', 'kind', 'tag', 'ticker', 'property',
])

/** The fields whose stored values are ids the member's list names (`{id, name}` rows): a filter's chip reads each by
 *  its name (`valueLabel`), never the id. Routines and trackers are `REF_KINDS`; an account is the `accounts` map. */
export const ID_NAMED_FIELDS = Object.freeze(['strategy', 'folder', 'kind'])

// ── routines and trackers (wave 9, Task 9.17) ────────────────────────────────────────────────────

/** The kinds a field's `refKind` names (be sources.Field.ref_kind). */
export const REF_KINDS = Object.freeze(['routine', 'tracker'])

/** The kind of member tool a field names ("routine" | "tracker"), or null. A filter or split on such a field carries
 *  `ref`, the routine or tracker it reads (plan.py `_check_ref`). */
export const refKindOf = (field) => (field && REF_KINDS.includes(field.refKind) ? field.refKind : null)

/** "Which routine" / "Which tracker". */
export const refQuestion = (kind) => (kind === 'tracker' ? 'Which tracker' : 'Which routine')

/**
 * The routine and the tracker a plan already names, by kind, leaving out the entry being edited (`skip`: `{filter:
 * index}` or `{split: 'by' | 'then'}`). Mirrors plan.py `_ref_entries` + `_one_ref_per_kind`: a filter's `ref`, the
 * split's `ref` (for `by`) and `ref2` (for `then`), each counted only where its field names a kind.
 */
export function planRefs(cat, plan, skip = {}) {
  const fields = sourceOf(cat, plan)?.fields
  const out = new Map()
  const note = (key, ref) => {
    const kind = refKindOf(fields?.get(key))
    if (kind && typeof ref === 'string' && ref && !out.has(kind)) out.set(kind, ref)
  }
  ;(plan?.filters || []).forEach((f, i) => { if (skip.filter !== i) note(f?.field, f?.ref) })
  const sp = plan?.split
  if (sp && skip.split !== 'by') note(sp.by, sp.ref)
  if (sp && skip.split !== 'then') note(sp.then, sp.ref2)
  return out
}

/** The kinds whose names a plan's chips need: every ref, a routine or tracker history filtered by Routine or
 *  Tracker (its values are ids), and (wave 10) a filter on a field whose values are ids (`ID_NAMED_FIELDS`). */
export function kindsNamed(cat, plan) {
  const out = new Set(planRefs(cat, plan).keys())
  for (const f of plan?.filters || []) {
    if (REF_KINDS.includes(f?.field) || ID_NAMED_FIELDS.includes(f?.field)) out.add(f.field)
  }
  return [...out]
}

/** `toolNames[kind]` once the member's list could not be read (ruling W9-R51). */
export const NAMES_FAILED = 'failed'

/** The words an id reads by when its name is not to hand: the ONE place for them. */
export const REF_WORDS = Object.freeze({
  routine: Object.freeze({ removed: 'A removed routine', failed: "A routine that couldn't be loaded" }),
  tracker: Object.freeze({ removed: 'A removed tracker', failed: "A tracker that couldn't be loaded" }),
})

/** The same words for the wave 10 ids (a filter's value, the property a filter or a sum names). */
export const NAME_WORDS = Object.freeze({
  ...REF_WORDS,
  strategy: Object.freeze({ removed: 'A strategy no longer in your Journal', failed: "A strategy that couldn't be loaded" }),
  folder: Object.freeze({ removed: 'A removed folder', failed: "A folder that couldn't be loaded" }),
  kind: Object.freeze({ removed: 'A removed note kind', failed: "A note kind that couldn't be loaded" }),
  property: Object.freeze({ removed: 'A removed property', failed: "A property that couldn't be loaded" }),
})

/** What an id reads as while its list loads. */
export const NAME_LOADING = '…'

/** The name an id of `kind` reads by, from `names[kind]`: the member's own name; "A removed routine" once their list
 *  is known and lacks it; "A routine that couldn't be loaded" when the list failed (W9-R51); `loading` (the field's
 *  label) while it loads. Never the id. */
function nameFor(kind, id, names, loading) {
  const known = names ? names[kind] : undefined
  if (known instanceof Map) return known.has(String(id)) ? known.get(String(id)) : NAME_WORDS[kind].removed
  if (known === NAMES_FAILED) return NAME_WORDS[kind].failed
  return loading
}

// ── note properties (wave 10, Task 10.17) ────────────────────────────────────────────────────────

/**
 * W10-R66: what a filter on each note property type offers is the SERVER's table (be sources.PROPERTY_FILTER_TYPES),
 * served on the catalog's property field (`prop: true`) as `propertyTypes`: type -> `{valueType, ops, label}` (the
 * field type its value picker takes, its comparisons, its words). A type not in it is not offered to filter by. The
 * builder keeps no copy.
 */
export const propertyTypesOf = (field) => (isRecord(field?.propertyTypes) ? field.propertyTypes : {})
export function propertyTypeOf(field, type) {
  const t = propertyTypesOf(field)
  return typeof type === 'string' && Object.hasOwn(t, type) && isRecord(t[type]) ? t[type] : null
}
export const propertyFilterable = (field, type) => propertyTypeOf(field, type) !== null

/** The property types a measure adds up (the catalog's measure row `prop.types`, be plan.PROP_MEASURES and
 *  sources.PROP_SUM_TYPES), or null for a measure that names no property. */
export const propTypesOf = (m) => (isRecord(m?.prop) && Array.isArray(m.prop.types)
  ? m.prop.types.filter((t) => typeof t === 'string') : null)

/** The catalog's property field (`prop: true`) as ONE property: named by it, typed by its type, with that type's
 *  comparisons (only those the catalog field offers), and a select's options as its pick list. `def` is
 *  `{name, type, options?}`; null leaves the field's own label and no type. */
export function propertyFieldFor(field, def) {
  const t = def ? propertyTypeOf(field, def.type) : null
  const served = Array.isArray(field?.ops) ? field.ops : []
  // only comparisons the catalog's own field also offers (fix 1, m-1)
  const ops = t && Array.isArray(t.ops) ? t.ops.filter((o) => served.includes(o)) : []
  const out = { ...field, label: def?.name || field?.label || '', type: t ? t.valueType : null, ops, propertyOf: true }
  delete out.values
  delete out.prop
  delete out.propertyTypes
  if (t && t.valueType === 'enum') {
    out.values = (Array.isArray(def.options) ? def.options : [])
      .filter((o) => isRecord(o) && typeof o.id === 'string')
      .map((o) => ({ value: o.id, label: typeof o.label === 'string' && o.label ? o.label : o.id }))
  }
  return out
}

/** The property a filter or a property sum names, as `names.propertyDefs` knows it (the member's definitions by id;
 *  NAMES_FAILED; undefined while loading): its definition `{name, type, options}`; `{name}` reading "A removed
 *  property" or "A property that couldn't be loaded"; or null while loading. */
export function propertyDefOf(prop, names) {
  const defs = names ? names.propertyDefs : undefined
  if (defs instanceof Map) return defs.get(String(prop)) || { name: NAME_WORDS.property.removed, type: null }
  if (defs === NAMES_FAILED) return { name: NAME_WORDS.property.failed, type: null }
  return null
}

/** Does the plan name a note property (a property filter, a property sum)? Its chips then need the definitions. */
export const planNamesProperty = (plan) => (plan?.filters || []).some((f) => isRecord(f) && typeof f.prop === 'string' && !!f.prop)
  || (plan?.measures || []).some((m) => isRecord(m) && typeof m.prop === 'string' && !!m.prop)

/** The name a ref reads by (see `nameFor`). `names` is `{routine, tracker}`: a Map of id -> name, or NAMES_FAILED. */
export function refName(field, ref, names) {
  const kind = refKindOf(field)
  return kind ? nameFor(kind, ref, names, field?.label || '') : field?.label || ''
}

/**
 * What a source refuses, as the SERVER says it (Task 9.17 concern 2, served at the be->impl merge; the client mirror
 * of plan.TOOL_SOURCES and its "last N trades" regex is gone): each source row carries `refusedRanges` (the range
 * tokens plan.py answers S_UNKNOWN_RANGE for there, `plan.refused_ranges`) and `allAccountsOnly` (plan.S_TOOL_ACCOUNTS:
 * a routine or tracker source covers every account). The builder hides the account choice and disables those ranges.
 * An older server that sends neither refuses nothing here; the engine still refuses with its sentence.
 */
export const refusedRangesOf = (cat, sourceKey) => {
  const r = cat?.sources?.get?.(sourceKey)?.refusedRanges
  return Array.isArray(r) ? r.filter((t) => typeof t === 'string') : []
}
export const rangeRefused = (cat, sourceKey, range) => isRecord(range) && refusedRangesOf(cat, sourceKey).includes(range.token)
export const allAccountsOnly = (cat, sourceKey) => cat?.sources?.get?.(sourceKey)?.allAccountsOnly === true

/** The catalog, indexed. Tolerates a partial answer: every list defaults to empty. */
export function indexCatalog(raw) {
  const c = isRecord(raw) ? raw : {}
  const sources = new Map()
  for (const s of Array.isArray(c.sources) ? c.sources : []) {
    if (!isRecord(s) || typeof s.key !== 'string') continue
    const fields = new Map()
    for (const f of Array.isArray(s.fields) ? s.fields : []) {
      if (isRecord(f) && typeof f.key === 'string') fields.set(f.key, f)
    }
    sources.set(s.key, { ...s, fields, measureKeys: Array.isArray(s.measures) ? s.measures : [] })
  }
  const measures = new Map()
  for (const m of Array.isArray(c.measures) ? c.measures : []) {
    if (isRecord(m) && typeof m.key === 'string') measures.set(m.key, m)
  }
  const ranges = (Array.isArray(c.ranges) ? c.ranges : []).filter((r) => isRecord(r) && typeof r.token === 'string')
  return {
    sources, measures, ranges,
    rangeLabels: new Map(ranges.map((r) => [r.token, r.label])),
    views: Array.isArray(c.views) ? c.views : VIEW_LABELS.map(([k]) => k),
    accents: Array.isArray(c.accents) ? c.accents : [],
    viewRules: isRecord(c.viewRules) ? c.viewRules : null,
    reasons: isRecord(c.reasons) ? c.reasons : {},
    maxMeasures: Number.isInteger(c.maxMeasures) ? c.maxMeasures : 3,
    maxFilters: Number.isInteger(c.maxFilters) ? c.maxFilters : 8,
    topMax: Number.isInteger(c.topMax) ? c.topMax : 40,
    // Wave 10 (Task 10.16): the formats a member's own field can show in (Task 10.9 serves them while wave 10 is on;
    // none: the builder offers no "Your own fields"). Each `{key, label}`.
    formats: (Array.isArray(c.formats) ? c.formats : []).map((f) => (typeof f === 'string' ? { key: f, label: f }
      : isRecord(f) && typeof f.key === 'string' ? { key: f.key, label: typeof f.label === 'string' && f.label ? f.label : f.key }
        : null)).filter(Boolean),
  }
}

export const reasonOf = (cat, key) => (typeof cat?.reasons?.[key] === 'string' && cat.reasons[key]) || FALLBACK_REASON

export const sourceOf = (cat, plan) => cat.sources.get(plan?.source) || null
export const isRightNow = (cat, plan) => sourceOf(cat, plan)?.rightNow === true

/** The measures a source offers, in the catalog's order, each with its catalog row. */
export function measuresFor(cat, sourceKey) {
  const src = cat.sources.get(sourceKey)
  if (!src) return []
  return src.measureKeys.map((k) => cat.measures.get(k)).filter(Boolean)
}

/** The measures a new "What to look at" starts with: Net P&L where it is offered, else the first. */
export function defaultMeasuresFor(cat, sourceKey) {
  const list = measuresFor(cat, sourceKey)
  if (!list.length) return []
  const pnl = list.find((m) => m.key === 'net_pnl')
  return [(pnl || list[0]).key]
}

export const splitFields = (cat, plan) => [...(sourceOf(cat, plan)?.fields.values() || [])].filter((f) => f.split)

/** The range tokens with no period before them ("all time", "last 20 trades"), read from the server's own
 *  `has_earlier` view check (R-12, R-35): never a list typed here. */
export function unboundedTokens(cat) {
  const checks = Array.isArray(cat?.viewRules?.checks) ? cat.viewRules.checks : []
  const c = checks.find((x) => isRecord(x) && x.test === 'has_earlier')
  return Array.isArray(c?.tokens) ? c.tokens : []
}
/** A range with no period before it: R-12. */
export const rangeIsUnbounded = (cat, range) => isRecord(range) && unboundedTokens(cat).includes(range.token)

/** The views a second split ("then by") can show in: validate_plan's own `THEN_VIEWS`, sent as data. */
export const thenViews = (cat) => (Array.isArray(cat?.viewRules?.thenViews) ? cat.viewRules.thenViews : [])
/** A second split can be added: the view is still the suggested one (it then becomes a table) or can show it. */
export const thenAllowed = (cat, plan) => !!plan.view?.auto || thenViews(cat).includes(plan.view?.type)

/**
 * Ruling R-35: the view rules are the SERVER's data (`viewRules` in the vocabulary: sources.VIEW_CHECKS and
 * AUTO_VIEW), and this file only evaluates them, test by test, exactly as `sources.view_check_passes` does. A test
 * name the client does not know answers "allowed" (the server still refuses the plan, with its sentence).
 */
/** The type of a field of the plan's source (`split_in`'s `types`, AUTO_VIEW's `time_types`): sources.py
 *  `_field_type_of`. */
const fieldTypeOf = (ctx, plan, key) => ctx?.cat?.sources?.get?.(plan?.source)?.fields?.get?.(key)?.type ?? null

export const CHECK_TESTS = Object.freeze({
  not_right_now_compare: (c, plan, ctx) => !(c.sources?.includes(plan.source) && (ctx.vtype === 'compare' || !!plan.compare)),
  no_split: (c, plan) => !plan.split,
  has_earlier: (c, plan) => {
    const mode = plan.compare?.mode || 'previous'
    return !(mode === 'previous' && (c.tokens || []).includes(plan.range?.token))
  },
  // A goal target is a target (wave 10: `display.targetGoal`, which plan.py checks).
  has_target: (c, plan) => (typeof plan.display?.target === 'number' && Number.isFinite(plan.display.target))
    || !!plan.display?.targetGoal,
  split: (c, plan) => !!plan.split,
  // A field the check names, or (wave 10) any field of a type it names: the notes source's day fields.
  split_in: (c, plan, ctx) => !!plan.split && ((c.fields || []).includes(plan.split.by)
    || (Array.isArray(c.types) && c.types.length > 0 && c.types.includes(fieldTypeOf(ctx, plan, plan.split.by)))),
  source_in: (c, plan) => (c.sources || []).includes(plan.source),
  no_split_measures: (c, plan) => !plan.split && (plan.measures || []).length === c.measures,
})

/** The reason a view cannot show this plan, or null: the first server check that applies to the view and fails. */
export function viewReason(cat, plan, vtype) {
  // validate_plan refuses a second split outside its views first; then the view checks, in the server's order.
  if (plan.split?.then && !thenViews(cat).includes(vtype)) return reasonOf(cat, 'then_table_only')
  const checks = Array.isArray(cat?.viewRules?.checks) ? cat.viewRules.checks : []
  for (const c of checks) {
    if (!isRecord(c)) continue
    if (Array.isArray(c.views) && !c.views.includes(vtype)) continue
    const test = Object.hasOwn(CHECK_TESTS, c.test) ? CHECK_TESTS[c.test] : null
    if (test && !test(c, plan, { vtype, cat })) return reasonOf(cat, c.reason)
  }
  return null
}

/** The view the shape suggests (`AUTO_VIEW`, sources.auto_view_from). Without rules (an older server) a table,
 *  which shows any shape, and a number for no split. */
export function autoView(cat, plan) {
  const r = isRecord(cat?.viewRules?.auto) ? cat.viewRules.auto : { no_split: 'number', compare: 'number', then: 'table', time: 'table', split: 'table', time_fields: [] }
  const split = plan.split
  if (!split) return plan.compare ? r.compare : r.no_split
  if (split.then) return r.then
  const timed = (r.time_fields || []).includes(split.by)
    || (Array.isArray(r.time_types) && r.time_types.includes(fieldTypeOf({ cat }, plan, split.by)))
  return timed ? r.time : r.split
}

/**
 * The plan with a view that can show it: the suggested one while the member has not chosen one (`auto`), and the
 * suggestion again when a later change makes their choice impossible (a split added under a Number). A compare
 * that no longer applies (the view moved off "Number with comparison", or open positions) is dropped with it.
 */
export function fitView(cat, plan) {
  // A comparison view gets its default comparison FIRST (all time where the range has no period before it), so the
  // view checks judge the comparison the widget will actually make.
  const withDefault = (p) => (p.view?.type === 'compare' && !p.compare
    ? { ...p, compare: { mode: rangeIsUnbounded(cat, p.range) ? 'all' : 'previous' } } : p)
  let next = withDefault({ ...plan, view: plan.view || { type: 'number', auto: true } })
  if (next.view.auto || viewReason(cat, next, next.view.type)) {
    next = withDefault({ ...next, view: { type: autoView(cat, next), auto: true } })
    // The suggestion itself can fail (a comparison against "all time", or of open positions): drop the comparison
    // and suggest again, so the plan always leaves here with a view that can show it.
    if (viewReason(cat, next, next.view.type)) {
      next = { ...next, compare: null }
      next = { ...next, view: { type: autoView(cat, next), auto: true } }
    }
  }
  // Only a comparison view keeps a comparison (and the checks above passed it); every other view compares nothing.
  return next.view.type === 'compare' ? next : { ...next, compare: null }
}

// ── filter sentences ──────────────────────────────────────────────────────────────────────────────

/** Plain names for each comparison, by field type. */
export function opLabel(op, type) {
  const day = type === 'day'
  switch (op) {
    case 'in': return 'is'
    case 'not_in': return 'is not'
    case 'has_any': return 'includes'
    case 'contains': return 'contains'
    case 'is': return 'is'
    case 'eq': return day ? 'is on' : 'is'
    case 'gt': return day ? 'is after' : 'is over'
    case 'gte': return day ? 'is on or after' : 'is at least'
    case 'lt': return day ? 'is before' : 'is under'
    case 'lte': return day ? 'is on or before' : 'is at most'
    case 'between': return day ? 'is from' : 'is between'
    default: return String(op)
  }
}

/** How many values an op takes: 'many' (a pick list), 2 (low and high), or 1. Mirrors plan._check_filter_values. */
export function valueArity(op) {
  if (op === 'between') return 2
  if (op === 'in' || op === 'not_in' || op === 'has_any') return 'many'
  return 1
}

const joinOr = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`)

/** The label a value shows: the catalog's own (a bucket, yes/no), an account's name, or the value itself. */
export function valueLabel(field, value, { accounts, toolNames } = {}) {
  const list = Array.isArray(field?.values) ? field.values : null
  if (list) {
    const hit = list.find((x) => isRecord(x) && x.value === value)
    if (hit && typeof hit.label === 'string') return hit.label
  }
  if (field?.key === 'account' && accounts instanceof Map && accounts.has(String(value))) return accounts.get(String(value))
  // A routine history's Routine, a tracker history's Tracker: the member's own name for the id, never the id
  // (fix 1, I-2/M-3; W9-R51), read exactly as a ref is.
  if (REF_KINDS.includes(field?.key)) return nameFor(field.key, value, toolNames, field.label || '')
  // Wave 10: an options strategy, a folder, a note kind: by the member's name for it, never the id.
  if (ID_NAMED_FIELDS.includes(field?.key)) return nameFor(field.key, value, toolNames, NAME_LOADING)
  if (typeof value === 'boolean' && field?.type === 'bool') return value ? 'Yes' : 'No'
  return String(value)
}

/** One filter as the sentence its chip reads ("Setup is Flag or VCP", "Hold days is under 2"). A note property filter
 *  reads as that property, by its name and its type ("Conviction is at least 3"; `opts.toolNames.propertyDefs`). */
export function filterSentence(field, filter, opts = {}) {
  if (field?.prop === true && typeof filter?.prop === 'string') {
    const one = propertyFieldFor(field, propertyDefOf(filter.prop, opts.toolNames))
    return filterSentence({ ...one, type: one.type || 'text' }, filter, opts)
  }
  // A checkbox property reads "Reviewed is Yes" (a catalog yes/no field's own value labels say it whole).
  if (field?.propertyOf && field.type === 'bool' && filter?.op === 'is') {
    return `${field.label} is ${filter.values?.[0] === false ? 'No' : 'Yes'}`
  }
  // A field that names a routine or tracker reads as that one: "Morning prep is Done".
  const label = refKindOf(field) && filter?.ref ? refName(field, filter.ref, opts.toolNames)
    : field?.label || String(filter?.field || '')
  const values = Array.isArray(filter?.values) ? filter.values : []
  const shown = values.map((v) => valueLabel(field, v, opts))
  if (filter?.op === 'is' && field?.type === 'bool') return shown[0] || label
  if (filter?.op === 'between') return `${label} ${opLabel('between', field?.type)} ${shown[0] ?? ''} ${field?.type === 'day' ? 'to' : 'and'} ${shown[1] ?? ''}`
  if (filter?.op === 'not_in' && shown.length > 1) return `${label} is none of ${shown.join(', ')}`
  return `${label} ${opLabel(filter?.op, field?.type)} ${joinOr(shown)}`
}

/** Is a filter complete enough to apply? `null`, or the engine's reason (catalog `reasons`). */
export function filterProblem(cat, field, filter) {
  const arity = valueArity(filter.op)
  const vals = filter.values || []
  if (arity === 'many' && vals.length === 0) return reasonOf(cat, 'needs_value')
  if (arity === 2) {
    if (vals.length !== 2 || vals.some((v) => v === '' || v === null || v === undefined)) return reasonOf(cat, 'needs_value')
    if (vals[0] > vals[1]) return reasonOf(cat, field?.type === 'day' ? 'start_after_end' : 'low_above_high')
  }
  if (arity === 1 && (vals.length !== 1 || vals[0] === '' || vals[0] === null || vals[0] === undefined)) {
    return reasonOf(cat, 'needs_value')
  }
  if (field?.type === 'number' && vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return reasonOf(cat, 'needs_value')
  }
  return null
}

// ── the range chip ───────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(iso || '')
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The range chip's words ("Last 90 days", "Jan 4, 2026 to Mar 1, 2026"). */
export function rangeText(cat, range) {
  if (isRecord(range) && typeof range.token === 'string') return cap(cat.rangeLabels.get(range.token) || range.token.replace(/_/g, ' '))
  if (isRecord(range) && range.from && range.to) return `${fmtDay(range.from)} to ${fmtDay(range.to)}`
  return 'Last 90 days'
}

// ── coverage ─────────────────────────────────────────────────────────────────────────────────────

/** The words a per-row value is known by ("R known on 23 of 47 trades"). */
const NEEDS_WORDS = new Map([
  ['r', 'R'], ['hold_days', 'Hold time'], ['unrealised', 'Unrealised P&L'], ['risk_dollars', 'Risk to stop'],
  ['days_open', 'Days open'],
])


/**
 * Coverage per `needs` value, from the last preview: every preview measure that needs a per-row value carries
 * `coverage[i] = {have, total}` (payload.py). Measures that need the same value share it, so a measure not yet
 * picked can still say "R known on 23 of 47 trades" once any R measure has been previewed.
 */
export function coverageByNeed(cat, plan, payload) {
  const out = new Map()
  // W11-R84 New-1: an empty preview has no coverage to give ("Days open known on 0 of 0 positions"): none is shown.
  if (emptySentenceOf(payload)) return out
  const cov = Array.isArray(payload?.coverage) ? payload.coverage : []
  const keys = Array.isArray(plan?.measures) ? plan.measures.map((m) => m.key) : []
  keys.forEach((k, i) => {
    const m = cat.measures.get(k)
    const c = cov[i]
    if (!m || !isRecord(c) || typeof c.have !== 'number' || typeof c.total !== 'number') return
    for (const need of Array.isArray(m.needs) ? m.needs : []) out.set(need, { have: c.have, total: c.total, unit: m.unit })
  })
  return out
}

/** "R known on 23 of 47 trades" for a measure, or ''. */
export function coverageText(cat, measure, byNeed) {
  const need = Array.isArray(measure?.needs) ? measure.needs[0] : null
  if (!need || !(byNeed instanceof Map) || !byNeed.has(need)) return ''
  const c = byNeed.get(need)
  const word = NEEDS_WORDS.get(need) || cap(String(need).replace(/_/g, ' '))
  return `${word} known on ${c.have} of ${c.total} ${unitWord(c.unit)}`
}
