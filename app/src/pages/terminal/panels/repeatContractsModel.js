// ACCUM: repeat-hit option contracts under the day's flow read, the pure half (no React and no
// imports, so an agent capability can reuse it and args.js can take the word map without pulling
// a panel in).
//
// ⭐ NO NEW ROUTE. Both are served by the partner-owned Live Flow router
// (api/live_massive_router.py), which on the web service is forwarded to the flow-worker
// (api/flow_proxy.py: an upstream failure is a 502, an unconfigured proxy a 503, never a stale
// local answer). Until now only the Live Flow page read them (pages/LiveFlowMassive.jsx: its
// Market Read card and its By-Contract view). The Terminal's LIVE code is a door to that page,
// TIDE reads /api/options/market-tide and FLOW is a per-stock tab, so no panel showed either.
//
//   GET /api/live/massive/day-stats    the day's bullish against bearish option premium
//   GET /api/live/massive/by-contract  one row per contract hit again and again in the session
//
// THE GATE (both)   no dependency of their own. They are classed PAID in api/open_reads_gate.py,
//                   which refuses them (401 signed out, 402 not paid) only while OPEN_READS_GATE
//                   is "enforce". No feature flag. The numbers come from the flow store
//                   (flow.db, the Massive options tape), not from the Schwab option chain.
//
// WHAT EACH ANSWERS
//   day-stats   { query_date (M/D/YYYY), total_classified, directional_count, covers_from,
//                 bull_premium, bear_premium, bull_count, bear_count, by_dte: [...],
//                 top_bull: [{ ticker, premium }], top_bear: [...],
//                 last_hour: { bull_premium, bear_premium, count, is_today_target, top_tickers } }
//     Dollars throughout; the route sends NO percent, so the bullish share is worked out here from
//     the two dollar figures. `covers_from` is epoch seconds and is set only when the server's
//     emergency row cap cut the day: the read then starts at that time and THE MORNING IS MISSING.
//     `last_hour` is the last 60 minutes for today, or the last hour of trading on a past day.
//     With no tape for the date every figure is 0 and `total_classified` is 0: a healthy answer.
//   by-contract { query_date, stock_etf, min_hits, contract_count, contracts: [...],
//                 budget_cut_days: [...] }   (_build_by_contract)
//     a contract  { ticker, cp, strike, exp (M/D/YYYY), dte, hit_count, qualifying_hits, floor,
//                   total_premium, bull_premium, bear_premium, direction ('Bull' | 'Bear' | 'Mixed'
//                   | 'Unclear'), consistency, sided_pct, cum_voi, max_oi, accumulation_grade
//                   ('A+' followed by a rocket picture | 'A' | 'B' | 'C' | 'D'), accumulation_shape, swift_hits, burst_rising,
//                   is_intraday_burst, dormant, score, first_ts, last_ts, prints: [...], ... }
//       qualifying_hits  trades on the contract that cleared the size floor for the stock's market
//                        cap (`floor`, dollars); the route keeps a contract with at least
//                        `min_hits` of them whose total clears a second, cap-scaled floor.
//                        hit_count is every trade counted, floor or not.
//       total_premium    dollars across ALL the contract's trades
//       direction        'Mixed' as soon as BOTH sides carry any premium, so the dollars say which
//                        way it leans; 'Unclear' when no trade has a readable side
//       consistency, sided_pct   ⚠️ FRACTIONS (0 to 1). Not used here: the share shown is worked
//                        out from the dollar figures instead.
//       cum_voi          the day's contracts over the open interest before the session; null when
//                        that open interest is not known
//       swift_hits       the most qualifying trades inside any 5 minutes; is_intraday_burst when
//                        that is 4 or more; burst_rising when the fill price rose across them
//       first_ts, last_ts  epoch seconds
//     Contracts arrive latest activity first. A one-day read is the whole session (no row cap);
//     `budget_cut_days` only fills on a multi-day range, which this panel never asks for.
//
// ⛔ ONLY THE KEYS THE FLOW-WORKER ALREADY WARMS ARE READ FOR TODAY: day-stats (today, all) and
// by-contract (today, all, 3 hits, 1 day), the same two the Live Flow page asks for
// (flow_worker_main `_start_recent_cache_warmer`). A typed past day is one cached read per day
// (6 hours on the server), the same read the Live Flow page's date picker makes.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST. Only a healthy answer with no contracts says nothing
// has been hit often enough, and for which date.

/** The terminal code proposed for this panel (the panel reads the live one from its frame). */
export const REPEAT_CODE = 'ACCUM'
/** The hit floor of the one by-contract key the flow-worker keeps warm. */
export const REPEAT_MIN_HITS = 3

const DAY_STATS = '/api/live/massive/day-stats?stock_etf=all'
const BY_CONTRACT = `/api/live/massive/by-contract?stock_etf=all&min_hits=${REPEAT_MIN_HITS}&lookback_days=1`

const pad2 = (n) => String(n).padStart(2, '0')
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const whole = (v) => { const n = num(v); return n === null ? null : Math.round(n) }
const instant = (v) => { const n = pos(v); return n === null ? null : new Date(n * 1000).toISOString() }

