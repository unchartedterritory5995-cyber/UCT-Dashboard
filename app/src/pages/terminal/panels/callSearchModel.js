// TSRC: search every indexed earnings call for a word or a phrase, the pure half (no React and no
// imports, so an agent capability can reuse it and args.js can take `parseCallQuery` without
// pulling a panel in).
//
// ⭐ NO NEW ROUTE. Two reads in api/routers/earnings_intel.py over api/services/transcript_index.py
// (a full-text index of recent earnings-call transcripts), until now only the "Search all
// transcripts" box inside the Calendar's transcript panel (components/calendar/TranscriptSearchAll.jsx).
//
// GATE   both `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. Neither route is
//        behind a flag and neither has a rate limit of its own. `q` must be 2 characters or more
//        (a shorter one is a 422), so the panel checks that first and searches on submit only.
//
//   GET /api/earnings/transcript-search?q=&limit=40
//     ok      { query, match, total, hits: [{ symbol, year, quarter, date, snippet, score }] }
//             ONE HIT PER CALL (a company's call for one fiscal quarter), best match first.
//             `total` is how many calls match; `hits` holds at most `limit` of them, so when
//             total is larger the calls left out are the WEAKEST matches.
//             `snippet` is the index's own excerpt, about 28 words around the match, with
//             <mark>...</mark> around the matched words and " … " where it skips. THERE IS NO
//             SPEAKER FIELD: the index stores a call as one text, so who said it is not known.
//             `date` is the call date as the provider sent it (a date, sometimes with a time).
//     also    { operators: true, expanded: { word: [synonyms] }, notes: [sentences] } while the
//             operator search is switched on (TRANSCRIPT_OPERATOR_SEARCH_ENABLED).
//     no words   { match: null, hits: [], total: 0 }: nothing searchable was left of the query.
//     bad query  { hits: [], total: 0, error: <a sentence>, query_error: true }, still HTTP 200.
//     failed     { hits: [], total: 0, error: 'search unavailable' | 'unsupported search syntax' }.
//
//   GET /api/earnings/transcript-trend?q=&months=12
//     ok      { query, match, months: [{ month: 'YYYY-MM', calls, mentions, pct }], total }
//             one row per month THAT HAS INDEXED CALLS, oldest first: `calls` indexed that month,
//             `mentions` of them matching, `pct` the share ALREADY IN PERCENT (0 to 100).
//             The index keeps recent calls only (90 days unless the server is set otherwise), so
//             the months sent are also the index's own span: no months means no calls indexed.
//     failed  { months: [], total: 0, error }.
//
// ⛔ AN EMPTY RESULT IS ONLY A FINDING WHEN THE INDEX HOLDS CALLS. A search over an empty index
// and a word nobody said look the same on the search route; the trend route's months tell them
// apart, and the panel says which it is.
// ⛔ THE QUOTE IS THIRD-PARTY TEXT. It is shown exactly as the server cut it (never longer), and
// it is split into plain text and marked runs by `parseSnippet`, never set as HTML.
// ⛔ "RISING" AND "FADING" ARE WORKED OUT HERE, not sent by the server: `trendVerdict` compares the
// latest month with enough calls against the months before it and returns both numbers, so the
// panel can show what the word stands on.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const CALL_SEARCH_CODE = 'TSRC'

/** The server refuses a shorter query with a 422. */
export const MIN_QUERY = 2
/** The panel's own ceiling: a search box is for a word or a phrase, not a paragraph. */
export const MAX_QUERY = 120
/** Calls asked for: the same count the Calendar's search box asks for. */
export const SEARCH_LIMIT = 40
export const TREND_MONTHS = 12
/** A month needs this many indexed calls before its share is compared with another month's. */
export const MIN_MONTH_CALLS = 20
/** How far the share has to move, in percentage points and as a ratio, to be called rising or fading. */
export const TREND_MIN_POINTS = 2
export const TREND_UP_RATIO = 1.25
export const TREND_DOWN_RATIO = 0.8

const text = (v) => (v === null || v === undefined ? '' : String(v))
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const whole = (v) => { const n = num(v); return n === null || n < 0 ? null : Math.round(n) }

