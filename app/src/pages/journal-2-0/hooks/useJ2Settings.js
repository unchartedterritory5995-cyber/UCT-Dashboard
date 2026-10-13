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

// `enabled` defaults to true (see useJ2Accounts.js) and is threaded through
// to useJ2SelectedAccount — every existing caller omits it and is unaffected.
// Root-mounted callers (every visitor, signed in or not) pass it so neither
// `/api/j2/accounts/{id}/settings` nor its `/api/j2/settings` fallback fires
// before a member is actually signed in.
/** WHY accountId is null, or null when an account is selected. SWR keeps the last accounts when a
 *  re-poll fails, so the error decides only when none are on hand (AccountSelector.jsx's precedent);
 *  "All Accounts" of no accounts at all is not a choice, so no accounts wins over it. */
function noAccountReason({ accountId, accountsLoading, isAllAccounts, accountsError, accounts }) {
  if (accountId != null) return null
  const list = Array.isArray(accounts) ? accounts : []
  if (accountsError && list.length === 0) return 'accounts-error'
  if (accountsLoading) return 'pending'
  if (list.length === 0) return 'no-accounts'
  if (isAllAccounts) return 'all'
  return 'pending'
}

export default function useJ2Settings(enabled = true) {
  const {
    accountId, account, isLoading: accountsLoading, isAllAccounts, accountsError, accounts,
  } = useJ2SelectedAccount(enabled)
  // When no account selected (initial load) we still want SOMETHING readable;
  // hit the legacy global settings endpoint as a backstop. Once an account
  // is picked, switch to per-account.
  const url = !enabled
    ? null
    : accountId
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
        // FastAPI returns {"detail": "..."} for HTTPException — extract the
        // human-readable string instead of dumping the raw JSON to the UI.
        const body = await res.text()
        let msg = body
        try {
          const parsed = JSON.parse(body)
          if (parsed && typeof parsed.detail === 'string') msg = parsed.detail
          else if (Array.isArray(parsed?.detail)) {
            msg = parsed.detail
              .map((d) => d?.msg || JSON.stringify(d))
              .join('; ')
          }
        } catch { /* not JSON — fall back to raw text */ }
        throw new Error(msg || `save failed (${res.status})`)
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
    // R-M2-1 (b): no SPECIFIC account is selected (All Accounts, no pick yet, or accounts failing).
    // Not "is all accounts": that name belongs to useJ2SelectedAccount alone.
    noSpecificAccount: accountId == null,
    // R-M2-2 M-2: WHY no specific account is selected (null when one is), so a screen can say the true
    // reason: 'all' (the member chose All Accounts), 'pending' (accounts loading, or the first pick not
    // made yet), 'accounts-error' (failed, none on hand), 'no-accounts'. The sizing seam's order.
    noAccountReason: noAccountReason({ accountId, accountsLoading, isAllAccounts, accountsError, accounts }),
  }
}
