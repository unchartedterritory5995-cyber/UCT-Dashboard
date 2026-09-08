/* The REVIEW SESSION — the ordered context a chart is missing.
 *
 * ⛔ THE HOLE THIS FILLS, stated once. Selecting a symbol from a list calls
 * `setGroupSym(color, sym)` — ONE symbol. The ordered set the user is actually
 * working through lives inside the list widget's own render and dies there. So
 * the chart cannot offer "next", cannot say "12 of 47", and cannot send you back
 * to where you were. Those are not three problems; they are one missing
 * primitive, and building three navigation hacks would produce three features
 * that disagree about what "current" means.
 *
 * ⛔ IT IS NOT A SECOND WATCHLIST STORE. The owning feature still owns the list.
 * This captures the review CONTEXT — which list, in what order, where in it —
 * as a SNAPSHOT for navigation, and `reconcile()` exists precisely because that
 * snapshot can go stale while the owner's list moves on.
 *
 * ⛔ AND IT IS SESSION STATE, NOT WORKSPACE STATE. It must survive a page-to-page
 * navigation and must NOT outlive the tab, so `sessionStorage` is the honest
 * lifetime. Writing it to the server-backed workspace would put scratch context
 * in the one record MOB-08 just finished making careful, and would sync a
 * half-finished scan review to every other device the member owns.
 *
 * ⭐ NO WRAP-AROUND, and that is a product decision rather than an omission. A
 * trader working a scan needs to know they FINISHED it. Silently restarting at
 * the top turns a finite task into a loop with no edge, and the "47 / 47" that
 * tells you you are done never appears.
 */

export const STORAGE_KEY = 'uct.review.session'

/** Where an ordered set can come from. The list itself always belongs to one of
 *  these; the session only records which. */
export const SOURCES = ['watchlist', 'scan', 'screener', 'flagged', 'group', 'other']

const isStr = (v) => typeof v === 'string' && !!v
const clampIndex = (i, n) => (n <= 0 ? 0 : Math.max(0, Math.min(n - 1, i | 0)))

/** Normalise + dedupe an ordered symbol list, preserving VISUAL order.
 *
 * ⛔ Order is the caller's, never re-sorted here. `Watchlists.jsx` already builds
 * `visibleSymsFlat` — deduped, in the order the rows actually appear across
 * Flagged, the tag auto-lists and user lists. Re-deriving that ordering here is
 * how the phone and the desktop would start disagreeing about what "next" is. */
