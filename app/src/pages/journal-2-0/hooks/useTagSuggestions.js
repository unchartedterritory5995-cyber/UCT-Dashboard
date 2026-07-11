/**
 * Journal 2.0 — deterministic AI-suggested-tags hook (P6-4).
 *
 * SWR over `GET /api/j2/trades/{tradeId}/tag-suggestions` (returns
 * `{mistakes: [str], emotions: [str], reasons: {tag: reason}}`). Read-only —
 * accepting a suggestion writes through the EXISTING tag-PATCH path on the
 * caller (TradeDetailPage's `patchTrade`, RapidTagFlow's `mistakeSel` state),
 * never through this hook, so there's one write path for tags.
 *
 * Fetch is skipped entirely when `tradeId` is null (the caller passes null when
 * the `tagSuggest` feature flag is off), so a hidden chip row never hits the
 * network. Mirrors `useJ2Adherence`.
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useTagSuggestions(tradeId) {
  const url = tradeId
    ? `/api/j2/trades/${encodeURIComponent(tradeId)}/tag-suggestions`
    : null

  const { data, error, isLoading } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    suggestions: data ?? null,
    isLoading,
    error,
  }
}
