// UNVOL: stocks trading far above their usual volume, the pure half (no React, so an agent
// capability can reuse it).
//
// ⭐ NO NEW ROUTE. One door the Screener page already uses (api/routers/screener.py, paid):
//
//   POST /api/screener/scan   { total, rows, snapshot_date, snapshot: { live, ... }, coverage? }
//                             400 with a sentence when a spec cannot run
//
// The scan is a SQL query over the screener snapshot held on the server (`screener_rows`, built at
// 03:00 ET) with the live overlay joined in (`screener_live`, rewritten about every 30 seconds in
// the regular session from the one whole-market snapshot the server already holds). It never calls
// a market data provider on the request.
//
// ── WHAT "USUAL VOLUME" MEANS, EXACTLY ───────────────────────────────────────────────────────
// Two readings, and the panel always says which one is on screen:
//
//   now   `rvol_live` = today's volume so far ÷ (the stock's average daily volume over the last 30
//         completed sessions × the share of a day's volume usually done by this minute).
//         The share comes from a curve the server learns each night from 5-minute bars of the last
//         20 full sessions: the stock's own curve when it has 15 or more of them, else the market's
//         (api/services/screener/volume_curve.py, live_tier.py). So 3× means three times the usual
//         pace at 10:00, at 13:00 and at the close alike. It is blank before 9:45 AM ET (the first
//         15 minutes swing too wildly to mean anything) and once the next nightly build lands. From
//         the close until that build it holds the closing value: the full day against a full day.
//   last  `vol_ratio` = the last completed session's volume ÷ the average of the 30 sessions
//         before it (api/services/screener/technicals.py `volume_ratio`). A whole day against
//         whole days, so it is honest at any hour; it is what the panel shows when there is no
//         "by now" reading (before 9:45 AM ET, overnight after the build, weekends, holidays).
//
// ⛔ NEVER today's volume so far over a full-day average: that reads about 0.8× at 10:00 for a
//    stock trading three times its pace, and calls everything unusual by the close.
// ⛔ A ROW WITH NO READING IS NOT LISTED, and a missing number is never drawn as 0.
//
// The route constant lives in UnusualVolumePanel.jsx, the module that draws the results: the
// coverage-receipt census finds a result surface by the scan routes its OWN module names
// (components/provenance/panelAdoption.ratchet.test.js, TERM-047).
import { describedSession, isoDay } from '../../screener/focus/dates'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const UNUSUAL_VOLUME_CODE = 'UNVOL'
/** Rows asked for: one page. A longer match is counted and said, never silently cut. */
export const UNVOL_PAGE_SIZE = 100

/** The two readings (see the header). */
export const UNVOL_MODES = Object.freeze({
  now: Object.freeze({ key: 'rvol_live' }),
  last: Object.freeze({ key: 'vol_ratio' }),
})

/**
 * Which stocks are looked at at all. These are the floors the Screener's own volume and
 * extended-hours starter screens use (api/services/screener/saved_screens.py: "$10M+ traded
 * daily, price $5+", stocks only), so a thin name printing 20× of nothing is not on the list.
 */
export const UNVOL_FLOORS = Object.freeze({ price: 5, dollarVol30d: 10_000_000 })

/** How far above usual a stock must be. 2× is the Screener's "Volume surge right now" floor. */
export const UNVOL_MINS = Object.freeze({
  2: Object.freeze({ chip: '2× or more', token: null }),
  3: Object.freeze({ chip: '3× or more', token: '3X' }),
  5: Object.freeze({ chip: '5× or more', token: '5X' }),
})
export const DEFAULT_UNVOL_MIN = 2

/** Which way the stock is going on the day. */
export const UNVOL_SIDES = Object.freeze({
  all: Object.freeze({ chip: 'Up or down', token: null, words: 'up or down on the day' }),
  up: Object.freeze({ chip: 'Up on the day', token: 'UP', words: 'up on the day' }),
  down: Object.freeze({ chip: 'Down on the day', token: 'DOWN', words: 'down on the day' }),
})
export const DEFAULT_UNVOL_SIDE = 'all'

