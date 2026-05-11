/**
 * SWR hook for the Compass Trader Profile (markdown blob per account).
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2TraderProfile(accountId) {
  const url = accountId ? `/api/j2/accounts/${accountId}/coach/profile` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    profile: data?.profile ?? '',
    isLoading,
    error,
    refresh: () => mutate(),
    save: async (profile) => {
      const r = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const out = await r.json()
      await mutate({ profile: out.profile }, { revalidate: false })
      return out
    },
  }
}
