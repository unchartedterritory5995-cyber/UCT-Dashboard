import { useMemo, useCallback } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import useLivePrices from '../../../hooks/useLivePrices'
import { fetchWithWarmRetry } from '../../../utils/warmRetry'

// TERM-088 -- the Overview tab (DES) composes four independent reads. A
// failed read on any of them is not an empty card; see useDecisionRecord.js
// for why the fetcher keeps the HTTP outcome instead of collapsing a
// non-2xx into null.
export async function fetchResearchOverviewPart(url) {
  try {
    const r = await fetchWithWarmRetry(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

// Phase 1: compose the Overview tab from existing endpoints. No new backend.
//
// `header` (default true) adds the two reads only the page HEADER draws:
// ticker meta and the live price. The terminal's DES panel renders no header,
// so it passes `{ header: false }` and skips both -- the live price alone
// re-rendered the panel every 2s for nothing.
//
// ⛔ The meta key carries `?src=research` on purpose. This hook's fetcher
// stores `{ok, httpStatus, body}`; useTickerMeta stores the raw JSON under
// `/api/ticker-meta/SYM`. Sharing one SWR key let whichever ran first hand
// the other the wrong shape.
//
// ⛔ The earnings analysis is read `cached_only`: without it an uncached
// ticker generates the analysis with an LLM call inside the request, on the
// single web process. An uncached ticker shows "will appear here once
// available" until the earnings view generates it.
export default function useResearchOverview(rawSym, { header = true } = {}) {
  const sym = (rawSym || '').toUpperCase().trim()

  const { data: meta, mutate: mutateMeta } = useMobileSWR(sym && header ? `/api/ticker-meta/${sym}?src=research` : null, fetchResearchOverviewPart)
  const { data: stats, mutate: mutateStats } = useMobileSWR(sym ? `/api/fundamentals/${sym}` : null, fetchResearchOverviewPart)
  const { data: analyst, mutate: mutateAnalyst } = useMobileSWR(sym ? `/api/earnings/intel/${sym}` : null, fetchResearchOverviewPart)
  const { data: ai, mutate: mutateAi } = useMobileSWR(sym ? `/api/earnings-analysis/${sym}?cached_only=1` : null, fetchResearchOverviewPart)
  const { prices } = useLivePrices(sym && header ? [sym] : [])

  const mutate = useCallback(() => {
    mutateMeta()
    mutateStats()
    mutateAnalyst()
    mutateAi()
  }, [mutateMeta, mutateStats, mutateAnalyst, mutateAi])

  const live = header ? prices && prices[sym] : null

  // Completeness audit 2026-10-07 (DES): the key-stats card printed "—" while its read was in
  // flight AND when the vendors failed AND when there was genuinely nothing on file. The compact
  // fundamentals read now carries `status` ("ok" | "unavailable" | "empty"); a pre-status cached
  // payload has none and counts as ok. `statsState` is what the card draws from.
  const statsState = !sym ? 'idle'
    : !stats ? 'loading'
      : !stats.ok ? 'error'
        : stats.body?.status === 'unavailable' ? 'unavailable'
          : stats.body?.status === 'empty' ? 'empty' : 'ok'

  return useMemo(() => ({
    sym,
    meta: (meta && meta.ok ? meta.body : null) || {},
    stats: (stats && stats.ok ? stats.body : null) || {},
    analyst: (analyst && analyst.ok ? analyst.body : null) || {},
    ai: (ai && ai.ok ? ai.body : null) || {},
    statsState,
    retryStats: mutateStats,
    // every composing read the tab draws (header-only reads excluded) is still in flight
    loading: Boolean(sym) && !stats && !analyst && !ai,
    aiLoading: Boolean(sym) && !ai,
    live: live || {},
    // tq-panels: `/api/earnings/intel/{sym}` answers 404 when the vendor holds no
    // consensus/target record for the name. That is "no earnings record", not an
    // outage -- it must not raise the "couldn't load" banner.
    analystMissing: Boolean(analyst && !analyst.ok && analyst.httpStatus === 404),
    error: Boolean((meta && !meta.ok) || (stats && !stats.ok)
      || (analyst && !analyst.ok && analyst.httpStatus !== 404) || (ai && !ai.ok)),
    mutate,
  }), [sym, meta, stats, analyst, ai, live, mutate, statsState, mutateStats])
}
