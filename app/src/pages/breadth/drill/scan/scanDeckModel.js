// Scan Deck — the pure half of the breadth drill's scanning window.
//
// Everything here is plain data in, plain data out: filters, the composition
// bar, the day-context strip, the selected stock's bar-derived facts, and the
// reviewed/skipped store. No React, so every rule is unit-testable and the
// components stay thin.

// ── Filters ──────────────────────────────────────────────────────────────────
// Each filter reads ONE field and says what it needs. A filter whose field is
// absent for this drill (a recorded day carries no live quote, so no DCR) is
// reported as unavailable rather than silently matching nothing — an empty list
// would read as "nothing qualified", which is a wrong answer, not a missing one.
//
// `dir` is the drill's direction: +1 for an up list, -1 for a down list. A
// strong close means the top of the range on an up day and the bottom on a down
// day, so the DCR chip flips with it.
export const SCAN_FILTERS = [
  { key: 'mcap1b', label: 'Mcap > $1B', field: 'mcap', test: (r) => r.mcap >= 1e9 },
  { key: 'rvol2', label: 'RVOL ≥ 2', field: 'rvol', test: (r) => r.rvol >= 2 },
  { key: 'price10', label: 'Price > $10', field: 'price', test: (r) => r.price > 10 },
  { key: 'dcrStrong', label: 'Strong close', field: 'dcr', test: (r, dir) => (dir < 0 ? r.dcr <= 30 : r.dcr >= 70),
    title: 'Closed in the top 30% of the day’s range (bottom 30% on a down list)' },
  { key: 'firstTime', label: 'First appearance', field: 'repeat', test: (r) => r.repeat === 0,
    title: 'Not in this list on any of the previous 5 sessions' },
]

const FILTER_BY_KEY = Object.fromEntries(SCAN_FILTERS.map(f => [f.key, f]))

/** Which filters have data for at least one row of this drill. */
export function availableFilters(rows) {
  const out = new Set()
  for (const f of SCAN_FILTERS) {
    if (rows.some(r => Number.isFinite(r?.[f.field]))) out.add(f.key)
  }
  return out
}

/**
 * Keep the rows that pass every ACTIVE and AVAILABLE filter.
 * A row missing the field an active filter reads is dropped: "RVOL ≥ 2" cannot
 * be claimed for a stock whose RVOL is unknown.
 */
export function applyFilters(rows, active, { dir = 1, available = null } = {}) {
  const keys = [...(active || [])].filter(k => FILTER_BY_KEY[k] && (!available || available.has(k)))
  if (!keys.length) return rows
  return rows.filter(r => keys.every(k => {
    const f = FILTER_BY_KEY[k]
    return Number.isFinite(r?.[f.field]) && f.test(r, dir)
  }))
}

// ── Grouping / composition ───────────────────────────────────────────────────
export const UNCLASSIFIED = 'Unclassified'
// Group colours by rank (largest group first). Muted so they tag, not shout.
export const GROUP_HUES = ['#7f8fd6', '#c9a84c', '#3fae74', '#c45f9a', '#4fb3b9', '#d98245', '#9a7fe0', '#9fb86a', '#8ea4c8', '#b08968']

/**
 * Bucket rows by a dimension. Sorted by count desc, then name, with
 * Unclassified always last (it is "we don't know", not a real group).
 * Each group carries its share of the list and its average % change.
 */
export function composition(rows, labelOf) {
  const m = new Map()
  for (const r of rows) {
    const k = labelOf(r) || UNCLASSIFIED
    let g = m.get(k)
    if (!g) { g = { key: k, count: 0, sumPct: 0, nPct: 0, syms: [] }; m.set(k, g) }
    g.count += 1
    g.syms.push(r.sym)
    if (Number.isFinite(r.pct)) { g.sumPct += r.pct; g.nPct += 1 }
  }
  const total = rows.length || 1
  return [...m.values()]
    .map(g => ({ key: g.key, count: g.count, share: g.count / total,
                 avgPct: g.nPct ? g.sumPct / g.nPct : null, syms: g.syms }))
    .sort((a, b) => {
      if ((a.key === UNCLASSIFIED) !== (b.key === UNCLASSIFIED)) return a.key === UNCLASSIFIED ? 1 : -1
      return b.count - a.count || a.key.localeCompare(b.key)
    })
}

