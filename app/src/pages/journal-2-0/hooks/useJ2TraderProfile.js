/**
 * SWR hook for the Compass Trader Profile.
 *
 * Per-account mode: /api/j2/accounts/{id}/coach/profile (returns {profile}).
 * Unified mode (accountId === null): /api/j2/unified-coach
 *   GET returns {traderProfile, compassEnabled, onboarded}
 *   PUT accepts {traderProfile}
 * The hook normalizes both shapes to a plain `profile` string + `save(str)`.
 */

import useSWR from 'swr'
import { compassScope, UNIFIED_ACCOUNT_ID } from './compassScope'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2TraderProfile(accountId) {
  const scope = compassScope(accountId)
  const unified = scope === UNIFIED_ACCOUNT_ID
  const url = unified
    ? '/api/j2/unified-coach'
    : `/api/j2/accounts/${scope}/coach/profile`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const profile = unified
    ? (data?.traderProfile ?? '')
    : (data?.profile ?? '')

  return {
    profile,
    isLoading,
    error,
    refresh: () => mutate(),
    save: async (next) => {
      const r = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(unified ? { traderProfile: next } : { profile: next }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const out = await r.json()
      await mutate(out, { revalidate: false })
      return out
    },
  }
}
