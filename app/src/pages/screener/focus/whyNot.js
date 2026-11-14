// "Why isn't a stock here?" (RS screens unit U8, 2026-11-14). A member names a ticker; the page
// asks the server for that ONE row and checks the open screen's rules against it, one by one.
// Pure functions: the wording of each rule and of each value is whyItsHere.js's own, so this
// answer and the "Why it's here" strip can never say the same rule two ways.
//
// ⛔ WHAT A CROSS MEANS. Each rule is judged the way the scan judges it (query.build_where):
//   · a comparison (at least, at most, between, equals, one of) FAILS on a blank value: the
//     server cannot compare what it does not hold, so the row is not on the list. Said as
//     "no value", never as a number;
//   · an exclude list (not one of) PASSES on a blank: the scan keeps a row whose value it does
//     not hold, so a stock with no Setup flag is not a "Buyout pending" stock.
// A rule this page cannot judge from one row (the member's universe or watchlist, a scan join,
// custom criteria, a field compared with another field) is listed as "not checked here" and is
// never counted as passed: the answer then says "every rule that can be checked here".
import { plainColumnLabel } from './plainWords'
import { isCheckable, isMissing, isYes, requiresFalse, fmtValue, checkLabel, noteLabel, whyColumns } from './whyItsHere'

// What a ticker may look like (the server applies the same shape before it reads anything).
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/
// "$nvda " -> "NVDA"; anything that is not a ticker -> ''.
export function cleanTicker(raw) {
  const t = String(raw ?? '').trim().replace(/^\$/, '').toUpperCase()
  return TICKER.test(t) ? t : ''
}

export const NO_SUCH_STOCK = 'No such stock in the Screener.'
export const NOT_A_TICKER = 'Type a ticker, like NVDA.'
export const COULD_NOT_CHECK = 'That could not be checked just now. Try again.'
export const NO_VALUE = 'no value'
export const NOT_CHECKED = 'not checked here'

const isNum = v => typeof v === 'number' && Number.isFinite(v)
// A stored token list (",hammer,doji,"): the scan tests each token, never the whole cell.
const tokens = v => (typeof v === 'string' && v.length > 1 && v.startsWith(',') && v.endsWith(',') ? v.slice(1, -1).split(',') : null)
const holds = (v, values) => {
  const have = tokens(v) || [v]
  return values.some(x => have.some(h => String(h) === String(x)))
}

// Does a value the row HOLDS satisfy the clause? true, false, or null when this page cannot say
// (an operand the clause does not carry, a number rule over a value that is not a number).
function passes(def, spec, v) {
  switch (spec.op) {
    case 'gte': return isNum(v) && isNum(spec.min) ? v >= spec.min : null
    case 'gt': return isNum(v) && isNum(spec.min) ? v > spec.min : null
    case 'lte': return isNum(v) && isNum(spec.max) ? v <= spec.max : null
    case 'lt': return isNum(v) && isNum(spec.max) ? v < spec.max : null
    case 'between': return isNum(v) && isNum(spec.min) && isNum(spec.max) ? v >= spec.min && v <= spec.max : null
    case 'eq':
      if (def?.type === 'bool') return isYes(v) === !requiresFalse(spec.value)
      if (isMissing(spec.value)) return null
      return isNum(v) && isNum(Number(spec.value)) ? v === Number(spec.value) : String(v) === String(spec.value)
    case 'in': return Array.isArray(spec.values) && spec.values.length ? holds(v, spec.values) : null
    case 'not_in': return Array.isArray(spec.values) && spec.values.length ? !holds(v, spec.values) : null
    default: return null
  }
}

// Every rule of the screen against one row. `filters` is the KEYED filters of the screen on view
// ({ key: { op, ... } }, useScreenSpec's shape), `metaFilters` the registry (labels, units, types).
// Each item: { kind: 'pass' | 'fail' | 'unknown', label, value }.
export function evaluateRules({ filters = {}, logic = null, metaFilters = [], row = {} } = {}) {
  const defs = Object.fromEntries((metaFilters || []).map(f => [f.key, f]))
  const items = []
  for (const [key, spec] of Object.entries(filters || {})) {
    if (!spec) continue
    if (key === 'universe') { items.push({ kind: 'unknown', label: `In ${spec.label || 'UCT Universe'}`, value: NOT_CHECKED }); continue }
    if (key === 'list') { items.push({ kind: 'unknown', label: `In ${spec.label || 'your list'}`, value: NOT_CHECKED }); continue }
    if (key === 'scan') { items.push({ kind: 'unknown', label: `In My Scan ${spec.label || ''}`.trim(), value: NOT_CHECKED }); continue }
    const raw = defs[key] || { key, label: key, presets: [] }
    const def = { ...raw, label: plainColumnLabel(key) || raw.label }
    if (!isCheckable(key, spec)) { items.push({ kind: 'unknown', label: noteLabel(key, def, spec), value: NOT_CHECKED }); continue }
    const label = checkLabel(def, spec)
    const v = row?.[key]
    if (isMissing(v)) {
      items.push(spec.op === 'not_in' ? { kind: 'pass', label, value: 'none' } : { kind: 'fail', label, value: NO_VALUE })
      continue
    }
    const ok = passes(def, spec, v)
    items.push({ kind: ok === null ? 'unknown' : ok ? 'pass' : 'fail', label, value: ok === null ? NOT_CHECKED : fmtValue(def, v) })
  }
  if (logic) items.push({ kind: 'unknown', label: 'Your custom criteria', value: NOT_CHECKED })
  return {
    items,
    failed: items.filter(i => i.kind === 'fail').length,
    unknown: items.filter(i => i.kind === 'unknown').length,
    // The first rule the stock misses, as one line ("RS Rating ≥ 80: 74"), or ''.
    firstFailed: (f => (f ? `${f.label}: ${f.value}` : ''))(items.find(i => i.kind === 'fail')),
  }
}

