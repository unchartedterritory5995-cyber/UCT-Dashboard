// The working screen as a URL: refresh/back/forward safe. One codec, no
// second authority — useScreenSpec encodes with this and decodes with this.
// The `screen=` share-token param (screenShareLink.js) is a DIFFERENT door:
// it carries a saved screen's token; `s=` carries this session's working spec.
export const SPEC_PARAM = 's'
export const DEFAULT_SORT = { key: 'uct_composite', dir: 'desc' }
export const DEFAULT_VIEW = 'overview'

const b64url = s => btoa(unescape(encodeURIComponent(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = s => decodeURIComponent(escape(
  atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

const isDefaultSort = sort =>
  !sort || (sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir)

// A grouped-logic node (FT-026): {all|any|none: [node]} | {not: node} | a leaf
// ({key, ...}). Shape-checked on DECODE so a hand-edited URL can never reach
// the server as something other than a tree; the server still validates it
// (depth, leaf count, reserved keys) and refuses with a sentence.
const MAX_LOGIC_DEPTH = 6
function isLogicNode(n, depth = 0) {
  if (!n || typeof n !== 'object' || Array.isArray(n) || depth > MAX_LOGIC_DEPTH) return false
  if (typeof n.key === 'string') return true
  const keys = Object.keys(n)
  if (keys.length !== 1) return false
  const k = keys[0]
  if (k === 'not') return isLogicNode(n.not, depth + 1)
  if (!['all', 'any', 'none'].includes(k)) return false
  return Array.isArray(n[k]) && n[k].length > 0 && n[k].every(c => isLogicNode(c, depth + 1))
}

export function encodeSpec({ filters = {}, sort, view, columns, rank, logic } = {}) {
  const f = Object.entries(filters).filter(([, v]) => v)
  const payload = {}
  if (f.length) payload.f = Object.fromEntries(f)
  if (!isDefaultSort(sort)) payload.sort = sort
  if (view && view !== DEFAULT_VIEW) payload.view = view
  if (columns?.length) payload.cols = columns
  // A ranked scan (weighted composite + optional top_n cap, e.g. UCT 50). Carried
  // whole so a refresh/back/forward or a saved screen keeps the cap; absent = a
  // plain sorted list.
  if (rank && typeof rank === 'object') payload.rank = rank
  // ⛔ GROUPED LOGIC IS CARRIED. A link that silently dropped it would open a
  // BROADER screen than the one shared, and read as a quieter market.
  if (isLogicNode(logic)) payload.lg = logic
  if (!Object.keys(payload).length) return null
  return b64url(JSON.stringify(payload))
}

export function decodeSpec(str) {
  if (!str) return null
  try {
    const p = JSON.parse(unb64url(str))
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null
    return {
      filters: p.f && typeof p.f === 'object' && !Array.isArray(p.f) ? p.f : {},
      sort: p.sort?.key ? { key: String(p.sort.key), dir: p.sort.dir === 'asc' ? 'asc' : 'desc' } : { ...DEFAULT_SORT },
      view: typeof p.view === 'string' && p.view ? p.view : DEFAULT_VIEW,
      columns: Array.isArray(p.cols) && p.cols.every(c => typeof c === 'string') && p.cols.length ? p.cols : null,
      rank: p.rank && typeof p.rank === 'object' && !Array.isArray(p.rank) ? p.rank : null,
      logic: isLogicNode(p.lg) ? p.lg : null,
    }
  } catch {
    return null
  }
}
