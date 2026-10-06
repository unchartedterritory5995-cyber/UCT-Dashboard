// app/src/components/chart/engine/triggerPolicy.js
//
// ─── ⭐⭐ P1 SIGNAL — WHEN A YES/NO OUTPUT ALERTS: `triggerPolicy` ──────────────
//
// ONE definition → TYPED OUTPUTS → MANY SAFE CONSUMERS. A signal alert is the
// server alert lane reading a CONDITION (or a native EVENTS) output. The policy
// says WHEN that yes/no notifies, and it is SEPARATE FROM THE DEFINITION — it
// rides on the alert row, never in the tree:
//
//   is_true        → `above`       0.5   true on the newest closed bar
//   becomes_true   → `cross_above` 0.5   false on the bar before, true now
//   becomes_false  → `cross_below` 0.5   true on the bar before, false now
//
// It compiles onto the alert grammar that already exists (`condition` +
// `threshold`), so there is no new evaluator, no new store, and the member never
// sees 0.5. The server compiles the same table (`api/services/
// alert_trigger_policy.py`); `tests/fixtures/ast/p1_trigger_policy.json` holds
// the two equal.
//
// ⭐ WHY 0.5 IS SOUND HERE: a CONDITION column's domain is exactly {0, 1, NaN}
// (p1.core item 2) and an EVENTS column's is checked at registration, so every
// truth threshold in the codebase (`!= 0`, `> 0`, `> 0.5`) agrees on it; 0.5 is
// the alert lane's existing decoder. Unknown (NaN) becomes `None` at the lane
// boundary and never fires; a crossing needs a KNOWN previous bar — which is the
// P0 transition contract (F→T fires; U→T, U→U→T, F→U→T do not; U→F→T fires on
// its F→T).
//
// ⛔ A NUMERIC SERIES IS NEVER A SIGNAL BY THRESHOLD. "RSI as a yes/no at 0.5"
// would answer a question nobody asked. The shared gate refuses it
// (`signal:numeric-output`) and offers the explicit conversion: compare it.
//
// ⛔ NOTHING HERE TYPES AN OUTPUT OR DECIDES ADMISSION. The type is
// `outputTypeOf`'s; permission is `evaluability`'s (lane `signal`, then lane
// `alert`, the server preflight); the server decides at arm.

import { evaluability, LANES, STATUS } from './evaluability'
import { outputTypeOf, isTruthType } from './outputType'

/** The one number that separates 0 from 1. A decoder, never a member-facing level. */
export const TRUTH_DECODER = 0.5

export const TRIGGER_POLICIES = Object.freeze({
  IS_TRUE: 'is_true',
  BECOMES_TRUE: 'becomes_true',
  BECOMES_FALSE: 'becomes_false',
})

const TABLE = Object.freeze({
  [TRIGGER_POLICIES.IS_TRUE]: Object.freeze({ condition: 'above', threshold: TRUTH_DECODER, label: 'Is true' }),
  [TRIGGER_POLICIES.BECOMES_TRUE]: Object.freeze({ condition: 'cross_above', threshold: TRUTH_DECODER, label: 'Becomes true' }),
  [TRIGGER_POLICIES.BECOMES_FALSE]: Object.freeze({ condition: 'cross_below', threshold: TRUTH_DECODER, label: 'Becomes false' }),
})

/** What a surface offers, in order. `becomes_true` is the default: an edge
 *  notifies once per event, where `is_true` holds for as long as it stays true. */
export const POLICY_OPTIONS = Object.freeze(
  [TRIGGER_POLICIES.BECOMES_TRUE, TRIGGER_POLICIES.BECOMES_FALSE, TRIGGER_POLICIES.IS_TRUE]
    .map((value) => Object.freeze({ value, label: TABLE[value].label })),
)
export const DEFAULT_POLICY = TRIGGER_POLICIES.BECOMES_TRUE

/** `policy` → `{condition, threshold}`. Throws on an unknown policy. */
export function compileTriggerPolicy(policy) {
  const row = TABLE[policy]
  if (!row) throw new Error(`${JSON.stringify(policy)} is not a trigger policy`)
  return { condition: row.condition, threshold: row.threshold }
}

/** The policy a stored `(condition, threshold)` IS, or null. */
export function policyOf(condition, threshold) {
  for (const [name, row] of Object.entries(TABLE)) {
    if (row.condition === condition && Number(threshold) === row.threshold) return name
  }
  return null
}

export function policyLabel(policy) {
  return (TABLE[policy] && TABLE[policy].label) || null
}

/** Is a served / derived output type one a trigger policy applies to? */
export function takesTriggerPolicy(type) {
  return isTruthType(type)
}

/**
 * ⭐ THE BROWSER PREFLIGHT BEFORE ARMING: the shared gate must approve `key` of
 * `def` for the ALERT lane (the server's preflight, in its order: lane, plot,
 * scalar, withheld — so an unsupplied `sym`/`ltf` is refused with the alert
 * lane's own reason) AND as a SIGNAL (truth-typed: a SERIES is
 * `signal:numeric-output`). The first refusal is returned verbatim — its guard
 * and P0 sentence. A `supported` answer is never final: the server decides at arm.
 */
export function signalAlertGate(def, key, ctx) {
  const alert = evaluability(def, key, LANES.ALERT, ctx)
  if (alert.status === STATUS.REFUSED) return alert
  const signal = evaluability(def, key, LANES.SIGNAL, ctx)
  if (signal.status === STATUS.REFUSED) return signal
  return alert
}

/**
 * Build the create payload for a policy-armed alert on output `key` of a user
 * definition, or return the gate's refusal. The payload names the output by
 * ADDRESS only (`<defId>.<key>`): no tree, no source, no copied formula — the
 * server evaluates the STORED definition's tree.
 *
 * @returns {{ok: true, payload: object, gate: object} | {ok: false, gate: object}}
 */
export function signalAlertRequest({ def, key, policy, sym, tf, ctx } = {}) {
  const gate = signalAlertGate(def, key, ctx)
  if (gate.status === STATUS.REFUSED) return { ok: false, gate }
  const { condition, threshold } = compileTriggerPolicy(policy)
  return {
    ok: true,
    gate,
    payload: {
      sym: String(sym || '').toUpperCase(),
      indicator: `${def.id}.${key}`,
      trigger_policy: policy,
      condition,
      threshold,
      tf,
    },
  }
}

/** The output type of an alert address's plot, from the installed definition
 *  when the browser has it. Null when it does not (the server's served type is
 *  then the only one, and the server re-derives it at the door anyway). */
export function outputTypeForAddress(getDefinition, address) {
  const m = /^(u_[0-9a-f]{12})\.(.+)$/.exec(String(address || ''))
  if (!m || typeof getDefinition !== 'function') return null
  const def = getDefinition(m[1])
  if (!def) return null
  return { def, key: m[2], type: outputTypeOf(def, m[2]).type }
}
