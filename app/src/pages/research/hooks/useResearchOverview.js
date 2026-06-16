import useMobileSWR from '../../../hooks/useMobileSWR'
import useLivePrices from '../../../hooks/useLivePrices'

// Shared fetcher — null on any non-OK / error so cards fall back to "—".
const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

// Phase 1: compose the Overview tab from existing endpoints. No new backend.
export default function useResearchOverview(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()

  const { data: meta } = useMobileSWR(sym ? `/api/ticker-meta/${sym}` : null, fetcher)
  const { data: stats } = useMobileSWR(sym ? `/api/fundamentals/${sym}` : null, fetcher)
  const { data: analyst } = useMobileSWR(sym ? `/api/earnings/intel/${sym}` : null, fetcher)
  const { data: ai } = useMobileSWR(sym ? `/api/earnings-analysis/${sym}` : null, fetcher)
  const { prices } = useLivePrices(sym ? [sym] : [])

  return {
    sym,
    meta: meta || {},
    stats: stats || {},
    analyst: analyst || {},
    ai: ai || {},
    live: (prices && prices[sym]) || {},
  }
}
