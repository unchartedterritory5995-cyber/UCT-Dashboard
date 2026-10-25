// Notebook widgets phase 2 (wave 10, Task 10.16): "Your own fields" — what the builder knows about a plan's formulas.
//
// ⛔ THE SERVER OWNS THE RULES (be `widget_engine/plan.py`, `_compile_formulas`, `_check_measure`, the filter and
// split checks). This file mirrors them only so the builder offers what the server would accept and says why at
// once, without a request. Every sentence here is the server's (copied verbatim, each naming its constant) or the
// dialect's (`lib/widgetFormula`, bound to the server by the shared vector file); the one exception is the builder's
// own cap sentence, `S_FIELD_CAP`, in member words.
//
// ⛔ LAZY. Only the builder's chunk imports this (it imports the formula twin). Nothing eager may.
//
// ⛔ Member text (field names, formula names) is never an object key: everything groups with `Map`.
import { countNoun } from '../widgets/builtViews/builtModel'
import { propTypesOf, propertyDefOf } from './builderCatalog'
import {
  LIMITS, ERRORS, compileFormula, displayFormula, formulaNameCharsOk, codePointToUtf16,
} from '../../../lib/widgetFormula/widgetFormula'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** plan.FORMULA_PREFIX: a filter or split on a row formula names it `formula:<id>`. */
export const FORMULA_PREFIX = 'formula:'
/** plan._FORMULA_ID_RE: formula ids are f1 to f5. */
export const FORMULA_IDS = Object.freeze(['f1', 'f2', 'f3', 'f4', 'f5'])
export const MAX_FIELDS = LIMITS.MAX_FORMULAS
/** plan.PROPERTY_FIELD: the note-property field needs `prop`, so a formula cannot read it. */
export const PROPERTY_FIELD = 'property'

/** The builder's own sentence at the cap (Task 10.16 brief; the server's S_TOO_MANY_FORMULAS names an engine noun). */
export const S_FIELD_CAP = 'Use up to 5 of your own fields.'
// The server's sentences, verbatim (be widget_engine/plan.py; `formulaFields.serverCopy.test.js` binds them to the
// server's file once the backend merge lands it in this tree).
export const S_FORMULA_NAME = 'Give the field a name.'
export const S_FORMULA_NAME_LONG = 'A field name can be at most 60 characters.'
export const S_FORMULA_NAME_TAKEN = 'That name is already used.'
export const S_BAD_CHARACTER = "This widget has a character that can't be saved. Remove it and try again."
/** plan.S_GOAL_SOURCE (be 10.4 fix round 1, M2; ratified in W10-R47): Net P&L picked on data a goal does not follow. */
export const S_GOAL_SOURCE = 'A goal target works on closed trades or trading days.'

/** plan.ROW_AGGS / BOOL_AGGS, with the words the builder offers (Task 10.16 brief) and the words `summary()` uses
 *  (plan.AGG_WORDS) in a measure's name. */
export const ROW_AGGS = Object.freeze(['sum', 'avg', 'min', 'max'])
export const BOOL_AGGS = Object.freeze(['count', 'share'])
export const AGG_OFFER = new Map([
  ['sum', 'Total'], ['avg', 'Average'], ['min', 'Lowest'], ['max', 'Highest'], ['count', 'How many'], ['share', 'What share'],
])
export const AGG_WORDS = new Map([
  ['sum', 'total'], ['avg', 'average'], ['min', 'lowest'], ['max', 'highest'], ['count', 'how many'], ['share', 'share'],
])

/** plan.OPS_ENUM / OPS_NUMBER / OPS_BOOL: a row formula filters by its result type (plan._FORMULA_OPS). */
const FORMULA_OPS = new Map([
  ['text', Object.freeze(['in', 'not_in'])],
  ['number', Object.freeze(['eq', 'gt', 'gte', 'lt', 'lte', 'between'])],
  ['bool', Object.freeze(['is'])],
])
/** plan._FORMULA_TYPES: a catalog field type as the dialect knows it (an enum reads as text). */
const FORMULA_TYPES = new Map([['number', 'number'], ['text', 'text'], ['enum', 'text'], ['bool', 'bool'], ['day', 'day'], ['tag', 'tag']])

/** ASCII case fold, the dialect's and the server's (`plan._fold`): only A-Z fold. */
export const fold = (s) => String(s).replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32))

