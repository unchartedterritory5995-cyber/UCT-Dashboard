// The one door a walkthrough is started through from a list of tours (Notebook UX pass, 2026-10-10). Pure: no React.
//
// ⛔ NO NEW TOUR MACHINERY. Starting a tour goes through the doors that already exist: the base tour's
// `openNotebookTour` (tourControl.js) and every other tour's `openRegistryTour` (tourRegistryControl.js) -- the same
// two calls the offer makes. Where a tour starts (another page, a note, a trade) is the engine's business
// (tourStart.js), never the caller's.
//
// ⚰️ This file was Research Home's "Learn" menu's rules (which tours, grouped under five headings, and the button's
// words in learnMenuCopy.js). Go-live wave 1 dropped the Learn menu with Research home: Help > Walkthroughs
// (Support.jsx) lists every tour by the same registry derivation. What is left is the one export routed code uses,
// the get-started list's tour step (GettingStartedList.jsx).
import { BASE_TOUR_ID } from './tourRegistry'
import { openNotebookTour } from './tourControl'
import { openRegistryTour } from './tourRegistryControl'

/** Start one tour through its existing door: the base tour's own, or the registry's. */
export function startTour(tourId) {
  if (tourId === BASE_TOUR_ID) openNotebookTour()
  else openRegistryTour(tourId)
}
