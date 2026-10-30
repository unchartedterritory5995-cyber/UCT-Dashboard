// Trade Exchange News — the widget's pure logic (no React), unit-tested on its own.
//
// ⛔ NOTHING HERE INVENTS DATA. Trade Exchange sends `{source, content}` only, so:
//   * the time shown is the RECEIPT time UCT stamped, labelled as such;
//   * no publication time; the category and impact kind are the SERVER's (categories.py);
//   * tickers are the server resolver's (provisional) list, and a ticker is made
//     clickable only where its own text appears in the headline as sent.

import { formatDateTimeEt, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'

/** `content` split into plain-text and ticker segments, in order.
 *  A ticker matches as `$SYM` or as the bare upper-case word (class shares in either
 *  `BRK-B` or `BRK.B` form). Matching is case-sensitive: "Apple" never links AAPL. */
export function tokenize(content, tickers, mentions = []) {
  const text = String(content || '')
  const syms = [...new Set((tickers || []).map((t) => String(t).toUpperCase()))].filter(Boolean)
  // Company names exactly as written ("MICROSOFT" -> MSFT): the server resolved them
  // with the canonical resolver; the text itself is never rewritten.
  const named = new Map((mentions || []).filter((m) => m && m[0] && m[1]).map(([t, sym]) => [t, String(sym).toUpperCase()]))
  if ((!syms.length && !named.size) || !text) return [{ text }]
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const alts = [
    ...[...named.keys()].sort((a, b) => b.length - a.length).map(esc),
    ...syms.sort((a, b) => b.length - a.length).map((s) => esc(s).replace(/-/g, '[-.]')),
  ]
  const re = new RegExp(`(\\$?)\\b(${alts.join('|')})\\b(?![a-z])`, 'g')
  const out = []
  let last = 0
  let m
  while ((m = re.exec(text))) {
    const start = m.index
    if (start > last) out.push({ text: text.slice(last, start) })
    const raw = m[0]
    const word = m[2]
    const sym = named.get(word) || word.toUpperCase().replace('.', '-')
    out.push({ text: raw, sym: named.has(word) || syms.includes(sym) ? sym : word.toUpperCase(), named: named.has(word) })
    last = start + raw.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Daily-performance tone for one symbol: vs the previous regular-session close
 *  (useRealtimePrices' change_pct). Missing or stale data is neutral, never a guess. */
export function tickerTone(quote, stale = false) {
  const pct = quote?.change_pct
  if (stale || typeof pct !== 'number' || !Number.isFinite(pct)) return 'none'
  if (pct > 0) return 'up'
  if (pct < 0) return 'down'
  return 'flat'
}

/** Hover text for a symbol: identification always, price details only when reliable. */
export function tickerTitle(sym, quote, stale = false, { named = false } = {}) {
  const head = named ? `${sym} (named in the headline)` : sym
  const px = quote?.price
  const pct = quote?.change_pct
  if (stale || typeof px !== 'number' || typeof pct !== 'number') return `${head} · open on linked charts`
  const at = quote.updated_at || quote.timestamp
  const when = at ? ` · as of ${formatTimeEt(typeof at === 'number' && at < 1e12 ? at * 1000 : at, { seconds: true })} ET` : ''
  return `${head} · $${px.toFixed(px >= 100 ? 2 : px >= 1 ? 2 : 4)} · ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% vs prior close${when} · open on linked charts`
}

/** The symbols whose quotes the widget asks for: the newest rows first, distinct,
 *  bounded (one shared price-stream connection's worth). Rows beyond stay neutral. */
export const QUOTE_SYMBOL_CAP = 50
export function quoteSymbols(items, cap = QUOTE_SYMBOL_CAP) {
  const out = []
  const seen = new Set()
  for (const it of items || []) {
    for (const t of it.tickers || []) {
      if (seen.has(t)) continue
      seen.add(t)
      out.push(t)
      if (out.length >= cap) return out
    }
  }
  return out
}

/** Case-insensitive search over the headline text and its tickers. */
export function matchesQuery(item, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  if ((item.content || '').toLowerCase().includes(q)) return true
  return (item.tickers || []).some((t) => String(t).toLowerCase() === q.replace(/^\$/, ''))
}

/** The server classifier's categories (api/services/trade_exchange_news/categories.py
 *  CATEGORIES), in toolbar order. The widget filters on `item.category`; it never
 *  classifies anything itself. */
export const CATEGORY_FILTERS = ['News', 'Macro', 'Options', 'Earnings', 'Price', 'Press Release', 'Filing', 'Other']

/** A saved category selection, cleaned: known categories only, toolbar order. Empty = All. */
export function cleanCategories(raw) {
  const want = new Set(Array.isArray(raw) ? raw : [])
  return CATEGORY_FILTERS.filter((c) => want.has(c))
}

/** The filter button's label: "All", one category, or "3 types". */
export function categoriesLabel(categories) {
  const c = cleanCategories(categories)
  return !c.length || c.length === CATEGORY_FILTERS.length ? 'All' : c.length === 1 ? c[0] : `${c.length} types`
}

/** Items passing every active filter (AND), NEWEST FIRST (seq descending).
 *  `linkedSym`: only headlines naming the widget's colour-group symbol.
 *  `watchSet`: a Set of symbols (a watchlist) — headlines naming any of them.
 *  `categories`: the selected categories (empty = all). */
export function visibleItems(items, { query = '', linkedSym = null, watchSet = null, hidePlaceholders = false, categories = null } = {}) {
  const cats = categories && categories.length && categories.length < CATEGORY_FILTERS.length ? new Set(categories) : null
  const out = []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    // A graphic-only placeholder ("CRYPTO" without its picture) is kept in storage
    // and counted in the footer -- hidden from the feed, never lost.
    if (hidePlaceholders && it.placeholder === 'graphic') continue
    if (cats && !cats.has(it.category || 'Other')) continue
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

// ── market-impact marks ──────────────────────────────────────────────────────
//
// ⭐ The SERVER decides (categories.impact_for: plain rules over the text, no
// model, no score); the widget only words it. "Breaking" is the same mark while
// the headline is fresh: received in the last BREAKING_MS and not recovered late.

/** Mirrors categories.IMPACT_REASONS word for word. */
export const IMPACT_REASONS = {
  halt: 'Trading halt or resumption',
  central_bank: 'Central-bank rate decision',
  econ_release: 'Major economic release (with a figure)',
  mna: 'Merger or acquisition agreement',
  bankruptcy: 'Bankruptcy filing',
  regulatory: 'Regulatory decision (FDA, SEC, DOJ)',
  guidance: 'Guidance raised, cut or withdrawn',
  leadership: 'CEO departure',
}
export const BREAKING_MS = 5 * 60_000
export const IMPACT_CRITERIA = `Marked only when the headline plainly reports: ${
  Object.values(IMPACT_REASONS).join('; ').toLowerCase()
}. Fixed rules over the text: no prediction, no score. "Breaking" = such a headline received in the last 5 minutes.`

/** { label, title, breaking } for a marked headline, or null. */
export function impactMark(item, nowMs = Date.now()) {
  const reason = IMPACT_REASONS[item?.impact]
  if (!reason) return null
  const breaking = !item.delayed && nowMs - (item.received_at_ms || 0) < BREAKING_MS
  return { label: breaking ? 'Breaking' : 'High impact', breaking, title: `${reason}. ${IMPACT_CRITERIA}` }
}

// ── related-headline grouping ────────────────────────────────────────────────
//
// ⛔ MEASURED BEFORE IT SHIPPED (544 production headlines, 2026-10-29): topic-level
// similarity is NOT reliable -- earnings boilerplate from different companies
// overlaps 60-70% word for word. What IS reliable is the same story sent again in
// near-identical words (on another label, or re-sent after the dedupe window). So a
// group is: >= 90% of the same words, within GROUP_WINDOW_MS of the group's newest
// headline, and never two headlines naming DIFFERENT tickers. Every headline keeps
// its own row, time and links inside the group.
export const GROUP_WINDOW_MS = 15 * 60_000
export const GROUP_MIN_WORDS = 4
export const GROUP_SIMILARITY = 0.9
const GROUP_LOOKBACK = 40               // open groups compared per headline: bounded work
const GROUP_STOP = new Set('the a an of to in on for and or by with at from as is are be its it this that says said'.split(' '))
const _words = new WeakMap()
function wordsOf(it) {
  let w = _words.get(it)
  if (!w) {
    w = new Set((String(it.content || '').toLowerCase().match(/[a-z0-9%]+(?:[.,][0-9]+)?/g) || [])
      .filter((t) => t.length > 1 && !GROUP_STOP.has(t)))
    _words.set(it, w)
  }
  return w
}

/** Two headlines tell the same story in (nearly) the same words. */
export function relatedHeadlines(a, b) {
  const A = wordsOf(a)
  const B = wordsOf(b)
  if (A.size < GROUP_MIN_WORDS || B.size < GROUP_MIN_WORDS) return false
  const ta = a.tickers || []
  const tb = b.tickers || []
  if (ta.length && tb.length && !ta.some((t) => tb.includes(t))) return false
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter) >= GROUP_SIMILARITY
}

/** `items` newest first -> [{ key, lead, rest }] newest first. `rest` holds the older
 *  members, newest first (empty for an ungrouped headline). `key` is the group's
 *  OLDEST seq, so it stays put while newer updates join. */
export function groupRelated(items) {
  const groups = []
  const open = []                       // groups still inside the window, newest first
  for (let i = items.length - 1; i >= 0; i--) {       // oldest -> newest
    const it = items[i]
    const t = it.received_at_ms || 0
    let home = null
    for (let k = 0; k < open.length && k < GROUP_LOOKBACK; k++) {
      const g = open[k]
      if (t - (g.lead.received_at_ms || 0) > GROUP_WINDOW_MS) continue
      if (relatedHeadlines(g.lead, it)) { home = g; break }
    }
    if (home) {
      home.rest.unshift(home.lead)
      home.lead = it
      open.splice(open.indexOf(home), 1)
      open.unshift(home)
    } else {
      const g = { key: it.seq, lead: it, rest: [] }
      groups.push(g)
      open.unshift(g)
      if (open.length > GROUP_LOOKBACK) open.length = GROUP_LOOKBACK
    }
  }
  groups.sort((a, b) => b.lead.seq - a.lead.seq)
  return groups
}

// ── feed health ──────────────────────────────────────────────────────────────

const _ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

/** The LIVE popover's lines: [{ key, label, value, tone }]. Every line says only what
 *  this browser knows -- UCT's connection is never passed off as the provider's. */
export function feedHealth(state, nowMs = Date.now()) {
  const s = state || {}
  const items = s.items || []
  const conn = liveStatus(s, nowMs)
  let newest = 0
  let recovered = 0
  for (const it of items) {
    if ((it.received_at_ms || 0) > newest) newest = it.received_at_ms
    if (it.delayed) recovered++
  }
  const replaying = s.status === 'live' && (s.replayUntil || 0) > (s.lastSeq || 0)
  const gaps = s.coverage?.gaps || []
  const measured = typeof s.lastLatencyMs === 'number' && s.lastLatencyAt
  const reconnecting = s.status === 'reconnecting' || s.status === 'dropped'
  return [
    { key: 'connection', label: 'UCT connection', tone: conn.tone,
      value: conn.tone === 'live' ? 'Connected — live stream open' : conn.label },
    { key: 'latest', label: 'Latest headline', tone: 'none',
      value: newest ? `${fmtReceived(newest, nowMs)} ET · ${_ago(nowMs - newest)} · received by UCT` : 'None received yet' },
    { key: 'provider', label: 'Trade Exchange', tone: 'none',
      value: 'A live connection does not mean Trade Exchange is publishing: a quiet feed and a silent provider look the same here.' },
    { key: 'sync', label: 'Sync', tone: replaying || reconnecting ? 'warn' : 'none',
      value: s.status === 'live' ? (replaying ? `Replaying missed headlines (to #${s.replayUntil})` : 'Caught up')
        : reconnecting ? 'Reconnecting — missed headlines replay in order on return' : '—' },
    { key: 'recovery', label: 'Recovery', tone: 'none',
      value: recovered ? `${recovered} loaded headline${recovered === 1 ? '' : 's'} reached UCT late and ${recovered === 1 ? 'was' : 'were'} recovered (marked delayed)`
        : 'No recovered headlines in the loaded history' },
    { key: 'gaps', label: 'Delivery gaps', tone: gaps.length ? 'warn' : 'none',
      value: gaps.length ? coverageNotice(s.coverage, nowMs).text : 'None known' },
    { key: 'latency', label: 'Latency', tone: 'none',
      value: measured ? `${(s.lastLatencyMs / 1000).toFixed(1)} s from UCT receipt to this screen · measured ${_ago(nowMs - s.lastLatencyAt)}`
        : 'Not measured yet in this browser (needs a live headline in a visible tab)' },
  ]
}

// ── saved presets (per widget, in opts.presets) ──────────────────────────────

export const PRESET_SETTING_KEYS = ['longHeadlines', 'groupRelated', 'impactMarks']
export const MAX_PRESETS = 12

/** The widget's current filters + display preferences, as a preset body. */
export function presetSnapshot(opts, settings, query = '') {
  const o = opts || {}
  return {
    categories: cleanCategories(o.categories),
    linked: !!o.linked,
    watchlistId: typeof o.watchlistId === 'string' ? o.watchlistId : '',
    query: String(query || '').slice(0, 80),
    settings: Object.fromEntries(PRESET_SETTING_KEYS.map((k) => [k, settings?.[k]]).filter(([, v]) => v != null)),
  }
}

/** The opts patch that applies `preset`: this widget's filters and display only --
 *  never a chart symbol, a colour, or anything outside this widget. */
export function presetPatch(settings, preset) {
  const p = preset || {}
  const keep = Object.fromEntries(Object.entries(p.settings || {}).filter(([k]) => PRESET_SETTING_KEYS.includes(k)))
  return {
    categories: cleanCategories(p.categories),
    linked: !!p.linked,
    watchlistId: p.watchlistId || null,
    presetId: p.id || null,
    settings: { ...(settings || {}), ...keep },
  }
}

/** opts.presets, cleaned (tolerates garbled blobs). */
export function cleanPresets(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim())
    .slice(0, MAX_PRESETS)
}

// ── numbered pages of the retained archive ───────────────────────────────────
//
// ⭐ The SERVER filters and cuts every page (api/services/trade_exchange_news/
// pages.py mirrors visibleItems), over the whole retained archive -- never just
// the rows this browser holds. Page 1 is the live edge; pages 2+ are cut from a
// snapshot (`seq <= top`) fixed when the reader left page 1, so arriving headlines
// never shift a page while it is being read.

export const PAGE_SIZE = 25

/** The page request for a widget's filters (null `symbols` = no watchlist filter). */
export function pageRequest({ query = '', linkedSym = null, watchSet = null, categories = null, hidePlaceholders = false } = {}) {
  return {
    query: String(query || '').trim().slice(0, 80),
    categories: cleanCategories(categories),
    symbol: linkedSym || null,
    symbols: watchSet ? [...watchSet].sort() : null,
    hide_placeholders: !!hidePlaceholders,
    size: PAGE_SIZE,
  }
}

/** Page 1: the newest `size` rows of the server's newest page and the live pool's
 *  matches together. Exact: the pool is a contiguous run of the newest headlines,
 *  so every match newer than the server's page is in it. A pool row wins a tie
 *  (its repeat count is the live one). `poolMatches` newest first. */
export function livePage(serverItems, poolMatches, size = PAGE_SIZE) {
  const bySeq = new Map()
  for (const it of serverItems || []) bySeq.set(it.seq, it)
  for (const it of poolMatches || []) bySeq.set(it.seq, it)
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq).slice(0, size)
}

/** How many of `items` (newest first) arrived after the snapshot `top`. */
export function newerThan(items, top) {
  let n = 0
  for (const it of items || []) {
    if (it.seq > top) n++
    else break
  }
  return n
}

export const pageCount = (total, size = PAGE_SIZE) => (typeof total === 'number' ? Math.max(1, Math.ceil(total / size)) : null)

/** A typed page number: a whole number within 1..pages, else null. */
export function parsePageInput(raw, pages) {
  const t = String(raw ?? '').trim()
  if (!/^\d{1,6}$/.test(t)) return null
  const n = Number(t)
  if (n < 1 || (typeof pages === 'number' && n > pages)) return null
  return n
}

/** The footer's archive note: how far back the retained history actually reaches. */
export function archiveTitle(oldestMs, nowMs = Date.now()) {
  const back = oldestMs ? `back to ${fmtReceived(oldestMs, nowMs)}${_etDay(oldestMs) === _etDay(nowMs) ? ' ET' : ''}` : 'empty so far'
  return `The retained archive reaches ${back}. UCT keeps about 7 days of headlines, up to 5,000; nothing older is available.`
}