/** Python's `str.strip()` (plan.py trims a formula name with it): the code points `str.isspace()` answers true for,
 *  from both ends. Not `String.prototype.trim`, which also strips U+FEFF and keeps U+001C-001F and U+0085. */
const PY_SPACE = new Set([
  0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x1C, 0x1D, 0x1E, 0x1F, 0x20, 0x85, 0xA0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
  0x2028, 0x2029, 0x202F, 0x205F, 0x3000,
])
export function pyStrip(s) {
  const cps = Array.from(typeof s === 'string' ? s : '')
  let i = 0
  let j = cps.length
  while (i < j && PY_SPACE.has(cps[i].codePointAt(0))) i += 1
  while (j > i && PY_SPACE.has(cps[j - 1].codePointAt(0))) j -= 1
  return cps.slice(i, j).join('')
}

const labelOf = (f, key) => (typeof f?.label === 'string' && f.label ? f.label : key.replace(/_/g, ' '))

/**
 * Every field a formula may name on the plan's source, as the dialect's field table (`plan.formula_field_infos`):
 * key -> {key, label, type, hourKey, needsTimes}. Filterable fields only, of a type the dialect knows (an enum is text),
 * never one that needs a routine or tracker (`refKind`) nor the note-property field. `hourKey` and `needsTimes` come
 * from the catalog (Task 10.9 serves them; absent, a day field has no hour and nothing needs times).
 */
export function catalogFields(cat, plan) {
  const out = new Map()
  const fields = cat?.sources?.get?.(plan?.source)?.fields
  if (!(fields instanceof Map)) return out
  for (const [key, f] of fields) {
    if (typeof key !== 'string' || key.startsWith(FORMULA_PREFIX)) continue
    const type = FORMULA_TYPES.get(f?.type)
    if (!type || f?.filter === false || f?.refKind || key === PROPERTY_FIELD) continue
    out.set(key, {
      key, label: labelOf(f, key), type,
      hourKey: typeof f.hourKey === 'string' && f.hourKey ? f.hourKey : null,
      needsTimes: f.needsTimes === true,
    })
  }
  return out
}

/** The plan's formula entries, in order (each `{id, name, expr, format}`). */
export const formulasOf = (plan) => (Array.isArray(plan?.formulas) ? plan.formulas.filter(isRecord) : [])
export const formulaOf = (plan, id) => formulasOf(plan).find((f) => f.id === id) || null
/** The lowest free formula id, or null at the cap. */
export function nextFormulaId(plan) {
  const used = new Set(formulasOf(plan).map((f) => f.id))
  return FORMULA_IDS.find((id) => !used.has(id)) || null
}

/**
 * Compile `expr` as the server stores it: the dialect's answer, then the STORED (canonical) form's length (be 10.4
 * fix round 1, I-2): a formula typed under the limit can be stored over it, because a key can be longer than its
 * label (`[Risk $]` -> `[risk_dollars]`). Refused exactly as the server refuses it: `too_long` at MAX_LENGTH.
 * Never throws: `{ok: true, compiled}` or `{ok: false, code, sentence, pos}`.
 */
export function compileStored(expr, fields) {
  const r = compileFormula(expr, fields)
  if (!r.ok) return r
  if (Array.from(r.compiled.canonical).length > LIMITS.MAX_LENGTH) {
    return { ok: false, code: 'too_long', sentence: ERRORS.too_long, pos: LIMITS.MAX_LENGTH }
  }
  return r
}

/** The text the Formula box shows for a stored expression: label syntax (`displayFormula`). */
export const displayOf = (expr, fields) => displayFormula(typeof expr === 'string' ? expr : '', fields)

/** What a settled box stores: the canonical form when the dialect accepts it, else the text as typed (so the plan says
 *  what the box says, and the server refuses it with its own sentence). */
export function storedOf(text, fields) {
  const r = compileStored(text, fields)
  return r.ok ? r.compiled.canonical : text
}

/**
 * A formula name's problem, the server's order (`_compile_formulas`): blank -> S_FORMULA_NAME; a character the member
 * cannot see (bar an emoji's parts, W10-R47) -> S_BAD_CHARACTER; over 60 code points -> S_FORMULA_NAME_LONG; equal
 * (ASCII-folded) to a field label of the source or to an EARLIER formula's name -> S_FORMULA_NAME_TAKEN. Null when it
 * is fine.
 */
