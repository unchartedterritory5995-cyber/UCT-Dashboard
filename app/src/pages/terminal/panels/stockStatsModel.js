// STAT's pure half: the stock statistics answer -> what the panel draws. No React, so an agent
// capability can reuse it.
//
// ONE read, `GET /api/research/stock-stats/{ticker}` (paid; api/services/stock_stats.py). The server
// works every number out from the daily prices it already stores (split-adjusted, dividends not
// included) and holds the answer for the session; this file only reads it and puts it into words.
// The definitions are the server's (api/services/stock_stats_calc.py); the words here say them.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a statistic with too little history says what it needs, in words.
// ⛔ A RECORD, NOT A FORECAST: green and red mark the sign of a return only.
import { formatCompactTerminal, formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayText } from './ratesModel'

export const STAT_CODE = 'STAT'
/** The thing read, as a failed read names it ("Stock statistics could not be read just now."). */
export const STAT_WHAT = 'Stock statistics'
export const STAT_SOURCE = "UCT's stored daily prices"
/** The answer changes once a session; while the market's corrections are still being worked out
 *  on the server (MKTH's first build), ask again soon. */
export const HELD_POLL_MS = 30 * 60 * 1000
export const COMPUTING_POLL_MS = 5000

export const statUrl = (sym) => `/api/research/stock-stats/${encodeURIComponent(sym)}`

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const text = (v) => (typeof v === 'string' && v ? v : null)

// ── reading the answer ─────────────────────────────────────────────────────────────────────

/** A block's "too little history" shape: `{ state: 'short', needed, held, unit }` or one that
 *  names the day the history must reach back to. Anything else not 'ok' is 'missing'. */
function shortOf(raw) {
  if (!isObj(raw)) return { state: 'missing' }
  if (raw.state !== 'short') return { state: 'missing' }
  return {
    state: 'short', needed: count(raw.needed), held: count(raw.held), unit: text(raw.unit) || 'sessions',
    neededFrom: isoDay(raw.needed_from), heldFrom: isoDay(raw.held_from),
  }
}

function readVolatility(raw) {
  const v = isObj(raw) ? raw : {}
  const atr = isObj(v.atr) && v.atr.state === 'ok' && finite(v.atr.value) != null
    ? { state: 'ok', period: count(v.atr.period) ?? 14, value: finite(v.atr.value), pct: finite(v.atr.pct) } : shortOf(v.atr)
  const realized = (Array.isArray(v.realized) ? v.realized : []).filter(isObj).map((r) => (
    r.state === 'ok' && finite(r.pct) != null ? { state: 'ok', sessions: count(r.sessions), pct: finite(r.pct) }
      : { ...shortOf(r), sessions: count(r.sessions) }))
  const adr = isObj(v.adr) && v.adr.state === 'ok' && finite(v.adr.pct) != null
    ? { state: 'ok', sessions: count(v.adr.sessions) ?? 21, pct: finite(v.adr.pct), dollars: finite(v.adr.dollars) } : shortOf(v.adr)
  const r52 = isObj(v.range_52w) && v.range_52w.state === 'ok'
    ? {
      state: 'ok', high: finite(v.range_52w.high), highDate: isoDay(v.range_52w.high_date), low: finite(v.range_52w.low),
      lowDate: isoDay(v.range_52w.low_date), fromHighPct: finite(v.range_52w.from_high_pct), fromLowPct: finite(v.range_52w.from_low_pct),
    } : shortOf(v.range_52w)
  const vol = isObj(v.volume) ? v.volume : {}
  const avg = isObj(vol.avg) ? vol.avg : {}
  const days = isObj(v.days_1y) && v.days_1y.state === 'ok'
    ? {
      state: 'ok', from: isoDay(v.days_1y.from), total: count(v.days_1y.total), up: count(v.days_1y.up), down: count(v.days_1y.down),
      flat: count(v.days_1y.flat), upPct: finite(v.days_1y.up_pct), downPct: finite(v.days_1y.down_pct),
    } : shortOf(v.days_1y)
  return {
    asOf: isoDay(v.as_of), close: finite(v.close), sessions: count(v.sessions), atr, realized, adr, range52: r52, days,
    realizedMethod: text(v.realized_method),
    volume: {
      last: finite(vol.last), lastDate: isoDay(vol.last_date), avg20: finite(avg['20']), avg50: finite(avg['50']),
      rel: finite(vol.rel), relBase: count(vol.rel_base_sessions) ?? 30,
    },
  }
}

