/**
 * Pure model for the News tab. No React, no DOM — everything here is a
 * function of the API payload, so the feed's behaviour is testable without
 * mounting a component.
 *
 * The panel renders a WIRE, not a table: the shaping rules below are about
 * chronology, source trust and density rather than columns.
 */

/** Source classes, most trusted first. Mirrors the backend registry. */
export const SOURCE_CLASS = {
  primary: { label: 'Primary', rank: 0 },
  wire: { label: 'Wire', rank: 1 },
  journalism: { label: 'News', rank: 2 },
  social: { label: 'Social', rank: 3 },
}

/** Categories we actually surface. Anything else renders no chip at all. */
const CATEGORY_LABEL = {
  earnings: 'Earnings', guidance: 'Guidance', analyst: 'Analyst',
  'm&a': 'M&A', product: 'Product', contract: 'Contract',
  management: 'Management', financing: 'Financing', buyback: 'Buyback',
  dividend: 'Dividend', legal: 'Legal', regulatory: 'Regulatory',
  sec: 'Filing', industry: 'Industry', macro: 'Macro',
}

export function categoryLabel(cat) {
  return CATEGORY_LABEL[String(cat || '').toLowerCase()] || ''
}

/**
 * Relative age, wire-style. Minutes for the first hour, then hours, then the
 * clock time for today and a date beyond that — a trader reads "12m" far
 * faster than a timestamp, but a three-day-old story wants its date.
 */
export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return ''
  const secs = Math.max(0, (now - t) / 1000)
  if (secs < 60) return 'now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The time shown on a row that already sits under a date separator.
 * Relative while a story is fresh, then EMPTY — the group header already
 * carries the day, so "Aug 26" under a header reading "AUG 26", or "1d"
 * under one reading "YESTERDAY", is the same fact printed twice. Anything
 * inside 24h still earns a time, because "12m" vs "20h" is real information
 * that "Today" does not carry.
 */
export const ROW_TIME_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function rowTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return ''
  if (now - t > ROW_TIME_MAX_AGE_MS) return ''
  return relTime(iso, now)
}

/** Exact publication time for the expanded row. */
export function exactTime(iso) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function startOfDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** TODAY / YESTERDAY / SEP 5 — the separator label for a story's date. */
export function dayLabel(iso, now = Date.now()) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return ''
  const today = startOfDay(now)
  const day = startOfDay(t)
  if (day === today) return 'Today'
  if (day === today - 86400000) return 'Yesterday'
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The source line. SEC filings say what they are ("SEC · 8-K"); everything
 * else is its publisher. §12: trust is communicated by naming the source
 * accurately, not by a badge.
 */
export function sourceLabel(item) {
  if (!item) return ''
  if (item.source_class === 'primary' && item.form_type) {
    return `SEC · ${item.form_type}`
  }
  return item.source || ''
}

/**
 * BREAKING (§32) — deterministic, or absent. Requires ALL of:
 *   under 45 minutes old, a high-trust source, and a material category.
 * A definition weaker than this would make it decoration.
 */
const BREAKING_CATEGORIES = new Set([
  'earnings', 'guidance', 'm&a', 'management', 'regulatory', 'legal', 'sec',
])
export const BREAKING_MAX_AGE_MS = 45 * 60 * 1000

export function isBreaking(item, now = Date.now()) {
  if (!item) return false
  const t = Date.parse(item.published_at || '')
  if (!Number.isFinite(t)) return false
  if (now - t > BREAKING_MAX_AGE_MS || now - t < 0) return false
  if (item.source_class !== 'primary' && item.source_class !== 'wire') return false
  return BREAKING_CATEGORIES.has(String(item.category || '').toLowerCase())
}

/**
 * Group a flat, already-chronological list into date sections.
 * Order is preserved exactly — this never re-ranks (§21).
 */
export function groupByDay(items, now = Date.now()) {
  const out = []
  let current = null
  for (const it of items || []) {
    const label = dayLabel(it.published_at, now)
    if (!current || current.label !== label) {
      current = { label, key: `${label}-${out.length}`, items: [] }
      out.push(current)
    }
    current.items.push(it)
  }
  return out
}

/**
 * Merge a newly-loaded page into the existing feed.
 * Dedupes on id, because a story arriving mid-scroll must never appear twice.
 */
export function mergePage(existing, incoming) {
  const seen = new Set((existing || []).map(i => i.id))
  const add = (incoming || []).filter(i => i && !seen.has(i.id))
  return [...(existing || []), ...add]
}

/** Whether a story has media worth indicating in the collapsed row. */
export function mediaKind(item) {
  if (!item) return ''
  if (item.media_type === 'video' && item.embed_url) return 'video'
  if (item.image_url) return 'image'
  return ''
}

/** Description lines shown collapsed, by panel width (§39). */
export function descLines(width) {
  if (width < 330) return 1
  if (width < 560) return 2
  return 3
}

/** Build the query string for the feed request. */
export function feedQuery({ limit = 25, cursor = '', sentiment = 'all', q = '' } = {}) {
  const p = new URLSearchParams()
  p.set('limit', String(limit))
  if (cursor) p.set('cursor', cursor)
  if (sentiment && sentiment !== 'all') p.set('sentiment', sentiment)
  const term = (q || '').trim()
  if (term) p.set('q', term)
  return p.toString()
}

/**
 * The empty-state message. §37: a sparse feed is a real result of quality
 * filtering, so it is stated plainly rather than apologised for.
 */
export function emptyMessage({ sym, sentiment, query }) {
  if (query) return `No stored ${sym} stories match “${query}”.`
  if (sentiment === 'bullish') return `No bullish ${sym} stories in the feed.`
  if (sentiment === 'bearish') return `No bearish ${sym} stories in the feed.`
  return `No recent high-quality news for ${sym}.`
}

export function emptyHint({ sentiment, query }) {
  if (query) return 'Try a different term, or clear the search.'
  if (sentiment && sentiment !== 'all') return 'Clear the filter to see everything.'
  return 'Filings and company releases will appear here as they are published.'
}