// The columns to ask the server for: every rule this page can judge, and the one column a
// single-criterion ranking orders by (to say where the stock ranks).
export function whyNotColumns(filters, rank) {
  const crit = rankCriterion(rank)
  return [...new Set([...whyColumns(filters), ...(crit ? [crit.key] : [])])]
}

// A ranking this page can place a stock in: exactly one criterion. With several, the order is a
// weighted blend over the whole screened set, which one row cannot reproduce.
export function rankCriterion(rank) {
  const c = Array.isArray(rank?.criteria) && rank.criteria.length === 1 ? rank.criteria[0] : null
  return c && typeof c.key === 'string' && c.key ? { key: c.key, ascending: c.ascending === true } : null
}

// The count request that places a stock in a single-criterion ranking: the screen's own rules
// plus "ranks ahead of this stock". Its answer + 1 is the stock's place. null when it cannot be
// asked (no such ranking, or the row holds no value to compare).
// `filterList` is the screen's filter LIST (baseSpec.filters), as the count route takes it.
export function rankAheadSpec({ filterList = [], logic = null, rank = null, row = {} } = {}) {
  const crit = rankCriterion(rank)
  const v = crit ? row?.[crit.key] : null
  if (!crit || !isNum(v)) return null
  const ahead = crit.ascending ? { key: crit.key, op: 'lt', max: v } : { key: crit.key, op: 'gt', min: v }
  return { filters: [...(filterList || []).filter(f => f && f.key !== crit.key), ahead], ...(logic ? { logic } : {}) }
}

// ── a list that keeps its own members (unit U12) ───────────────────────────
// UCT RS Leaders is decided once a session by the server (rsScreens.steadyOf reads how from the
// starter's `row.steady`): a stock joins at `enter` or better among the qualifiers and stays to
// `hold`. Its screen filters on the stored membership column, and that clause is the ANSWER
// ("it is not on the list"), never one of the rules a stock passes or misses.

// The screen's rules without one key (the membership clause of such a list).
export function rulesWithout(filters, key) {
  if (!key) return filters || {}
  return Object.fromEntries(Object.entries(filters || {}).filter(([k]) => k !== key))
}

// The count that places a stock among the list's QUALIFIERS: the starter's own qualifying rules
// (`steady.gate`: never the screen as the member has since narrowed it, because the server ranks
// on the starter's) plus "ranks ahead of this stock". Its answer + 1 is the stock's rank. null
// when there is no such list, or the row holds no value to compare.
export function steadyAheadSpec({ steady = null, row = {} } = {}) {
  const v = steady ? row?.[steady.by] : null
  if (!steady || !isNum(v)) return null
  return { filters: [...(steady.gate || []).filter(f => f && f.key !== steady.by), { key: steady.by, op: 'gt', min: v }] }
}

// 1 -> "1st", 22 -> "22nd", 63 -> "63rd", 111 -> "111th".
export function ordinal(n) {
  const k = Math.abs(n) % 100
  const s = k >= 11 && k <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th'
  return `${Number(n).toLocaleString('en-US')}${s}`
}

// The one sentence that leads the answer.
//   onList     the stock is among the rows on screen
//   hiddenNew  it is on the list, and "New only" is hiding it
//   stale      the server leaves it out of every screen (its bars stopped arriving)
//   position   its place in a single-criterion ranking (count of stocks ahead + 1), or null
//   topN       the ranking's cap, or null
//   hasMore    the list has rows that are not loaded yet
//   steady     the list keeps its own members and this stock is not one of them (unit U12):
//              { enter, hold }; `position` is then its rank among the list's qualifiers
export function whyNotHeadline({ ticker, failed = 0, unknown = 0, onList = false, hiddenNew = false, stale = false, position = null, topN = null, hasMore = false, steady = null } = {}) {
  if (onList) return `${ticker} is on this list.`
  if (hiddenNew) return `${ticker} is on this list. It is hidden while New only is on.`
  if (failed > 0) return `${ticker} is not on this list. It misses ${failed === 1 ? '1 rule' : `${failed} rules`}.`
  if (stale) return `${ticker} passes the rules below, but its price data has stopped updating, so it is left out of every screen.`
  if (unknown > 0) return `${ticker} passes every rule that can be checked here.`
  if (steady && isNum(steady.enter) && isNum(steady.hold)) {
    // The rank is said, and the words in brackets are why a stock ranked just past the top 50 sees
    // others below it on the list. (A rank inside the top 50 can only be read between two passes:
    // the server lists every such stock at its next one.) A rank the server would not count is
    // never invented.
    const kept = `the list holds the top ${steady.enter.toLocaleString('en-US')} (a listed stock stays until it falls past ${ordinal(steady.hold)})`
    return isNum(position) ? `Passes every rule; ranked ${ordinal(position)}, ${kept}.` : `${ticker} passes every rule and is not on the list today: ${kept}.`
  }
  if (isNum(topN) && isNum(position) && position > topN) return `Passes every rule; ranked ${ordinal(position)}, the list shows the top ${topN.toLocaleString('en-US')}`
  if (hasMore) return 'Passes every rule. It is further down this list than the rows loaded so far.'
  // Every rule passes on the row just read, and the list on screen does not hold it: the two
  // were read moments apart, and the page says so instead of picking one.
  return `${ticker} passes every rule on its latest numbers. The list on screen was loaded a moment earlier and refreshes on its own.`
}
