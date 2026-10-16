// app/src/utils/traderArchive.js
//
// Shared by the /trader-archive page and the research modal's "What the traders said"
// block. The server (api/routers/wisdom_archive.py, require_paid, WISDOM_ARCHIVE_ENABLED)
// is the one authority for every list, count and trader name; this file only formats.
//
// ⛔ A 404 means the archive flag is off, a 402 means no paid plan: both are STATES the
// surfaces render (or hide), never "nothing found".

export const ARCHIVE_API = '/api/wisdom/archive'

/** An edge is called measured only at |z| >= 3, the same line Ask AI and Compass use. */
export const EDGE_Z = 3
/** A context cut shows only when it rests on at least this many scored calls. */
export const MIN_CONTEXT_N = 30

/** 'measured edge (z …)' / 'not proven (z …)' for a playbook stats block. */
export function edgeVerdict(st) {
  if (!st?.n_scored) return 'no scored calls'
  if (st.edgeR_z === null || st.edgeR_z === undefined) return 'z unavailable'
  return Math.abs(st.edgeR_z) >= EDGE_Z && st.n_scored >= MIN_CONTEXT_N
    ? `measured edge (z ${st.edgeR_z})`
    : `not proven (z ${st.edgeR_z})`
}

/** An outcome fraction (0.1) as a signed percent ("+10.0%"); missing → em dash. */
export function fmtR(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—'
  const pct = Number(value) * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

/** 'up' | 'down' | 'flat' | null for colouring an outcome. */
export function rTone(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null
  const n = Number(value)
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

/** The server's display name, falling back to the raw slug. */
export const traderOf = (row) => row?.trader || row?.author_id || 'Unknown'

/** The date part of an ISO-ish stamp. */
export const dayOf = (value) => (typeof value === 'string' ? value.slice(0, 10) : '')

/** Colour + dash per role of the team's reference lines (server: api/services/wisdom/archive/levels.py). */
const REF_LINE_STYLE = {
  trigger: { color: '#c9a84c', lineStyle: 2 },
  entry: { color: '#60a5fa', lineStyle: 2 },
  stop: { color: '#f87171', lineStyle: 2 },
}

/**
 * The server's reference lines ([{role, kind, price, label}]) as StockChart `priceLines`.
 * The server owns every formula and every label; this only styles them. Two lines at the same
 * price (pullback_ma's prior-day low is both an entry and a stop line) become one line carrying
 * both labels. Anything that is not a list of priced lines draws nothing.
 */
export function archiveRefPriceLines(lines) {
  if (!Array.isArray(lines)) return []
  const byPrice = new Map()
  for (const l of lines) {
    const price = Number(l?.price)
    if (!Number.isFinite(price) || price <= 0 || !l?.label) continue
    const key = price.toFixed(4)
    const seen = byPrice.get(key)
    if (seen) {
      if (!seen.title.includes(l.label)) seen.title = `${seen.title} / ${l.label}`
      continue
    }
    const style = REF_LINE_STYLE[l.role] || REF_LINE_STYLE.trigger
    byPrice.set(key, { price, color: style.color, lineStyle: style.lineStyle, lineWidth: 1,
      axisLabelVisible: true, title: l.label, _archiveRef: true })
  }
  return [...byPrice.values()]
}

export function clip(text, n = 240) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}
