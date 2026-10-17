// Study — the SWR hooks (spec §7.2: useStudyMap / useStudySession /
// useStudyProfile via useMobileSWR). One fetcher, one key per route, so a
// panel and a trail mounted together share the cache.
//
// A non-OK answer resolves to null rather than throwing: `STUDY_ENABLED`
// off server-side answers 404 and the surfaces render their skeleton (T13)
// instead of an error — the client flag (`studyEnabled` on the auth payload)
// is what keeps them unmounted in that case.
import useMobileSWR from '../../hooks/useMobileSWR'

export const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const OPTS = { revalidateOnFocus: false, dedupingInterval: 15_000 }

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
