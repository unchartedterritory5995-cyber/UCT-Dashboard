// app/src/components/chart/engine/pineFinancial.js
//
// ─── ⭐⭐ TRACK 4 F1b — `request.financial` ON THE CHART'S OWN SYMBOL, AS UCT DATA (engine 95, e95) ─────────
//
// A Pine script's `request.financial(syminfo.tickerid, "<ID>", "<period>"[, gaps])` reads a company figure. UCT answers
// it from its own point-in-time fundamentals store (company filings, F1a: `GET /api/pine/financial/<symbol>`), NEVER
// from TradingView's figures, and a plot that reads it is NEVER graded MATCH (Studio ruling 2026-11-14: our
// fundamentals are UCT data, said so in the member's words). ⭐ e99 (coordinator ruling 2026-11-26): the supply places
// each value at its fiscal period end, as TradingView does (`api/services/pine_financial.py::placement_day`), and the
// note says the figure was published weeks later (the catalog's `financial.placement`, one authority).
//
// It rides E2's rails (`pineEvents.js`), so it is isolated exactly as an event read is:
//   * the PARSE rewrite (`pine.js::eventAsSecurity`, via `pineEvents.js::eventCallParts`) turns the call into
//     `request.security(<financial read>, timeframe.period, close)`: a string node marked `event`, venue `EVENT_VENUE`,
//     ticker `EV-F<id code>-<period letter><gaps>` (`financialCallParts`), one series per id, period and `gaps`;
//   * the STATIC refusals (`financialStaticRefusal`): an id or period UCT does not serve (each by its own name and
//     reason, from `pineDataCatalog.json`), another symbol, another currency, an argument not written as a constant;
//   * the PLACEMENT (`placeFinancial`): each figure steps on the first chart bar whose session close is at or after its
//     `knownFrom` (F1a: the first session whose close follows the filing's public instant). `gaps_off` carries it,
//     `gaps_on` reads it on that bar and `na` elsewhere. A bar where UCT does not know a current figure (before the
//     first filing that yields it, a filing that left it UNKNOWN, a figure past its `staleFrom`) is WITHHELD by name,
//     never `na`, never the older value carried: the series starts after the chart's LAST unknown bar, so both lanes
//     withhold every bar before it under `FINANCIAL_UNKNOWN_CODE` (the host per bar, the runtime lane by its depth).
//
// ⛔⛔ THE SYNTHETIC SPELLING IS NEVER A SYMBOL: only the rewrite's marked node carries `EVENT_VENUE`; `EV-F…` written by a
// script is refused by name, and a financial read is never handed to `/api/bars` (`otherSymbols.js::fetchableOtherSymbols`).
// Its supply is the chart's `FINANCIAL_KEY` entry (`financialSupply.js`), asked of F1a's door only.

import CATALOG from './pineDataCatalog.json'
import { isoDay, isoWeekDayOf, isoDayPlus, SERIES_UNKNOWN_BEFORE_FIRST, SERIES_EVENT_RECORD, FINANCIAL_UNKNOWN_CODE } from './ast/interpret'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'

export { FINANCIAL_UNKNOWN_CODE }
/** The chart's secondary-map key for its own symbol's financial figures (`useSecondarySources` → `financialSupply.js`). */
export const FINANCIAL_KEY = '@financial'
/** A financial read's ticker: `EV-F<id code>-<period letter><gaps>` (served shape) or `EV-F<id code>-X<why>` (refused by
 *  name: `S` another symbol, `C` another currency, `A` an argument not written as a constant, `P` a period not written as
 *  one of TradingView's). TICKER_SHAPE-safe (9 characters). */
export const FINANCIAL_TICKER = /^EV-F([A-Z]{2})-([QTYHD][01]|X[SCAP])$/
/** The id codes of an id UCT does not know, and of an id not written as a constant string. */
const UNKNOWN_ID = 'ZZ'
const UNREAD_ID = 'XX'
/** The chart timeframes a financial read is served on: a figure is dated by session, so never intraday. */
export const FINANCIAL_TIMEFRAMES = Object.freeze(['D', 'W', 'M'])