/** Every word a side can be typed as. No word here is also a multiple, so the order typed does not matter. */
export const UNVOL_SIDE_ARG_WORDS = Object.freeze({
  UP: 'up', GAINERS: 'up', GREEN: 'up',
  DOWN: 'down', DN: 'down', LOSERS: 'down', RED: 'down',
})
/** Every word a multiple can be typed as (`UNVOL 3X`, `UNVOL 5`). */
export const UNVOL_MIN_ARG_WORDS = Object.freeze({
  '2X': 2, 2: 2, '3X': 3, 3: 3, '5X': 5, 5: 5,
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const upper = (v) => String(v ?? '').trim().toUpperCase()

/** Pure: a typed word as a side ('up' | 'down'), or null. For an args.js kind. */
export const parseUnvolSide = (token) => own(UNVOL_SIDE_ARG_WORDS, upper(token))
/** Pure: a typed word as a multiple (2 | 3 | 5), or null. For an args.js kind. */
export const parseUnvolMin = (token) => own(UNVOL_MIN_ARG_WORDS, upper(token))

/** Pure: a side the panel can show (a key, or a typed word), else the default. */
export function normUnvolSide(v) {
  const k = String(v ?? '').trim().toLowerCase()
  if (own(UNVOL_SIDES, k)) return k
  return parseUnvolSide(v) || DEFAULT_UNVOL_SIDE
}
/** Pure: a multiple the panel can show (a number, or a typed word), else the default. */
export function normUnvolMin(v) {
  if (own(UNVOL_MINS, String(v))) return Number(v)
  return parseUnvolMin(v) || DEFAULT_UNVOL_MIN
}

/** Pure: the words a pick writes into the panel's command (`UNVOL UP 3X`); the defaults write nothing. */
export function unvolCommandArgs({ side = DEFAULT_UNVOL_SIDE, min = DEFAULT_UNVOL_MIN } = {}) {
  return [UNVOL_SIDES[normUnvolSide(side)].token, UNVOL_MINS[normUnvolMin(min)].token].filter(Boolean)
}

/** The columns the panel reads. `bars_asof` dates the last completed session of each row. */
export const UNVOL_COLUMNS_READ = Object.freeze([
  'company', 'price', 'chg_pct_1d', 'rvol_live', 'vol_ratio', 'avg_volume_30d', 'industry', 'bars_asof',
])

/**
 * Pure: the body POSTed to the scan route for one reading. Every key is a Screener filter a member
 * can already set on /screener; nothing here is a new rule on the server.
 *   mode   'now' (rvol_live) | 'last' (vol_ratio)
 *   probe  true asks only "is there a by-now reading at all": the floors at the lowest multiple,
 *          any direction, one row. The panel uses it to tell "nothing matches" from "no reading".
 */
export function unvolScanBody(mode, { side = DEFAULT_UNVOL_SIDE, min = DEFAULT_UNVOL_MIN, probe = false } = {}) {
  const key = (UNVOL_MODES[mode] || UNVOL_MODES.now).key
  const s = probe ? DEFAULT_UNVOL_SIDE : normUnvolSide(side)
  const filters = [
    { key, op: 'gte', min: probe ? DEFAULT_UNVOL_MIN : normUnvolMin(min) },
    { key: 'price', op: 'gte', min: UNVOL_FLOORS.price },
    { key: 'dollar_vol_30d', op: 'gte', min: UNVOL_FLOORS.dollarVol30d },
    { key: 'security_type', op: 'not_in', values: ['ETF'] },
  ]
  if (s === 'up') filters.push({ key: 'chg_pct_1d', op: 'gt', min: 0 })
  if (s === 'down') filters.push({ key: 'chg_pct_1d', op: 'lt', max: 0 })
  return {
    filters,
    sort: { key, dir: 'desc' },
    view: 'technical',
    columns: [...UNVOL_COLUMNS_READ],
    page: 1,
    page_size: probe ? 1 : UNVOL_PAGE_SIZE,
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pos = (v) => (num(v) != null && v > 0 ? v : null)
const text = (v) => (typeof v === 'string' ? v.trim() : '')

/** The value most rows share (the session most of a list describes), or null. */
function mostCommon(values) {
  const counts = new Map()
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1)
  let best = null
  for (const [v, n] of counts) if (!best || n > best[1] || (n === best[1] && v > best[0])) best = [v, n]
  return best ? best[0] : null
}

/**
 * Pure: the scan answer as panel rows, for one reading.
 *   ok          false when the body is not a scan answer (a failed read, never an empty list)
 *   rows        [{ sym, company, multiple, chgPct, price, avgVol, industry, order }] in the server's
 *               order (highest multiple first). A row with no reading for THIS mode is left out
 *               and counted in `unread`, never drawn as 0×.
 *   total       how many stocks matched on the server (the rows are one page of them)
 *   liveAt      'now' only: the ISO instant the newest reading on the page was worked out
 *               (`live_asof` the server stamps on each live row), or null when it sent none
 *   session     'last' only: the session the volumes describe (most rows' own `bars_asof`), a
 *               calendar date, or null
 *   pricesLive  'last' only: true when the prices on the page are today's live ones (the overlay is
 *               serving) while the volumes are the last session's; the panel says so
 *   coverage    the scan's four-count receipt, as sent, or null
 */
export function unvolView(body, mode) {
  const none = { ok: false, rows: [], total: 0, unread: 0, liveAt: null, session: null, pricesLive: false, coverage: null }
  if (!isObj(body) || !Array.isArray(body.rows)) return none
  const key = (UNVOL_MODES[mode] || UNVOL_MODES.now).key
  const rows = []
  const seen = new Set()
  let unread = 0
  let newest = null
  let pricesLive = false
  const sessions = []
  for (const r of body.rows) {
    const sym = text(r?.ticker).toUpperCase()
    if (!sym || seen.has(sym)) continue
    seen.add(sym)
    const multiple = pos(r[key])
    if (multiple == null) { unread += 1; continue }
    if (r.live_row) {
      pricesLive = true
      const at = pos(r.live_asof)
      if (at != null && (newest == null || at > newest)) newest = at
    }
    sessions.push(isoDay(r.bars_asof))
    rows.push({
      sym,
      company: text(r.company) || null,
      multiple,
      chgPct: num(r.chg_pct_1d),
      price: pos(r.price),
      avgVol: pos(r.avg_volume_30d),
      industry: text(r.industry) || null,
      order: rows.length,
    })
  }
  const total = num(body.total)
  const snapshotDate = isoDay(body.snapshot_date) || isoDay(body.snapshot?.snapshot_date)
  const tierAt = pos(body.snapshot?.live?.as_of)
  const at = newest ?? (mode === 'now' && rows.length ? tierAt : null)
  return {
    ok: true,
    rows,
    total: total !== null && total > rows.length ? total : rows.length,
    unread,
    liveAt: mode === 'now' && at != null ? new Date(at * 1000).toISOString() : null,
    session: mode === 'last' ? (mostCommon(sessions) || (snapshotDate ? describedSession(snapshotDate) : null)) : null,
    pricesLive: mode === 'last' && pricesLive,
    coverage: isObj(body.coverage) ? body.coverage : null,
  }
}

/** A by-now reading older than this is not "right now" any more (the close, or a stalled sweep). */
export const UNVOL_LIVE_FRESH_MS = 5 * 60 * 1000

/** Pure: is a by-now reading still moving? `liveAt` within `UNVOL_LIVE_FRESH_MS` of `now` (epoch ms). */
export function unvolIsMoving(liveAt, now = Date.now()) {
  const t = liveAt ? Date.parse(liveAt) : NaN
  return Number.isFinite(t) && now - t >= 0 && now - t <= UNVOL_LIVE_FRESH_MS
}

/** Pure: "4.2×". One decimal under 10, none from 10 up; a missing value reads n/a, never 0×. */
export function multipleText(v) {
  const n = pos(v)
  if (n == null) return 'n/a'
  return `${formatNumber(n, { decimals: n >= 9.95 ? 0 : 1 })}×`
}
