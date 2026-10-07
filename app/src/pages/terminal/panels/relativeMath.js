// UCT Terminal — the arithmetic behind RRG, REL and CORR. Pure; no React, no fetch.
//
// All three panels compare securities over time from the SAME daily/weekly closes the chart
// draws (`/api/bars/{sym}`). Every function here works on series already reduced to
// `[{ d: 'YYYY-MM-DD', c: number }]`, oldest first, and returns `null` (never 0, never NaN)
// when a value cannot be computed, so a panel can say "not enough history" instead of plotting
// a made-up number.
//
// ⛔ ONE ALIGNMENT RULE: two series are compared only on sessions BOTH have. A missing session on
// one side never borrows the other side's neighbour — a halted stock must not read as flat.

/** A bar's session date as 'YYYY-MM-DD'. Massive D/W bars carry an ISO string; the index path
 *  (SPX, VIX) carries unix seconds (milliseconds tolerated). Anything else is null. */
export function barDateKey(bar) {
  const t = bar?.t ?? bar?.time ?? bar?.date
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  if (typeof t === 'number' && Number.isFinite(t)) {
    return new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 10)
  }
  return null
}

/** The Friday of `d`'s ISO week (Mon..Sun), as 'YYYY-MM-DD' — the key the equity weekly store
 *  stamps (`bars_fetch._resample_weekly_iso`). */
export function isoWeekFriday(d) {
  const t = new Date(`${d}T12:00:00Z`)
  if (Number.isNaN(t.getTime())) return null
  const isoDow = ((t.getUTCDay() + 6) % 7) + 1   // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + (5 - isoDow))
  return t.toISOString().slice(0, 10)
}

/** `/api/bars` payload (an object with `bars`, or a bare array) → `[{d, c}]`, oldest first,
 *  one row per date (the LAST bar of a date wins: the developing bar replaces nothing older).
 *
 *  `weekly: true` keys every bar by the FRIDAY of its ISO week. ⛔ The two weekly sources do
 *  not agree on the anchor: equity/ETF weekly bars are Friday-keyed, the index path (SPX, NDX,
 *  VIX via yfinance `1wk`) is Monday-keyed. Without one key per week a weekly RRG of SPX
 *  against SPY shared ZERO dates and read "not enough history" (accuracy audit 2026-10-06). */
export function closesFromBars(payload, { weekly = false } = {}) {
  const bars = Array.isArray(payload?.bars) ? payload.bars : (Array.isArray(payload) ? payload : [])
  const byDate = new Map()
  for (const b of bars) {
    const raw = barDateKey(b)
    const d = weekly && raw ? isoWeekFriday(raw) : raw
    const c = Number(b?.c ?? b?.close)
    if (d && Number.isFinite(c) && c > 0) byDate.set(d, c)
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([d, c]) => ({ d, c }))
}

/** Sessions every series has, oldest first, with each series' close on them.
 *  `seriesBySym` is `{ SYM: [{d,c}] }`; returns `{ dates, closes: { SYM: number[] } }`. */
export function alignCloses(seriesBySym) {
  const syms = Object.keys(seriesBySym || {})
  if (!syms.length) return { dates: [], closes: {} }
  const maps = syms.map((s) => new Map((seriesBySym[s] || []).map((p) => [p.d, p.c])))
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort()
  const closes = Object.fromEntries(syms.map((s, i) => [s, dates.map((d) => maps[i].get(d))]))
  return { dates, closes }
}

/** Simple moving average; `null` until `n` values exist. */
export function sma(values, n) {
  const out = new Array(values.length).fill(null)
  if (!(n >= 1)) return out
  let sum = 0
  let count = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null) { sum = 0; count = 0; continue }
    sum += v
    count += 1
    if (count > n) { sum -= values[i - n]; count = n }
    if (count === n) out[i] = sum / n
  }
  return out
}

// ── REL ────────────────────────────────────────────────────────────────────────────────────

/** The windows REL and CORR accept, in sessions. YTD is resolved against the data. */
export const LOOKBACK_SESSIONS = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '2Y': 504 }

/** How many trailing sessions a window spans on these dates (YTD = sessions since Jan 1 of the
 *  newest date's year). Capped at what the data holds; never below 1. */
export function windowSessions(lookback, dates) {
  const n = dates?.length || 0
  if (n < 2) return 0
  if (lookback === 'YTD') {
    const year = dates[n - 1].slice(0, 4)
    const first = dates.findIndex((d) => d.slice(0, 4) === year)
    // the base is the LAST close of the previous year, when we have it
    return Math.max(1, Math.min(n - 1, n - first - (first > 0 ? 0 : 1)))
  }
  const want = LOOKBACK_SESSIONS[lookback] ?? LOOKBACK_SESSIONS['6M']
  return Math.max(1, Math.min(n - 1, want))
}

