// SETH's pure half: the "how setups acted" answers -> what the panel draws. No React, so an agent
// capability can reuse it.
//
// TWO reads (paid; api/services/setup_history.py), both worked out by the server from the daily prices
// it already stores, never from a vendor:
//   GET /api/research/setup-history           the universe study, built once a week: a fixed library of
//                                             setups, each with its signals, hit rate, average, median,
//                                             worst and best return 5, 20 and 60 sessions on, and the
//                                             excess over the same day's stocks, by S&P 500 phase
//   GET /api/research/setup-history/{ticker}  every time each setup fired on one stock, newest first, and
//                                             how that setup did across the universe in the same phase
// This file only reads them and puts them into words; the definitions are the server's
// (api/services/setup_history_calc.py) and its words for them travel in the answer.
//
// ⛔ EVERY NUMBER SAYS HOW MANY SIGNALS IT RESTS ON, and below the backtester's floor (30) the rates are
// withheld by the server: this file says "too few signals", never a 0.
// ⛔ THE PHASE IS ASSIGNED WITH HINDSIGHT, and the survivorship sentence rides on every answer.
// ⛔ A RECORD, NOT A FORECAST: green and red mark the sign of a return only.
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayText } from './ratesModel'

export const SETH_CODE = 'SETH'
export const SETH_URL = '/api/research/setup-history'
export const sethStockUrl = (sym) => `${SETH_URL}/${encodeURIComponent(sym)}`
/** The thing read, as a failed read names it ("How setups acted could not be read just now."). */
export const SETH_WHAT = 'How setups acted'
export const SETH_SOURCE = "UCT's stored daily prices"
/** The study changes once a week; while it is being built, ask again now and then (a build takes minutes). */
export const HELD_POLL_MS = 30 * 60 * 1000
export const STUDY_COMPUTING_POLL_MS = 15000
export const STUDY_WAITING_POLL_MS = 5 * 60 * 1000
/** One stock is worked out in a few seconds. */
export const STOCK_COMPUTING_POLL_MS = 3000

/** The forward horizons, in sessions after the next open. */
export const SETH_HORIZONS = Object.freeze([5, 20, 60])
export const SETH_DEFAULT_HORIZON = 20
export const horizonLabel = (h) => `${h} days`

/** The phase groups, in the table's order; the server's words for each travel in the answer. */
export const SETH_PHASES = Object.freeze(['correction', 'after_low', 'uptrend', 'all'])
const PHASE_SHORT = Object.freeze({
  correction: 'In a correction', after_low: 'First 3 months after a low', uptrend: 'Later in an uptrend', all: 'All days',
})
export const phaseShort = (p) => PHASE_SHORT[p] || 'No phase'
/** The same, for a stock's signal on a day the index history does not label. */
export const signalPhaseText = (p) => (p && PHASE_SHORT[p] ? PHASE_SHORT[p] : 'No phase (outside the index history held)')

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const text = (v) => (typeof v === 'string' && v ? v : null)

// ── reading the study ──────────────────────────────────────────────────────────────────────

function readHorizon(raw) {
  const h = isObj(raw) ? raw : {}
  const s = isObj(h.strategy) ? h.strategy : {}
  const b = isObj(h.baseline) ? h.baseline : {}
  const sd = isObj(h.same_day) ? h.same_day : {}
  const n = count(h.n) ?? count(s.n) ?? 0
  return {
    n,
    below: h.below_floor === true,
    winRate: finite(s.win_rate),
    avgPct: finite(s.avg_pct),
    medianPct: finite(s.median_pct),
    worstPct: finite(s.worst),
    bestPct: finite(s.best),
    baseN: count(b.n),
    baseWinRate: finite(b.win_rate),
    baseAvgPct: finite(b.avg_pct),
    excessPct: finite(sd.excess_pct_winsorised),
    excessWhy: text(sd.excess_null_reason),
    matched: count(sd.n_matched),
    cells: count(sd.n_cells),
  }
}

function readGroup(raw) {
  if (!isObj(raw) || !SETH_PHASES.includes(raw.phase)) return null
  const hz = isObj(raw.horizons) ? raw.horizons : {}
  return {
    phase: raw.phase,
    words: text(raw.words) || phaseShort(raw.phase),
    signals: count(raw.signals) ?? 0,
    horizons: Object.fromEntries(SETH_HORIZONS.map((h) => [h, readHorizon(hz[String(h)])])),
  }
}

function readSetup(raw) {
  if (!isObj(raw) || !text(raw.id) || !text(raw.name)) return null
  const groups = (Array.isArray(raw.groups) ? raw.groups : []).map(readGroup).filter(Boolean)
  const byPhase = Object.fromEntries(groups.map((g) => [g.phase, g]))
  return {
    id: raw.id,
    name: raw.name,
    words: text(raw.words),
    state: raw.state === 'capped' ? 'capped' : 'ok',
    detail: text(raw.detail),
    signals: count(raw.signals),
    groups: SETH_PHASES.map((p) => byPhase[p]).filter(Boolean),
  }
}

