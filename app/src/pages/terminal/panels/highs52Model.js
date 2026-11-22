// H52: stocks at new 52-week highs and new 52-week lows, the pure half (no React, so an agent
// capability can reuse it).
//
// ⭐ NO NEW ROUTE. The Breadth Monitor's own drill lists (api/routers/breadth_monitor.py, each
// `Depends(require_paid)`), until now opened only by clicking a cell of the Monitor table:
//
//   GET /api/breadth-monitor/live                       is the session live, and which finished
//                                                       session is the newest one stored
//   GET /api/breadth-monitor/live/drill/{list}          the names behind a LIVE cell
//   GET /api/breadth-monitor/{date}/drill/{list}        the names stored for a FINISHED session
//   GET /api/breadth-monitor/latest                     the newest stored row (its `date`), read
//                                                       only when the live read itself fails
//
// `{list}` is the Monitor's own drill key, `new_52w_highs_list` or `new_52w_lows_list`; both
// drill routes take it (breadth_live._metric_key_of strips `_list` on the live side).
//
// WHAT EACH ANSWERS
//   live          { ok, session_live, superseded, degraded, session_date, carried_from, as_of,
//                   data_as_of, market_open, nhnl_basis?, ... }. A 503 when the live read cannot
//                   be built (BREADTH_LIVE_ENABLED=0, or its reference levels are missing).
//   live drill    { ok, items, reason, as_of }. `ok: false` with a `reason` and NO items when the
//                   list cannot be given (a cold cache, a list withheld on the live path): that
//                   is "not available", never "no stock made a new high".
//   stored drill  { date, metric, items }; 404 when that session holds no such list.
//   an item       { t, c, pct, vr, v, n } (breadth_live.drill_items; a stored item may also
//                 carry a50 / atr, which this panel does not show): ticker, price, change
//                 against the prior close (percent), volume against its 20-day average, shares
//                 traded, company name. Any of pct, vr, v and n can be absent.
//
// ⛔ THE LIVE DRILL NEVER SAYS WHETHER THE MARKET IS IN SESSION: outside the session it answers
// from the last cached read. So the mode is the live read's own words (`session_live`,
// `superseded`, `degraded`), the same three the Monitor's live row is gated on
// (hooks/useLiveBreadth.js isLiveRowUsable), never a clock read in the browser.
// ⛔ `GET /api/breadth-monitor/{date}/lists` is NOT a member route (it is gated on the push
// secret), so the finished session is read one list at a time through the member drill route.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const HIGHS52_CODE = 'H52'

/** Which lists show. `token` is what a chip writes into the command (`H52 LOWS`); `list` is the
 *  Monitor's drill key. */
export const HIGHS52_SIDES = Object.freeze({
  both: Object.freeze({ chip: 'Highs and lows', token: null, list: null }),
  highs: Object.freeze({ chip: '52-week highs', token: 'HIGHS', list: 'new_52w_highs_list', one: 'high', caption: 'New 52-week highs' }),
  lows: Object.freeze({ chip: '52-week lows', token: 'LOWS', list: 'new_52w_lows_list', one: 'low', caption: 'New 52-week lows' }),
})

/** The words a side can be typed as: args.js `hiloSide` (HILO_SIDE_WORDS), word for word, so the
 *  registry can reuse that kind. highs52Model.test.js pins the two against each other. */
const SIDE_WORDS = Object.freeze({
  HIGHS: 'highs', HIGH: 'highs', HI: 'highs', NH: 'highs',
  LOWS: 'lows', LOW: 'lows', LO: 'lows', NL: 'lows',
})

/** Pure: the side a prop or a typed word names; anything unknown is both lists. */
export function normSide52(raw) {
  const t = String(raw ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(SIDE_WORDS, t) ? SIDE_WORDS[t] : 'both'
}

/** The live read: is the session under way, and which finished session is the newest stored. */
export const BREADTH_LIVE_URL = '/api/breadth-monitor/live'
/** The newest stored row. Read only when the live read itself fails. */
export const BREADTH_LATEST_URL = '/api/breadth-monitor/latest'
const listOf = (side) => (side === 'lows' ? HIGHS52_SIDES.lows.list : HIGHS52_SIDES.highs.list)
/** Pure: the live list of one side (`highs` | `lows`). */
export const liveDrillUrl = (side) => `/api/breadth-monitor/live/drill/${listOf(side)}`
/** Pure: one finished session's stored list of one side, or null without a calendar date. */
export function storedDrillUrl(date, side) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) ? String(date) : null
  return day ? `/api/breadth-monitor/${day}/drill/${listOf(side)}` : null
}

/** Pure: the arguments a view writes into the panel's command (both lists is the bare command). */
export const highs52CommandArgs = ({ side = null } = {}) => [HIGHS52_SIDES[normSide52(side)].token].filter(Boolean)

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
/** A calendar date as sent (`2026-11-13`, or the head of an ISO instant), or null. Never parsed
 *  into a time: a session date has no time zone to convert. */
export function dayOf(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v))
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
/** The server stamps whole seconds with an offset; anything a browser cannot read is null. */
const stamp = (v) => {
  const s = text(v)
  return s && !Number.isNaN(new Date(s).getTime()) ? s : null
}