function readBetaPair(raw) {
  if (!isObj(raw)) return { state: 'missing' }
  if (raw.state === 'ok') {
    return {
      state: 'ok', symbol: text(raw.symbol), sector: text(raw.sector), returns: count(raw.returns), from: isoDay(raw.from), to: isoDay(raw.to),
      beta: finite(raw.beta), correlation: finite(raw.correlation),
      upCapture: finite(raw.up_capture), upDays: count(raw.up_capture_days),
      downCapture: finite(raw.down_capture), downDays: count(raw.down_capture_days),
    }
  }
  // 'unavailable': the fund's prices could not be read just now (a failed read, tried again on the server),
  // which is not 'not_held' (nothing stored for it)
  if (['fund', 'no_sector', 'not_mapped', 'not_held', 'unavailable'].includes(raw.state)) {
    return { state: raw.state, symbol: text(raw.symbol), sector: text(raw.sector) }
  }
  return { ...shortOf(raw), symbol: text(raw.symbol), sector: text(raw.sector) }
}

function readBeta(raw) {
  const b = isObj(raw) ? raw : {}
  return {
    asOf: isoDay(b.as_of), window: count(b.window) ?? 252, min: count(b.min) ?? 200, captureMin: count(b.capture_min_days) ?? 20,
    spy: readBetaPair(b.spy), sector: readBetaPair(b.sector),
  }
}

const readMove = (raw) => (isObj(raw) && isoDay(raw.date) && finite(raw.return_pct) != null
  ? { date: raw.date, from: isoDay(raw.from), returnPct: finite(raw.return_pct), check: raw.check === true } : null)

function readExtremeBlock(raw) {
  if (!isObj(raw) || raw.state !== 'ok') return shortOf(raw)
  return {
    state: 'ok', from: isoDay(raw.from),
    bestDay: readMove(raw.best_day), worstDay: readMove(raw.worst_day), bestWeek: readMove(raw.best_week), worstWeek: readMove(raw.worst_week),
  }
}

function readReturns(raw) {
  const r = isObj(raw) ? raw : {}
  const ex = isObj(r.extremes) ? r.extremes : {}
  return {
    asOf: isoDay(r.as_of), close: finite(r.close),
    periods: (Array.isArray(r.periods) ? r.periods : []).filter((p) => isObj(p) && text(p.key)).map((p) => (
      p.state === 'ok' && finite(p.return_pct) != null
        ? { key: p.key, label: text(p.label) || p.key, state: 'ok', from: isoDay(p.from), baseClose: finite(p.base_close),
          returnPct: finite(p.return_pct), yearlyPct: finite(p.yearly_pct) }
        : { key: p.key, label: text(p.label) || p.key, ...shortOf(p) })),
    year: readExtremeBlock(ex.year),
    all: readExtremeBlock(ex.all),
    weekComplete: r.week_complete !== false,
  }
}

const readPoint = (raw) => (isObj(raw) && isoDay(raw.date) ? { date: raw.date, close: finite(raw.close) } : null)

function readDrawdown(raw) {
  if (!isObj(raw)) return null
  const peak = readPoint(raw.peak)
  const trough = readPoint(raw.trough)
  if (!peak || !trough) return null
  return {
    id: text(raw.id) || `${peak.date}-${trough.date}`, peak, trough, depthPct: finite(raw.depth_pct),
    sessionsDown: count(raw.sessions_down), recovered: isoDay(raw.recovered), sessionsToRecover: count(raw.sessions_to_recover),
    ongoing: raw.ongoing === true, peakAtStart: raw.peak_at_history_start === true, belowNowPct: finite(raw.below_peak_now_pct),
    check: raw.check === true,
  }
}

