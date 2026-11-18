// FLWL: two curated options-flow lists, the pure half (no React and no imports, so an agent
// capability can reuse it and args.js can take `parseFlowList` without pulling a panel in).
//
// ⭐ NO NEW ROUTE. Both are served by the partner-owned Live Flow router
// (api/live_massive_router.py), which on the web service is forwarded to the flow-worker
// (api/flow_proxy.py: an upstream failure is a 502, an unconfigured proxy a 503, never a stale
// local answer).
//
//   GET /api/live/massive/cream       "Cream of the Crop": the day's highest-conviction option
//                                     positions being built. Until now only a Discord card
//                                     (api/cream_card.py, 16:10 ET on weekdays); no screen read it.
//   GET /api/live/massive/flow-board  the open flow board: every stock with open directional
//                                     option positions. Until now only the /open-flow page, which
//                                     has no menu entry.
//
// THE TWO GATES DIFFER
//   cream        no dependency of its own. It is classed PAID in api/open_reads_gate.py, which
//                refuses it (401 signed out, 402 not paid) only while OPEN_READS_GATE is "enforce".
//   flow-board   `Depends(require_flow_user)` (api/flow_admin_auth.py): any signed-in session, 401
//                otherwise. It is not in the open-reads table.
//
// WHAT EACH ANSWERS
//   cream   { date, bull: [...], bear: [...], net: { bull, bear } | null, two_sided: [{ sym, bull,
//             bear }], dropped: { reason: n }, params: { top_n, max_per_ticker, min_dte,
//             exclude_weekly, exclude_block_only, min_grade, ... } }   (compute_cream)
//     date    the session, as `M/D/YYYY` (flow.db's own key). With no `target_date` it is the
//             server's current Eastern date, so before the open, on a weekend and on a holiday the
//             two lists are simply EMPTY for that date: a healthy answer, not an outage.
//     a row   { sym, cp ('C' | 'P'), strike, exp (M/D/YYYY), prem, vol, oi, voi, grade, dte, tier,
//               unconfirmed, _dir, _agg }. `prem` is the session's ask-side premium on that
//             contract, `vol` the ask-side contracts, `oi` the open interest before the session
//             (0 on a strike with none), `voi` vol / oi (null on such a new strike).
//             `unconfirmed` marks a direction read from call or put on a large ask-side trade.
//             Rows arrive ranked: grade first, then premium; at most `max_per_ticker` per stock
//             and `top_n` per direction.
//     There is no "computing" answer: a cold key is computed while the caller waits (60 s cache
//     for the current day).
//   flow-board   { ok: true, rows: [...], window: [dates], n_names, open_contracts, days, cap,
//                  min_dte, built_at }   (api/weekly_flow.py board_data)
//                or { ok: false, reason: 'computing', rows: [] } while the one cold build runs
//                (the caller waits up to 25 s first), or { ok: false, reason: 'error: ...' }.
//     a row   ONE STOCK: { sym, bull, bear, net, bullPct, cp, strike, exp, dte, since, perf }.
//             bull / bear are the dollars of bullish / bearish premium on its still-open
//             contracts, net = bull - bear, `bullPct` the bullish share ALREADY IN PERCENT
//             (0 to 100), cp / strike / exp / dte its largest contract by premium, `since` the
//             ISO date of its earliest trade in the window, `perf` the stock's move in percent
//             from that trade to the latest one on the tape (null with no price on either).
//     built_at  epoch seconds of the build. A board up to 6 hours old is served while one
//               rebuild runs behind it; in the session a rebuild starts at most every 10 minutes
//               and never in the 09:25 to 10:05 ET open rush.
//
// ⛔ THE BOARD IS CUT FROM THE BEARISH END. The server sorts by net premium, highest first, and
// keeps `limit` rows, so when `n_names` is larger than the rows sent the names missing are the
// MOST BEARISH ones. `boardRead` reports `names` beside the rows so the panel can say so.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST. `ok: false` is "building" or "could not build"; only a
// healthy answer with no rows says nothing qualified.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const FLOW_LISTS_CODE = 'FLWL'

export const CREAM_URL = '/api/live/massive/cream'
/** The board's default window, cap band and row limit: the one key the flow-worker warms after a
 *  boot (weekly_flow.start_board_warm) and the one /open-flow asks for, so this panel never starts
 *  a second multi-week scan on the pod that runs the live tape. */
