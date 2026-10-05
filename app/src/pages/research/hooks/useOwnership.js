import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'

// TERM-088 -- ownership tab (OWN). A failed read is not an empty ownership
// record; see useDecisionRecord.js for why the fetcher keeps the HTTP
// outcome instead of collapsing a non-2xx into null.
export async function fetchOwnership(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useOwnership(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym ? `/api/research/ownership/${sym}` : null
  const { data, isLoading, mutate } = useMobileSWR(key, fetchOwnership)
  return useMemo(() => ({
    data: data ? data.body : null,
    isLoading: Boolean(isLoading && !data),
    error: Boolean(data && !data.ok),
    mutate,
  }), [data, isLoading, mutate])
}
