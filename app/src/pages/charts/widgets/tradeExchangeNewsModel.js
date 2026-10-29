// Trade Exchange News — the widget's pure logic (no React), unit-tested on its own.
//
// ⛔ NOTHING HERE INVENTS DATA. Trade Exchange sends `{source, content}` only, so:
//   * the time shown is the RECEIPT time UCT stamped, labelled as such;
//   * there are no categories, no urgency, no publication time;
//   * tickers are the server resolver's (provisional) list, and a ticker is made
//     clickable only where its own text appears in the headline as sent.

import { formatDateTimeEt, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'

/** `content` split into plain-text and ticker segments, in order.
 *  A ticker matches as `$SYM` or as the bare upper-case word (class shares in either
 *  `BRK-B` or `BRK.B` form). Matching is case-sensitive: "Apple" never links AAPL. */
export function tokenize(content, tickers) {
  const text = String(content || '')
  const syms = [...new Set((tickers || []).map((t) => String(t).toUpperCase()))].filter(Boolean)
  if (!syms.length || !text) return [{ text }]
  const alts = syms
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[-.]'))
  const re = new RegExp(`(\\$?)\\b(${alts.join('|')})\\b(?![a-z])`, 'g')
  const out = []
  let last = 0
  let m
  while ((m = re.exec(text))) {
    const start = m.index
    if (start > last) out.push({ text: text.slice(last, start) })
    const raw = m[0]
    const sym = m[2].toUpperCase().replace('.', '-')
    out.push({ text: raw, sym: syms.includes(sym) ? sym : m[2].toUpperCase() })
    last = start + raw.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Case-insensitive search over the headline text and its tickers. */
export function matchesQuery(item, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  if ((item.content || '').toLowerCase().includes(q)) return true
  return (item.tickers || []).some((t) => String(t).toLowerCase() === q.replace(/^\$/, ''))
}

/** Items passing every active filter, NEWEST FIRST (seq descending).
 *  `linkedSym`: only headlines naming the widget's colour-group symbol.
 *  `watchSet`: a Set of symbols (a watchlist) — headlines naming any of them. */
export function visibleItems(items, { query = '', linkedSym = null, watchSet = null } = {}) {
  const out = []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    const syms = it.tickers || []
    if (linkedSym && !syms.includes(linkedSym)) continue
    if (watchSet && !syms.some((t) => watchSet.has(t))) continue
    if (!matchesQuery(it, query)) continue
    out.push(it)
  }
  return out
}

const _etDay = (ms) => (formatDateTimeEt(ms / 1000) || '').split(',')[0]

/** UCT's RECEIPT time, market zone, through the shared presentation primitives:
 *  "9:31:05 AM" for today's headlines, "10/24/2026, 9:31:05 AM ET" otherwise. */
export function fmtReceived(ms, nowMs = Date.now()) {
  if (!ms) return ''
  return _etDay(ms) === _etDay(nowMs) ? formatTimeEt(ms, { seconds: true }) : formatDateTimeEt(ms / 1000)
}

/** Tooltip for the category label: derived by UCT, the provider's own label kept. */
export function categoryTitle(item) {
  const src = item?.source ? ` · Trade Exchange label: ${item.source}` : ''
  return `Category (assigned by UCT)${src}`
}

/** The full receipt instant with its zone, for tooltips. */
export const fmtReceivedFull = (ms) => (ms ? formatDateTimeEt(ms / 1000) : '')

/** The live-status pill: { tone: live|warn|off, label, title }.
 *  ⚠️ It reports UCT's connection, not Trade Exchange's: a quiet feed and a silent
 *  provider look the same, so "last headline" is shown rather than claimed. */
export function liveStatus(state, nowMs = Date.now()) {
  const s = state || {}
  const since = s.lastHeadlineAt ? Math.round((nowMs - s.lastHeadlineAt) / 1000) : null
  const ago = since == null ? null : since < 60 ? `${since}s ago` : since < 3600 ? `${Math.round(since / 60)}m ago` : `${Math.round(since / 3600)}h ago`
  switch (s.status) {
    case 'live':
      return { tone: 'live', label: 'Live',
        title: `Connected to UCT's news stream${ago ? ` · last headline ${ago}` : ''}. This shows UCT's connection; it cannot tell whether Trade Exchange itself is publishing.` }
    case 'connecting':
    case 'idle':
      return { tone: 'warn', label: 'Connecting', title: 'Opening the news stream…' }
    case 'reconnecting':
    case 'dropped':
      return { tone: 'warn', label: 'Reconnecting', title: 'Connection lost — reconnecting. Missed headlines are replayed in order when it returns.' }
    case 'unavailable':
      return { tone: 'off', label: unavailableLabel(s.reason), title: unavailableTitle(s.reason) }
    default:
      return { tone: 'off', label: 'Offline', title: 'The news stream could not be opened in this browser.' }
  }
}

function unavailableLabel(reason) {
  return reason === 'admin_only' ? 'Admin preview' : reason === 'signed_out' ? 'Signed out' : 'Unavailable'
}

function unavailableTitle(reason) {
  if (reason === 'admin_only') return 'Trade Exchange News is in admin preview and not yet available on this account.'
  if (reason === 'signed_out') return 'Sign in to see Trade Exchange News.'
  if (reason === 'not_enabled') return 'Trade Exchange News is switched off on this server.'
  return 'Trade Exchange News is unavailable right now.'
}

const GAP_REASON = {
  outage_exceeded_retention: 'UCT was offline longer than the recovery window',
  no_journal: 'recovery storage was not configured while UCT was offline',
  journal_unreachable: 'recovery storage could not be reached',
}

/** A plain-language coverage warning, or null when coverage is complete. */
export function coverageNotice(coverage, nowMs = Date.now()) {
  const gaps = coverage?.gaps || []
  if (!gaps.length) return null
  const g = gaps[gaps.length - 1]
  return {
    text: `Headlines may be missing between ${fmtReceived(g.from_ms, nowMs)} and ${fmtReceived(g.to_ms, nowMs)}`,
    title: `${GAP_REASON[g.reason] || g.reason}. ${gaps.length > 1 ? `${gaps.length} gaps recorded.` : ''}`.trim(),
  }
}
