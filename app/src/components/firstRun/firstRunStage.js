/**
 * The first-run STAGE (wave 10 follow-up F5): WHERE a one-time "here is something new"
 * card may appear, and WHETHER a first-run tour already holds the screen.
 *
 * Two findings of the wave-10 proof walk (10E-1 6b, 10E-2 D-2) had one cause:
 *   * the "Meet Compass" card (FloatingOrb's first-run coach-mark) hung off the voice orb
 *     in a FIXED layer, so it sat over whatever page was under it -- the Notebook's
 *     Unfiled / Archived / Trash rows at 390 px, the editor's evidence area at 1200;
 *   * the Notebook's first-run tour seats its card bottom-right too, so on a new member's
 *     first visit the tour card covered the coach-mark's "Got it" at every width.
 *
 * The answer is two small facts, shared through this module so the orb (a lazily loaded
 * voice chunk, mounted OUTSIDE the routed <Layout>) and the tour (the Notebook's own lazy
 * chunk) never import each other:
 *   1. THE SLOT. Layout renders one empty element at the top of <main> and registers it
 *      here. A first-run card is portaled INTO it, so it takes its own space in the page
 *      flow and pushes content down -- it can never cover a control. No slot (a page
 *      outside the shell): the card does not show at all, rather than float.
 *   2. THE HOLDER. A first-run tour claims the stage while its card is on screen and
 *      releases it when it closes. A coach-mark waits while the stage is held, so the two
 *      first-run moments are SEQUENCED: the tour first, the card after it.
 *
 * Both are read with `useSyncExternalStore`, so a change re-renders only the readers.
 * Rails: components/firstRun/firstRunStage.test.jsx (the store), FloatingOrb.coachmark
 * .test.jsx (the card lands in the slot and waits for a held stage),
 * NotebookTour.stage.test.jsx (the tour holds the stage exactly while it is open), and
 * Layout.firstRunSlot.test.jsx (the slot is the first thing in <main>).
 */
import { useSyncExternalStore } from 'react'

let slot = null
const holders = new Set()
const listeners = new Set()

function emit() {
  for (const fn of Array.from(listeners)) fn()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Layout's ref callback for the in-flow slot at the top of <main> (null on unmount). */
export function registerFirstRunSlot(el) {
  if (slot === el) return
  slot = el || null
  emit()
}

export function getFirstRunSlot() {
  return slot
}

/** The slot element, or null when no page shell is mounted. */
export function useFirstRunSlot() {
  return useSyncExternalStore(subscribe, getFirstRunSlot, () => null)
}

/**
 * A first-run TOUR claims the stage while its card is on screen. Returns the release;
 * calling it twice is a no-op, so an effect cleanup and a close can both call it.
 *
 * Wave 10 lane D3P round 2: the Notebook note EDITOR also claims it, on a phone only
 * (NoteEditorPage.jsx), so the coach card waits there exactly as it waits behind a tour and
 * shows on the next page. Claiming is a render condition for the card; it never marks it seen.
 */
export function claimFirstRunStage() {
  const token = {}
  holders.add(token)
  emit()
  return () => {
    if (!holders.delete(token)) return
    emit()
  }
}

export function isFirstRunStageHeld() {
  return holders.size > 0
}

/** True while a first-run tour holds the stage: a coach-mark waits its turn. */
export function useFirstRunStageHeld() {
  return useSyncExternalStore(subscribe, isFirstRunStageHeld, () => false)
}

/**
 * How many claims are open (wave 14, lane W14-C2). A claimant that must also YIELD to
 * the others -- the Notebook's "new tour" offer holds the stage while it shows, so the
 * Compass card waits behind it, but it must step aside the moment a tour opens -- cannot
 * use `useFirstRunStageHeld`, which answers true for its own claim. It subtracts its own
 * (0 or 1) from this count instead: `count - mine > 0` is "held by someone else".
 */
export function getFirstRunStageHolderCount() {
  return holders.size
}

export function useFirstRunStageHolderCount() {
  return useSyncExternalStore(subscribe, getFirstRunStageHolderCount, () => 0)
}
