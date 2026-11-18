// TOPF: the Top Flow picks, one by one, each with how its CONTRACT has done since it was picked.
// The pure half (no React and no imports, so an agent capability can reuse it and args.js can take
// the parsers without pulling a panel in).
//
// ⭐ NO NEW ROUTE. `GET /api/top-flow/history` (api/top_flow_router.py -> api/top_flow_tracker.py
// `get_all`). Until now only the Options Flow page read it (its Tracker tab lists the open picks,
// 50 at most). The Flow record (FREC, `/api/flow-scoreboard`) is worked out from the same store:
// win rates, a grade table, 12 recent winners and the last 15 scored picks. This is the whole
// list, expired picks included.
//
// GATE   `Depends(require_flow_user)`: ANY signed-in session (no paid-plan check on the route), or
//        the server's own service token. 401 "Not authenticated" when signed out. No feature flag.
// SPEED  The route returns the tracker's in-memory lists as they are (loaded from disk once, at
//        startup). It builds nothing on the request, so it cannot be slow on a cold cache. It
//        sends EVERY pick with its whole daily history, uncut, so the answer grows with the store.
//
// WHAT IT ANSWERS   `{ active: [pick], archived: [pick] }`, always 200 for a signed-in caller.
//   a pick   { id ('AAPL|C|200.0|6/20'), sym, cp ('C' | 'P'), strike, exp (text as the flow tape
//              carried it, 'M/D' or 'M/D/YYYY'), entry, grade, dir ('BULL' | 'BEAR'), cap (a
//              market-cap band), dateSaved ('YYYY-MM-DD'), hits, prem, history: [snapshot] }
//     entry    DOLLARS PER SHARE of the contract: the average price of the flagged trades on UCT's
//              options flow tape (premium / (contracts x 100), pages/OptionsFlow.jsx toTracker).
//              0 when the tape had no volume for it.
//     prem     dollars of premium in the flagged trades. hits: how many trades.
//     history  one entry per daily snapshot, { date ('M/D/YYYY', New York), price (the contract's
//              price), oi (open interest), spot (the stock), volume, src }. Written by
//              `snapshot_prices` about 4:30 PM ET on weekdays, for the 200 newest open picks
//              only. Recorded from Massive since November 2026 (`src: 'massive'`; price = the
//              bid/ask midpoint, else the last trade; a field Massive did not send is null).
//              Earlier entries came from Schwab (`src: 'schwab'` or no `src`; price = its mark,
//              else last, else 0) and stay as recorded. When Massive has no price for a contract
//              NO entry is written.
//   archived a pick whose expiry has passed (moved at startup and before each snapshot), with
//              `archivedDate`, `finalPrice` (its last history price) and `finalPnl` (percent, and
//              0 when either price is missing). A pick an admin stopped early also carries
//              `purgeReason`.
//   ⚠️ A store that failed to load answers `{ active: [], archived: [] }`, the same as an empty
//      one. The panel's empty state says so.
//
// ⛔ ONE DEFINITION OF A GAIN, THE FLOW RECORD'S. `pickStats` is a port of
// `api/flow_scoreboard.py::pick_stats`, line for line: a usable snapshot has a price above 0; a
// pick with fewer than two is NOT SCORED (null: never a 0% and never a loss); entry is the stored
// entry, else the first tracked price; peak gain is the best snapshot against entry; current gain
// is the latest snapshot against entry; days tracked is the calendar span of the snapshot dates;
// both gains are rounded to one decimal the way Python rounds. So this list and FREC cannot
// disagree about a pick. The store's own `finalPnl` is never drawn (it reads 0 for a missing
// price); an expired pick's result is the same current gain, from its last usable snapshot.
// ⛔ DATES ARE READ THE FLOW RECORD'S WAY (`parse_pick_date`): 'M/D/YYYY', 'M/D/YY' and
// 'YYYY-MM-DD'. A date with no year ('6/20') is NOT given one: it does not parse, and the expiry
// is shown as the text the store holds. Open or expired is the server's own list, never worked
// out here from an expiry.
// ⛔ A GAIN IS THE CONTRACT'S OWN PRICE CHANGE, whichever way the pick leans (the Flow record's
// rule). `direction` is carried so the panel can say so.

