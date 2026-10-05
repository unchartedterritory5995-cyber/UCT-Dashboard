import { useMemo } from 'react'
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
//
// TERM-088 -- a failed read is not "nothing confirmed". The old fetcher
// collapsed a 5xx/404/dropped-connection into the same `null` TechnicalTab
// renders for a ticker with zero confirmed setups, which would tell a member
// "no confirmed technical setups" during an outage -- a false statement
// about the ticker. See useDecisionRecord.js for the canonical shape: the
// fetcher keeps the HTTP outcome instead of guessing.
export async function fetchTechnical(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useTechnical(rawSym, tf = 'D') {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym ? `/api/patterns/${sym}?tf=${encodeURIComponent(tf)}` : null
  const { data, isLoading, mutate } = useMobileSWR(key, fetchTechnical)
  return useMemo(() => ({
    data: data ? data.body : null,
    isLoading: Boolean(isLoading && !data),
    error: Boolean(data && !data.ok),
    mutate,
  }), [data, isLoading, mutate])
}
