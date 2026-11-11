// Compare Symbols → Rotation: the pure rules and the reads behind the tab (UCT RS Phase 3, unit 3-12).
// Which names plot (own symbols, else a group, else a watchlist), the RRG_MAX cap and its
// sentence, and the screener's RS ratings that rank a bigger set. CompareRotation.jsx renders them.
import { RRG_BENCHMARK, RRG_MAX } from '../terminal/panels/RrgPanel'

export const WATCHLISTS_URL = '/api/watchlists?include_items=1&include_prebuilt=0'
export const SCAN_URL = '/api/screener/scan'
/** The screener's ticker-scope ceiling (`query._MAX_TICKERS`). */
const SCAN_MAX_TICKERS = 500

export const norm = (s) => String(s || '').trim().toUpperCase().replace(/^\$/, '')
const key = (s) => norm(s).replace(/\./g, '-')

export function dedupe(list) {
  const out = []
  for (const raw of list || []) {
    const s = norm(raw)
    if (s && s !== RRG_BENCHMARK && !out.includes(s)) out.push(s)
  }
  return out
}

/** Pure: the names the Rotation tab plots before the cap, and where they came from.
 *  `group`: `{ type, name, symbols, total, truncated }`; `watchlist`: `{ id, name, symbols }`;
 *  `prefer`: a source the member chose here ('own' | 'group' | 'watchlist'), or null. */
export function resolveRotationUniverse({ own = [], group = null, watchlist = null, prefer = null } = {}) {
  const sources = {
    own: { source: 'own', syms: dedupe(own) },
    group: group ? { source: 'group', syms: dedupe(group.symbols), group } : null,
    watchlist: watchlist ? { source: 'watchlist', syms: dedupe(watchlist.symbols), watchlist } : null,
  }
  const pick = prefer && sources[prefer]?.syms.length ? sources[prefer] : null
  return pick
    || [sources.own, sources.group, sources.watchlist].find((s) => s && s.syms.length)
    || { source: null, syms: [] }
}

/** Pure: at most `max` names. Over the cap, the highest `ratings` first (unrated after rated,
 *  ties by symbol), or — with no ratings at all — the first `max` by symbol. */
export function capUniverse(syms, ratings, max = RRG_MAX) {
  const total = syms.length
  if (total <= max) return { shown: syms, total, order: null }
  const rated = ratings && syms.some((s) => Number.isFinite(ratings[key(s)]))
  if (!rated) return { shown: [...syms].sort().slice(0, max), total, order: 'symbol' }
  const r = (s) => (Number.isFinite(ratings[key(s)]) ? ratings[key(s)] : -Infinity)
  const shown = [...syms].sort((a, b) => r(b) - r(a) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, max)
  return { shown, total, order: 'rating' }
}

/** Pure: the muted line under a capped universe; '' when nothing was left out. */
export function capSentence({ shown, total, order }, group = null) {
  if (!order) return ''
  const how = order === 'rating' ? 'highest RS rating first' : `first ${shown.length} by symbol`
  const more = group?.truncated && group.total > total
    ? ` This group has ${group.total} names; the panel reads its first ${total}.`
    : ''
  return `${shown.length} of ${total} names, ${how}.${more}`
}

/** `{ SYM: rating }` from the screener's own rows, or null when the read is refused (a free plan,
 *  a switched-off ticker scope) or fails. Never throws. */
export async function fetchRsRatings(syms) {
  try {
    const values = syms.slice(0, SCAN_MAX_TICKERS)
    const r = await fetch(SCAN_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: [{ key: 'tickers', op: 'in', values }],
        sort: { key: 'rs_rating_ibd', dir: 'desc' },
        columns: ['rs_rating_ibd'],
        page: 1,
        page_size: values.length,
      }),
    })
    if (!r.ok) return null
    const j = await r.json()
    const out = {}
    for (const row of j?.rows || []) {
      const v = row?.rs_rating_ibd == null ? NaN : Number(row.rs_rating_ibd)
      if (row?.ticker && Number.isFinite(v)) out[key(row.ticker)] = v
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** The member's own lists with their names, `[{ id, name, symbols }]`; [] on any failure. */
export async function fetchWatchlists() {
  try {
    const r = await fetch(WATCHLISTS_URL, { credentials: 'include' })
    if (!r.ok) return []
    const j = await r.json()
    const lists = Array.isArray(j) ? j : (j?.watchlists || [])
    return lists
      .map((w) => ({ id: String(w.id), name: w.name || 'Untitled list', symbols: dedupe((w.items || []).map((it) => it?.sym || it?.ticker)) }))
      .filter((w) => w.symbols.length)
  } catch {
    return []
  }
}

/** A symbol's theme / sector / industry name, from `GET /api/ticker-meta/{sym}`; null if none. */
export async function groupNameFor(sym, type) {
  try {
    const r = await fetch(`/api/ticker-meta/${encodeURIComponent(sym)}`)
    if (!r.ok) return null
    const j = await r.json()
    const name = j?.[type]
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch {
    return null
  }
}

/** What each quadrant means, in plain words (the benchmark is SPY). */
export const QUADRANT_WORDS = {
  Leading: 'stronger than SPY and gaining on it',
  Weakening: 'stronger than SPY but losing ground',
  Lagging: 'weaker than SPY and losing ground',
  Improving: 'weaker than SPY but gaining on it',
}
