// Why a stock left an RS screen (unit U12, 2026-11-14): beside each name in the "N dropped"
// popover, the first rule of the screen the stock now fails. One request for all the names
// (GET /api/screener/rows, the batched form of the single-row read "Why isn't a stock here?"
// uses), and each rule judged by whyNot.js, so the popover and that panel can never give two
// reasons for one stock.
//
// ⛔ A REASON IS NEVER GUESSED. A stock whose row could not be read gets no reason, and a
// request that fails gives none to anybody: the popover then shows the names as it always did.
import { whyColumns } from './whyItsHere'
import { evaluateRules, rulesWithout } from './whyNot'

// The server's own cap on one row request (query.MAX_ROW_TICKERS).
export const MAX_REASON_TICKERS = 25
export const GONE_REASON = 'No longer in the Screener'
export const STALE_REASON = 'Its price data stopped updating'
// On a list that keeps its own members (a starter with `row.steady`): the stock still passes
// every rule and is no longer one of the listed names.
export const LOST_PLACE_REASON = 'Passes every rule; lost its place on the list'

// One stock's reason from its row as served ({ row, stale } or nothing). '' when the row gives
// none: every rule this page can check still passes. On a list that keeps its own members the
// membership clause is left out of the rules (whyNot.rulesWithout): it is the answer, "it is not
// on the list", never a reason for it.
export function reasonFor(hit, { filters = {}, metaFilters = [], steady = null } = {}) {
  if (!hit || typeof hit.row !== 'object' || !hit.row) return GONE_REASON
  if (hit.stale === true) return STALE_REASON
  const ev = evaluateRules({ filters: rulesWithout(filters, steady?.key), logic: null, metaFilters, row: hit.row })
  if (ev.firstFailed) return ev.firstFailed
  return steady?.key && !ev.unknown ? LOST_PLACE_REASON : ''
}

// { TICKER: reason } for the names given (at most MAX_REASON_TICKERS are asked about), or {} when
// the read fails. `filters` is the KEYED filters of the screen on view.
export async function droppedReasons(tickers, { filters = {}, metaFilters = [], steady = null } = {}) {
  const names = [...new Set((tickers || []).filter(t => typeof t === 'string' && t))].slice(0, MAX_REASON_TICKERS)
  if (!names.length) return {}
  const columns = whyColumns(rulesWithout(filters, steady?.key))
  try {
    const r = await fetch(`/api/screener/rows?tickers=${encodeURIComponent(names.join(','))}&columns=${encodeURIComponent(columns.join(','))}`)
    if (!r.ok) return {}
    const body = await r.json()
    const rows = body && typeof body.rows === 'object' && body.rows ? body.rows : null
    if (!rows) return {}
    const out = {}
    for (const t of names) {
      const reason = reasonFor(rows[t], { filters, metaFilters, steady })
      if (reason) out[t] = reason
    }
    return out
  } catch { return {} }
}
