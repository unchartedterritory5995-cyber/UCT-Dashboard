// MKTH's pure half: the market history answer -> what the panel draws. No React, so an agent
// capability can reuse it.
//
// ONE read, `GET /api/research/market-history` (paid; api/services/market_history.py). The server
// works every number out from its own stored closes once each evening and holds the answer; this file
// only reads it and puts it into words. Per index (the S&P 500 and the Nasdaq-100) the answer lists
// every decline of 10% or more on closing prices, newest first, each with its peak, its low, the
// sessions between, the day the peak was regained (or none yet), the index return 1, 3, 6 and 12
// months after the low, and the stocks that rose most in the 63 sessions after the low.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a rally window the store has not reached is "not yet", a leaders
// list too recent or too thin says why in words.
// ⛔ NOT A FORECAST: a record of what happened; green and red mark the sign of a return only.
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayText } from './ratesModel'

export const MKTH_CODE = 'MKTH'
export const MKTH_URL = '/api/research/market-history'
/** The thing read, as a failed read names it ("Market history could not be read just now."). */
export const MKTH_WHAT = 'Market history'
export const MKTH_SOURCE = "UCT's stored daily closes"
/** The answer changes once each evening; while the server is still working it out, ask again soon. */
export const HELD_POLL_MS = 30 * 60 * 1000
export const COMPUTING_POLL_MS = 4000

/** The two indexes, in the order the switch offers them. `key` is the server's symbol. */
export const MKTH_INDEXES = Object.freeze([
  Object.freeze({ key: 'SPX', label: 'S&P 500' }),
  Object.freeze({ key: 'NDX', label: 'Nasdaq-100' }),
])
export const MKTH_DEFAULT_INDEX = 'SPX'
/** The words `MKTH <word>` takes (args.js keeps a pinned copy). */
export const MKTH_INDEX_WORDS = Object.freeze({
  SPX: 'SPX', SP500: 'SPX', SPY: 'SPX',
  NDX: 'NDX', NASDAQ: 'NDX', NAS100: 'NDX', QQQ: 'NDX',
})
/** The rally windows the server measures, in calendar months. */
export const RALLY_MONTHS = Object.freeze([1, 3, 6, 12])
/** The leaders window, in index sessions after the low. */
export const LEADER_SESSIONS = 63
/** The sentence every leaders list carries, word for word (the server sends the same). */
export const SURVIVORSHIP_NOTE = "From stocks that trade today: companies later delisted or acquired are not in UCT's price history, so this list can leave out some of that rally's leaders."
/** What the mark beside a leader means. */
export const CHECK_NOTE = 'A stock marked "check the chart" moved more than 40% in one session inside the window, which can be a split the history did not adjust.'

/** `NDX` -> 'NDX' when it names an index, else null. */
export function parseMkthIndex(tok) {
  const key = String(tok ?? '').trim().toUpperCase()
  return Object.prototype.hasOwnProperty.call(MKTH_INDEX_WORDS, key) ? MKTH_INDEX_WORDS[key] : null
}

export const normMkthIndex = (v) => parseMkthIndex(v) ?? MKTH_DEFAULT_INDEX

/** The tokens after the code for this pick (`[]` for the default, the S&P 500). */
export function mkthCommandArgs({ index } = {}) {
  const k = normMkthIndex(index)
  return k === MKTH_DEFAULT_INDEX ? [] : [k]
}

export const indexLabel = (key) => MKTH_INDEXES.find((i) => i.key === key)?.label || key

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoDay = (v) => (typeof v === 'string' && ISO_DAY.test(v) ? v : null)
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null)

function readPoint(raw) {
  return isObj(raw) && isoDay(raw.date) ? { date: raw.date, close: finite(raw.close) } : null
}

