import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { withDeadline } from '../../../utils/withDeadline'

// Packet H CP1: every curated Model Book appearance for this ticker, across
// all years -- keyed off the SETTLED symbol, same convention as every other
// tab's hook on this page.
//
// TERM-088 -- MB tab. A failed read is not "never in the Model Book"; see
// useDecisionRecord.js for why the fetcher keeps the HTTP outcome instead of
// collapsing a non-2xx into null.
export async function fetchModelBookAppearances(url) {
  try {
    const r = await withDeadline(fetch(url, { credentials: 'include' }), url)
    if (!r.ok) return { ok: false, httpStatus: r.status, body: null }
    return { ok: true, httpStatus: r.status, body: await r.json() }
  } catch {
    return { ok: false, httpStatus: 0, body: null }
  }
}

export default function useModelBookAppearances(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = sym ? `/api/modelbook/appearances/${sym}` : null
  const { data, isLoading, mutate } = useMobileSWR(key, fetchModelBookAppearances)
  return useMemo(() => ({
    data: data ? data.body : null,
    isLoading: Boolean(isLoading && !data),
    // tq-panels: 402 is the paid gate -- a state with its own sentence, not "couldn't load".
    // (This fetcher keeps {ok, httpStatus}, so sectionFetcher's {paywalled} never applied.)
    paywalled: Boolean(data && !data.ok && data.httpStatus === 402),
    error: Boolean(data && !data.ok && data.httpStatus !== 402),
    mutate,
  }), [data, isLoading, mutate])
}
