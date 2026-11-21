// app/src/components/chart/imperativeSwitch.js
//
// ─── THE IMPERATIVE SWITCH'S ROLLBACK SWITCH (docs/charts/imperative-switch-design.md §5; 2026-11-21) ─────────
//
// `localStorage['uct.imperativeSwitch']`: '1' turns the React-free symbol switch on for this browser, anything
// else (unset, '0') leaves it OFF. ⛔ DEFAULT OFF. `chartSpeedKilled()` (the server's kill over every chart speed
// switch, lib/chartSpeed.js) wins over a local '1'.
//
// ⭐ READ ONCE PER PAGE LOAD, so one load never mixes the two paths. OFF is exactly today's path: StockChart
// never creates a controller, and its pass is what `StockChart.applyFrameParity.test.jsx` recorded.
//
// ⛔ CHART CHUNK ONLY (it imports lib/chartSpeed.js, which the Notebook's first open must never reach): imported
// by StockChart and the switch controller, never by a generic hook, the board or the entry.

import { chartSpeedKilled } from '../../lib/chartSpeed'

export const IMPERATIVE_SWITCH_KEY = 'uct.imperativeSwitch'

let _on = null

/** Is the imperative switch on for this page load? Never throws: an unreadable store is OFF. */
export function imperativeSwitchOn() {
  if (_on !== null) return _on
  if (chartSpeedKilled()) return (_on = false)
  try { _on = typeof localStorage !== 'undefined' && localStorage.getItem(IMPERATIVE_SWITCH_KEY) === '1' } catch { _on = false }
  return _on
}

/** Tests: force the switch (null re-reads storage on the next ask). */
export function __setImperativeSwitchForTests(v) { _on = v === null || v === undefined ? null : !!v }
