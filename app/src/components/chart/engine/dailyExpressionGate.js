// app/src/components/chart/engine/dailyExpressionGate.js
//
// ─── ⭐⭐ U-DAILY (e96, part B) — IS A DAILY EXPRESSION ABOVE AN INTRADAY CHART ADMITTED? ──────────────────────────
//
// The runtime lane reads `request.security(syminfo.tickerid, "D", close)` above an intraday chart (L12 PR 2, a BARE open /
// high / low / close, witnessed). Part B lets it read an EXPRESSION there (`ta.sma(close, 50)`, `high[1]` with look-ahead
// on), on the same witnessed row choice, behind the capability `request-daily-expression`, which is NOT admitted until
// its captures grade MATCH (`dailyExpressionWitness.json`). This module is the one answer the run asks
// (`pineRuntimeFrontend.js`, the resolver option `aboveDailyExpressions`; `runtimeColumns.js`, its memo keys).
//
// ⛔ THE RULE IS THE CAPABILITY REGISTRY'S (`api/services/rollout_gate.py::pine_capability_admission`), not a second
// one: `admitted` AND `status: conformant` AND at least two captures graded MATCH with the runtime pane on, of two
// distinct scripts, at least one of them a community script (`community: true`, set where the capture is graded:
// `rollout_gate.pine_evidence_script`); a ledger entry counts only while graded at this engine. The browser cannot import
// the server's function, so `tests/fixtures/pine/daily_expression_admission_cases.json` holds rows written to pass and to
// fail it, and BOTH lanes must answer every one as written (`dailyExpressionAbove.test.js`,
// `tests/test_daily_expression_admission_parity.py`): a drift in either is red.
// ⛔ A MEASUREMENT MAY OPEN IT (the vendor harness grading Q-DAILY-1, the census measuring the unit's reach), only through
// `setDailyExpressionAdmissionForMeasurement`, in the thread that builds; a member's chart never calls it.

import WITNESS from './dailyExpressionWitness.json'
import { SCRIPT_ENGINE_VERSION } from './scriptEngineVersion.js'

export const DAILY_EXPRESSION_CAPABILITY = 'request-daily-expression'
/** The clause the run says where the capability is not admitted. */
export const DAILY_EXPRESSION_NOT_ADMITTED = 'a daily expression read above an intraday chart is served once its capture '
  + `witness grades MATCH (capability \`${DAILY_EXPRESSION_CAPABILITY}\`, queue row ${WITNESS.queueRow}), and it has not yet`

/** Does this evidence entry count (`rollout_gate._pine_capability_evidence_counts`, a capability that is neither an
 *  object family nor a library version)? */
function counts(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false
  if (typeof e.capture !== 'string' || !e.capture || typeof e.script !== 'string' || !e.script) return false
  if (e.verdict !== 'MATCH' || e.runtimePane !== 'on') return false
  // a licence-held capture graded out of git counts only while graded at the engine this build ships
  if (Object.prototype.hasOwnProperty.call(e, 'ledger')) {
    return e.ledger === true && Number.isInteger(e.scriptEngineVersion) && e.scriptEngineVersion === SCRIPT_ENGINE_VERSION
  }
  return true
}

/** Why `row` does NOT admit the capability, or [] (the registry's rule, fail closed). */
export function dailyExpressionAdmissionReasons(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return ['no witness row']
  const why = []
  if (row.admitted !== true) why.push('not marked admitted')
  if (row.status !== 'conformant') why.push(`${row.status || 'ungraded'}, not conformant`)
  const counted = (Array.isArray(row.evidence) ? row.evidence : []).filter(counts)
  const captures = new Set(counted.map((e) => e.capture))
  const scripts = new Set(counted.map((e) => e.script))
  const community = new Set(counted.filter((e) => e.community === true).map((e) => e.script))
  if (community.size < 1) why.push('no community script among its evidence')
  if (captures.size < 2 || scripts.size < 2) {
    why.push(`${captures.size} MATCH captures with the runtime pane on from ${scripts.size} script(s); admission needs 2 from 2`)
  }
  return why
}

let _measurement = null

/** ⛔ MEASUREMENT ONLY (the vendor harness, the census, tests): open (true) or close (false) the capability whatever the
 *  row says; null hands the answer back to the row. A member's chart never calls this. */
export function setDailyExpressionAdmissionForMeasurement(on) {
  _measurement = on === null || on === undefined ? null : on === true
}

/** Is a daily expression above an intraday chart admitted on the runtime lane? */
export function dailyExpressionAdmitted() {
  if (_measurement !== null) return _measurement
  return dailyExpressionAdmissionReasons(WITNESS).length === 0
}

/** The witness row, as committed. */
export const DAILY_EXPRESSION_WITNESS = Object.freeze(WITNESS)