const FIN = (CATALOG && CATALOG.families && CATALOG.families.financial) || {}
const own = (o) => Object.entries(o || {}).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object')
/** id -> {code, unit, periods: {FQ: series}} (served) or {code, why} (refused by name). One authority: the catalog. */
const SERVED = Object.freeze(Object.fromEntries(own(FIN.fields)))
const REFUSED = Object.freeze(Object.fromEntries(own(FIN.fieldsRefused)))
const ID_BY_CODE = Object.freeze(Object.fromEntries([...own(FIN.fields), ...own(FIN.fieldsRefused)].map(([id, s]) => [s.code, id])))
const PERIODS = Object.freeze(Object.fromEntries(own(FIN.periods)))
const PERIOD_BY_LETTER = Object.freeze(Object.fromEntries(Object.entries(PERIODS).map(([p, s]) => [s.letter, p])))
const ARGS = Object.freeze(['symbol', 'financial_id', 'period', 'gaps', 'ignore_invalid_symbol', 'currency'])

/** What UCT serves, in the member's words: `TOTAL_REVENUE` (`FQ`, `TTM`, `FY`), … */
export function financialServedList() {
  return Object.entries(SERVED).map(([id, s]) => `\`${id}\` (${Object.keys(s.periods || {}).map((p) => `\`${p}\``).join(', ')})`)
    .join(', ')
}

// ─── the parse half ─────────────────────────────────────────────────────────────────────────────────────────

/** `0` / `1` for a `gaps` argument written as a constant, `null` when it cannot be read before the run. */
function gapsOf(v) {
  if (v === undefined) return 0
  if (!v) return null
  if (v.type === 'name') {
    if (v.name === 'barmerge.gaps_on') return 1
    if (v.name === 'barmerge.gaps_off' || v.name === 'na') return 0
    return null
  }
  if (v.type === 'number' && v.tok && (v.tok.value === 'true' || v.tok.value === 'false')) return v.tok.value === 'true' ? 1 : 0
  return null
}

function currencyIsIdentity(v) {
  if (v === undefined) return true
  return !!v && v.type === 'name' && ['na', 'currency.NONE', 'currency.USD', 'syminfo.currency'].includes(v.name)
}

const constString = (v) => (v && v.type === 'string' && typeof v.value === 'string' ? v.value.trim() : null)

/** ⭐ THE PARSE READING of a `request.financial` call: `{family: 'financial', ticker, symbol}`, or null for any other
 *  node. Nothing is resolved (a parse sees no bindings): an id, period or `gaps` not written as a constant is refused. */
export function financialCallParts(node) {
  if (!node || node.type !== 'call' || node.name !== 'request.financial') return null
  const args = node.args || []
  const slots = new Array(ARGS.length).fill(undefined)
  let k = 0
  let unread = args.length > ARGS.length
  for (const a of args) {
    if (!a) { unread = true; continue }
    const at = a.name ? ARGS.indexOf(a.name) : k++
    if (at < 0 || slots[at] !== undefined) { unread = true; continue }
    slots[at] = a.value
  }
  const [symbol, idNode, periodNode, gapsNode, , currencyNode] = slots
  const id = constString(idNode)
  let code = UNREAD_ID
  if (id !== null) code = (SERVED[id] || REFUSED[id]) ? (SERVED[id] || REFUSED[id]).code : UNKNOWN_ID
  const periodName = constString(periodNode)
  const period = periodName !== null && PERIODS[periodName] ? PERIODS[periodName].letter : null
  const gaps = gapsOf(gapsNode)
  let suffix
  if (unread || symbol === undefined || id === null || gaps === null) suffix = 'XA'
  else if (period === null) suffix = 'XP'
  else if (!currencyIsIdentity(currencyNode)) suffix = 'XC'
  else suffix = `${period}${gaps}`
  return { family: 'financial', ticker: `EV-F${code}-${suffix}`, symbol: symbol === undefined ? null : symbol }
}

// ─── the read ───────────────────────────────────────────────────────────────────────────────────────────────

const ZZ_WHY = () => `the financial id this \`request.financial\` reads is not one UCT serves; UCT serves ${financialServedList()} `
  + 'from company filings'
const XX_WHY = '`request.financial`\'s financial id is not written as a constant string, so which figure it reads cannot be '
  + 'known before the script runs'

