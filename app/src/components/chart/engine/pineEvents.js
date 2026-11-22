// app/src/components/chart/engine/pineEvents.js
//
// ─── ⭐⭐ TRACK 4 E2 — `request.earnings` / `request.dividends` / `request.splits` ON THE CHART'S OWN SYMBOL ─────
//
// ONE MODULE OWNS WHAT AN EVENT READ IS, for both lanes:
//   * the PARSE rewrite (`pine.js::eventAsSecurity`, which both lanes parse with) turns each call into the
//     other-symbol read `request.security(<event read>, timeframe.period, close)`. The event read is a string node
//     marked `event` (only the rewrite makes one), so the translator's `otherSymbolOf` names it with the venue
//     `EVENT_VENUE` and a ticker `EV-<field>-<pairing>` (`eventTickerOf`): one series per field and per
//     gaps x lookahead pairing, because the pairing is the series' placement, not an argument a sym read carries;
//   * the STATIC refusals (`eventStaticRefusal`): a field UCT does not hold, another symbol, another currency, an
//     argument the door cannot read before the run. Asked by the one gate both lanes ask
//     (`otherSymbols.js::staticallyUnservable`), so a plot that reads one is refused by name on both lanes;
//   * the PLACEMENT (`eventSeriesOf`): the chart's own events (E1, `GET /api/pine/events/<symbol>`, the chart's
//     `EVENTS_KEY` entry) placed on the CHART'S bars as TradingView places them (E0, the s4-closed-retake captures,
//     docs/pine/evidence/2026-11-22-t4-e0-event-placement/EVIDENCE.md):
//       - an event is stamped at its date's session close; `lookahead_on` reads it on the first bar CLOSING at or
//         after that instant (the event's own bar), `lookahead_off` on the first bar OPENING after it (the next
//         session on D, the next week on W). An event dated on a non-session day lands both reads on the next one.
//       - `gaps_on`: the value on that bar, `na` on every other; `gaps_off`: carried from that bar, `na` before the
//         first carried value.
//     The series is DENSE from the first chart bar of our record (`knownFrom`, coordinator ruling 2026-11-22 (1):
//     our coverage start, not the first event) and marked `SERIES_UNKNOWN_BEFORE_FIRST`, so a bar before our
//     record is WITHHELD (the host mask; the run's depth cut), never read as `na`, while a bar after it with no
//     event reads `na` exactly as TradingView prints it.
//
// ⛔⛔ THE SYNTHETIC SPELLING IS NEVER A SYMBOL (coordinator ruling 2026-11-22 (2)). Only the rewrite's marked node
// carries `EVENT_VENUE`; a script that WRITES an event ticker as a string (`"EV-EA-11"`) is refused by name
// (`OTHER_SYMBOL_REFUSAL.EVENT_SPELLING`, `eventSpellingRefusal`) before any fetch, and an event read is never
// handed to `/api/bars`, the exchange lookup or a symbol input (`otherSymbols.js::fetchableOtherSymbols`).

import { isoDay, isoWeekDayOf, isoDayPlus, SERIES_UNKNOWN_BEFORE_FIRST, SERIES_EVENT_RECORD, EVENT_BEFORE_RECORD_CODE } from './ast/interpret'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'
// ⭐⭐ T4 F1b — `request.financial` rides these rails (its own module owns what a financial read is)
import { financialCallParts, financialReadOf, financialLabel, financialStaticRefusal, financialSpellingReason,
  financialUnknownSentence, FINANCIAL_TICKER } from './pineFinancial.js'

/** The venue the rewrite's marked node records (`pine.js::OTHER_SYMBOL_SINK`). A member's string can never spell a
 *  venue that begins with `@` (`pineSymbolSpelling` reads letters only), so only the rewrite reaches it. */
export const EVENT_VENUE = '@event'
/** The chart's secondary-map key for its own symbol's events (`useSecondarySources` → `eventSupply.js`). */
export const EVENTS_KEY = '@events'
/** The event ticker: `EV-<field code>-<gaps><lookahead>` (served pairings) or `EV-<field code>-X<why>` (refused by
 *  name: `S` another symbol, `C` another currency, `A` an argument the door cannot read). TICKER_SHAPE-safe (≤ 10). */
