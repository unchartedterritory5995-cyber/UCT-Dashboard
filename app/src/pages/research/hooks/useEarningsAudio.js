import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'

// TERM-088 -- earnings call audio (TRAN). A failed read is not "no audio for
// this ticker"; see useDecisionRecord.js for why the fetcher keeps the HTTP
// outcome instead of collapsing a non-2xx into null.
export async function fetchEarningsAudio(url) {
  try {
    const r = await fetch(url, { credentials: 'include' })
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useEarningsAudio(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym ? `/api/earnings/audio/${sym}` : null
  const { data, isLoading, mutate } = useMobileSWR(key, fetchEarningsAudio)
  return useMemo(() => ({
    data: data ? data.body : null,
    isLoading: Boolean(isLoading && !data),
    error: Boolean(data && !data.ok),
    mutate,
  }), [data, isLoading, mutate])
}