export function normaliseSymbols(symbols) {
  const seen = new Set()
  const out = []
  for (const s of Array.isArray(symbols) ? symbols : []) {
    const t = isStr(s) ? s.trim().toUpperCase() : null
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

/**
 * ENTER — build a session from an ordered set and the symbol just opened.
 * Returns null when there is nothing to review (no symbols, or the opened
 * symbol is not in them) rather than a session that lies about its position.
 */
export function enter({ source = 'other', sourceId = null, label = '', symbols, symbol, sort = null } = {}) {
  const list = normaliseSymbols(symbols)
  const sym = isStr(symbol) ? symbol.trim().toUpperCase() : null
  if (!list.length || !sym) return null
  const index = list.indexOf(sym)
  if (index < 0) return null
  return {
    v: 1,
    source: SOURCES.includes(source) ? source : 'other',
    sourceId: isStr(sourceId) ? sourceId : null,
    label: isStr(label) ? label : '',
    // `sort` is carried because "next" is only meaningful under the ordering
    // that produced the list — a re-sorted list is a DIFFERENT review.
    sort: isStr(sort) ? sort : null,
    symbols: list,
    index,
    reviewed: [sym],
  }
}

export const currentSymbol = (s) => (s && s.symbols ? s.symbols[s.index] || null : null)
export const nextSymbol = (s) => (s && s.symbols ? s.symbols[s.index + 1] || null : null)
export const prevSymbol = (s) => (s && s.symbols ? s.symbols[s.index - 1] || null : null)

/** Position, for the chip and the disabled states. */
export function position(s) {
  if (!s || !s.symbols || !s.symbols.length) return { index: 0, total: 0, canPrev: false, canNext: false, label: '' }
  const total = s.symbols.length
  const index = clampIndex(s.index, total)
  return {
    index,
    total,
    canPrev: index > 0,
    canNext: index < total - 1,
    label: `${index + 1} / ${total}`,   // 1-based for humans; `index` stays 0-based
  }
}

/**
 * NEXT / PREV. Returns null at a boundary — ⛔ the caller must treat null as
 * "nothing happened", never as "clear the session". No wrap (see the header).
 */
export function step(s, delta) {
  if (!s || !s.symbols || !s.symbols.length) return null
  const to = s.index + (delta | 0)
  if (to < 0 || to >= s.symbols.length) return null
  const sym = s.symbols[to]
  const reviewed = s.reviewed && s.reviewed.includes(sym) ? s.reviewed : [...(s.reviewed || []), sym]
  return { ...s, index: to, reviewed }
}

/**
 * The symbol changed from somewhere OTHER than next/prev — a search, a deep
 * link, a tap in a different list.
 *
 * ⛔ EXIT, NOT PAUSE, when the symbol is outside the set. The brief's own rule:
 * do not leave a stale "12 of 47" attached to a symbol opened independently. A
 * paused session that silently resumes later is a worse lie than no session —
 * the chip would reappear against a list the user has mentally left.
 * Returns the re-indexed session when the symbol IS in the set (so tapping
 * another row of the same list keeps the review alive), else null.
 */
export function syncToSymbol(s, symbol) {
  const sym = isStr(symbol) ? symbol.trim().toUpperCase() : null
  if (!s || !sym || !s.symbols) return null
  const i = s.symbols.indexOf(sym)
  if (i < 0) return null
  if (i === s.index) return s
  const reviewed = s.reviewed && s.reviewed.includes(sym) ? s.reviewed : [...(s.reviewed || []), sym]
  return { ...s, index: i, reviewed }
}

/**
 * REFRESH — the underlying list changed while reviewing (a scan re-ran, a row
 * was removed, a sort was applied).
 *
 * ⭐ IDENTITY IS THE SYMBOL, NOT THE INDEX. Re-pointing at "position 12" of a
 * new list would silently move the user to a different company while the chart
 * kept showing the old one. So the current SYMBOL is found in the new list and
 * the index follows it. If it is gone, the review is over — return null.
 */
export function reconcile(s, nextSymbols) {
  if (!s) return null
  const list = normaliseSymbols(nextSymbols)
  const cur = currentSymbol(s)
  if (!list.length || !cur) return null
  const i = list.indexOf(cur)
  if (i < 0) return null
  return { ...s, symbols: list, index: i }
}

/**
 * The symbols worth warming from here: NEXT 2, then PREVIOUS 1.
 *
 * ⛔ NOT THE LIST. The shared prefetch queue is capped at three concurrent
 * fetches, so warming a fifty-symbol watchlist would hold that cap for minutes
 * and STARVE THE CHART THE USER IS LOOKING AT — a prefetch that delays the
 * current symbol has made the product slower while looking busy.
 *
 * ⭐ ASYMMETRIC ON PURPOSE. Reviewers move forward far more than back, so the
 * window is 2 ahead and 1 behind rather than a tidy plus-or-minus two. Order
 * matters: the queue drains in order, so the very next symbol is warmed first.
 */
export function neighbours(s) {
  if (!s || !Array.isArray(s.symbols)) return []
  const i = s.index
  return [s.symbols[i + 1], s.symbols[i + 2], s.symbols[i - 1]].filter(Boolean)
}

/* ⚰️ `withScrollTop` / `scrollTop` LIVED HERE AND ARE GONE — dead state removed
 * rather than carried. Two reasons, and the second is the real one:
 *   1. nothing ever consumed it;
 *   2. it answered the WRONG QUESTION. After several next/prev steps the right
 *      place to land is wherever the CURRENT SYMBOL now is, not wherever the
 *      list happened to be scrolled when you left it. The owning surface
 *      already does exactly that — a scoped watchlist auto-expands from
 *      `pickList` and scrolls `selectedSym` into view — so return needs no
 *      offset bookkeeping at all.
 */

// ─── persistence ────────────────────────────────────────────────────────────
//
// ⛔ Every read is defensive. A malformed or half-written session must degrade
// to "no review in progress" and never throw into a chart render — the failure
// mode of scratch context is that you lose the chip, not the board.

export function read(storage) {
  const store = storage || safeSession()
  if (!store) return null
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || typeof s !== 'object' || !Array.isArray(s.symbols) || !s.symbols.length) return null
    const symbols = normaliseSymbols(s.symbols)
    if (!symbols.length) return null
    return { ...s, symbols, index: clampIndex(s.index, symbols.length) }
  } catch { return null }
}

export function write(s, storage) {
  const store = storage || safeSession()
  if (!store) return
  try {
    if (!s) store.removeItem(STORAGE_KEY)
    else store.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch { /* private mode, quota — a lost session is never fatal */ }
}

export const clear = (storage) => write(null, storage)

function safeSession() {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null } catch { return null }
}

/** One event so every surface (chart chip, control, list) sees the same session
 *  without prop-drilling through the widget tree. */
export const REVIEW_EVENT = 'uct:review-session'
export function publish(s, storage) {
  write(s, storage)
  try { window.dispatchEvent(new CustomEvent(REVIEW_EVENT, { detail: s || null })) } catch { /* SSR / tests */ }
}
