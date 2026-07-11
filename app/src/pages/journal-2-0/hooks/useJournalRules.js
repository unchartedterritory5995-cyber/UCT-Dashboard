/**
 * Journal 2.0 — personal-rules hook (P6-6, "Make this a rule").
 *
 * SWR over `GET /api/j2/accounts/{accountId}/rules?status=active` (the P6-5
 * backend). Turns a recurring mistake into a persisted, evidence-linked personal
 * rule (a reminder). SUGGESTION-ONLY — it just stores + lists rules; it does NOT
 * change any trading behavior.
 *
 * Returns `{rules, isLoading, error, create(payload), dismiss(ruleId)}`:
 *   - `create({label, evidence?, sourceType?, sourceId?})` POSTs
 *     `/accounts/{accountId}/rules`, then `mutate()`s so the new rule appears in
 *     every subscriber's list (MakeRuleButton + MyRulesList share this SWR key).
 *   - `dismiss(ruleId)` OPTIMISTICALLY drops the rule from the cached list, POSTs
 *     `/rules/{ruleId}/dismiss`, and rolls back to server truth on error.
 *
 * Fetch is skipped entirely when `accountId` is null (the "all accounts"
 * aggregate has no per-account rules path), so a hidden surface never hits the
 * network. Mirrors `useJ2Adherence`'s SWR-with-mutate idiom.
 */

import { useCallback } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJournalRules(accountId) {
  const url = accountId
    ? `/api/j2/accounts/${encodeURIComponent(accountId)}/rules?status=active`
    : null

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const rules = Array.isArray(data) ? data : []

  const create = useCallback(
    async ({ label, evidence, sourceType, sourceId } = {}) => {
      if (!accountId) return undefined
      try {
        const res = await fetch(`/api/j2/accounts/${encodeURIComponent(accountId)}/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            label,
            evidence: evidence ?? null,
            sourceType: sourceType ?? null,
            sourceId: sourceId ?? null,
          }),
        })
        if (!res.ok) throw new Error(`${res.status}`)
        const saved = await res.json()
        mutate() // revalidate → the new rule shows in the list
        return saved
      } catch (e) {
        return undefined
      }
    },
    [accountId, mutate],
  )

  const dismiss = useCallback(
    async (ruleId) => {
      if (!ruleId) return undefined
      // Optimistic: drop it from the cached list so the row disappears instantly.
      mutate(
        (cur) => (Array.isArray(cur) ? cur.filter((r) => r.id !== ruleId) : cur),
        { revalidate: false },
      )
      try {
        const res = await fetch(`/api/j2/rules/${encodeURIComponent(ruleId)}/dismiss`, {
          method: 'POST',
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`${res.status}`)
        const dismissed = await res.json()
        return dismissed
      } catch (e) {
        mutate() // revalidate → roll back to server truth
        return undefined
      }
    },
    [mutate],
  )

  return {
    rules,
    isLoading: !!url && isLoading,
    error,
    create,
    dismiss,
  }
}