const EVENT_ONLY_TICKER = /^EV-([EDS][A-Z])-([01][01]|X[SCA])$/
/** ⭐ T4 F1b — and a financial read's (`pineFinancial.js::FINANCIAL_TICKER`, `EV-F<id>-<period><gaps>`): every name the
 *  engine gives a data read, so a script that spells one is refused by name and none is ever fetched as a symbol. */
export const EVENT_TICKER = /^EV-(?:[EDS][A-Z]-(?:[01][01]|X[SCA])|F[A-Z]{2}-(?:[QTYHD][01]|X[SCAP]))$/
/** The non-enumerable record on a placed event series (`interpret.js` owns the key: its per-bar mask reads it). */
export { SERIES_EVENT_RECORD, EVENT_BEFORE_RECORD_CODE }

const CALLS = Object.freeze({ 'request.earnings': 'earnings', 'request.dividends': 'dividends', 'request.splits': 'splits' })
const ARGS = Object.freeze(['ticker', 'field', 'gaps', 'lookahead', 'ignore_invalid_symbol', 'currency'])
const FAMILY_LETTER = Object.freeze({ earnings: 'E', dividends: 'D', splits: 'S' })

const STANDARDIZED_WHY = '`earnings.standardized` is TradingView\'s standardized earnings series, a different series '
  + 'from each report\'s figure; UCT does not hold it (it holds each report\'s actual and estimated EPS, '
  + '`earnings.actual` and `earnings.estimate`)'
const NET_WHY = '`dividends.net` is TradingView\'s split-adjusted dividend series, shown only for dividends before a '
  + 'symbol\'s latest split; UCT does not hold it (it holds each dividend as declared, `dividends.gross`)'
const UNREAD_FIELD_WHY = (family) => `the field this \`request.${family}\` reads is not one of its named fields `
  + 'written as a constant, so which series it reads cannot be known before the script runs'

/** Every field code: its family, the Pine field it reads, and the value it reads from a held event (or why not). */
export const EVENT_FIELDS = Object.freeze({
  EA: Object.freeze({ family: 'earnings', field: 'earnings.actual', value: 'actual' }),
  EE: Object.freeze({ family: 'earnings', field: 'earnings.estimate', value: 'estimate' }),
  ES: Object.freeze({ family: 'earnings', field: 'earnings.standardized', refused: STANDARDIZED_WHY }),
  EX: Object.freeze({ family: 'earnings', field: null, refused: UNREAD_FIELD_WHY('earnings') }),
  DG: Object.freeze({ family: 'dividends', field: 'dividends.gross', value: 'gross', float32: true }),
  DN: Object.freeze({ family: 'dividends', field: 'dividends.net', refused: NET_WHY }),
  DX: Object.freeze({ family: 'dividends', field: null, refused: UNREAD_FIELD_WHY('dividends') }),
  SN: Object.freeze({ family: 'splits', field: 'splits.numerator', value: 'numerator' }),
  SD: Object.freeze({ family: 'splits', field: 'splits.denominator', value: 'denominator' }),
  SX: Object.freeze({ family: 'splits', field: null, refused: UNREAD_FIELD_WHY('splits') }),
})
const FIELD_CODE = Object.freeze(Object.fromEntries(Object.entries(EVENT_FIELDS)
  .filter(([, f]) => f.field).map(([code, f]) => [f.field, code])))
/** Pine's default field per call (the reference: `earnings.actual`, `dividends.gross`, `splits.denominator`). */
const DEFAULT_FIELD = Object.freeze({ earnings: 'EA', dividends: 'DG', splits: 'SD' })
/** The date key of a family's held rows (E1's document, `api/services/pine_events.py::DATE_KEY`). */
const DATE_KEY = Object.freeze({ earnings: 'date', dividends: 'exDate', splits: 'date' })
export const EVENT_DATE_KEY = DATE_KEY

