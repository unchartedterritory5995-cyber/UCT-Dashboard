// FCTX's pure half: the factor exposure answer -> what the panel draws. No React, so an agent
// capability can reuse it.
//
// ONE read, `GET /api/research/factor-exposure/{ticker}` (paid; api/services/factor_exposure.py).
// The server works every number out from the daily closes it already stores (settled sessions only;
// split-adjusted, price returns) for the stock and for the factor funds, and holds the answer for the
// session: an ordinary least-squares regression of the stock's daily return on six fund spreads (the
// market, size, growth vs value, momentum, quality, low volatility) over the newest 252 common sessions
// and the 252 before them. The plain line is the server's too, built only from loadings whose
// t-statistic is above 2 (api/services/factor_exposure_calc.py); this file only reads the answer and
// puts it into words.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a window with too few sessions says what it needs, in words.
// ⛔ A LOADING UNDER THE BAR IS SAID TO BE TOO UNCERTAIN TO READ, never read.
// ⛔ DESCRIPTIVE, NOT A FORECAST.
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayText } from './ratesModel'

export const FCTX_CODE = 'FCTX'
/** The thing read, as a failed read names it ("The factor exposure could not be read just now."). */
export const FCTX_WHAT = 'The factor exposure'
export const FCTX_SOURCE = "UCT's stored daily prices"
/** The answer changes once a session. */
export const HELD_POLL_MS = 30 * 60 * 1000

export const fctxUrl = (sym) => `/api/research/factor-exposure/${encodeURIComponent(sym)}`

export const FACTOR_KEYS = Object.freeze(['market', 'size', 'growth', 'momentum', 'quality', 'lowvol'])
const NAMES = Object.freeze({
  market: 'Market', size: 'Size', growth: 'Growth vs value', momentum: 'Momentum', quality: 'Quality', lowvol: 'Low volatility',
})
/** The factor's name in a sentence: "growth vs value", "low volatility". */
const lowerName = (key) => (NAMES[key] || key).toLowerCase()

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const text = (v) => (typeof v === 'string' && v ? v : null)
const sym = (v) => (typeof v === 'string' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(v) ? v : null)
const syms = (v) => (Array.isArray(v) ? v.map(sym).filter(Boolean) : [])
const list = (v) => (Array.isArray(v) ? v.filter(isObj) : [])
const known = (k) => FACTOR_KEYS.includes(k)

// ── reading the answer ─────────────────────────────────────────────────────────────────────

function readRow(r) {
  const row = {
    key: r.key, loading: finite(r.loading), se: finite(r.se), t: finite(r.t), clears: r.clears === true,
    correlation: finite(r.correlation), vif: finite(r.vif),
  }
  if (r.key === 'market') {
    row.tVsOne = finite(r.t_vs_one)
    row.side = ['more', 'less', 'same', 'against'].includes(r.side) ? r.side : null
  }
  return row
}

function readWindow(raw) {
  const w = isObj(raw) ? raw : {}
  if (w.state === 'short') return { state: 'short', needed: count(w.needed), held: count(w.held) ?? 0 }
  if (w.state === 'singular') return { state: 'singular', returns: count(w.returns), from: isoDay(w.from), to: isoDay(w.to) }
  if (w.state !== 'ok') return { state: 'missing' }
  const c = isObj(w.constant) ? w.constant : {}
  const v = isObj(w.volatility) ? w.volatility : {}
  const mv = isObj(w.max_vif) ? w.max_vif : {}
  return {
    state: 'ok', returns: count(w.returns), from: isoDay(w.from), to: isoDay(w.to), full: w.full !== false, exact: w.exact === true,
    loadings: list(w.loadings).filter((r) => known(r.key)).map(readRow),
    constant: { dailyPct: finite(c.daily_pct), yearlyPct: finite(c.yearly_pct), t: finite(c.t), clears: c.clears === true },
    r2: finite(w.r2), adjR2: finite(w.adj_r2), explainedPct: finite(w.explained_pct), ownPct: finite(w.own_pct),
    vol: { totalPct: finite(v.total_pct), factorsPct: finite(v.factors_pct), ownPct: finite(v.own_pct) },
    betaAlone: finite(w.market_beta_alone),
    maxVif: known(mv.key) && finite(mv.value) != null ? { key: mv.key, value: mv.value } : null,
    unstable: w.unstable === true,
    check: Array.isArray(w.check) ? w.check.map(isoDay).filter(Boolean) : [],
  }
}

