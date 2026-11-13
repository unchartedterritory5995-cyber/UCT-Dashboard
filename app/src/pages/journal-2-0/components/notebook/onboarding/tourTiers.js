// Go-live wave 1: a walkthrough step may belong to one screen tier (`tier` on the step, tours/index.js contract).
//
// Why: a control can live in a different place on a phone than on a wider screen (the list's New menu is not drawn on
// a phone; ⋯ carries its rows there), and the note's "AI" menu is desktop-only while the touch tier keeps the icon
// button. Before tiers, a step for the other tier was waited for and skipped (1.5 s of "Looking for the next step"),
// counted in "Step 1 of N", and could even point at a control that IS on screen at both tiers but means something
// else (⋯ on a desktop). A step with a `tier` is simply not in the tour on a screen of another tier: the engine drops
// it when the tour loads (GenericTourEngine.jsx), so the count, Back/Next and the last step's Done are all right.
//
// The tiers are the app's two boundaries (styles/breakpoints.js), never a new literal:
//   phone    <= 640px          wide     >= 641px (tablet and desktop)
//   touch    <= 1024px         desktop  >= 1025px
// A step with no `tier` is on every screen (every tour written before this).
// ⛔ The answer is read ONCE, when the tour loads: a window resized mid-tour keeps the list it opened with (the engine
// re-checks every anchor on Next anyway, so a step that left the screen is skipped, never pointed at).
// Where `matchMedia` is missing (an old engine, a test environment without it) every query reads "no match", so the
// wide and desktop steps are kept: the desktop tour, the one jsdom suites have always walked.
import { MQ } from '../../../../../styles/breakpoints'

/** Each tier: the query it reads and whether the step is kept when the query MATCHES. */
export const STEP_TIERS = Object.freeze({
  phone: Object.freeze({ query: MQ.phone, keepWhenMatches: true }),
  wide: Object.freeze({ query: MQ.phone, keepWhenMatches: false }),
  touch: Object.freeze({ query: MQ.tabletDown, keepWhenMatches: true }),
  desktop: Object.freeze({ query: MQ.tabletDown, keepWhenMatches: false }),
})

function screenMatches(query) {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches === true
  } catch { return false }
}

/** Whether `step` is in the tour on this screen. `matches(query)` is injectable for rails. */
export function stepOnThisScreen(step, matches = screenMatches) {
  const tier = step?.tier
  if (!tier) return true
  const t = STEP_TIERS[tier]
  if (!t) return true   // an unknown tier never hides a step (the registry rail refuses one anyway)
  return matches(t.query) === t.keepWhenMatches
}

/** The steps that are in the tour on this screen, in tour order. */
export function stepsForScreen(steps, matches = screenMatches) {
  return (Array.isArray(steps) ? steps : []).filter((s) => stepOnThisScreen(s, matches))
}
