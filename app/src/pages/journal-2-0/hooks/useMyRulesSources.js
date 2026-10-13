/**
 * The My rules block's ONE read seam (Notebook P2b, Task 8; ruling R-PF-B8).
 *
 * The block lists the selected account's rules and edits them through lib/blocks/rulesApi.js (the
 * one rule write a block file may make, named in lib/blocks/blockDoors.test.js WRITE_EXCEPTIONS).
 * useJournalRules also carries create and dismiss, and a block may hold no second write door
 * (spec §P2 integrity rule), so the block imports this module instead of the hooks. It hands back
 * DATA, one re-read and one cache write: `refresh` asks the server again (SWR's `mutate()` with no
 * argument), and `showSaved(rule)` puts the rule the server just answered with into the cached list
 * at once, then re-reads (fix round 1, m6: the switch moves before the re-read answers). Neither
 * writes to the server; the one rule write is rulesApi.editRule. The re-read is what carries an edited
 * rule to every reader of the list, the pre-entry checklist too.
 *
 * ⛔ C-1 (preflight D8): with no SPECIFIC account selected there is no rule list to read, and
 * "You have no rules yet" would be false. `rulesState` says why instead, in the states the
 * pre-entry checklist uses (useChecklistSources.selectedAccountState, the ONE copy).
 *
 * `which` is the block's catalog setting (R-PF-B1): 'active' lists the active rules; 'all' adds
 * the dismissed ones after them.
 *
 * @param {{ which?: 'active'|'all' }} opts
 * @returns {{ rules: object[],
 *             rulesState: 'loading'|'no-account'|'no-accounts'|'accounts-error'|'error'|'ready',
 *             refresh: () => void, showSaved: (rule: object) => void }}
 */
import { useCallback, useEffect, useRef } from 'react'
import useJ2SelectedAccount from './useJ2SelectedAccount'
import useJournalRules from './useJournalRules'
import { selectedAccountState } from './useChecklistSources'

/** The ONE copy of this seam's return shape. useMyRulesSources.test.js reads it, and
 *  lib/blocks/blockDoors.test.js (⑤) requires the literal return below to carry exactly these keys. */
export const RETURN_KEYS = Object.freeze(['rules', 'rulesState', 'refresh', 'showSaved'])

const NO_RULES = []

export default function useMyRulesSources({ which = 'active' } = {}) {
  const {
    accountId, isLoading: accountsLoading, isAllAccounts, accountsError, accounts,
  } = useJ2SelectedAccount()
  const wantDismissed = which === 'all'
  const { rules, isLoading, error, mutate } = useJournalRules(accountId)
  const {
    rules: dismissed, isLoading: dismissedLoading, error: dismissedError, mutate: mutateDismissed,
  } = useJournalRules(wantDismissed ? accountId : null, 'dismissed')

  const accountState = selectedAccountState({ accountId, isLoading: accountsLoading, isAllAccounts, accountsError, accounts })
  let rulesState = 'ready'
  if (accountState) rulesState = accountState
  else if (error || (wantDismissed && dismissedError)) rulesState = 'error'
  else if (isLoading || (wantDismissed && dismissedLoading)) rulesState = 'loading'

  // H14: the hooks hand back SWR's `mutate`, and a stand-in may hand back a new one every render. The
  // latest is held in a ref (written after each render, never during one), so `refresh` keeps ONE
  // identity and still reaches it. It is only ever called from an event, after the first commit.
  const mutateRef = useRef(null)
  useEffect(() => { mutateRef.current = { mutate, mutateDismissed: wantDismissed ? mutateDismissed : null } })
  const refresh = useCallback(() => {
    const m = mutateRef.current
    if (typeof m?.mutate === 'function') m.mutate()
    if (typeof m?.mutateDismissed === 'function') m.mutateDismissed()
  }, [])
  // m6: the server's answer for one rule, merged into the cached active list, then a re-read.
  const showSaved = useCallback((saved) => {
    const m = mutateRef.current
    if (!saved?.id || typeof m?.mutate !== 'function') return refresh()
    m.mutate((cur) => (Array.isArray(cur) ? cur.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)) : cur),
      { revalidate: true })
    if (typeof m.mutateDismissed === 'function') m.mutateDismissed()
    return undefined
  }, [refresh])

  let shown = NO_RULES
  if (rulesState === 'ready') {
    const active = Array.isArray(rules) ? rules : NO_RULES
    shown = wantDismissed && Array.isArray(dismissed) && dismissed.length ? [...active, ...dismissed] : active
  }

  return {
    rules: shown,
    rulesState,
    refresh,
    showSaved,
  }
}
