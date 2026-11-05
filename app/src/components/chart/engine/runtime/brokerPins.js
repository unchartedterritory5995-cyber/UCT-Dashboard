// app/src/components/chart/engine/runtime/brokerPins.js
//
// ─── W9 `pinned(ruleId)`: ONE QUESTION, ASKED AT RUN TIME ───────────────────
//
// Every broker emulator rule serves only when a MATCHing TradingView capture pins
// it (W9 design rule 2). This is the reader. The ledger it reads is
// `brokerPins.resolved.json`: committed, canonical, produced by
// `tools/vendor_harness/evidence_engine.py pins` from the hand-edited
// `brokerPins.json` (rule -> fixture ids) and the committed verdicts, and kept
// honest by `brokerPins.lock.json` + `brokerPinsLock.js` (the lock rail).
//
// ⛔ A STORED RUNTIME DOCUMENT NEVER EMBEDS PIN STATE. Pins reach served output only
// through the code version (rule 7: a pin landing is an engine change and takes a
// `SCRIPT_ENGINE_VERSION` bump, made by the coordinator, never here).
//
// ⛔ THE SECOND ARGUMENT IS FOR TESTS ONLY. `pinned(rule, explicitPinSet)` lets a
// test pass its own set. `brokerPinsLock.test.js` greps every non-test source file
// and refuses the argument anywhere outside `__tests__` (and is mutation-proved).
import RESOLVED from './brokerPins.resolved.json'

export function pinned(ruleId, explicitPinSet) {
  if (typeof ruleId !== 'string' || ruleId === '') return false
  const set = explicitPinSet === undefined ? RESOLVED.rules : explicitPinSet
  if (set instanceof Set) return set.has(ruleId)
  return Object.prototype.hasOwnProperty.call(set || {}, ruleId)
}
