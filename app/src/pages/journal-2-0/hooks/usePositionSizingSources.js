/**
 * The position sizing block's ONE read seam (Notebook P2a, Task 11; integration ruling R-M2-1 a).
 *
 * It composes the Journal's settings, selected-account, accounts and regime SWR reads and hands back
 * DATA ONLY. Those hooks also carry writes (`useJ2Settings().save`, `useJ2SelectedAccount().setAccount`),
 * and spec §P2's integrity rule allows a block no second write door, so the block imports this module
 * (named in lib/blocks/blockDoors.test.js IMPORT_ALLOW, scanned there by rule ⑤) instead of the hooks.
 * The return shape is RETURN_KEYS below; usePositionSizingSources.test.js reads it.
 *
 * ⛔ C-1 (R-T11-1, R-T11-2 N-1): with no SPECIFIC account selected (accountId == null: All Accounts,
 * the first pick not made yet, accounts loading or failing) useJ2Settings reads the frozen legacy
 * j2_settings row, which is not any account's size. The seam never hands it on: `settings` is
 * present only when accountId != null. THE RULE IS accountId == null; useJ2SelectedAccount's
 * `isAllAccounts` only chooses which `accountState` (and so which sentence) explains the missing size.
 *
 * @returns {{
 *   settings: object|undefined,
 *   settingsState: 'off'|'loading'|'error'|'ready',      // 'off': no specific account to read
 *   retrySettings: () => void,                             // a re-read (SWR revalidate), never a write
 *   accountState: 'specific'|'all'|'pending'|'accounts-error'|'no-accounts',
 *   accountName: string|undefined,
 *   retryAccounts: () => void,                             // a re-read of the accounts list
 *   regime: object|undefined,                              // GET /api/j2/regime as served
 * }}
 */
import { useCallback } from 'react'
import useJ2Settings from './useJ2Settings'
import useJ2SelectedAccount from './useJ2SelectedAccount'
import useJ2Accounts from './useJ2Accounts'
import useJ2CurrentRegime from './useJ2CurrentRegime'

/** The ONE copy of this seam's return shape. usePositionSizingSources.test.js reads it, and
 *  lib/blocks/blockDoors.test.js (⑤) requires the literal return below to carry exactly these keys. */
export const RETURN_KEYS = Object.freeze([
  'settings', 'settingsState', 'retrySettings', 'accountState', 'accountName', 'retryAccounts', 'regime',
])

export default function usePositionSizingSources() {
  const { settings, isLoading: settingsLoading, error: settingsError, refresh } = useJ2Settings()
  const {
    accountId, isLoading: accountsLoading, isAllAccounts, accountsError, accounts,
  } = useJ2SelectedAccount()
  const { refresh: refreshAccounts } = useJ2Accounts()
  const { regime } = useJ2CurrentRegime()

  // WHICH account sizes the trade. Only accountId != null is "specific" (C-1). The rest pick a sentence:
  // accounts failed (SWR keeps the last list when a re-poll fails, so the error decides only when none
  // are on hand, AccountSelector.jsx's own precedent), still loading, no accounts at all (whatever is
  // stored: "All Accounts" of none is not a choice), All Accounts chosen, or the first pick not made yet
  // (pending, never "pick one").
  const list = Array.isArray(accounts) ? accounts : []
  let accountState = 'specific'
  if (accountId == null) {
    if (!!accountsError && list.length === 0) accountState = 'accounts-error'
    else if (accountsLoading) accountState = 'pending'
    else if (list.length === 0) accountState = 'no-accounts'
    else if (isAllAccounts) accountState = 'all'
    else accountState = 'pending'
  }

  const settingsState = accountState !== 'specific'
    ? 'off'
    : settings !== undefined && settings !== null
      ? 'ready'
      : (settingsError && !settingsLoading ? 'error' : 'loading')

  const retrySettings = useCallback(() => { if (typeof refresh === 'function') refresh() }, [refresh])
  const retryAccounts = useCallback(() => { if (typeof refreshAccounts === 'function') refreshAccounts() }, [refreshAccounts])

  return {
    settings: settingsState === 'ready' ? settings : undefined,
    settingsState,
    retrySettings,
    accountState,
    accountName: accountState === 'specific' ? list.find((a) => a?.id === accountId)?.name : undefined,
    retryAccounts,
    regime,
  }
}
