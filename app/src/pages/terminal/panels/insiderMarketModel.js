// INS: market-wide insider trades. The pure half of the default view (InsiderPanel.jsx): which side and window,
// the words a member types for each, the read's URL, payload to rows, and the plain sentences.
//
//   INS                 buys, the last 7 days (GET /api/insider/feed?scope=market: a list, unchanged)
//   INS SELLS | BOTH    open-market sales, or both sides
//   INS 30D | 90D       a longer window (7D is the default)
// Anything but the default reads GET /api/insider/feed?scope=market&side=..&days=.. (api/services/insider.py
// `get_market_insider_trades`): an object held by the server, `computing` until its first background build,
// then the last answer with its build time; a build bounded per side says how far back it reached.
// Both reads: the paid gate (402), the vendor's market-wide Form 4 feed (FMP), largest dollar value first, up to 50.

export const INS_CODE = 'INS'
export const INSIDER_URL = '/api/insider/feed?scope=market'
export const INS_SOURCE = 'SEC Form 4 filings (FMP)'
export const INS_COMPUTING_POLL_MS = 15 * 1000

export const INS_SIDES = Object.freeze({
  buys: Object.freeze({ label: 'Buys', token: null, noun: 'insider purchases', short: 'buys' }),
  sells: Object.freeze({ label: 'Sales', token: 'SELLS', noun: 'insider sales', short: 'sales' }),
  both: Object.freeze({ label: 'Both', token: 'BOTH', noun: 'insider purchases and sales', short: 'trades' }),
})
export const INS_WINDOWS = Object.freeze({
  7: Object.freeze({ label: '7 days', token: null }),
  30: Object.freeze({ label: '30 days', token: '30D' }),
  90: Object.freeze({ label: '90 days', token: '90D' }),
})
export const DEFAULT_INS_SIDE = 'buys'
export const DEFAULT_INS_WINDOW = 7

/** The words a member types (upper case: the shell upper-cases typed tokens). */
export const INS_SIDE_ARG_WORDS = Object.freeze({
  BUYS: 'buys', BUY: 'buys', BUYING: 'buys', PURCHASES: 'buys',
  SELLS: 'sells', SELL: 'sells', SALES: 'sells', SELLING: 'sells',
  BOTH: 'both', ALL: 'both',
})
export const INS_WINDOW_ARG_WORDS = Object.freeze({
  '7D': 7, '1W': 7, WEEK: 7,
  '30D': 30, '1M': 30, MONTH: 30,
  '90D': 90, '3M': 90, QUARTER: 90,
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
const word = (t) => String(t ?? '').trim().toUpperCase()

export const parseInsSide = (token) => own(INS_SIDE_ARG_WORDS, word(token))
export const parseInsWindow = (token) => own(INS_WINDOW_ARG_WORDS, word(token))
export const normInsSide = (raw) => (own(INS_SIDES, String(raw ?? '').toLowerCase()) ? String(raw).toLowerCase() : parseInsSide(raw)) || DEFAULT_INS_SIDE
export const normInsWindow = (raw) => (own(INS_WINDOWS, String(Number(raw))) ? Number(raw) : parseInsWindow(raw)) || DEFAULT_INS_WINDOW

/** What a pick writes back after the code (the defaults write nothing: bare `INS`). */
export function insCommandArgs({ side = null, window = null } = {}) {
  const s = INS_SIDES[normInsSide(side)]
  const w = INS_WINDOWS[normInsWindow(window)]
  return [s.token, w.token].filter(Boolean)
}

const isDefault = (side, window) => normInsSide(side) === DEFAULT_INS_SIDE && normInsWindow(window) === DEFAULT_INS_WINDOW

/** The read: the default list route, or the held route with its side and days. */
export function insiderUrl({ side = null, window = null } = {}) {
  if (isDefault(side, window)) return INSIDER_URL
  return `${INSIDER_URL}&side=${normInsSide(side)}&days=${normInsWindow(window)}`
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Pure: the body (the default route's list, or the held route's object) as
 * `{ state: 'ok' | 'computing' | 'failed', rows, meta }`, rows in the server's order (largest dollar value first).
 * A row's `type` is kept: on the default list only buys pass, as before.
 */
export function insiderRead(body, { side = DEFAULT_INS_SIDE } = {}) {
  const want = normInsSide(side)
  const keep = (t) => (want === 'both' ? t === 'buy' || t === 'sell' : t === (want === 'sells' ? 'sell' : 'buy'))
  const list = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : []
  const state = Array.isArray(body) ? 'ok' : body?.status === 'computing' ? 'computing' : body?.status === 'failed' ? 'failed' : 'ok'
  const rows = list
    .filter((b) => b && b.symbol && keep(b.type ?? 'buy'))
    .map((b, i) => ({
      key: `${b.symbol}-${b.name}-${b.date}-${b.type ?? 'buy'}-${i}`,
      order: i,
      sym: String(b.symbol).trim().toUpperCase(),
      type: b.type === 'sell' ? 'sell' : 'buy',
      name: String(b.name || '').trim() || 'Name not given',
      role: String(b.title || '').trim() || 'Role not given',
      amount: num(b.amount),
      shares: num(b.shares),
      price: num(b.price),
      date: String(b.date || '').slice(0, 10) || null,
      filed: String(b.filing_date || '').slice(0, 10) || null,
    }))
  const meta = Array.isArray(body) || !body ? {} : {
    builtAt: num(body.built_at),
    refreshing: body.refreshing === true,
    lastFailed: body.last_build_failed_at != null,
    matched: num(body.matched),
    cap: num(body.cap),
    cut: body.cut === true,
    sides: body.sides && typeof body.sides === 'object' ? body.sides : {},
    reason: typeof body.reason === 'string' ? body.reason : null,
  }
  return { state, rows, meta }
}

/** Pure: the newest filing date in the list (the read's as-of), or null. */
export function newestFiling(rows) {
  return rows.reduce((best, r) => {
    const d = r.filed || r.date
    return d && (!best || d > best) ? d : best
  }, null)
}

/** "insider sales in the last 30 days" */
export function insWhat(side, window) {
  return `${INS_SIDES[normInsSide(side)].noun} in the last ${normInsWindow(window)} days`
}

/** The sentences a share must repeat: a list the server cut, and a side whose read stopped before the window's start. */
export function insCutNotes(meta) {
  const out = []
  if (meta?.cut && meta.matched != null && meta.cap != null) {
    out.push(`Showing the ${meta.cap} largest of ${meta.matched.toLocaleString('en-US')} by dollar value.`)
  }
  for (const [name, s] of Object.entries(meta?.sides || {})) {
    if (s && s.reached_window === false) {
      const which = name === 'sells' ? 'Sales' : 'Purchases'
      out.push(s.covered_from
        ? `${which} filed since ${s.covered_from} only: the read stops after ${s.max_pages} pages of filings.`
        : `${which} could not be read back to the start of the window.`)
    }
    if (s && s.complete === false) out.push(`${name === 'sells' ? 'Sales' : 'Purchases'}: part of the vendor's feed could not be read on the last build.`)
  }
  return out
}

/** The trade's side in words, for the second line under the insider's name. */
export const sideWord = (type) => (type === 'sell' ? 'Sold' : 'Bought')
