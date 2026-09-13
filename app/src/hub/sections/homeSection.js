// app/src/hub/sections/homeSection.js — Home's hub controller (§3.8a, the scrub).
//
//   hold + drag  -> move a cursor over the RECENT-SECTION list
//   chip         -> "Go to Breadth" (the destination, narrated while the thumb is down)
//   release      -> `ctx.navigate(<mode id>)`
//
// ⛔ MOUNTED FROM THE HUB, NOT FROM `Dashboard.jsx`, AND THE USUAL REASON DOES NOT APPLY.
// `Layout.jsx:117-122` states why every other controller mounts from its page: "the hub cannot own
// an index into a list it cannot see (spec §2 exception (b))". Home's list is not on the page at
// all — it IS the registry's own route-backed section order (`hubRoutes.SECTION_ROUTES`, derived
// from `modes`) with `lastSection` promoted to the front. There is nothing on `/dashboard` to read,
// so there is nothing a page-side mount would buy; `notebookSection.js` set the hub-side precedent
// and this follows its shape exactly.
//
// ⭐ THIS IS `lastSection`'s FIRST READER. `HubContext.jsx:77` has defined
// `LAST_SECTION_STORAGE_KEY = 'hub.lastSection'` and `:134` has written it on every section route
// change since Phase 1; `HubRoot.jsx:114` threads it into `ctx`. Until this file, nothing consumed
// it — it was built, persisted and threaded with zero readers, which is recorded in
// `RESUME-inc4.md:224-227` as what H8 uncovered.
//
// ⛔ THE COMMIT NAVIGATES THROUGH `ctx.navigate`, WHICH IS WHY THIS COULD NOT SHIP BEFORE R-G.
// `onScrubCommit(ctx)` is one of the four callbacks that receive the action context
// (`HubRoot.jsx:228`), so it can reach the ONE navigation seam. Nothing here calls `useNavigate()`
// — a second navigation site anywhere under `app/src/hub/**` is a rail failure by construction
// (`hub/navigationAuthority.test.jsx`), and it would also re-answer "what path does mode X live
// at", which `resolveNavTarget` owns.
//
// ⚰️ TAP IS WIRED NOW, AND THIS PARAGRAPH USED TO SAY IT COULD NEVER BE. The original read:
// "TAP IS DELIBERATELY NOT WIRED ... useJoystick.js:449 calls mode?.onTap?.() with NO arguments
// ... a hub-side controller therefore cannot reach ctx.navigate from onTap ... Reported for the
// owner." That was true and correctly reasoned, and it was the RIGHT call to stop and report
// rather than reach for a second `useNavigate()`.
//
// The owner's answer was to remove the blocker rather than work around it: HubRoot now dispatches
// all four mode callbacks and passes `ctx` to every one, so `onTap(ctx)` can navigate through the
// same single seam `onScrubCommit` already used. The stale sentence is kept here in quotation
// rather than deleted, because the SHAPE of that stop — an unwired action is ABSENT, never
// present-and-inert (`registry.js`) — is the part worth keeping.