/**
 * The study's body -> the panel's view. `state`:
 *   'computing'    the weekly build is running for the first time (ask again soon)
 *   'waiting'      nothing is held and a build may not start now (outside trading hours only)
 *   'unavailable'  the build could not run (the index history is not held, or it failed)
 *   'failed'       not the route's shape
 *   'ok'
 */
export function sethRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'waiting') return { state: 'waiting', detail: text(body.detail) }
  if (body.status === 'unavailable' || body.status === 'failed') {
    return { state: 'unavailable', reason: text(body.reason), detail: text(body.detail) }
  }
  if (body.status !== 'ok' || !Array.isArray(body.setups)) return { state: 'failed' }
  const u = isObj(body.universe) ? body.universe : {}
  const w = isObj(body.window) ? body.window : {}
  const ph = isObj(body.phases) ? body.phases : {}
  const m = isObj(body.method) ? body.method : {}
  return {
    state: 'ok',
    builtAt: text(body.built_at),
    dataThrough: isoDay(body.data_through),
    refreshing: body.refreshing === true,
    minSignals: count(body.min_signals) ?? 30,
    window: { from: isoDay(w.from), to: isoDay(w.to), firstDay: isoDay(w.first_day), years: count(w.years) },
    universe: {
      name: text(u.name), caveat: text(u.caveat), requested: count(u.symbols_requested), read: count(u.symbols_read),
      notHeld: count(u.symbols_not_held), scanned: count(u.symbols_scanned),
    },
    phases: {
      index: text(ph.index) || 'S&P 500', episodes: count(ph.episodes), first: isoDay(ph.first), last: isoDay(ph.last),
      definition: text(ph.definition), hindsight: text(ph.hindsight) || text(m.phase),
    },
    method: {
      perRun: text(m.one_signal_per_run), observations: text(m.observations), window: text(m.window),
      winsorPct: finite(m.winsor_pct),
    },
    setups: body.setups.map(readSetup).filter(Boolean),
    dropped: (Array.isArray(body.dropped) ? body.dropped : []).filter((d) => isObj(d) && text(d.name) && text(d.why))
      .map((d) => ({ name: d.name, why: d.why })),
  }
}

// ── reading one stock ──────────────────────────────────────────────────────────────────────

function readLine(raw) {
  if (!isObj(raw)) return null
  const hz = isObj(raw.horizons) ? raw.horizons : {}
  return {
    signals: count(raw.signals) ?? 0,
    horizons: Object.fromEntries(SETH_HORIZONS.map((h) => {
      const v = isObj(hz[String(h)]) ? hz[String(h)] : {}
      return [h, { n: count(v.n) ?? 0, below: v.below_floor === true, winRate: finite(v.win_rate), avgPct: finite(v.avg_pct),
        medianPct: finite(v.median_pct), excessPct: finite(v.excess_pct) }]
    })),
  }
}

/**
 * The one-stock body -> the panel's view. `state`: 'computing' | 'not_held' | 'unavailable' | 'failed' | 'ok'.
 * `universe.state`: 'ok' | 'computing' | 'waiting' | 'unavailable'.
 */
export function sethStockRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'not_held') return { state: 'not_held', detail: text(body.detail) }
  if (body.status === 'unavailable' || body.status === 'failed' || body.status === 'refused') {
    return { state: 'unavailable', reason: text(body.reason), detail: text(body.detail) }
  }
  if (body.status !== 'ok' || !Array.isArray(body.signals)) return { state: 'failed' }
  const lib = (Array.isArray(body.library) ? body.library : []).filter((s) => isObj(s) && text(s.id) && text(s.name))
  const names = Object.fromEntries(lib.map((s) => [s.id, s.name]))
  const u = isObj(body.universe) ? body.universe : {}
  const uw = isObj(u.window) ? u.window : {}
  const lines = isObj(u.lines) ? u.lines : {}
  const ph = isObj(body.phases) ? body.phases : {}
  const signals = body.signals.filter((r) => isObj(r) && isoDay(r.date) && text(r.setup)).map((r) => {
    const ret = isObj(r.returns) ? r.returns : {}
    return {
      date: r.date, setup: r.setup, name: names[r.setup] || r.setup,
      phase: SETH_PHASES.includes(r.phase) && r.phase !== 'all' ? r.phase : null,
      returns: Object.fromEntries(SETH_HORIZONS.map((h) => [h, finite(ret[String(h)])])),
    }
  })
  // the universe lines, in the order the stock's signals first name each pair (newest first)
  const pairs = []
  const seen = new Set()
  for (const r of signals) {
    const key = `${r.setup}|${r.phase || 'all'}`
    if (seen.has(key)) continue
    seen.add(key)
    const line = readLine(lines[key])
    if (line) pairs.push({ key, setup: r.setup, name: r.name, phase: r.phase || 'all', ...line })
  }
  const total = count(body.total) ?? signals.length
  return {
    state: 'ok',
    symbol: text(body.symbol),
    first: isoDay(body.first),
    dataThrough: isoDay(body.data_through),
    sessions: count(body.sessions),
    total,
    shown: signals.length,
    cut: body.cut === 'oldest' && total > signals.length ? 'oldest' : null,
    signals,
    library: lib.map((s) => ({ id: s.id, name: s.name, words: text(s.words) })),
    phases: { state: ph.state === 'ok' ? 'ok' : 'not_held', index: text(ph.index) || 'S&P 500', hindsight: text(ph.hindsight) },
    perRun: text(body.one_signal_per_run),
    fill: text(body.fill),
    universe: {
      state: ['ok', 'computing', 'waiting'].includes(u.state) ? u.state : 'unavailable',
      from: isoDay(uw.from), to: isoDay(uw.to), note: text(u.note), minSignals: count(u.min_signals) ?? 30, pairs,
    },
  }
}