/**
 * Pure: what the member typed as a query the server will take, or why not.
 *   { ok: true, q }                      trimmed, runs of spaces collapsed
 *   { ok: false, problem: 'empty' | 'short' | 'long' | 'no-words', message }
 */
export function callQuery(raw) {
  const q = text(raw).replace(/\s+/g, ' ').trim()
  if (!q) return { ok: false, problem: 'empty', message: 'Type a word or a phrase to search for.' }
  if (q.length < MIN_QUERY) return { ok: false, problem: 'short', message: `Type at least ${MIN_QUERY} characters.` }
  if (q.length > MAX_QUERY) return { ok: false, problem: 'long', message: `Keep the search to ${MAX_QUERY} characters or fewer.` }
  if (!/[\p{L}\p{N}]/u.test(q)) return { ok: false, problem: 'no-words', message: 'Type a word: the search needs at least one letter or number.' }
  return { ok: true, q }
}
/** Pure: typed words as a query (`pricing power` -> 'pricing power'), or null. For an args.js kind. */
export const parseCallQuery = (raw) => { const r = callQuery(raw); return r.ok ? r.q : null }
/** Pure: the arguments a search writes into the panel's command, one token per word. */
export const callSearchCommandArgs = ({ q = null } = {}) => { const v = parseCallQuery(q); return v ? v.split(' ') : [] }

export const callSearchUrl = (q) => `/api/earnings/transcript-search?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`
export const callTrendUrl = (q) => `/api/earnings/transcript-trend?q=${encodeURIComponent(q)}&months=${TREND_MONTHS}`

/**
 * Pure: a server excerpt as runs of plain text and matched words: [{ text, hit }].
 * Only <mark> is understood; anything else in the text stays text (it is third-party content, so
 * it is never handed to the page as HTML).
 */
export function parseSnippet(snippet) {
  const s = text(snippet)
  const out = []
  const re = /<mark>([\s\S]*?)<\/mark>/g
  let last = 0
  let m
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), hit: false })
    if (m[1]) out.push({ text: m[1], hit: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last), hit: false })
  return out
}

