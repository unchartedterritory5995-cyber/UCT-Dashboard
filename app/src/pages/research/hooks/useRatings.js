import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { fetchWithWarmRetry } from '../../../utils/warmRetry'

// TERM-088 -- ratings tab (RTG). A failed read is not an empty rating; see
// useDecisionRecord.js for why the fetcher keeps the HTTP outcome instead of
// collapsing a non-2xx into null.
export async function fetchRatings(url) {
  try {
    const r = await fetchWithWarmRetry(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useRatings(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym ? `/api/research/ratings/${sym}` : null
  const { data, isLoading, mutate } = useMobileSWR(key, fetchRatings)
  return useMemo(() => ({
    data: data ? data.body : null,
    isLoading: Boolean(isLoading && !data),
    // 402 is the paid gate -- a STATE the tab renders as copy, never an outage to retry (the
    // same rule as useCatalystHistory.js / sectionFetch.js; Retry could never clear it).
    paywalled: Boolean(data && !data.ok && data.httpStatus === 402),
    error: Boolean(data && !data.ok && data.httpStatus !== 402),
    mutate,
  }), [data, isLoading, mutate])
}