/** `{code, family, field, period, series, unit, gaps, lookahead: null, why, refused}` for a financial ticker, or null. */
export function financialReadOf(ticker) {
  const m = FINANCIAL_TICKER.exec(String(ticker == null ? '' : ticker).trim().toUpperCase())
  if (!m) return null
  const code = m[1]
  const id = ID_BY_CODE[code] || null
  if (!id && code !== UNKNOWN_ID && code !== UNREAD_ID) return null
  const shaped = !m[2].startsWith('X')
  const period = shaped ? PERIOD_BY_LETTER[m[2][0]] || null : null
  if (shaped && !period) return null
  const served = id ? SERVED[id] : null
  const series = served && period ? (served.periods || {})[period] || null : null
  let refused = null
  if (code === UNKNOWN_ID) refused = ZZ_WHY()
  else if (code === UNREAD_ID) refused = XX_WHY
  else if (REFUSED[id]) refused = `\`${id}\` is not served: ${REFUSED[id].why}`
  else if (period && !series) {
    const why = PERIODS[period] && PERIODS[period].why
    refused = `\`${id}\` is served for ${Object.keys(served.periods || {}).map((p) => `\`${p}\``).join(' and ')} only`
      + `${why ? ` (\`${period}\`: ${why})` : ''}`
  }
  return { code: `F${code}`, family: 'financial', field: id, period, series, unit: served ? served.unit || null : null,
    value: null, float32: false, gaps: shaped ? m[2][1] === '1' : null, lookahead: null, why: shaped ? null : m[2][1],
    refused, periodRefused: !!(refused && served && period && !series) }
}
export const isFinancialTicker = (ticker) => financialReadOf(ticker) !== null

/** How a member reads a financial read in a sentence: `request.financial` (`TOTAL_REVENUE`, `FQ`, `barmerge.gaps_on`). */
export function financialLabel(ticker) {
  const r = financialReadOf(ticker)
  if (!r) return `\`${ticker}\``
  const parts = []
  if (r.field) parts.push(`\`${r.field}\``)
  if (r.period) parts.push(`\`${r.period}\``)
  if (r.gaps === true) parts.push('`barmerge.gaps_on`')
  return `\`request.financial\`${parts.length ? ` (${parts.join(', ')})` : ''}`
}

/** ⭐ THE STATIC REFUSAL of a financial read (its ticker alone, before any chart): `{code, reason}`, or null for a read
 *  the bind decides. `codes` is `otherSymbols.js::OTHER_SYMBOL_REFUSAL` (passed in: no import cycle). */
export function financialStaticRefusal(ticker, codes) {
  const r = financialReadOf(ticker)
  if (!r) return { code: codes.EVENT_SPELLING, reason: financialSpellingReason(ticker) }
  const tail = ', so what this indicator draws from it is not computed.'
  // an id not written as a constant is an argument the door cannot read; any other refused id is named first (it is
  // the most specific thing a member can change)
  if (r.code === `F${UNREAD_ID}`) return { code: codes.FINANCIAL_ARGUMENT, reason: `${r.refused}${tail}` }
  if (r.refused && !r.periodRefused) return { code: codes.FINANCIAL_FIELD, reason: `${r.refused}${tail}` }
  if (r.why === 'S') {
    return { code: codes.FINANCIAL_SYMBOL, reason: 'this `request.financial` reads another symbol\'s figures; UCT serves '
      + `\`request.financial\` for the chart's own symbol only (\`syminfo.tickerid\`)${tail}` }
  }
  if (r.why === 'C') {
    return { code: codes.FINANCIAL_CURRENCY, reason: 'this `request.financial` asks for its figures converted into another '
      + `currency; UCT serves them as filed, in US dollars${tail}` }
  }
  if (r.why === 'P') {
    return { code: codes.FINANCIAL_PERIOD, reason: 'the period this `request.financial` reads is not written as one of '
      + `\`FQ\`, \`FY\`, \`FH\`, \`TTM\` or \`D\` in a constant string, so which figure it reads cannot be known before the script runs${tail}` }
  }
  if (r.why === 'A') {
    return { code: codes.FINANCIAL_ARGUMENT, reason: 'a symbol or `gaps` argument of this `request.financial` is not written '
      + 'as a constant this door can read before the script runs (or the call has an argument it does not take), so '
      + `which bars it reads is not known${tail}` }
  }
  if (r.periodRefused) return { code: codes.FINANCIAL_PERIOD, reason: `${r.refused}${tail}` }
  return null
}