function readDrawdowns(raw) {
  const d = isObj(raw) ? raw : {}
  const hi = isObj(d.high) ? d.high : {}
  return {
    asOf: isoDay(d.as_of), first: isoDay(d.first), minDepthPct: finite(d.min_depth_pct) ?? 20,
    high: { date: isoDay(hi.date), close: finite(hi.close), fromHighPct: finite(hi.from_high_pct) },
    total: count(d.total) ?? 0, shown: count(d.shown) ?? 0, ongoing: count(d.ongoing) ?? 0, recovered: count(d.recovered) ?? 0,
    medianDepthPct: finite(d.median_depth_pct), medianRecoverySessions: finite(d.median_recovery_sessions),
    deepest: readDrawdown(d.deepest),
    episodes: (Array.isArray(d.episodes) ? d.episodes : []).map(readDrawdown).filter(Boolean),
  }
}

function readStockInCorrection(raw) {
  const s = isObj(raw) ? raw : {}
  const nh = isObj(s.new_high) ? s.new_high : {}
  const af = isObj(s.after) ? s.after : {}
  return {
    drawdownPct: finite(s.drawdown_pct), windowReturnPct: finite(s.window_return_pct),
    high: readPoint(s.high), low: readPoint(s.low),
    ratio: finite(s.vs_index_ratio), pts: finite(s.vs_index_pts),
    newHigh: {
      state: ['first', 'same_day', 'after', 'index_only', 'neither', 'short'].includes(nh.state) ? nh.state : 'missing',
      date: isoDay(nh.date), indexDate: isoDay(nh.index_date), lead: Number.isInteger(nh.lead_sessions) ? nh.lead_sessions : null,
      high: finite(nh.high), needed: count(nh.needed), held: count(nh.held),
    },
    after: {
      state: ['ok', 'not_yet', 'gap'].includes(af.state) ? af.state : 'missing',
      months: count(af.months) ?? 3, from: isoDay(af.from), date: isoDay(af.date), returnPct: finite(af.return_pct),
      indexReturnPct: finite(af.index_return_pct), pts: finite(af.vs_index_pts),
    },
  }
}

function readCorrections(raw) {
  const c = isObj(raw) ? raw : {}
  const base = { index: text(c.index) || 'S&P 500', first: isoDay(c.first), asOf: isoDay(c.as_of) }
  if (c.state === 'computing') return { ...base, state: 'computing' }
  if (c.state === 'not_held') return { ...base, state: 'not_held' }
  if (c.state !== 'ok') return { ...base, state: 'unavailable', detail: text(c.detail) }
  const s = isObj(c.summary) ? c.summary : {}
  return {
    ...base, state: 'ok', indexFirst: isoDay(c.index_first), indexThrough: isoDay(c.index_through),
    definition: text(c.definition), beforeHistory: count(c.before_history) ?? 0,
    summary: {
      count: count(s.count) ?? 0, fellLess: count(s.fell_less) ?? 0, fellMore: count(s.fell_more) ?? 0, medianRatio: finite(s.median_ratio),
      newHighFirst: count(s.new_high_first) ?? 0, newHighJudged: count(s.new_high_judged) ?? 0,
      afterBeat: count(s.after_beat) ?? 0, afterCount: count(s.after_count) ?? 0, medianAfterPts: finite(s.median_after_vs_index_pts),
    },
    episodes: (Array.isArray(c.episodes) ? c.episodes : []).filter((e) => isObj(e) && readPoint(e.peak) && readPoint(e.trough)).map((e) => ({
      id: text(e.id) || `${e.peak.date}-${e.trough.date}`, kind: e.kind === 'bear' ? 'bear' : 'correction',
      peak: readPoint(e.peak), trough: readPoint(e.trough), depthPct: finite(e.depth_pct), recovered: isoDay(e.recovered),
      ongoing: e.ongoing === true, stock: readStockInCorrection(e.stock),
    })),
  }
}

/**
 * The route's body -> the panel's view. `state`:
 *   'ok'           every section, each with its own as-of
 *   'not_held'     the server stores no daily prices for the stock (`detail`)
 *   'busy'         the server is working out other stocks; ask again
 *   'unavailable'  the read failed on the server (`detail`)
 *   'failed'       not the route's shape
 */
