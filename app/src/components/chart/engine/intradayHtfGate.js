// app/src/components/chart/engine/intradayHtfGate.js
//
// ─── ⭐⭐ E101 INTRADAY-HTF — IS A HIGHER INTRADAY TIMEFRAME READ ADMITTED ON THE RUNTIME LANE? ──────────────────────
//
// `request.security(syminfo.tickerid, "60", x)` on a 15 minute chart is built (`interpret.js::periodStamps`, the chart's
// own grid) behind the capability `request-intraday-htf`. The door builds it only where this module says so
// (`pine.js::securityAsNode`, the resolver option `intradayHtfReads`).
//
// ⭐⭐ LIVE BY THE OWNER'S RULING (2026-11-28, `intradayHtfWitness.json::ownerLive`): "anything and everything goes live
// for all. We only have us building right now and no testers besides me yet". So the capability is admitted for every
// chart while the evidence the capability registry's rule asks for (`dailyExpressionAdmissionReasons`: admitted,
// conformant, two MATCH captures of two scripts, one a community script) is still being gathered: queue row Q-IHTF-1
// is the check that drives the next fix, not a hold. `intradayHtfAdmissionReasons` still answers what that evidence
// lacks, so the registry's state is never misreported as met.
// ⛔ A MEASUREMENT MAY STILL CLOSE OR OPEN IT (the vendor harness grading Q-IHTF-1, a rail proving the closed door),
// only through `setIntradayHtfAdmissionForMeasurement`, in the thread that builds; a member's chart never calls it.

import WITNESS from './intradayHtfWitness.json'
import { dailyExpressionAdmissionReasons } from './dailyExpressionGate.js'

export const INTRADAY_HTF_CAPABILITY = 'request-intraday-htf'

let _measurement = null

/** ⛔ MEASUREMENT ONLY: open (true) or close (false) the capability whatever the row says; null hands it back. */
export function setIntradayHtfAdmissionForMeasurement(on) {
  _measurement = on === null || on === undefined ? null : on === true
}

/** Why the witness row's EVIDENCE does not yet meet the registry's rule, or [] (fail closed). */
export function intradayHtfAdmissionReasons(row = WITNESS) {
  return dailyExpressionAdmissionReasons(row)
}

/** Is the row live by an owner ruling (a non-empty `ownerLive` record)? */
export function intradayHtfOwnerLive(row = WITNESS) {
  return !!row && typeof row.ownerLive === 'object' && row.ownerLive !== null
    && typeof row.ownerLive.date === 'string' && typeof row.ownerLive.words === 'string' && row.ownerLive.words.length > 0
}

/** Is a higher intraday timeframe read admitted on the runtime lane? */
export function intradayHtfAdmitted() {
  if (_measurement !== null) return _measurement
  return intradayHtfOwnerLive(WITNESS) || intradayHtfAdmissionReasons(WITNESS).length === 0
}

/** The witness row, as committed. */
export const INTRADAY_HTF_WITNESS = Object.freeze(WITNESS)
