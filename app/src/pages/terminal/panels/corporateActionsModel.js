// CACT's pure half: the two routes' answers -> what the panel draws. No React.
//
// GET /api/research/corporate-actions/{ticker} (api/routers/corporate_actions.py) answers ONLY from
// what the server already holds for the stock: the splits and cash dividends kept beside its chart.
// It never asks the data vendor. A stock nothing is held for answers `not_held`, in words.
//   splits     up to 45 years back, newest first
//   dividends  up to 5 years back, by ex-date, newest first; amounts are SPLIT-ADJUSTED (what the
//              chart draws), not the amounts as declared. No pay date is held.
// GET /api/research/rename-notice/{sym} (api/routers/research_notices.py) is the name and ticker
// record: the tickers this company used before, and companies that used this ticker before.
import { formatCurrency } from '../../../lib/presentation/presentationPrimitives'

export const CACT_CODE = 'CACT'
/** The thing read, as a failed read names it ("Corporate actions could not be read just now."). */
export const CACT_WHAT = 'Corporate actions'
export const CACT_NAMES_WHAT = 'The name and ticker record'
export const CACT_SOURCE = 'Massive reference data, as held by UCT'
/** Rows drawn in each table before "Show all". */
export const CACT_ROWS_SHOWN = 12

export const cactUrl = (sym) => `/api/research/corporate-actions/${encodeURIComponent(sym)}`
export const cactNamesUrl = (sym) => `/api/research/rename-notice/${encodeURIComponent(sym)}`

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const isDay = (v) => {
  const m = ISO_DAY.exec(String(v ?? ''))
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31
}

/** `2020-08-28` -> "Aug 28, 2020". Read from the date's own parts, so no time zone can move the day. */
export function dateWords(iso) {
  if (!isDay(iso)) return 'an unknown day'
  const [, y, mo, d] = ISO_DAY.exec(iso)
  return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const whole = (v) => (finite(v) != null && v >= 0 ? Math.floor(v) : 0)

/** A split ratio as the server labels it ("4:1", "1:10", "1.5:1") in words: "4 for 1",
 *  "1 for 10 (reverse split)". One it cannot read is shown as written; none is "Ratio not given". */
export function splitWords(ratio) {
  const s = typeof ratio === 'string' ? ratio.trim() : ''
  if (!s) return 'Ratio not given'
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s)
  if (!m) return s
  const [after, before] = [Number(m[1]), Number(m[2])]
  if (!(after > 0) || !(before > 0)) return s
  return `${m[1]} for ${m[2]}${after < before ? ' (reverse split)' : ''}`
}

/** A cash amount per share: "$0.25", and four decimals where two would round it ("$0.0125").
 *  A missing or non-positive amount is "Amount not given", never $0. */
export function amountWords(v) {
  const n = finite(v)
  if (n == null || n <= 0) return 'Amount not given'
  const cents = n * 100
  return formatCurrency(n, { decimals: Math.abs(cents - Math.round(cents)) < 1e-6 ? 2 : 4 })
}

function section(raw, readRow) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const rows = (Array.isArray(src.rows) ? src.rows : []).map(readRow).filter(Boolean)
  const total = Math.max(whole(src.total), rows.length)
  return { rows, total, cut: total > rows.length, years: finite(src.window_years) }
}
const splitRow = (r) => (r && typeof r === 'object' && isDay(r.date) ? { date: r.date, ratio: typeof r.ratio === 'string' ? r.ratio : null } : null)
const dividendRow = (r) => (r && typeof r === 'object' && isDay(r.date) ? { date: r.date, amount: finite(r.amount) } : null)

/** The corporate actions answer -> the panel's view. `state`: 'failed' (not the route's shape),
 *  'not_held' (the server holds nothing for the stock) or 'ok'. `empty` is true when the held record
 *  has neither a split nor a dividend in it. */
