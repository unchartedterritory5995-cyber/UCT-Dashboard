// app/src/hooks/useEarningsBrief.js
//
// §4.3.3 / §7: stepping never auto-fires the LLM path. A symbol reached by
// arrow/chevron requests `?cached_only=1` — a probe that does no provider work
// at all — and the section offers "Generate brief" if nothing is cached. A
// symbol opened by CLICK requests the normal endpoint, which is the existing
// (cost-guarded, cached) behaviour.
import { useCallback, useState } from 'react'
import useSWR from 'swr'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)

export default function useEarningsBrief(sym, { cachedOnly = false } = {}) {
  const s = (sym || '').toUpperCase().trim()

  const [escalated, setEscalated] = useState(false)
  // This hook instance persists across arrow-steps — BriefSection never
  // remounts while the rail stays on "Brief", only its `sym` prop changes —
  // so an explicit Generate on symbol A would otherwise carry `escalated`
  // straight over to symbol B the instant the user steps there, silently
  // auto-firing the LLM on B. That is exactly what the GATE forbids. The
  // reset is done DURING RENDER (comparing against a tracked-symbol tieback),
  // not in a `useEffect` — an effect-based reset lets the render that fires
  // BEFORE the effect runs compute the stale (unescalated→escalated) key, and
  // SWR starts that fetch off of render output, not off the effect. One
  // real LLM call would already be in flight by the time the effect "fixed"
  // it. Adjusting state during render (React's sanctioned pattern for "reset
  // derived state when a prop changes") means the very first render for the
  // new symbol already sees the corrected value.
  const [trackedSym, setTrackedSym] = useState(s)
  if (s !== trackedSym) {
    setTrackedSym(s)
    setEscalated(false)
  }

  const wantCached = cachedOnly && !escalated
  const key = s
    ? `/api/earnings-analysis/${encodeURIComponent(s)}${wantCached ? '?cached_only=1' : ''}`
    : null

  const { data, isLoading, mutate } = useSWR(key, fetcher, {
    refreshInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false,
    // The LLM path can take 12-18s cold; do not let SWR fire a second one.
    dedupingInterval: 5 * 60 * 1000,
  })

  const generate = useCallback(() => { setEscalated(true); mutate() }, [mutate])

  return { data: data || null, isLoading: isLoading && !data, generate, escalated }
}
