/**
 * Currently-selected account, persisted to localStorage. Used by every
 * J2.0 read hook to scope queries.
 *
 * Returns `{ accountId, account, setAccount }` where:
 *   - accountId: string | null  (null = "All Accounts" aggregate view)
 *   - account: full account object | null when "All Accounts"
 *   - setAccount(id | null): updates selection + persists
 *
 * On first load: picks the first account in the user's list (typically
 * "Default") if no localStorage value or the stored ID is now invalid.
 */

import { useCallback, useEffect, useState } from 'react'
import useJ2Accounts from './useJ2Accounts'

const STORAGE_KEY = 'uct.j2.selectedAccountId'
// Sentinel for "all accounts": stored as the literal string "_all_".
const ALL_ACCOUNTS = '_all_'

export default function useJ2SelectedAccount() {
  const { accounts, isLoading } = useJ2Accounts()
  const [accountId, setAccountIdState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === ALL_ACCOUNTS) return null
    return stored || null
  })

  // Once accounts arrive, validate the stored ID — if it doesn't exist
  // anymore, fall back to the first account.
  useEffect(() => {
    if (isLoading || accounts.length === 0) return
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === ALL_ACCOUNTS) {
      if (accountId !== null) setAccountIdState(null)
      return
    }
    const exists = stored && accounts.some((a) => a.id === stored)
    if (!stored || !exists) {
      const firstId = accounts[0].id
      setAccountIdState(firstId)
      localStorage.setItem(STORAGE_KEY, firstId)
    } else if (accountId !== stored) {
      setAccountIdState(stored)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, isLoading])

  const setAccount = useCallback((id) => {
    setAccountIdState(id)
    if (id === null) localStorage.setItem(STORAGE_KEY, ALL_ACCOUNTS)
    else localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const account = accountId
    ? accounts.find((a) => a.id === accountId) || null
    : null

  return { accountId, account, accounts, setAccount, isLoading }
}
