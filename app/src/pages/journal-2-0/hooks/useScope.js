/**
 * Journal 2.0 — `useScope`: URL-backed global Scope + live-account sync (P3 §6).
 *
 * The SUCCESSOR to `useJ2Filters` (which stays in the tree until later tasks
 * remove its consumers). The URL is the source of truth for every facet EXCEPT
 * the account: the account lives in localStorage + a window event and is owned
 * by `useJ2SelectedAccount`. This hook reconciles the two so the Scope bar and
 * the fetch layer always agree with the live account.
 *
 * Returns `{ scope, setFacet, toggleMember, clearScope, isActive, activeCount,
 * apiParams }`:
 *   - scope        the current Scope, with `scope.acct` reconciled to the live
 *                  account (the hook's `accountId` PREFERRED over any `sc_acct`
 *                  in the URL, so the bar reflects the real active account).
 *   - setFacet     set a scalar (from/to/symbol) or REPLACE an array facet
 *                  (sides/setups/tags). For `acct`, drives `setAccount(value)`
 *                  AND writes `sc_acct` so shared links carry it.
 *   - toggleMember add/remove a member of an array facet (sides/setups/tags).
 *   - clearScope   remove ALL `sc_*` params; DOES NOT reset the account.
 *   - isActive     `scopeIsActive(scope)`.
 *   - activeCount  `scopeActiveCount(scope)`.
 *   - apiParams    `scopeToApiParams(scope)` (snake_case, for the fetch layer);
 *                  `account_id` comes from the live account and is omitted for
 *                  the `'_all_'`/null "all accounts" sentinel.
 *
 * Every URL write preserves all non-scope params (j2tab, calendar y/m/w/view,
 * ins, …) — only the `sc_*` keys are ever touched — and uses `{replace:true}`
 * to avoid history spam, mirroring `useJ2Filters`.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  scopeFromSearchParams,
  scopeToSearchParams,
  scopeToApiParams,
  scopeIsActive,
  scopeActiveCount,
} from '../../../lib/journal-2-0/scope'
import useJ2SelectedAccount from './useJ2SelectedAccount'

/** Every canonical scope URL key — the ONLY keys a scope write may touch. */
const SC_KEYS = [
  'sc_acct',
  'sc_from',
  'sc_to',
  'sc_sym',
  'sc_side',
  'sc_setup',
  'sc_tag',
  'sc_v',
]

/** The `useJ2SelectedAccount` "all accounts" sentinel (localStorage form). */
const ALL_ACCOUNTS = '_all_'

/** Normalize a raw account id to the scope form: null == "all accounts". */
function normAccount(id) {
  return id == null || id === '' || id === ALL_ACCOUNTS ? null : String(id)
}

/**
 * Clone `prev`, strip every `sc_*` key, then re-emit the ones for `nextScope`.
 * Non-scope params (j2tab, view, y/m/w, ins, …) ride through untouched.
 */
function writeScope(prev, nextScope) {
  const next = new URLSearchParams(prev)
  for (const k of SC_KEYS) next.delete(k)
  for (const [k, v] of scopeToSearchParams(nextScope).entries()) next.set(k, v)
  return next
}

export default function useScope() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { accountId, setAccount } = useJ2SelectedAccount()

  // The live account is the source of truth for `acct` (URL `sc_acct` is only
  // for sharing). null == all accounts.
  const liveAcct = normAccount(accountId)

  const scope = useMemo(
    () => ({ ...scopeFromSearchParams(searchParams), acct: liveAcct }),
    [searchParams, liveAcct],
  )

  const apiParams = useMemo(() => scopeToApiParams(scope), [scope])

  const setFacet = useCallback(
    (key, value) => {
      if (key === 'acct') {
        const norm = normAccount(value)
        // The account lives in localStorage + event — drive it there…
        setAccount(norm)
        // …and mirror it to the URL so shared links carry the account.
        setSearchParams(
          (prev) => writeScope(prev, { ...scopeFromSearchParams(prev), acct: norm }),
          { replace: true },
        )
        return
      }
      setSearchParams(
        (prev) => {
          const base = { ...scopeFromSearchParams(prev), acct: liveAcct }
          return writeScope(prev, { ...base, [key]: value })
        },
        { replace: true },
      )
    },
    [setSearchParams, setAccount, liveAcct],
  )

  const toggleMember = useCallback(
    (key, member) => {
      setSearchParams(
        (prev) => {
          const base = { ...scopeFromSearchParams(prev), acct: liveAcct }
          const current = Array.isArray(base[key]) ? base[key] : []
          const nextArr = current.includes(member)
            ? current.filter((m) => m !== member)
            : [...current, member]
          return writeScope(prev, { ...base, [key]: nextArr })
        },
        { replace: true },
      )
    },
    [setSearchParams, liveAcct],
  )

  const clearScope = useCallback(() => {
    // Wipe every scope facet from the URL; deliberately leave the account alone
    // (clearing filters must not switch accounts).
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of SC_KEYS) next.delete(k)
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const isActive = useMemo(() => scopeIsActive(scope), [scope])
  const activeCount = useMemo(() => scopeActiveCount(scope), [scope])

  return { scope, setFacet, toggleMember, clearScope, isActive, activeCount, apiParams }
}