/** The sentence for a financial ticker a script WROTE as a symbol (never the rewrite's marked read). */
export function financialSpellingReason(ticker) {
  return `\`${String(ticker).trim().toUpperCase()}\` is the name UCT gives a financial read inside its engine, not a symbol; `
    + 'a script reads company figures with `request.financial`, so what this indicator draws from it is not computed.'
}

// ─── the placement ──────────────────────────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/
export function financialTimeframeCode(tf) {
  const s = String(tf == null ? '' : tf).trim().toUpperCase()
  if (s === 'D' || s === '1D') return 'D'
  if (s === 'W' || s === '1W') return 'W'
  if (s === 'M' || s === '1M') return 'M'
  return null
}

/** The first and last session of the calendar run `days` (Monday..Friday, or a month), by the exchange calendar; the
 *  first and last weekday when the calendar names no session in it. */
function sessionsIn(days) {
  let open = null
  let close = null
  let firstWeekday = null
  let lastWeekday = null
  for (const d of days) {
    if (!d) continue
    const [y, m, dd] = d.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, dd)).getUTCDay()
    if (dow >= 1 && dow <= 5) {
      if (firstWeekday === null) firstWeekday = d
      lastWeekday = d
    }
    if (isTradingDay(d)) {
      if (open === null) open = d
      close = d
    }
  }
  return { open: open || firstWeekday, close: close || lastWeekday }
}

function weekOf(day) {
  const monday = isoWeekDayOf(day, 1)
  return sessionsIn([0, 1, 2, 3, 4].map((k) => isoDayPlus(monday, k)))
}

function monthOf(day) {
  const first = `${day.slice(0, 7)}-01`
  const out = []
  for (let k = 0; k < 31; k += 1) {
    const d = isoDayPlus(first, k)
    if (!d || d.slice(0, 7) !== day.slice(0, 7)) break
    out.push(d)
  }
  return sessionsIn(out)
}

/** For each chart bar, the session its period opens on and closes on (ISO days), or null when a day cannot be read. */
export function financialBarSessions(bars, tfCode) {
  const out = []
  for (const b of Array.isArray(bars) ? bars : []) {
    const day = b && isoDay(b.t)
    if (!day) return null
    out.push(tfCode === 'W' ? weekOf(day) : tfCode === 'M' ? monthOf(day) : { open: day, close: day })
  }
  return out
}

