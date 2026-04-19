/**
 * Journal 2.0 — settings hook (per-account, post-Phase-2).
 *
 * Reads + writes settings for the currently-selected account via
 * /api/j2/accounts/{id}/settings. When "All Accounts" is selected,
 * the server auto-resolves to the user's Default account so reads
 * always return a usable settings object — but the Settings modal
 * disables the Save action and shows a banner explaining writes only
 * apply to a single account.
 */

import useSWR from 'swr'
import { useCallback } from 'react'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Settings() {
  const { accountId, account } = useJ2SelectedAccount()
  // When no account selected (initial load) we still want SOMETHING readable;
  // hit the legacy global settings endpoint as a backstop. Once an account
  // is picked, switch to per-account.
  const url = accountId
    ? `/api/j2/accounts/${accountId}/settings`
    : '/api/j2/settings'

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const save = useCallback(
    async (payload) => {
      if (!accountId) {
        throw new Error(
          'Select a single account to save settings (currently in All Accounts mode).',
        )
      }
      const res = await fetch(`/api/j2/accounts/${accountId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(body || `save failed (${res.status})`)
      }
      const saved = await res.json()
      await mutate(saved, { revalidate: false })
      return saved
    },
    [mutate, accountId],
  )

  return {
    settings: data,
    isLoading,
    error,
    save,
    refresh: () => mutate(),
    accountId,
    accountName: account?.name,
    isAllAccounts: accountId == null,
  }
}
