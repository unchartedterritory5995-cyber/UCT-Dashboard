import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { withDeadline } from '../../../utils/withDeadline'

// TERM-088 -- the decision record for one ticker.
//
// ⛔ A FAILED READ IS NOT AN EMPTY RECORD. The other research hooks collapse a
// non-2xx into `null`, which the tabs render as their empty state. Here that
// would turn a 402, a 404 (flag off), a 5xx or a dropped connection into
// "not considered" -- a judgement about the name that nobody made. So the
// fetcher keeps the HTTP outcome, and the tab renders an error as an error.
export async function fetchDecisionRecord(url) {
  try {
    const r = await withDeadline(fetch(url, { credentials: 'include' }), url)
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useDecisionRecord(rawSym, { limit = 50, offset = 0 } = {}) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym
    ? `/api/decision-record/ticker/${encodeURIComponent(sym)}?limit=${limit}&offset=${offset}`
    : null
  const { data, isLoading, mutate } = useMobileSWR(key, fetchDecisionRecord)
  // Memoized so a consumer's effect/memo keyed on this object does not re-run
  // on every render (the H14 shape).
  return useMemo(() => ({
    result: data || null,
    isLoading: Boolean(isLoading && !data),
    mutate,
  }), [data, isLoading, mutate])
}
