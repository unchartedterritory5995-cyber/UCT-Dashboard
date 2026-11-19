// CONFL: the confluence board, the pure half (no React and no imports, so an agent capability can
// reuse it and args.js can take the word map without pulling a panel in).
//
// ⭐ NO NEW ROUTE. `GET /api/confluence?days=30` (api/main.py `_confluence_board`, served from
// api/confluence_screen.py `get_board`): stocks where a large dark pool dollar size and aligned
// long-dated options flow line up. Until now only the Confluence tab inside the Options Flow page
// read it (pages/Confluence.jsx through hooks/useConfluence.js).
// ⚠️ NOT `api/routers/signature.py`'s `/confluence`: that is a per-chart signal with another shape.
//
// THE GATE   `Depends(require_flow_user)` (api/flow_admin_auth.py): any signed-in session, 401
//            otherwise. It is not in the open-reads table, and no feature flag guards the route.
//            (`CONFLUENCE_ENABLED`, default on, only schedules the warm; without it or without
//            `WORKER_INTERNAL_URL` the route answers "warming" for ever.)
//
// WHAT IT ANSWERS
//   { ok: true, window, days, rows: [...], counts: { total, bull, bear, building }, band_meta,
//     allowedDays, warnings }   (compute_board)
//   or { ok: false, status: 'warming', reason, rows: [] } while a window has no cached board. The
//   route NEVER computes on the request: a cold or stale window is rebuilt behind the caller and
//   the last good board keeps serving (30 minute TTL, the default window re-warmed on a schedule).
//   A degraded compute ({ ok: false, status: 'flow_unavailable' }) is never cached, so a member
//   sees the last good board or "warming".
//     window   the dark pool window as text, "Oct 6 [en dash] Nov 14, 2026" (`windowText`
//              rewrites it with "to"). There is NO build time in the answer.
//     a row    ONE STOCK: { sym, band ('L' | 'M' | 'S'), dir ('BULL' | 'BEAR'), dpn, acc, net, net5,
//                bull, bear, bullPct, top: { cp, strike, exp (M/D/YYYY), dte, prem }, leapPrem,
//                leapShare, status, freshRatio, bigPrint, bigDate, dpLo, dpHi, dpAvg, dpLast,
//                bigPrice, sector, score }
//       dpn         dollars traded in the dark pool over the window
//       dpAvg       the volume-weighted average dark pool price; dpLo / dpHi the range; dpLast the
//                   last dark pool session's price (NOT a live quote)
//       bigPrint    the DOLLAR SIZE of the largest single print (the aggregator's `bigPrintN`);
//                   bigPrice its PRICE (the aggregator's `bigPrint`); bigDate its day as `MM/DD`
//       net         bullish less bearish premium on still-open option contracts, in dollars
//                   (negative on a bearish row); net5 the same over the last 5 trading days
//       bullPct     the bullish share ALREADY IN PERCENT (0 to 100)
//       leapShare   ⚠️ A FRACTION (0 to 1), not a percent: the part of the still-open premium in
//                   long-dated contracts. `confluenceRead` turns it into percent ONCE, here.
//       leapPrem    that long-dated premium in dollars
//       status      'BUILDING' (the last 5 days add at least 40% of the window's net, same way) |
//                   'STEADY' (still adding, more slowly) | 'ESTABLISHED' (in place, not adding)
//       acc         'Acc' | 'Dist': NOT SHOWN. A single unsigned dark pool print names a price, not
//                   a buyer (owner decision 2026-09-12); direction comes from the options flow.
//     Rows arrive ranked by `score`, best first. The score ranks a stock inside its own size band
//     and direction, so the panel lists each band on its own, in the order sent.
//
// ⛔ ONLY THE 30-DAY WINDOW IS READ. The route takes 20, 60 and 90 too, but only 30 is kept warm.
// Another window with nothing cached starts a multi-week scan on the flow-worker, the pod that
// runs the live tape, and that build is not held back during market hours
// (api/confluence_flow.py `flow_leg`). This panel never starts one.
// ⛔ A FAILED READ IS NEVER AN EMPTY BOARD. `ok: false` is "warming" or "could not build"; only a
// healthy answer with no rows says nothing lines up.

/** The terminal code proposed for this panel (the panel reads the live one from its frame). */
export const CONFLUENCE_CODE = 'CONFL'
/** The one window the server keeps warm (confluence_screen.DAYS). */
export const CONFLUENCE_DAYS = 30
export const CONFLUENCE_URL = `/api/confluence?days=${CONFLUENCE_DAYS}`

