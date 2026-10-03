/**
 * Wave 11 (lane 11B): the client half of formula and rollup properties —
 * evaluating a formula for the live preview, the trader starter formulas, and
 * how a computed value reads on screen.
 *
 * ⛔ A computed value is NEVER shown as NaN or Infinity: an empty value renders
 * as an em dash and carries its reason (a hover title AND screen-reader text).
 * ⛔ The server is the authority for a saved value; this module only previews.
 */
import { FormulaError, FormulaEvalError, evaluate, parse, refsOf, toDisplay, toStored } from './formulaEngine'

export const ROLLUP_SOURCES = [
  { value: 'links_from_this', label: 'Notes this note links to' },
  { value: 'links_to_this', label: 'Notes that link to this note' },
  { value: 'saved_view', label: 'Notes in a saved view' },
  { value: 'trades', label: 'Trades linked to this note' },
]
export const ROLLUP_AGGREGATES = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'win_rate', label: 'Win rate' },
]
export const TRADE_FIELDS = [
  { value: 'r_multiple', label: 'R multiple' },
  { value: 'pnl_dollar', label: 'P&L ($)' },
  { value: 'pnl_percent', label: 'P&L (%)' },
  { value: 'result', label: 'Result (Win / Loss / BE)' },
]
export const TRADE_RESULTS = ['Win', 'Loss', 'BE']

/**
 * The trader starter formulas. `needs` are the number properties each one reads,
 * by name; the editor offers to create any that do not exist yet.
 * ⭐ ONE R-multiple covers longs AND shorts: for a short the stop sits ABOVE the
 * entry, so (entry - stop) is negative and so is (exit - entry) on a winner —
 * the signs cancel. (100 entry, 105 stop, 90 exit -> -10 / -5 = 2R.)
 */
export const STARTER_FORMULAS = [
  {
    id: 'r_multiple', name: 'R-multiple',
    expression: '({Exit} - {Entry}) / ({Entry} - {Stop})',
    needs: ['Entry', 'Stop', 'Exit'],
    hint: 'Long or short: a stop above the entry is read as a short.',
  },
  {
    id: 'risk_per_share', name: 'Risk per share',
    expression: 'abs({Entry} - {Stop})',
    needs: ['Entry', 'Stop'],
    hint: 'Dollars at risk on each share.',
  },
  {
    id: 'position_size', name: 'Position size',
    expression: 'round({Account risk} / abs({Entry} - {Stop}), 0)',
    needs: ['Account risk', 'Entry', 'Stop'],
    hint: 'Shares to buy: the dollars you will risk divided by the risk per share.',
  },
  {
    id: 'percent_gain', name: 'Percent gain',
    expression: '({Exit} - {Entry}) / {Entry} * 100',
    needs: ['Entry', 'Exit'],
    hint: 'The move from entry to exit, in percent.',
  },
]

/** Lowercased name -> id for the properties a formula may use (null = shared). */
export function formulaNameMap(defs, excludeId = null) {
  const m = new Map()
  for (const d of defs || []) {
    if (d.id === excludeId || (d.type !== 'number' && d.type !== 'formula') || d.source === 'financial_derived') continue
    const key = String(d.name || '').trim().toLowerCase()
    m.set(key, m.has(key) ? null : d.id)
  }
  return m
}

export function idNameMap(defs) {
  return new Map((defs || []).map((d) => [d.id, d.name]))
}

/** The property ids a stored formula reads (empty when it does not parse). */
export function formulaInputIds(stored) {
  if (!stored) return []
  try {
    return refsOf(parse(stored)).filter((r) => r.kind === 'id').map((r) => r.key)
  } catch {
    return []
  }
}

/** The stored expression shown with names, for the editor. */
export function displayExpression(stored, defs) {
  return stored ? toDisplay(stored, idNameMap(defs)) : ''
}

/** {ok, stored, refs} or {ok:false, message, code} for the member's {Name} text. */
export function checkFormula(text, defs, selfId = null) {
  try {
    const stored = toStored(text, formulaNameMap(defs))
    const node = parse(stored)
    const refs = refsOf(node).map((r) => r.key)
    if (selfId && refs.includes(selfId)) return { ok: false, code: 'cycle', message: 'Circular reference: a formula can\'t use itself' }
    if (selfId) {
      const cycle = findCycle(selfId, defs, stored)
      if (cycle) {
        const names = idNameMap(defs)
        return {
          ok: false, code: 'cycle',
          message: `Circular reference: ${cycle.map((id) => names.get(id) || id).join(' -> ')}. A formula can't depend on its own result.`,
        }
      }
    }
    return { ok: true, stored, node, refs }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, code: e.code, message: e.message }
    throw e
  }
}

