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
 * @param {{ wantRules: boolean }} opts  false: the rules are never fetched (null account).
 * @returns {{ settings: object|undefined, settingsState: 'loading'|'error'|'ready',
 *             retrySettings: () => void, rules: object[],
 *             rulesState: 'off'|'loading'|'no-account'|'no-accounts'|'accounts-error'|'error'|'ready' }}
 */
import { useCallback } from 'react'
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

  const settingsState = settings !== undefined && settings !== null
    ? 'ready'
    : (settingsError && !settingsLoading ? 'error' : 'loading')

  // Rules are per account. With no account selected there is no rule list to read, and WHY decides
  // the line (M-3): accounts failed, still loading, "All Accounts" chosen, no account at all, or the
  // first pick not made yet (a frame between accounts arriving and the selection effect). Only
  // "All Accounts" is "no-account"; the pending first pick reads as loading.
  let rulesState = 'off'
  if (wantRules) {
    if (!accountId) {
      // R-T7-3 N-2: SWR keeps the last accounts when a re-poll fails, so the error decides only when
      // there are none on hand (AccountSelector.jsx's own `!!error && accounts.length === 0`).
      const noAccounts = !Array.isArray(accounts) || accounts.length === 0
      if (!!accountsError && noAccounts) rulesState = 'accounts-error'
      else if (accountsLoading) rulesState = 'loading'
      else if (isAllAccounts) rulesState = 'no-account'
      else if (Array.isArray(accounts) && accounts.length === 0) rulesState = 'no-accounts'
      else rulesState = 'loading'
    } else if (rulesError) rulesState = 'error'
    else if (rulesLoading) rulesState = 'loading'
    else rulesState = 'ready'
  }

  const retrySettings = useCallback(() => { if (typeof refresh === 'function') refresh() }, [refresh])

  return {
    settings: settingsState === 'ready' ? settings : undefined,
    settingsState,
    retrySettings,
    rules: rulesState === 'ready' && Array.isArray(rules) ? rules : [],
    rulesState,
  }
}