/** True while the server is still working something out (the panel asks again sooner). */
export const studyPollMs = (view) => (view.state === 'computing' ? STUDY_COMPUTING_POLL_MS
  : view.state === 'waiting' ? STUDY_WAITING_POLL_MS : HELD_POLL_MS)
export const stockPollMs = (view) => (view.state === 'computing' ? STOCK_COMPUTING_POLL_MS
  : view.state === 'ok' && view.universe.state === 'computing' ? STUDY_COMPUTING_POLL_MS : HELD_POLL_MS)

// ── words ──────────────────────────────────────────────────────────────────────────────────

/** A percent change with its sign, one decimal: "+3.9%", "-12.0%". Missing: `absent`. */
export const changeText = (v, absent = 'n/a') => formatPercent(finite(v), { decimals: 1, signed: true, absent })

/** 'up' | 'down' | null: the sign of a number, nothing more. */
export function signOf(v) {
  const n = finite(v)
  if (n == null || n === 0) return null
  return n > 0 ? 'up' : 'down'
}

/** Percentage points with a sign: "+0.9 pts", "-1.4 pts", "0.0 pts". */
export function pointsText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  if (Math.abs(n) < 0.05) return '0.0 pts'
  return `${n > 0 ? '+' : '-'}${formatNumber(Math.abs(n), { decimals: 1 })} pts`
}

const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`
export const signalsText = (n) => plural(n ?? 0, 'signal', 'signals')

/** The withheld sentence for a group under the floor: "Too few signals: 12 (30 needed)." */
export const tooFewText = (n, min) => `Too few signals: ${formatNumber(n ?? 0)} (${formatNumber(min)} needed).`

/** The hit rate: "58%" (the share of signals up `h` days on). */
export const hitText = (v) => formatPercent(finite(v), { decimals: 0, absent: 'n/a' })

/** The same-day cell: `{ text, sign, sub }`. A null excess says why, never a 0. */
export function excessCell(hz) {
  if (hz.excessPct != null) {
    return { text: pointsText(hz.excessPct), sign: signOf(hz.excessPct), sub: hz.matched != null ? `${formatNumber(hz.matched)} matched` : null }
  }
  if (hz.excessWhy === 'no_unoccupied_cell') return { text: 'n/a', sign: null, sub: 'no other stock moved alike that day' }
  if (hz.excessWhy === 'no_measurable_cell') return { text: 'n/a', sign: null, sub: 'day move not measurable' }
  return { text: 'n/a', sign: null, sub: null }
}

/** The worst and best: "-48.2% / +312.0%". */
export const rangeText = (hz) => `${changeText(hz.worstPct)} / ${changeText(hz.bestPct)}`

/** The lede over the study. */
export function studyLine(view) {
  const n = view.setups.length
  const stocks = view.universe.scanned ?? view.universe.read
  const span = view.window.firstDay && view.dataThrough ? ` from ${dayText(view.window.firstDay)} to ${dayText(view.dataThrough)}` : ''
  const of = stocks != null ? ` across ${plural(stocks, 'stock', 'stocks')}` : ''
  return `How ${plural(n, 'setup', 'setups')} acted${of}${span}, by the ${view.phases.index}'s phase on the signal day.`
}

/** The universe counts behind the study. */
export function universeLine(view) {
  const u = view.universe
  const name = u.name || "UCT's stock universe"
  const parts = []
  if (u.read != null && u.requested != null) parts.push(`${formatNumber(u.read)} of ${formatNumber(u.requested)} stocks in ${name} have stored prices`)
  if (u.notHeld) parts.push(`${formatNumber(u.notHeld)} have none`)
  return parts.length ? `${parts.join('; ')}.` : ''
}

/** The lede over one stock's list, after its symbol: "had 48 signals of 7 setups over its held history (...)". */
export function stockLine(view) {
  const span = view.first && view.dataThrough ? ` (${dayText(view.first)} to ${dayText(view.dataThrough)})` : ''
  const setups = plural(view.library.length || 7, 'setup', 'setups')
  if (!view.total) return `had no signal of the ${setups} in the prices UCT holds${span}.`
  return `had ${signalsText(view.total)} of the ${setups} over its held history${span}, newest first.`
}

/** A count of signals as a number: "1,234". */
export const countText = (n) => formatNumber(n ?? 0)

/** The cut, said from its end. */
export const cutLine = (view) => (view.cut ? `Showing the newest ${formatNumber(view.shown)} of ${formatNumber(view.total)}; the oldest ${formatNumber(view.total - view.shown)} are not shown.` : null)
