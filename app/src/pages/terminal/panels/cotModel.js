// COT's pure half: the Commitments of Traders routes' answers -> what the panel draws. No React.
//
// The routes (api/routers/cot.py, all paid):
//   GET /api/cot/symbols                 the markets the server holds, by group ({ groups: { NAME: [{symbol, name}] } })
//   GET /api/cot/{code}?weeks=N          one market's weekly rows, oldest first: a bare list of
//                                        { date, large_spec_net, commercial_net, small_spec_net, open_interest }
//   GET /api/cot/{code}/narratives       the stored weekly notes for one market, newest report first
//
// What the stored report carries: the NET position of each trader class and total open interest
// (the CFTC's legacy futures-only report). It does not carry the long and the short side, so the
// legacy part of this file never shows them; the by-trader-type part at the end reads the CFTC's
// finer reports, which carry both sides. A market's place in its own range is the site's own COT Index
// (pages/cot/cotRead.js, the same arithmetic the COT Data page draws), never a second formula.
import { GROUPS, INDEX_WINDOW, computeSnapshot, cotIndex } from '../../cot/cotRead'
import { dayWords } from './tideHistoryModel'
import { formatCompact, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'

export const COT_CODE = 'COT'
/** The thing read, as a failed read names it ("Futures positioning could not be read just now."). */
export const COT_WHAT = 'Futures positioning'
export const COT_SOURCE = 'CFTC Commitments of Traders (legacy futures-only report)'
export const COT_SYMBOLS_URL = '/api/cot/symbols'
/** Weekly reports asked per market: three years for the range (156) and a few to spare. ONE depth,
 *  so the board and a single market share a response shape. */
export const COT_WEEKS = 160
/** Reports the 3-year range needs before it is shown. */
export const COT_RANGE_WEEKS = INDEX_WINDOW
/** Reports drawn in one market's history table. */
export const COT_HISTORY_ROWS = 8
/** The sentence every view carries, word for word. */
export const COT_WEEKLY_LINE = 'Weekly. The CFTC counts positions each Tuesday and publishes them the following Friday, '
  + 'so every figure is about three days old on the day it comes out.'

export const cotUrl = (code) => `/api/cot/${encodeURIComponent(String(code || '').toUpperCase())}?weeks=${COT_WEEKS}`
/** The newest stored note only. A plain member-gated read: this panel never asks for one to be written. */
export const cotNarrativeUrl = (code) => `/api/cot/${encodeURIComponent(String(code || '').toUpperCase())}/narratives?limit=1`

/** The trader classes in the order the panel lists them, with the CFTC's own name for each. */
const CLASS_WORDS = {
  largeSpecs: { label: 'Large speculators', cftc: 'non-commercial traders: funds and other large traders' },
  commercials: { label: 'Commercials', cftc: 'commercial traders: producers, merchants and other hedgers' },
  smallSpecs: { label: 'Small speculators', cftc: 'non-reportable traders: positions too small to report' },
}
export const COT_CLASSES = Object.freeze(['largeSpecs', 'commercials', 'smallSpecs'].map((key) => {
  const g = GROUPS.find((x) => x.key === key)
  return Object.freeze({ key, field: g.field, ...CLASS_WORDS[key] })
}))

// ── the argument ─────────────────────────────────────────────────────────────────────────────

/** One typed word after the code: a market code (GC, ZN, 6E-style B6), or a plain word (GOLD, 10Y).
 *  args.js keeps a pinned copy of this shape; the PANEL resolves the word against the route's list. */
export const COT_ARG_SHAPE = /^[A-Z0-9&][A-Z0-9&.-]{0,11}$/

export function parseCotArg(tok) {
  const t = String(tok ?? '').trim().toUpperCase()
  return COT_ARG_SHAPE.test(t) ? t : null
}

/** Plain words for a market, each ONE token as the command line sends it (upper case). A word only
 *  resolves when the route's own list holds its code. */
export const COT_WORDS = Object.freeze({
  // indexes
  'S&P': 'ES', SP500: 'ES', SPX: 'ES', NASDAQ: 'NQ', NDX: 'NQ', DOW: 'YM', DJIA: 'YM', RUSSELL: 'QR', RUT: 'QR',
  MIDCAP: 'EW', VIX: 'VI', NIKKEI: 'NK',
  // metals
  GOLD: 'GC', SILVER: 'SI', COPPER: 'HG', PLATINUM: 'PL', PALLADIUM: 'PA',
  // energies
  CRUDE: 'CL', OIL: 'CL', WTI: 'CL', BRENT: 'BZ', NATGAS: 'NG', GASOLINE: 'RB',
  // grains and softs
  WHEAT: 'ZW', CORN: 'ZC', SOYBEANS: 'ZS', SOYBEAN: 'ZS', BEANS: 'ZS', COTTON: 'CT', COFFEE: 'KC', SUGAR: 'SB',
  COCOA: 'CC', LUMBER: 'LB',
  // livestock
  CATTLE: 'LE', HOGS: 'HE',
  // rates
  BONDS: 'ZB', '30Y': 'ZB', '10Y': 'ZN', TENS: 'ZN', '5Y': 'ZF', '2Y': 'ZT', SOFR: 'SR3',
  // currencies
  DOLLAR: 'DX', DXY: 'DX', USD: 'DX', POUND: 'B6', GBP: 'B6', CAD: 'D6', YEN: 'J6', JPY: 'J6', FRANC: 'S6', CHF: 'S6',
  EURO: 'E6', EUR: 'E6', AUSSIE: 'A6', AUD: 'A6', PESO: 'M6', MXN: 'M6', KIWI: 'N6', NZD: 'N6',
  // crypto
  BITCOIN: 'BTC', ETHER: 'ETH', ETHEREUM: 'ETH',
})

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
/** The server's duplicated shortlist: its markets also sit in their own groups. */
const SHORTLIST = 'MOST WATCHED'

/** "LIVESTOCK & DAIRY" -> "Livestock & dairy". */
export const groupLabel = (name) => {
  const s = String(name || '').trim().toLowerCase()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/**
 * GET /api/cot/symbols -> the roster. `state`: 'failed' (not the route's shape), 'none' (no market
 * listed) or 'ok'. `markets` is each market ONCE, in the server's order, under its own group (the
 * shortlist repeats markets that sit in another group; a market listed only there keeps it).
 * `groups` keeps every group the server sent, the shortlist included, as code lists.
 */
export function cotRoster(body) {
  if (!isObj(body) || !isObj(body.groups)) return { state: 'failed', groups: [], markets: [] }
  const groups = []
  const home = new Map()
  for (const [name, list] of Object.entries(body.groups)) {
    if (!Array.isArray(list)) continue
    const codes = []
    for (const m of list) {
      const code = isObj(m) && typeof m.symbol === 'string' ? m.symbol.trim().toUpperCase() : ''
      if (!code || codes.includes(code)) continue
      codes.push(code)
      const label = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : code
      const had = home.get(code)
      if (!had || (had.group === SHORTLIST && name !== SHORTLIST)) home.set(code, { code, name: label, group: name })
    }
    if (codes.length) groups.push({ name, label: groupLabel(name), codes })
  }
  // the server's order, the shortlist's own entries last so each market reads under its real group first
  const ordered = groups.filter((g) => g.name !== SHORTLIST).concat(groups.filter((g) => g.name === SHORTLIST))
  const markets = []
  for (const g of ordered) for (const code of g.codes) if (home.get(code).group === g.name) markets.push(home.get(code))
  return { state: markets.length ? 'ok' : 'none', groups, markets }
}

const plain = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** The market a typed word names in the route's own list, or null: its code, a plain word for it,
 *  its whole name, or the start of exactly one name ("NATURAL" -> Natural Gas). */
export function resolveCotMarket(token, markets) {
  const t = parseCotArg(token)
  if (!t || !Array.isArray(markets) || !markets.length) return null
  const byCode = (code) => markets.find((m) => m.code === code) || null
  const direct = byCode(t)
  if (direct) return direct
  if (Object.prototype.hasOwnProperty.call(COT_WORDS, t)) return byCode(COT_WORDS[t])
  const want = plain(t)
  if (!want) return null
  const whole = markets.filter((m) => plain(m.name) === want)
  if (whole.length === 1) return whole[0]
  const starts = want.length >= 3 ? markets.filter((m) => plain(m.name).startsWith(want)) : []
  return starts.length === 1 ? starts[0] : null
}

/** The tokens after the code for this pick (`[]` for the board). */
export const cotCommandArgs = ({ market } = {}) => (parseCotArg(market) ? [parseCotArg(market)] : [])

// ── words ────────────────────────────────────────────────────────────────────────────────────

const CONTRACT_TIERS = Object.freeze([
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 2 }),
  Object.freeze({ at: 1e3, suffix: 'K', decimals: 1 }),
])