export function nameProblem(cat, plan, id) {
  const list = formulasOf(plan)
  const at = list.findIndex((f) => f.id === id)
  if (at < 0) return null
  const name = pyStrip(list[at].name)
  if (!name) return S_FORMULA_NAME
  if (!formulaNameCharsOk(name)) return S_BAD_CHARACTER
  if (Array.from(name).length > LIMITS.NAME_MAX) return S_FORMULA_NAME_LONG
  const taken = new Set()
  const fields = cat?.sources?.get?.(plan?.source)?.fields
  if (fields instanceof Map) {
    for (const [key, f] of fields) if (!String(key).startsWith(FORMULA_PREFIX)) taken.add(fold(labelOf(f, key)))
  }
  for (const f of list.slice(0, at)) taken.add(fold(pyStrip(f.name)))
  return taken.has(fold(name)) ? S_FORMULA_NAME_TAKEN : null
}

/** Each formula compiled against the source's fields: id -> the `compileStored` answer. */
export function compiledOf(cat, plan) {
  const fields = catalogFields(cat, plan)
  const out = new Map()
  for (const f of formulasOf(plan)) out.set(f.id, compileStored(f.expr, fields))
  return out
}

/** The formulas the server would refuse (by the dialect, or by their name): id -> sentence. While any is refused the
 *  builder runs no preview (the twin already answered, without a request). */
export function formulaProblems(cat, plan, compiled = compiledOf(cat, plan)) {
  const out = new Map()
  for (const f of formulasOf(plan)) {
    const r = compiled.get(f.id)
    const n = nameProblem(cat, plan, f.id)
    if (n) out.set(f.id, n)
    else if (r && !r.ok) out.set(f.id, r.sentence)
  }
  return out
}

const okCompiled = (compiled, id) => {
  const r = compiled instanceof Map ? compiled.get(id) : null
  return r && r.ok ? r.compiled : null
}
const shownName = (f) => pyStrip(f.name) || f.id

/** A formula measure's words, the server's `_measure_label`: "Exit efficiency (average)", or the name alone for a
 *  formula that adds up rows. */
export function formulaMeasureLabel(plan, m) {
  const f = formulaOf(plan, m?.formula)
  const name = f ? shownName(f) : String(m?.formula || '')
  return AGG_WORDS.has(m?.agg) ? `${name} (${AGG_WORDS.get(m.agg)})` : name
}

/** One measure's words: the catalog's label, or a formula measure's own. A property sum (wave 10) names its property
 *  ("Sum of a property: Conviction") once `names.propertyDefs` knows it. */
export function measureLabel(cat, plan, m, names) {
  if (isRecord(m) && typeof m.formula === 'string') return formulaMeasureLabel(plan, m)
  const row = cat?.measures?.get?.(m?.key)
  const label = row?.label || m?.key || ''
  if (isRecord(m) && propTypesOf(row) && typeof m.prop === 'string') {
    const def = propertyDefOf(m.prop, names)
    if (def?.name) return `${label}: ${def.name}`
  }
  return label
}

/** A stable identity for a measure (a list key, a comparison): `net_pnl`, `formula:f1:avg`, `property_sum:<prop>`. */
export const measureId = (m) => {
  if (isRecord(m) && typeof m.formula === 'string') return `${FORMULA_PREFIX}${m.formula}:${m.agg || ''}`
  if (isRecord(m) && typeof m.prop === 'string' && m.prop) return `${String(m.key || '')}:${m.prop}`
  return String(m?.key || '')
}

/**
 * What a formula can be added as a measure (`_check_measure`): a row number formula by Total, Average, Lowest or
 * Highest; a row yes/no formula by How many or What share; a formula that adds up rows as itself; a text formula not
 * at all. Each `{formula, agg?, offer, label}`; `offer` is the button's words.
 */
export function formulaMeasureOptions(plan, compiled) {
  const out = []
  for (const f of formulasOf(plan)) {
    const c = okCompiled(compiled, f.id)
    if (!c) continue
    if (c.kind === 'aggregate') {
      out.push({ formula: f.id, offer: 'Add as a measure', label: formulaMeasureLabel(plan, { formula: f.id }) })
      continue
    }
    const aggs = c.type === 'number' ? ROW_AGGS : c.type === 'bool' ? BOOL_AGGS : []
    for (const agg of aggs) {
      out.push({ formula: f.id, agg, offer: AGG_OFFER.get(agg), label: formulaMeasureLabel(plan, { formula: f.id, agg }) })
    }
  }
  return out
}

