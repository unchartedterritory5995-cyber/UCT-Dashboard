/**
 * useInterventions — SWR-fetched active interventions, with dismiss action.
 *
 * `evaluate=true` triggers rule evaluation (writes to DB). `evaluate=false`
 * just reads. Default true.
 */
import useSWR from 'swr'
import { useCallback } from 'react'
import { compassScope } from './compassScope'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useInterventions(accountId, { evaluate = true } = {}) {
  // null accountId → '_all_' → portfolio-level tilt rules.
  const scope = compassScope(accountId)
  const url = `/api/j2/accounts/${scope}/coach/interventions/active?evaluate=${evaluate ? 'true' : 'false'}`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60000,   // 1-min light polling — rules can change as trades close
    shouldRetryOnError: false,
  })

  const dismiss = useCallback(async (id) => {
    if (!id) return
    await fetch(`/api/j2/accounts/${scope}/coach/interventions/${id}/dismiss`, {
      method: 'POST', credentials: 'include',
    })
    await mutate()
  }, [scope, mutate])

  return {
    interventions: data?.interventions ?? [],
    isLoading,
    error,
    dismiss,
    refresh: mutate,
  }
}
