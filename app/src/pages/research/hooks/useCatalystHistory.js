import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'

// Packet G CP1: every catalyst entry UCT's engine has ever recorded for this
// ticker, across all dates -- keyed off the SETTLED symbol, same convention
// as every other tab's hook on this page.
//
// TERM-088 -- a failed read is not an empty catalyst history; see
// useDecisionRecord.js for why the fetcher keeps the HTTP outcome instead of
// collapsing a non-2xx into null.
export async function fetchCatalystHistory(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useCatalystHistory(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym ? `/api/catalysts/history/${sym}` : null
  const { data, isLoading, mutate } = useMobileSWR(key, fetchCatalystHistory)
  return useMemo(() => ({
    data: data ? data.body : null,
    isLoading: Boolean(isLoading && !data),
    // 402 is the paid gate -- a STATE the tab renders as copy, not an outage
    // to retry (same rule as sectionFetch.js).
    paywalled: Boolean(data && !data.ok && data.httpStatus === 402),
    error: Boolean(data && !data.ok && data.httpStatus !== 402),
    mutate,
  }), [data, isLoading, mutate])
}
