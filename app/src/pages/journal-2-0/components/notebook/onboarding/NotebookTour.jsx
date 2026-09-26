// The Notebook's first-run tour — a STUB (wave 8 seam S8-3). Lane 8C builds it here.
//
// It renders nothing yet. It exists now so the mount in NotebookTab (lane 8A's file this
// wave) is already in place: 8C fills this file in without touching 8A's.
//
// THE MOUNT, and what it hands this component (read `tabs/NotebookTab.jsx`):
//   * `hasAnyNotes` — the SAME value NotebookTab gives ResearchHome's first-run screen
//     (derived once there), so the tour and the first-run screen agree on who is new.
//   * `notesKnown` — false while the note count is still loading. `hasAnyNotes` reads
//     false during that window too, so a member WITH notes would look new to anything
//     that trusted it alone; wait for `notesKnown` before deciding.
//   * It is mounted lazily (its own chunk, outside the Notebook's first-open closure,
//     dispatch-plan R9) and only while `notebook_onboarding_enabled` is on — with the
//     gate off the chunk is never fetched.
//
// ⛔ Rules the tour must keep (rulings D-C7, dispatch-plan R8): it auto-starts ONCE, it is a
// keyboard- and screen-reader-operable dialog, and it is an H14 class — anchor measurement
// must never set state on every frame. The steps and their anchors are `tourSteps.js`.
import { TOUR_STEPS } from './tourSteps'

export default function NotebookTour() {
  return null
}

// The steps this tour walks. Attached here so the stub already reaches them (and the
// reachability rail sees `tourSteps.js` as wired, not orphaned).
NotebookTour.steps = TOUR_STEPS
