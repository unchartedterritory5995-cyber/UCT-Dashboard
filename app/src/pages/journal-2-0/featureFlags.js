import { useSyncExternalStore } from 'react'

// Journal 2.0 P5 per-feature runtime flags. A parametrized clone of the P4
// shell kill-switch (`shellFlag.js`, itself mirroring the Phase-C bars-push gate):
// each capstone feature gets an explicit per-browser localStorage override, a
// same-tab Event so consumers re-read instantly (no reload), a
// `window.__uctJ2Feature(name, on)` DevTools handle, and a `useFeatureFlag(name)`
// hook backed by `useSyncExternalStore`.
//
// WHY per-feature flags (spec §182 rollback): the capstone lands three big
// additive surfaces — adherence, psychology, regime analytics — plus the
// trade-card PNG. A misbehaving one must be revertible per-browser INSTANTLY
// during the market-hours deploy freeze, without pulling the whole shell back to
// v8. Backend additions stay additive (absent-key-safe); the FE gates rendering
// on the flag. Defaults are ON (the features ship reviewed) — the flag exists for
// the instant kill, not a staged rollout.
//
// From DevTools: window.__uctJ2Feature('psychology', false) to hide the
// Psychology section, window.__uctJ2Feature('psychology', true) to restore,
// window.__uctJ2Feature('psychology', null) to clear the override (back to default).

export const FEATURE_DEFAULTS = {
  adherence: true,   // rules-per-setup + per-trade adherence checklist + card stat
  psychology: true,  // emotion×outcome + cost-of-mistakes + revenge/tilt + tilt glyph
  regime: true,      // win-rate-by-regime section
  tradePng: true,    // trade-card + edge-card PNG export
}

const KEY_PREFIX = 'uct.j2.feature.'          // per-feature override: '1' | '0'
export const J2_FEATURE_EVENT = 'uct-j2feature-change'

function _key(name) { return KEY_PREFIX + name }

// Resolve a feature's active state: explicit '1'/'0' override wins, else the
// hardcoded default (ON for every known feature; unknown names default OFF —
// a typo can never silently enable an unbuilt surface). Never throws.
export function resolveFeatureFlag(name) {
  const dflt = FEATURE_DEFAULTS[name] ?? false
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem(_key(name)) : null
    if (ls === '1') return true
    if (ls === '0') return false
    return dflt
  } catch {
    return dflt   // storage unavailable → default
  }
}

// Operator/canary helper: set (or clear) a feature override AND dispatch the
// same-tab event so consumers re-read immediately (no reload). `on === true|false`
// pins the override; `on === null|undefined` clears it (reverts to the default).
// Unknown-but-string names are still writable (forward-compat), but a non-string
// name is a no-op.
export function setFeatureFlag(name, on) {
  if (typeof name !== 'string' || !name) return
  try {
    if (on === null || on === undefined) localStorage.removeItem(_key(name))
    else localStorage.setItem(_key(name), on ? '1' : '0')
    window.dispatchEvent(new Event(J2_FEATURE_EVENT))
  } catch { /* ignore */ }
}
if (typeof window !== 'undefined') window.__uctJ2Feature = setFeatureFlag

// ── React binding ────────────────────────────────────────────────────────────

// Subscribe to BOTH the same-tab change event AND the cross-tab `storage` event
// so a flip in this tab OR another tab re-renders every consumer.
function _subscribe(cb) {
  const onStorage = (e) => {
    if (e.key == null || e.key.startsWith(KEY_PREFIX)) cb()
  }
  window.addEventListener(J2_FEATURE_EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(J2_FEATURE_EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

// Returns the current on/off state for a feature and re-renders on change.
// resolveFeatureFlag returns a primitive so useSyncExternalStore's Object.is
// comparison is stable.
export function useFeatureFlag(name) {
  return useSyncExternalStore(
    _subscribe,
    () => resolveFeatureFlag(name),
    () => resolveFeatureFlag(name),
  )
}
