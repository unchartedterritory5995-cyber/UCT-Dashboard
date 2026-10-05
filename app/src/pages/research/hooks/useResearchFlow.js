import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'

// Research "Flow" tab (A13 Wave B, per-ticker join scope revision — see the
// dispatch report for why a literal merged thesis+setup+trade+flow panel was
// revised into this narrower door instead). Reuses the EXISTING, already-
// shipped, partner-owned `GET /api/live/massive/ticker-flow` endpoint AS-IS —
// zero new backend computation, zero new options-flow math. This mirrors
// useTechnical.js's own precedent (an existing endpoint, a thin fetch hook)
// rather than inventing a second implementation of anything the Options Flow
// surfaces already compute.
//
// ⛔ A FAILED READ IS NOT A QUIET TAPE. This fetcher used to map every non-2xx
// and every dropped connection to `null`, and the tab rendered that as "No
// qualifying options flow on X" -- a confident claim about the name that
// nobody measured. It now keeps the HTTP outcome (the useDecisionRecord.js
// `{ok, httpStatus, body}` shape) so the tab can say "unavailable" and offer a
// retry.
export async function fetchResearchFlow(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    // a network failure, or a 200 whose body is not JSON: a failure either way, never "no flow"
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useResearchFlow(rawSym, days = '5') {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data: result, isLoading, mutate } = useMobileSWR(
    sym ? `/api/live/massive/ticker-flow?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(days)}` : null,
    fetchResearchFlow,
  )
  return useMemo(() => ({
    data: result?.ok ? (result.body || null) : null,
    error: result && !result.ok ? { httpStatus: result.httpStatus } : null,
    isLoading: Boolean(isLoading && !result),
    retry: () => mutate(),
  }), [result, isLoading, mutate])
}