/** `mode`: the answer's whole-leaders state when an episode carries none ('computing' | 'failed'). */
function readLeaders(raw, mode) {
  if (!isObj(raw)) return { state: mode === 'computing' || mode === 'failed' ? mode : 'missing', note: SURVIVORSHIP_NOTE }
  const state = ['ok', 'thin', 'not_yet'].includes(raw.state) ? raw.state : 'missing'
  return {
    state,
    trough: isoDay(raw.trough),
    end: isoDay(raw.end),
    pricedAtTrough: count(raw.priced_at_trough),
    pricedBoth: count(raw.priced_both),
    indexReturnPct: finite(raw.index_return_pct),
    sessionsSoFar: count(raw.sessions_so_far),
    needed: count(raw.needed) ?? LEADER_SESSIONS,
    top: (Array.isArray(raw.top) ? raw.top : [])
      .filter((r) => isObj(r) && typeof r.sym === 'string' && r.sym)
      .map((r) => ({
        sym: r.sym, sector: typeof r.sector === 'string' && r.sector ? r.sector : null,
        returnPct: finite(r.return_pct), vsIndexPct: finite(r.vs_index_pct), check: r.check === true,
      })),
    sectors: (Array.isArray(raw.sectors) ? raw.sectors : [])
      .filter((s) => isObj(s) && typeof s.sector === 'string' && s.sector)
      .map((s) => ({ sector: s.sector, medianPct: finite(s.median_pct), count: count(s.count) })),
    noSector: count(raw.no_sector) ?? 0,
    note: typeof raw.note === 'string' && raw.note ? raw.note : SURVIVORSHIP_NOTE,
  }
}

