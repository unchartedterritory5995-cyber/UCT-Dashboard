// MKTS's pure half: the answers the markets board reads -> the rows it draws. No React.
//
// Three reads, each with its own source and its own as-of, never blended into one:
//   GET /api/snapshot                    (signed in) index funds, VIX and Bitcoin, already formatted:
//                                        { etfs: { SPY: { price: "645.12", chg: "+0.43%" }, ... },
//                                          futures: { BTC: { price: "67,123.45", chg: "-1.20%" } } }
//   GET /api/research/treasury-yields    (paid) the Treasury's daily par yield curve (ratesModel.js)
//   GET /api/crypto/quote/BTCUSD         (when switched on) the Bitcoin quote with FMP's own time
//
// What the snapshot does NOT carry, so this file never shows it:
//   * no change in points: only the percent change, as text;
//   * no time of its own: the only honest time is when this screen read it;
//   * no index futures, gold, oil or dollar rows: there is no commodities group to draw.
// A leg the server could not price arrives as a dash, not a number. It is named in words; it is
// never a 0.
import { INDEX_LABELS, chgDirection, pickEntry } from '../../charts/widgets/indexesModel'
import { bpText, dayText, yieldText } from './ratesModel'

export const MKTS_CODE = 'MKTS'
/** The thing read, as a failed read names it ("The markets board could not be read just now."). */
export const MKTS_WHAT = 'The markets board'
export const MKTS_SNAPSHOT_URL = '/api/snapshot'
export const MKTS_SNAPSHOT_SOURCE = 'UCT market snapshot (Massive for the funds, Yahoo Finance for VIX and Bitcoin)'
/** How often the snapshot is read again while the panel is on screen (the server holds it 15 seconds). */
export const MKTS_POLL_MS = 30_000
/** While the server is still building the curve the panel asks again this often (the pace RATES uses). */
export const MKTS_RATES_WARMING_POLL_MS = 3 * 1000
/** Otherwise the curve, a daily figure, is read again this often while the panel is on screen (as RATES does). */
export const MKTS_RATES_HELD_POLL_MS = 30 * 60 * 1000
/** The index funds the snapshot carries, in the order the board lists them. */
export const MKTS_FUNDS = Object.freeze(['SPY', 'QQQ', 'IWM', 'DIA'])
/** The Treasury maturities the board lists (the whole curve is on RATES). */
export const MKTS_RATE_KEYS = Object.freeze(['3m', '2y', '10y', '30y'])
/** The pair the Bitcoin row links to when the quote route is switched on. `BTC` alone is a fund's ticker. */
export const MKTS_PAIR = 'BTCUSD'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A snapshot leg -> `{ price, chg, dir }`, with null for anything the server could not price
 *  (it sends a dash). `dir` is 'up' | 'down' | 'flat' | null, read from the change text. */
export function legOf(entry) {
  const text = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
  const shown = /^\d[\d,]*(\.\d+)?$/.test(text(entry?.price)) ? text(entry.price) : null
  // a price of 0 is not a price: it is named as missing like the dash the server sends
  const price = shown && Number(shown.replace(/,/g, '')) > 0 ? shown : null
  const chg = price && /^[+-]?\d+(\.\d+)?%$/.test(text(entry?.chg)) ? text(entry.chg) : null
  const way = chg ? chgDirection(chg) : ''
  return { price, chg, dir: !chg ? null : way === 'pos' ? 'up' : way === 'neg' ? 'down' : 'flat' }
}

/**
 * GET /api/snapshot -> the board's snapshot rows. `state`:
 *   'failed'   not the route's shape
 *   'none'     the route's shape, and not one leg has a price
 *   'ok'       at least one leg priced; `missing` names the ones that are not
 * `funds` is [{ sym, name, price, chg, dir }] in MKTS_FUNDS order; `vix` and `btc` are one such row each.
 */