export function statRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  if (body.status === 'not_held') return { state: 'not_held', detail: text(body.detail) }
  if (body.status === 'busy') return { state: 'busy', detail: text(body.detail) }
  if (body.status === 'unavailable' || body.status === 'refused') return { state: 'unavailable', detail: text(body.detail) }
  if (body.status !== 'ok') return { state: 'failed' }
  return {
    state: 'ok',
    symbol: text(body.symbol),
    dataThrough: isoDay(body.data_through),
    first: isoDay(body.first),
    sessions: count(body.sessions),
    jumpPct: finite(body.suspect_jump_pct) ?? 40,
    volatility: readVolatility(body.volatility),
    beta: readBeta(body.beta),
    returns: readReturns(body.returns),
    drawdowns: readDrawdowns(body.drawdowns),
    corrections: readCorrections(body.corrections),
  }
}

/** True while the server is still working out the market's corrections (the panel asks again sooner). */
export const isComputing = (view) => view.state === 'ok' && view.corrections.state === 'computing'

// ── words ──────────────────────────────────────────────────────────────────────────────────

/** 'up' | 'down' | null: the sign of a number, nothing more. */
export function signOf(v) {
  const n = finite(v)
  if (n == null || n === 0) return null
  return n > 0 ? 'up' : 'down'
}

/** A percent change with its sign: "+12.4%", "-33.9%". Missing: `absent`. */
export const changeText = (v, absent = 'n/a', decimals = 1) => formatPercent(finite(v), { decimals, signed: true, absent })
/** A percent level without a sign: "41.2%". */
export const levelPct = (v, decimals = 1, absent = 'n/a') => formatPercent(finite(v), { decimals, absent })
/** A price: "$181.20". */
export const money = (v) => formatCurrency(finite(v), { decimals: 2, grouping: true, absent: 'n/a' })
/** Shares traded: "2.6M". */
export const sharesText = (v) => formatCompactTerminal(finite(v), { absent: 'n/a' })
/** A multiple: "1.5x". */
export const timesText = (v) => (finite(v) == null ? 'n/a' : `${formatNumber(finite(v), { decimals: finite(v) >= 10 ? 0 : 1 })}x`)
export const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`
export const sessionsText = (n) => (n == null ? 'n/a' : plural(n, 'session', 'sessions'))

/** Percentage points with a sign: "+13.0 pts". */
export function pointsText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  if (Math.abs(n) < 0.05) return '0.0 pts'
  return `${n > 0 ? '+' : '-'}${formatNumber(Math.abs(n), { decimals: 1 })} pts`
}

/** What a statistic with too little history needs, in words. */
export function shortText(b) {
  if (!b || b.state !== 'short') return 'Not in the answer.'
  if (b.neededFrom) {
    return `Needs prices back to ${dayText(b.neededFrom)}; UCT's start ${b.heldFrom ? dayText(b.heldFrom) : 'later'}.`
  }
  if (b.needed != null) {
    const unit = b.unit === 'returns' ? 'daily returns on days both traded' : 'sessions'
    return `Needs ${formatNumber(b.needed)} ${unit}; UCT holds ${formatNumber(b.held ?? 0)}.`
  }
  return 'Too little price history.'
}

// section 1
export function atrText(a) {
  if (a.state !== 'ok') return shortText(a)
  return `${money(a.value)} (${levelPct(a.pct, 2)} of the close)`
}

export function realizedText(list) {
  const ok = list.filter((r) => r.state === 'ok')
  if (!ok.length) return list.length ? shortText(list[0]) : 'Not in the answer.'
  const parts = list.map((r) => (r.state === 'ok' ? `${formatNumber(r.sessions)} days ${levelPct(r.pct)}` : `${formatNumber(r.sessions)} days: ${shortText(r)}`))
  return `${parts.join(', ')}, annualized`
}

export function adrText(a) {
  if (a.state !== 'ok') return shortText(a)
  return `${levelPct(a.pct, 2)}${a.dollars != null ? ` (${money(a.dollars)})` : ''} over ${formatNumber(a.sessions)} sessions`
}

export function range52Text(r) {
  if (r.state !== 'ok') return shortText(r)
  return `${money(r.low)} to ${money(r.high)}: ${levelPct(Math.abs(r.fromHighPct ?? NaN))} below the high, ${levelPct(r.fromLowPct)} above the low`
}