/** `closes` rebased to 0 at index `from`: each value is the % change from that base. */
export function rebase(closes, from = 0) {
  const base = closes[from]
  if (!(base > 0)) return closes.map(() => null)
  return closes.map((c, i) => (i < from || c == null ? null : (c / base - 1) * 100))
}

/** Largest peak-to-trough fall, in %, over the slice (a negative number, or 0). */
export function maxDrawdown(closes) {
  let peak = -Infinity
  let worst = 0
  for (const c of closes) {
    if (c == null) continue
    if (c > peak) peak = c
    const dd = (c / peak - 1) * 100
    if (dd < worst) worst = dd
  }
  return worst
}

/** A ÷ B, element-wise. */
export function ratioSeries(a, b) {
  return a.map((v, i) => (v > 0 && b[i] > 0 ? v / b[i] : null))
}

/**
 * The whole REL read for `syms` (first one is the base) over `lookback`.
 * Returns null when fewer than two common sessions exist.
 */
export function relativePerformance(seriesBySym, syms, lookback = '6M', ratioAvg = 50) {
  const pick = Object.fromEntries(syms.filter((s) => seriesBySym[s]).map((s) => [s, seriesBySym[s]]))
  const { dates, closes } = alignCloses(pick)
  const n = windowSessions(lookback, dates)
  if (!n) return null
  const from = dates.length - 1 - n
  const live = syms.filter((s) => closes[s])
  const lines = live.map((s) => ({ sym: s, pct: rebase(closes[s], from).slice(from) }))
  const rows = live.map((s) => {
    const w = closes[s].slice(from)
    const ret = (w[w.length - 1] / w[0] - 1) * 100
    return { sym: s, ret, maxDd: maxDrawdown(w) }
  })
  const baseRet = rows[0]?.ret ?? null
  rows.forEach((r, i) => { r.excess = i === 0 || baseRet == null ? null : r.ret - baseRet })
  let ratio = null
  if (live.length >= 2) {
    const [a, b] = live
    const full = ratioSeries(closes[a], closes[b])
    const avg = sma(full, ratioAvg)
    const last = full[full.length - 1]
    const lastAvg = avg[avg.length - 1]
    ratio = {
      a, b,
      values: full.slice(from),
      avg: avg.slice(from),
      change: (last / full[from] - 1) * 100,
      aboveAvg: lastAvg == null ? null : last > lastAvg,
    }
  }
  return { dates: dates.slice(from), sessions: n, overlap: dates.length, lines, rows, ratio }
}

// ── RRG ────────────────────────────────────────────────────────────────────────────────────

/** UCT's published RRG approximation (the JdK formula itself is proprietary):
 *    RS          = 100 × sym / benchmark
 *    RS-Ratio    = 100 × RS / SMA(RS, ratioLen)
 *    RS-Momentum = 100 × RS-Ratio / SMA(RS-Ratio, momLen)
 *  Both oscillate around 100. */
export const RRG_METHOD = { ratioLen: 10, momLen: 5, tail: 8 }

export const QUADRANTS = ['Leading', 'Weakening', 'Lagging', 'Improving']

export function quadrantOf(ratio, momentum) {
  if (ratio == null || momentum == null) return null
  if (ratio >= 100) return momentum >= 100 ? 'Leading' : 'Weakening'
  return momentum >= 100 ? 'Improving' : 'Lagging'
}

/** One symbol's RRG path against the benchmark: the last `tail` points that have both
 *  coordinates, plus the quadrant read. Null when there is not enough common history. */
export function rrgPath(symSeries, benchSeries, method = RRG_METHOD) {
  const { dates, closes } = alignCloses({ s: symSeries, b: benchSeries })
  const s = closes.s || []
  const b = closes.b || []
  const rs = s.map((v, i) => (b[i] > 0 ? (100 * v) / b[i] : null))
  const rsAvg = sma(rs, method.ratioLen)
  const ratio = rs.map((v, i) => (v != null && rsAvg[i] ? (100 * v) / rsAvg[i] : null))
  const ratioAvg = sma(ratio, method.momLen)
  const mom = ratio.map((v, i) => (v != null && ratioAvg[i] ? (100 * v) / ratioAvg[i] : null))
  const points = []
  for (let i = 0; i < dates.length; i++) {
    if (ratio[i] != null && mom[i] != null) points.push({ d: dates[i], x: ratio[i], y: mom[i], i })
  }
  if (!points.length) return null
  const tail = points.slice(-method.tail)
  const head = tail[tail.length - 1]
  const quadrant = quadrantOf(head.x, head.y)
  let inQuadrant = 0
  for (let k = points.length - 1; k >= 0 && quadrantOf(points[k].x, points[k].y) === quadrant; k--) inQuadrant += 1
  const first = tail[0].i
  const relRet = ((s[head.i] / s[first]) / (b[head.i] / b[first]) - 1) * 100
  return { tail: tail.map(({ d, x, y }) => ({ d, x, y })), ratio: head.x, momentum: head.y, quadrant, inQuadrant, relRet, asOf: head.d }
}

