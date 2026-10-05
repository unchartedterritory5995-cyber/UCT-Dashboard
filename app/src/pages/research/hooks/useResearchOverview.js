import { useMemo, useCallback } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import useLivePrices from '../../../hooks/useLivePrices'

// TERM-088 -- the Overview tab (DES) composes four independent reads. A
// failed read on any of them is not an empty card; see useDecisionRecord.js
// for why the fetcher keeps the HTTP outcome instead of collapsing a
// non-2xx into null.
export async function fetchResearchOverviewPart(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

// Phase 1: compose the Overview tab from existing endpoints. No new backend.
export default function useResearchOverview(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()

  const { data: meta, mutate: mutateMeta } = useMobileSWR(sym ? `/api/ticker-meta/${sym}` : null, fetchResearchOverviewPart)
  const { data: stats, mutate: mutateStats } = useMobileSWR(sym ? `/api/fundamentals/${sym}` : null, fetchResearchOverviewPart)
  const { data: analyst, mutate: mutateAnalyst } = useMobileSWR(sym ? `/api/earnings/intel/${sym}` : null, fetchResearchOverviewPart)
  const { data: ai, mutate: mutateAi } = useMobileSWR(sym ? `/api/earnings-analysis/${sym}` : null, fetchResearchOverviewPart)
  const { prices } = useLivePrices(sym ? [sym] : [])

  const mutate = useCallback(() => {
    mutateMeta()
    mutateStats()
    mutateAnalyst()
    mutateAi()
  }, [mutateMeta, mutateStats, mutateAnalyst, mutateAi])

  return useMemo(() => ({
    sym,
    meta: (meta && meta.ok ? meta.body : null) || {},
    stats: (stats && stats.ok ? stats.body : null) || {},
    analyst: (analyst && analyst.ok ? analyst.body : null) || {},
    ai: (ai && ai.ok ? ai.body : null) || {},
    live: (prices && prices[sym]) || {},
    error: Boolean((meta && !meta.ok) || (stats && !stats.ok) || (analyst && !analyst.ok) || (ai && !ai.ok)),
    mutate,
  }), [sym, meta, stats, analyst, ai, prices, mutate])
}
