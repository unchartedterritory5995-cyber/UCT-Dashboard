import useMobileSWR from '../../../hooks/useMobileSWR'

// Chart/Technical Intelligence Convergence (owner authorization, Phase B).
// Reuses the EXISTING, already-shipped `/api/patterns/{sym}` endpoint as-is —
// no new backend service. `confirmed_only` defaults to true server-side,
// which is deliberate and load-bearing: the raw rule-engine firehose was
// ruled untrustworthy by the owner (the Opus-vision judge confirms only
// ~16% of raw candidates) and an earlier Patterns page built on the raw feed
// was retired over exactly this. This hook must never pass
// confirmed_only=false — that would resurface the same problem inside
// canonical Research.
const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useTechnical(rawSym, tf = 'D') {
  const sym = (rawSym || '').toUpperCase().trim()
  const { data, isLoading } = useMobileSWR(
    sym ? `/api/patterns/${sym}?tf=${encodeURIComponent(tf)}` : null,
    fetcher,
  )
  return { data: data || null, isLoading: isLoading && !data }
}
