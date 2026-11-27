// app/src/components/chart/engine/workPulse.js
//
// ─── ⭐⭐ THE WORK PULSE (engine train e96, coordinator ruling 2026-11-23): A CHECK THAT IS WORKING SAYS SO ─────────
//
// Engine 94 moved a paste's build and PasteBox's report into the member door's Web Worker (#2254, #2364, #2367) and
// replaced the old 10 s cut with deterministic budgets (#2525): the door's last-resort stop is 25 minutes
// (`memberPaneDefinition.MEMBER_DOOR_BUDGET_MS`), so the page's watchdog is 25.5. A worker that is merely SLOW is
// legitimate (real scripts take minutes); a worker that HANGS would hold a member on "Checking your script..." for
// all of those 25.5 minutes. The page tells the two apart by this pulse: while a worker works it posts a heartbeat at
// least every few seconds (`builder/memberPane/memberDoorWorkerCore.js`), and the page treats a running job that has
// said nothing for `MEMBER_DOOR_SILENCE_MS` as a dead worker (`builder/memberPane/memberDoorAsync.js`).
//
// ⭐ DRIVEN BY THE WORK'S OWN COUNTED STEPS, NEVER BY A TIMER. A job holds the worker's thread from start to answer, so
// a timer cannot fire while it runs; and a pulse from the step loops stops exactly when the work stops stepping, which
// is the hang the page must see. The loops that already count steps call `workPulse`:
//   · `ast/pine.js::countCallStep`: every resolution step and printer tick (the translator's step budget);
//   · the door window's clock read (`ast/doorDeadline.js::doorDeadlinePassed`): the door's walks outside a Resolver;
//   · `runtime/vm.js`: every bar's instruction charge (`TOTAL_INSTRUCTIONS`, the door's probe runs).
//
// ⛔ A LEAF: no imports and no clock of its own (the installer hands it one), so the translator, the parser's door
// window and the VM can all call it, and a host that installs nothing (the page's main thread, the server, a test)
// pays one null test per call. ⛔ It never changes a value and never throws: a pulse that cannot be posted is dropped,
// and the work goes on exactly as it would without it.

/** How many units of work pass between two reads of the pulse's clock (a step is one unit; a VM bar is its
 *  instructions). The translator samples its own clock at the same period (`pine.js::BUDGET_CHECK_MASK`). */
export const WORK_PULSE_PERIOD = 4096

let PULSE = null   // { beat, everyMs, clock, last } while installed
let units = 0
let nextRead = WORK_PULSE_PERIOD

/**
 * Installs the pulse: `beat(t)` is called with the clock's reading at most once per `everyMs` of that clock, from the
 * work's own steps. Replaces any pulse installed before. `beat` null removes it.
 * @param {((t: number) => void)|null} beat
 * @param {{everyMs: number, clock: () => number}} opts
 */
export function setWorkPulse(beat, { everyMs, clock } = {}) {
  if (typeof beat !== 'function' || typeof clock !== 'function' || !(Number.isFinite(everyMs) && everyMs > 0)) {
    PULSE = null
    return
  }
  PULSE = { beat, everyMs, clock, last: clock() }
  units = 0
  nextRead = WORK_PULSE_PERIOD
}

/** Is a pulse installed? */
export const workPulseInstalled = () => PULSE !== null

/** Restarts the interval: the next beat comes `everyMs` after now (a job's own first beat was just sent). */
export function restartWorkPulse() {
  if (PULSE === null) return
  try { PULSE.last = PULSE.clock() } catch { /* a clock that cannot be read leaves the interval as it was */ }
}

/** ⭐ ONE PULSE OF WORK, `n` units of it. With no pulse installed: one null test. With one: the clock is read each time
 *  the units counted cross a `WORK_PULSE_PERIOD` boundary, and a beat is sent when `everyMs` has passed since the last. */
export function workPulse(n = 1) {
  if (PULSE === null) return
  units += n
  if (units < nextRead) return
  nextRead = units + WORK_PULSE_PERIOD
  const p = PULSE
  let t
  try { t = p.clock() } catch { return }
  if (!(t - p.last >= p.everyMs)) return
  p.last = t
  try { p.beat(t) } catch { /* the page is gone: the work goes on */ }
}
