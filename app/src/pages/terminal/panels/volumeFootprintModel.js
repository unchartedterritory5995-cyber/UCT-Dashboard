// VFP's pure half: the volume footprint answer -> what the panel draws. No React, so an agent
// capability can reuse it.
//
// ONE read, `GET /api/research/volume-footprint/{ticker}` (paid; api/services/volume_footprint.py).
// The server works every number out from the daily bars it already stores (settled sessions only;
// prices and volumes split-adjusted as the store serves them) and the earnings report dates it already
// holds, and holds the answer for the session; this file only reads it and puts it into words. The
// definitions are the server's (api/services/volume_footprint_calc.py); the words here say them.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a section with too little history says what it needs, in words.
// ⛔ AN EARNINGS MARK IS SHOWN ONLY WHERE IT IS KNOWN: outside the span the held report dates cover,
//    a session carries no mark either way, and the panel says which span that is.
// ⛔ A RECORD, NOT A FORECAST: green and red mark the sign of a move only.
import { formatCompactTerminal, formatCurrency, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayText } from './ratesModel'

export const VFP_CODE = 'VFP'
/** The thing read, as a failed read names it ("The volume footprint could not be read just now."). */
export const VFP_WHAT = 'The volume footprint'
export const VFP_SOURCE = "UCT's stored daily prices and volumes"
/** The answer changes once a session. */
export const HELD_POLL_MS = 30 * 60 * 1000

export const vfpUrl = (sym) => `/api/research/volume-footprint/${encodeURIComponent(sym)}`

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const text = (v) => (typeof v === 'string' && v ? v : null)
const mark = (v) => (v === true ? true : v === false ? false : null)
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : [])

// ── reading the answer ─────────────────────────────────────────────────────────────────────

/** A block's "too little history" shape, or 'missing' for anything else that is not 'ok'. */
function shortOf(raw) {
  if (!isObj(raw) || raw.state !== 'short') return { state: 'missing' }
  return { state: 'short', needed: count(raw.needed), held: count(raw.held) }
}

function readEarnings(raw) {
  const e = isObj(raw) ? raw : {}
  if (e.state === 'not_held' || e.state === 'no_dates') return { state: e.state }
  if (e.state !== 'ok') return { state: 'missing' }
  const c = isObj(e.cover) ? e.cover : null
  const cover = c && isoDay(c.from) && isoDay(c.through) ? { from: c.from, through: c.through, quarters: count(c.quarters) } : null
  return {
    state: 'ok', reports: count(e.reports) ?? 0, firstReport: isoDay(e.first_report), lastReport: isoDay(e.last_report),
    nextReport: isoDay(e.next_report), cover,
  }
}

function readWindow(raw) {
  if (!isObj(raw) || raw.state !== 'ok') return { ...shortOf(raw), sessions: count(raw?.sessions) }
  return {
    state: 'ok', sessions: count(raw.sessions), from: isoDay(raw.from), accumulation: count(raw.accumulation) ?? 0,
    distribution: count(raw.distribution) ?? 0, net: Number.isInteger(raw.net) ? raw.net : null, notJudged: count(raw.not_judged) ?? 0,
  }
}

function readUpdown(raw) {
  if (!isObj(raw) || raw.state !== 'ok') return { ...shortOf(raw), sessions: count(raw?.sessions) ?? 50 }
  return {
    state: 'ok', sessions: count(raw.sessions) ?? 50, from: isoDay(raw.from), upVolume: finite(raw.up_volume), downVolume: finite(raw.down_volume),
    up: count(raw.up_sessions) ?? 0, down: count(raw.down_sessions) ?? 0, flat: count(raw.flat_sessions) ?? 0,
    noVolume: count(raw.no_volume) ?? 0, ratio: finite(raw.ratio),
  }
}

function readAccumulation(raw) {
  const a = isObj(raw) ? raw : {}
  return {
    asOf: isoDay(a.as_of), minMovePct: finite(a.min_move_pct) ?? 0.2,
    windows: list(a.windows).map(readWindow),
    days: list(a.days).filter((d) => isoDay(d.date) && (d.kind === 'accumulation' || d.kind === 'distribution')).map((d) => ({
      date: d.date, kind: d.kind, changePct: finite(d.change_pct), volume: finite(d.volume), vsPrior: finite(d.vs_prior), session: count(d.session),
    })),
    updown: readUpdown(a.updown),
  }
}