/** The direction filter, in chip order. `token` is what a chip writes into the command (`CONFL BEAR`). */
export const CONFLUENCE_LEANS = Object.freeze({
  all: Object.freeze({ chip: 'All', token: null, words: 'every direction' }),
  bullish: Object.freeze({ chip: 'Bullish', token: 'BULL', words: 'bullish names' }),
  bearish: Object.freeze({ chip: 'Bearish', token: 'BEAR', words: 'bearish names' }),
})

/** The words a direction is typed as. For an args.js kind (`parse: (tok) => parseConfluenceLean(tok)`). */
export const CONFLUENCE_LEAN_ARG_WORDS = Object.freeze({
  ALL: 'all', BOTH: 'all', ANY: 'all',
  BULL: 'bullish', BULLS: 'bullish', BULLISH: 'bullish', LONG: 'bullish',
  BEAR: 'bearish', BEARS: 'bearish', BEARISH: 'bearish', SHORT: 'bearish',
})

/** Pure: a typed word as a direction key (`bear` -> 'bearish'), or null. */
export function parseConfluenceLean(token) {
  const t = String(token ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(CONFLUENCE_LEAN_ARG_WORDS, t) ? CONFLUENCE_LEAN_ARG_WORDS[t] : null
}
/** Pure: the direction a prop or a typed word names; anything unknown is every direction. */
export const normConfluenceLean = (raw) => parseConfluenceLean(raw) || 'all'
/** Pure: the arguments a direction writes into the panel's command (every direction is the bare command). */
export const confluenceCommandArgs = ({ lean = null } = {}) => [CONFLUENCE_LEANS[normConfluenceLean(lean)].token].filter(Boolean)

/** The size bands, in the order the board lists them. The ranges are the server's own (`_BAND_META`). */
export const CONFLUENCE_BANDS = Object.freeze({
  L: Object.freeze({ name: 'Large cap', range: '$10B to $500B' }),
  M: Object.freeze({ name: 'Mid cap', range: '$2B to $10B' }),
  S: Object.freeze({ name: 'Small cap', range: 'under $2B' }),
})

const STATUS = Object.freeze({ BUILDING: 'building', STEADY: 'steady', ESTABLISHED: 'established' })
/** A status as a member reads it, after the direction: "Bullish, building". */
export const CONFLUENCE_STATUS_WORDS = Object.freeze({ building: 'building', steady: 'steady', established: 'established' })

const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v))
const pos = (v) => { const n = num(v); return n !== null && n > 0 ? n : null }
const text = (v) => (v === null || v === undefined ? '' : String(v).trim())
const whole = (v) => { const n = num(v); return n === null ? null : Math.round(n) }
const pad2 = (n) => String(n).padStart(2, '0')

/** Pure: a calendar date as `YYYY-MM-DD` from the flow store's `M/D/YYYY`, or null. Never a time. */
export function expiryDay(raw) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text(raw))
  if (!m) return null
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

/** Pure: the server's window text with its dash written as a word: "Oct 6 to Nov 14, 2026". */
export function windowText(raw) {
  return text(raw).replace(/\s*[\u2013\u2014]\s*|\s+-\s+/g, ' to ')
}

/** Pure: the last day of the window as `YYYY-MM-DD` ("Oct 6 to Nov 14, 2026" -> 2026-11-14), or null. */
export function windowEndDay(raw) {
  const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(text(raw))
  if (!m) return null
  const mo = MONTHS.indexOf(m[1]) + 1
  const d = Number(m[2])
  if (!mo || d < 1 || d > 31) return null
  return `${m[3]}-${pad2(mo)}-${pad2(d)}`
}

const bandRange = (raw) => text(raw).replace(/\s*[\u2013\u2014]\s*/g, ' to ').replace(/^<\s*/, 'under ')

function bandsOf(meta) {
  const out = {}
  for (const key of Object.keys(CONFLUENCE_BANDS)) {
    const sent = isObj(meta) && Array.isArray(meta[key]) ? meta[key] : null
    out[key] = { name: CONFLUENCE_BANDS[key].name, range: (sent && bandRange(sent[1])) || CONFLUENCE_BANDS[key].range }
  }
  return out
}

/**
 * Pure: the confluence answer as rows, one per stock, in the order the server ranked them.
 *   state     'ok' (rows, possibly none: nothing lines up) | 'warming' (no board cached yet: ask
 *             again) | 'unavailable' (the server said it could not build one) | 'failed' (not a
 *             confluence answer at all)
 *   rows      { key, order, sym, band ('L' | 'M' | 'S'), direction ('bullish' | 'bearish'),
 *               status ('building' | 'steady' | 'established' | null), sector,
 *               darkPool, avgPrice, lowPrice, highPrice, lastPrice, lastVsAvgPct,
 *               bigPrint (dollars), bigPrice, bigDate,
 *               net, net5, bull, bear, bullShare (percent, 0 to 100, as sent),
 *               leapPremium, leapSharePct (percent, 0 to 100: the server's fraction times 100),
 *               side, strike, expiry, daysLeft, topPremium, score }
 *   counts    { all, bullish, bearish, building }, counted from the rows kept
 *   days      the window the server answered for, in trading days
 *   window    the dark pool window in words; windowEnd its last day as `YYYY-MM-DD`, or null
 *   bands     { L, M, S }: { name, range }
 *   partial   true when the server marked the build with warnings (a leg answered late)
 */
