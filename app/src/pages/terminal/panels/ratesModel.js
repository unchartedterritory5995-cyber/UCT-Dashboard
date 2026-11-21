// RATES: Treasury yields by maturity, their changes, and the two curve spreads a stock trader watches.
// The pure half (no React and no imports, so an agent capability can reuse it).
//
//   GET /api/research/treasury-yields       api/routers/treasury_yields.py -> api/services/treasury_yields.py
//     GATE   `Depends(require_paid)`: 401 signed out, 402 not on a paid plan. No feature flag.
//     SPEED  never built on the request: the answer the server holds (in memory and on disk), else a
//            few seconds' wait on ONE background build, else `{ status: 'computing' }` and this
//            panel asks again. The server refreshes it on weekday evenings (18:15 New York time).
//
//   status   'ok' | 'computing' | 'unavailable' | 'failed'
//   unavailable: { reason: 'refused' (the Treasury's website answered the server with a 4xx or a
//                  redirect) | 'shape' (it answered, but not with a feed that can be read as
//                  Treasury yields: a web page, broken XML, days without the 2-year or 10-year),
//                  http_status }
//   failed:      { reason: 'rate_limited' (429) | 'timeout' | 'source' (a 5xx, a dropped
//                  connection) | 'error', http_status }: tried again by the server after a short hold
//   ok: { as_of (the DATE of the newest figure), ref_dates { d1, w1, m1, m3, y1 } (the day each
//         change is measured against, or null), read_at (ISO instant: when the site read it),
//         basis 'end_of_day', source, check,
//         maturities: [{ key ('1m' … '30y'), label, months, yield (PERCENT),
//                        was { d1 … y1 } (percent on the reference day),
//                        change_bp { d1 … y1 } (BASIS POINTS) }],
//         spreads: [{ key ('10y2y' | '10y3m'), label, long, short, value (PERCENTAGE POINTS),
//                     state ('positive' | 'inverted' | 'flat'), days_in_state (TRADING DAYS in a
//                     row), since, days_at_least (the run reaches the edge of what was read),
//                     was, change_bp }],
//         history: { from, to, points, years, dates[], y2y[], y10y[], y30y[], s10y2y[], s10y3m[] } }
//     check   null, or { state, reason, http_status, at }: the last look for a newer figure did not
//             go well, and the figures shown are the last ones read
//     real    the REAL yield curve (TIPS) and the breakevens, as their own block with their own
//             status, dates and source (api/services/treasury_real_yields.py). Only beside an `ok`
//             answer; absent from an older server.
//             { status 'ok' | 'computing' | 'unavailable' | 'failed', reason, http_status,
//               as_of, ref_dates { d1, w1 }, maturities [{ key ('5y' ... '30y'), label, months,
//               yield (PERCENT), was { d1, w1 }, change_bp { d1, w1 } }],
//               breakevens { as_of (the newest day BOTH curves hold, or null),
//                            rows [{ key, date, nominal, real, value (nominal minus real, PERCENT) }] },
//               read_at, source, check }
//
// ⛔ A MISSING NUMBER IS NEVER 0: null stays null and the panel prints "No figure".
// ⛔ THESE ARE END-OF-DAY FIGURES. The panel always says the date of the newest one.

/** The terminal code this panel is registered under (the panel reads the live one from its frame). */
export const RATES_CODE = 'RATES'
export const RATES_URL = '/api/research/treasury-yields'
export const SOURCE = 'US Treasury daily par yield curve'
export const REAL_SOURCE = 'US Treasury daily par real yield curve'