import { useCallback, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import useHubMode from '../useHubMode'
import useHubCursor from '../useHubCursor'
import { useHub } from '../HubContext'
import { modesById, HOME_MODE_ID } from '../registry'
import { SECTION_ROUTES, isSectionRoute, routeToModeId } from '../hubRoutes'
import { validateActionCtx } from '../contracts'

/**
 * The cursor's list id — DERIVED from the registry (`home.cursor.listId`), never typed, the same
 * way `wireSection.js:69` / `screenerSection.js:120` / `journalSection.js:79` derive theirs.
 */
export const LIST_ID = modesById[HOME_MODE_ID]?.cursor?.listId ?? HOME_MODE_ID

/**
 * §C3:905's Reverse destination — "Reverse: Morning Wire".
 *
 * A MODE ID, never a path. `resolveNavTarget` reads the route off the registry, so "what path
 * is Wire at" keeps one authority; a literal '/morning-wire' here would be a second copy of the
 * registry's own `route` field — the defect this file already avoids in onScrubCommit.
 */
const WIRE_MODE_ID = 'wire'

/**
 * The registry's declared route-backed SECTION order, `home` excluded.
 *
 * ⛔ DERIVED TWICE OVER, AND NEITHER DERIVATION IS RESTATED HERE. `SECTION_ROUTES` is itself built
 * from `modes` (`hubRoutes.js:19-21`), and `isSectionRoute` is that module's declared single
 * authority for "is this pathname a SECTION" — the same predicate that decides what gets WRITTEN
 * to `lastSection` (`HubContext.jsx:134`). Filtering with anything else would put a second answer
 * on "which modes are sections", and the two would disagree the first time a mode gained or lost a
 * route. `catalysts` is absent by construction: it declares no `route`, so it is not in
 * `SECTION_ROUTES` at all.
 *
 * Object key order is insertion order for string keys, so this preserves the order `modes`
 * declares — which is what "the registry's declared order" means.
 */
export const DECLARED_SECTION_ORDER = Object.freeze(
  Object.entries(SECTION_ROUTES)
    .filter(([route]) => isSectionRoute(route))
    .map(([, id]) => id),
)

/**
 * "Recent" is MRU-of-ONE — the only recency this app stores.
 *
 * `lastSection` is a single mode id, not a history stack, so the honest list is the declared order
 * with that one id promoted to the front. Everything after it is registry order, and there is no
 * pretence of a second- or third-most-recent.
 *
 * ⭐ NOTHING STORED ⇒ PURE REGISTRY ORDER, no substitute. Spec §C3:915 — "**On a first-ever visit
 * with nothing stored, Primary is inert** — disabled, no navigation. Defaulting it to Wire was
 * rejected: Primary and Reverse would fire the same destination on a new account, which reads as a
 * bug rather than a design." That ruling is about Primary, and the same reasoning binds here: on a
 * first-ever visit there is no recent section, so nothing is promoted and the head of the list is
 * simply whatever the registry declares first. The list never invents a recency it does not have.
 *
 * ⚠️ A stored id that is no longer a section (a mode that lost its route between releases) is
 * ignored rather than prepended — otherwise the head of the list would be a destination
 * `resolveNavTarget` can only pass through as a literal path.
 *
 * @param {string|null|undefined} lastSection
 * @returns {string[]} mode ids, most-recent first
 */
export function recentSections(lastSection) {
  if (!lastSection || !DECLARED_SECTION_ORDER.includes(lastSection)) return DECLARED_SECTION_ORDER
  return [lastSection, ...DECLARED_SECTION_ORDER.filter((id) => id !== lastSection)]
}

/** What the chip says while the thumb is down: the destination, in the hub's own words. */
export function destinationLabel(modeId) {
  return modesById[modeId]?.label ?? modeId
}

export default function useHomeSection() {
  const { pathname } = useLocation()
  const { lastSection } = useHub()

  // ⛔ EXACT ROUTE MATCH THROUGH `routeToModeId`, never `pathname === '/dashboard'`. That helper is
  // hubRoutes' resolver and reads Home's route off the registry, so a route change in `registry.js`
  // moves this with it. Registering off-route would override whichever section controller owns the
  // page the member is actually on.
  const onRoute = routeToModeId(pathname) === HOME_MODE_ID

  const items = useMemo(() => recentSections(lastSection), [lastSection])

  /**
   * ⭐ THE KEY IS THE MODE ID, NOT THE POSITION. The list REORDERS when `lastSection` changes, and
   * `useHubCursor`'s identity is the ordered join of these keys — so a promotion reads as a
   * re-sort and the cursor FOLLOWS the section the member had selected to its new index instead of
   * going home. That is the shared cursor's own ruling (`useHubCursor.js:154-168`); a positional
   * key would defeat it silently.
   */
  const identityKey = useCallback((id, index) => `home:${id ?? index}`, [])
  const { index, count, scrubTo } = useHubCursor(LIST_ID, items, { key: identityKey })

  /**
   * ⛔ `scrub.delta` IS A PER-MOVE STEP, NOT A POSITION. `useJoystick.js:306` emits
   * `raw / travelPx` — the distance between THIS pointermove and the LAST one — while
   * `useHubCursor.scrubTo` reads its argument as an absolute 0..1 position. Handing one straight
   * to the other slams the cursor to the first or last entry on every small drag (the defect
   * `wireSection.js:222-236` records paying for). The steps accumulate in a ref because a scrub is
   * a stream of moves between one press and one release, and state would lag a render behind the
   * finger.
   *
   * ⭐ SEEDED FROM WHERE THE CURSOR ALREADY IS, and seeded ONCE. `null` means "no gesture in
   * progress"; `onScrubCommit` clears it. Re-seeding on every step would collapse the whole drag
   * to a single-step scrub against a stale index (`screenerSection.js:455-462`).
   */
  const scrubPosRef = useRef(null)

  const onScrub = useCallback((_ctx, scrub) => {
    if (!scrub || typeof scrub.delta !== 'number' || !Number.isFinite(scrub.delta)) return
    if (scrubPosRef.current === null) {
      scrubPosRef.current = count > 1 ? index / (count - 1) : 0
    }
    const next = Math.min(1, Math.max(0, scrubPosRef.current + scrub.delta))
    scrubPosRef.current = next
    scrubTo(next)
  }, [scrubTo, index, count])

  /**
   * Release navigates to whatever the chip was naming.
   *
   * ⛔ THE CONTEXT IS VALIDATED, NOT ASSUMED. `contracts.js:442` exists for exactly this failure:
   * "a mode that receives a ctx without [navigate] does not throw, it simply does NOTHING on
   * release. That is the present-and-inert failure `registry.js:614` forbids, arriving by omission
   * rather than by design." DEV throws, production logs — see that file's header.
   *
   * ⛔ A MODE ID, NOT A PATH. `resolveNavTarget` (`HubRoot.jsx:50-52`) reads the route off
   * `modesById`, so "what path does mode X live at" keeps its one authority; a path typed here
   * would be a second copy of the registry's `route` field.
   */
  const onScrubCommit = useCallback((ctx) => {
    scrubPosRef.current = null   // the gesture is over; the next one re-seeds from where we landed
    const to = items[index]
    if (!to) return
    validateActionCtx(ctx, `homeSection (${LIST_ID}) onScrubCommit`)
    ctx?.navigate?.(to)
  }, [items, index])

  /**
   * ⭐ PRIMARY — §C3:905 "Primary: last-used section". Now possible: HubRoot dispatches `onTap`
   * with `ctx`, so a registry-declared mode can reach `ctx.navigate`. Until that landed this was
   * structurally impossible and the chip's "tap: last section" was a promise nothing could keep.
   *
   * ⛔ IT READS `lastSection` DIRECTLY, NEVER `items[0]`, and that is the whole subtlety.
   * `recentSections(null)` returns the FULL declared order (there is nothing to promote), so
   * `items[0]` on a first-ever visit is simply the first section in registry order — and
   * navigating there would violate §C3:915 in the exact way it forbids:
   *
   *     "On a first-ever visit with nothing stored, Primary is inert — disabled, no navigation.
   *      Defaulting it to Wire was rejected: Primary and Reverse would fire the same destination
   *      on a new account, which reads as a bug rather than a design."
   *
   * A stored value that is not a route-backed section is treated as nothing stored, for the same
   * reason `recentSections` refuses to promote it.
   */
  const onTap = useCallback((ctx) => {
    if (!lastSection || !DECLARED_SECTION_ORDER.includes(lastSection)) return
    validateActionCtx(ctx, `homeSection (${LIST_ID}) onTap`)
    ctx?.navigate?.(lastSection)
  }, [lastSection])

  /**
   * ⭐ REVERSE — §C3:905 "Reverse: Morning Wire". A mode id, not a path: `resolveNavTarget` reads
   * the route off the registry, so "what path is Wire at" keeps ONE authority. Unlike Primary this
   * is never inert — it is a fixed destination that needs nothing stored.
   */
  const onDoubleTap = useCallback((ctx) => {
    validateActionCtx(ctx, `homeSection (${LIST_ID}) onDoubleTap`)
    ctx?.navigate?.(WIRE_MODE_ID)
  }, [])
  /**
   * ⛔ REQUIRED, NOT OPTIONAL. `validateSectionConfig` refuses an `onScrub` without a `readout`
   * because "a scrub the chip cannot narrate is invisible" — and on `/dashboard` that is literally
   * true: nothing on the page moves as the cursor travels, so the chip is the ONLY surface telling
   * the member where release will take them.
   */
  const readout = useCallback(() => {
    const to = items[index]
    if (!to) return 'No sections'
    return `Go to ${destinationLabel(to)}`
  }, [items, index])

  /**
   * ⚠️ NO `listAdapter`, and that is a statement rather than an omission. The contract's
   * `scrollTo` is "bring row `index` into view", and this list has no rows: it is derived from the
   * registry and rendered nowhere. A no-op `scrollTo` would satisfy `validateListAdapter` while
   * claiming a reveal that cannot happen — `breadthSection.js:32` declines it for the same shape
   * of reason, and `notebookSection.js` ships a cursor without one.
   *
   * ⛔ THE SPREAD IS LOAD-BEARING: it carries `label`, `color`, `tapHint` and `fan`, so the chip
   * stays labelled "Home" and `fanFor()` still has a mode to project. Registering a bare
   * `{id, onScrub, ...}` would blank the chip and empty the fan.
   */
  const config = useMemo(() => (onRoute ? {
    ...modesById[HOME_MODE_ID],
    onTap,
    onDoubleTap,
    onScrub,
    onScrubCommit,
    readout,
  } : undefined), [onRoute, onTap, onDoubleTap, onScrub, onScrubCommit, readout])

  useHubMode(config)

  return { onRoute, items, index, count, destination: items[index] ?? null }
}