// ── Day context ──────────────────────────────────────────────────────────────
/**
 * The strip above the list: this cell's value, where it ranks against the last
 * `window` sessions, Health, and a series for the sparkline (oldest first).
 *
 * `rows` is the page's breadth rows NEWEST FIRST (that is how Breadth.jsx holds
 * them). The live row is skipped for the ranking window so an unfinished session
 * is never ranked against settled ones — but it can still be the row shown.
 */
export function dayContext(rows, colKey, date, { window = 252, spark = 60, live = false } = {}) {
  if (!Array.isArray(rows) || !colKey) return null
  const idx = rows.findIndex(r => (live ? r?._live : (!r?._live && r?.date === date)))
  if (idx < 0) return null
  const row = rows[idx]
  const value = num(row[colKey])
  const settled = rows.filter(r => !r?._live)
  const startIdx = live ? 0 : Math.max(0, settled.indexOf(row))
  const hist = settled.slice(startIdx, startIdx + window).map(r => num(r[colKey])).filter(Number.isFinite)
  let pctile = null
  if (Number.isFinite(value) && hist.length >= 20) {
    const below = hist.filter(v => v < value).length
    const equal = hist.filter(v => v === value).length
    pctile = Math.round(((below + equal / 2) / hist.length) * 100)
  }
  const sparkRows = settled.slice(startIdx, startIdx + spark).reverse()
  const series = sparkRows.map(r => num(r[colKey]))
  const seriesDates = sparkRows.map(r => r.date)
  if (live && Number.isFinite(value)) { series.push(value); seriesDates.push(null) }
  const sorted = [...hist].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
  return { value, pctile, sample: hist.length, health: num(row.breadth_score), series, seriesDates,
    median, min: sorted.length ? sorted[0] : null, max: sorted.length ? sorted[sorted.length - 1] : null }
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Date stepping ────────────────────────────────────────────────────────────
/**
 * The session before / after `date` among settled rows (newest-first input).
 * From the live row, "previous" is the newest settled day and there is no next.
 * Stepping forward from the newest settled day reaches the live row when there
 * is one.
 */
export function stepDate(rows, date, live, dir) {
  const settled = (rows || []).filter(r => !r?._live && r?.date)
  const hasLive = (rows || []).some(r => r?._live)
  if (live) return dir < 0 && settled[0] ? { date: settled[0].date, live: false } : null
  const i = settled.findIndex(r => r.date === date)
  if (i < 0) return null
  if (dir < 0) return settled[i + 1] ? { date: settled[i + 1].date, live: false } : null
  if (i === 0) return hasLive ? { date: null, live: true } : null
  return { date: settled[i - 1].date, live: false }
}

// ── Bar-derived facts for ONE stock on ONE day ───────────────────────────────
/** Normalise a bar's time to YYYY-MM-DD. Accepts the shapes the bars pipeline
 *  has used: 'YYYY-MM-DD', YYYYMMDD (number or string), unix seconds or ms. */
export function barDate(t) {
  if (t == null) return null
  if (typeof t === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
    if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
    return null
  }
  if (typeof t === 'object' && Number.isFinite(t.year)) {
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
  }
  if (!Number.isFinite(t)) return null
  if (t >= 19000101 && t <= 21001231) {
    const s = String(Math.trunc(t))
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  const ms = t > 1e12 ? t : t * 1000
  // Daily bars are stamped at midnight UTC of their session, so the UTC date IS
  // the session date. (An ET conversion would move it to the evening before.)
  return new Date(ms).toISOString().slice(0, 10)
}

const O = (b) => b?.o ?? b?.open
const H = (b) => b?.h ?? b?.high
const L = (b) => b?.l ?? b?.low
const C = (b) => b?.c ?? b?.close
const V = (b) => b?.v ?? b?.volume

/**
 * DCR, gap, ADR(20) and $ volume for the bar dated `date` (or the newest bar
 * when `date` is null — a live drill). Null when the day is not in the bars.
 * ADR = mean of (high/low − 1) over the 20 sessions ENDING on that day, in %.
 */
export function dayFacts(bars, date, { adrLen = 20 } = {}) {
  if (!Array.isArray(bars) || !bars.length) return null
  const i = date == null ? bars.length - 1 : bars.findIndex(b => barDate(b?.t ?? b?.time) === date)
  if (i < 0) return null
  const b = bars[i]
  const prev = bars[i - 1]
  const h = H(b), l = L(b), c = C(b), o = O(b), v = V(b)
  const dcr = (Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c) && h > l)
    ? Math.max(0, Math.min(100, ((c - l) / (h - l)) * 100)) : null
  const pc = C(prev)
  const gap = (Number.isFinite(o) && Number.isFinite(pc) && pc > 0) ? ((o - pc) / pc) * 100 : null
  const win = bars.slice(Math.max(0, i - adrLen + 1), i + 1)
    .map(x => (Number.isFinite(H(x)) && Number.isFinite(L(x)) && L(x) > 0 ? (H(x) / L(x) - 1) * 100 : null))
    .filter(Number.isFinite)
  const adr = win.length >= Math.min(adrLen, 5) ? win.reduce((a, x) => a + x, 0) / win.length : null
  const dolvol = (Number.isFinite(c) && Number.isFinite(v)) ? c * v : null
  return { dcr, gap, adr, dolvol, open: o ?? null, high: h ?? null, low: l ?? null, close: c ?? null, prevClose: pc ?? null }
}

// ── Reviewed / skipped store ────────────────────────────────────────────────
// Per-browser convenience: which names you have already looked at in THIS list
// on THIS day. Keyed by metric + date, capped so it can never grow without
// bound, newest lists kept. A failure to read or write storage degrades to an
// in-memory session, never to a broken window.
export const REVIEW_LS = 'breadth_scan_reviewed_v1'
export const REVIEW_MAX_LISTS = 40

export function reviewKey(colKey, date, live) {
  return `${colKey || '?'}|${live ? 'live' : (date || '?')}`
}

export function readReview(storage, key) {
  try {
    const all = JSON.parse(storage?.getItem(REVIEW_LS) || '{}')
    const e = all && typeof all === 'object' ? all[key] : null
    return { seen: new Set(Array.isArray(e?.seen) ? e.seen : []), skipped: new Set(Array.isArray(e?.skipped) ? e.skipped : []) }
  } catch {
    return { seen: new Set(), skipped: new Set() }
  }
}

export function writeReview(storage, key, { seen, skipped }, now = Date.now()) {
  try {
    const raw = JSON.parse(storage?.getItem(REVIEW_LS) || '{}')
    const all = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    all[key] = { seen: [...seen], skipped: [...skipped], at: now }
    const keys = Object.keys(all).sort((a, b) => (all[b]?.at || 0) - (all[a]?.at || 0))
    for (const k of keys.slice(REVIEW_MAX_LISTS)) delete all[k]
    storage?.setItem(REVIEW_LS, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────
export function fmtPct(v, d = 1, sign = true) {
  if (!Number.isFinite(v)) return '—'
  return `${sign && v > 0 ? '+' : ''}${v.toFixed(d)}%`
}

export function fmtCap(v) {
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`
  return `$${Math.round(v / 1e3)}K`
}

// ── The reading, in words ────────────────────────────────────────────────────
// "14th pctile · 1Y" made people ask what they were looking at. The masthead
// says the same thing as a verdict and a sentence: how today's count compares
// with a normal day over the last year.
export const READING_BANDS = [
  { min: 90, tone: 'hot', label: 'Unusually high' },
  { min: 70, tone: 'up', label: 'Above normal' },
  { min: 30, tone: 'mid', label: 'Normal' },
  { min: 10, tone: 'dn', label: 'Below normal' },
  { min: -1, tone: 'cold', label: 'Unusually low' },
]

/** { tone, label, sentence } for a dayContext, or null without enough history. */
export function describeReading(ctx) {
  if (!ctx || !Number.isFinite(ctx.pctile) || !Number.isFinite(ctx.value)) return null
  const p = ctx.pctile
  const band = READING_BANDS.find(b => p >= b.min)
  const span = ctx.sample >= 240 ? 'the past year' : `the last ${ctx.sample} sessions`
  let sentence
  if (p >= 50) sentence = `More than on ${p}% of days in ${span}`
  else sentence = `Fewer than on ${100 - p}% of days in ${span}`
  return { tone: band.tone, label: band.label, sentence }
}