/** Pure: the calendar date at the front of a provider date (`2026-11-05 17:00:00` -> `2026-11-05`), or null. */
export function callDay(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(raw).trim())
  if (!m) return null
  const [mo, d] = [Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Pure: `2026-11` as `Nov 2026`, or null. */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(text(ym).trim())
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/**
 * Pure: the search answer as the panel needs it.
 *   state     'ok' (hits, possibly none) | 'bad-query' (the server could not read the query and
 *             said why: `message`) | 'no-words' (nothing searchable in it) | 'syntax' (a symbol
 *             the index cannot read) | 'unavailable' (the search itself failed) | 'failed' (not
 *             this route's answer)
 *   hits      { key, sym, year, quarter, day, parts: [{ text, hit }] }, best match first, one per call
 *   total     how many calls match (never less than the hits listed)
 *   cut       the server sent fewer calls than match: the weakest matches are left out
 *   notes     the server's own sentences about how the query was read
 *   expanded  [{ word, also: [...] }]: other words the server searched for alongside a typed one
 */
export function searchRead(body) {
  const none = { state: 'failed', hits: [], total: 0, cut: false, message: null, notes: [], expanded: [] }
  if (!isObj(body) || !Array.isArray(body.hits)) return none
  if (body.error) {
    const err = text(body.error).trim()
    if (body.query_error === true) return { ...none, state: 'bad-query', message: err }
    return { ...none, state: /syntax/i.test(err) ? 'syntax' : 'unavailable' }
  }
  if (body.match === null || body.match === '') return { ...none, state: 'no-words' }
  const seen = new Set()
  const hits = []
  for (const it of body.hits) {
    const sym = text(it?.symbol).trim().toUpperCase()
    const parts = parseSnippet(it?.snippet)
    if (!sym || !parts.length) continue
    const year = whole(it.year)
    const quarter = whole(it.quarter)
    const key = `${sym}-${year}-${quarter}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({ key, sym, year, quarter: quarter >= 1 && quarter <= 4 ? quarter : null, day: callDay(it.date), parts })
  }
  const total = Math.max(whole(body.total) ?? 0, hits.length)
  return {
    state: 'ok',
    hits,
    total,
    cut: total > hits.length,
    message: null,
    notes: (Array.isArray(body.notes) ? body.notes : []).map((n) => text(n).trim()).filter(Boolean),
    expanded: Object.entries(isObj(body.expanded) ? body.expanded : {})
      .map(([word, also]) => ({ word, also: (Array.isArray(also) ? also : []).map((a) => text(a).trim()).filter(Boolean) }))
      .filter((e) => e.also.length),
  }
}

/** Pure: the fiscal quarter of a call in words (`fiscal Q3 2026`), with what is missing left out. */
export function quarterText(hit) {
  const q = hit?.quarter ? `Q${hit.quarter}` : ''
  const y = hit?.year ? String(hit.year) : ''
  return q || y ? `fiscal ${[q, y].filter(Boolean).join(' ')}` : 'Quarter not given'
}

/**
 * Pure: the trend answer as the panel needs it.
 *   state         'ok' | 'failed' (an error from the server, or not this route's answer)
 *   months        { month, label, calls, mentions, share (percent, null with no calls) }, oldest first
 *   callsIndexed  calls indexed across those months; 0 means the index holds no calls
 *   mentions      of those, the calls that match
 *   firstMonth, lastMonth   the span the index covers, as `YYYY-MM` (null when empty)
 */
export function trendRead(body) {
  const none = { state: 'failed', months: [], callsIndexed: 0, mentions: 0, firstMonth: null, lastMonth: null }
  if (!isObj(body) || !Array.isArray(body.months) || body.error) return none
  // A healthy answer always names the match it ran; a query with no searchable words sends none.
  if (!text(body.match).trim()) return none
  const months = []
  for (const it of body.months) {
    const label = monthLabel(it?.month)
    const calls = whole(it?.calls)
    if (!label || calls === null) continue
    const mentions = Math.min(whole(it.mentions) ?? 0, calls)
    const sent = num(it.pct)
    months.push({ month: text(it.month).trim(), label, calls, mentions, share: calls > 0 ? (sent ?? (mentions / calls) * 100) : null })
  }
  months.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  return {
    state: 'ok',
    months,
    callsIndexed: months.reduce((s, m) => s + m.calls, 0),
    mentions: months.reduce((s, m) => s + m.mentions, 0),
    firstMonth: months.length ? months[0].month : null,
    lastMonth: months.length ? months[months.length - 1].month : null,
  }
}

/**
 * Pure: is the theme rising or fading across calls? Worked out here from the monthly shares.
 * Only months with at least MIN_MONTH_CALLS indexed calls are compared (a month with a handful of
 * calls swings on one company). The LATEST such month is set against ALL such months before it,
 * taken together (their mentions over their calls).
 *   kind     'rising' | 'fading' | 'steady' | 'thin' (fewer than two months with enough calls)
 *   latest   { month, label, share, calls }
 *   earlier  { from, to, share, calls } (labels of the first and last earlier month)
 * Rising: the share is up by TREND_MIN_POINTS points or more AND by a quarter or more. Fading:
 * down by as many points AND by a fifth or more. Anything else is about steady.
 */
export function trendVerdict(months) {
  const usable = (Array.isArray(months) ? months : []).filter((m) => m && m.calls >= MIN_MONTH_CALLS && m.share !== null)
  if (usable.length < 2) return { kind: 'thin', latest: null, earlier: null }
  const last = usable[usable.length - 1]
  const before = usable.slice(0, -1)
  const calls = before.reduce((s, m) => s + m.calls, 0)
  const share = (before.reduce((s, m) => s + m.mentions, 0) / calls) * 100
  const diff = last.share - share
  const kind = diff >= TREND_MIN_POINTS && last.share >= share * TREND_UP_RATIO ? 'rising'
    : -diff >= TREND_MIN_POINTS && last.share <= share * TREND_DOWN_RATIO ? 'fading'
      : 'steady'
  return {
    kind,
    latest: { month: last.month, label: last.label, share: last.share, calls: last.calls },
    earlier: { from: before[0].label, to: before[before.length - 1].label, share, calls },
  }
}

/** The word each verdict is shown as. */
export const TREND_WORDS = Object.freeze({ rising: 'Rising', fading: 'Fading', steady: 'About steady', thin: 'Too few calls to say' })
