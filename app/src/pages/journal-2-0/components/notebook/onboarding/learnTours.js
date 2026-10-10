// Research Home's "Learn" menu: WHICH walkthroughs it offers, and the one door each one is
// started through (Notebook UX pass, 2026-10-10). Pure: no React. `LearnMenu.jsx` renders it.
//
// ⛔ THE TOURS ARE DERIVED, NEVER LISTED. One item per REGISTERED, REPLAYABLE tour that may
// reach this member right now (`tourLive`, the registry's one answer to that question), in
// registry order. A tour a track adds tomorrow appears here the day its flag arms, with no
// edit to this file. This is the SAME derivation Help > Walkthroughs makes (Support.jsx:
// `replayableTours().filter(t => tourLive(t, notebookFlag))`), so the Learn menu and Help can
// never offer two different lists. A non-replayable entry (the passive resurfacing explainer)
// cannot be opened on demand, so it is never offered.
//
// ⛔ NO NEW TOUR MACHINERY. Starting a tour goes through the doors that already exist:
// the base tour's `openNotebookTour` (tourControl.js) and every other tour's
// `openRegistryTour` (tourRegistryControl.js) -- the same two calls the get-started list
// and the offer make. Where a tour starts (another page, a note, a trade) is the engine's
// business (tourStart.js), never this menu's.
//
// The menu exists only while the wave-14 onboarding switch is on (`checklistEnabled`: the
// onboarding flag AND getting-started, reused, never restated). Off, Research Home is the
// pre-wave-14 page, exactly as Help's Walkthroughs section is.
import { BASE_TOUR_ID, TOUR_REGISTRY, replayableTours, tourLive } from './tourRegistry'
import { openNotebookTour } from './tourControl'
import { openRegistryTour } from './tourRegistryControl'
import { checklistEnabled } from './gettingStartedPref'

/** Help > Walkthroughs (Support.jsx `WALKTHROUGHS_ID`; arriving with this hash focuses it).
 *  learnTours.test.js holds the two together, so a rename there cannot strand this link. */
export const HELP_WALKTHROUGHS_HREF = '/support#walkthroughs'

/** Every word the menu shows. */
export const LEARN_COPY = Object.freeze({
  button: 'Learn',
  buttonTitle: 'Walkthroughs of what the Notebook can do',
  menuLabel: 'Learn: walkthroughs',
  tour: (title) => `${title} tour`,
  help: 'All walkthroughs in Help',
})

/** The tours the menu offers, in registry order (see the header). `flag` is notebookFlag
 *  (a parameter so a rail can arm a fake registry's flags); `registry` is TOUR_REGISTRY. */
export function learnMenuTours({ flag, registry = TOUR_REGISTRY } = {}) {
  if (typeof flag !== 'function') return []
  return replayableTours(registry).filter((t) => tourLive(t, flag))
}

/** Whether the menu is offered at all: the wave-14 switch on (see the header). */
export function learnMenuEnabled(flag) {
  return typeof flag === 'function' && checklistEnabled(flag)
}

/** Start one tour through its existing door: the base tour's own, or the registry's. */
export function startTour(tourId) {
  if (tourId === BASE_TOUR_ID) openNotebookTour()
  else openRegistryTour(tourId)
}