function readBigDays(raw) {
  const b = isObj(raw) ? raw : {}
  const s = isObj(b.summary) ? b.summary : {}
  return {
    asOf: isoDay(b.as_of), from: isoDay(b.from), fullYear: b.full_year !== false, heldFrom: isoDay(b.held_from),
    sessions: count(b.sessions), noVolume: count(b.no_volume) ?? 0, listed: count(b.listed) ?? 10, avgSessions: count(b.avg_sessions) ?? 50,
    rows: list(b.rows).filter((r) => isoDay(r.date) && finite(r.volume) != null).map((r) => ({
      date: r.date, volume: finite(r.volume), avgVolume: finite(r.avg_volume), vsAvg: finite(r.vs_avg), changePct: finite(r.change_pct),
      closeInRangePct: finite(r.close_in_range_pct), earnings: mark(r.earnings),
    })),
    summary: { up: count(s.up) ?? 0, down: count(s.down) ?? 0, earnings: count(s.earnings) ?? 0, earningsUnknown: count(s.earnings_unknown) ?? 0 },
  }
}

function readPivots(raw) {
  const p = isObj(raw) ? raw : {}
  const base = {
    asOf: isoDay(p.as_of), from: isoDay(p.from), fullYear: p.full_year !== false, heldFrom: isoDay(p.held_from),
    lookback: count(p.lookback) ?? 10, ma: count(p.ma) ?? 10,
  }
  if (p.state !== 'ok') return { ...base, ...shortOf(p), rows: [] }
  return {
    ...base, state: 'ok', judgedFrom: isoDay(p.judged_from), count: count(p.count) ?? 0, upDays: count(p.up_days) ?? 0,
    notJudged: count(p.not_judged) ?? 0, earnings: count(p.earnings) ?? 0,
    rows: list(p.rows).filter((r) => isoDay(r.date)).map((r) => ({
      date: r.date, changePct: finite(r.change_pct), volume: finite(r.volume), downMax: finite(r.down_max), vsDownMax: finite(r.vs_down_max),
      ma: finite(r.ma), aboveMaPct: finite(r.above_ma_pct), earnings: mark(r.earnings),
    })),
  }
}

function readFillSide(raw) {
  const s = isObj(raw) ? raw : {}
  const w = (k) => {
    const x = isObj(s[k]) ? s[k] : {}
    return { filled: count(x.filled) ?? 0, judged: count(x.judged) ?? 0, pct: finite(x.pct) }
  }
  return {
    count: count(s.count) ?? 0, open: count(s.open) ?? 0, within5: w('within_5'), within20: w('within_20'),
    earnings: count(s.earnings) ?? 0, earningsKnown: count(s.earnings_known) ?? 0,
  }
}