// ─── the parse half ─────────────────────────────────────────────────────────────────────────────────────────

/** `0` / `1` for a `gaps` / `lookahead` argument written as a constant, `null` when the door cannot read it. */
function flagOf(v, on, off) {
  if (v === undefined) return 0
  if (!v) return null
  if (v.type === 'name') {
    if (v.name === on) return 1
    if (v.name === off || v.name === 'na') return 0
    return null
  }
  if (v.type === 'number' && v.tok && (v.tok.value === 'true' || v.tok.value === 'false')) return v.tok.value === 'true' ? 1 : 0
  return null
}

/** A `currency` argument that is the identity here (every event UCT holds is a US listing's, in US dollars). */
function currencyIsIdentity(v) {
  if (v === undefined) return true
  return !!v && v.type === 'name' && ['na', 'currency.NONE', 'currency.USD', 'syminfo.currency'].includes(v.name)
}

/**
 * ⭐ THE PARSE READING of an event call: `{family, ticker, symbol}` (the event ticker this call reads, and its symbol
 * argument for the translator to check: only the chart's own is served), or null for a call that is not one.
 * Nothing is resolved here (a parse sees no bindings): a field, `gaps` or `lookahead` that is not written as a
 * constant reads `EV-<F>X-XA`, refused by name.
 */
export function eventCallParts(node) {
  // ⭐⭐ T4 F1b — `request.financial` (`pineFinancial.js::financialCallParts`)
  if (node && node.type === 'call' && node.name === 'request.financial') return financialCallParts(node)
  if (!node || node.type !== 'call' || !Object.prototype.hasOwnProperty.call(CALLS, node.name)) return null
  const family = CALLS[node.name]
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
  const [symbol, fieldNode, gapsNode, lookNode, , currencyNode] = slots
  let code = DEFAULT_FIELD[family]
  if (fieldNode !== undefined) {
    const named = fieldNode && fieldNode.type === 'name' ? FIELD_CODE[fieldNode.name] : null
    code = named && EVENT_FIELDS[named].family === family ? named : `${FAMILY_LETTER[family]}X`
  }
  const gaps = flagOf(gapsNode, 'barmerge.gaps_on', 'barmerge.gaps_off')
  const look = flagOf(lookNode, 'barmerge.lookahead_on', 'barmerge.lookahead_off')
  let suffix = `${gaps}${look}`
  if (unread || symbol === undefined || gaps === null || look === null) suffix = 'XA'
  else if (!currencyIsIdentity(currencyNode)) suffix = 'XC'
  return { family, ticker: `EV-${code}-${suffix}`, symbol: symbol === undefined ? null : symbol }
}

/** The ticker a read of ANOTHER symbol's events records (the translator decides that, `pine.js::otherSymbolOf`). */
export function eventOtherSymbolTicker(ticker) {
  const f = FINANCIAL_TICKER.exec(String(ticker || ''))
  if (f) return !f[2].startsWith('X') ? `EV-F${f[1]}-XS` : ticker
  const m = EVENT_ONLY_TICKER.exec(String(ticker || ''))
  return m && !m[2].startsWith('X') ? `EV-${m[1]}-XS` : ticker
}

// ─── the read ───────────────────────────────────────────────────────────────────────────────────────────────

/** `{code, family, field, gaps, lookahead, refused}` for an event ticker, or null. */
export function eventReadOf(ticker) {
  // ⭐⭐ T4 F1b — a financial read (`family: 'financial'`, its `field` the id, its `period`, `lookahead: null`)
  const fin = financialReadOf(ticker)
  if (fin) return fin
  const m = EVENT_ONLY_TICKER.exec(String(ticker == null ? '' : ticker).trim().toUpperCase())
  if (!m || !EVENT_FIELDS[m[1]]) return null
  const f = EVENT_FIELDS[m[1]]
  const pair = m[2].startsWith('X') ? null : m[2]
  return { code: m[1], family: f.family, field: f.field, value: f.value || null, float32: f.float32 === true,
    gaps: pair ? pair[0] === '1' : null, lookahead: pair ? pair[1] === '1' : null, why: pair ? null : m[2][1],
    refused: f.refused || null }
}
export const isEventTicker = (ticker) => eventReadOf(ticker) !== null