/**
 * Pure: what the live read says to show.
 *   mode   'live'     the session is under way and its lists are the live ones
 *          'settled'  show a finished session's stored lists, `date` says which
 *          null       the answer is not a live read, or it names no session to show
 *   date   the session shown (a calendar date), or null
 *   why    for 'settled': 'finished' (this session is over and its lists are stored), 'thin'
 *          (the live read covers too few stocks to trust) or 'closed' (not in session)
 *   basis  'intraday' when the live counts use the exchange convention (a trade above the prior
 *          52-week high, breadth_nhnl_intraday), else null (not stated)
 */
export function highs52Mode(status) {
  const none = { mode: null, date: null, why: null, basis: null }
  if (!isObj(status) || status.ok !== true) return none
  const session = dayOf(status.session_date)
  const stored = dayOf(status.carried_from)
  const basis = status.nhnl_basis === 'intraday' ? 'intraday' : null
  const started = status.session_live === true
  if (started && status.superseded !== true && status.degraded !== true && session) {
    return { mode: 'live', date: session, why: null, basis }
  }
  if (!stored) return { ...none, basis }
  const why = started && status.superseded === true ? 'finished' : started && status.degraded === true ? 'thin' : 'closed'
  return { mode: 'settled', date: stored, why, basis }
}

/** Pure: the newest stored session's date from `GET /api/breadth-monitor/latest`, or null. */
export const latestSessionDate = (body) => (isObj(body) ? dayOf(body.date) : null)

/** Pure: the row shaping shared by both drill routes. Biggest gain first for highs, biggest fall
 *  first for lows; a row with no change sinks last. Duplicate and ticker-less rows are dropped. */
function rowsOf(items, side) {
  const out = []
  const seen = new Set()
  for (const it of (Array.isArray(items) ? items : [])) {
    const sym = text(it?.t).toUpperCase()
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    out.push({
      key: `${side}-${sym}`,
      sym,
      name: text(it.n) || null,
      price: num(it.c),
      pct: num(it.pct),
      rvol: num(it.vr),
      volume: num(it.v),
      sent: out.length,
    })
  }
  const dir = side === 'lows' ? 1 : -1
  out.sort((a, b) => {
    if (a.pct === null || b.pct === null) return (a.pct === null) - (b.pct === null) || a.sent - b.sent
    return dir * (a.pct - b.pct) || a.sent - b.sent
  })
  return out.map(({ sent: _sent, ...r }, i) => ({ ...r, order: i }))
}

/**
 * Pure: one drill answer as a list.
 *   state  'ok'           rows (possibly none: a healthy answer that no stock qualified)
 *          'unavailable'  the live route said it cannot give this list right now (`reason`)
 *          'failed'       not a drill answer at all
 *   rows   { key, sym, name, price, pct, rvol, volume, order }
 *   asOf   the live read's own instant (live only); date  the stored session (stored only)
 */
export function drillRead(body, { side = 'highs', live = false } = {}) {
  const s = side === 'lows' ? 'lows' : 'highs'
  const none = { state: 'failed', rows: [], asOf: null, date: null, reason: null }
  if (!isObj(body)) return none
  if (live && body.ok !== true) {
    return { ...none, state: body.ok === false ? 'unavailable' : 'failed', asOf: stamp(body.as_of), reason: text(body.reason) || null }
  }
  if (!Array.isArray(body.items)) return none
  return { state: 'ok', rows: rowsOf(body.items, s), asOf: live ? stamp(body.as_of) : null, date: live ? null : dayOf(body.date), reason: null }
}

const plural = (n, one, many) => (n === 1 ? one : many)

/**
 * Pure: the one-line count above the lists, for the sides that answered. `highs` / `lows` are row
 * counts, or null for a side that is not shown or did not answer. `count` formats a whole number
 * (the panel passes the shared formatter).
 */
export function countsSentence({ mode, date = null, highs = null, lows = null, count = String } = {}) {
  const live = mode === 'live'
  const parts = []
  if (highs !== null) {
    parts.push(live
      ? `${count(highs)} ${plural(highs, 'stock is', 'stocks are')} at a new 52-week high so far today`
      : `${count(highs)} ${plural(highs, 'stock', 'stocks')} made a new 52-week high`)
  }
  if (lows !== null) {
    parts.push(parts.length
      ? `${count(lows)} ${live ? 'at a new low' : 'a new low'}`
      : live
        ? `${count(lows)} ${plural(lows, 'stock is', 'stocks are')} at a new 52-week low so far today`
        : `${count(lows)} ${plural(lows, 'stock', 'stocks')} made a new 52-week low`)
  }
  if (!parts.length) return ''
  return `${parts.join(', ')}${!live && date ? ` on ${date}` : ''}.`
}

/** Pure: why a finished session is shown instead of the live lists, in a sentence. `fallback` is
 *  true when the live read itself failed and the date came from the newest stored row. */
export function settledSentence({ why = null, date = null, fallback = false } = {}) {
  const day = date || 'the last finished session'
  if (fallback) return `Live breadth could not be read just now, so these are the lists of the last finished session, ${day}.`
  if (why === 'finished') return `Today's session has finished. These are its final lists, ${day}.`
  if (why === 'thin') return `The live read is covering fewer stocks than usual right now, so these are the lists of the last finished session, ${day}.`
  return `The market is not in session, so these are the lists of the last finished session, ${day}. The live lists start once the next session is under way.`
}