function firstWhere(n, pick) {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pick(mid)) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * ⭐⭐ THE PLACED SERIES of one financial read on these chart bars: `{series, from, unknown}` (rows keyed by the chart
 * bars' own `t`, from the first bar after the chart's last UNKNOWN bar on), or `{why}` when a bar's day cannot be read.
 *   `field.points`  F1a's points, each `{knownFrom: 'YYYY-MM-DD', v: number|null, staleFrom: 'YYYY-MM-DD'|null}`.
 * A bar is UNKNOWN when no figure has landed yet, when the figure in force is a GAP (`v: null`, the store's "not
 * derivable from the newest filing"), or when its session close is on or after the figure's `staleFrom`. `unknown`
 * says why the newest unknown bar is unknown (`before` / `gap` / `stale`) and its day, for the member's sentence.
 */
export function placeFinancial(gaps, field, bars, tfCode) {
  const sessions = financialBarSessions(bars, tfCode)
  if (!sessions) return { why: 'a chart bar\'s date cannot be read' }
  const n = sessions.length
  const pts = (field && Array.isArray(field.points) ? field.points : [])
    .filter((p) => p && typeof p.knownFrom === 'string' && ISO.test(p.knownFrom))
  const landed = new Array(n).fill(-1)
  pts.forEach((p, k) => {
    const i = firstWhere(n, (j) => sessions[j].close >= p.knownFrom)
    if (i < n) landed[i] = k            // ascending: the newest figure landing on a bar is the one read there
  })
  const vals = new Array(n)
  let cur = -1
  let last = -1
  let unknown = null
  for (let i = 0; i < n; i += 1) {
    // a figure public before the chart's first bar is carried into it, but it did not step there (`gaps_on` reads `na`)
    const stepped = landed[i] >= 0 && (i > 0 || pts[landed[i]].knownFrom >= sessions[0].open)
    if (landed[i] >= 0) cur = landed[i]
    const p = cur >= 0 ? pts[cur] : null
    const known = !!p && typeof p.v === 'number' && Number.isFinite(p.v)
    let why = null
    // before the first figure, a filing could have stepped on any bar with a value UCT does not hold
    if (!p) why = 'before'
    // ⭐ gaps_on reads a figure on its own step bar only (`na` on every other, whatever is in force), so what is
    // unknown there is a GAP's own step bar; gaps_off carries, so a gap or a stale figure is unknown on every bar
    else if (gaps ? stepped && !known : !known) why = 'gap'
    else if (!gaps && typeof p.staleFrom === 'string' && ISO.test(p.staleFrom) && sessions[i].close >= p.staleFrom) why = 'stale'
    if (why) {
      last = i
      unknown = { why, day: isoDay(bars[i].t) }
      continue
    }
    vals[i] = gaps && !stepped ? NaN : p.v
  }
  const from = last + 1
  const series = []
  for (let i = from; i < n; i += 1) series.push({ t: bars[i].t, o: vals[i], h: vals[i], l: vals[i], c: vals[i], v: 0 })
  return { series, from, unknown }
}

/** Mark a placed financial series as E2 marks an event series: a bar before its first row is unknown (withheld by
 *  name), and the record it was placed from (`SERIES_EVENT_RECORD`, family `financial`). */
export function markFinancialSeries(series, record) {
  Object.defineProperty(series, SERIES_UNKNOWN_BEFORE_FIRST, { value: true, enumerable: false })
  Object.defineProperty(series, SERIES_EVENT_RECORD, { value: Object.freeze({ ...record, family: 'financial' }), enumerable: false })
  return series
}

/** ⭐ The per-bar words for a bar a financial read withholds (`FINANCIAL_UNKNOWN_CODE`). */
export function financialUnknownSentence({ symbol, field, period, from, unknown }) {
  const what = `${symbol ? `${symbol}'s ` : ''}\`${field || 'financial figure'}\`${period ? ` (\`${period}\`)` : ''}`
  const at = from ? `Not drawn before ${from}` : 'Not drawn'
  const why = unknown && unknown.why
  if (why === 'gap') {
    return `${at}: on ${unknown.day} UCT did not know a current figure for ${what} (the newest company filing did not yield `
      + 'it), so what this read carries across that bar is not known here.'
  }
  if (why === 'stale') {
    return `${at}: on ${unknown.day} the latest figure UCT held for ${what} described a fiscal period too old to be current `
      + '(no newer company filing yielded it), so it is not carried there.'
  }
  return `${at}: UCT's figures for ${what} come from company filings, and none covers a fiscal period that ended before `
    + 'then, so what it read on earlier bars is not known here.'
}

/** The disclosure a plot that reads `request.financial` carries (the member's words; never graded as TradingView's). */
export const FINANCIAL_DATA_WORDS = 'UCT data (company filings)'
/** ⭐ e99 — where a value is placed, in the member's words (the catalog's `financial.placement`, one authority with the
 *  route's disclosure). */
export const FINANCIAL_PLACEMENT_WORDS = String(FIN.placement || '')
export const FINANCIAL_SOURCE_NOTE = 'This script reads `request.financial`. It uses UCT data (company filings), not '
  + `TradingView's figures: each value is ${FINANCIAL_PLACEMENT_WORDS}, and its figures can differ from TradingView's.`
/** ⭐ e99 FY — THE NAMED LIMITATION of a fiscal-year read (the catalog's `periods.FY.limitation`, the one authority the
 *  route serves too): the fiscal year is read from the store's published series (the V5 methodology is frozen), so a
 *  restatement filed after the next quarterly report is not shown until the following 10-K. The note of a script that
 *  reads any `FY` figure says so; a script that reads none keeps the plain note. */
export const FINANCIAL_FY_LIMITATION = String((PERIODS.FY && PERIODS.FY.limitation) || '')
export const FINANCIAL_FY_SOURCE_NOTE = `${FINANCIAL_SOURCE_NOTE} For a fiscal-year (\`FY\`) figure, ${FINANCIAL_FY_LIMITATION}.`