/** How a member reads an event read in a sentence: `request.earnings` (`earnings.actual`, gaps on, lookahead off). */
export function eventLabel(ticker) {
  if (financialReadOf(ticker)) return financialLabel(ticker)
  const r = eventReadOf(ticker)
  if (!r) return `\`${ticker}\``
  const parts = []
  if (r.field) parts.push(`\`${r.field}\``)
  if (r.gaps !== null) parts.push(r.gaps ? '`barmerge.gaps_on`' : '`barmerge.gaps_off`')
  if (r.lookahead !== null) parts.push(r.lookahead ? '`barmerge.lookahead_on`' : '`barmerge.lookahead_off`')
  return `\`request.${r.family}\`${parts.length ? ` (${parts.join(', ')})` : ''}`
}

/** ⭐ THE STATIC REFUSAL of an event read (decided by its ticker alone, before any chart): `{code, reason}`, or null
 *  for a read the bind decides. `codes` is `otherSymbols.js::OTHER_SYMBOL_REFUSAL` (passed in: no import cycle). */
export function eventStaticRefusal(ticker, codes) {
  // ⭐⭐ T4 F1b — a financial read is refused by its own codes and words
  if (FINANCIAL_TICKER.test(String(ticker || '').trim().toUpperCase())) return financialStaticRefusal(ticker, codes)
  const r = eventReadOf(ticker)
  if (!r) return { code: codes.EVENT_SPELLING, reason: eventSpellingReason(ticker) }
  if (r.refused) return { code: r.field ? codes.EVENT_FIELD : codes.EVENT_ARGUMENT, reason: `${r.refused}, so what this indicator draws from it is not computed.` }
  if (r.why === 'S') {
    return { code: codes.EVENT_SYMBOL, reason: `this \`request.${r.family}\` reads another symbol's ${r.family}; UCT serves `
      + `\`request.${r.family}\` for the chart's own symbol only (\`syminfo.tickerid\`), so what this indicator draws `
      + 'from it is not computed.' }
  }
  if (r.why === 'C') {
    return { code: codes.EVENT_CURRENCY, reason: `this \`request.${r.family}\` asks for its values converted into another `
      + 'currency; UCT serves them in US dollars, as declared, so what this indicator draws from it is not computed.' }
  }
  if (r.why === 'A') {
    return { code: codes.EVENT_ARGUMENT, reason: `a \`gaps\`, \`lookahead\` or symbol argument of this \`request.${r.family}\` `
      + 'is not written as a constant this door can read before the script runs (or the call has an argument it does '
      + 'not take), so which bars it reads is not known and what this indicator draws from it is not computed.' }
  }
  return null
}

/** The sentence for an event ticker a script WROTE as a symbol string (never the rewrite's marked read). */
export function eventSpellingReason(ticker) {
  if (FINANCIAL_TICKER.test(String(ticker || '').trim().toUpperCase())) return financialSpellingReason(ticker)
  return `\`${String(ticker).trim().toUpperCase()}\` is the name UCT gives a corporate-events read inside its engine, `
    + 'not a symbol; a script reads earnings, dividends and splits with `request.earnings`, `request.dividends` and '
    + '`request.splits`, so what this indicator draws from it is not computed.'
}

// ─── the placement ──────────────────────────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/
const isDailyTf = (tf) => tf === 'D' || tf === '1D'
const isWeeklyTf = (tf) => tf === 'W' || tf === '1W'
/** The chart timeframes an event read is witnessed on (E0: D and W; monthly waits on W-E2, intraday on a report's
 *  time of day, which UCT does not hold). */
export const EVENT_TIMEFRAMES = Object.freeze(['D', 'W'])
export function eventTimeframeCode(tf) {
  const s = String(tf == null ? '' : tf).trim().toUpperCase()
  if (isDailyTf(s)) return 'D'
  if (isWeeklyTf(s)) return 'W'
  return null
}