function readEpisode(raw, mode) {
  if (!isObj(raw)) return null
  const peak = readPoint(raw.peak)
  const trough = readPoint(raw.trough)
  if (!peak || !trough || (raw.kind !== 'correction' && raw.kind !== 'bear')) return null
  const rally = RALLY_MONTHS.map((m) => {
    const r = (Array.isArray(raw.rally) ? raw.rally : []).find((x) => isObj(x) && x.months === m)
    return { months: m, date: isoDay(r?.date), returnPct: finite(r?.return_pct) }
  })
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${peak.date}-${trough.date}`,
    kind: raw.kind,
    peak,
    trough,
    depthPct: finite(raw.depth_pct),
    sessionsDown: count(raw.sessions_down),
    recovered: isoDay(raw.recovered),
    sessionsToRecover: count(raw.sessions_to_recover),
    ongoing: raw.ongoing === true,
    peakAtStart: raw.peak_at_history_start === true,
    belowNowPct: finite(raw.below_peak_now_pct),
    rally,
    leaders: readLeaders(raw.leaders, mode),
  }
}

function readIndex(key, raw, mode) {
  if (!isObj(raw) || raw.state !== 'ok') {
    return { key, name: indexLabel(key), state: 'not_held', detail: isObj(raw) && typeof raw.detail === 'string' ? raw.detail : null, episodes: [] }
  }
  const s = isObj(raw.summary) ? raw.summary : {}
  return {
    key,
    name: typeof raw.name === 'string' && raw.name ? raw.name : indexLabel(key),
    state: 'ok',
    first: isoDay(raw.first),
    last: isoDay(raw.last),
    summary: {
      since: isoDay(s.since) ?? isoDay(raw.first),
      corrections: count(s.corrections) ?? 0,
      bearMarkets: count(s.bear_markets) ?? 0,
      ongoing: count(s.ongoing) ?? 0,
      recovered: count(s.recovered) ?? 0,
      medianDepthPct: finite(s.median_depth_pct),
      medianRecoverySessions: finite(s.median_recovery_sessions),
    },
    episodes: (Array.isArray(raw.episodes) ? raw.episodes : []).map((e) => readEpisode(e, mode)).filter(Boolean),
  }
}

/**
 * The route's body -> the panel's view. `state`:
 *   'computing'    the server is working the answer out for the first time (ask again soon)
 *   'unavailable'  the server holds no index closes, or its build failed (`detail` says which)
 *   'failed'       not the route's shape
 *   'ok'           `indexes.SPX` / `indexes.NDX`, each `ok` or `not_held`
 */
export function mkthRead(body) {
  if (!isObj(body)) return { state: 'failed' }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status === 'unavailable') {
    const notHeld = isObj(body.indexes)
    return { state: 'unavailable', reason: notHeld ? 'not_held' : 'failed',
      detail: typeof body.detail === 'string' ? body.detail : null }
  }
  if (body.status !== 'ok' || !isObj(body.indexes)) return { state: 'failed' }
  const lead = isObj(body.leaders) ? body.leaders : {}
  const mode = lead.state === 'computing' || lead.state === 'failed' ? lead.state : null
  const indexes = Object.fromEntries(MKTH_INDEXES.map(({ key }) => [key, readIndex(key, body.indexes[key], mode)]))
  return {
    state: 'ok',
    builtAt: typeof body.built_at === 'string' ? body.built_at : null,
    dataThrough: isoDay(body.data_through),
    refreshing: body.refreshing === true,
    indexNote: typeof body.index_note === 'string' ? body.index_note : null,
    definition: isObj(body.definition) && typeof body.definition.text === 'string' ? body.definition.text : null,
    leaders: {
      state: mode || (lead.state === 'ok' ? 'ok' : 'missing'),
      symbols: count(lead.symbols),
      read: count(lead.read),
      notHeld: count(lead.not_held),
      storeFirst: isoDay(lead.store_first),
      sectorsHeld: lead.sectors_held !== false,
      universe: typeof lead.universe === 'string' ? lead.universe : null,
    },
    indexes,
  }
}

/** True while the server is still working something out (the panel asks again sooner). */
export const isComputing = (view) => view.state === 'computing' || (view.state === 'ok' && view.leaders.state === 'computing')

// ── words ──────────────────────────────────────────────────────────────────────────────────

export const kindText = (kind) => (kind === 'bear' ? 'Bear market' : 'Correction')

/** A percent change with its sign, one decimal: "+39.9%", "-33.9%". Missing: `absent`. */
export const changeText = (v, absent = 'n/a') => formatPercent(finite(v), { decimals: 1, signed: true, absent })

/** 'up' | 'down' | null: the sign of a number, nothing more. */
export function signOf(v) {
  const n = finite(v)
  if (n == null || n === 0) return null
  return n > 0 ? 'up' : 'down'
}

export const levelText = (v) => formatNumber(finite(v), { decimals: 2, absent: 'n/a' })

export function sessionsText(n) {
  if (n == null) return 'n/a'
  return `${formatNumber(n)} ${n === 1 ? 'session' : 'sessions'}`
}

/** Percentage points with a sign: "+35.2 pts", "-4.0 pts", "0.0 pts". */
export function pointsText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  if (Math.abs(n) < 0.05) return '0.0 pts'
  return `${n > 0 ? '+' : '-'}${formatNumber(Math.abs(n), { decimals: 1 })} pts`
}

export const monthsLabel = (m) => (m === 1 ? '1 month' : `${m} months`)

/** "Feb 19, 2020 to Mar 23, 2020". */
export const spanText = (ep) => `${dayText(ep.peak.date)} to ${dayText(ep.trough.date)}`

/** The recovered cell: `{ main, sub }`. */
export function recoveryCell(ep) {
  if (ep.ongoing || !ep.recovered) {
    return { main: 'Not yet', sub: ep.belowNowPct != null ? `now ${changeText(ep.belowNowPct)} from the peak` : null }
  }
  return { main: dayText(ep.recovered), sub: ep.sessionsToRecover != null ? `${sessionsText(ep.sessionsToRecover)} from the low` : null }
}

/** One rally window: `{ months, label, kind: 'value' | 'notyet', text, sign, date }`. */
export function rallyCell(ep, months) {
  const r = ep.rally.find((x) => x.months === months)
  const label = monthsLabel(months)
  if (!r || r.returnPct == null) return { months, label, kind: 'notyet', text: 'not yet', sign: null, date: null }
  return { months, label, kind: 'value', text: changeText(r.returnPct), sign: signOf(r.returnPct), date: r.date }
}

const plural = (n, one, many) => `${formatNumber(n)} ${n === 1 ? one : many}`

/**
 * The summary line: "12 corrections and 4 bear markets in the S&P 500 since Jan 2, 1990. Median
 * depth -14.2%; median recovery 98 sessions from the low (15 recovered)." The counts are every
 * decline of 10% or more in the history held; the ongoing one is counted and said.
 */
export function summaryLine(ix) {
  const s = ix.summary
  const total = s.corrections + s.bearMarkets
  const since = s.since ? ` since ${dayText(s.since)}` : ''
  if (!total) return `No decline of 10% or more in the ${ix.name}${since} in the history UCT holds.`
  const head = `${plural(s.corrections, 'correction', 'corrections')} and ${plural(s.bearMarkets, 'bear market', 'bear markets')} in the ${ix.name}${since}.`
  const parts = []
  if (s.medianDepthPct != null) parts.push(`median depth ${changeText(s.medianDepthPct)}`)
  parts.push(s.medianRecoverySessions != null
    ? `median recovery ${sessionsText(Math.round(s.medianRecoverySessions))} from the low (${formatNumber(s.recovered)} recovered)`
    : 'none has recovered yet')
  const tail = parts.join('; ')
  const open = s.ongoing ? ` ${s.ongoing === 1 ? 'One is' : `${formatNumber(s.ongoing)} are`} still below the peak.` : ''
  return `${head} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.${open}`
}

/** The sentence over a leaders list, or why there is none. */
export function leadersText(ld, indexName) {
  if (ld.state === 'computing') return 'The leaders of this rally are being worked out on the server. This fills in on its own.'
  if (ld.state === 'failed') return 'The leaders could not be worked out just now. The server tries again on its own a little later.'
  if (ld.state === 'not_yet') {
    const so = ld.sessionsSoFar != null ? ` (${sessionsText(ld.sessionsSoFar)} so far)` : ''
    return `Not yet: ${formatNumber(ld.needed)} sessions have not passed since this low${so}.`
  }
  if (ld.state === 'thin') {
    return `Too few stocks in UCT's price history at this low to list leaders: ${formatNumber(ld.pricedBoth ?? 0)} priced on both days.`
  }
  if (ld.state !== 'ok') return 'The leaders of this rally are not in the answer.'
  const span = ld.trough && ld.end ? ` (${dayText(ld.trough)} to ${dayText(ld.end)})` : ''
  const idx = ld.indexReturnPct != null ? ` The ${indexName} over the same days: ${changeText(ld.indexReturnPct)}.` : ''
  return `The ${formatNumber(ld.top.length)} stocks that rose most in the ${formatNumber(LEADER_SESSIONS)} sessions after the low${span}, from ${plural(ld.pricedBoth ?? 0, 'stock', 'stocks')} priced on both days.${idx}`
}

/** The line under the sector medians. */
export function sectorsText(ld) {
  if (!ld.sectors.length) return 'No sector is held for these stocks.'
  const left = ld.noSector ? ` ${plural(ld.noSector, 'stock', 'stocks')} with no sector held ${ld.noSector === 1 ? 'is' : 'are'} left out.` : ''
  return `Each sector's median return over the same days, from every stock priced on both days.${left}`
}

/** The line about the stock history the leaders come from. */
export function storeLine(view) {
  const l = view.leaders
  if (l.state !== 'ok') return null
  const first = l.storeFirst ? ` reaches back to ${dayText(l.storeFirst)}` : ''
  const of = l.read != null && l.symbols != null ? `; ${formatNumber(l.read)} of ${formatNumber(l.symbols)} stocks in the universe have one` : ''
  return `Leaders come from ${l.universe || "UCT's stock universe"}. UCT's stock price history${first}${of}.`
}