/** The path self -> ... -> self through other formulas, or null. */
export function findCycle(selfId, defs, selfStored) {
  const formulas = new Map()
  for (const d of defs || []) {
    if (d.type !== 'formula') continue
    const text = d.id === selfId ? selfStored : d.config?.expression
    let refs = []
    try { refs = refsOf(parse(text || '')).map((r) => r.key) } catch { refs = [] }
    formulas.set(d.id, refs)
  }
  if (!formulas.has(selfId)) formulas.set(selfId, (() => { try { return refsOf(parse(selfStored)).map((r) => r.key) } catch { return [] } })())
  const stack = [[selfId, [selfId]]]
  const seen = new Set()
  while (stack.length) {
    const [node, path] = stack.pop()
    for (const nxt of formulas.get(node) || []) {
      if (nxt === selfId) return [...path, selfId]
      if (!formulas.has(nxt) || seen.has(nxt)) continue
      seen.add(nxt)
      stack.push([nxt, [...path, nxt]])
    }
  }
  return null
}

/**
 * Evaluate stored formula text against one note's property values (`props`, a
 * plain object keyed by property id). -> {value} or {value:null, reason}.
 */
export function evaluateFormula(stored, defs, props, stack = []) {
  const byId = new Map((defs || []).map((d) => [d.id, d]))
  let node
  try { node = parse(stored || '') } catch (e) { return { value: null, reason: e.message } }
  const lookup = (kind, key) => {
    const ref = kind === 'id' ? byId.get(key) : null
    if (!ref) throw new FormulaEvalError('unknown_ref', 'A property this formula uses was deleted')
    if (ref.type === 'formula') {
      if (stack.includes(key)) throw new FormulaEvalError('cycle', 'This formula refers back to itself')
      const inner = evaluateFormula(ref.config?.expression, defs, props, [...stack, key])
      if (inner.value === null) throw new FormulaEvalError('missing', `${ref.name} has no value (${inner.reason})`)
      return inner.value
    }
    if (ref.type !== 'number') throw new FormulaEvalError('not_number', `${ref.name} is not a number`)
    const v = props && Object.hasOwn(props, key) ? props[key] : null
    if (v === null || v === undefined) throw new FormulaEvalError('missing', `${ref.name} is empty`)
    if (typeof v !== 'number') throw new FormulaEvalError('not_number', `${ref.name} is not a number`)
    return v
  }
  try {
    return { value: evaluate(node, lookup), reason: null }
  } catch (e) {
    if (e instanceof FormulaEvalError) return { value: null, reason: e.message }
    throw e
  }
}

/** A computed number as text, or null for no value. Win rate reads as a percent. */
export function formatComputedNumber(value, aggregate = null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const v = Object.is(value, -0) ? 0 : value
  const digits = aggregate === 'win_rate' ? 1 : (Math.abs(v) >= 1000 ? 2 : 4)
  const s = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v)
  return aggregate === 'win_rate' ? `${s}%` : s
}

function timeOf(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * How one computed cell reads: `{text, empty, title}`. `text` is null when there is
 * no value; `title` always says something true about the value — its reason
 * when empty, the "first N of M" when capped, and a stale warning when the
 * server could not recompute.
 */
export function describeComputed(cell) {
  if (!cell) return { text: null, empty: true, title: 'Not calculated yet' }
  const text = formatComputedNumber(cell.value, cell.aggregate)
  const parts = []
  if (text === null) parts.push(cell.reason || 'No value yet')
  if (cell.capped) {
    parts.push(`Covers the first ${Number(cell.usedSize).toLocaleString()} of ${Number(cell.setSize).toLocaleString()}`)
  }
  if (cell.stale) {
    const at = timeOf(cell.computedAt)
    parts.push(`Could not recalculate just now; this is the value from ${at || 'earlier'}`)
  }
  return { text, empty: text === null, title: parts.join('. ') || 'Calculated' }
}

/** A sentence describing a rollup's settings, for the editor and the hover. */
export function describeRollup(config, defs, savedViews = []) {
  if (!config) return ''
  const agg = ROLLUP_AGGREGATES.find((a) => a.value === config.aggregate)?.label || ''
  const src = ROLLUP_SOURCES.find((s) => s.value === config.source)?.label.toLowerCase() || ''
  const view = config.source === 'saved_view' ? (savedViews.find((v) => v.id === config.savedViewId)?.name || 'a saved view') : null
  let what = ''
  if (config.source === 'trades') what = TRADE_FIELDS.find((f) => f.value === config.tradeField)?.label || ''
  else what = (defs || []).find((d) => d.id === config.propertyId)?.name || ''
  const set = view ? `the notes in ${view}` : src
  if (config.aggregate === 'count') return `Count of ${set}`
  return `${agg} of ${what || '…'} across ${set}`
}
