// OIC with no ticker: the biggest open-interest changes across the whole options log, the pure half of
// OiMarketPanel.jsx. `NVDA OIC` is still one stock's contracts (OiChangePanel.jsx, unchanged).
//
//   OIC              by stock: each underlying's net change in open interest, biggest either way first
//   OIC CONTRACTS    by contract: the single contracts that changed most
//   OIC C | P        calls or puts only (the per-stock OIC's own side words, oiChangeModel.js)
//
// GET /api/options-screener/oi-change?view=stocks|contracts&side=any|call|put (api/routers/options_screener.py
// over api/services/options_analytics/oi_market.py): OPTIONS_SCREENER_ENABLED (404 off), paid (402). Held by the
// server and built once per pair of logged sessions in the background: `computing` until then (ask again).
import { OI_SIDES, countText, dayWords, normOiSide, signedText } from './oiChangeModel'

export const OI_MARKET_URL = '/api/options-screener/oi-change'
export const OI_MARKET_SOURCE = 'UCT options log (end-of-day options snapshot)'

export const OI_VIEWS = Object.freeze({
  stocks: Object.freeze({ label: 'By stock', token: null, noun: 'stocks' }),
  contracts: Object.freeze({ label: 'By contract', token: 'CONTRACTS', noun: 'contracts' }),
})
export const DEFAULT_OI_VIEW = 'stocks'

/** The words a member types for the view (upper case: the shell upper-cases typed tokens). */
export const OI_VIEW_ARG_WORDS = Object.freeze({
  STOCKS: 'stocks', STOCK: 'stocks', NAMES: 'stocks', TICKERS: 'stocks',
  CONTRACTS: 'contracts', CONTRACT: 'contracts', STRIKES: 'contracts',
})

const own = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
export const parseOiView = (token) => own(OI_VIEW_ARG_WORDS, String(token ?? '').trim().toUpperCase())
export const normOiView = (raw) => (own(OI_VIEWS, String(raw ?? '').toLowerCase()) ? String(raw).toLowerCase() : parseOiView(raw)) || DEFAULT_OI_VIEW

export function oiMarketUrl({ view = null, side = null } = {}) {
  return `${OI_MARKET_URL}?view=${normOiView(view)}&side=${normOiSide(side)}`
}

/** What a pick writes back after the code (defaults write nothing: bare `OIC`). */
export function oiMarketCommandArgs({ view = null, side = null } = {}) {
  return [OI_VIEWS[normOiView(view)].token, OI_SIDES[normOiSide(side)].token].filter(Boolean)
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/** The body as `{ state, rows, ... }`; `state`: ok | computing | no_sessions | one_session | unknown. */
export function oiMarketRead(body) {
  if (!body || typeof body !== 'object') return { state: 'unknown', rows: [] }
  const known = ['ok', 'computing', 'no_sessions', 'one_session']
  const state = known.includes(body.status) ? body.status : 'unknown'
  const view = normOiView(body.view)
  const rows = (Array.isArray(body.rows) ? body.rows : [])
    .filter((r) => r && typeof r.symbol === 'string' && r.symbol.trim())
    .map((r, i) => ({
      key: `${r.contract || r.symbol}-${i}`,
      sym: r.symbol.trim().toUpperCase(),
      contract: typeof r.contract === 'string' ? r.contract : null,
      expiration: day(r.expiration),
      strike: num(r.strike),
      type: r.type === 'put' ? 'put' : r.type === 'call' ? 'call' : null,
      oi: num(r.oi),
      priorOi: num(r.prior_oi),
      change: num(r.change),
      changePct: num(r.change_pct),
      volume: num(r.volume),
      contracts: num(r.contracts),
      callChange: num(r.call_change),
      putChange: num(r.put_change),
    }))
  return {
    state, view, side: normOiSide(body.side), rows,
    session: day(body.session), priorSession: day(body.prior_session),
    skipped: Array.isArray(body.skipped_sessions) ? body.skipped_sessions.filter(day) : [],
    matched: num(body.matched), shown: num(body.shown), underlyings: num(body.underlyings),
    newCount: num(body.new?.contracts), goneCount: num(body.gone?.contracts),
    volumePresent: body.volume_present === true, volumeSession: day(body.volume_session),
    refreshing: body.refreshing === true,
  }
}

/** `+1,200 (+4.5%)`, the percent left out when the earlier figure was 0 or is missing. */
export function changeText(row) {
  const pct = row.changePct == null ? '' : ` (${row.changePct > 0 ? '+' : row.changePct < 0 ? '-' : ''}${Math.abs(row.changePct).toFixed(1)}%)`
  return `${signedText(row.change)}${pct}`
}

/** The cut sentence (a share repeats it), or null when every changed one is on screen. */
export function oiMarketCutNote(view) {
  if (view.state !== 'ok' || view.matched == null || view.matched <= view.rows.length) return null
  const noun = view.view === 'stocks' ? 'stocks' : `${view.side === 'any' ? '' : `${OI_SIDES[view.side].noun} `}contracts`
  return `Showing the ${countText(view.rows.length)} biggest of ${countText(view.matched)} ${noun} whose open interest changed, by number of contracts.`
}

/** The notes that apply: what the comparison is against, and what is counted but not ranked. */
export function oiMarketNotes(view) {
  if (view.state !== 'ok') return []
  const out = [`Open interest recorded ${dayWords(view.session)} against ${dayWords(view.priorSession)}.`]
  if (view.skipped.length) {
    out.push(`No record was stored for ${view.skipped.map(dayWords).join(', ')}, so the change covers more than one session.`)
  }
  if (view.newCount || view.goneCount) {
    out.push(`${countText(view.newCount ?? 0)} new contracts (no earlier figure) and ${countText(view.goneCount ?? 0)} that left the log are counted, not ranked.`)
  }
  return out
}