/** The first and last session of a weekly bar's ISO week (Monday..Friday by the exchange calendar; Monday / Friday
 *  when the calendar names no session in it). */
function weekSessionsOf(day) {
  const monday = isoWeekDayOf(day, 1)
  let open = null
  let close = null
  for (let k = 0; k < 5; k += 1) {
    const d = isoDayPlus(monday, k)
    if (d && isTradingDay(d)) {
      if (open === null) open = d
      close = d
    }
  }
  return { open: open || monday, close: close || isoDayPlus(monday, 4) }
}

/** For each chart bar, the session its period opens on and the session it closes on (ISO days), or null when a bar's
 *  day cannot be read (the read is then not placed: refused by the caller, never guessed). */
export function chartBarSessions(bars, tfCode) {
  const out = []
  for (const b of Array.isArray(bars) ? bars : []) {
    const day = b && isoDay(b.t)
    if (!day) return null
    out.push(tfCode === 'W' ? weekSessionsOf(day) : { open: day, close: day })
  }
  return out
}

/** The first index whose `pick(i)` is true over an ascending predicate, or `n`. */
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
 * ⭐⭐ THE PLACED SERIES of one event read on these chart bars: `{series, from}` (rows keyed by the chart bars' own
 * `t`, from the first bar of our record on), or `{why}` when the bars cannot be placed (a day not readable).
 *   `rows`      the family's held events (E1), each `{[dateKey]: 'YYYY-MM-DD', [value]: number}`;
 *   `knownFrom` our record's first day (E1's `knownFrom`): a chart bar whose period closes before it is unknown.
 */
export function placeEvents({ family, value, float32 }, gaps, lookahead, rows, knownFrom, bars, tfCode,
  { coverageStart = false } = {}) {
  const sessions = chartBarSessions(bars, tfCode)
  if (!sessions) return { why: 'a chart bar\'s date cannot be read' }
  const n = sessions.length
  const landed = new Array(n).fill(undefined)
  const key = DATE_KEY[family]
  const held = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r[key] === 'string' && ISO.test(r[key].slice(0, 10)))
    .map((r) => ({ day: r[key].slice(0, 10), v: r[value] }))
    // ⛔ an event dated before our record's first day is not part of it: never landed, never carried
    .filter((e) => !(typeof knownFrom === 'string' && e.day < knownFrom))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  for (const e of held) {
    // lookahead_on: the first bar CLOSING at or after the event's session close (its own session, or for a date
    // that is not a session, the next); lookahead_off: the first bar OPENING after it
    const i = lookahead ? firstWhere(n, (j) => sessions[j].close >= e.day) : firstWhere(n, (j) => sessions[j].open > e.day)
    if (i >= n) continue
    const num = typeof e.v === 'number' && Number.isFinite(e.v) ? (float32 ? Math.fround(e.v) : e.v) : NaN
    landed[i] = num                      // ascending dates: the newest event on a bar is the one read there
  }
  const known = typeof knownFrom === 'string' && ISO.test(knownFrom)
  let from = n
  if (known && coverageStart) {
    // ⭐ A COVERAGE START (ruling (1)): nothing happened before `knownFrom`, so from its bar on a bar with no event is `na`
    from = firstWhere(n, (j) => sessions[j].close >= knownFrom)
  } else if (known) {
    // ⭐⭐ OUR RECORD IS NOT THE INSTRUMENT'S (E1's `knownFrom` is our first held event; the earnings window is a cut): an
    // event dated before it may exist, and TradingView reads it where it lands. MEASURED (the E0 dividend and split probes
    // against production's E1, 2026-11-22): under `gaps_off` / `lookahead_off` the bar of our first event's date carries
    // the event before it on TradingView (AAPL 0.12, JPM 0.34, NVDA's 2001 split), never `na`. So a bar is known only where
    // every event that can land on it is dated on or after `knownFrom`: `lookahead_on` the day after the previous bar's
    // close, `lookahead_off` the previous bar's open (E0's R1); or where our own event lands (the newest on its bar is ours)
    const firstLand = landed.findIndex((v) => v !== undefined)
    const fresh = firstWhere(n, (j) => j > 0 && (lookahead ? isoDayPlus(sessions[j - 1].close, 1) >= knownFrom
      : sessions[j - 1].open >= knownFrom))
    from = Math.min(fresh, firstLand < 0 ? n : firstLand)
    // ⛔ and under `gaps_off` a carried value is ours only from our first event's bar on (before it, an older one)
    if (!gaps) from = firstLand < 0 ? n : firstLand
  }
  const series = []
  let carried = NaN
  for (let i = 0; i < n; i += 1) {
    if (landed[i] !== undefined) carried = landed[i]
    if (i < from) continue
    const v = landed[i] !== undefined ? landed[i] : (gaps ? NaN : carried)
    series.push({ t: bars[i].t, o: v, h: v, l: v, c: v, v: 0 })
  }
  return { series, from }
}

