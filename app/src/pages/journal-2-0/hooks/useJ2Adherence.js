/**
 * Journal 2.0 — per-trade rule-adherence hook (P5-A4).
 *
 * SWR over `GET /api/j2/trades/{tradeId}/adherence` (returns the stored record
 * `{tradeRef, setup, checkedRuleIds, totalRules, adherencePct, updatedAt}` or
 * null when none exists yet). `save({setup, checkedRuleIds, totalRules})` PUTs
 * to the same endpoint and OPTIMISTICALLY writes the projected record into the
 * SWR cache first, reconciling from the server's stored record and rolling back
 * to server truth on error — mirroring TradeDetailPage's `patchTrade`.
 *
 * Fetch is skipped entirely when `tradeId` is null (the caller passes null when
 * the adherence feature flag is off), so a hidden card never hits the network.
 */

import { useCallback } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Adherence(tradeId) {
  const url = tradeId
    ? `/api/j2/trades/${encodeURIComponent(tradeId)}/adherence`
    : null

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const save = useCallback(
    async ({ setup, checkedRuleIds, totalRules }) => {
      if (!url) return undefined
      const checked = Array.isArray(checkedRuleIds) ? checkedRuleIds : []
      const total = Number.isFinite(totalRules) ? totalRules : 0
      const pct = total > 0 ? checked.length / total : 0

      // Optimistic: project the record locally so consumers repaint instantly.
      mutate(
        (cur) => ({
          ...(cur || {}),
          setup: setup ?? null,
          checkedRuleIds: checked,
          totalRules: total,
          adherencePct: pct,
        }),
        { revalidate: false },
      )

      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            setup: setup ?? null,
            checkedRuleIds: checked,
            totalRules: total,
          }),
        })
        if (!res.ok) throw new Error(`${res.status}`)
        const saved = await res.json()
        mutate(saved, { revalidate: false }) // reconcile to server truth
        return saved
      } catch (e) {
        mutate() // revalidate → roll back to server truth
        return undefined
      }
    },
    [url, mutate],
  )

  return {
    adherence: data ?? null,
    isLoading,
    error,
    save,
  }
}
