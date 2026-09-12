import { conditionCapability, DURABLE, SOURCE_UNAVAILABLE, CAPABILITY_REASON } from './conditionCapability'
import { compilePolicy, DEFAULT_POLICY, TRIGGER_POLICIES } from './triggerPolicy'
import { signalPlotKey } from './definitionSignal'

// ─── A DURABLE CONDITION → AN ALERT ROW ─────────────────────────────────────
//
// ⭐⭐ THIS MODULE BUILDS A BODY AND NOTHING ELSE. `POST /api/indicator-alerts`
// already exists, `createIndicatorAlert` already speaks it, the evaluator already
// judges it and `alert_user_series` already admits a user address at arm time.
// What was missing is the TRANSLATION: a member's "alert me when this condition
// becomes true" into the four fields that endpoint takes. One function, so the
// bell and any later surface cannot each invent their own spelling.
//
// ⛔ IT REFUSES ANYTHING THAT IS NOT DURABLE. An alert on a chart-bound condition
// would be stored against an address the server cannot resolve — accepted, armed,
// and permanently mute. That is the exact defect `vwap` was (offered, stored,
// never fires) and it is the one this whole lane exists to make impossible, so
// the refusal happens HERE, before a request is made, with the member's sentence.
//
// ⚠️ AND THE ADDRESS IS DERIVED, NEVER SPELLED. `u_abc.value` is right for every
// condition this lane promotes because a promoted condition is single-plot — but
// `.value` typed into a string here would be wrong the first time a member alerts
// on plot 2 of a multi-plot definition, and wrong SILENTLY (a well-formed address
// with no value function behind it). The definition names its own scan plot.

/** `u_<12 hex>.<plotKey>` — the grammar `alert_user_series.USER_ADDRESS_RE` holds. */
const USER_ADDRESS_RE = /^u_[0-9a-f]{12}\.[A-Za-z0-9_][A-Za-z0-9_-]*$/

/** `u_abc….value`, or `null` if what came back is not an address the server takes. */
export function alertAddress(def) {
  const id = (def && (def.id || def.def_id)) || ''
  const address = `${id}.${signalPlotKey(def)}`
  return USER_ADDRESS_RE.test(address) ? address : null
}

/**
 * The `POST /api/indicator-alerts` body for "alert me when this condition <policy>".
 *
 * @param {object} cond      a NORMALISED condition
 * @param {object} opts
 *   - `sym`        the symbol, upper-cased by the caller's convention
 *   - `tf`         a NATIVE timeframe code — the chart's own
 *   - `definition` the durable definition document this condition names
 *   - `policyId`   a `triggerPolicy` id; defaults to `becomes_true`
 *   - `chartId`    optional — present ⇒ the alert is scoped to this chart
 *   - `hasDefinition` optional — the registry probe `conditionCapability` reads
 * @returns {{ok: true, payload: object, policy: object}
 *   | {ok: false, reason: string, capability?: string}}
 */
export function alertPayloadFor(cond, opts = {}) {
  const { sym, tf, definition, policyId = DEFAULT_POLICY, chartId = null } = opts

  const cap = conditionCapability(cond, opts)
  if (cap.capability !== DURABLE) {
    return {
      ok: false,
      capability: cap.capability,
      // ⭐ THE CAPABILITY'S OWN SENTENCE, not a second one written here. The bell
      // and this module would otherwise explain the same refusal two ways.
      reason: cap.reason || CAPABILITY_REASON[cap.capability] || 'this condition cannot be alerted on',
    }
  }

  const compiled = compilePolicy(policyId)
  if (!compiled) {
    return { ok: false, reason: `no trigger policy named ${JSON.stringify(policyId)}` }
  }

  if (!definition) {
    return { ok: false, reason: CAPABILITY_REASON[SOURCE_UNAVAILABLE] }
  }
  const address = alertAddress(definition)
  if (!address) {
    return { ok: false, reason: 'this formula does not have an address an alert can name yet' }
  }
  // ⛔ THE CONDITION'S definitionId AND THE DOCUMENT MUST BE THE SAME OBJECT.
  // Arming against a definition the caller fetched for some OTHER row would store
  // a perfectly valid alert on the wrong formula — the one failure in this module
  // that nothing downstream could ever detect.
  if (!address.startsWith(`${cap.definitionId}.`)) {
    return { ok: false, reason: 'that formula does not belong to this condition' }
  }

  if (!sym) return { ok: false, reason: 'an alert needs a symbol' }
  if (!tf) return { ok: false, reason: 'an alert needs a timeframe' }

  const payload = {
    sym: String(sym).toUpperCase(),
    indicator: address,
    condition: compiled.condition,
    threshold: compiled.threshold,
    tf: String(tf),
  }
  // ⚠️ OMITTED, NOT NULL. `_clean_scope` stores NULL for an absent `scope`, which
  // is the shape every pre-scope row has; sending `scope: null` explicitly is a
  // different request shape for the same meaning.
  if (chartId) payload.scope = chartId

  return { ok: true, payload, policy: TRIGGER_POLICIES[policyId] }
}

/**
 * Does this stored alert row belong to this condition?
 *
 * ⭐ FOR THE BELL'S "ON" STATE. It matches on the ADDRESS and the symbol, not on
 * an id we would have to store on the condition — a condition that already has an
 * alert should read as armed even if that alert was created from the alert
 * manager, and a second source of truth for "is there one" is a second thing to
 * keep in step.
 */
export function alertsForCondition(rows, cond, { definition, sym } = {}) {
  const address = definition ? alertAddress(definition) : null
  const want = (cond && cond.definitionId) || null
  if (!address || !want || !address.startsWith(`${want}.`)) return []
  const upper = sym ? String(sym).toUpperCase() : null
  return (Array.isArray(rows) ? rows : []).filter((a) => (
    a && a.indicator === address
    && (!upper || String(a.sym || '').toUpperCase() === upper)
  ))
}
