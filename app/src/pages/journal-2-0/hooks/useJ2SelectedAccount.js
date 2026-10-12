/**
 * Currently-selected account, persisted to localStorage. Used by every
 * J2.0 read hook to scope queries.
 *
 * Returns `{ accountId, account, accounts, setAccount, isLoading, isAllAccounts, accountsError }`:
 *   - accountId: string | null. null is "All Accounts", but ALSO "no pick yet" and "accounts
 *     failed"; `isAllAccounts` is the one that means All Accounts. This hook is the ONE owner of
 *     that name (R-M2-1 b): useJ2Settings says `noSpecificAccount` for accountId == null instead.
 *   - account: full account object | null when accountId is null
 *   - setAccount(id | null): updates selection + persists (null = All Accounts)
 *   - isAllAccounts: the selection is the "All Accounts" sentinel. Derived from this tab's hook STATE
 *     (the raw selection), so it always agrees with accountId. A selection made in another tab does
 *     not move this tab (no cross-tab sync).
 *   - accountsError: useJ2Accounts' read error, passed through
 *
 * On first load: picks the first account in the user's list (typically
 * "Default") if no localStorage value or the stored ID is now invalid.
 */

import { useCallback, useEffect, useState } from 'react'
import useJ2Accounts from './useJ2Accounts'

const STORAGE_KEY = 'uct.j2.selectedAccountId'
// Sentinel for "all accounts": stored as the literal string "_all_".
const ALL_ACCOUNTS = '_all_'
// Custom event so every hook instance in the tab stays in sync when any
// caller of setAccount changes the selection. (The native `storage` event
// only fires cross-tab.)
const CHANGE_EVENT = 'uct:j2:selected-account-changed'

// `enabled` defaults to true (see useJ2Accounts.js) and is threaded straight
// through to it — every existing caller omits it and is unaffected.
export default function useJ2SelectedAccount(enabled = true) {
  const { accounts, isLoading, error: accountsError } = useJ2Accounts(enabled)
  // The RAW selection: ALL_ACCOUNTS, an account id, or null (nothing picked yet). accountId and
  // isAllAccounts are both derived from it, so they can never disagree.
  const [selection, setSelection] = useState(() => localStorage.getItem(STORAGE_KEY) || null)
  const accountId = selection === ALL_ACCOUNTS ? null : selection

  // Subscribe to in-tab change events fired by any other hook instance (an id of null is
  // setAccount(null), All Accounts). No cross-tab sync (R-T7-4): another tab's pick never moves this one.
  useEffect(() => {
    const handler = (e) => setSelection(e.detail?.id == null ? ALL_ACCOUNTS : e.detail.id)
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  // Once accounts arrive, validate the stored ID — if it doesn't exist
  // anymore, fall back to the first account.
  useEffect(() => {
    if (isLoading || accounts.length === 0) return
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === ALL_ACCOUNTS) {
      if (selection !== ALL_ACCOUNTS) setSelection(ALL_ACCOUNTS)
      return
    }
    const exists = stored && accounts.some((a) => a.id === stored)
    if (!stored || !exists) {
      const firstId = accounts[0].id
      setSelection(firstId)
      localStorage.setItem(STORAGE_KEY, firstId)
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { id: firstId } }))
    } else if (selection !== stored) {
      setSelection(stored)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, isLoading])

  const setAccount = useCallback((id) => {
    setSelection(id === null ? ALL_ACCOUNTS : id)
    if (id === null) localStorage.setItem(STORAGE_KEY, ALL_ACCOUNTS)
    else localStorage.setItem(STORAGE_KEY, id)
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { id } }))
  }, [])

  const account = accountId
    ? accounts.find((a) => a.id === accountId) || null
    : null

  return { accountId, account, accounts, setAccount, isLoading, isAllAccounts: selection === ALL_ACCOUNTS, accountsError }
}