export function snapshotRead(body) {
  const blank = { state: 'failed', funds: [], vix: null, btc: null, missing: [] }
  if (!isObj(body) || (!isObj(body.etfs) && !isObj(body.futures))) return blank
  const row = (sym, name) => ({ sym, name, ...legOf(pickEntry(body, sym)) })
  const funds = MKTS_FUNDS.map((sym) => row(sym, INDEX_LABELS[sym]))
  const vix = row('VIX', 'VIX, the volatility index')
  const btc = row('BTC', 'Bitcoin')
  const all = [...funds, vix, btc]
  const missing = all.filter((r) => r.price == null).map((r) => (r.sym === 'BTC' ? 'Bitcoin' : r.sym))
  return { state: missing.length === all.length ? 'none' : 'ok', funds, vix, btc, missing }
}

const listWords = (words) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)

/** "No price for IWM and VIX in this read." ('' when every leg is priced). */
export const missingLine = (missing) => (missing.length ? `No price for ${listWords(missing)} in this read. That is a missing price, not a zero.` : '')

/** An ISO instant as an ET clock: "2:32 PM ET"; null when it is not a time. */
export function etClockOf(iso) {
  const d = new Date(iso || NaN)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`
}

/** The snapshot's as-of words. It carries no time of its own, so this is when the screen read it. */
export function snapshotAsOf(receivedAt) {
  const clock = etClockOf(receivedAt)
  return clock ? `prices read ${clock}` : 'prices carry no time'
}

/** The rates rows the board lists, from `ratesRead(body)` (state 'ok'):
 *  [{ key, label, yieldText, changeText, dir }] for the maturities that have a yield. */
export function ratesRows(view) {
  if (!view || view.state !== 'ok') return []
  return MKTS_RATE_KEYS.map((key) => view.maturities.find((m) => m.key === key)).filter((m) => m && m.yield != null).map((m) => {
    const bp = finite(m.changeBp?.d1)
    return {
      key: m.key,
      label: `${m.label} Treasury`,
      yieldText: yieldText(m.yield),
      changeText: bp == null ? 'n/a' : `${bpText(bp)} bp`,
      dir: bp == null ? null : bp > 0 ? 'up' : bp < 0 ? 'down' : 'flat',
    }
  })
}

/** "as of Nov 19, 2026" from the curve's own date. */
export const ratesAsOf = (view) => (view?.asOf ? `as of ${dayText(view.asOf)}` : 'undated')

/** A percent change with a plain sign: "+1.20%", "-0.45%", "0.00%"; null with no figure. */
export function pctText(v) {
  const n = finite(v)
  if (n == null) return null
  const r = Math.round(n * 100) / 100
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(2)}%`
}

/**
 * The Bitcoin row: the quote route's price when it answered with one, else the snapshot's leg.
 *   `pairView`   `pairQuoteView(quote)` when the member is admitted to the pair, else null
 *   `changePct`  the quote's own `change_pct`
 *   `leg`        the snapshot's Bitcoin row (may be unpriced, or null with no snapshot)
 * -> { from: 'quote'|'snapshot'|'none', price, chg, dir, linked, asked }
 * `linked` is true only for the quote route's pair (BTCUSD opens as a pair; `BTC` is a fund).
 * `asked` is true when the quote route was asked and gave no price, so the panel can say so.
 */
export function bitcoinRow(pairView, changePct, leg) {
  if (pairView && pairView.kind === 'price') {
    const chg = pctText(changePct)
    const n = finite(changePct)
    return { from: 'quote', price: pairView.price, chg, dir: n == null ? null : n > 0 ? 'up' : n < 0 ? 'down' : 'flat', linked: true, asked: false }
  }
  const asked = !!pairView
  if (leg && leg.price != null) return { from: 'snapshot', price: leg.price, chg: leg.chg, dir: leg.dir, linked: false, asked }
  return { from: 'none', price: null, chg: null, dir: null, linked: false, asked }
}
