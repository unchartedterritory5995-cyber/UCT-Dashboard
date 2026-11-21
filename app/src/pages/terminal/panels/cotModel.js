// COT's pure half: the Commitments of Traders routes' answers -> what the panel draws. No React.
//
// The routes (api/routers/cot.py, all paid):
//   GET /api/cot/symbols                 the markets the server holds, by group ({ groups: { NAME: [{symbol, name}] } })
//   GET /api/cot/{code}?weeks=N          one market's weekly rows, oldest first: a bare list of
//                                        { date, large_spec_net, commercial_net, small_spec_net, open_interest }
//   GET /api/cot/{code}/narratives       the stored weekly notes for one market, newest report first
//
// What the stored report carries: the NET position of each trader class and total open interest
// (the CFTC's legacy futures-only report). It does not carry the long and the short side, so this
// file never shows them. A market's place in its own range is the site's own COT Index
// (pages/cot/cotRead.js, the same arithmetic the COT Data page draws), never a second formula.
import { GROUPS, INDEX_WINDOW, computeSnapshot } from '../../cot/cotRead'
import { dayWords } from './tideHistoryModel'

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

/** Contracts, compact, no sign: "1.25M", "212.4K", "860"; "n/a" with no figure. */
export function contractsText(v) {
  const n = finite(v)
  if (n == null) return 'n/a'
  const a = Math.abs(n)
  if (a >= 1e6) return `${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${(a / 1e3).toFixed(1)}K`
  return Math.round(a).toLocaleString('en-US')
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
