// Theme rotation: which UCT themes are rotating in and which are rotating out, the pure half (no
// React and no imports, so an agent capability can reuse it and args.js can take
// `parseRotationSide` without pulling a panel in).
//
// ⭐ NO NEW ROUTE. `GET /api/theme-rotation` (api/routers/theme_performance.py over
// api/services/theme_performance.compute_rotation_signals). Until now the Theme Tracker page read
// it and showed none of it; THMS reads `/api/theme-performance` (returns by period), never this.
//
//   gate     paid (`require_paid`: 401 signed out, 402 "Theme performance requires a paid plan").
//            No feature flag.
//   answer   { rotating_in: [entry], rotating_out: [entry], rankings: { <theme key>: entry },
//              generated_at }   HTTP 200, cached 15 minutes on the server
//     entry  { name, ticker, 1w_return, 1w_rank, 1m_return, 1m_rank, 3m_return, 3m_rank,
//              momentum_delta }
//            `*_return` is the theme's return in PERCENT (2.5 means 2.5%), its published
//            `group_return` else the mean of its curated members. `*_rank` is the theme's
//            PERCENTILE among all themes for that period (0 = weakest, 100 = strongest).
//            `momentum_delta` is the 1 week rank less the 1 month rank; it is absent when either
//            rank is.
//     rotating_in    every theme whose delta is +20 or more, biggest climb first. Not cut.
//     rotating_out   every theme whose delta is -20 or less, biggest drop first. Not cut.
//     rankings       every theme, rotating or not (the count the panel states).
//   cold     while theme returns are still being computed the service has no themes and answers
//            200 with BOTH lists empty and `rankings: {}`. That is "not ready yet", never "nothing
//            is rotating": the model reads an empty `rankings` as warming.
//   failed   503 with a `detail` sentence when the computation raises.

export const THEME_ROTATION_CODE = 'TROT'
export const THEME_ROTATION_URL = '/api/theme-rotation'
/** The server's own threshold: a rank change of this many percentile points is a rotation. */
export const ROTATION_THRESHOLD = 20
/** The server caches the answer this long, so the panel asks again at the same pace. */
export const ROTATION_POLL_MS = 15 * 60 * 1000

/** Which lists show. `token` is what the chip writes into the command (`TROT OUT`). */
export const ROTATION_SIDES = Object.freeze({
  both: Object.freeze({ chip: 'In and out', token: null }),
  in: Object.freeze({ chip: 'Rotating in', token: 'IN' }),
  out: Object.freeze({ chip: 'Rotating out', token: 'OUT' }),
})

/** The words the command line takes after the code, and the list each one means. */
export const ROTATION_SIDE_WORDS = Object.freeze({
  IN: 'in', INTO: 'in', UP: 'in', RISING: 'in', LEADERS: 'in', GAINING: 'in',
  OUT: 'out', DOWN: 'out', FADING: 'out', FALLING: 'out', LAGGARDS: 'out', LOSING: 'out',
})

/** Pure: the list a typed word names, or null when it names none (args.js reports it "not applied"). */
export const parseRotationSide = (raw) => {
  const word = String(raw ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(ROTATION_SIDE_WORDS, word) ? ROTATION_SIDE_WORDS[word] : null
}
/** Pure: the list a prop or a typed word names; anything unknown is both lists. */
export const normRotationSide = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(ROTATION_SIDES, s) ? s : parseRotationSide(s) || 'both'
}
/** Pure: the arguments a view writes into the panel's command (both lists is the bare command). */
export const rotationCommandArgs = ({ side = null } = {}) => [ROTATION_SIDES[normRotationSide(side)].token].filter(Boolean)

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function rowOf(e, side, order) {
  if (!e || typeof e !== 'object') return null
  const key = String(e.ticker ?? '').trim()
  const delta = num(e.momentum_delta)
  // A row with no key or no rank change cannot be placed in either list; it is dropped, never drawn as 0.
  if (!key || delta === null) return null
  return {
    key: `${side}-${key}`,
    order,
    themeKey: key,
    name: String(e.name ?? '').trim() || key,
    delta,
    rank1w: num(e['1w_rank']),
    rank1m: num(e['1m_rank']),
    rank3m: num(e['3m_rank']),
    ret1w: num(e['1w_return']),
    ret1m: num(e['1m_return']),
    ret3m: num(e['3m_return']),
  }
}