function readReading(raw) {
  if (!isObj(raw) || !text(raw.text)) return null
  return {
    text: raw.text,
    basis: list(raw.basis).filter((b) => known(b.key)).map((b) => ({ key: b.key, side: text(b.side), loading: finite(b.loading), t: finite(b.t) })),
    uncertain: Array.isArray(raw.uncertain) ? raw.uncertain.filter(known) : [],
    exact: raw.exact === true,
  }
}

function readFactor(f) {
  return {
    key: f.key, name: text(f.name) || NAMES[f.key],
    state: ['ok', 'substituted', 'dropped'].includes(f.state) ? f.state : 'dropped',
    funds: Array.isArray(f.funds) ? syms(f.funds) : null,
    primary: syms(f.primary), alternative: syms(f.alternative),
    positive: text(f.positive), negative: text(f.negative),
  }
}

function readCheck(c) {
  return {
    symbol: sym(c.symbol), state: ['ok', 'short', 'stale', 'not_held', 'unavailable'].includes(c.state) ? c.state : 'unavailable',
    closes: count(c.closes) ?? 0, first: isoDay(c.first), last: isoDay(c.last), full: c.full === true, needed: count(c.needed),
  }
}

function readMethod(raw) {
  const m = isObj(raw) ? raw : {}
  return {
    window: count(m.window) ?? 252, min: count(m.min) ?? 200, tBar: finite(m.t_bar) ?? 2, vifUnstable: finite(m.vif_unstable) ?? 5,
    fundMinCloses: count(m.fund_min_closes) ?? 201, index: text(m.index) || 'S&P 500', maxLagDays: count(m.max_lag_days) ?? 10,
  }
}

/**
 * The route's body -> the panel's view. `state`:
 *   'ok'           the regression, the plain line and the funds
 *   'not_held'     the server stores no daily prices for the stock (`detail`)
 *   'busy'         the server is working out other stocks; ask again
 *   'unavailable'  the read failed on the server, or no market fund is held (`detail`)
 *   'failed'       not the route's shape
 */
export function fctxRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  if (body.status === 'not_held') return { state: 'not_held', detail: text(body.detail) }
  if (body.status === 'busy') return { state: 'busy', detail: text(body.detail) }
  if (body.status === 'unavailable' || body.status === 'refused') return { state: 'unavailable', detail: text(body.detail) }
  if (body.status !== 'ok') return { state: 'failed' }
  const change = Array.isArray(body.change)
    ? Object.fromEntries(list(body.change).filter((c) => known(c.key)).map((c) => [c.key, { change: finite(c.change), t: finite(c.t), clears: c.clears === true }]))
    : null
  return {
    state: 'ok',
    symbol: text(body.symbol),
    dataThrough: isoDay(body.data_through),
    readFrom: isoDay(body.read_from),
    sessionsRead: count(body.sessions_read),
    jumpPct: finite(body.suspect_jump_pct) ?? 40,
    commonReturns: count(body.common_returns),
    method: readMethod(body.method),
    factors: list(body.factors).filter((f) => known(f.key)).map(readFactor),
    checks: list(body.fund_checks).map(readCheck).filter((c) => c.symbol),
    now: readWindow(body.now),
    then: readWindow(body.then),
    change,
    reading: readReading(body.reading),
    readingThen: readReading(body.reading_then),
  }
}

// ── words ──────────────────────────────────────────────────────────────────────────────────