/** The terminal code this panel is proposed under (the panel reads the live one from its frame). */
export const TOP_FLOW_CODE = 'TOPF'
export const TOP_FLOW_URL = '/api/top-flow/history'
/** Fewer usable daily prices than this and a pick is not scored (flow_scoreboard MIN_HISTORY_SNAPSHOTS). */
export const MIN_HISTORY_SNAPSHOTS = 2
/** Later open interest above the first snapshot's by this factor is "OI confirmed" (flow_scoreboard OI_RISE_FACTOR). */
export const OI_RISE_FACTOR = 1.1
/** The grades the Flow record knows, best first (flow_scoreboard GRADE_ORDER). */
export const GRADE_ORDER = Object.freeze(['A+', 'A', 'B', 'C', 'D'])
/** The server prices this many open picks a day, newest first (top_flow_tracker.snapshot_prices). */
export const SNAPSHOT_PICK_CAP = 200
/** A newest daily price older than this many calendar days is said to be stale (a weekend plus a holiday is 4). */
export const STALE_AFTER_DAYS = 4

/** Which picks, in chip order. `token` is what a chip writes into the command (`TOPF OPEN`). */
export const TOP_FLOW_STATUSES = Object.freeze({
  all: Object.freeze({ chip: 'All picks', token: null }),
  open: Object.freeze({ chip: 'Open', token: 'OPEN' }),
  expired: Object.freeze({ chip: 'Expired', token: 'EXPIRED' }),
})
/** Which way a pick leans, in chip order (`TOPF BULL`). */
export const TOP_FLOW_DIRECTIONS = Object.freeze({
  any: Object.freeze({ chip: 'Any direction', token: null }),
  bullish: Object.freeze({ chip: 'Bullish', token: 'BULL' }),
  bearish: Object.freeze({ chip: 'Bearish', token: 'BEAR' }),
})
/** The order of the list, in chip order (`TOPF PEAK`). */
export const TOP_FLOW_SORTS = Object.freeze({
  gain: Object.freeze({ chip: 'Biggest gain now', token: null, words: 'biggest current gain first' }),
  loss: Object.freeze({ chip: 'Biggest loss now', token: 'LOSERS', words: 'biggest current loss first' }),
  peak: Object.freeze({ chip: 'Biggest peak gain', token: 'PEAK', words: 'biggest peak gain first' }),
  newest: Object.freeze({ chip: 'Newest pick', token: 'NEW', words: 'newest pick first' }),
})
export const DEFAULT_TOP_FLOW_STATUS = 'all'
export const DEFAULT_TOP_FLOW_DIRECTION = 'any'
export const DEFAULT_TOP_FLOW_SORT = 'gain'