// ── CORR ───────────────────────────────────────────────────────────────────────────────────

/** Minimum common daily returns a pair needs before a correlation is shown at all. */
export const MIN_CORR_SESSIONS = 20

/** Pearson correlation of two equal-length arrays (nulls skipped pairwise). */
export function pearson(xs, ys) {
  const a = []
  const b = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (xs[i] != null && ys[i] != null) { a.push(xs[i]); b.push(ys[i]) }
  }
  const n = a.length
  if (n < 2) return { r: null, n }
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  if (saa === 0 || sbb === 0) return { r: null, n }
  return { r: sab / Math.sqrt(saa * sbb), n }
}

/** Daily simple returns keyed by date: `{ 'YYYY-MM-DD': r }` (the first session has none). */
export function returnsByDate(series) {
  const out = new Map()
  for (let i = 1; i < (series?.length || 0); i++) {
    const p = series[i - 1].c
    if (p > 0) out.set(series[i].d, series[i].c / p - 1)
  }
  return out
}

/**
 * The correlation matrix for `syms` over the last `sessions` daily returns. Each pair is
 * computed on the sessions BOTH names traded (so a recent IPO does not shrink every pair).
 * A pair under MIN_CORR_SESSIONS reads `r: null` with its `n`.
 *
 * ⛔ A pair's returns are taken on the PAIR'S common closes, never on each name's own series.
 * Per-name returns broke the one alignment rule above: the session after a day one name did
 * not trade paired that name's TWO-session return with the other's one-session return
 * (accuracy audit 2026-10-06: NVDA/AMD with one AMD session missing read r = 0.390 against
 * the pandas reference 0.382, on 62 returns instead of 63).
 */
export function correlationMatrix(seriesBySym, syms, sessions = 63) {
  const own = Object.fromEntries(syms.map((s) => [s, Math.min(sessions, Math.max(0, (seriesBySym[s]?.length || 0) - 1))]))
  const cell = (a, b) => {
    if (a === b) return { r: 1, n: own[a] }
    const { dates, closes } = alignCloses({ a: seriesBySym[a] || [], b: seriesBySym[b] || [] })
    const pair = (k) => returnsByDate(dates.map((d, i) => ({ d, c: closes[k][i] })))
    const ra = pair('a')
    const rb = pair('b')
    const keep = [...ra.keys()].filter((d) => rb.has(d)).sort().slice(-sessions)
    const res = pearson(keep.map((d) => ra.get(d)), keep.map((d) => rb.get(d)))
    return res.n < MIN_CORR_SESSIONS ? { r: null, n: res.n } : res
  }
  const matrix = syms.map((a) => syms.map((b) => cell(a, b)))
  const pairs = []
  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      if (matrix[i][j].r != null) pairs.push({ a: syms[i], b: syms[j], r: matrix[i][j].r, n: matrix[i][j].n })
    }
  }
  pairs.sort((x, y) => y.r - x.r)
  const avg = syms.map((s, i) => {
    const rs = matrix[i].filter((c, j) => j !== i && c.r != null).map((c) => c.r)
    return { sym: s, avg: rs.length ? rs.reduce((t, v) => t + v, 0) / rs.length : null }
  })
  return {
    syms, matrix, avg,
    most: pairs[0] || null,
    least: pairs.length > 1 ? pairs[pairs.length - 1] : null,
  }
}

// ── the panels' symbol list ────────────────────────────────────────────────────────────────

/** The securities a comparison panel was asked for: the panel's own security first, then the
 *  `with0` … `withN` props the registry's `symbol` args produce. Upper-cased, `$` stripped,
 *  de-duplicated in order, capped at `max`. */
export function collectSymbols(sym, props = {}, max = 12) {
  const out = []
  const push = (v) => {
    const s = typeof v === 'string' ? v.replace(/^\$/, '').toUpperCase() : null
    if (s && !out.includes(s)) out.push(s)
  }
  push(sym)
  for (let i = 0; i < 20; i++) push(props[`with${i}`])
  return out.slice(0, max)
}

/** A stable string of the `withN` props, for memo dependencies (a new props object with the
 *  same names must not refetch). */
export function withArgsKey(props = {}) {
  return Array.from({ length: 20 }, (_, i) => props[`with${i}`] || '').join(',')
}