const YES_NO = Object.freeze([Object.freeze({ value: true, label: 'Yes' }), Object.freeze({ value: false, label: 'No' })])

function formulaField(f, c, split) {
  return {
    key: `${FORMULA_PREFIX}${f.id}`, label: shownName(f), type: c.type, ops: FORMULA_OPS.get(c.type),
    split, filter: true, formula: f.id, ...(c.type === 'bool' ? { values: YES_NO } : {}),
  }
}

/** The formulas a widget can split by: row formulas giving text or yes/no (a number splits through Bucket,
 *  S_FORMULA_SPLIT_NUMBER; a formula that adds up rows never splits, S_FORMULA_AGG_SPLIT). Catalog-shaped fields. */
export function formulaSplitFields(plan, compiled) {
  return formulasOf(plan).map((f) => [f, okCompiled(compiled, f.id)])
    .filter(([, c]) => c && c.kind === 'row' && (c.type === 'text' || c.type === 'bool'))
    .map(([f, c]) => formulaField(f, c, true))
}

/** The formulas a widget can filter by: every row formula, compared by its result type. Catalog-shaped fields. */
export function formulaFilterFields(plan, compiled) {
  return formulasOf(plan).map((f) => [f, okCompiled(compiled, f.id)])
    .filter(([, c]) => c && c.kind === 'row')
    .map(([f, c]) => formulaField(f, c, c.type === 'text' || c.type === 'bool'))
}

/** The catalog as the sections read it for this plan: the source's fields followed by the plan's row formulas (each
 *  `formula:<id>`), so "Which ones" and "Split it by" list, edit and name them like any field. The formulas
 *  themselves always compile against the plain catalog (`catalogFields`): a formula never names another. */
export function withFormulaFields(cat, plan, compiled) {
  const src = cat?.sources?.get?.(plan?.source)
  const extra = formulaFilterFields(plan, compiled)
  if (!src || !extra.length) return cat
  const fields = new Map(src.fields)
  for (const f of extra) fields.set(f.key, f)
  const sources = new Map(cat.sources)
  sources.set(plan.source, { ...src, fields })
  return { ...cat, sources }
}

/** A plan's references to formula `id`, dropped (its removal): its measures, a split by it, filters on it. */
export function withoutFormulaRefs(plan, id) {
  const key = `${FORMULA_PREFIX}${id}`
  const measures = (plan.measures || []).filter((m) => m?.formula !== id)
  const filters = (plan.filters || []).filter((f) => f?.field !== key)
  let split = plan.split || null
  // The first split gone, the split goes (as "Remove split" does); the second alone leaves the first.
  if (split && split.by === key) split = null
  else if (split && split.then === key) {
    split = { ...split, then: null }
    delete split.ref2
  }
  return { measures, filters, split }
}

/** The first-row line under a valid formula, from the preview's `probe` (be aggregate._formula_notes): "First trade:
 *  0.42"; for a formula that adds up rows, its value over every counted row. The noun is the source's own unit, from
 *  the ONE noun table (`builtModel.countNoun`). No value is no line ('' ): the server's skip notice says why. */
export function probeValueText(value, format) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' && Number.isFinite(value)) {
    const plain = value.toLocaleString('en-US', { maximumFractionDigits: 4 })
    if (format === 'money') {
      const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      return `${value < 0 ? '-' : ''}$${abs}`
    }
    if (format === 'percent') return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
    if (format === 'r') return `${plain}R`
    return plain
  }
  return String(value)
}
export function probeLine(probe, { kind, format, unit }) {
  if (!isRecord(probe)) return ''
  const shown = probeValueText(probe.first, format)
  if (!shown) return ''
  if (kind === 'aggregate') return `All ${countNoun(unit, 2)}: ${shown}`
  return `First ${countNoun(unit, 1)}: ${shown}`
}

/**
 * A server error's position, read in the Formula box (UTF-16, as `setSelectionRange` wants). The server counts code
 * points into the text it was SENT; when that was the canonical form the box shows its label syntax, so the position
 * is carried across by displaying the prefix before it (a field token never straddles an error's start).
 */
export function boxPosOf(sent, pos, box, fields) {
  if (!Number.isInteger(pos) || typeof sent !== 'string' || typeof box !== 'string') return null
  if (sent === box) return codePointToUtf16(box, pos)
  const prefix = Array.from(sent).slice(0, pos).join('')
  return codePointToUtf16(box, Array.from(displayFormula(prefix, fields)).length)
}