/** Mark a placed series: a bar before its first row is unknown (withheld by name), and what record it came from. */
export function markEventSeries(series, record) {
  Object.defineProperty(series, SERIES_UNKNOWN_BEFORE_FIRST, { value: true, enumerable: false })
  Object.defineProperty(series, SERIES_EVENT_RECORD, { value: Object.freeze({ ...record }), enumerable: false })
  return series
}

/** ⭐ The per-bar words for a bar before our record (`OTHER_SYMBOL_REFUSAL.EVENT_BEFORE_RECORD`): `from` is the first
 *  bar drawn (its day), `window` the earnings window's cut where it decided that (`EARNINGS_WINDOW_FROM`). */
export function eventBeforeRecordSentence(record) {
  // ⭐⭐ T4 F1b — a financial read's withheld bars, in its own words
  if (record && record.family === 'financial') return financialUnknownSentence(record)
  const { family, symbol, knownFrom, from, window } = record || {}
  const what = family === 'earnings' ? 'earnings reports' : family
  const at = from || knownFrom || 'the first event UCT holds'
  if (window) {
    return `Not drawn before ${at}: UCT draws ${symbol ? `${symbol}'s ` : ''}earnings from ${window} on, where TradingView's `
      + 'earnings history begins, so whether an earlier report landed on those bars, or carries into them, is not known here.'
  }
  return `Not drawn before ${at}: UCT's record of ${symbol ? `${symbol}'s ` : ''}`
    + `${what} starts there, so whether an earlier one landed on those bars is not known here.`
}

// ─── the earnings window (coordinator ruling 2026-11-22, E2 rulings 1-2) ─────────────────────────────────────
//
// ⭐⭐ TRADINGVIEW'S EARNINGS HISTORY BEGINS AROUND 2001, AND UCT'S RECORD GOES BACK TO 1985: an event UCT holds before
// TradingView's first is drawn where TradingView draws `na`, a wrong line (an anchored VWAP restarting on a report
// TradingView does not show). Witnessed TradingView first events (the s4-closed-retake-2026-11-20 probe captures, against
// production's E1 answer, 2026-11-22): NASDAQ:AAPL 2001-07-17, NYSE:JPM 2001-07-18, NASDAQ:NVDA 2001-08-14,
// NASDAQ:MU 2000-01-14. UCT holds 61 / 61 / 7 / 62 reports before 2001 (quarterly back to 1985) and two each in the first
// half of 2001 that TradingView does not show. So earnings are drawn from the cut below on: knownFrom = max(our first
// held report, the cut); a bar before it is WITHHELD by name (never `na`, never a report TradingView does not draw), and
// under `gaps_off` so is every bar from the cut to the first report after it (a cut is not a coverage start).
// ⛔ RE-DERIVE when the W-E3 coverage captures land (KO, COST, TSM, META, RDDT, CASS): a TradingView first event AFTER
// the cut is reported to the coordinator before this moves.
export const EARNINGS_WINDOW_FROM = '2001-09-01'

