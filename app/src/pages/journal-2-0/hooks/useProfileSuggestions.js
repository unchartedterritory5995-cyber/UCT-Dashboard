/**
 * Pending profile suggestions hook — SWR + dismiss action.
 */
import useSWR from 'swr'
import { useCallback } from 'react'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useProfileSuggestions(accountId) {
  const url = accountId
    ? `/api/j2/accounts/${accountId}/coach/profile-suggestions`
    : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
    shouldRetryOnError: false,
  })

  const dismiss = useCallback(async (id) => {
    if (!accountId || !id) return
    await fetch(`/api/j2/accounts/${accountId}/coach/profile-suggestions/${id}/dismiss`, {
      method: 'POST', credentials: 'include',
    })
    await mutate()
  }, [accountId, mutate])

  return {
    suggestions: data?.suggestions ?? [],
    isLoading,
    error,
    dismiss,
    refresh: mutate,
  }
}
