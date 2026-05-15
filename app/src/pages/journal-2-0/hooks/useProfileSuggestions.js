/**
 * Pending profile suggestions hook — SWR + dismiss action.
 */
import useSWR from 'swr'
import { useCallback } from 'react'
import { compassScope } from './compassScope'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useProfileSuggestions(accountId) {
  const scope = compassScope(accountId)
  const url = `/api/j2/accounts/${scope}/coach/profile-suggestions`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
    shouldRetryOnError: false,
  })

  const dismiss = useCallback(async (id) => {
    if (!id) return
    await fetch(`/api/j2/accounts/${scope}/coach/profile-suggestions/${id}/dismiss`, {
      method: 'POST', credentials: 'include',
    })
    await mutate()
  }, [scope, mutate])

  return {
    suggestions: data?.suggestions ?? [],
    isLoading,
    error,
    dismiss,
    refresh: mutate,
  }
}