/** The change horizons the server sends, shortest first, as a sentence names them. */
export const HORIZONS = Object.freeze({
  d1: 'the day before', w1: 'a week ago', m1: 'a month ago', m3: 'three months ago', y1: 'a year ago',
})
const HORIZON_KEYS = Object.keys(HORIZONS)
const STATES = new Set(['positive', 'inverted', 'flat'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const whole = (v) => (num(v) != null && v >= 0 ? v : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Pure: a calendar date as words ("Nov 17, 2026"; `short` drops the year). Never parsed into a time. */
export function dayText(iso, { short = false } = {}) {
  const d = day(iso)
  if (!d) return ''
  const [y, m, dd] = d.split('-').map(Number)
  return short ? `${MONTHS[m - 1]} ${dd}` : `${MONTHS[m - 1]} ${dd}, ${y}`
}

/** Pure: whole days from one calendar date to another (null when either is not one). */
export function daysBetween(fromIso, toIso) {
  const a = day(fromIso)
  const b = day(toIso)
  if (!a || !b) return null
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/** Pure: the New York calendar date of an ISO instant ('YYYY-MM-DD'), or null. */
export function etDayOf(iso) {
  const d = typeof iso === 'string' && iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

const byHorizon = (raw) => Object.fromEntries(HORIZON_KEYS.map((h) => [h, isObj(raw) ? num(raw[h]) : null]))

function maturityOf(m) {
  if (!isObj(m) || typeof m.key !== 'string' || !m.key) return null
  return {
    key: m.key,
    label: typeof m.label === 'string' && m.label ? m.label : m.key,
    months: whole(m.months),
    yield: num(m.yield),
    was: byHorizon(m.was),
    changeBp: byHorizon(m.change_bp),
  }
}

function spreadOf(s, labels) {
  if (!isObj(s) || typeof s.key !== 'string' || !s.key) return null
  const value = num(s.value)
  const state = STATES.has(s.state) ? s.state : null
  return {
    key: s.key,
    label: typeof s.label === 'string' && s.label ? s.label : s.key,
    long: labels[s.long] || String(s.long || ''),
    short: labels[s.short] || String(s.short || ''),
    value,
    // the state is the server's; with no figure there is none, whatever was sent
    state: value == null ? null : state,
    days: value == null ? null : whole(s.days_in_state),
    since: day(s.since),
    atLeast: s.days_at_least === true,
    was: byHorizon(s.was),
    changeBp: byHorizon(s.change_bp),
  }
}

function historyOf(h) {
  const dates = isObj(h) && Array.isArray(h.dates) ? h.dates.map(day) : []
  const col = (name) => (isObj(h) && Array.isArray(h[name]) && h[name].length === dates.length ? h[name].map(num) : dates.map(() => null))
  return {
    from: isObj(h) ? day(h.from) : null,
    to: isObj(h) ? day(h.to) : null,
    years: isObj(h) ? whole(h.years) : null,
    dates,
    y2y: col('y2y'), y10y: col('y10y'), y30y: col('y30y'), s10y2y: col('s10y2y'), s10y3m: col('s10y3m'),
  }
}

const checkOf = (c) => (isObj(c) && typeof c.state === 'string'
  ? { state: c.state, reason: typeof c.reason === 'string' ? c.reason : null, httpStatus: num(c.http_status) }
  : null)

/**
 * Pure: the answer's `real` block as the panel draws it, or null when the server sent none.
 *   state   'ok' | 'computing' | 'unavailable' | 'failed'
 *   ok:     asOf, refDates { d1, w1 }, rows [{ key, label, yield, changeBp, nominal, breakeven }],
 *           breakevenAsOf (its own date: the newest day both curves hold, or null), readAt, check
 * The breakeven is the SERVER's figure. It is null when either side is missing, never 0, and it is
 * never worked out here.
 */
export function realRead(raw) {
  if (!isObj(raw)) return null
  const status = String(raw.status || '')
  if (status === 'computing') return { state: 'computing' }
  const said = { reason: typeof raw.reason === 'string' ? raw.reason : null, httpStatus: num(raw.http_status) }
  if (status === 'unavailable') return { state: 'unavailable', ...said }
  const asOf = day(raw.as_of)
  const maturities = Array.isArray(raw.maturities) ? raw.maturities.map(maturityOf).filter(Boolean) : []
  if (status !== 'ok' || !asOf || !maturities.some((m) => m.yield != null)) return { state: 'failed', ...said }
  const be = isObj(raw.breakevens) ? raw.breakevens : {}
  const breakevenAsOf = day(be.as_of)
  const byKey = Object.fromEntries((Array.isArray(be.rows) ? be.rows : []).filter((r) => isObj(r) && typeof r.key === 'string').map((r) => [r.key, r]))
  return {
    state: 'ok',
    asOf,
    refDates: { d1: isObj(raw.ref_dates) ? day(raw.ref_dates.d1) : null, w1: isObj(raw.ref_dates) ? day(raw.ref_dates.w1) : null },
    rows: maturities.map((m) => {
      const b = byKey[m.key]
      // a breakeven without its day, or for another day than the block's, is not shown as one
      const dated = !!b && !!breakevenAsOf && day(b.date) === breakevenAsOf
      return {
        key: m.key, label: m.label, yield: m.yield, changeBp: m.changeBp,
        nominal: dated ? num(b.nominal) : null,
        breakeven: dated ? num(b.value) : null,
      }
    }),
    breakevenAsOf,
    readAt: typeof raw.read_at === 'string' ? raw.read_at : null,
    check: checkOf(raw.check),
  }
}

/**
 * Pure: the route's answer as the panel draws it.
 *   state   'ok' | 'computing' | 'unavailable' | 'failed' (a failed build, or not this route's answer)
 *   ok:     asOf, refDates, readAt, maturities, spreads, history, check
 *   unavailable: reason, httpStatus
 */
export function ratesRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  const status = String(body.status || '')
  if (status === 'computing') return { state: 'computing' }
  if (status === 'unavailable') {
    return { state: 'unavailable', reason: typeof body.reason === 'string' ? body.reason : null, httpStatus: num(body.http_status) }
  }
  const asOf = day(body.as_of)
  const maturities = Array.isArray(body.maturities) ? body.maturities.map(maturityOf).filter(Boolean) : []
  if (status !== 'ok' || !asOf || !maturities.some((m) => m.yield != null)) return { state: 'failed' }
  const labels = Object.fromEntries(maturities.map((m) => [m.key, m.label]))
  const check = checkOf(body.check)
  return {
    state: 'ok',
    asOf,
    refDates: Object.fromEntries(HORIZON_KEYS.map((h) => [h, isObj(body.ref_dates) ? day(body.ref_dates[h]) : null])),
    readAt: typeof body.read_at === 'string' ? body.read_at : null,
    maturities,
    spreads: (Array.isArray(body.spreads) ? body.spreads : []).map((s) => spreadOf(s, labels)).filter(Boolean),
    history: historyOf(body.history),
    check,
    real: realRead(body.real),
  }
}

// ── words ──────────────────────────────────────────────────────────────────────────────────

const fixed = (v, decimals) => Math.abs(v).toFixed(decimals)
const count = (n) => Math.round(n).toLocaleString('en-US')

/** Pure: a yield as it is quoted ("4.12%"), or "No figure". */
export const yieldText = (v) => (num(v) == null ? 'No figure' : `${v < 0 ? '-' : ''}${fixed(v, 2)}%`)

/** Pure: a change in basis points with its sign ("+7", "-18", "0"; one decimal only when it has one),
 *  or "n/a" when there is no figure to measure against. No color: a rising yield is not good or bad. */
export function bpText(v) {
  if (num(v) == null) return 'n/a'
  const r = Math.round(v * 10) / 10
  if (r === 0) return '0'
  const body = Number.isInteger(r) ? String(Math.abs(r)) : fixed(r, 1)
  return `${r > 0 ? '+' : '-'}${body}`
}

/** Pure: a spread in percentage points with its sign ("+0.42", "-0.18"), or "No figure". */
export const pointsText = (v) => (num(v) == null ? 'No figure' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${fixed(v, 2)}`)

/** Pure: how long a spread has been in its state ("for 64 trading days", "for at least 1,317 trading days"), or ''. */
export function runText(s) {
  if (s?.days == null) return ''
  return `for ${s.atLeast ? 'at least ' : ''}${count(s.days)} trading ${s.days === 1 ? 'day' : 'days'}`
}

/** Pure: one spread as a trader would say it. */
export function spreadSentence(s, asOf = null) {
  if (s?.value == null || !s.state) {
    return `The ${s?.long || 'longer'} against the ${s?.short || 'shorter'}: no figure${dayText(asOf) ? ` for ${dayText(asOf)}` : ''}, because one of the two yields is missing.`
  }
  const run = runText(s)
  const tail = run ? `, ${run}` : ''
  const since = s.since
    ? (s.atLeast ? ` (as far back as this screen reads, ${dayText(s.since)})` : ` (since ${dayText(s.since)})`)
    : ''
  if (s.state === 'flat') return `The ${s.long} and the ${s.short} yield the same: the curve is flat${tail}${since}.`
  const gap = fixed(s.value, 2)
  const unit = gap === '1.00' ? 'point' : 'points'
  return s.state === 'positive'
    ? `The ${s.long} is ${gap} ${unit} above the ${s.short}: the curve is positive${tail}${since}.`
    : `The ${s.long} is ${gap} ${unit} below the ${s.short}: the curve is inverted${tail}${since}.`
}

const steeper = (bp) => {
  const r = Math.round(bp * 10) / 10
  const n = Number.isInteger(r) ? String(Math.abs(r)) : fixed(r, 1)
  return r === 0 ? 'unchanged from' : `${n} bp ${r > 0 ? 'steeper' : 'flatter'} than`
}

/** Pure: which way a spread has moved over the week and the month ("It is 7 bp steeper than a week ago
 *  and 18 bp flatter than a month ago."), or '' when neither can be measured. Steeper = the spread rose. */
export function spreadTrendSentence(s) {
  const parts = ['w1', 'm1'].filter((h) => s?.changeBp?.[h] != null).map((h) => `${steeper(s.changeBp[h])} ${HORIZONS[h]}`)
  return parts.length ? `It is ${parts.join(' and ')}.` : ''
}

/** Pure: plain words for an `unavailable` answer. */
export function unavailableWords(reason, httpStatus) {
  if (reason === 'shape') return "Treasury yields are not available right now: the Treasury's website answered, but not with figures this screen can read."
  return `Treasury yields are not available right now: the Treasury's website refused the server's request${httpStatus ? ` (it answered ${httpStatus})` : ''}.`
}

/** Pure: the real yield block's date, basis and source, in one sentence that is always on screen. */
export function realAsOfSentence(real) {
  return `End-of-day real yields for ${dayText(real.asOf)}: what Treasury inflation-protected securities yield above inflation. Source: ${REAL_SOURCE}.`
}

/** Pure: the breakevens' own date and what they are, or why there are none. */
export function breakevenSentence(real) {
  if (!real.breakevenAsOf) {
    return 'No breakeven can be worked out: the two curves have no day in common in what the site holds.'
  }
  const own = real.breakevenAsOf === real.asOf ? '' : ', the newest day both curves have a figure'
  return `Breakevens are for ${dayText(real.breakevenAsOf)}${own}: the nominal yield minus the real yield at the same maturity, `
    + 'which is the inflation rate the bond market is pricing over that many years.'
}

/** Pure: plain words for a real yield block that has no figures to show. */
export function realMissingWords(real) {
  if (real?.state === 'computing') {
    return "Real yields are being read from the Treasury's website. This part fills in on its own."
  }
  if (real?.state === 'unavailable') {
    return real.reason === 'shape'
      ? "Real yields and breakevens are not available right now: the Treasury's website answered, but not with figures this screen can read. That is not the same as no figures."
      : `Real yields and breakevens are not available right now: the Treasury's website refused the server's request${real.httpStatus ? ` (it answered ${real.httpStatus})` : ''}. That is not the same as no figures.`
  }
  return 'Real yields and breakevens could not be read just now. That is not the same as no figures. The server tries again by itself.'
}

/** Pure: a look for newer real yields that did not go well, said above the last good ones (with their date). */
export function realCheckWords(check, asOf) {
  const what = check?.state !== 'unavailable'
    ? 'The last look for newer real yields did not get an answer.'
    : check.reason === 'shape'
      ? "The Treasury's website answered the last look for newer real yields, but not with figures this screen can read."
      : `The Treasury's website refused the last look for newer real yields${check.httpStatus ? ` (it answered ${check.httpStatus})` : ''}.`
  return `${what} These are the last real yields the site read, for ${dayText(asOf)}.`
}

// ── the two small pictures (geometry only; the panel draws them) ───────────────────────────────

const r1 = (v) => Math.round(v * 10) / 10

/** Pure: an SVG path through `points` ([{x, y} | null]); a null breaks the line, it is never bridged. */
export function pathThrough(points) {
  let d = ''
  let pen = false
  for (const p of points) {
    if (!p) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)} `
    pen = true
  }
  return d.trim()
}

/**
 * Pure: today's curve against a month and a year ago, laid out in a `w` x `h` box.
 * The maturities are evenly spaced (1-month to 30-year would otherwise crush the short end).
 *   series   [{ key: 'now' | 'm1' | 'y1', path, points: [{ x, y, v } | null], count }]
 *   min, max the yield range drawn (percent); ticks: [{ key, label, x }]
 * null when fewer than two maturities have a figure today.
 */
export function curveGeometry(view, { w = 320, h = 120, padX = 6, padY = 8 } = {}) {
  const ms = view?.maturities || []
  if (ms.filter((m) => m.yield != null).length < 2) return null
  const raw = { now: ms.map((m) => m.yield), m1: ms.map((m) => m.was.m1), y1: ms.map((m) => m.was.y1) }
  const all = Object.values(raw).flat().filter((v) => v != null)
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const x = (i) => padX + (i / (ms.length - 1)) * (w - 2 * padX)
  const y = (v) => padY + (1 - (v - min) / span) * (h - 2 * padY)
  const series = Object.entries(raw).map(([key, vals]) => {
    const points = vals.map((v, i) => (v == null ? null : { x: x(i), y: y(v), v }))
    return { key, points, path: pathThrough(points), count: points.filter(Boolean).length }
  })
  return { w, h, min, max, series, ticks: ms.map((m, i) => ({ key: m.key, label: m.key.toUpperCase(), x: r1(x(i)) })) }
}

/**
 * Pure: one spread's daily history laid out in a `w` x `h` box, with the zero line.
 *   path, zeroY (null when zero is outside the range drawn), first / last / low / high: { date, v }
 * null when fewer than two days have a figure.
 * `withZero: false` draws the line's own range (a level far from zero, like LIQ's net liquidity, would
 * otherwise be a flat line along the top); zero is then outside the range and zeroY is null.
 */
export function spreadGeometry(history, key = 's10y2y', { w = 320, h = 120, padX = 2, padY = 8, withZero = true } = {}) {
  const dates = history?.dates || []
  const vals = history?.[key] || []
  const have = dates.map((d, i) => ({ date: d, v: vals[i] })).filter((p) => p.date && p.v != null)
  if (have.length < 2) return null
  let low = have[0]
  let high = have[0]
  for (const p of have) {
    if (p.v < low.v) low = p
    if (p.v > high.v) high = p
  }
  // zero is always in the range, so "above or below zero" can be read off the picture
  const min = withZero ? Math.min(low.v, 0) : low.v
  const max = withZero ? Math.max(high.v, 0) : high.v
  const span = max - min || 1
  const n = dates.length
  const x = (i) => padX + (n > 1 ? i / (n - 1) : 0) * (w - 2 * padX)
  const y = (v) => padY + (1 - (v - min) / span) * (h - 2 * padY)
  const points = dates.map((d, i) => (d && vals[i] != null ? { x: x(i), y: y(vals[i]) } : null))
  return {
    w, h, min, max, path: pathThrough(points), zeroY: min <= 0 && max >= 0 ? r1(y(0)) : null, days: have.length,
    first: have[0], last: have[have.length - 1], low, high,
  }
}

/** Pure: the spread picture's numbers as a sentence (its accessible name, and the line under it). */
export function spreadHistoryWords(geo, label) {
  if (!geo) return ''
  return `${label}, daily, ${dayText(geo.first.date)} to ${dayText(geo.last.date)}: `
    + `low ${pointsText(geo.low.v)} on ${dayText(geo.low.date)}, high ${pointsText(geo.high.v)} on ${dayText(geo.high.date)}, `
    + `now ${pointsText(geo.last.v)}. In percentage points; below zero is inverted.`
}

/** Pure: the curve picture's accessible name: every maturity's yield today, shortest first. */
export function curveWords(view) {
  const parts = (view?.maturities || []).filter((m) => m.yield != null).map((m) => `${m.label} ${yieldText(m.yield)}`)
  return `Treasury yields by maturity on ${dayText(view?.asOf)}: ${parts.join(', ')}. `
    + 'Drawn against the curve a month ago and a year ago; the table holds the same numbers.'
}