export function confluenceRead(body) {
  const none = {
    state: 'failed', rows: [], counts: { all: 0, bullish: 0, bearish: 0, building: 0 }, days: null, window: '', windowEnd: null,
    bands: bandsOf(null), partial: false,
  }
  if (!isObj(body)) return none
  if (body.ok === false) {
    const why = `${text(body.status)} ${text(body.reason)}`.toLowerCase()
    return { ...none, state: /warm|comput/.test(why) ? 'warming' : 'unavailable' }
  }
  if (body.ok !== true || !Array.isArray(body.rows)) return none
  const seen = new Set()
  const rows = []
  for (const it of body.rows) {
    const sym = text(it?.sym).toUpperCase()
    const dir = text(it?.dir).toUpperCase()
    const band = text(it?.band).toUpperCase()
    // A row with no ticker, no direction or no size band cannot be placed on the board.
    if (!sym || seen.has(sym) || (dir !== 'BULL' && dir !== 'BEAR') || !CONFLUENCE_BANDS[band]) continue
    seen.add(sym)
    const top = isObj(it.top) ? it.top : {}
    const cp = text(top.cp).toUpperCase().charAt(0)
    const avgPrice = pos(it.dpAvg)
    const lastPrice = pos(it.dpLast)
    const share = num(it.leapShare)
    rows.push({
      key: `conf-${sym}`,
      order: rows.length,
      sym,
      band,
      direction: dir === 'BULL' ? 'bullish' : 'bearish',
      status: STATUS[text(it.status).toUpperCase()] || null,
      sector: text(it.sector) || null,
      darkPool: num(it.dpn),
      avgPrice,
      lowPrice: pos(it.dpLo),
      highPrice: pos(it.dpHi),
      lastPrice,
      lastVsAvgPct: avgPrice !== null && lastPrice !== null ? ((lastPrice - avgPrice) / avgPrice) * 100 : null,
      bigPrint: pos(it.bigPrint),
      bigPrice: pos(it.bigPrice),
      bigDate: text(it.bigDate) || null,
      net: num(it.net),
      net5: num(it.net5),
      bull: num(it.bull),
      bear: num(it.bear),
      bullShare: num(it.bullPct),
      leapPremium: num(it.leapPrem),
      // The one place the server's fraction becomes a percent.
      leapSharePct: share === null ? null : share * 100,
      side: cp === 'C' ? 'call' : cp === 'P' ? 'put' : null,
      strike: pos(top.strike),
      expiry: expiryDay(top.exp),
      // The server writes 0 when it could not read the days left, so 0 is "not given" here.
      daysLeft: pos(top.dte),
      topPremium: pos(top.prem),
      score: num(it.score),
    })
  }
  return {
    state: 'ok',
    rows,
    counts: {
      all: rows.length,
      bullish: rows.filter((r) => r.direction === 'bullish').length,
      bearish: rows.filter((r) => r.direction === 'bearish').length,
      building: rows.filter((r) => r.status === 'building').length,
    },
    days: whole(body.days),
    window: windowText(body.window),
    windowEnd: windowEndDay(body.window),
    bands: bandsOf(body.band_meta),
    partial: Array.isArray(body.warnings) && body.warnings.length > 0,
  }
}

/** Pure: the rows a direction filter keeps, still in the server's order. */
export function leanRows(rows, lean) {
  const want = normConfluenceLean(lean)
  return want === 'all' ? rows : rows.filter((r) => r.direction === want)
}

/** Pure: rows grouped by size band, large first, each band in the server's order; empty bands left out. */
export function bandGroups(rows) {
  return Object.keys(CONFLUENCE_BANDS)
    .map((band) => ({ band, rows: rows.filter((r) => r.band === band) }))
    .filter((g) => g.rows.length)
}

/** Pure: "Bullish, building" as a member reads a row's direction and how fresh the flow is. */
export function leanWords(row) {
  if (row?.direction !== 'bullish' && row?.direction !== 'bearish') return 'Not given'
  const word = row.direction === 'bullish' ? 'Bullish' : 'Bearish'
  return row.status ? `${word}, ${CONFLUENCE_STATUS_WORDS[row.status]}` : word
}
