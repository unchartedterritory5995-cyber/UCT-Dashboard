// app/src/hooks/useEarningsBrief.js
//
// §4.3.3 / §7: stepping never auto-fires the LLM path. A symbol reached by
// arrow/chevron requests `?cached_only=1` — a probe that does no provider work
// at all — and the section offers "Generate brief" if nothing is cached. A
// symbol opened by CLICK requests the normal endpoint, which is the existing
// (cost-guarded, cached) behaviour.
import { useCallback, useRef, useState } from 'react'
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

  // Review round 1, C1 — CRITICAL: `cachedOnly` alone (sourced from the
  // caller's `stepping` flag) does NOT gate the shipped GATE. `stepping` is
  // `rawSym !== settledSym` (useSettledSym.js) and this hook is fed
  // `settledSym`, so by construction `stepping` is ALREADY false at the exact
  // render where `sym` (this hook's `s`) becomes the new symbol — the flag
  // and "sym just changed" can never be true in the same render, no matter
  // how a caller wires it. Trusting it means the panel silently un-gates the
  // LLM endpoint the instant every step settles.
  //
  // Gate on IDENTITY instead: `firstSym` is the symbol this hook instance
  // first saw (i.e. the one the modal was opened on) and — being a ref — it
  // never changes for the life of the instance. On a mounted instance `s`
  // only ever changes via a step (there is no other route to a new symbol
  // without a remount), so "not the first symbol" IS "reached by stepping",
  // independent of `stepping`'s flawed timing. `cachedOnly` stays as an OR'd
  // input so an explicit caller override still works.
  const firstSym = useRef(s)
  const wantCached = (cachedOnly || s !== firstSym.current) && !escalated
  const key = s
    ? `/api/earnings-analysis/${encodeURIComponent(s)}${wantCached ? '?cached_only=1' : ''}`
    : null

  const { data, isLoading, mutate } = useSWR(key, fetcher, {
    refreshInterval: 0, revalidateOnFocus: false, shouldRetryOnError: false,
    // The LLM path can take 12-18s cold; do not let SWR fire a second one.
    dedupingInterval: 5 * 60 * 1000,
  })

  // M1: `generate` used to also call `mutate()` here — redundant. Flipping
  // `escalated` changes `key` (drops `?cached_only=1`), and a KEY change is
  // already what makes SWR fetch; the extra `mutate()` fired a SECOND request
  // against the still-current (about-to-be-stale) key on a 10/minute endpoint.
  const generate = useCallback(() => { setEscalated(true) }, [])
  // A plain revalidate of the CURRENT key — for retrying a failed fetch
  // without changing cached-only/escalated semantics (a network blip on a
  // cached-only probe should retry the probe, not silently start billing).
  const retry = useCallback(() => { mutate() }, [mutate])

  return { data: data || null, isLoading: isLoading && !data, generate, retry }
}
