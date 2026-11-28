// app/src/components/chart/engine/intradayHtfGate.js
//
// ─── ⭐⭐ E101 INTRADAY-HTF — IS A HIGHER INTRADAY TIMEFRAME READ ADMITTED ON THE RUNTIME LANE? ──────────────────────
//
// `request.security(syminfo.tickerid, "60", x)` on a 15 minute chart is built (`interpret.js::periodStamps`, the chart's
// own grid) behind the capability `request-intraday-htf`, which is NOT admitted until its captures grade MATCH
// (`intradayHtfWitness.json`, queue row Q-IHTF-1). Until then the door declines the read as it always did
// (`pine.js::securityAsNode`, the resolver option `intradayHtfReads`), so a member's chart is unchanged.
// ⛔ THE RULE IS THE CAPABILITY REGISTRY'S, read through the daily-expression gate's own function
// (`dailyExpressionAdmissionReasons`: admitted, conformant, two MATCH captures of two scripts, one a community script),
// never a second copy of it.
// ⛔ A MEASUREMENT MAY OPEN IT (the vendor harness grading Q-IHTF-1, the census measuring the unit's reach), only through
// `setIntradayHtfAdmissionForMeasurement`, in the thread that builds; a member's chart never calls it.

import WITNESS from './intradayHtfWitness.json'
import { dailyExpressionAdmissionReasons } from './dailyExpressionGate.js'

export const INTRADAY_HTF_CAPABILITY = 'request-intraday-htf'

let _measurement = null

/** ⛔ MEASUREMENT ONLY: open (true) or close (false) the capability whatever the row says; null hands it back. */
export function setIntradayHtfAdmissionForMeasurement(on) {
  _measurement = on === null || on === undefined ? null : on === true
}

/** Why the witness row does NOT admit the capability, or [] (the registry's rule, fail closed). */
export function intradayHtfAdmissionReasons(row = WITNESS) {
  return dailyExpressionAdmissionReasons(row)
}

/** Is a higher intraday timeframe read admitted on the runtime lane? */
export function intradayHtfAdmitted() {
  if (_measurement !== null) return _measurement
  return intradayHtfAdmissionReasons(WITNESS).length === 0
}

/** The witness row, as committed. */
export const INTRADAY_HTF_WITNESS = Object.freeze(WITNESS)