function sideRows(list, side) {
  const out = []
  const seen = new Set()
  for (const e of (Array.isArray(list) ? list : [])) {
    const row = rowOf(e, side, out.length)
    // The server's sign rule is kept: a row on the wrong side of zero is not this list's.
    if (!row || seen.has(row.themeKey) || (side === 'in' ? row.delta <= 0 : row.delta >= 0)) continue
    seen.add(row.themeKey)
    out.push(row)
  }
  // Biggest move first, as the server sends it; re-sorted so a reordered payload cannot mislead.
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.order - b.order)
}

/**
 * Pure: the answer as the panel needs it.
 *   state        'ok' | 'warming' (the server has no theme returns yet) | 'failed' (not this shape)
 *   rotatingIn   rows, biggest climb first: { key, themeKey, name, delta, rank1w, rank1m, rank3m,
 *                ret1w, ret1m, ret3m } (ranks are percentiles 0 to 100, returns are percent)
 *   rotatingOut  rows, biggest drop first (delta is negative)
 *   ranked       how many themes the server ranked in all
 *   generatedAt  the ISO instant the server worked the answer out, or null
 */
export function rotationRead(body) {
  const base = { rotatingIn: [], rotatingOut: [], ranked: 0, generatedAt: null }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { state: 'failed', ...base }
  if (!Array.isArray(body.rotating_in) || !Array.isArray(body.rotating_out)) return { state: 'failed', ...base }
  // The server stamps microseconds (`...T15:04:05.123456+00:00`); a browser is only promised three digits.
  const generatedAt = typeof body.generated_at === 'string' && body.generated_at
    ? body.generated_at.replace(/(\.\d{3})\d+/, '$1') : null
  const rankings = body.rankings && typeof body.rankings === 'object' && !Array.isArray(body.rankings) ? body.rankings : {}
  const ranked = Object.keys(rankings).length
  if (ranked === 0) return { state: 'warming', ...base, generatedAt }
  return {
    state: 'ok',
    rotatingIn: sideRows(body.rotating_in, 'in'),
    rotatingOut: sideRows(body.rotating_out, 'out'),
    ranked,
    generatedAt,
  }
}

const whole = (v) => (v === null || v === undefined ? null : Math.round(v))

/** Pure: `41 to 82`, the 1 month rank then the 1 week rank, or null when either is missing. */
export function rankMoveText(row) {
  const from = whole(row?.rank1m)
  const to = whole(row?.rank1w)
  return from === null || to === null ? null : `${from} to ${to}`
}

/**
 * Pure: `+41` / `-27`, the rank change in whole percentile points with its sign, or null.
 * When both ranks are known it is the difference of the two WHOLE ranks the row shows, so a row
 * never reads "49 to 91" beside "+43". (A listed theme, 20 points or more apart, still reads 20 or
 * more: rounding each rank can move the difference by less than one point.)
 */
export function deltaText(row) {
  const from = whole(row?.rank1m)
  const to = whole(row?.rank1w)
  const d = from !== null && to !== null ? to - from : whole(row?.delta)
  if (d === null) return null
  return d > 0 ? `+${d}` : d < 0 ? `-${Math.abs(d)}` : '0'
}

/** Pure: the sentence that sums the board up, for the lede and for an agent. */
export function rotationSummary(view) {
  if (!view || view.state !== 'ok') return ''
  const n = (count, word) => `${count} ${count === 1 ? 'theme is' : 'themes are'} ${word}`
  return `${n(view.rotatingIn.length, 'rotating in')} and ${n(view.rotatingOut.length, 'rotating out')}, of ${view.ranked} ranked.`
}
