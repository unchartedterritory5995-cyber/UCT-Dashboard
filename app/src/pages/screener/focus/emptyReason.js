// Why a screen came back EMPTY, when the honest answer is "the data is not there yet" rather
// than "nothing matched". A zero from a screen that reads a live-only column outside the session
// (Volume vs usual by now is blank before 09:45 ET and after the close) or a column no stock has
// a value for is not a quiet market, and "none today" / "No stocks match" would say it was.
//
// The facts come from the server, never from a clock here:
//  · `live_only` on a meta filter entry (filters.meta, derived from snapshot_db.LIVE_ONLY_COLUMNS)
//    says the column only has values while the live tier is recomputing it;
//  · a PRESENCE count (`<key> >= PRESENCE_MIN`, which SQL answers only for rows that HOLD a value)
//    says whether any stock has the column right now. It goes through the same count route every
//    other number in the menu uses, so it describes the same snapshot and overlay;
//  · the scan's coverage receipt (`not_computable` of `evaluated`) says whether any row could be
//    checked at all.
import useLazyCounts from './useLazyCounts'

// Every range column is a finite number, so this matches exactly the rows that hold a value.
export const PRESENCE_MIN = -1e15

// Not column criteria: the place searched, a scan receipt, a ticker scope, an arithmetic term.
const NOT_A_COLUMN = new Set(['universe', 'list', 'scan', 'tickers', 'arith'])

// Only the criteria a row MUST satisfy: leaves reached through all-of groups. A column inside an
// any-of is one alternative (Gap Movers reads live volume in the session and last night's
// otherwise), so its absence does not explain a zero; nor does one inside a none-of or a not.
function requiredLeaves(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if ('key' in node) { out.push(node); return out }
  for (const c of node.all || []) requiredLeaves(c, out)
  return out
}

// The range-type filter keys a spec REQUIRES (flat list and all-of groups), each once, in order.
// `liveOnly` narrows it to the live-only ones (the empty state asks only those: its scan already
// carries a coverage receipt for everything else, so it spends no extra count on them).
export function presenceKeys(spec, meta, { liveOnly = false } = {}) {
  const defs = new Map((meta?.filters || []).map(f => [f.key, f]))
  const out = []
  for (const f of [...(spec?.filters || []), ...requiredLeaves(spec?.logic)]) {
    const k = f?.key
    if (!k || NOT_A_COLUMN.has(k) || out.includes(k)) continue
    if (defs.get(k)?.type === 'range' && (!liveOnly || defs.get(k)?.live_only)) out.push(k)
  }
  return out
}

export const presenceSpec = key => ({ filters: [{ key, op: 'gte', min: PRESENCE_MIN }] })

// undefined while any presence count is still unknown; otherwise null (an ordinary zero) or
// { kind: 'live' | 'missing', labels }.
export function emptyReason({ spec, meta, presence = {}, coverage = null, liveOnly = false }) {
  const defs = new Map((meta?.filters || []).map(f => [f.key, f]))
  const keys = presenceKeys(spec, meta, { liveOnly })
  if (keys.some(k => presence[k] === undefined)) return undefined
  const absent = keys.filter(k => presence[k] === 0)
  const label = k => defs.get(k)?.label || k
  // An extended-hours column (meta `premarket_only`, from the sweep's own declaration) is blank
  // during the session, so its zero is told apart from the regular live tier's.
  const pre = absent.filter(k => defs.get(k)?.premarket_only)
  if (pre.length) return { kind: 'premarket', labels: pre.map(label) }
  const live = absent.filter(k => defs.get(k)?.live_only)
  if (live.length) return { kind: 'live', labels: live.map(label) }
  if (absent.length) return { kind: 'missing', labels: absent.map(label) }
  const ev = Number(coverage?.evaluated), nc = Number(coverage?.not_computable)
  if (ev > 0 && nc >= ev) return { kind: 'missing', labels: [] }
  return null
}

// The presence counts for `keys` (key -> count; absent = not answered yet; null = failed).
export function usePresence(keys, enabled) {
  const specs = Object.fromEntries((keys || []).map(k => [k, presenceSpec(k)]))
  return useLazyCounts(specs, !!enabled && (keys || []).length > 0)
}

// The one place the words live, so the menu row and the empty state cannot drift apart.
export const REASON_SHORT = { live: 'live during the session', premarket: 'fills outside the session', missing: 'not available yet' }

export function reasonHead(reason) {
  if (reason?.kind === 'premarket') return 'Extended-hours screens fill before the open and after the close'
  if (reason?.kind === 'live') return 'Not available yet: this screen is live during the session'
  if (reason?.kind === 'missing') return 'Not available yet'
  return null
}

export function reasonBody(reason, coverage = null) {
  const list = labels => labels.join(', ')
  if (reason?.kind === 'premarket') {
    return `${list(reason.labels)} comes from the last pre-market or after-hours trade and is blank during the session, `
      + 'so this screen returns nothing until the close (or before the open). No extended-hours volume is available. '
      + 'That is a gap in the data, not a quiet market.'
  }
  if (reason?.kind === 'live') {
    return `${list(reason.labels)} fills in from the live tape during the session, from 9:45 ET. `
      + 'Right now no stock has a value for it, so this screen returns nothing until the session is under way. '
      + 'That is a gap in the data, not a quiet market.'
  }
  if (reason?.kind === 'missing') {
    if (reason.labels.length) return `No stock has a value for ${list(reason.labels)} yet, so nothing could be checked against it. That is a gap in the data, not a quiet market.`
    const ev = Number(coverage?.evaluated)
    return `None of the ${Number.isFinite(ev) ? ev.toLocaleString('en-US') + ' ' : ''}stocks has a value for every filter on this screen yet, so nothing could be checked. That is a gap in the data, not a quiet market.`
  }
  return null
}