/** Contracts, compact, no sign: "1.25M", "212.4K", "860"; "n/a" with no figure. */
export function contractsText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  const a = Math.abs(n)
  // Under ten thousand the whole figure reads better than "9.5K"; from there up, the shared ladder.
  return a >= 1e4 ? formatCompact(a, { tiers: CONTRACT_TIERS }) : formatNumber(Math.round(a), { decimals: 0 })
}

/** Contracts with a sign: "+212.4K" (net long, or a rise), "-85.1K" (net short, or a fall), "0". */
export function signedContracts(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  if (Math.round(n) === 0) return '0'
  return `${n > 0 ? '+' : '-'}${contractsText(n)}`
}

/** "+2.1%" / "-0.4%" / "0.0%": a share of open interest. */
export function shareText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  const r = Math.round(n * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(1)}%`
}

/** The place in the 3-year range as a whole number, 0 to 100; "n/a" when there is none. */
export const rangeText = (v) => (finite(v) == null ? 'n/a' : String(Math.round(finite(v))))

/** 'up' | 'down' | 'flat' | null. The sign of a number, nothing more. */
export function signOf(v) {
  const n = finite(v)
  if (n == null) return null
  return n > 0 ? 'up' : n < 0 ? 'down' : 'flat'
}

/** `2026-11-17` -> "Tue Nov 17, 2026". */
export function reportDay(iso) {
  const words = dayWords(iso)
  return words === 'an unknown day' ? words : `${words}, ${String(iso).slice(0, 4)}`
}

// ── one market ───────────────────────────────────────────────────────────────────────────────

/** The route's list -> its usable rows, oldest first (a row needs a date and every figure). */
export function cotRows(body) {
  if (!Array.isArray(body)) return null
  return body.filter((r) => isObj(r) && ISO_DAY.test(String(r.date ?? ''))
    && COT_CLASSES.every((c) => finite(r[c.field]) != null) && finite(r.open_interest) != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * One market's rows -> the view. `state`: 'failed' (not a list), 'none' (no report stored) or 'ok'.
 *   date     the newest report's date (a Tuesday)
 *   weeks    reports in hand; `rangeOk` is true when the 3-year range has its 156
 *   classes  [{ key, label, cftc, net, wow, pctOi, range }]   wow is null with one report
 *   oi       { value, wow }
 *   history  the newest COT_HISTORY_ROWS reports, newest first
 */
export function cotMarketRead(body) {
  const rows = cotRows(body)
  if (!rows) return { state: 'failed', date: null, weeks: 0, rangeOk: false, classes: [], oi: null, history: [] }
  if (!rows.length) return { state: 'none', date: null, weeks: 0, rangeOk: false, classes: [], oi: null, history: [] }
  const snap = computeSnapshot(rows, rows.length - 1)
  const rangeOk = rows.length >= COT_RANGE_WEEKS
  return {
    state: 'ok',
    date: snap.date,
    weeks: rows.length,
    rangeOk,
    classes: COT_CLASSES.map((c) => {
      const g = snap.groups[c.key]
      return { key: c.key, label: c.label, cftc: c.cftc, net: finite(g.net), wow: finite(g.wow), pctOi: finite(g.pctOi),
        range: rangeOk ? finite(g.index) : null }
    }),
    oi: { value: finite(snap.oi.value), wow: finite(snap.oi.wow) },
    history: rows.slice(-COT_HISTORY_ROWS).reverse().map((r) => ({
      date: r.date, largeSpecs: r.large_spec_net, commercials: r.commercial_net, smallSpecs: r.small_spec_net, oi: r.open_interest,
    })),
  }
}

/** Why a market has no place in its range yet. */
export const rangeWhy = (weeks) => `The 3-year range needs ${COT_RANGE_WEEKS} weekly reports; ${weeks} ${weeks === 1 ? 'is' : 'are'} stored.`

/** GET /api/cot/{code}/narratives -> the newest stored note, or null. `{ reportDate, text }`. */
export function cotNote(body) {
  const row = isObj(body) && Array.isArray(body.rows) ? body.rows.find((r) => isObj(r) && typeof r.text === 'string' && r.text.trim()) : null
  if (!row) return null
  return { reportDate: ISO_DAY.test(String(row.report_date ?? '')) ? row.report_date : null, text: row.text.trim() }
}

/** A stored note as paragraphs (blank lines split it; nothing else is read into it). */
export const noteParagraphs = (text) => String(text || '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)

// ── the board ────────────────────────────────────────────────────────────────────────────────

/**
 * One market's row on the board, or null when it has no stored report.
 *   move   the week's change in the large speculators' net position as a share of open interest
 *          (percent, signed): the one measure that compares a 2M-contract market with a 20K one.
 */
export function boardRow(market, body) {
  const view = cotMarketRead(body)
  if (view.state !== 'ok') return null
  const cls = Object.fromEntries(view.classes.map((c) => [c.key, c]))
  const oi = view.oi.value
  const wow = cls.largeSpecs.wow
  return {
    code: market.code, name: market.name, group: market.group, date: view.date, weeks: view.weeks,
    largeSpecs: { net: cls.largeSpecs.net, wow },
    commercials: { net: cls.commercials.net, wow: cls.commercials.wow },
    move: wow != null && oi ? (wow / oi) * 100 : null,
    range: cls.largeSpecs.range,
  }
}

/** Largest weekly move first (by size, either direction); a market with no move figure last; then by code. */
export function sortBoard(rows) {
  return [...rows].sort((a, b) => {
    const am = a.move == null ? -1 : Math.abs(a.move)
    const bm = b.move == null ? -1 : Math.abs(b.move)
    if (am !== bm) return bm - am
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  })
}

/** The newest report date among the rows, and the markets whose newest report is older than it. */
export function boardDates(rows) {
  const latest = rows.reduce((d, r) => (r.date > d ? r.date : d), '')
  return { latest: latest || null, behind: rows.filter((r) => r.date < latest) }
}

const listWords = (words) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)

/** "Cocoa (CC) and Lumber (LB)". */
export const marketList = (markets) => listWords(markets.map((m) => `${m.name} (${m.code})`))

// ── by trader type: the CFTC's Traders in Financial Futures and Disaggregated reports ─────────
//
// The routes (api/routers/cot.py, paid; the server reads the CFTC's files on its own schedule, never on a request):
//   GET /api/cot/breakdown                 every market's watched class, its newest two weeks
//   GET /api/cot/{code}/breakdown?weeks=N  one market's weeks, oldest first, each class's long, short, spreading
// The server sends the CFTC's own counts. The net, the week's change, the share of open interest and the place in
// the 3-year range are worked out here with the legacy panel's own arithmetic (cotRead.js `cotIndex`, the same
// window and the same rule for when a range is shown), never a second formula.

export const COT_FINER_URL = '/api/cot/breakdown'
export const cotFinerUrl = (code) => `/api/cot/${encodeURIComponent(String(code || '').toUpperCase())}/breakdown?weeks=${COT_WEEKS}`
/** The thing read, as a failed read names it. */
export const COT_FINER_WHAT = 'Positioning by trader type'
/** The credit every view of these reports carries, word for word. */
export const COT_FINER_CREDIT = 'Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), '
  + 'as of the Tuesday it covers, published the following Friday.'

/** The two reports, in plain words. */
export const FINER_REPORT_WORDS = Object.freeze({ tff: 'Traders in Financial Futures', disaggregated: 'Disaggregated' })

/** Each class the two reports split a market into: the panel's words, and the CFTC's own name. */
export const FINER_CLASS_WORDS = Object.freeze({
  dealer: { label: 'Dealers', cftc: 'Dealer/Intermediary: the sell side, banks and dealers' },
  asset_manager: { label: 'Asset managers', cftc: 'Asset Manager/Institutional: pension funds, endowments, insurers, mutual funds' },
  leveraged_funds: { label: 'Leveraged funds', cftc: 'Leveraged Funds: hedge funds and money managers, the speculators of the financial markets' },
  other_reportable: { label: 'Other reportables', cftc: 'Other Reportables: large traders in none of the other classes' },
  nonreportable: { label: 'Small traders', cftc: 'Nonreportable Positions: positions too small to report' },
  producer_merchant: { label: 'Producers and merchants', cftc: 'Producer/Merchant/Processor/User: the hedgers of the physical commodity' },
  swap_dealer: { label: 'Swap dealers', cftc: 'Swap Dealers: dealers hedging swaps they wrote' },
  managed_money: { label: 'Managed money', cftc: 'Managed Money: commodity trading advisers and hedge funds, the speculators of the commodity markets' },
})

/** "Leveraged funds"; an unknown key reads as itself with its underscores as spaces. */
export function finerClassLabel(key) {
  const k = String(key || '')
  return FINER_CLASS_WORDS[k]?.label || (k ? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '')
}

const ROUTE_STATES = new Set(['ok', 'no_record', 'not_built', 'unavailable'])
/** A side of a class: its long, short and spreading counts, null where the CFTC printed none. */
const side = (c, k) => (isObj(c) ? finite(c[k]) : null)
const netOf = (c) => (side(c, 'long') != null && side(c, 'short') != null ? side(c, 'long') - side(c, 'short') : null)

/**
 * GET /api/cot/{code}/breakdown -> the view. `state`: 'failed' (not the route's shape), 'not_built', 'no_record',
 * 'unavailable' or 'ok'. With 'ok':
 *   report, reportName, watch    which report the market is in and the class traders watch most in it
 *   date                         the newest week's report date (a Tuesday)
 *   classes  [{ key, label, cftc, watched, long, short, spread, net, wow, pctOi, range, weeks, traders }]
 *            net = long - short; wow against the week before; range 0 to 100 in the class's own last
 *            COT_RANGE_WEEKS weeks, only when it has that many (as the legacy table)
 *   oi       { value, wow }
 *   records  the CFTC records the weeks came from, oldest first ({ code, name, match, first, last })
 *   concentration  the largest traders' shares of each side in the newest week, or null
 */
export function cotFinerRead(body) {
  const blank = { state: 'failed', report: null, reportName: '', watch: null, date: null, classes: [], oi: null, records: [], concentration: null }
  if (!isObj(body) || !ROUTE_STATES.has(body.state)) return blank
  if (body.state !== 'ok') return { ...blank, state: body.state }
  const rows = (Array.isArray(body.rows) ? body.rows : [])
    .filter((r) => isObj(r) && ISO_DAY.test(String(r.date ?? '')) && isObj(r.classes))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const keys = (Array.isArray(body.classes) ? body.classes : []).map((c) => (isObj(c) ? String(c.key || '') : '')).filter(Boolean)
  if (!rows.length || !keys.length) return { ...blank, state: 'no_record' }
  const last = rows[rows.length - 1]
  const prev = rows.length > 1 ? rows[rows.length - 2] : null
  const oi = finite(last.open_interest)
  const watch = typeof body.watch === 'string' ? body.watch : null
  const classes = keys.map((key) => {
    const c = last.classes[key]
    const net = netOf(c)
    const before = prev ? netOf(prev.classes[key]) : null
    // the class's own weeks with both sides printed, newest last: the window the legacy table uses
    const nets = rows.map((r) => netOf(r.classes[key])).filter((v) => v != null)
    return {
      key, label: finerClassLabel(key), cftc: FINER_CLASS_WORDS[key]?.cftc || key, watched: key === watch,
      long: side(c, 'long'), short: side(c, 'short'), spread: side(c, 'spread'), net,
      wow: net != null && before != null ? net - before : null,
      pctOi: net != null && oi ? (net / oi) * 100 : null,
      range: net != null && nets.length >= COT_RANGE_WEEKS ? finite(cotIndex(nets.slice(-COT_RANGE_WEEKS))) : null,
      weeks: nets.length,
      traders: { long: side(c, 'traders_long'), short: side(c, 'traders_short'), spread: side(c, 'traders_spread') },
    }
  })
  const records = (Array.isArray(body.records) ? body.records : []).filter(isObj).map((r) => ({
    code: typeof r.cftc_code === 'string' ? r.cftc_code : null, name: typeof r.market_name === 'string' ? r.market_name : null,
    match: r.match === 'name' ? 'name' : 'code', first: ISO_DAY.test(String(r.first ?? '')) ? r.first : null,
    last: ISO_DAY.test(String(r.last ?? '')) ? r.last : null,
  }))
  const conc = isObj(body.concentration) ? body.concentration : null
  return {
    state: 'ok', report: body.report || null, reportName: FINER_REPORT_WORDS[body.report] || String(body.report_name || ''),
    watch, date: last.date, classes,
    oi: { value: oi, wow: oi != null && prev && finite(prev.open_interest) != null ? oi - prev.open_interest : null },
    records,
    concentration: conc ? {
      date: ISO_DAY.test(String(conc.date ?? '')) ? conc.date : null,
      gross4: { long: finite(conc.gross_4_long), short: finite(conc.gross_4_short) },
      gross8: { long: finite(conc.gross_8_long), short: finite(conc.gross_8_short) },
    } : null,
  }
}

/** Why a class has no place in its range yet. */
export const finerRangeWhy = (weeks) => `The 3-year range needs ${COT_RANGE_WEEKS} weekly reports of this class; ${weeks} ${weeks === 1 ? 'is' : 'are'} stored.`

/** "212.4K long, 85.1K short" lines for a class; a side the CFTC printed none for reads "n/a". */
export const sideText = (v, word) => `${contractsText(v)} ${word}`

/** "the largest 4 traders hold 21.7% of the longs and 18.0% of the shorts" in one sentence, or '' with nothing to say. */
export function concentrationText(conc) {
  if (!conc) return ''
  const pair = (p) => (p.long != null && p.short != null
    ? `${formatPercent(p.long, { decimals: 1 })} of the long side and ${formatPercent(p.short, { decimals: 1 })} of the short side` : null)
  const four = pair(conc.gross4)
  const eight = pair(conc.gross8)
  if (!four && !eight) return ''
  const parts = [four && `the largest 4 traders hold ${four}`, eight && `the largest 8 hold ${eight}`].filter(Boolean)
  const sentence = parts.join('; ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} (gross positions).`
}

