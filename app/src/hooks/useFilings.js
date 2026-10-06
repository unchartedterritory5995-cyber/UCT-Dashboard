// app/src/hooks/useFilings.js
// SWR hook: GET /api/filings/{ticker}?count=10
// Returns { data, error, isLoading, mutate }:
//   data  — the readable payload { ticker, filings: [...] }, or null when the
//           read failed (kept null so existing consumers that only show rows
//           are unaffected).
//   error — null on a readable answer; otherwise { httpStatus, reason, kind }.
//
// ⛔ A FAILED READ IS NOT AN EMPTY FILING LIST. The backend answers an SEC
// outage with a 200 `{"error": "SEC fetch failed: ..."}` and no `filings`, and
// the old fetcher (`r.ok ? r.json() : null`) let the tab render that as
// "No SEC filings found for this ticker" — a claim about the company that
// nobody made. Same {ok, httpStatus, body} shape as useDecisionRecord.js.
import useSWR from 'swr'
import { withDeadline } from '../utils/withDeadline'

export async function fetchFilings(url) {
  try {
    const r = await withDeadline(fetch(url), url)
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

/** Classify a fetch outcome into the hook's `error` (null = readable). */
export function filingsError(result) {
  if (!result) return null
  if (!result.ok) return { httpStatus: result.httpStatus, reason: null, kind: 'unavailable' }
  const reason = result.body && typeof result.body.error === 'string' ? result.body.error : null
  if (!reason) return null
  // The CIK-map miss is a genuine answer (ETF, foreign listing, not an SEC
  // filer), not an outage — kept distinct so the copy can say so.
  const kind = /not found in SEC CIK map/i.test(reason) ? 'no_filer' : 'unavailable'
  return { httpStatus: result.httpStatus, reason, kind }
}

export default function useFilings(ticker, count = 10) {
  const swr = useSWR(
    ticker ? `/api/filings/${ticker}?count=${count}` : null,
    fetchFilings,
    { refreshInterval: 15 * 60 * 1000, revalidateOnFocus: false },
  )
  const result = swr.data
  const error = filingsError(result)
  return {
    data: result && result.ok && !error ? result.body : null,
    error,
    isLoading: Boolean(swr.isLoading && !result),
    mutate: swr.mutate,
  }
}
