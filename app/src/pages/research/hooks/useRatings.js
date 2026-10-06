import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { withDeadline } from '../../../utils/withDeadline'

// TERM-088 -- ratings tab (RTG). A failed read is not an empty rating; see
// useDecisionRecord.js for why the fetcher keeps the HTTP outcome instead of
// collapsing a non-2xx into null.
export async function fetchRatings(url) {
  try {
    const r = await withDeadline(fetch(url, { credentials: 'include' }), url)
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
    error: Boolean(data && !data.ok),
    mutate,
  }), [data, isLoading, mutate])
}
