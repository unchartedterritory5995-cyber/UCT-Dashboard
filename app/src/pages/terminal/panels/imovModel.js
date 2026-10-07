// IMOV — which names are driving a UCT theme's move (feature-gaps-2026-10-06 #4). Pure: no React,
// no fetch.
//
// ⭐ EQUAL WEIGHT, BECAUSE THAT IS WHAT A UCT THEME IS. A theme's return in the Theme Tracker is a
// basket of its members held in equal weight, so one name's contribution over a window is simply
// its return ÷ N (N = the members with a return for that window), and the contributions add up to
// the plain equal-weight return of the basket. Nothing here is an index weight.
//
// ⛔ NEVER AN INDEX. SPY, QQQ, a sector SPDR, or any ETF a theme uses as its proxy moves on its OWN
// (cap) weights, which UCT does not hold. Dividing an ETF's move by N would be a fabricated index
// contribution, so `refusalFor` turns those away (Bloomberg's `MOV` is a different question).
//
// ⛔ ENGINE-OVERLAY MEMBERS DO NOT COUNT. `theme_db` / `services/groups.py`: an engine-added member
// (`source: 'engine'`) keeps its own row but must never move a theme aggregate. The basket rule
// below mirrors `theme_performance._theme_owner_syms` exactly: every holding whose source is not
// 'engine' (an absent source is an owner), plus the theme's `_owner_syms` stash.

/** The theme-performance read (the same cached, live-overlaid payload the Theme Tracker polls). */
export const THEMES_URL = '/api/theme-performance'
export const POLL_MS = 30_000

/** The windows IMOV offers → the `returns` key theme_performance writes for each. 1D is the live
 *  overlay; 1W/1M/3M are the live price against the stored reference closes. */
export const IMOV_WINDOWS = Object.freeze({ '1D': '1d', '1W': '1w', '1M': '1m', '3M': '3m' })
export const DEFAULT_WINDOW = '1D'

/** How many contributors and how many detractors are listed by name. */
export const TOP_N = 8

/** Broad index funds and the sector SPDRs: never a theme, always refused. A theme's own ETF proxy
 *  is refused too, but that list is read from the payload (theme `ticker`), never typed here. */
export const INDEX_FUNDS = Object.freeze([
  'SPY', 'VOO', 'IVV', 'SPLG', 'VTI', 'QQQ', 'QQQM', 'ONEQ', 'IWM', 'IJR', 'IJH', 'MDY', 'DIA', 'RSP',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC',
])

/** App-canonical symbol form (BRK.B → BRK-B), theme_performance `_to_hyphen`. */
export const normSym = (s) => String(s || '').trim().toUpperCase().replace(/\./g, '-')

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A theme's stable key: its taxonomy id when enrichment ran, else its wire ticker. */
export const themeKey = (t) => String(t?.theme_id || t?.ticker || t?.name || '')

/** Pure: the themes IMOV can open — every theme in the payload with at least one holding. */
export function themesOf(payload) {
  const list = Array.isArray(payload?.themes) ? payload.themes : []
  return list.filter((t) => t && Array.isArray(t.holdings) && t.holdings.length && themeKey(t))
}

/** Pure: the owner basket (normalised syms), `_theme_owner_syms` to the letter. */
export function ownerSyms(theme) {
  const out = new Set()
  for (const h of theme?.holdings || []) {
    if (h?.sym && (h.source ?? 'owner') !== 'engine') out.add(normSym(h.sym))
  }
  for (const s of theme?._owner_syms || []) out.add(normSym(s))
  return out
}

/**
 * Pure: the contribution read for one theme over one window.
 *   rows       every counted member: { sym, ret, contrib } (contrib = ret ÷ n, percentage points)
 *   n          members with a return for the window (the divisor)
 *   total      Σ contrib — the plain equal-weight return of the basket
 *   unpriced   owner members with no return for the window (named, not in n)
 *   engine     engine-overlay members (shown nowhere in the sum)
 *   published  the Theme Tracker's own figure for the window (`group_return`), when it has one
 */
export function contributionRead(theme, win = DEFAULT_WINDOW) {
  const key = IMOV_WINDOWS[win] || IMOV_WINDOWS[DEFAULT_WINDOW]
  const owners = ownerSyms(theme)
  const seen = new Set()
  const priced = []
  const unpriced = []
  const engine = []
  for (const h of theme?.holdings || []) {
    const sym = normSym(h?.sym)
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    if (!owners.has(sym)) { engine.push(sym); continue }
    const ret = num(h.returns?.[key])
    if (ret == null) unpriced.push(sym)
    else priced.push({ sym, ret })
  }
  const n = priced.length
  const rows = priced.map((r) => ({ ...r, contrib: r.ret / n }))
  const total = n ? rows.reduce((s, r) => s + r.contrib, 0) : null
  return { key, n, rows, total, unpriced, engine, published: num(theme?.group_return?.[key]) }
}

/** Pure: the top contributors and detractors by name, and what the rest add up to, so the three
 *  figures on screen always sum to the total. */
export function splitRead(read, topN = TOP_N) {
  const up = read.rows.filter((r) => r.contrib > 0).sort((a, b) => b.contrib - a.contrib || (a.sym < b.sym ? -1 : 1))
  const down = read.rows.filter((r) => r.contrib < 0).sort((a, b) => a.contrib - b.contrib || (a.sym < b.sym ? -1 : 1))
  const contributors = up.slice(0, topN)
  const detractors = down.slice(0, topN)
  const shown = new Set([...contributors, ...detractors].map((r) => r.sym))
  const rest = read.rows.filter((r) => !shown.has(r.sym))
  const restSum = rest.reduce((s, r) => s + r.contrib, 0)
  return { contributors, detractors, restCount: rest.length, restSum }
}

/** Pure: whether the Theme Tracker's own figure differs from the equal-weight sum by more than
 *  rounding (it caps the top ~10% of gainers; UCT 20 uses its portfolio NAV past 1D). */
export function trackerDiffers(read) {
  return read.published != null && read.total != null && Math.abs(read.published - read.total) >= 0.005
}

/** Pure: the themes whose owner basket holds `sym`, by name. */
export function themesHolding(themes, sym) {
  const s = normSym(sym)
  if (!s) return []
  return themes.filter((t) => ownerSyms(t).has(s)).sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** Pure: the themes that use `sym` as their ETF proxy (the wire key). */
export function themesProxiedBy(themes, sym) {
  const s = normSym(sym)
  return s ? themes.filter((t) => normSym(t.ticker) === s) : []
}

/**
 * Pure: why IMOV will not open `sym`, or null. An index fund, or an ETF a theme uses as its proxy,
 * is refused: its move is cap-weighted and UCT holds no index weights. `proxies` are the UCT themes
 * the ETF stands in for, offered by name as a different (equal-weight) question.
 */
export function refusalFor(themes, sym) {
  const s = normSym(sym)
  if (!s) return null
  const proxies = themesProxiedBy(themes, s)
  if (INDEX_FUNDS.includes(s)) return { sym: s, kind: 'index', proxies }
  if (proxies.length) return { sym: s, kind: 'etf', proxies }
  return null
}

/** Pure: the theme moving most (either way) over a window, the default when nothing was asked. */
export function biggestMover(themes, win = DEFAULT_WINDOW) {
  let best = null
  let bestAbs = -1
  for (const t of themes) {
    const r = contributionRead(t, win)
    if (r.total == null) continue
    const a = Math.abs(r.total)
    if (a > bestAbs) { best = t; bestAbs = a }
  }
  return best
}
