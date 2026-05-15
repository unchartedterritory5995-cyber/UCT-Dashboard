/**
 * Unified Compass mode sentinel. Mirrors api.services.journal_two.coach_scope:
 * when the J2 header selector is on "All Accounts" (accountId === null), every
 * Compass hook passes this value to the backend so the routes resolve to the
 * unified coach that aggregates across all compass_enabled accounts.
 */
export const UNIFIED_ACCOUNT_ID = '_all_'

/**
 * Convert the J2 selected-account value (real id or null) into the value to
 * embed in Compass URLs. Pass-through except null → '_all_'.
 */
export function compassScope(accountId) {
  return accountId ?? UNIFIED_ACCOUNT_ID
}
