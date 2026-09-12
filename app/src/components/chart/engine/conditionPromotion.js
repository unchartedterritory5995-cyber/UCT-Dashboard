import { conditionCapability, PROMOTABLE, DURABLE } from './conditionCapability'
import { conditionsOf } from './conditionControls'

// ─── MAKING A LOCAL CONDITION ALERTABLE ─────────────────────────────────────
//
// ⭐⭐ PROMOTION MOVES OWNERSHIP OF THE FORMULA, AND CHANGES NOTHING ELSE. The
// condition keeps its `cond:*` id, its name, its enabled state, its actions and
// its place in the list — those are what the CHART owns. What moves is the
// canonical formula: after promotion the durable definition owns it, and the
// condition references it.
//
// ⛔⛔ AND IT REFUSES AN INSTANCE-BOUND CONDITION RATHER THAN CONVERTING IT.
// `a > 50` with `a = @legacy:rsi::rsi` MEANS "follow the RSI on this chart".
// Rewriting it as `rsi(close, 14) > 50` means "freeze those inputs now" — so if
// the member later moves that RSI to 28 the chart shades on one truth and the
// alert fires on another. The two sentences are different and only the member can
// choose between them, so `conditionCapability` reports LOCAL_ONLY and this module
// hands back a refusal plus enough context for the Builder to open with.
//
// ⛔ ATOMIC, AND THE BOUNDARY IS NAMED. The durable definition is created FIRST
// and the chart settings are touched only after it is stored and installed. Every
// failure before that point leaves the condition byte-identical; a failure after
// it leaves an unused definition, which is inert — it draws nothing, alerts on
// nothing and costs one row — and that is strictly better than a condition
// pointing at something that does not exist.

/** The steps, named, so a failure can say which one it was. */
export const STEPS = Object.freeze(['capability', 'build', 'save', 'install', 'attach'])

/**
 * Can this condition be promoted, and if not, why?
 *
 * @returns {{ok: true, cond: object} | {ok: false, step: string, reason: string,
 *           capability: string, boundTo: string[], cond: object|null}}
 */
export function checkPromotable(settings, conditionId, ctx = {}) {
  const cond = conditionsOf(settings).find((c) => c.id === conditionId) || null
  if (!cond) {
    return {
      ok: false, step: 'capability', capability: null, boundTo: [], cond: null,
      reason: 'that condition is no longer on this chart',
    }
  }
  const cap = conditionCapability(cond, ctx)
  if (cap.capability === DURABLE) {
    // Already durable — not an error, just nothing to do.
    return { ok: false, step: 'capability', capability: DURABLE, boundTo: [], cond, reason: null }
  }
  if (cap.capability !== PROMOTABLE) {
    return {
      ok: false, step: 'capability', capability: cap.capability,
      boundTo: cap.boundTo, cond, reason: cap.reason,
    }
  }
  return { ok: true, cond }
}

/**
 * Promote a self-contained local condition to a definition-backed one.
 *
 * ⛔ THE STORE ARRIVES AS AN ARGUMENT, exactly as it does for `saveAsIndicator`:
 * this module must not import the user-definition store, the registry or the
 * network. It sequences and it refuses; the caller owns persistence.
 *
 * @param {object} settings  chart settings in
 * @param {string} conditionId
 * @param {{buildDocument: Function, validate: Function, save: Function,
 *          install: Function, hasDefinition?: Function}} store
 * @returns {Promise<{ok: true, settings: object, definitionId: string}
 *   | {ok: false, step: string, reason: string, capability?: string,
 *      boundTo?: string[], settings: object, orphanDefinitionId?: string}>}
 *   ⚠️ ON EVERY FAILURE `settings` IS THE OBJECT THAT CAME IN — identity, not a
 *   copy, so `next !== settings` remains the whole of a caller's error handling.
 */
export async function promoteCondition(settings, conditionId, store) {
  const gate = checkPromotable(settings, conditionId, store || {})
  if (!gate.ok) {
    return {
      ok: false, step: gate.step, reason: gate.reason || 'this condition cannot be promoted',
      capability: gate.capability, boundTo: gate.boundTo, settings,
    }
  }
  const cond = gate.cond

  let doc
  try {
    // ⭐ THE DOCUMENT IS BUILT FROM THE CONDITION'S OWN SOURCE — not re-authored,
    // not re-parsed here. The caller's `buildDocument` runs the same
    // `buildDefinition` the Builder runs, so a promoted condition and a formula
    // typed into the sheet produce the same shape and the same `astHash`.
    doc = store.buildDocument({ source: cond.formula, name: cond.name })
  } catch (err) {
    return { ok: false, step: 'build', reason: msg(err), settings }
  }
  if (!doc) return { ok: false, step: 'build', reason: 'the formula could not be prepared', settings }

  const { defs, errors } = store.validate([doc])
  if (errors.length || defs.length !== 1) {
    return {
      ok: false, step: 'build',
      reason: errors.join('\n') || 'the registry refused this formula',
      settings,
    }
  }

  let res
  try {
    res = await store.save(doc)
  } catch (err) {
    return { ok: false, step: 'save', reason: msg(err), settings }
  }
  if (!res || res.ok === false) {
    return { ok: false, step: 'save', reason: (res && res.error) || 'the formula could not be saved', settings }
  }
  // ⛔ THE STORE MINTS THE ID. Referencing the draft id would point the condition
  // at something no store holds — the same defect an instance naming a draft id had.
  const stored = res.row || doc
  const definitionId = stored.def_id || stored.id
  if (!definitionId) {
    return { ok: false, step: 'save', reason: 'the saved formula came back without an id', settings }
  }

  const installed = store.install(stored.definition || stored)
  if (installed && installed.ok === false) {
    // ⚠️ THE DEFINITION EXISTS AND THE CHART CANNOT DRAW IT. Attaching would leave
    // a condition that renders nothing with no explanation, so the condition is
    // left exactly as it was and the orphan is NAMED rather than hidden.
    return {
      ok: false, step: 'install', reason: installed.error || 'this formula cannot run on the chart',
      settings, orphanDefinitionId: definitionId,
    }
  }

  // ── the only write to chart settings, and it is the last thing that happens ──
  const list = conditionsOf(settings)
  const i = list.findIndex((c) => c.id === conditionId)
  if (i < 0) {
    return {
      ok: false, step: 'attach', reason: 'that condition is no longer on this chart',
      settings, orphanDefinitionId: definitionId,
    }
  }
  // ⛔ EVERYTHING THE CHART OWNS IS CARRIED THROUGH UNTOUCHED: the id, the name,
  // the enabled state, the actions and the POSITION. The formula is left on the
  // row as a non-authoritative compatibility copy — `normaliseConditions` reports
  // `definitionId` and nothing reads `formula` once one is present.
  list[i] = { ...list[i], definitionId }
  const next = { ...settings, conditions: list, preset: 'custom' }
  return { ok: true, settings: next, definitionId }
}

const msg = (err) => String((err && err.message) || err || 'unknown error')
