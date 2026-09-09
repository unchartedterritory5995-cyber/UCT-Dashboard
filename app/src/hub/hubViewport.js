// app/src/hub/hubViewport.js — Phase 2 device/viewport gating: portrait-chart scrim exclusion + hard hide.
// See docs/plans/joystick/00-master-spec-v1.4.md §2c/§5 and docs/plans/joystick/20-wave05-ux.md §3/§4.

import { useCallback, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { CHART_SCRIM_EXCLUDE_BOTTOM } from './constants'
import { modesById } from './registry'
import { routeToModeId } from './hubRoutes'

/**
 * The attribute `MobileChartsApp` stamps on `<html>` for as long as the phone/tablet chart
 * shell is mounted (`pages/charts/mobile/MobileChartsApp.jsx:87-88`) — already read by
 * `FloatingOrb.module.css` and `FeedbackWidget.module.css` to step their own FABs up over the
 * chart toolbar / hide them entirely. This hook reads the SAME attribute rather than inventing
 * a second signal for "is the chart shell mounted."
 *
 * Exported (not just a local literal) so the test file never re-types it — a second copy of
 * this string is exactly the kind of second-authority-over-one-value drift this codebase keeps
 * re-discovering.
 */
export const CHART_SHELL_ATTR = 'data-mobile-chart-shell'

/**
 * "The portrait phone chart" (master spec §2c: "the hub still mounts, but…"). Same width+pointer
 * gate `FloatingOrb.module.css` and `FeedbackWidget.module.css` already use to hide themselves on
 * this exact screen (`@media (pointer: coarse) and (max-width: 640px)`), narrowed to
 * `orientation: portrait` because the landscape counterpart of the SAME shell is a DIFFERENT,
 * hidden state (see `LANDSCAPE_IMMERSIVE_QUERY`) and the two must never both read true at once.
 *
 * `max-width: 640px` is load-bearing on its own, not decoration: `MobileChartsApp` is reused
 * verbatim for the coarse-pointer TABLET shell (641-1024px, two-pane — its own header comment
 * calls this out) and stamps the identical `CHART_SHELL_ATTR`, so width is what actually tells a
 * phone-portrait chart apart from a tablet one; the attribute alone cannot.
 */
export const CHART_PORTRAIT_QUERY = '(pointer: coarse) and (max-width: 640px) and (orientation: portrait)'

/**
 * The chart shell's own landscape-immersive query — copied verbatim from
 * `FloatingOrb.module.css:282` / `FeedbackWidget.module.css:60-64`, where the rotated phone chart
 * owns the whole screen and both existing FABs go `display:none`. The hub follows the same
 * precedent (master spec §2c, "Landscape — the hub hides").
 */
export const LANDSCAPE_IMMERSIVE_QUERY = '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)'

/**
 * One `matchMedia` query, kept live via its own `change` listener.
 *
 * ⚠️ Deliberately NOT `hooks/useMediaQuery.js`, and this is why: the app's own ground rule
 * (master spec §2, "Gate visibility in CSS, not on a JS mount condition") is that a JS media
 * read taken once at mount and left to a `change` event can render the WRONG variant on a phone
 * whose viewport never fires that event mid-session (e.g. a device rotated once, before this
 * hook ever mounted, then left there — the very first read must already be current, and nothing
 * about React's mount order guarantees a `change` event to correct a stale one). The fix is the
 * live-`change`-listener shape `useMediaQuery.js` already has, just re-owned locally so this
 * file's correctness does not depend on a sibling hook's own history — and so its
 * add/remove-listener behaviour is independently testable here (a leaked listener on the hub,
 * which mounts once for the life of the app, is a real per-session leak).
 *
 * Below the §2 browser floor (`matchMedia` missing entirely) this resolves to `false` with no
 * listener ever attached — never a thrown error.
 */
function useLiveMediaQuery(query) {
  // ⭐ `useSyncExternalStore`, NOT `useState` + `useEffect`. React forbids a synchronous setState
  // in an effect body (it can cascade renders), and the usual workaround — seed from an
  // initializer, then re-sync on mount — has a real race underneath the lint rule: the value can
  // change between the initializer running and the effect attaching, and that window is exactly
  // when a phone finishes its first layout. `useSyncExternalStore` is the API built for this: it
  // subscribes and reads in one atomic step, so there is no window to miss and no redundant
  // render. The repo already uses it for the price stream and the hub cursor.
  const subscribe = useCallback((onChange) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  const getSnapshot = useCallback(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ), [query])

  // Server snapshot: no media queries exist, so nothing matches.
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/**
 * Whether `html[CHART_SHELL_ATTR]` is currently present, kept live via a `MutationObserver`.
 *
 * This is NOT a media feature — `MobileChartsApp` sets/clears the attribute imperatively in a
 * mount/unmount effect, so `useLiveMediaQuery`'s `matchMedia` machinery cannot see it change; a
 * `MutationObserver` on the one attribute is the only way to react to it without polling.
 */
function useChartShellPresent() {
  // Same reasoning as `useLiveMediaQuery` above: subscribe-and-read atomically rather than
  // seed-then-resync. The attribute is set imperatively by `MobileChartsApp`'s own mount effect,
  // so the ordering between that effect and this one is not something either file controls.
  const subscribe = useCallback((onChange) => {
    if (
      typeof document === 'undefined'
      || !document.documentElement
      || typeof MutationObserver === 'undefined'
    ) {
      return () => {}
    }
    const root = document.documentElement
    const observer = new MutationObserver(onChange)
    observer.observe(root, { attributes: true, attributeFilter: [CHART_SHELL_ATTR] })
    return () => observer.disconnect()
  }, [])

  const getSnapshot = useCallback(() => (
    typeof document !== 'undefined' && !!document.documentElement
      ? document.documentElement.hasAttribute(CHART_SHELL_ATTR)
      : false
  ), [])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/**
 * Phase 2 device/viewport gating for the hub: where the portrait-chart scrim must stop, and
 * when the hub must not render at all.
 *
 * @returns {{ isChartPortrait: boolean, scrimExcludeBottom: (string|null), hidden: boolean }}
 *
 * - **`isChartPortrait`** — true on the portrait phone chart shell (master spec §2c): the chart
 *   shell's own attribute present AND the device currently reads coarse-pointer + portrait +
 *   phone-width. Both halves are independently live (`MutationObserver` + `matchMedia`
 *   `change`), so this tracks a rotation, the shell mounting/unmounting, or a devtools viewport
 *   resize — never a value frozen at first render.
 *
 * - **`scrimExcludeBottom`** — `CHART_SCRIM_EXCLUDE_BOTTOM` (`constants.js`) while
 *   `isChartPortrait`, else `null`.
 *   ⚠️ **THAT VALUE IS AN APPROXIMATION, NEVER A MEASUREMENT** — restated here in full because a
 *   caller of THIS hook has no reason to have also read `constants.js`'s own comment. The volume
 *   pane is drawn inside the Lightweight Charts canvas with no DOM element to measure from
 *   outside the chart, so `calc(22% + 32px)` (the chart's own default volume-pane-height
 *   fallback, already used verbatim by `StockChart.module.css`'s range-bar positioning) is wrong
 *   in three known ways: (1) volume is an overlay band drawn INSIDE the price pane by default
 *   (`separatePane: false`), not a separate pane at all; (2) the user can drag the pane divider
 *   anywhere in `[8%, 45%]`, a value nothing outside the chart can read; (3) volume can be off
 *   entirely, or have oscillator panes stacked below it. This is "roughly where the DEFAULT
 *   configuration's volume band ends," never ground truth about the chart actually on screen.
 *
 * - **`hidden`** — true when the hub must not render at all, for either of two independent
 *   reasons:
 *   (a) the chart shell's landscape-immersive mode — `pointer:coarse` + `orientation:landscape`
 *   + `max-height:500px`, scoped to `html[CHART_SHELL_ATTR]` — following the exact precedent
 *   `FloatingOrb` and `FeedbackWidget` already use to `display:none` themselves there (the
 *   rotated phone chart owns the whole screen); or
 *   (b) the current route resolves (`hubRoutes.routeToModeId`) to a registry mode with
 *   `hideOnRoute` set (`registry.js`). No shipped mode sets this today — it is read defensively,
 *   speculatively, so a future one can opt out of ever rendering the hub without a second file
 *   needing to learn about it.
 *   `isChartPortrait` and reason (a) are mutually exclusive by construction: one requires
 *   `orientation: portrait`, the other `orientation: landscape`, and a screen cannot be both.
 */
export default function useHubViewport() {
  const chartShellPresent = useChartShellPresent()
  const chartPortraitMedia = useLiveMediaQuery(CHART_PORTRAIT_QUERY)
  const landscapeImmersiveMedia = useLiveMediaQuery(LANDSCAPE_IMMERSIVE_QUERY)

  const location = useLocation()
  const modeId = routeToModeId(location.pathname)
  const hideOnRoute = Boolean(modeId && modesById[modeId]?.hideOnRoute)

  const isChartPortrait = chartShellPresent && chartPortraitMedia
  const landscapeImmersive = chartShellPresent && landscapeImmersiveMedia

  return {
    isChartPortrait,
    scrimExcludeBottom: isChartPortrait ? CHART_SCRIM_EXCLUDE_BOTTOM : null,
    hidden: landscapeImmersive || hideOnRoute,
  }
}
