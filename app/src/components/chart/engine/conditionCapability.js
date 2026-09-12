import { parseSource } from './sourceRef'
import { namesIn, capabilityOf } from './operandCapability'
import { parseFormula } from './ast/parse'

// ─── CAN THIS CONDITION RUN WHEN THE CHART IS CLOSED? ───────────────────────
//
// ⭐⭐ ALERTABILITY IS A CAPABILITY, NOT A PROPERTY EVERY CONDITION MUST HAVE.
// UCT now has two legitimate kinds of condition and they MEAN different things:
//
//   LOCAL     `a > 50` with `a = @legacy:rsi::rsi`
//             "follow the RSI on THIS chart." Change that instance from 14 to 28
//             and this condition follows — which is exactly right for shading a
//             chart, and exactly why it cannot run on a server that has never
//             heard of a chart instance.
//
//   DURABLE   `rsi(close, 28) > 50`, owned by a boolean user definition.
//             "run this truth anywhere." Self-contained, canonical AST, stored
//             server-side, revisioned, parity-admitted — and therefore alertable.
//
// ⛔⛔ AND ONE IS NEVER SILENTLY TURNED INTO THE OTHER. Rewriting
// `a > 50 / a = @legacy:rsi::rsi` into `rsi(close, 14) > 50` looks like a
// promotion and is a CHANGE OF MEANING: the first follows the chart's RSI, the
// second freezes its inputs at the moment of promotion. If the member later moves
// that RSI to 28, the chart would shade on one truth while the alert fired on
// another. That is the drift this whole phase exists to make impossible, so the
// conversion is refused and handed back to the member to author deliberately.

/** A condition whose formula names a chart instance. Never auto-promotable. */
export const LOCAL_ONLY = 'local_only'
/** Self-contained inline formula — promotion may proceed. */
export const PROMOTABLE = 'promotable'
/** Already backed by a durable definition. Alertable now. */
export const DURABLE = 'durable'
/** Names a definition that is not installed (deleted, or not yet loaded). */
export const SOURCE_UNAVAILABLE = 'source_unavailable'
/** The formula does not read back at all. */
export const INVALID = 'invalid'

export const CAPABILITIES = Object.freeze([
  LOCAL_ONLY, PROMOTABLE, DURABLE, SOURCE_UNAVAILABLE, INVALID,
])

/**
 * The member-facing sentence for each capability.
 *
 * ⛔ IT NAMES THE REASON, NOT THE MECHANISM. "`@instanceId` bindings are
 * unsupported" tells a member about our data model. "This condition follows an
 * indicator on this chart" tells them what they built, and the second half tells
 * them why that is the thing standing in the way.
 */
export const CAPABILITY_REASON = Object.freeze({
  [LOCAL_ONLY]:
    'This condition follows an indicator on this chart. Alerts need a standalone '
    + 'formula so they can keep running when the chart is closed.',
  [SOURCE_UNAVAILABLE]:
    'The formula this condition runs on is no longer available.',
  [INVALID]:
    'This condition does not have a formula that reads back yet.',
  [PROMOTABLE]: null,
  [DURABLE]: null,
})

/** Does this condition's formula name a chart instance anywhere? */
export function boundInstances(cond) {
  const out = new Set()
  // A declared binding is the ordinary spelling…
  for (const ref of Object.values((cond && cond.bindings) || {})) {
    const parsed = parseSource(ref)
    if (parsed && parsed.kind === 'instance') out.add(parsed.instanceId)
  }
  // …and the formula text is checked too, because a binding key that was DELETED
  // leaves the name behind in the tree. A condition reading an unbound `a` is not
  // instance-bound, but it is not self-contained either — `namesIn` catches it as
  // an unknown name and `capabilityOf` reports it.
  return [...out]
}

/**
 * Every name in the tree that a CHART can resolve but a SERVER cannot.
 *
 * ⭐ IT REUSES `operandCapability`, the same resolver the picker and the runtime
 * guard read. A `'binding'` there is precisely "the chart's own extension that the
 * screener has no notion of" — which is the same sentence as "the thing that
 * stops this running on a server".
 */
function chartOnlyNames(ast, cond) {
  const declared = new Set(Object.keys((cond && cond.bindings) || {}))
  const chartOnly = []
  const unknown = []
  for (const name of namesIn(ast)) {
    if (declared.has(name)) { chartOnly.push(name); continue }
    const kind = capabilityOf(name).kind
    if (kind === 'binding') { chartOnly.push(name); continue }
    // ⚠️ AN UNKNOWN NAME IS NOT A CHART BINDING AND IT IS NOT SELF-CONTAINED
    // EITHER — it is a formula that reads something nothing declares, which
    // `interpret` refuses at `resolve:name` on the chart too. Reporting it as
    // LOCAL_ONLY would offer the member a "create alertable version" handoff for a
    // condition that does not work anywhere; INVALID is the true answer.
    if (kind === 'unknown') unknown.push(name)
  }
  return { chartOnly, unknown }
}

/**
 * What can this condition do?
 *
 * @param {object} cond  a NORMALISED condition
 * @param {{hasDefinition?: (id: string) => boolean}} [ctx]
 *   `hasDefinition` answers whether the durable definition is installed. Absent
 *   ⇒ a definition-backed condition is reported DURABLE on trust, which is the
 *   right answer for a caller that has no registry in hand (a pure test, a
 *   settings-only door) and the wrong one for the bell — so the bell passes it.
 * @returns {{capability: string, reason: string|null, definitionId: string|null,
 *            boundTo: string[]}}
 */
export function conditionCapability(cond, ctx = {}) {
  const definitionId = (cond && cond.definitionId) || null
  if (definitionId) {
    const has = typeof ctx.hasDefinition === 'function' ? !!ctx.hasDefinition(definitionId) : true
    const capability = has ? DURABLE : SOURCE_UNAVAILABLE
    return {
      capability,
      reason: CAPABILITY_REASON[capability],
      definitionId,
      boundTo: [],
    }
  }

  const formula = (cond && cond.formula) || ''
  if (!formula.trim()) {
    return { capability: INVALID, reason: CAPABILITY_REASON[INVALID], definitionId: null, boundTo: [] }
  }
  const parsed = parseFormula(formula)
  if (!parsed.ok || !parsed.ast) {
    return { capability: INVALID, reason: CAPABILITY_REASON[INVALID], definitionId: null, boundTo: [] }
  }

  const { chartOnly, unknown } = chartOnlyNames(parsed.ast, cond)
  if (unknown.length) {
    return { capability: INVALID, reason: CAPABILITY_REASON[INVALID], definitionId: null, boundTo: [] }
  }
  if (chartOnly.length) {
    return {
      capability: LOCAL_ONLY,
      reason: CAPABILITY_REASON[LOCAL_ONLY],
      definitionId: null,
      // The INSTANCES, for the handoff: the Builder shows the member what their
      // bound names currently resolve to, so they can author the standalone form
      // knowing which RSI they meant.
      boundTo: boundInstances(cond),
    }
  }
  return { capability: PROMOTABLE, reason: null, definitionId: null, boundTo: [] }
}

/** Convenience for the bell: may this condition have an alert attached today? */
export const isAlertable = (cond, ctx) => conditionCapability(cond, ctx).capability === DURABLE