/** The words each choice is typed as. For args.js kinds; no word is in two maps, so the three kinds share one command. */
export const TOP_FLOW_STATUS_ARG_WORDS = Object.freeze({
  OPEN: 'open', ACTIVE: 'open', LIVE: 'open',
  EXPIRED: 'expired', ARCHIVED: 'expired', PAST: 'expired', CLOSED: 'expired',
})
export const TOP_FLOW_DIRECTION_ARG_WORDS = Object.freeze({
  BULL: 'bullish', BULLS: 'bullish', BULLISH: 'bullish',
  BEAR: 'bearish', BEARS: 'bearish', BEARISH: 'bearish',
})
export const TOP_FLOW_SORT_ARG_WORDS = Object.freeze({
  GAIN: 'gain', GAINERS: 'gain', WINNERS: 'gain', BEST: 'gain',
  LOSS: 'loss', LOSERS: 'loss', WORST: 'loss',
  PEAK: 'peak', HIGH: 'peak',
  NEW: 'newest', NEWEST: 'newest', LATEST: 'newest', RECENT: 'newest',
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const word = (token) => String(token ?? '').trim().toUpperCase()
const keyOr = (map, raw) => (typeof raw === 'string' && own(map, raw) ? raw : null)

/** Pure: a typed word as a status key ('open' | 'expired'), or null. */
export const parseTopFlowStatus = (token) => own(TOP_FLOW_STATUS_ARG_WORDS, word(token))
/** Pure: a typed word as a direction key ('bullish' | 'bearish'), or null. */
export const parseTopFlowDirection = (token) => own(TOP_FLOW_DIRECTION_ARG_WORDS, word(token))
/** Pure: a typed word as a sort key ('gain' | 'loss' | 'peak' | 'newest'), or null. */
export const parseTopFlowSort = (token) => own(TOP_FLOW_SORT_ARG_WORDS, word(token))
/** Pure: what a prop or a typed word names. A key is taken as it is; anything unknown is the default. */
export const normTopFlowStatus = (raw) => parseTopFlowStatus(raw) || keyOr(TOP_FLOW_STATUSES, raw) || DEFAULT_TOP_FLOW_STATUS
export const normTopFlowDirection = (raw) => parseTopFlowDirection(raw) || keyOr(TOP_FLOW_DIRECTIONS, raw) || DEFAULT_TOP_FLOW_DIRECTION
export const normTopFlowSort = (raw) => parseTopFlowSort(raw) || keyOr(TOP_FLOW_SORTS, raw) || DEFAULT_TOP_FLOW_SORT

/** Pure: the arguments a choice writes into the panel's command. Every default is the bare command. */
export function topFlowCommandArgs({ status = null, direction = null, sort = null } = {}) {
  return [
    TOP_FLOW_STATUSES[normTopFlowStatus(status)].token,
    TOP_FLOW_DIRECTIONS[normTopFlowDirection(direction)].token,
    TOP_FLOW_SORTS[normTopFlowSort(sort)].token,
  ].filter(Boolean)
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')
const pad2 = (n) => String(n).padStart(2, '0')

/** A calendar date is real when it survives a round trip (2026-02-30 does not). */
function realDay(y, m, d) {
  if (![y, m, d].every(Number.isInteger) || y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/**
 * Pure: a stored date as `YYYY-MM-DD`, or null. A port of flow_scoreboard `parse_pick_date`: it
 * reads 'M/D/YYYY', 'M/D/YY' (20YY) and 'YYYY-MM-DD' (anything after the day is ignored). A date
 * with no year does not parse; it is never given one.
 */
export function parsePickDay(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  if (s.includes('-')) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.slice(0, 10))
    return m ? realDay(+m[1], +m[2], +m[3]) : null
  }
  const parts = s.split('/')
  if (parts.length < 3 || !parts.slice(0, 3).every((p) => /^\s*\d+\s*$/.test(p))) return null
  const [mo, d, yRaw] = parts.slice(0, 3).map(Number)
  return realDay(yRaw < 100 ? yRaw + 2000 : yRaw, mo, d)
}

/** Pure: whole calendar days from one `YYYY-MM-DD` to another (UTC arithmetic), or null. */
export function daysBetween(from, to) {
  const a = parsePickDay(from)
  const b = parsePickDay(to)
  if (!a || !b) return null
  const ms = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((ms(b) - ms(a)) / 86400000)
}

/**
 * Pure: a stored grade ('A+ <a picture>', 'A', 'b') as one of GRADE_ORDER, or ''. A port of
 * flow_scoreboard `clean_grade`; a grade it does not know ('B+') is '' there and here.
 */
export function cleanGrade(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return ''
  const token = raw.trim().split(/\s+/)[0].replace(/[^A-Za-z+]/g, '').toUpperCase()
  return GRADE_ORDER.includes(token) ? token : ''
}

/** A price as a positive number, or null (flow_scoreboard `_as_price`). A number or a numeric string only. */
function asPrice(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const asOi = (v) => { const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : 0; return Number.isFinite(n) ? n : 0 }

/**
 * Pure: a number rounded to one decimal THE WAY PYTHON'S `round(x, 1)` DOES, so a gain reads the
 * same here as on the Flow record. The two differ only on an exact tie (6.25, which is exact in
 * binary): Python goes to the even digit (6.2), JavaScript's toFixed away from zero (6.3). A tie
 * at one decimal is exact only for a quarter (x.25, x.75), which is what is tested for.
 */
export function round1(x) {
  if (!Number.isFinite(x)) return null
  const quarters = x * 4
  if (Number.isInteger(quarters) && Math.abs(quarters) % 2 === 1) {
    const low = Math.floor(x * 10)
    return (low % 2 === 0 ? low : low + 1) / 10
  }
  const out = Number(x.toFixed(1))
  return out === 0 ? 0 : out
}

/** Every history entry that reads, oldest first: by its date, then by its place in the list. */
function orderedHistory(pick) {
  const out = []
  const history = Array.isArray(pick?.history) ? pick.history : []
  history.forEach((h, i) => {
    if (!isObj(h)) return
    out.push({ day: parsePickDay(h.date), i, price: asPrice(h.price), h })
  })
  return out.sort((a, b) => ((a.day || '') < (b.day || '') ? -1 : (a.day || '') > (b.day || '') ? 1 : a.i - b.i))
}

/**
 * Pure: one pick's outcome from its daily snapshots, or null when it is not scored (fewer than
 * MIN_HISTORY_SNAPSHOTS usable prices). A port of flow_scoreboard `pick_stats`.
 *   entry (dollars per share of the contract), entryFromFirstPrice (the stored entry was missing,
 *   so the first tracked price stands in, as the Flow record does), peakPrice, latestPrice,
 *   maxGainPct, currentGainPct (PERCENT, one decimal), daysTracked, firstDay, lastDay
 *   ('YYYY-MM-DD' or null), prices (how many usable snapshots), oiEvaluable, oiConfirmed
 */
export function pickStats(pick) {
  const snaps = orderedHistory(pick).filter((s) => s.price !== null)
  if (snaps.length < MIN_HISTORY_SNAPSHOTS) return null
  const prices = snaps.map((s) => s.price)
  const stored = asPrice(pick?.entry)
  const entry = stored ?? prices[0]
  const peak = Math.max(...prices)
  const latest = prices[prices.length - 1]
  const firstDay = snaps[0].day
  const lastDay = snaps[snaps.length - 1].day
  const span = firstDay && lastDay && lastDay >= firstDay ? daysBetween(firstDay, lastDay) : null
  const oi = snaps.map((s) => asOi(s.h.oi))
  const oiEvaluable = oi[0] > 0
  return {
    entry,
    entryFromFirstPrice: stored === null,
    peakPrice: peak,
    latestPrice: latest,
    maxGainPct: round1(((peak - entry) / entry) * 100),
    currentGainPct: round1(((latest - entry) / entry) * 100),
    daysTracked: span ?? snaps.length - 1,
    firstDay,
    lastDay,
    prices: snaps.length,
    oiEvaluable,
    oiConfirmed: oiEvaluable && oi.slice(1).some((later) => later > oi[0] * OI_RISE_FACTOR),
  }
}

const SYMBOL = /^[A-Z0-9][A-Z0-9.\-/]{0,11}$/
const SIDES = Object.freeze({ C: 'call', P: 'put' })
const LEANS = Object.freeze({ BULL: 'bullish', BEAR: 'bearish' })
const posNum = (v) => asPrice(v)
const wholeOrNull = (v) => { const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN; return Number.isFinite(n) && n > 0 ? Math.round(n) : null }

function rowOf(pick, status, sent) {
  if (!isObj(pick)) return null
  const sym = text(pick.sym).toUpperCase()
  if (!SYMBOL.test(sym)) return null
  const history = orderedHistory(pick)
  const usable = history.filter((s) => s.price !== null)
  const stats = pickStats(pick)
  const last = usable[usable.length - 1] || null
  const storedEntry = asPrice(pick.entry)
  const savedText = text(pick.dateSaved)
  return {
    key: `topf-${status}-${sent}-${text(pick.id) || sym}`,
    id: text(pick.id) || null,
    sym,
    status,
    // An admin stopped tracking it before its expiry (top_flow_router purge-old).
    stopped: status === 'expired' && !!text(pick.purgeReason),
    side: own(SIDES, text(pick.cp).toUpperCase()),
    strike: posNum(pick.strike),
    exp: text(pick.exp) || null,
    grade: cleanGrade(pick.grade) || null,
    direction: own(LEANS, text(pick.dir).toUpperCase()),
    savedDay: parsePickDay(savedText),
    savedText: savedText || null,
    scored: !!stats,
    prices: usable.length,
    entry: stats ? stats.entry : storedEntry,
    entryFromFirstPrice: stats ? stats.entryFromFirstPrice : false,
    latestPrice: last ? last.price : null,
    latestDay: last ? last.day : null,
    // The newest snapshot of all carries no price (a quote of 0), so `latestPrice` is an older one.
    laterQuoteNoPrice: !!last && history[history.length - 1].price === null,
    peakPrice: stats ? stats.peakPrice : null,
    currentGainPct: stats ? stats.currentGainPct : null,
    maxGainPct: stats ? stats.maxGainPct : null,
    daysTracked: stats ? stats.daysTracked : null,
    oiEvaluable: stats ? stats.oiEvaluable : false,
    oiConfirmed: stats ? stats.oiConfirmed : false,
    premium: posNum(pick.prem),
    hits: wholeOrNull(pick.hits),
    capBand: text(pick.cap) || null,
    sent,
  }
}

/**
 * Pure: the route's answer as the panel needs it.
 *   state      'ok' (rows, possibly none) | 'failed' (not this route's answer at all)
 *   rows       one per pick, open picks first then expired, in the order the server sent them:
 *              { key, id, sym, status ('open' | 'expired'), stopped, side ('call' | 'put' | null),
 *                strike, exp (the stored text), grade (GRADE_ORDER or null), direction ('bullish' |
 *                'bearish' | null), savedDay ('YYYY-MM-DD' or null), savedText, scored, prices,
 *                entry, entryFromFirstPrice, latestPrice, latestDay, laterQuoteNoPrice, peakPrice,
 *                currentGainPct, maxGainPct (PERCENT; null when not scored, never 0), daysTracked,
 *                oiEvaluable, oiConfirmed, premium (dollars), hits, capBand }
 *   newestDay  the newest daily-price date in the whole answer ('YYYY-MM-DD'), or null with none
 *   unread     picks the server sent that carry no readable symbol (counted, never drawn)
 */
export function topFlowRead(body) {
  const none = { state: 'failed', rows: [], newestDay: null, unread: 0 }
  if (!isObj(body) || !Array.isArray(body.active) || !Array.isArray(body.archived)) return none
  const rows = []
  let unread = 0
  let sent = 0
  for (const [list, status] of [[body.active, 'open'], [body.archived, 'expired']]) {
    for (const pick of list) {
      const row = rowOf(pick, status, sent)
      sent += 1
      if (row) rows.push(row)
      else unread += 1
    }
  }
  const newestDay = rows.reduce((max, r) => (r.latestDay && (!max || r.latestDay > max) ? r.latestDay : max), null)
  return { state: 'ok', rows: rows.map((r) => { const row = { ...r }; delete row.sent; return row }), newestDay, unread }
}

/** Pure: the rows a status and a direction keep. A pick with no direction on record is only under "any". */
export function filterRows(rows, { status = null, direction = null } = {}) {
  const s = normTopFlowStatus(status)
  const d = normTopFlowDirection(direction)
  return (Array.isArray(rows) ? rows : []).filter((r) => (s === 'all' || r.status === s) && (d === 'any' || r.direction === d))
}

/**
 * Pure: the rows in one order. A pick that is not scored has no gain, so under the three gain
 * orders it goes LAST (newest first among themselves), never ranked as 0.
 *   gain    biggest current gain first        loss   biggest current loss first
 *   peak    biggest peak gain first           newest newest pick first (no date last)
 */
export function sortRows(rows, sort = null) {
  const key = normTopFlowSort(sort)
  const all = (Array.isArray(rows) ? rows : []).map((r, i) => ({ r, i }))
  const byNewest = (a, b) => ((b.r.savedDay || '') < (a.r.savedDay || '') ? -1 : (b.r.savedDay || '') > (a.r.savedDay || '') ? 1 : a.i - b.i)
  const field = key === 'peak' ? 'maxGainPct' : 'currentGainPct'
  const dir = key === 'loss' ? 1 : -1
  all.sort((a, b) => {
    if (key === 'newest') return byNewest(a, b)
    if (a.r.scored !== b.r.scored) return a.r.scored ? -1 : 1
    if (!a.r.scored) return byNewest(a, b)
    return dir * (a.r[field] - b.r[field]) || byNewest(a, b)
  })
  return all.map((x) => x.r)
}

/**
 * Pure: what a list of rows holds.
 *   all, open, expired, stopped (expired rows an admin stopped early), scored,
 *   tooNew (open and not scored yet), neverScored (expired with fewer than two daily prices),
 *   noPrice (open with no daily price at all), bullish, bearish
 */
export function countRows(rows) {
  const out = { all: 0, open: 0, expired: 0, stopped: 0, scored: 0, tooNew: 0, neverScored: 0, noPrice: 0, bullish: 0, bearish: 0 }
  for (const r of Array.isArray(rows) ? rows : []) {
    out.all += 1
    out[r.status] += 1
    if (r.stopped) out.stopped += 1
    if (r.scored) out.scored += 1
    else if (r.status === 'open') { out.tooNew += 1; if (!r.prices) out.noPrice += 1 } else out.neverScored += 1
    if (r.direction) out[r.direction] += 1
  }
  return out
}

/**
 * Pure: how fresh the daily prices are.
 *   newestDay   the newest daily-price date in the answer, or null
 *   ageDays     calendar days from it to `today` ('YYYY-MM-DD', New York), or null
 *   stale       it is more than STALE_AFTER_DAYS old (the history has stopped growing)
 *   behind      open picks that have a price, but none from `newestDay` (the server prices only
 *               the SNAPSHOT_PICK_CAP newest open picks a day, and skips a contract with no quote)
 */
/** A record whose newest pick is older than this says so: nothing has been added for a while. */
export const NO_NEW_PICKS_AFTER_DAYS = 14

export function priceFreshness(view, today) {
  const newestDay = view?.newestDay || null
  const ageDays = newestDay ? daysBetween(newestDay, today) : null
  const rows = Array.isArray(view?.rows) ? view.rows : []
  // The newest PICK is a different question from the newest PRICE: the record can keep pricing
  // old picks every day while nothing new is added to it.
  const newestPickDay = rows.reduce((best, r) => (r.savedDay && (!best || r.savedDay > best) ? r.savedDay : best), null)
  const pickAgeDays = newestPickDay ? daysBetween(newestPickDay, today) : null
  return {
    newestDay,
    ageDays,
    stale: ageDays !== null && ageDays > STALE_AFTER_DAYS,
    behind: newestDay ? rows.filter((r) => r.status === 'open' && r.latestDay && r.latestDay < newestDay).length : 0,
    newestPickDay,
    pickAgeDays,
    noNewPicks: pickAgeDays !== null && pickAgeDays > NO_NEW_PICKS_AFTER_DAYS,
  }
}