/** Pure: a real calendar day typed or passed as `YYYY-MM-DD`, or null (which means today). */
export function normRepeatDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(raw))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d, 12))
  // Date rolls an impossible day over (02-30 becomes 03-02): a day that does not round-trip was never real.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === mo && dt.getUTCDate() === d ? m[0] : null
}

/** Pure: the weekday before a `YYYY-MM-DD` day (Monday gives Friday), or null. Holidays are not known here. */
export function previousWeekday(iso) {
  const day = normRepeatDate(iso)
  if (!day) return null
  const [y, mo, d] = day.split('-').map(Number)
  const dt = new Date(Date.UTC(y, mo - 1, d, 12))
  do { dt.setUTCDate(dt.getUTCDate() - 1) } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6)
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

/** Pure: the day's flow read URL. No date is the server's current Eastern day (the warmed key). */
export const dayReadUrl = (date = null) => { const d = normRepeatDate(date); return d ? `${DAY_STATS}&target_date=${d}` : DAY_STATS }
/** Pure: the repeat-hit contracts URL. No date is the server's current Eastern day (the warmed key). */
export const repeatContractsUrl = (date = null) => { const d = normRepeatDate(date); return d ? `${BY_CONTRACT}&target_date=${d}` : BY_CONTRACT }

/** The two orders, in chip order. `token` is what a chip writes into the command (`ACCUM LATEST`). */
export const REPEAT_ORDERS = Object.freeze({
  strong: Object.freeze({ chip: 'Strongest first', token: null }),
  latest: Object.freeze({ chip: 'Latest first', token: 'LATEST' }),
})

/** The words an order is typed as. For an args.js kind (`parse: (tok) => parseRepeatOrder(tok)`). */
export const REPEAT_ORDER_ARG_WORDS = Object.freeze({
  STRONG: 'strong', STRONGEST: 'strong', SCORE: 'strong', TOP: 'strong', BEST: 'strong',
  LATEST: 'latest', RECENT: 'latest', NEWEST: 'latest', TIME: 'latest',
})

