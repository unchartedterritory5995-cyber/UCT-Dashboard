// ── UCT Agent COACH: the member's own journal, reviewed DESCRIPTIVELY (W3-3) ────────────────────────────────────
//
// The browser mirror of api/services/uct_agent/coach/review.py (same stats, same fixture
// app/src/agent/__fixtures__/coachJournalRows.json). The rows come from the EXISTING journal route
// GET /api/j2/trades (read-only; `limit` is the route's own paging), only after the member's consent for this chat
// (coach/consent.js). Nothing but counts, rates and averages leaves this module: no symbol, no price, no date of
// any trade. The model is given `modelView` (the whitelisted stats) only, and the server whitelists it again.

export const DEFAULT_N = 10
export const MAX_N = 50
export const DESCRIPTIVE = 'Descriptive review, not a recommendation.'
export const TRADES_ROUTE = '/api/j2/trades'
const MODEL_KEYS = ['considered', 'closed', 'wins', 'losses', 'breakeven', 'winRatePct', 'withR', 'avgR', 'avgHoldDays',
  'largestWinR', 'largestLossR', 'largestWinPct', 'largestLossPct', 'mistakeTags', 'emotionTags']

export function clampN(n) {
  const v = Number.parseInt(n, 10)
  return Number.isFinite(v) ? Math.max(1, Math.min(MAX_N, v)) : DEFAULT_N
}
const num = (v) => { const f = Number(v); return v == null || v === '' || !Number.isFinite(f) ? null : f }
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d
function tags(rows, key, top = 5) {
  const c = new Map()
  for (const r of rows) for (const t of r[key] || []) if (typeof t === 'string' && t.trim()) { const k = t.trim().slice(0, 40); c.set(k, (c.get(k) || 0) + 1) }
  return [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top).map(([tag, count]) => ({ tag, count }))
}

/** Descriptive stats over the newest `n` rows. PURE; no prices in the output. */
export function reviewStats(rowsIn, n = DEFAULT_N) {
  const rows = (Array.isArray(rowsIn) ? rowsIn : []).filter(r => r && typeof r === 'object').slice(0, clampN(n))
  const closed = rows.filter(r => r.exitDate)
  const res = closed.map(r => String(r.result || '').toLowerCase())
  const wins = res.filter(x => x === 'win').length
  const losses = res.filter(x => x === 'loss').length
  const breakeven = closed.length - wins - losses
  const decided = wins + losses
  const rs = closed.map(r => num(r.rMultiple)).filter(v => v != null)
  const holds = closed.map(r => num(r.holdDays)).filter(v => v != null)
  const pcts = closed.map(r => num(r.pnlPercent)).filter(v => v != null)
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  return {
    considered: rows.length, closed: closed.length, wins, losses, breakeven,
    winRatePct: decided ? Math.round(100 * wins / decided) : null,
    withR: rs.length, avgR: rs.length ? round(mean(rs), 2) : null,
    avgHoldDays: holds.length ? round(mean(holds), 1) : null,
    largestWinR: rs.length && Math.max(...rs) > 0 ? round(Math.max(...rs), 2) : null,
    largestLossR: rs.length && Math.min(...rs) < 0 ? round(Math.min(...rs), 2) : null,
    largestWinPct: rs.length ? null : (pcts.length && Math.max(...pcts) > 0 ? round(Math.max(...pcts), 1) : null),
    largestLossPct: rs.length ? null : (pcts.length && Math.min(...pcts) < 0 ? round(Math.min(...pcts), 1) : null),
    mistakeTags: tags(closed, 'mistakeTags'), emotionTags: tags(closed, 'emotionTags'),
  }
}

/** The whitelisted, value-free view for the model (the server applies the same whitelist again). */
export function modelView(s) {
  if (!s || typeof s !== 'object') return null
  const out = {}
  for (const k of MODEL_KEYS) {
    const v = s[k]
    if (k === 'mistakeTags' || k === 'emotionTags') { if (Array.isArray(v)) out[k] = v.filter(t => t && typeof t.tag === 'string' && Number.isInteger(t.count)).slice(0, 5).map(t => ({ tag: t.tag.slice(0, 40), count: t.count })) }
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

const R = (v) => (v == null ? '' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`)
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many)

/** The member's sentence(s) — counts, rates, averages, then the descriptive note. Mirrors review.py exactly. */
export function reviewText(s) {
  if (!s || !s.considered) return `Your journal has no trades to review yet. ${DESCRIPTIVE}`
  if (!s.closed) return `Your last ${s.considered} journal trades are all still open, so there is nothing to review yet. ${DESCRIPTIVE}`
  const parts = [`Your last ${s.closed} closed ${plural(s.closed, 'trade')}: ${s.wins} ${plural(s.wins, 'win')}, ${s.losses} ${plural(s.losses, 'loss', 'losses')}`
    + (s.breakeven ? `, ${s.breakeven} breakeven` : '') + (s.winRatePct != null ? ` (win rate ${s.winRatePct}%)` : '') + '.']
  if (s.avgR != null) {
    parts.push(`Average R ${R(s.avgR)} over the ${s.withR} with a stop recorded` + (s.largestWinR != null ? `; largest win ${R(s.largestWinR)}` : '') + (s.largestLossR != null ? `, largest loss ${R(s.largestLossR)}` : '') + '.')
  } else if (s.largestWinPct != null || s.largestLossPct != null) {
    parts.push('No R-multiples recorded (add a stop to a trade and UCT computes R)' + (s.largestWinPct != null ? `; largest win ${pct(s.largestWinPct)}` : '') + (s.largestLossPct != null ? `, largest loss ${pct(s.largestLossPct)}` : '') + '.')
  }
  if (s.avgHoldDays != null) parts.push(`Average holding time ${Number(s.avgHoldDays)} ${plural(s.avgHoldDays, 'day')}.`)
  if (s.mistakeTags?.length) parts.push(`Mistake tags you recorded: ${s.mistakeTags.map(t => `${t.tag} (${t.count})`).join(', ')}.`)
  if (s.emotionTags?.length) parts.push(`Emotion tags: ${s.emotionTags.map(t => `${t.tag} (${t.count})`).join(', ')}.`)
  parts.push(DESCRIPTIVE)
  return parts.join(' ')
}

/** A metrics view of the stats for the panel (present.js `metrics`), figures only. */
export function reviewPresent(s) {
  if (!s || !s.closed) return null
  const items = [
    { label: 'Closed trades', value: String(s.closed) },
    { label: 'Wins / losses', value: `${s.wins} / ${s.losses}${s.breakeven ? ` / ${s.breakeven} BE` : ''}` },
    ...(s.winRatePct != null ? [{ label: 'Win rate', value: `${s.winRatePct}%` }] : []),
    ...(s.avgR != null ? [{ label: 'Average R', value: R(s.avgR), note: `${s.withR} with a stop` }] : []),
    ...(s.avgHoldDays != null ? [{ label: 'Avg hold', value: `${Number(s.avgHoldDays)}d` }] : []),
  ]
  return { kind: 'metrics', title: 'Your recent trades (descriptive)', items, source: DESCRIPTIVE }
}

/** The newest `n` of the member's own trades through the EXISTING journal route (read-only). Throws on refusal. */
export async function fetchTrades(n = DEFAULT_N) {
  const r = await fetch(`${TRADES_ROUTE}?limit=${clampN(n)}&offset=0`, { credentials: 'include', cache: 'no-store' })
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    const e = new Error(b.detail || `HTTP ${r.status}`); e.status = r.status; throw e
  }
  const b = await r.json()
  return Array.isArray(b?.trades) ? b.trades : []
}
