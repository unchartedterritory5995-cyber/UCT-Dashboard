// Joystick hub — useHubMode(modeConfig): registers a page's tap/double-tap/scrub/fan.
// See docs/plans/joystick/00-master-spec-v1.3.md §2e (adaptability), §4 (Phase 1).
//
// ⛔ NOT MOUNTED YET — PHASE 1 SHIPS THIS UNWIRED, DELIBERATELY.
// Today the only thing that imports this file is its own test (or another
// equally unmounted hub module). It is reached from NO route. Phase 2 wires it:
// `HubProvider` goes around `<main>` in `Layout.jsx`, and the section
// integrators call `useHubMode` / `useHubCursor` from their pages.
//
// It is recorded here rather than left to be discovered because this repo has
// been bitten by the opposite: an agent read a green test file as the precedent
// for its own work before noticing the page it tested reached no route. A test
// is not a door. Until Phase 2, treat this module as a design, not a feature —
// and if Phase 2 is cancelled, DELETE these files rather than leaving them
// looking shipped.

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
