// app/src/components/chart/engine/ast/doorDeadline.js
//
// ─── ⭐⭐ THE DOOR DEADLINE: ONE CLOCK ACROSS A WHOLE MEMBER-DOOR CALL (door-deadline unit, 2026-11-20) ─────────
//
// ⚰️ MEASURED (the full-population census, engine 87-89): three public scripts held a member's tab on the main
// thread for minutes before the member door refused them by name. Every bound the translator has is
// PER TRANSLATION: `pine.js::beginTranslateBudget` opens a fresh 10 s window for each `translatePine`, and a Resolver
// built outside a window (the runtime lane's front end) starts its own 10 s at construction. The member door
// (`builder/memberPane/memberPaneDefinition.js`) runs many of them in a row, so one paste bought ~40 budgets back to
// back while every guard reported itself satisfied: the defect the whole-script window fixed for the outputs of ONE
// translation, one level up.
//
// A door window bounds the CALL (`pine.js::withDoorDeadline` opens one). While it is open, every clock limb of
// `pine:timeout` also asks it, and so do the walks that do the most work outside a Resolver (`doorTick`: the round
// trip's hash and canonical-form walks in `parse.js`). Once its deadline has passed the window is TRIPPED and stays
// tripped, so every later check refuses at once. The door reads the trip and refuses the whole script by name; it
// never serves a picture built while the clock ran out.
//
// ⛔ A LEAF: no imports, no clock of its own (the window carries the clock it was opened with), so `parse.js` and
// `pine.js` can both ask it. ⛔ Closed (no window), nothing here reads a clock: every check is one null test.

/** The open door window, or null: `{ deadline, budgetMs, clock, tripped, parent }`. */
let DOOR = null

/** The error a walk outside the translator's Resolvers throws when the door's deadline has passed. The translator
 *  throws its own `PineRefusal` (same guard) from its limbs; a caller that wraps a walk's throw (the round trip's
 *  `pine:roundtrip`) is still refused whole by the door, which reads the trip, not the error. */
export class DoorDeadlineError extends Error {
  constructor(budgetMs) {
    super(`the whole check of this script gave up after ${budgetMs}ms`)
    this.name = 'DoorDeadlineError'
    this.guard = 'pine:timeout'
    this.budgetMs = budgetMs
  }
}

/** Opens a window of `budgetMs` on `clock` (a function returning ms) inside whatever window is open; returns it. */
export function openDoorWindow(budgetMs, clock) {
  const win = {
    deadline: Number.isFinite(budgetMs) && budgetMs > 0 ? clock() + budgetMs : Infinity,
    budgetMs, clock, tripped: false, parent: DOOR,
  }
  DOOR = win
  return win
}

/** Closes `win` (the window `openDoorWindow` returned), restoring the one it was opened inside. */
export function closeDoorWindow(win) {
  if (win) DOOR = win.parent
}

/** Is a door window open? (One null test: the hot paths ask this before anything else.) */
export const doorWindowOpen = () => DOOR !== null

/** Has the open window tripped already? No clock read. */
export const doorTripped = () => DOOR !== null && DOOR.tripped

/** The innermost open window, or null. */
export const openDoor = () => DOOR

/** The first open window whose deadline has passed, marking it (and every window opened inside it) tripped, or
 *  null. ⛔ Reads no clock while no window is open. */
export function doorDeadlinePassed() {
  for (let w = DOOR; w !== null; w = w.parent) {
    if (w.tripped || (w.deadline !== Infinity && w.clock() > w.deadline)) {
      // every window opened inside the one that ran out is part of its call, so it stops too
      for (let i = DOOR; i !== w.parent; i = i.parent) i.tripped = true
      return w
    }
  }
  return null
}

let ticks = 0
/** Clock reads in a walk are sampled: one per this many ticks (the Resolver's own mask, `pine.js::BUDGET_CHECK_MASK`). */
const TICK_MASK = 4095

/** ⭐ A WALK'S CHECK. Cheap by construction: one null test with no window; with one, a tripped window throws at
 *  once and the clock is read on every 4,096th tick. */
export function doorTick() {
  if (DOOR === null) return
  if (DOOR.tripped) throw new DoorDeadlineError(DOOR.budgetMs)
  if (((ticks += 1) & TICK_MASK) !== 0) return
  const w = doorDeadlinePassed()
  if (w) throw new DoorDeadlineError(w.budgetMs)
}

/** A checkpoint between phases: throws once an open window's deadline has passed; a no-op otherwise. */
export function checkDoorDeadline() {
  if (DOOR === null) return
  const w = doorDeadlinePassed()
  if (w) throw new DoorDeadlineError(w.budgetMs)
}
