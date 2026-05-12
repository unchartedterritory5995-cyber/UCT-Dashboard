/**
 * useInterventions — SWR-fetched active interventions, with dismiss action.
 *
 * `evaluate=true` triggers rule evaluation (writes to DB). `evaluate=false`
 * just reads. Default true.
 */
import useSWR from 'swr'
import { useCallback } from 'react'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useInterventions(accountId, { evaluate = true } = {}) {
  const url = accountId
    ? `/api/j2/accounts/${accountId}/coach/interventions/active?evaluate=${evaluate ? 'true' : 'false'}`
    : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60000,   // 1-min light polling — rules can change as trades close
    shouldRetryOnError: false,
  })

  const dismiss = useCallback(async (id) => {
    if (!accountId || !id) return
    await fetch(`/api/j2/accounts/${accountId}/coach/interventions/${id}/dismiss`, {
      method: 'POST', credentials: 'include',
    })
    await mutate()
  }, [accountId, mutate])

  return {
    interventions: data?.interventions ?? [],
    isLoading,
    error,
    dismiss,
    refresh: mutate,
  }
}
