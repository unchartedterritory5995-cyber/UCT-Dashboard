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

/** Opens a window of `budgetMs` on `clock` (a function returning ms) inside whatever window is open; returns it.
 *  `pulse` (optional, e96): called at each of the window's clock reads (`doorDeadlinePassed`), so the walks this window
 *  bounds drive the member door's worker's heartbeat (`../workPulse.js`, handed in by `pine.js::withDoorDeadline`). */
export function openDoorWindow(budgetMs, clock, pulse = null) {
  const win = {
    deadline: Number.isFinite(budgetMs) && budgetMs > 0 ? clock() + budgetMs : Infinity,
    budgetMs, clock, tripped: false, parent: DOOR, pulse: typeof pulse === 'function' ? pulse : null,
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
  // ⭐⭐ e96 — the door's clock read is a pulse of the work it bounds (`openDoorWindow`'s `pulse`): it never changes a
  // value and never throws, so a walk answers exactly as it would without it
  if (DOOR !== null && DOOR.pulse !== null) DOOR.pulse()
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

// ─── ⭐⭐ (engine 94, coordinator ruling 2026-11-22, interim) — A MAIN-THREAD WALL CAP, SUPPLIED BY THE CALLER ────
//
// With the deterministic budgets a translation is bounded by its step budget, and the wall clock only by last-resort
// stops sized in MINUTES for the workers the member paths run in (#2254, #2364, #2367): no 10 s window any more. A caller
// that still runs a check on the page's MAIN THREAD supplies its own short cap here. Today that is one caller: the
// authoring script check (`builder/authoring/scriptAnswer.js`), until it moves to the door's worker, which removes the
// cap. `fn` runs inside a door window of `capMs` on `clock`, so every limb of the call asks it (each translation, the
// door's own window opened inside it, the round trip's walks), and an expired cap answers `capped` with NO value: never
// a part of a check and never a document built while the cap ran out; the caller refuses by name. A call that finished
// past the cap without a limb noticing is `capped` too. ⛔ No worker path opens one (`scriptCheckCap.test.js`).
// `fn` is synchronous (the window is this module's state: it must never span an await).

/**
 * @param {number} capMs  the caller's cap, in ms (> 0)
 * @param {() => *} fn    the synchronous main-thread work
 * @param {() => number} clock  the wall clock the cap is read on (ms)
 * @returns {{value: *, capped: boolean, elapsedMs: number}} `value` is null whenever `capped`
 */
export function withMainThreadCap(capMs, fn, clock) {
  if (!(Number.isFinite(capMs) && capMs > 0) || typeof fn !== 'function' || typeof clock !== 'function') {
    throw new TypeError('withMainThreadCap(capMs > 0, fn, clock)')
  }
  const t0 = clock()
  const win = openDoorWindow(capMs, clock)
  let value = null
  try {
    value = fn()
  } catch (err) {
    if (!win.tripped) throw err
  } finally {
    closeDoorWindow(win)
  }
  const elapsedMs = clock() - t0
  const capped = win.tripped || elapsedMs > capMs
  return { value: capped ? null : value, capped, elapsedMs }
}
