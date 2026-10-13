/**
 * The pre-entry checklist's ONE read seam (Notebook P2a, Task 7; Log Trade's checklist, Task 8, reads
 * through it too).
 *
 * It composes the Journal's own SWR read hooks and hands back DATA ONLY. Those hooks also carry
 * writes (`useJ2Settings().save`, `useJournalRules().create` / `.dismiss`), and spec §P2's integrity
 * rule allows a block no second write door, so a block file imports this module (named in
 * lib/blocks/blockDoors.test.js IMPORT_ALLOW) instead of the three hooks. The return shape is pinned
 * key by key in useChecklistSources.test.js; adding a key there is a decision, not a tidy-up.
 *
 * `settingsState` / `rulesState` keep "not answered yet" and "failed" apart from "answered with
 * nothing", so the checklist never tells a member "you have no setups" or "no rules are marked"
 * while it simply has not heard back.
 *
 * ⛔ R-M2-1 (c), the C-1 class: with no SPECIFIC account selected (accountId == null: All Accounts, the
 * first pick not made yet, accounts loading or failing) useJ2Settings reads the frozen legacy
 * j2_settings row, which is not any account's setups. The seam never hands it on: `settings` is absent
 * and `settingsState` names the reason, the same one `rulesState` carries.
 *
 * @param {{ wantRules: boolean }} opts  false: the rules are never fetched (null account).
 * @returns {{ settings: object|undefined,
 *             settingsState: 'loading'|'error'|'ready'|'no-account'|'no-accounts'|'accounts-error',
 *             retrySettings: () => void, rules: object[],
 *             rulesState: 'off'|'loading'|'no-account'|'no-accounts'|'accounts-error'|'error'|'ready' }}
 */
import { useCallback, useRef } from 'react'
import useJ2Settings from './useJ2Settings'
import useJ2SelectedAccount from './useJ2SelectedAccount'
import useJournalRules from './useJournalRules'

/** The ONE copy of this seam's return shape. useChecklistSources.test.js reads it, and
 *  lib/blocks/blockDoors.test.js (⑤) requires the literal return below to carry exactly these keys. */
export const RETURN_KEYS = Object.freeze(['settings', 'settingsState', 'retrySettings', 'rules', 'rulesState'])

export default function useChecklistSources({ wantRules }) {
  const { settings, isLoading: settingsLoading, error: settingsError, refresh } = useJ2Settings()
  const {
    accountId, isLoading: accountsLoading, isAllAccounts, accountsError, accounts,
  } = useJ2SelectedAccount()
  const { rules, isLoading: rulesLoading, error: rulesError } = useJournalRules(wantRules ? accountId : null)

  // WHY no specific account is selected, or null when one is (M-3): accounts failed, still loading,
  // "All Accounts" chosen, no account at all, or the first pick not made yet (a frame between accounts
  // arriving and the selection effect). Only "All Accounts" is "no-account"; the pending first pick
  // reads as loading.
  let accountState = null
  if (!accountId) {
    // R-T7-3 N-2: SWR keeps the last accounts when a re-poll fails, so the error decides only when
    // there are none on hand (AccountSelector.jsx's own `!!error && accounts.length === 0`).
    const noAccounts = !Array.isArray(accounts) || accounts.length === 0
    if (!!accountsError && noAccounts) accountState = 'accounts-error'
    else if (accountsLoading) accountState = 'loading'
    else if (Array.isArray(accounts) && accounts.length === 0) accountState = 'no-accounts'   // before All Accounts: "All" of none is not a choice
    else if (isAllAccounts) accountState = 'no-account'
    else accountState = 'loading'
  }

  // C-1: the settings are one account's only when one account is selected.
  const settingsState = accountState
    || (settings !== undefined && settings !== null
      ? 'ready'
      : (settingsError && !settingsLoading ? 'error' : 'loading'))

  // Rules are per account. With no account selected there is no rule list to read, and the account
  // state says why.
  let rulesState = 'off'
  if (wantRules) {
    if (accountState) rulesState = accountState
    else if (rulesError) rulesState = 'error'
    else if (rulesLoading) rulesState = 'loading'
    else rulesState = 'ready'
  }

  // H14 (R-M2-2 M-1): useJ2Settings hands back a NEW `refresh` every render (`() => mutate()`). The latest
  // one is held in a ref, so retrySettings keeps ONE identity and still reaches it.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const retrySettings = useCallback(() => { if (typeof refreshRef.current === 'function') refreshRef.current() }, [])

  return {
    settings: settingsState === 'ready' ? settings : undefined,
    settingsState,
    retrySettings,
    rules: rulesState === 'ready' && Array.isArray(rules) ? rules : [],
    rulesState,
  }
}