export function cactRead(body) {
  const blank = { rows: [], total: 0, cut: false, years: null }
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body.status !== 'ok' && body.status !== 'not_held')) {
    return { state: 'failed', reason: '', heldAt: null, splits: blank, dividends: blank, empty: true }
  }
  if (body.status === 'not_held') {
    return { state: 'not_held', reason: typeof body.reason === 'string' ? body.reason : '', heldAt: null, splits: blank, dividends: blank, empty: true }
  }
  const splits = section(body.splits, splitRow)
  const dividends = section(body.dividends, dividendRow)
  const held = typeof body.held_at === 'string' && !Number.isNaN(new Date(body.held_at).getTime()) ? body.held_at : null
  return { state: 'ok', reason: '', heldAt: held, splits, dividends, empty: !splits.rows.length && !dividends.rows.length }
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The sentence above the tables. */
export function heldLine(sym, view) {
  if (view.empty) return `The record held for ${sym} has no split and no dividend in it.`
  const parts = []
  if (view.splits.total) parts.push(plural(view.splits.total, 'split', 'splits'))
  if (view.dividends.total) parts.push(plural(view.dividends.total, 'cash dividend', 'cash dividends'))
  return `${sym}: ${parts.join(' and ')} held.`
}

/** What is drawn against what is held; null when every held row is on screen. */
export function cutLine(sectionView, shown, noun) {
  if (shown >= sectionView.total) return null
  const base = `Showing the newest ${shown} of ${sectionView.total} ${noun} held`
  return sectionView.cut && shown >= sectionView.rows.length ? `${base}; this panel reads at most ${sectionView.rows.length}.` : `${base}.`
}

/** The name record's answer -> the names block. `state`: 'failed', 'unavailable' (the record could
 *  not be read on the server), 'none' (no entry names this ticker), 'ambiguous' (more than one
 *  company holds it today) or 'ok'. In 'ok', `formerly` and `previous` may both be empty. */
export function namesRead(body) {
  const out = { state: 'failed', formerly: [], previous: [] }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out
  if (body.state === 'store_unavailable') return { ...out, state: 'unavailable' }
  if (body.state === 'not_in_store') return { ...out, state: 'none' }
  if (body.state !== 'ok') return out
  const cur = body.current && typeof body.current === 'object' ? body.current : null
  const alias = (a) => (a && typeof a === 'object' && typeof a.alias === 'string' && a.alias.trim() ? a : null)
  const formerly = (Array.isArray(cur?.formerly) ? cur.formerly : []).map(alias).filter(Boolean)
    .map((a) => ({ alias: a.alias.trim().toUpperCase(), from: isDay(a.valid_from) ? a.valid_from : null, to: isDay(a.valid_to) ? a.valid_to : null }))
  const previous = (Array.isArray(body.previous_holders) ? body.previous_holders : []).filter((p) => p && typeof p === 'object')
    .map((p) => ({
      from: isDay(p.held_from) ? p.held_from : null,
      to: isDay(p.held_to) ? p.held_to : null,
      nowAs: (Array.isArray(p.now_trades_as) ? p.now_trades_as : []).map(alias).filter(Boolean).map((a) => a.alias.trim().toUpperCase()),
    }))
  return { state: cur?.ambiguous === true ? 'ambiguous' : 'ok', formerly, previous }
}

const span = (from, to) => (from && to ? `from ${dateWords(from)} until ${dateWords(to)}` : to ? `until ${dateWords(to)}` : from ? `from ${dateWords(from)}` : 'on dates the record does not give')

/** One sentence per former ticker of the company that holds `sym` today. */
export const formerlyLine = (sym, f) => `${sym} traded as ${f.alias} ${span(f.from, f.to)}.`

/** A company that used `sym` before: when. The panel adds where it trades now, as links. */
export const previousLead = (sym, p) => `A different company used ${sym} ${span(p.from, p.to)}.`
export const NO_TICKER_NOW = 'It holds no ticker in the record today.'

/** The same, as one whole sentence pair. */
export function previousLine(sym, p) {
  return `${previousLead(sym, p)} ${p.nowAs.length ? `It now trades as ${p.nowAs.join(', ')}.` : NO_TICKER_NOW}`
}