/** "CFTC record: GOLD - ... , contract 088691." or, when the weeks join records, each with its span. */
export function recordsText(records) {
  const named = (r) => `${r.name || 'an unnamed record'}${r.code ? `, contract ${r.code}` : ''}`
  if (!records.length) return ''
  if (records.length === 1) return `CFTC record: ${named(records[0])}.`
  const spans = records.map((r) => `${named(r)} (${r.first ? reportDay(r.first) : 'an unknown day'} to ${r.last ? reportDay(r.last) : 'an unknown day'})`)
  return `These weeks join ${records.length} CFTC records: ${spans.join('; ')}.`
}

/**
 * GET /api/cot/breakdown -> the board's funds column. `state`: 'failed' | 'not_built' | 'unavailable' | 'ok'.
 * `cells` maps a market code to { watch, label, report, date, net, wow }: net is the watched class's long minus its
 * short in the newest week, wow its change from the week before (null with no earlier week).
 */
export function cotFinerBoard(body) {
  if (!isObj(body) || !['ok', 'not_built', 'unavailable'].includes(body.state)) return { state: 'failed', cells: {} }
  if (body.state !== 'ok' || !isObj(body.markets)) return { state: body.state === 'ok' ? 'failed' : body.state, cells: {} }
  const cells = {}
  for (const [code, m] of Object.entries(body.markets)) {
    if (!isObj(m) || !ISO_DAY.test(String(m.date ?? ''))) continue
    const net = netOf(m)
    if (net == null) continue
    const before = isObj(m.previous) ? netOf(m.previous) : null
    cells[String(code).toUpperCase()] = {
      watch: m.watch, label: finerClassLabel(m.watch), report: m.report, date: m.date, net,
      wow: before != null ? net - before : null,
    }
  }
  return { state: 'ok', cells }
}