/** Pure: a typed word as an order key (`latest` -> 'latest'), or null. */
export function parseRepeatOrder(token) {
  const t = String(token ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(REPEAT_ORDER_ARG_WORDS, t) ? REPEAT_ORDER_ARG_WORDS[t] : null
}
/** Pure: the order a prop or a typed word names; anything unknown is strongest first. */
export const normRepeatOrder = (raw) => parseRepeatOrder(raw) || 'strong'
/** Pure: the arguments a day and an order write into the panel's command (today, strongest first is the bare command). */
export const repeatCommandArgs = ({ date = null, order = null } = {}) => [normRepeatDate(date), REPEAT_ORDERS[normRepeatOrder(order)].token].filter(Boolean)

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

const tickers = (list) => (Array.isArray(list) ? list : [])
  .map((t) => ({ sym: text(t?.ticker).toUpperCase(), premium: num(t?.premium) })).filter((t) => t.sym)

/**
 * Pure: the day's flow read.
 *   state      'ok' | 'failed' (not a day-stats answer at all)
 *   date       the session as `YYYY-MM-DD`, or null
 *   bull, bear dollars of bullish and bearish premium; net = bull - bear
 *   bullSharePct  the bullish share of the two, in percent (0 to 100), worked out from the dollars;
 *                 null when neither side has any premium
 *   lean       'bullish' | 'bearish' | 'even' | null (no directional premium read)
 *   trades     how many directional trades the dollars come from; classified every trade read
 *   hasTape    false when the server read no trade at all for the date
 *   coversFrom an ISO instant when the server cut the day: the read STARTS there (the morning is
 *              missing); null for a whole day
 *   lastHour   { bull, bear, count, live } or null; `live` is the rolling last 60 minutes of today
 *   topBull, topBear  [{ sym, premium }], the server's own top ten each
 */
export function dayRead(body) {
  const none = {
    state: 'failed', date: null, bull: null, bear: null, net: null, bullSharePct: null, lean: null, trades: null, classified: null,
    hasTape: false, coversFrom: null, lastHour: null, topBull: [], topBear: [],
  }
  if (!isObj(body)) return none
  const bull = num(body.bull_premium)
  const bear = num(body.bear_premium)
  if (bull === null || bear === null) return none
  const total = bull + bear
  const classified = whole(body.total_classified)
  const counted = num(body.bull_count) !== null && num(body.bear_count) !== null ? num(body.bull_count) + num(body.bear_count) : null
  const lh = isObj(body.last_hour) ? body.last_hour : null
  const lhBull = lh ? num(lh.bull_premium) : null
  const lhBear = lh ? num(lh.bear_premium) : null
  return {
    state: 'ok',
    date: isoDay(body.query_date),
    bull,
    bear,
    net: bull - bear,
    bullSharePct: total > 0 ? (bull / total) * 100 : null,
    lean: total > 0 ? (bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'even') : null,
    trades: whole(body.directional_count) ?? whole(counted),
    classified,
    hasTape: (classified ?? 0) > 0 || total > 0,
    coversFrom: instant(body.covers_from),
    lastHour: lhBull !== null && lhBear !== null ? { bull: lhBull, bear: lhBear, count: whole(lh.count), live: lh.is_today_target === true } : null,
    topBull: tickers(body.top_bull),
    topBear: tickers(body.top_bear),
  }
}

const DIRECTION = Object.freeze({ BULL: 'bullish', BEAR: 'bearish', MIXED: 'mixed', UNCLEAR: 'unclear' })
/** The grade as plain letters: the server's top band carries a picture after its "A+". */
const gradeText = (raw) => text(raw).replace(/[^\x20-\x7E]/g, '').trim() || null

/**
 * Pure: the repeat-hit contracts answer as rows, in the order the server sent them (latest
 * activity first).
 *   state    'ok' (rows, possibly none: nothing has been hit often enough) | 'failed' (not a
 *            by-contract answer at all)
 *   date     the session as `YYYY-MM-DD`, or null
 *   minHits  the hit floor the server applied
 *   rows     { key, order, sym, side, strike, expiry, daysLeft, hits, trades, floor, premium, bull,
 *              bear, direction ('bullish' | 'bearish' | 'mixed' | 'unclear'),
 *              leanSide ('bullish' | 'bearish' | null), leanSharePct (percent, 0 to 100: the part
 *              of ALL the contract's premium on its heavier side, from the dollars),
 *              volToOi, openInterest, grade, burst, burstHits, burstRising, shape, quietName,
 *              score, firstAt, lastAt (ISO instants) }
 *   latestAt the newest trade among the rows, an ISO instant, or null
 */
export function repeatRead(body) {
  const none = { state: 'failed', date: null, minHits: null, rows: [], latestAt: null }
  if (!isObj(body) || !Array.isArray(body.contracts)) return none
  const rows = []
  for (const it of body.contracts) {
    const sym = text(it?.ticker).toUpperCase()
    if (!sym) continue
    const cp = text(it.cp).toUpperCase().charAt(0)
    const premium = num(it.total_premium)
    const bull = num(it.bull_premium)
    const bear = num(it.bear_premium)
    const leanSide = bull !== null && bear !== null && bull !== bear ? (bull > bear ? 'bullish' : 'bearish') : null
    const heavier = leanSide === 'bullish' ? bull : leanSide === 'bearish' ? bear : null
    const hits = whole(it.qualifying_hits)
    rows.push({
      key: `rep-${sym}-${cp}-${text(it.strike)}-${text(it.exp)}-${rows.length}`,
      order: rows.length,
      sym,
      side: cp === 'C' ? 'call' : cp === 'P' ? 'put' : null,
      strike: pos(it.strike),
      expiry: isoDay(it.exp),
      daysLeft: num(it.dte),
      hits,
      trades: whole(it.hit_count),
      floor: pos(it.floor),
      premium,
      bull,
      bear,
      direction: DIRECTION[text(it.direction).toUpperCase()] || 'unclear',
      leanSide,
      leanSharePct: heavier !== null && premium > 0 ? Math.min(100, (heavier / premium) * 100) : null,
      volToOi: num(it.cum_voi),
      openInterest: pos(it.max_oi),
      grade: gradeText(it.accumulation_grade),
      burst: it.is_intraday_burst === true,
      burstHits: whole(it.swift_hits),
      burstRising: it.burst_rising === true,
      shape: text(it.accumulation_shape) || null,
      quietName: it.dormant === true,
      score: num(it.score),
      firstAt: instant(it.first_ts),
      lastAt: instant(it.last_ts),
    })
  }
  const stamps = rows.map((r) => r.lastAt).filter(Boolean).sort()
  return {
    state: 'ok',
    date: isoDay(body.query_date),
    minHits: whole(body.min_hits),
    rows,
    latestAt: stamps.length ? stamps[stamps.length - 1] : null,
  }
}

/** Pure: the rows in an order. 'latest' is the order sent; 'strong' is the server's own score,
 *  highest first, a row with no score last and ties in the order sent. Never mutates `rows`. */
export function orderRows(rows, order) {
  if (normRepeatOrder(order) === 'latest') return [...rows].sort((a, b) => a.order - b.order)
  return [...rows].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.order - b.order)
}

/** Pure: a contract's direction as a member reads it. A mixed one says which way the dollars lean. */
export function directionWords(row) {
  if (row?.direction === 'bullish') return 'Bullish'
  if (row?.direction === 'bearish') return 'Bearish'
  if (row?.direction === 'mixed') return row.leanSide ? `Mixed, mostly ${row.leanSide}` : 'Mixed'
  return 'Side not clear'
}

/** Pure: the day's read in one phrase: which side's premium leads. */
export function leanPhrase(read) {
  if (read?.lean === 'bullish') return 'Bullish premium leads'
  if (read?.lean === 'bearish') return 'Bearish premium leads'
  if (read?.lean === 'even') return 'Bullish and bearish premium are even'
  return 'No directional premium has been read'
}
