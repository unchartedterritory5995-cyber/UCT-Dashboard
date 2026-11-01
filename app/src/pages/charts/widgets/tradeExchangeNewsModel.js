// Trade Exchange News — the widget's pure logic (no React), unit-tested on its own.
//
// ⛔ NOTHING HERE INVENTS DATA. Trade Exchange sends `{source, content}` only, so:
//   * the time shown is the RECEIPT time UCT stamped, labelled as such;
//   * no publication time; the category is the SERVER's (categories.py);
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

/** What a search highlights, by the SAME rule as matchesQuery: the whole query as one
 *  phrase (News search is a phrase, not separate words), case-insensitive; a `$SYM`
 *  query highlights the symbol's letters. -> lower-cased needles ([] when no search). */
export function searchNeedles(query) {
  const q = String(query || '').trim().toLowerCase().slice(0, 80)
  if (!q) return []
  const bare = q.startsWith('$') ? q.slice(1) : q
  return [...new Set([q, bare].filter(Boolean))]
}

/** `text` cut into runs, `hit` on EVERY occurrence of any needle (overlaps merged),
 *  original capitals kept -- the UCT Agent's highlightRuns (agent/chatSearch.js), over
 *  News's own needles. Pure text in, pure text out: nothing is parsed as markup. */
export function highlightRuns(text, needles) {
  return runsIn(String(text ?? ''), hitRanges(text, needles), 0)
}

