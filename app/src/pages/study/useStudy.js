// Study — the SWR hooks (spec §7.2: useStudyMap / useStudySession /
// useStudyProfile via useMobileSWR). One fetcher, one key per route, so a
// panel and a trail mounted together share the cache.
//
// A 404 (or a 402) resolves to null rather than throwing: `STUDY_ENABLED` off
// server-side answers 404 and the surfaces render their skeleton (T13); the
// client flag (`studyEnabled` on the auth payload) is what keeps them
// unmounted in that case. ANY OTHER non-OK answer (a 429 from the rate limit,
// a 5xx, a deploy's 502) THROWS, so a surface can say it failed and offer
// Try again instead of a skeleton that never resolves.
import useMobileSWR from '../../hooks/useMobileSWR'
import { shouldRetryOnErrorAppWide } from '../../lib/swrRetry'

export const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (r.ok) return r.json()
    // 404: Study is switched off. 402: no paid plan. Both mean "not available
    // here", which the surfaces already say; neither is a failure to retry.
    if (r.status === 404 || r.status === 402) return null
    const e = new Error(`HTTP ${r.status}`)
    e.status = r.status
    throw e
  })

// The app-wide rule (lib/swrRetry.js, App.jsx's SWR_CONFIG), CALLED rather than
// copied, plus ONE addition: a 429 is not retried here (the app-wide rule
// retries it) -- the limit says wait, and quick retries only spend more of it.
// The member's Try again asks again.
export const shouldRetryStudy = (err) =>
  err?.status !== 429 && shouldRetryOnErrorAppWide(err)

const OPTS = {
  revalidateOnFocus: false,
  dedupingInterval: 15_000,
  shouldRetryOnError: shouldRetryStudy,
}

/** Today's Study: prompts + bars inline, answered ids, session id, profile. */
export function useStudyToday(enabled = true) {
  return useMobileSWR(enabled ? '/api/study/today' : null, fetcher, OPTS)
}

/** The skill map plus this member's skill rows. */
export function useStudyMap(enabled = true) {
  return useMobileSWR(enabled ? '/api/study/map' : null, fetcher, { ...OPTS, dedupingInterval: 60_000 })
}

/** This week at the Desk: top 10 + you. */
export function useStudyLeaderboard(enabled = true) {
  return useMobileSWR(enabled ? '/api/study/leaderboard' : null, fetcher, { ...OPTS, dedupingInterval: 60_000 })
}

/** The member's study profile + badges (Settings → Study reads and writes it). */
export function useStudyProfile(enabled = true) {
  return useMobileSWR(enabled ? '/api/study/profile' : null, fetcher, OPTS)
}

/** PUT /api/study/profile — only the keys given are written. */
export async function putStudyProfile(patch) {
  const r = await fetch('/api/study/profile', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch || {}),
  })
  if (!r.ok) throw new Error(`profile save failed (${r.status})`)
  return r.json()
}