function readGaps(raw) {
  const g = isObj(raw) ? raw : {}
  const base = { asOf: isoDay(g.as_of), first: isoDay(g.first), minGapPct: finite(g.min_gap_pct) ?? 3 }
  if (g.state !== 'ok') return { ...base, ...shortOf(g), rows: [] }
  const s = isObj(g.summary) ? g.summary : {}
  return {
    ...base, state: 'ok', total: count(g.total) ?? 0, shown: count(g.shown) ?? 0,
    summary: { all: readFillSide(s.all), up: readFillSide(s.up), down: readFillSide(s.down) },
    rows: list(g.rows).filter((r) => isoDay(r.date) && typeof r.up === 'boolean').map((r) => ({
      date: r.date, up: r.up, gapPct: finite(r.gap_pct), priorDate: isoDay(r.prior_date), priorClose: finite(r.prior_close),
      open: finite(r.open), close: finite(r.close), closeVsOpenPct: finite(r.close_vs_open_pct), filled: isoDay(r.filled),
      sessionsToFill: count(r.sessions_to_fill), sessionsSince: count(r.sessions_since), earnings: mark(r.earnings), check: r.check === true,
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
export function vfpRead(body) {
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
    earnings: readEarnings(body.earnings),
    accumulation: readAccumulation(body.accumulation),
    bigDays: readBigDays(body.big_days),
    pivots: readPivots(body.pivots),
    gaps: readGaps(body.gaps),
  }
}

// ── words ──────────────────────────────────────────────────────────────────────────────────

/** 'up' | 'down' | null: the sign of a number, nothing more. */
export function signOf(v) {
  const n = finite(v)
  if (n == null || n === 0) return null
  return n > 0 ? 'up' : 'down'
}

/** A percent change with its sign: "+4.2%". */
export const changeText = (v, decimals = 1) => formatPercent(finite(v), { decimals, signed: true, absent: 'n/a' })
/** A percent level without a sign: "61%". */
export const levelPct = (v, decimals = 0) => formatPercent(finite(v), { decimals, absent: 'n/a' })
/** Shares traded: "23.4M". */
export const sharesText = (v) => formatCompactTerminal(finite(v), { absent: 'n/a' })
/** A price: "$101.20". */
export const money = (v) => formatCurrency(finite(v), { decimals: 2, grouping: true, absent: 'n/a' })
/** A multiple: "2.4x" (or with the decimals asked for: "1.04x"). */
export const timesText = (v, decimals = null) => (finite(v) == null ? 'n/a'
  : `${formatNumber(finite(v), { decimals: decimals ?? (finite(v) >= 10 ? 0 : 1) })}x`)
export const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`
export const sessionsText = (n) => (n == null ? 'n/a' : plural(n, 'session', 'sessions'))
const signed = (n) => (n > 0 ? `+${formatNumber(n)}` : formatNumber(n))

/** What a section with too little history needs, in words. */
export function shortText(b) {
  if (!b || b.state !== 'short' || b.needed == null) return 'Not in the answer.'
  return `Needs ${plural(b.needed, 'session', 'sessions')}; UCT holds ${formatNumber(b.held ?? 0)}.`
}

/** "History held from Mar 3, 2026 only, less than a year: the list covers what is held." */
export function partialYearText(sec, sym) {
  if (sec.fullYear || !sec.heldFrom) return null
  return `UCT's prices for ${sym} start ${dayText(sec.heldFrom)}, less than a year back: this covers what is held.`
}

// section 1
export function windowText(w) {
  if (w.state !== 'ok') return shortText(w)
  const nj = w.notJudged ? `; ${plural(w.notJudged, 'session', 'sessions')} not judged (no volume held)` : ''
  return `${plural(w.accumulation, 'accumulation day', 'accumulation days')}, ${plural(w.distribution, 'distribution day', 'distribution days')}: net ${signed(w.net ?? 0)}${nj}`
}

export function updownText(u) {
  if (u.state !== 'ok') return shortText(u)
  const parts = `${sharesText(u.upVolume)} shares on ${plural(u.up, 'up close', 'up closes')}, ${sharesText(u.downVolume)} on ${plural(u.down, 'down close', 'down closes')}`
  if (u.noVolume) return `No ratio: ${plural(u.noVolume, 'session', 'sessions')} that moved ${u.noVolume === 1 ? 'has' : 'have'} no volume held.`
  if (u.ratio == null) return `No ratio: nothing closed down in the ${formatNumber(u.sessions)} sessions (${parts}).`
  return `${formatNumber(u.ratio, { decimals: 2 })} (${parts})`
}

/** The dates of one kind of day inside the newest `within` sessions, newest first: "Nov 18, Nov 12". */
export function adDates(days, kind, within = 25) {
  const got = days.filter((d) => d.kind === kind && d.session != null && d.session <= within)
  return got.length ? got.map((d) => dayText(d.date, { short: true })).join(', ') : 'none'
}

export function windowsAsOf(a) {
  const ok = a.windows.filter((w) => w.state === 'ok' && w.from)
  if (!a.asOf) return null
  const spans = ok.map((w) => `${formatNumber(w.sessions)} from ${dayText(w.from)}`)
  return `As of the close of ${dayText(a.asOf)}${spans.length ? `; the windows run ${spans.join(' and ')}` : ''}.`
}

// section 2
export function bigDaysLine(b, sym) {
  if (!b.rows.length) return `No session with volume held for ${sym} since ${b.from ? dayText(b.from) : 'a year back'}.`
  const n = b.rows.length
  const head = `The ${n === 1 ? 'heaviest session' : `${formatNumber(n)} heaviest sessions`} since ${dayText(b.from)}`
  const moves = `${formatNumber(b.summary.up)} closed up, ${formatNumber(b.summary.down)} down`
  const earn = b.summary.earnings ? `; ${plural(b.summary.earnings, 'was on an earnings report', 'were on an earnings report')}` : ''
  return `${head}: ${moves}${earn}.`
}

export function bigVolumeCell(r, avgSessions = 50) {
  return { main: sharesText(r.volume), sub: r.vsAvg != null ? `${timesText(r.vsAvg)} its ${formatNumber(avgSessions)}-day average` : `under ${formatNumber(avgSessions)} sessions with volume before it` }
}

export function rangeText(r) {
  if (r.closeInRangePct == null) return 'no range that day'
  return `closed ${levelPct(r.closeInRangePct)} up its range`
}

// section 3
/** A pocket pivot's two margins, to the hundredth: both are above by definition, so "1.0x" or "+0.0%" would hide it. */
export function pivotCells(r) {
  return {
    volume: r.vsDownMax != null ? `${timesText(r.vsDownMax, 2)} the biggest down day` : `biggest down day ${sharesText(r.downMax)}`,
    aboveMa: changeText(r.aboveMaPct, 2),
  }
}

export function pivotsLine(p, sym) {
  if (p.state !== 'ok') return shortText(p)
  const since = p.from ? ` since ${dayText(p.from)}` : ''
  if (!p.count) return `No pocket pivot in ${sym}${since}.`
  const last = p.rows[0] ? ` The last was ${dayText(p.rows[0].date)}.` : ''
  const earn = p.earnings ? ` ${plural(p.earnings, 'was on an earnings report', 'were on an earnings report')}.` : ''
  return `${plural(p.count, 'pocket pivot', 'pocket pivots')}${since}.${last}${earn}`
}

// section 4
export function gapsLine(g, sym) {
  if (g.state !== 'ok') return shortText(g)
  const since = g.first ? ` since ${dayText(g.first)}` : ''
  if (!g.total) return `No gap of ${formatNumber(g.minGapPct)}% or more in ${sym}${since}.`
  const a = g.summary.all
  return `${plural(g.total, `gap of ${formatNumber(g.minGapPct)}% or more`, `gaps of ${formatNumber(g.minGapPct)}% or more`)}${since}: ${formatNumber(g.summary.up.count)} up, ${formatNumber(g.summary.down.count)} down; ${formatNumber(a.open)} not filled yet.`
}

/** One summary cell: "61%" over "98 of 160", or words when no gap is old enough to say. */
export function fillCell(w) {
  if (!w.judged) return { main: 'n/a', sub: 'none old enough' }
  return { main: levelPct(w.pct), sub: `${formatNumber(w.filled)} of ${formatNumber(w.judged)}` }
}

export function gapCell(r) {
  const size = r.gapPct == null ? 'n/a' : levelPct(Math.abs(r.gapPct), 1)
  return { main: dayText(r.date), sub: `${r.up ? 'up' : 'down'} ${size} from ${money(r.priorClose)}` }
}

export function gapDayCell(r) {
  return { main: changeText(r.closeVsOpenPct), sign: signOf(r.closeVsOpenPct), sub: `close ${money(r.close)} vs open ${money(r.open)}` }
}

export function filledCell(r) {
  if (!r.filled) return { main: 'Not yet', sub: r.sessionsSince != null ? `${sessionsText(r.sessionsSince)} since` : null, kind: 'open' }
  if (r.sessionsToFill === 0) return { main: 'Same session', sub: null, kind: 'same' }
  return { main: dayText(r.filled), sub: `${sessionsText(r.sessionsToFill)} later`, kind: 'later' }
}

// earnings
/** The words that say which span the earnings marks cover (never "no earnings" where it is not known). */
export function earningsNote(e, sym) {
  if (e.state === 'not_held') return `UCT's earnings page has not been built for ${sym} on this server yet, so no session carries an earnings mark.`
  if (e.state === 'no_dates') return `The earnings page UCT holds for ${sym} carries no report dates, so no session carries an earnings mark.`
  if (e.state !== 'ok') return 'Earnings dates could not be read, so no session carries an earnings mark.'
  const held = `UCT holds ${plural(e.reports, 'report date', 'report dates')} for ${sym}${e.firstReport && e.lastReport ? ` (${dayText(e.firstReport)} to ${dayText(e.lastReport)})` : ''}.`
  const how = 'A mark means a report dated that session or the session before (the time of day is not held, so a report day and the session after both carry it).'
  if (!e.cover) return `${held} ${how} The dates held are not a complete run of quarters, so a session without a mark may still have had a report.`
  return `${held} ${how} The marks are complete from ${dayText(e.cover.from)} to ${dayText(e.cover.through)}; outside that span a session carries no mark either way.`
}