/** Every hit of the needles in `text` as merged [start, end) ranges (case-insensitive). */
export function hitRanges(text, needles) {
  const s = String(text ?? '')
  if (!needles?.length || !s) return []
  const low = s.toLowerCase()
  const ranges = []
  for (const t of needles) {
    if (!t) continue
    for (let i = low.indexOf(t); i !== -1; i = low.indexOf(t, i + t.length)) ranges.push([i, i + t.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

/** One piece of a headline (`text`, starting at `offset` in the whole) cut by the whole
 *  headline's hit ranges -- so a phrase that runs across a ticker link is marked in both. */
export function runsIn(text, ranges, offset = 0) {
  const s = String(text ?? '')
  const runs = []
  let at = 0
  for (const [a0, b0] of ranges || []) {
    const a = Math.max(a0 - offset, 0)
    const b = Math.min(b0 - offset, s.length)
    if (b <= 0 || a >= s.length || b <= a) continue
    if (a > at) runs.push({ text: s.slice(at, a), hit: false })
    runs.push({ text: s.slice(a, b), hit: true })
    at = b
  }
  if (at < s.length || !runs.length) runs.push({ text: s.slice(at), hit: false })
  return runs
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
  outage_exceeded_retention: 'UCT was offline longer than the recovery window (before permanent archiving)',
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

/** The selected day's view, for the feed-health popover (the footer keeps only
 *  the date and time controls): how many headlines, what the times are, and what
 *  is hidden as graphic-only. */
export function viewHealth({ dateLabel = '', count = null, provisional = false, hidden = 0, showing = false } = {}) {
  return [
    { key: 'view', label: 'This view', tone: 'none', value: count ? `${count} · ${dateLabel} (ET)` : dateLabel || '—' },
    { key: 'times', label: 'Times', tone: 'none',
      value: 'When UCT received each headline, in ET (Trade Exchange sends no publication time)' },
    { key: 'tickers', label: 'Tickers', tone: 'none',
      value: provisional ? 'Detected automatically · provisional' : 'Detected automatically' },
    { key: 'graphic', label: 'Graphic-only', tone: 'none',
      value: showing ? 'Shown (⚙ → Graphic-only posts)'
        : hidden > 0 ? `${hidden} hidden: chart captions or labels whose picture the webhook does not carry. Stored, not lost · ⚙ → Graphic-only posts → Show`
          : 'None hidden in this view' },
  ]
}

// ── saved presets (per widget, in opts.presets) ──────────────────────────────

export const PRESET_SETTING_KEYS = ['longHeadlines', 'groupRelated']
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

// ── one America/New_York calendar day at a time ──────────────────────────────
//
// ⭐ The SERVER filters a whole day (api/services/trade_exchange_news/archive.py
// mirrors visibleItems) and serves it newest first by (received_at_ms, seq) in
// cursor steps; the widget scrolls a day continuously and keeps the live pool's
// headlines for that day merged in. Dates are ET calendar dates by UCT's RECEIPT
// time, as 'YYYY-MM-DD'.

export const DAY_LIMIT = 60

/** The day request for a widget's filters (null `symbols` = no watchlist filter). */
export function dayRequest({ query = '', linkedSym = null, watchSet = null, categories = null, hidePlaceholders = false } = {}) {
  return {
    query: String(query || '').trim().slice(0, 80),
    categories: cleanCategories(categories),
    symbol: linkedSym || null,
    symbols: watchSet ? [...watchSet].sort() : null,
    hide_placeholders: !!hidePlaceholders,
  }
}

// ET's offset is a whole number of hours (EDT -4 / EST -5), so every UTC hour lies in
// ONE New York date: one formatter call per hour, not per headline (a day view merges
// up to a thousand live rows on every arrival).
const _etDayByHour = new Map()

/** 'YYYY-MM-DD' of an instant in America/New_York (through the shared ET formatter). */
export function etDateKey(ms) {
  if (!Number.isFinite(ms)) return null
  const hour = Math.floor(ms / 3_600_000)
  const hit = _etDayByHour.get(hour)
  if (hit) return hit
  const head = (formatDateTimeEt(hour * 3600) || '').split(',')[0]          // "10/30/2026"
  const [m, d, y] = head.split('/').map(Number)
  if (!y || !m || !d) return null
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (_etDayByHour.size > 20_000) _etDayByHour.clear()
  _etDayByHour.set(hour, key)
  return key
}

const _parse = (key) => {
  const [y, m, d] = String(key || '').split('-').map(Number)
  return y && m && d ? Date.UTC(y, m - 1, d) : NaN
}
const _key = (utc) => {
  const t = new Date(utc)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/** A calendar date `n` days from `key` (plain date arithmetic, no time zone). */
export const addDays = (key, n) => _key(_parse(key) + n * 86_400_000)

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Thu, Oct 30" (and the year when it is not `todayKey`'s). */
export function dayLabel(key, todayKey = null) {
  const t = new Date(_parse(key))
  if (Number.isNaN(t.getTime())) return ''
  const year = todayKey && String(todayKey).slice(0, 4) !== String(key).slice(0, 4) ? `, ${t.getUTCFullYear()}` : ''
  return `${WEEKDAYS[t.getUTCDay()]}, ${MONTHS[t.getUTCMonth()].slice(0, 3)} ${t.getUTCDate()}${year}`
}

/** "9:30 AM" for 'HH:MM' (24 h). */
export function timeLabel(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return ''
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** A typed time: 'H:MM' / 'HH:MM' (24 h) within the day, else null. */
export function cleanTime(raw) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`
}

/** Six weeks of a month for the calendar, Sunday first: [{ key, inMonth }]. */
export function monthGrid(year, month) {
  const first = Date.UTC(year, month, 1)
  const start = first - new Date(first).getUTCDay() * 86_400_000
  return Array.from({ length: 42 }, (_, i) => {
    const key = _key(start + i * 86_400_000)
    return { key, inMonth: new Date(start + i * 86_400_000).getUTCMonth() === month }
  })
}

/** What the calendar may say about one date, from the server's `days` answer
 *  (never invented): future | unretained | news (count) | empty. */
export function dayStatus(key, meta) {
  if (!meta?.today) return { kind: 'unknown', count: null }
  if (key > meta.today) return { kind: 'future', count: null }
  if (!meta.first_day || key < meta.first_day) return { kind: 'unretained', count: null }
  const hit = (meta.days || []).find((d) => d.date === key)
  return hit ? { kind: 'news', count: hit.count } : { kind: 'empty', count: 0 }
}

/** The day order: newest first by (received_at_ms, seq). */
export const dayCmp = (a, b) => ((b.received_at_ms || 0) - (a.received_at_ms || 0)) || (b.seq - a.seq)

/** One day's rows: the server's slices plus the live pool's headlines OF THAT DAY.
 *  Pool rows are kept only inside the range the server has covered (or above it,
 *  when nothing newer is still to load), so a live row never appears beside a
 *  gap. A pool row wins a tie (its repeat count is the live one). */
export function mergeDay(serverRows, poolMatches, { dateKey, hasNewer = false, hasOlder = false } = {}) {
  const rows = serverRows || []
  const bySeq = new Map(rows.map((it) => [it.seq, it]))
  const top = rows[0]
  const bottom = rows[rows.length - 1]
  for (const it of poolMatches || []) {
    if (dateKey && etDateKey(it.received_at_ms) !== dateKey) continue     // no dateKey: All history
    if (hasNewer && top && dayCmp(it, top) < 0) continue             // newer than what is loaded, with a gap between
    if (hasOlder && bottom && dayCmp(it, bottom) > 0) continue       // older than what is loaded, with a gap between
    bySeq.set(it.seq, it)
  }
  return [...bySeq.values()].sort(dayCmp)
}

/** The footer's archive note: how far back the archive reaches. It is permanent. */
export function archiveTitle(oldestMs, nowMs = Date.now()) {
  const back = oldestMs ? `back to ${fmtReceived(oldestMs, nowMs)}${_etDay(oldestMs) === _etDay(nowMs) ? ' ET' : ''}` : 'empty so far'
  return `The UCT News archive reaches ${back}. Every Trade Exchange headline since then is kept permanently.`
}

// ── AI Explanation (explain.py) ───────────────────────────────────────────────

//: The server's own limits (explain.py MAX_HEADLINE_CHARS, `explainable`).
export const EXPLAIN_MAX_CHARS = 4000

/** Whether a headline offers Explain: a stored id, real words, not a graphic-only
 *  placeholder. The server decides again; this only hides a button that would fail. */
export function explainable(item) {
  const text = String(item?.content || '').trim()
  return !!item?.id && !item.placeholder && text.length <= EXPLAIN_MAX_CHARS && /[A-Za-z]{2}/.test(text)
}

/** What Copy explanation puts on the clipboard: the compact format, as plain text. */
export function explanationText(body) {
  if (!body?.explanation) return ''
  return `AI Explanation\n\n${body.explanation}\n\nWatch: ${body.watch || ''}`.trim()
}

/** A refusal or failure -> the sentence shown, and whether Retry can help. The
 *  server's sentence is used when it sent one (never an internal cause). */
const EXPLAIN_FINAL = new Set(['disabled', 'bad_id', 'not_found', 'not_explainable', 'daily_limit', 'population', 'paused'])
export function explainError(status, body) {
  const reason = body?.reason || null
  if (status === 401) return { text: 'Sign in to UCT to see explanations.', retry: false }
  const text = typeof body?.detail === 'string' && body.detail
    ? body.detail
    : status === 0 ? 'Could not reach UCT — check your connection and try again.'
      : 'The explanation could not be written right now. Try again shortly.'
  return { text, retry: !EXPLAIN_FINAL.has(reason) }
}
