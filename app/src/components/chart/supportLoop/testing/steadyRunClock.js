// app/src/components/chart/supportLoop/testing/steadyRunClock.js
//
// ─── A VALUE CHECK MUST NOT DEPEND ON HOW BUSY THE BOX IS ──────────────────────────────
//
// The engine stops a run past its wall-clock budget, by name (`runtime:time-budget`, 1,000 ms on a
// main-thread door: `runtimeColumns.RUNTIME_PANE_TIME_BUDGET_MS`). That is a safety stop for a
// member's chart. A test that asserts VALUES and runs a whole recipe on 2,000 bars reads that same
// clock, so on a busy runner it can fail on the clock and not on the numbers.
//
// ⚰️ 2026-11-19: `assistantRecipes.values.test.js > weekday-returns-table: its redraw runs on every
// bar` took about 1.2 s under load on the dev PC, was stopped by the budget, and failed; alone it
// passed twice. Cutting the bars made it rarer, not impossible.
//
// THE CLASS FIX (the one the engine's own budget rails use: `runtime/__tests__/paneBudgetPerBar.
// test.js`): a STEPPING clock. Every read of the host clock advances a fixed step, so a run's "time"
// is the number of times it read the clock, which is a property of the script and the bars, never
// of the machine. At the default step a run would have to read the clock a million times to reach
// 1,000 ms, so no value check here is ever stopped by time, on any box.
//
// ⛔ NOT FOR A TEST THAT RENDERS: React's scheduler reads `performance.now` too. It is for the pure
// files that hand a definition and bars to the engine and read the columns back.

import { vi } from 'vitest'

/** One thousandth of a millisecond per read: a million reads to the 1,000 ms budget. */
export const STEADY_STEP_MS = 0.001

/**
 * Replace the host clock with one that advances `stepMs` on every read. Returns `{reads, restore}`.
 * Call in `beforeEach` and `restore()` in `afterEach` (a spy left in place changes the next file).
 */
export function steadyRunClock(stepMs = STEADY_STEP_MS) {
  const s = { t: 0, reads: 0 }
  const spy = vi.spyOn(globalThis.performance, 'now').mockImplementation(() => { s.reads += 1; s.t += stepMs; return s.t })
  return { reads: () => s.reads, restore: () => spy.mockRestore() }
}