export const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`

/** A signed number: "+1.32", "-0.41"; one that rounds to zero has no sign; missing is "n/a". */
export function signedNum(v, decimals = 2) {
  const n = finite(v)
  if (n == null) return 'n/a'
  const body = formatNumber(Math.abs(n), { decimals })
  if (Number(formatNumber(Math.abs(n), { decimals, grouping: false })) === 0) return body
  return `${n > 0 ? '+' : '-'}${body}`
}

/** "t 4.6" (one decimal), or words when there is none. */
export const tText = (t) => (finite(t) == null ? 'no t' : `t ${formatNumber(finite(t), { decimals: 1 })}`)

export const factorName = (key) => NAMES[key] || key

/** What a window with too few sessions needs, or why it has no loadings, in words. */
export function windowShortText(w, method) {
  if (w.state === 'short') {
    const held = w.held ?? 0
    return `Needs ${plural(w.needed ?? method.min, 'common session', 'common sessions')}; ${held ? `UCT holds ${formatNumber(held)}` : 'UCT holds none'}.`
  }
  if (w.state === 'singular') return 'The factor returns move together too closely over these sessions to be told apart, so no loadings are worked out.'
  return 'Not in the answer.'
}

/** "252 sessions, Nov 21, 2025 to Nov 20, 2026" (and the short window said). */
export function windowText(w, method) {
  if (w.state !== 'ok') return windowShortText(w, method)
  const span = w.from && w.to ? `, ${dayText(w.from)} to ${dayText(w.to)}` : ''
  const short = w.full ? '' : `: fewer than ${formatNumber(method.window)}, above the ${formatNumber(method.min)} minimum`
  return `${plural(w.returns ?? 0, 'session', 'sessions')}${span}${short}`
}

/** One loading as a cell: the number, its t and whether it clears the bar. */
export function loadingCell(row, tBar = 2) {
  if (!row) return { main: 'n/a', sub: 'not in the model' }
  if (row.t == null) return { main: signedNum(row.loading), sub: 'no t: an exact fit' }
  return { main: signedNum(row.loading), sub: `${tText(row.t)}, ${row.clears ? `above ${formatNumber(tBar)}` : 'too uncertain'}` }
}

/** The change from a year earlier, in words: "+0.21, beyond the noise (t 2.6)". */
export function changeText(c) {
  if (!c || c.change == null) return null
  return `change ${signedNum(c.change)}, ${c.clears ? 'beyond the noise' : 'within the noise'} (${tText(c.t)})`
}

/** The scale of the bars: the largest loading drawn, rounded up to a half, at least 1. */
export function barScale(view) {
  const vals = [view.now, view.then].flatMap((w) => (w.state === 'ok' ? w.loadings.map((r) => Math.abs(r.loading ?? 0)) : []))
  const top = Math.max(1, ...vals)
  return Math.ceil(top * 2) / 2
}

/** One bar: which side of the middle it grows and how far (a share of the half track, as a percent). */
export function barOf(loading, scale) {
  const n = finite(loading)
  if (n == null || n === 0 || !(scale > 0)) return { dir: null, width: 0 }
  return { dir: n > 0 ? 'pos' : 'neg', width: Math.round(Math.min(Math.abs(n) / scale, 1) * 500) / 10 }
}

/** The loadings table: one row per factor in the model now or a year earlier, in the server's order. */
export function factorRows(view) {
  const now = view.now.state === 'ok' ? Object.fromEntries(view.now.loadings.map((r) => [r.key, r])) : {}
  const then = view.then.state === 'ok' ? Object.fromEntries(view.then.loadings.map((r) => [r.key, r])) : {}
  const byKey = Object.fromEntries(view.factors.map((f) => [f.key, f]))
  return FACTOR_KEYS.filter((k) => now[k] || then[k]).map((k) => ({
    key: k, name: byKey[k]?.name || NAMES[k], positive: byKey[k]?.positive, negative: byKey[k]?.negative,
    now: now[k] || null, then: then[k] || null, change: view.change?.[k] || null,
  }))
}

/** What the sign of a style loading means ("+ small caps, - large caps"), from the server's words. The market
 *  row has none: +1.00 on the market is said in the method note. */
export function signMeaning(row) {
  if (row.key === 'market' || !row.positive || !row.negative) return null
  return `+ ${row.positive}, - ${row.negative}`
}

/** The words under the plain line: which loadings it is built from and which are too uncertain. */
export function basisText(reading, method) {
  if (!reading) return null
  if (reading.exact) return 'An exact fit leaves nothing to test, so no loading is read.'
  const bar = `a t-statistic above ${formatNumber(method.tBar)}`
  const used = reading.basis.map((b) => lowerName(b.key))
  const left = reading.uncertain.map(lowerName)
  const head = used.length ? `Built only from the loadings with ${bar}: ${used.join(', ')}.` : `No loading has ${bar}.`
  return left.length ? `${head} Too uncertain to read: ${left.join(', ')}.` : head
}

const SIDE_WORDS = Object.freeze({
  more: 'more sensitive to the market than the S&P 500', less: 'less sensitive to the market than the S&P 500',
  same: "not distinguishable from the S&P 500's own sensitivity", against: 'moves against the market',
})

/** The market loading against 1, in words. */
export function marketVsOneText(row, method) {
  if (!row) return 'Not in the model.'
  if (row.tVsOne == null) return 'No t can be worked out (an exact fit).'
  const side = row.side ? SIDE_WORDS[row.side] : `the market loading itself is under ${formatNumber(method.tBar)}, so it is not read`
  return `${tText(row.tVsOne)} against 1: ${side}.`
}

/** The constant (the daily return the factors do not explain), a year, with its uncertainty. */
export function constantText(c, method) {
  if (c.yearlyPct == null) return 'n/a'
  const words = c.t == null ? 'no t (an exact fit)' : c.clears ? `${tText(c.t)}, above ${formatNumber(method.tBar)}` : `${tText(c.t)}, too uncertain to read`
  return `${formatPercent(c.yearlyPct, { decimals: 1, signed: true })} a year (${formatPercent(c.dailyPct, { decimals: 3, signed: true })} a day); ${words}`
}

/** The fit block's label and value pairs for one window. */
export function fitRows(w, method) {
  if (w.state !== 'ok') return []
  const market = w.loadings.find((r) => r.key === 'market') || null
  const rows = [
    ['Explained by the factors', w.explainedPct == null ? 'n/a'
      : `${formatPercent(w.explainedPct, { decimals: 1 })} of its daily variance (R-squared ${formatNumber(w.r2, { decimals: 2 })}, adjusted ${formatNumber(w.adjR2, { decimals: 2 })})`, 'explained'],
    ['Its own part', w.ownPct == null ? 'n/a' : `${formatPercent(w.ownPct, { decimals: 1 })}: moves the factors do not explain`, 'own'],
    ['Volatility, a year', w.vol.totalPct == null ? 'n/a'
      : `${formatPercent(w.vol.totalPct, { decimals: 1 })} in all: ${formatPercent(w.vol.factorsPct, { decimals: 1 })} from the factors, ${formatPercent(w.vol.ownPct, { decimals: 1 })} its own`, 'vol'],
    ['Market loading against 1', marketVsOneText(market, method), 'vsone'],
    ['Beta to the market alone', w.betaAlone == null ? 'n/a' : `${formatNumber(w.betaAlone, { decimals: 2 })} (the market loading above holds the style spreads fixed)`, 'alone'],
    ['Return the factors leave', constantText(w.constant, method), 'constant'],
    ['Largest variance inflation', w.maxVif ? `${formatNumber(w.maxVif.value, { decimals: 1 })} (${lowerName(w.maxVif.key)})${w.unstable ? `, above ${formatNumber(method.vifUnstable)}: unstable` : `, under ${formatNumber(method.vifUnstable)}`}` : 'n/a', 'vif'],
  ]
  return rows
}

/** The year-earlier pairs: the shares and the volatility only. */
export function fitThenRows(w) {
  if (w.state !== 'ok') return []
  return [
    ['Explained by the factors', w.explainedPct == null ? 'n/a' : `${formatPercent(w.explainedPct, { decimals: 1 })} (R-squared ${formatNumber(w.r2, { decimals: 2 })})`, 'explained'],
    ['Its own part', w.ownPct == null ? 'n/a' : formatPercent(w.ownPct, { decimals: 1 }), 'own'],
    ['Volatility, a year', w.vol.totalPct == null ? 'n/a' : `${formatPercent(w.vol.totalPct, { decimals: 1 })} in all, ${formatPercent(w.vol.ownPct, { decimals: 1 })} its own`, 'vol'],
  ]
}

/** The warning when the factors overlap too much to separate. */
export function unstableText(w, method) {
  if (w.state !== 'ok' || !w.unstable || !w.maxVif) return null
  return `The factors overlap: the largest variance inflation factor is ${formatNumber(w.maxVif.value, { decimals: 1 })} (${lowerName(w.maxVif.key)}), above ${formatNumber(method.vifUnstable)}, so these loadings are unstable: a small change in the sessions can move them a lot. Read them with care.`
}

/** The warning when a window holds a one-session move large enough to be an unadjusted split. */
export function checkText(view) {
  const days = [...(view.now.state === 'ok' ? view.now.check : []), ...(view.then.state === 'ok' ? view.then.check : [])]
  if (!days.length) return null
  return `A one-session move of more than ${formatNumber(view.jumpPct)}% on ${days.map((d) => dayText(d)).join(', ')} sits inside the sessions used: it can be a split the history did not adjust, which would bend the loadings. Check the chart.`
}

// the funds
const CHECK_WORDS = Object.freeze({
  not_held: 'not held on this server', unavailable: 'could not be read just now',
})

/** What is held of one fund, in words. */
export function checkWords(c, method) {
  if (!c) return 'not looked at'
  if (c.state === 'ok') return `${plural(c.closes, 'close', 'closes')} read${c.last ? `, through ${dayText(c.last)}` : ''}`
  if (c.state === 'short') return `only ${plural(c.closes, 'close', 'closes')} (needs ${formatNumber(c.needed ?? method.fundMinCloses)})`
  if (c.state === 'stale') return `last close ${c.last ? dayText(c.last) : 'n/a'}, more than ${formatNumber(method.maxLagDays)} days old`
  return CHECK_WORDS[c.state] || 'could not be read just now'
}

/** The funds table: each factor with the funds it uses (or why it is left out) and what is held. */
export function fundRows(view) {
  const checks = Object.fromEntries(view.checks.map((c) => [c.symbol, c]))
  return view.factors.map((f) => {
    const tried = [...f.primary, ...(f.state === 'ok' ? [] : f.alternative)]
    const shown = f.funds ? [...new Set([...f.funds, ...(f.state === 'substituted' ? f.primary : [])])] : tried
    return {
      key: f.key, name: f.name, state: f.state, funds: f.funds, primary: f.primary, alternative: f.alternative,
      held: shown.filter((s) => checks[s]).map((s) => ({ symbol: s, words: checkWords(checks[s], view.method), ok: checks[s].state === 'ok' })),
    }
  })
}

/** The sub-line of a fund row's spread cell. */
export function fundStateText(r) {
  if (r.state === 'substituted') return `stands in for ${r.primary.join(' minus ')}, which is not held with enough history`
  if (r.state === 'dropped') return `left out: neither ${r.primary.join(' and ')} nor ${r.alternative.join(' and ')} is held with enough history`
  return null
}

/** The line that names any substitution or factor left out, for the top of the panel. */
export function fundsNote(view) {
  const subs = view.factors.filter((f) => f.state === 'substituted').map((f) => `${f.funds.join(' and ')} for ${f.primary.join(' and ')}`)
  const gone = view.factors.filter((f) => f.state === 'dropped').map((f) => lowerName(f.key))
  const parts = []
  if (subs.length) parts.push(`Alternative funds used: ${subs.join('; ')}.`)
  if (gone.length) parts.push(`Left out of the model, no fund held with enough history: ${gone.join(', ')}.`)
  return parts.length ? parts.join(' ') : null
}
