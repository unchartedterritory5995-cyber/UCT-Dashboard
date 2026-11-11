// app/src/components/chart/engine/lowerTfServing.js
//
// ─── ⭐⭐ W5-T2 — THE LOWER-TIMEFRAME GATE, AS THE TRANSLATOR SEES IT (A LEAF) ──────
//
// `lowerTf.js` asks "may a read below the chart be served?" from inside the
// translator, which is inside the runtime lane's compute closure. The answer is a
// BUILD FLAG (`lowerTfGate.js`, `import.meta.env`), and a build flag read inside the
// closure is a second authority the moment a second host reads a different value
// (docs/pine/SERVER-RUNTIME-DESIGN.md 2.2 H3). So the flag stays at the DOOR:
// `lowerTfGate.js` registers its reader here when it is imported (the chart's
// registry imports it, `nativeRegistry.js`), and this module imports nothing.
//
// ⛔ UNREGISTERED IS OFF — the gate's own fail-closed answer. A host that never
// opened the door (the runtime worker, the server bundle) refuses every read below
// the chart by name (`lower-tf:store-unmeasured`) and fetches nothing. The runtime
// lane serves no such read on either side of the gate (it holds no intraday bars:
// `lower-tf:runtime-lane`), so only that refusal's NAME can differ, never a value.
let _gate = null

/** The door's reader of the flag, or `null` to take it away. */
export function registerLowerTfGate(fn) {
  _gate = typeof fn === 'function' ? fn : null
}

/** May a read below the chart's own timeframe be served? `false` until a door registers. */
export function lowerTfServingEnabled() {
  if (!_gate) return false
  try { return _gate() === true } catch { return false }
}
