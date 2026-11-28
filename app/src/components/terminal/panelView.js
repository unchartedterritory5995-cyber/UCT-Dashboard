// UCT Terminal — a panel's VIEW: how the member has arranged what a panel shows (customization
// pass 1, 2026-11-27). Pure; tests in panelView.test.js.
//
// A board panel record is `{ id, code, channel, sym, args }` (pages/terminal/boardModel.js). The
// command arguments say WHAT the panel shows; `view` says how the member arranged it:
//
//   view = {
//     sort?:    { key, dir: 'asc' | 'desc' }     the column the table is sorted by
//     cols?:    { hidden: [key, ...] }           the columns the member hid
//     filters?: { name: string | number | bool } any other choice a panel keeps (a floor, a window)
//   }
//
// It is saved with the board, a saved board and a board share link (they all carry the panel
// record), and NEVER written into the command text: a `view` choice does not show in the command
// line and does not remount the panel. A choice the registry already takes as an argument
// writes back to the command instead (pages/terminal/panels/commandWriteBack.js).
//
// ⛔ TWO COPIES OF `normalizeView`, ON PURPOSE. pages/terminal/boardModel.js keeps its own (the board's
// guard on every stored record) and this file keeps the panel kit's. One shared module would be a chunk
// of its own, and its name would ride every preload list that reaches the board model, the Notebook's
// first open among them (the Notebook first-open budget, 2026-11-28). boardModel.viewParity.test.js
// holds the two equal on every shape and bound.
//
// ⛔ SMALL AND WELL FORMED, OR NOT AT ALL. `normalizeView` keeps only the three fields above, each
// within the bounds below, and drops the whole slot when its JSON is over VIEW_MAX_BYTES, so a
// stored board or a share link can never be bloated through it. An empty view is `undefined`
// (the record carries no `view` key at all), so a board that never used it stores exactly what it
// stored before. Older code reading a board with `view` ignores the field.

export const VIEW_MAX_FILTERS = 8
export const VIEW_MAX_HIDDEN = 24
// 80: the longest text a panel keeps (UNEWS's search word is capped at 80 by its own model).
export const VIEW_MAX_STR = 80
export const VIEW_MAX_BYTES = 1024
export const VIEW_DIRS = Object.freeze(['asc', 'desc'])

const KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const cleanKey = (k) => (typeof k === 'string' && KEY_RE.test(k) ? k : null)

function cleanValue(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return v.length <= VIEW_MAX_STR ? v : undefined
  return undefined
}

function cleanSort(s) {
  if (!isObj(s)) return undefined
  const key = cleanKey(s.key)
  if (!key || !VIEW_DIRS.includes(s.dir)) return undefined
  return { key, dir: s.dir }
}

function cleanCols(c) {
  if (!isObj(c) || !Array.isArray(c.hidden)) return undefined
  const hidden = [...new Set(c.hidden.map(cleanKey).filter(Boolean))].slice(0, VIEW_MAX_HIDDEN)
  // An EMPTY list is kept: it means "hide nothing", which differs from a panel whose default
  // hides a column (`storedView` writes it only then).
  return { hidden }
}

function cleanFilters(f) {
  if (!isObj(f)) return undefined
  const out = {}
  let n = 0
  for (const [k, v] of Object.entries(f)) {
    if (n >= VIEW_MAX_FILTERS) break
    const key = cleanKey(k)
    const val = cleanValue(v)
    if (!key || val === undefined) continue
    out[key] = val
    n += 1
  }
  return n ? out : undefined
}

/** A stored or written view, cleaned to the shape above — or `undefined` (nothing worth keeping,
 *  malformed, or too big). Never throws. */
export function normalizeView(v) {
  if (!isObj(v)) return undefined
  const out = {}
  const sort = cleanSort(v.sort)
  const cols = cleanCols(v.cols)
  const filters = cleanFilters(v.filters)
  if (sort) out.sort = sort
  if (cols) out.cols = cols
  if (filters) out.filters = filters
  if (!Object.keys(out).length) return undefined
  let size
  try { size = new TextEncoder().encode(JSON.stringify(out)).length } catch { return undefined }
  return size > VIEW_MAX_BYTES ? undefined : out
}

/** Two views say the same thing (cleaned, field order ignored). */
export function sameView(a, b) {
  return viewKey(a) === viewKey(b)
}

/** A stable text key for a view (cleaned; the empty view is ''). */
export function viewKey(v) {
  const n = normalizeView(v)
  if (!n) return ''
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
  return JSON.stringify({
    sort: n.sort || null,
    hidden: n.cols ? [...n.cols.hidden].sort() : [],
    filters: n.filters ? sortObj(n.filters) : {},
  })
}

/**
 * The view a panel READS: the stored view over the panel's own defaults, every field present.
 * `defaults` is `{ sort?, hidden?, filters? }`: `sort` null means "the list's own order".
 *   { sort: {key,dir} | null, hidden: [keys], filters: {…} }
 * A stored `sort` of `null` is not representable, so "back to the list's order" is stored as a
 * view WITHOUT `sort` — which reads as `defaults.sort`. A panel whose default is a sort therefore
 * cannot be put back to "unsorted"; its default is the order it starts in.
 */
export function readView(stored, defaults = {}) {
  const v = normalizeView(stored) || {}
  return {
    sort: v.sort || cleanSort(defaults.sort) || null,
    hidden: v.cols ? v.cols.hidden : (Array.isArray(defaults.hidden) ? defaults.hidden.filter((k) => cleanKey(k)) : []),
    filters: { ...(cleanFilters(defaults.filters) || {}), ...(v.filters || {}) },
  }
}

/**
 * The view to STORE for what a panel reads now: only what differs from its defaults, so a panel
 * put back to its defaults stores nothing. The inverse of `readView`.
 */
export function storedView(read, defaults = {}) {
  const out = {}
  const dSort = cleanSort(defaults.sort) || null
  const sort = cleanSort(read?.sort) || null
  if (sort && !(dSort && dSort.key === sort.key && dSort.dir === sort.dir)) out.sort = sort
  const dHidden = (Array.isArray(defaults.hidden) ? defaults.hidden : []).filter((k) => cleanKey(k)).sort()
  const hidden = [...new Set((Array.isArray(read?.hidden) ? read.hidden : []).filter((k) => cleanKey(k)))]
  if (JSON.stringify([...hidden].sort()) !== JSON.stringify(dHidden)) out.cols = { hidden }
  const dFilters = cleanFilters(defaults.filters) || {}
  const filters = {}
  for (const [k, v] of Object.entries(isObj(read?.filters) ? read.filters : {})) {
    if (dFilters[k] !== v) filters[k] = v
  }
  if (Object.keys(filters).length) out.filters = filters
  return normalizeView(out)
}
