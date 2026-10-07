// app/src/components/chart/builder/studio/createIndicatorFlag.js
//
// ─── THE DARK SWITCH FOR CREATE INDICATOR (P2 Track B, Slice 1) ─────────────
//
// The same per-browser runtime-flag shape as Journal 2.0's `featureFlags.js`:
// a localStorage override, a same-tab event so the door appears without a
// reload, a DevTools handle and a `useSyncExternalStore` hook.
//
// ⛔ DEFAULT OFF. Members never see the new door; the existing "+ New Formula"
// stays exactly as it is. The owner opts ONE browser in from DevTools:
//
//   window.__uctCreateIndicator(true)    // show "+ Create Indicator"
//   window.__uctCreateIndicator(false)   // hide it again
//   window.__uctCreateIndicator(null)    // clear the override (= default, off)
//
// Not an entitlement — it gates rendering only. The server doors it reaches
// (`/converse`, the definition save) keep their own `require_paid` authority.

import { useSyncExternalStore } from 'react'

export const CREATE_INDICATOR_FLAG_KEY = 'uct.feature.createIndicator'
export const CREATE_INDICATOR_EVENT = 'uct-create-indicator-flag'
const DEFAULT_ON = false

export function resolveCreateIndicatorFlag() {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(CREATE_INDICATOR_FLAG_KEY) : null
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* storage unavailable → default */ }
  return DEFAULT_ON
}

export function setCreateIndicatorFlag(on) {
  try {
    if (on === true) localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
    else if (on === false) localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '0')
    else localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY)
  } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(CREATE_INDICATOR_EVENT)) } catch { /* ignore */ }
  return resolveCreateIndicatorFlag()
}

if (typeof window !== 'undefined') window.__uctCreateIndicator = setCreateIndicatorFlag

function subscribe(cb) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e) => { if (!e || e.key === CREATE_INDICATOR_FLAG_KEY) cb() }
  window.addEventListener(CREATE_INDICATOR_EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CREATE_INDICATOR_EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function useCreateIndicatorFlag() {
  return useSyncExternalStore(subscribe, resolveCreateIndicatorFlag, () => DEFAULT_ON)
}

// ─── ⭐ CONTROLLED MEMBER ROLLOUT — WHO MAY SEE CREATE INDICATOR ──────────────
//
// Spelled exactly as `api/services/rollout_gate.py::CREATE_INDICATOR_COHORT`
// (`createIndicatorAccess.test.js` reads the Python source and pins the two).
export const CREATE_INDICATOR_COHORT = 'create-indicator'

/**
 * Pure: may the member this auth payload describes see Create Indicator?
 *
 *   · an ADMIN — only with this browser's opt-in flag (the dark owner review,
 *     unchanged);
 *   · a MEMBER — only when the SERVER's effective `cohorts` list names the
 *     cohort. That list is computed server-side (`rollout_gate.client_cohorts`:
 *     the kill switch first, then an admin-written tag), so nothing a member can
 *     set in this browser grants it; the localStorage flag is ignored for them.
 *
 * ⛔ The browser decision is a DOOR. `/converse` enforces the same rule
 * (`require_create_indicator_access`); a tampered client reaches a 403.
 */
export function createIndicatorAccess({ user = null, cohorts = null } = {}, flagOn = false) {
  if (user && user.role === 'admin') return !!flagOn
  return Array.isArray(cohorts) && cohorts.includes(CREATE_INDICATOR_COHORT)
}

/** The hook both doors use: the auth payload + this browser's flag. */
export function useCreateIndicatorAccess(auth) {
  const flagOn = useCreateIndicatorFlag()
  return createIndicatorAccess(auth || {}, flagOn)
}
