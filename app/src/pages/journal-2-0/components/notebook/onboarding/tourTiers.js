// Go-live wave 1: a walkthrough step may belong to one screen tier (`tier` on the step, tours/index.js contract).
//
// Why: a control can live in a different place on a phone than on a wider screen (the list's New menu is not drawn on
// a phone; ⋯ carries its rows there), and the note's "AI" menu is desktop-only while the touch tier keeps the icon
// button. Before tiers, a step for the other tier was waited for and skipped (1.5 s of "Looking for the next step"),
// counted in "Step 1 of N", and could even point at a control that IS on screen at both tiers but means something
// else (⋯ on a desktop). A step with a `tier` is simply not in the tour on a screen of another tier: the engine drops
// it when the tour loads (GenericTourEngine.jsx), so the count, Back/Next and the last step's Done are all right.
//
// The tiers are the app's two boundaries (styles/breakpoints.js), never a new literal, and each tier is decided by the
// SAME media query string the CSS uses to show its controls (follow-up B, item 2a):
//   phone    MQ.phone matches  (max-width: 640px)     wide     everything else
//   desktop  MQ.desktop matches (min-width: 1025px)   touch    everything else
// ⚰️ The tiers used to be "phone = (max-width: 640px), wide = not that; touch = (max-width: 1024px), desktop = not
//    that". Under browser zoom a window can be a FRACTIONAL width: at 1024.5 px neither `(max-width: 1024px)` nor
//    `(min-width: 1025px)` matches, so the tier said desktop while the desktop-only controls (`.desktopOnly`, shown
//    only at `(min-width: 1025px)`) were hidden and the touch ones were on screen. Reading the CSS's own string for one
//    side and calling the rest the other side keeps the tour and the screen in agreement at every width.
// A step with no `tier` is on every screen (every tour written before this).
// ⛔ The answer is read ONCE, when the tour loads: a window resized mid-tour keeps the list it opened with (the engine
// re-checks every anchor on Next anyway, so a step that left the screen is skipped, never pointed at).
// Where there is no screen to ask (no `matchMedia`, or one that matches no query at all, which is what a test
// environment's shim does) the wide and desktop steps are kept: the desktop tour, the one jsdom suites have always
// walked. A real screen always matches the media type `all`, so a real window at a fractional width is never read as
// "no screen".
import { MQ } from '../../../../../styles/breakpoints'

/** Each tier: the query it reads and whether the step is kept when the query MATCHES. */
export const STEP_TIERS = Object.freeze({
  phone: Object.freeze({ query: MQ.phone, keepWhenMatches: true }),
  wide: Object.freeze({ query: MQ.phone, keepWhenMatches: false }),
  desktop: Object.freeze({ query: MQ.desktop, keepWhenMatches: true }),
  touch: Object.freeze({ query: MQ.desktop, keepWhenMatches: false }),
})

/** The tiers kept when there is no screen to ask (the desktop tour). */
const KEPT_WITHOUT_A_SCREEN = Object.freeze(['wide', 'desktop'])
/** What a real screen is asked to learn that it IS one: the media type every screen matches, and the tier queries. */
const SCREEN_PROBES = Object.freeze(['all', MQ.phone, MQ.tabletDown, MQ.desktop])

function screenMatches(query) {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches === true
  } catch { return false }
}

/** Whether `matches` answers like a real screen (it matches at least one query). */
export function screenAnswers(matches = screenMatches) {
  return SCREEN_PROBES.some((q) => matches(q) === true)
}

/** Whether `step` is in the tour on this screen. `matches(query)` is injectable for rails. */
export function stepOnThisScreen(step, matches = screenMatches, answers = screenAnswers(matches)) {
  const tier = step?.tier
  if (!tier) return true
  const t = STEP_TIERS[tier]
  if (!t) return true   // an unknown tier never hides a step (the registry rail refuses one anyway)
  if (!answers) return KEPT_WITHOUT_A_SCREEN.includes(tier)
  return matches(t.query) === t.keepWhenMatches
}

/** The steps that are in the tour on this screen, in tour order. */
export function stepsForScreen(steps, matches = screenMatches) {
  const answers = screenAnswers(matches)
  return (Array.isArray(steps) ? steps : []).filter((s) => stepOnThisScreen(s, matches, answers))
}
