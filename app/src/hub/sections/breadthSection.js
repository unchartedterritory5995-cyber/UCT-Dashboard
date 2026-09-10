// Joystick hub — the BREADTH section controller (Phase 3 §3.2, `docs/plans/joystick/60-phase3-plan.md`).
//
// This module is the whole of what the hub does on `/breadth` in Increment 2:
//
//   tap       -> next tab        double-tap -> previous tab
//   scrub (x) -> tab index       readout    -> that tab's label
//
// Both ends CLAMP and never wrap: a member who taps past the last tab expects the last tab, not
// a silent jump back to Monitor. Tab changes are IN PLACE — no route change.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ THE TAB LIST IS NOT `BREADTH_TAB_ITEMS`. IT IS `resolveBreadthTabs(isAdmin)`.
// ─────────────────────────────────────────────────────────────────────────────
// `analogues` is appended for admins ONLY. The list therefore has two lengths, and everything
// that walks it — the tap step, the scrub's range, the chip's readout, and (a later wave) the
// fan — has to walk the SAME one. Reading the constant instead of the resolved list is not a
// cosmetic slip:
//
//   * an admin and a member get different behaviour from identical code, and only one of them
//     is ever in the room when it is tested;
//   * the scrub's range is `count - 1`, so a range taken from the constant walks an admin's
//     cursor onto an index it cannot reach and a member's onto one their list does not have —
//     which reads as a dead gesture at the end of a drag rather than as a bug.
//
// So the resolution lives HERE, in one exported function, and `Breadth.jsx`'s own tab strip
// calls that same function. One authority, derived at both call sites, never restated
// (`lesson_a_second_authority_over_one_value`).
//
// ─────────────────────────────────────────────────────────────────────────────
// Deferred on purpose — recorded so the next wave does not have to re-derive it
// ─────────────────────────────────────────────────────────────────────────────
//  * NO `listAdapter`. The plan's cursor identity key is `breadth:${activeTab}` — each tab is
//    its own list — but the list a cursor would walk is the monitor grid's ROWS, and nothing in
//    this wave selects a row. An adapter over the TABS would be a cursor invented to satisfy a
//    field, and `validateListAdapter` would then demand a `scrollTo` that scrolls nothing. When
//    the drill wave lands, that key is the one to use.
//  * NO fan. `breadth` stays in `PREVIEW_MODES`; `fanFor()` keeps returning the preview fan.
//    ⛔ The registry entry is still SPREAD into the config below — see `createBreadthSection`.

import { useMemo, useRef } from 'react'
import useHubMode from '../useHubMode'
import { modesById } from '../registry'

/**
 * The base tab strip, in display order.
 *
 * Monitor leads — it is what people come for (owner decision, 2026-08-26). "Daily" (key
 * `overview`) stays the mobile-default readable landing but sits demoted in the strip.
 *
 * ⚠️ Moved here from `Breadth.jsx` so the hub can read the list without importing the page: the
 * page imports this module, and the reverse would be an import cycle through the whole page.
 * `Breadth.jsx`'s `BreadthTabs` now renders `resolveBreadthTabs(isAdmin)`.
 */
export const BREADTH_TAB_ITEMS = Object.freeze([
  { key: 'breadth', label: 'Monitor' },
  { key: 'heatmap', label: 'Views' },
  { key: 'overview', label: 'Daily' },
  { key: 'cot', label: 'COT Data' },
  { key: 'charts', label: 'Data Charts' },
])

/** Appended for admins only. Kept separate so "who sees it" is one name, not a spread buried in JSX. */
export const BREADTH_ADMIN_TAB_ITEMS = Object.freeze([
  { key: 'analogues', label: 'Analogues' },
])

/**
 * ⭐ THE RESOLVED LIST — the single authority for "which tabs exist right now".
 *
 * Returns the frozen base array itself for a member, so a non-admin render allocates nothing and
 * `useMemo` identity stays stable across renders.
 *
 * @param {boolean} isAdmin
 * @returns {ReadonlyArray<{key: string, label: string}>}
 */
export function resolveBreadthTabs(isAdmin) {
  return isAdmin ? [...BREADTH_TAB_ITEMS, ...BREADTH_ADMIN_TAB_ITEMS] : BREADTH_TAB_ITEMS
}

/**
 * ⛔ THE TWO MOUNTED CONSUMERS CALL `onScrub` WITH DIFFERENT ARGUMENTS.
 *
 *   `HubRoot.jsx:147`                -> `onScrub(ctx, {delta, axis})`  (registry.js's HubMode JSDoc)
 *   `contracts.js` HubSectionConfig  -> `onScrub({delta, axis})`       (and `phase3Contracts.test.jsx`
 *                                                                      wires the real engine that way)
 *
 * Binding to one of them makes the section work in the suite and do nothing on the page, or the
 * reverse — the exact severed-wire class `contracts.js` was written after Phase 2 to end, and it
 * is invisible to BOTH sides' unit tests. So the payload is IDENTIFIED rather than positioned:
 * the scrub is the argument carrying a finite numeric `delta`. Filed for the Director as R-05
 * in `docs/plans/joystick/requests.md`; until one signature wins, this reads either.
 *
 * @param {unknown[]} args
 * @returns {{delta: number, axis: 'x'|'y'}|null}
 */
export function scrubPayloadOf(args) {
  for (const a of args) {
    if (a && typeof a === 'object' && typeof a.delta === 'number' && Number.isFinite(a.delta)) {
      return /** @type {{delta: number, axis: 'x'|'y'}} */ (a)
    }
  }
  return null
}

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n)