export function avgVolumeText(v) {
  if (v.avg20 == null && v.avg50 == null) return 'Not enough sessions with volume held.'
  return `${sharesText(v.avg20)} a day over 20 sessions, ${sharesText(v.avg50)} over 50`
}

export function relVolumeText(v) {
  if (v.rel == null) return `Needs ${formatNumber(v.relBase + 1)} sessions with volume held.`
  const on = v.lastDate ? ` on ${dayText(v.lastDate)}` : ''
  return `${timesText(v.rel)}${on}${v.last != null ? ` (${sharesText(v.last)} shares)` : ''}, against the ${formatNumber(v.relBase)} sessions before`
}

export function daysText(d) {
  if (d.state !== 'ok') return shortText(d)
  return `${levelPct(d.upPct)} up, ${levelPct(d.downPct)} down (${formatNumber(d.up)} and ${formatNumber(d.down)} of ${formatNumber(d.total)} sessions)`
}

// section 2
export function betaText(p) {
  if (p.state === 'ok') {
    const b = p.beta != null ? formatNumber(p.beta, { decimals: 2 }) : 'n/a'
    const c = p.correlation != null ? formatNumber(p.correlation, { decimals: 2 }) : 'n/a'
    return `${b}, correlation ${c}`
  }
  if (p.state === 'fund') return 'A fund has no sector fund of its own.'
  if (p.state === 'no_sector') return 'No sector is held for this stock.'
  if (p.state === 'not_mapped') return `Its sector (${p.sector || 'unknown'}) has no sector fund in UCT's list.`
  if (p.state === 'not_held') return `UCT holds no prices for ${p.symbol || 'the fund'} on this server.`
  if (p.state === 'unavailable') return `Prices for ${p.symbol || 'the fund'} could not be read just now. The server tries again on its own.`
  return shortText(p)
}

export const sectorLabel = (p) => (p.symbol ? `Beta vs ${p.sector ? `${p.sector} (${p.symbol})` : p.symbol}` : 'Beta vs its sector fund')

export function captureText(p, key) {
  if (p.state !== 'ok') return p.state === 'not_held' || p.state === 'unavailable' ? betaText(p) : shortText(p)
  const v = key === 'up' ? p.upCapture : p.downCapture
  const days = key === 'up' ? p.upDays : p.downDays
  if (v == null) return `Too few ${key} days for SPY${days != null ? ` (${formatNumber(days)})` : ''}.`
  return `${formatNumber(v, { decimals: 0 })}%${days != null ? ` (on ${plural(days, `${key} day`, `${key} days`)})` : ''}`
}

// section 3
export function periodCell(p) {
  if (p.state !== 'ok') return { kind: 'short', text: 'n/a', sub: shortText(p), sign: null }
  return {
    kind: 'value', text: changeText(p.returnPct), sign: signOf(p.returnPct),
    sub: p.yearlyPct != null ? `${changeText(p.yearlyPct)} a year` : null,
  }
}

export function moveCell(m, week = false) {
  if (!m) return { text: 'n/a', sub: null, sign: null, check: false }
  return {
    text: changeText(m.returnPct), sign: signOf(m.returnPct), check: m.check,
    sub: week ? `week of ${dayText(m.from || m.date, { short: false })}` : dayText(m.date),
  }
}

// section 4
export function drawdownsLine(d, sym) {
  const since = d.first ? ` since ${dayText(d.first)}` : ''
  if (!d.total) return `No decline of ${formatNumber(d.minDepthPct)}% or more in ${sym}${since} in the prices UCT holds.`
  const head = `${plural(d.total, 'decline', 'declines')} of ${formatNumber(d.minDepthPct)}% or more${since}.`
  const parts = []
  if (d.medianDepthPct != null) parts.push(`Median depth ${changeText(d.medianDepthPct)}`)
  parts.push(d.medianRecoverySessions != null
    ? `median recovery ${sessionsText(Math.round(d.medianRecoverySessions))} from the low (${formatNumber(d.recovered)} recovered)`
    : 'none has recovered yet')
  return `${head} ${parts.join('; ')}.`
}

