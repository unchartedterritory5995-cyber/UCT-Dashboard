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
 *  `{id, name}` and are listed only while wave 9 is on (be router `VOCAB_TOOL_FIELDS`). */
export const VOCAB_FIELDS = Object.freeze(['setup', 'mistake', 'emotion', 'symbol', 'account', 'routine', 'tracker'])

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

/** The kinds whose names a plan's chips need: every ref, and a routine or tracker history filtered by Routine or
 *  Tracker (its values are ids). */
export function kindsNamed(cat, plan) {
  const out = new Set(planRefs(cat, plan).keys())
  for (const f of plan?.filters || []) if (REF_KINDS.includes(f?.field)) out.add(f.field)
  return [...out]
}

/** The name a ref reads by: the member's own name for it, "A removed routine" once their list is known and lacks it,
 *  or the field's label while the list loads. `names` is `{routine: Map, tracker: Map}` of id -> name. */
export function refName(field, ref, names) {
  const kind = refKindOf(field)
  const known = kind && names && names[kind] instanceof Map ? names[kind] : null
  if (known && known.has(String(ref))) return known.get(String(ref))
  if (known) return kind === 'tracker' ? 'A removed tracker' : 'A removed routine'
  return field?.label || ''
}

/**
 * The sources whose rows are routine or tracker days (be plan.TOOL_SOURCES). They take every account
 * (plan.S_TOOL_ACCOUNTS) and no "last N trades" range (plan.S_UNKNOWN_RANGE); the builder hides the one and disables
 * the other. ⚠️ A rule mirrored from the engine: the catalog does not yet say which ranges a source refuses, so a
 * wrong mirror costs the engine's refusal in the preview, never a saved bad widget. The 9.20 merge may serve it.
 * ⚠️ It does not cover be's wave 10 WAVE10_SOURCES (plan.py also refuses `last_*_trades` there); carry-over for 9.20
 * (fix 1, M-6): serve the refused ranges per source and delete this mirror.
 */
export const TOOL_SOURCES = Object.freeze(['routine_history', 'tracker_history'])
export const isToolSource = (plan) => TOOL_SOURCES.includes(plan?.source)
/** plan._LAST_N_TRADES: a range counted in trades. */
export const isTradeCountRange = (range) => isRecord(range) && /^last_\d+_trades$/.test(String(range.token || ''))

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
export const CHECK_TESTS = Object.freeze({
  not_right_now_compare: (c, plan, ctx) => !(c.sources?.includes(plan.source) && (ctx.vtype === 'compare' || !!plan.compare)),
  no_split: (c, plan) => !plan.split,
  has_earlier: (c, plan) => {
    const mode = plan.compare?.mode || 'previous'
    return !(mode === 'previous' && (c.tokens || []).includes(plan.range?.token))
  },
  has_target: (c, plan) => typeof plan.display?.target === 'number' && Number.isFinite(plan.display.target),
  split: (c, plan) => !!plan.split,
  split_in: (c, plan) => !!plan.split && (c.fields || []).includes(plan.split.by),
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
    if (test && !test(c, plan, { vtype })) return reasonOf(cat, c.reason)
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
  return (r.time_fields || []).includes(split.by) ? r.time : r.split
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
  // (fix 1, I-2/M-3): "A removed routine" once their list is known and lacks it, the field's label while it loads.
  if (REF_KINDS.includes(field?.key)) {
    const names = toolNames ? toolNames[field.key] : null
    if (names instanceof Map) {
      if (names.has(String(value))) return names.get(String(value))
      return field.key === 'tracker' ? 'A removed tracker' : 'A removed routine'
    }
    return field.label || String(value)
  }
  return String(value)
}

/** One filter as the sentence its chip reads ("Setup is Flag or VCP", "Hold days is under 2"). */
export function filterSentence(field, filter, opts = {}) {
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

const NOUN = new Map([['trades', 'trades'], ['decisive', 'trades'], ['days', 'days'], ['positions', 'positions']])

/**
 * Coverage per `needs` value, from the last preview: every preview measure that needs a per-row value carries
 * `coverage[i] = {have, total}` (payload.py). Measures that need the same value share it, so a measure not yet
 * picked can still say "R known on 23 of 47 trades" once any R measure has been previewed.
 */
export function coverageByNeed(cat, plan, payload) {
  const out = new Map()
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
  return `${word} known on ${c.have} of ${c.total} ${NOUN.get(c.unit) || 'trades'}`
}
