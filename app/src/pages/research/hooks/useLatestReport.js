import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { fetchResearchOverviewPart } from './useResearchOverview'
import { fmtEps, fmtSales } from '../../charts/widgets/earningsRows'

// The Overview tab's "Latest report" card (EPS / Revenue: est, actual, surprise).
//
// Source: the SAME ungated `/api/earnings-intel/{sym}` model the chart dock's
// Earnings tab and earnings strip read (api/services/earnings_intel.py) —
// `quarters` is reported quarters, newest fiscal period first, each carrying
// eps_actual/eps_estimate/revenue_actual/revenue_estimate and a surprise the
// backend computes ONLY when actual and estimate share a basis. No new endpoint.
//
// ⛔ The SWR key is a TUPLE, not the bare URL: the dock reads that URL with a
// raw-JSON fetcher, and sharing its cache entry would hand one consumer the
// other's shape. This fetcher keeps the HTTP outcome (useDecisionRecord.js
// pattern) so an outage renders as "couldn't load", never as "no report".
const KEY_TAG = 'overview-latest-report'
const fetchLatest = ([, url]) => fetchResearchOverviewPart(url)

function fmtSurprise(pct, abs, money) {
  if (pct != null) return `${pct >= 0 ? '+' : ''}${Number(pct).toFixed(1)}%`
  // Near-zero estimate: the backend gives the absolute surprise instead of a
  // meaningless percentage. Keep the sign prefix the card's colouring reads.
  if (abs != null) return `${abs >= 0 ? '+' : '-'}${money(Math.abs(abs))}`
  return null
}

/** earnings-intel payload → the card's row, or null when nothing is reported. */
export function latestReportRow(intel) {
  const q = (intel?.quarters || []).find(x =>
    x && (x.eps_actual != null || x.revenue_actual != null))
  if (!q) return null
  const val = (v, fmt) => (v == null ? null : fmt(v))
  return {
    label: q.label || null,
    eps_estimate: val(q.eps_estimate, fmtEps),
    reported_eps: val(q.eps_actual, fmtEps),
    surprise_pct: fmtSurprise(q.eps_surprise_pct, q.eps_surprise_abs, fmtEps),
    rev_estimate: val(q.revenue_estimate, fmtSales),
    rev_actual: val(q.revenue_actual, fmtSales),
    rev_surprise_pct: fmtSurprise(q.rev_surprise_pct, q.rev_surprise_abs, fmtSales),
  }
}

/** { row, state: 'loading' | 'error' | 'empty' | 'not_applicable' | 'ready', reason?, retry } */
export default function useLatestReport(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym ? [KEY_TAG, `/api/earnings-intel/${encodeURIComponent(sym)}`] : null
  const { data, mutate } = useMobileSWR(key, fetchLatest, { revalidateOnFocus: false, dedupingInterval: 300000 })
  return useMemo(() => {
    if (!sym) return { row: null, state: 'empty', retry: mutate }
    if (!data) return { row: null, state: 'loading', retry: mutate }
    // A 200 can still carry `{error}` (e.g. a blank ticker) — not a report.
    if (!data.ok || data.body?.error) return { row: null, state: 'error', retry: mutate }
    // tq-panels: a fund answers `not_applicable: 'fund'` (it reports no earnings).
    // That is its own state, never "no reported quarter on file yet".
    if (data.body?.not_applicable) {
      return { row: null, state: 'not_applicable', reason: data.body.reason || null, retry: mutate }
    }
    const row = latestReportRow(data.body)
    return { row, state: row ? 'ready' : 'empty', retry: mutate }
  }, [sym, data, mutate])
}