export const BOARD_DAYS = 60
export const BOARD_LIMIT = 300
export const FLOW_BOARD_URL = `/api/live/massive/flow-board?days=${BOARD_DAYS}&cap=all&limit=${BOARD_LIMIT}`

/** The two lists, in chip order. `token` is what a chip writes into the command (`FLWL OPEN`). */
export const FLOW_LISTS = Object.freeze({
  cream: Object.freeze({ chip: 'Cream of the Crop', token: null, what: 'The Cream of the Crop list' }),
  open: Object.freeze({ chip: 'Open flow board', token: 'OPEN', what: 'The open flow board' }),
})

const LIST_WORDS = Object.freeze({
  CREAM: 'cream', CROP: 'cream', TOP: 'cream',
  OPEN: 'open', BOARD: 'open', OPENFLOW: 'open',
})

/** Pure: a typed word as a list key (`open` -> 'open'), or null. For an args.js kind. */
export function parseFlowList(token) {
  const t = String(token ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(LIST_WORDS, t) ? LIST_WORDS[t] : null
}
/** Pure: the list a prop or a typed word names; anything unknown is Cream of the Crop. */
export const normFlowList = (raw) => parseFlowList(raw) || 'cream'
/** Pure: the arguments a list writes into the panel's command (Cream of the Crop is the bare command). */
export const flowListsCommandArgs = ({ list = null } = {}) => [FLOW_LISTS[normFlowList(list)].token].filter(Boolean)

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const pad2 = (n) => String(n).padStart(2, '0')

/** Pure: a calendar date as `YYYY-MM-DD` from the flow store's `M/D/YYYY` or from an ISO date, or
 *  null. Never parsed into a time: a session or an expiry has no time zone to convert. */
export function isoDay(raw) {
  const s = text(raw)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  const parts = us ? [us[3], us[1], us[2]] : (/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s) || []).slice(1)
  if (parts.length !== 3) return null
  const [y, m, d] = parts.map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** Pure: 'call' | 'put' | null from the store's `C` / `P` (or the words). */
export function optionSide(raw) {
  const c = text(raw).toUpperCase().charAt(0)
  return c === 'C' ? 'call' : c === 'P' ? 'put' : null
}

const contractOf = (it) => {
  const strike = num(it.strike)
  return { side: optionSide(it.cp), strike: strike !== null && strike > 0 ? strike : null, expiry: isoDay(it.exp), daysLeft: num(it.dte) }
}
const whole = (v) => { const n = num(v); return n === null ? null : Math.round(n) }

/**
 * Pure: the Cream of the Crop answer as rows, bullish first then bearish, each in the server's
 * own order (grade, then premium).
 *   state     'ok' (rows, possibly none: nothing has qualified for that date) | 'computing' (the
 *             server holds no list for that date yet and is building one) | 'failed' (not a
 *             Cream of the Crop answer at all)
 *   builtAt   when the server built the list being read, as an ISO instant, or null (an older
 *             server does not say)
 *   stale     true when the server is rebuilding and this is the list it held meanwhile
 *   date      the session as `YYYY-MM-DD`, or null
 *   rows      { key, order, sym, direction ('bullish' | 'bearish'), unconfirmed, side, strike,
 *               expiry, daysLeft, premium, contracts, openInterest, volToOi, newStrike, grade, tier }
 *   counts    { all, bullish, bearish }
 *   net       the whole day's bullish and bearish premium across the market, or null
 *   twoSided  stocks left out because the day's flow went both ways: { sym, bull, bear }
 *   rules     the server's own selection knobs, for the method sentence (each null when not sent)
 */
export function creamRead(body) {
  const none = {
    state: 'failed', date: null, rows: [], counts: { all: 0, bullish: 0, bearish: 0 }, net: null, twoSided: [],
    rules: { perSide: null, perStock: null, minDays: null, noWeeklies: null, noBlockOnly: null, minGrade: null },
    builtAt: null, stale: false,
  }
  // The server's "still building" answer carries no lists at all, so it can never read as an empty day.
  if (isObj(body) && body.status === 'computing') return { ...none, state: 'computing', date: isoDay(body.date) }
  if (!isObj(body) || !Array.isArray(body.bull) || !Array.isArray(body.bear)) return none
  const rows = []
  for (const [bucket, direction] of [['bull', 'bullish'], ['bear', 'bearish']]) {
    for (const it of body[bucket]) {
      const sym = text(it?.sym).toUpperCase()
      if (!sym) continue
      const oi = num(it.oi)
      const voi = num(it.voi)
      const contracts = num(it.vol)
      rows.push({
        key: `${direction}-${sym}-${text(it.cp)}-${text(it.strike)}-${text(it.exp)}-${rows.length}`,
        order: rows.length,
        sym,
        direction,
        unconfirmed: it.unconfirmed === true,
        ...contractOf(it),
        premium: num(it.prem),
        contracts,
        openInterest: oi,
        volToOi: voi,
        // The server sends no ratio for a strike that had no open interest before the session.
        newStrike: voi === null && !(oi > 0) && contracts > 0,
        grade: text(it.grade) || null,
        tier: text(it.tier) || null,
      })
    }
  }
  const p = isObj(body.params) ? body.params : {}
  const flag = (v) => (typeof v === 'boolean' ? v : null)
  return {
    state: 'ok',
    date: isoDay(body.date),
    builtAt: num(body.built_at) !== null && num(body.built_at) > 0 ? new Date(num(body.built_at) * 1000).toISOString() : null,
    stale: body.stale === true,
    rows,
    counts: { all: rows.length, bullish: rows.filter((r) => r.direction === 'bullish').length, bearish: rows.filter((r) => r.direction === 'bearish').length },
    net: isObj(body.net) && num(body.net.bull) !== null && num(body.net.bear) !== null ? { bull: num(body.net.bull), bear: num(body.net.bear) } : null,
    twoSided: (Array.isArray(body.two_sided) ? body.two_sided : [])
      .map((t) => ({ sym: text(t?.sym).toUpperCase(), bull: num(t?.bull), bear: num(t?.bear) })).filter((t) => t.sym),
    rules: {
      perSide: whole(p.top_n), perStock: whole(p.max_per_ticker), minDays: whole(p.min_dte),
      noWeeklies: flag(p.exclude_weekly), noBlockOnly: flag(p.exclude_block_only), minGrade: text(p.min_grade) || null,
    },
  }
}

/**
 * Pure: the open flow board answer as rows, one per stock, biggest net premium first in EITHER
 * direction (so a cut list keeps the strongest names of both sides).
 *   state   'ok' (rows, possibly none) | 'computing' (the server is building it: ask again) |
 *           'unavailable' (the server said it could not build it) | 'failed' (not a board answer)
 *   rows    { key, order, sym, direction ('bullish' | 'bearish' | null), net, bull, bear,
 *             bullShare (percent, 0 to 100), side, strike, expiry, daysLeft, since, stockPct }
 *   names   how many stocks qualified on the server (it can be more than the rows it sent)
 *   openContracts, days, minDays   the build's own numbers
 *   builtAt  when the server built this board, as an ISO instant, or null
 */
export function boardRead(body) {
  const none = { state: 'failed', rows: [], names: null, openContracts: null, days: null, minDays: null, builtAt: null }
  if (!isObj(body)) return none
  if (body.ok === false) return { ...none, state: text(body.reason).toLowerCase().startsWith('comput') ? 'computing' : 'unavailable' }
  if (body.ok !== true || !Array.isArray(body.rows)) return none
  const seen = new Set()
  const rows = []
  for (const it of body.rows) {
    const sym = text(it?.sym).toUpperCase()
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    const net = num(it.net)
    rows.push({
      key: `open-${sym}`,
      sym,
      direction: net > 0 ? 'bullish' : net < 0 ? 'bearish' : null,
      net,
      bull: num(it.bull),
      bear: num(it.bear),
      bullShare: num(it.bullPct),
      ...contractOf(it),
      since: isoDay(it.since),
      stockPct: num(it.perf),
      sent: rows.length,
    })
  }
  rows.sort((a, b) => Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0) || a.sent - b.sent)
  const built = num(body.built_at)
  return {
    state: 'ok',
    rows: rows.map(({ sent: _sent, ...r }, i) => ({ ...r, order: i })),
    names: whole(body.n_names),
    openContracts: whole(body.open_contracts),
    days: whole(body.days),
    minDays: whole(body.min_dte),
    builtAt: built !== null && built > 0 ? new Date(built * 1000).toISOString() : null,
  }
}

/** Pure: a direction as a member reads it. An unconfirmed one says so in the same breath. */
export function directionWords(row) {
  if (row?.direction !== 'bullish' && row?.direction !== 'bearish') return 'Not given'
  const word = row.direction === 'bullish' ? 'Bullish' : 'Bearish'
  return row.unconfirmed ? `${word}, side not confirmed` : word
}