export function deepestLine(d) {
  const e = d.deepest
  if (!e) return null
  const back = e.ongoing ? 'not regained yet' : `regained ${dayText(e.recovered)}`
  return `Max drawdown ${changeText(e.depthPct)}, ${dayText(e.peak.date)} to ${dayText(e.trough.date)}, ${back}.`
}

export function highLine(d) {
  const h = d.high
  if (h.close == null || !h.date) return null
  if (h.fromHighPct != null && h.fromHighPct > -0.005) return `At its highest close in the prices held (${money(h.close)}).`
  return `Now ${levelPct(Math.abs(h.fromHighPct ?? NaN))} below its highest close in the prices held (${money(h.close)} on ${dayText(h.date)}).`
}

export const spanText = (e) => `${dayText(e.peak.date)} to ${dayText(e.trough.date)}`

export function recoveredCell(e) {
  if (e.ongoing || !e.recovered) {
    return { main: 'Not yet', sub: e.belowNowPct != null ? `now ${changeText(e.belowNowPct)} from the peak` : null }
  }
  return { main: dayText(e.recovered), sub: e.sessionsToRecover != null ? `${sessionsText(e.sessionsToRecover)} from the low` : null }
}

// section 5
export const kindText = (kind) => (kind === 'bear' ? 'Bear market' : 'Correction')

export function correctionsLine(c, sym) {
  const s = c.summary
  if (!s.count) {
    return `No S&P 500 correction or bear market falls inside ${sym}'s price history${c.first ? ` (from ${dayText(c.first)})` : ''}.`
  }
  const parts = [`In ${plural(s.count, `S&P 500 decline`, `S&P 500 declines`)} of 10% or more inside ${sym}'s history, it fell less than the index in ${formatNumber(s.fellLess)} and more in ${formatNumber(s.fellMore)}`
    + `${s.medianRatio != null ? ` (median ${timesText(s.medianRatio)} as far)` : ''}.`]
  if (s.newHighJudged) parts.push(`It was back at its 52-week high before the index regained its peak in ${formatNumber(s.newHighFirst)} of ${formatNumber(s.newHighJudged)}.`)
  if (s.afterCount) {
    parts.push(`It beat the index in the 3 months after the low in ${formatNumber(s.afterBeat)} of ${formatNumber(s.afterCount)}`
      + `${s.medianAfterPts != null ? ` (median ${pointsText(s.medianAfterPts)})` : ''}.`)
  }
  return parts.join(' ')
}

/** The "It fell" cell: `{ main, sub }`. */
export function fellCell(e) {
  const s = e.stock
  return {
    main: changeText(s.drawdownPct),
    sub: s.ratio != null ? `${timesText(s.ratio)} the index` : null,
  }
}

/** The "back to its high first?" cell: `{ main, sub, kind }`. */
export function highFirstCell(e) {
  const n = e.stock.newHigh
  switch (n.state) {
    case 'first': return { kind: 'yes', main: 'Yes', sub: n.lead != null && n.lead > 0 ? `${sessionsText(n.lead)} before the index` : `on ${dayText(n.date)}, index not back yet` }
    case 'same_day': return { kind: 'tie', main: 'Same day', sub: dayText(n.date) }
    case 'after': return { kind: 'no', main: 'No', sub: n.lead != null ? `${sessionsText(Math.abs(n.lead))} after the index` : dayText(n.date) }
    case 'index_only': return { kind: 'no', main: 'No', sub: 'not back yet' }
    case 'neither': return { kind: 'open', main: 'Not yet', sub: 'neither is back' }
    case 'short': return { kind: 'short', main: 'n/a', sub: 'under a year of prices before the peak' }
    default: return { kind: 'short', main: 'n/a', sub: null }
  }
}

/** The "3 months after the low" cell: `{ main, sub, sign, kind }`. */
export function afterCell(e) {
  const a = e.stock.after
  if (a.state === 'not_yet') return { kind: 'notyet', main: 'Not yet', sub: `${formatNumber(a.months)} months have not passed`, sign: null }
  if (a.state !== 'ok') return { kind: 'gap', main: 'n/a', sub: 'a gap in its prices', sign: null }
  return { kind: 'value', main: changeText(a.returnPct), sign: signOf(a.returnPct), sub: `index ${changeText(a.indexReturnPct)}` }
}
