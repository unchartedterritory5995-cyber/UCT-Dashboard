// Joystick hub — useHubMode(modeConfig): registers a page's tap/double-tap/scrub/fan.
// See docs/plans/joystick/00-master-spec-v1.3.md §2e (adaptability), §4 (Phase 1).
//
// ✅ WIRED IN PHASE 3 WAVE A (2026-09-09). This module is reached from real routes now:
// `MorningWire.jsx` and `Breadth.jsx` register their sections through it, and the
// `AWAITING_A_DECISION` entry that declared it unmounted has been deleted from
// `components/screener/reachable.test.js` per its own stated removal condition.

import { useEffect } from 'react'
import { useHub } from './HubContext'

/**
 * Registers `modeConfig` (a `HubMode`-shaped object — see `registry.js`'s
 * typedefs) as the CURRENT page's hub controller for as long as the calling
 * component stays mounted, and unregisters cleanly on unmount.
 *
 * Pages that never call this get the route-derived default from the registry
 * instead — `HubContext`'s `activeModeConfig` falls back to `modesById[mode]`
 * when nothing is registered. This hook exists only for a page that needs to
 * OVERRIDE that default (e.g. a page not addressable by a single route, like
 * Catalysts on `/dashboard`, or one that wants different behaviour than its
 * registry entry for the moment it's mounted).
 *
 * `modeConfig` is typically a fresh object literal every render — passing it
 * directly (rather than requiring the caller to `useMemo` it) keeps the call
 * site simple. That costs a re-registration (one `setState`) on every render
 * where the reference changes, which is cheap, and correctness never depends
 * on it: the effect's cleanup always unregisters the EXACT config object it
 * registered, so a fast re-render can never leave a stale or double
 * registration behind.
 *
 * @param {import('./registry').HubMode} [modeConfig]
 */
export default function useHubMode(modeConfig) {
  const { registerHubMode } = useHub()

  useEffect(() => {
    if (!modeConfig) return undefined
    // The config is contract-checked by `registerHubMode` itself (HubContext), which is the
    // single registration authority AND is actually mounted — a check here would be a second
    // copy that a page calling `registerHubMode` directly would skip. See the note there.
    return registerHubMode(modeConfig)
  }, [registerHubMode, modeConfig])
}
