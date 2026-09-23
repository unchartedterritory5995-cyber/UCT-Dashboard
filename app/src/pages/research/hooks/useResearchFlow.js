import useMobileSWR from '../../../hooks/useMobileSWR'

// Research "Flow" tab (A13 Wave B, per-ticker join scope revision — see the
// dispatch report for why a literal merged thesis+setup+trade+flow panel was
// revised into this narrower door instead). Reuses the EXISTING, already-
// shipped, partner-owned `GET /api/live/massive/ticker-flow` endpoint AS-IS —
// zero new backend computation, zero new options-flow math. This mirrors
// useTechnical.js's own precedent (an existing endpoint, a thin fetch hook)
// rather than inventing a second implementation of anything the Options Flow
// surfaces already compute.
const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useResearchFlow(rawSym, days = '5') {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data, isLoading } = useMobileSWR(
    sym ? `/api/live/massive/ticker-flow?symbol=${encodeURIComponent(sym)}&days=${encodeURIComponent(days)}` : null,
    fetcher,
  )
  return { data: data || null, isLoading: isLoading && !data }
}