/**
 * Builds the `HubSectionConfig` for one render of the page.
 *
 * ⛔ THE REGISTRY ENTRY IS SPREAD IN, AND THAT IS LOAD-BEARING — NOT TIDINESS.
 * A page registration REPLACES the route-derived default outright (`HubContext.jsx`:
 * `pageModeConfig ?? modesById[mode]`), and `fanFor()` does `mode.fan.filter(...)` unguarded. A
 * config without `fan` therefore throws inside HubRoot's render — a white screen on `/breadth`
 * for a control that is only a shortcut over a page which works without it. Spreading
 * `modesById.breadth` carries `label`, `color`, `route`, `tapHint` and the fan through
 * untouched, which is also exactly what "the fan is not yours this wave" means.
 *
 * @param {Object} args
 * @param {ReadonlyArray<{key: string, label: string}>} args.tabs  The RESOLVED list.
 * @param {string} args.activeTab
 * @param {(key: string) => void} args.setActiveTab
 * @param {{current: {fromKey: string, pos: number, index: number}|null}} args.scrubRef
 *   Survives across the many `onScrub` calls of one drag; cleared on commit.
 * @returns {import('../contracts').HubSectionConfig}
 */
export function createBreadthSection({ tabs, activeTab, setActiveTab, scrubRef }) {
  const count = tabs.length

  // An unrecognised key reads as index 0 rather than -1. `activeTab` is seeded from a URL and
  // from `matchMedia`, so a member can legitimately arrive holding a key that is not in THEIR
  // list (an admin's shared `?tab=analogues` link, say) and must still get a working gesture.
  const indexOf = (key) => {
    const i = tabs.findIndex((t) => t.key === key)
    return i < 0 ? 0 : i
  }

  const step = (direction) => {
    const from = indexOf(activeTab)
    const to = clamp(from + direction, 0, count - 1) // clamp, NEVER wrap
    if (to !== from) setActiveTab(tabs[to].key)
  }

  /**
   * The scrub's position, seeded lazily from the tab actually showing.
   *
   * There is no `onScrubStart` in the contract, and the engine's `delta` is a STEP — the
   * distance between two pointer moves normalized by the pad's travel (`useJoystick.js:306`) —
   * not an absolute position. So the first step of a drag seeds from where the member already
   * is and every later step accumulates onto it. `fromKey` re-seeds if the tab moved underneath
   * us (another control, or a commit we never saw because the gesture was cancelled).
   */
  const scrubStart = () => {
    const held = scrubRef.current
    if (held && held.fromKey === activeTab) return held
    const index = indexOf(activeTab)
    return { fromKey: activeTab, pos: count > 1 ? index / (count - 1) : 0, index }
  }

  /** Which tab the chip is narrating: the pending one mid-scrub, otherwise the live one. */
  const shownIndex = () => (scrubRef.current ? scrubRef.current.index : indexOf(activeTab))

  return {
    ...modesById.breadth,
    id: 'breadth',

    onTap: () => step(+1),
    onDoubleTap: () => step(-1),

    // ⭐ THE SCRUB PREVIEWS; THE RELEASE COMMITS — deliberately, not for want of trying live.
    // Each tab owns a heavy subtree (ECharts, Chart.js, a virtualized grid), and the Views tab
    // additionally SPENDS its `?view=` link on unmount (see the urlVisit note in `Breadth.jsx`).
    // Applying every intermediate index of one drag would mount and tear down two or three
    // chart libraries per gesture and quietly burn a shared link on the way past. What the
    // member reads while dragging is the chip — which is precisely what `readout` is for.
    onScrub: (...args) => {
      const scrub = scrubPayloadOf(args)
      // Horizontal only (plan §3.2). The engine reports the DOMINANT axis of each individual
      // move, so a mostly-sideways drag still emits the occasional 'y'; counting those as tab
      // movement would make the gesture drift under an unsteady thumb.
      if (!scrub || scrub.axis !== 'x' || count === 0) return
      const from = scrubStart()
      const pos = clamp(from.pos + scrub.delta, 0, 1) // clamps both ends; an overshoot is normal
      scrubRef.current = { fromKey: from.fromKey, pos, index: Math.round(pos * (count - 1)) }
    },

    onScrubCommit: () => {
      const held = scrubRef.current
      scrubRef.current = null
      if (!held) return // a hold-and-release that never moved changes nothing
      const tab = tabs[held.index]
      if (tab && tab.key !== activeTab) setActiveTab(tab.key)
    },

    // A `ChipReadout` string — the whole chip is the tab's own label, the same words the member
    // is about to see on the strip. Never the key: `overview` is displayed as "Daily".
    readout: () => tabs[shownIndex()]?.label ?? '',
  }
}

/**
 * Mount point. Called from `Breadth.jsx` inside the component that owns `activeTab`.
 *
 * Returns the resolved tabs, so a caller never resolves them a second time.
 *
 * @param {Object} args
 * @param {boolean} args.isAdmin
 * @param {string} args.activeTab
 * @param {(key: string) => void} args.setActiveTab
 * @returns {ReadonlyArray<{key: string, label: string}>}
 */
export default function useBreadthHubSection({ isAdmin, activeTab, setActiveTab }) {
  const tabs = useMemo(() => resolveBreadthTabs(isAdmin), [isAdmin])

  // A ref, not state: a scrub emits a call per pointer move, and re-rendering this page on each
  // one is the jank the deferred commit above exists to avoid. Nothing of ours renders from it —
  // `readout()` is called by the chip, not during our render.
  const scrubRef = useRef(null)

  const config = useMemo(
    () => createBreadthSection({ tabs, activeTab, setActiveTab, scrubRef }),
    [tabs, activeTab, setActiveTab],
  )

  useHubMode(config)
  return tabs
}
