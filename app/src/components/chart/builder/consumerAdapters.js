import { treeYieldsBool } from '../engine/ast/pine'
import { chartEvaluability } from '../engine/operandCapability'
import { addCondition, renameCondition, setConditionFormula, setConditionBinding } from '../engine/conditionControls'
import { addInfoField, setInfoField } from '../engine/infoFieldControls'

// ─── THE SEAM BETWEEN AUTHORING AND PERSISTENCE ─────────────────────────────
//
// ⭐⭐ THE SHELL AUTHORS; THE ADAPTER SAVES. `BuilderSheet` already has six doors
// onto ONE `source` string — plain English, the Library, the criteria picker,
// Pine/ThinkScript/PCF import, a screenshot, and the text box — and the codebase's
// own comments insist on that convergence: *"A MODE, NOT A SECOND BUILDER … there
// is no starter save path, no starter flag on the document."* What it did NOT have
// was more than one thing to do with the result. Every one of those doors ended at
// `buildDefinition → validateUserDefinitions → saveUserDefinition →
// installUserDefinitions → addInstance`: an INDICATOR, and nothing else.
//
// ⛔ SO THE AXIS IS NEW, AND IT IS NOT `buildMode`. `initialMode`/`buildMode`
// already mean HOW YOU AUTHOR (library · picker · pine · image · formula). What
// you are AUTHORING FOR is orthogonal, and conflating the two would make
// "switch to the Formula tab" and "make this a Condition" the same control.
//
//   AUTHORING MODE   library · picker · pine · image · formula · concierge
//   CONSUMER KIND    indicator · condition · infoValue
//
// ⛔⛔ AND THE SHELL MUST NOT IMPORT PERSISTENCE. Three consumers keep their
// existing, very different stores — an indicator is a versioned server document
// with a `rev` and bound-alert migration; a condition and an info field are keys
// in the chart-settings blob with no server round trip at all. Folding those into
// one writer would mean one set of gates for three contracts. The shell hands back
// an AUTHORED RESULT; these adapters own the writing.

/** The three consumers. `scan` is the screener and is not a chart consumer. */
export const CONSUMER_KINDS = Object.freeze(['indicator', 'condition', 'infoValue'])

export const CONSUMER_LABEL = Object.freeze({
  indicator: 'Indicator',
  condition: 'Condition',
  infoValue: 'Info value',
})

/** What each consumer does with the column, in the member's own words. */
export const CONSUMER_BLURB = Object.freeze({
  indicator: 'draws this number through time',
  condition: 'tells you when this is true',
  infoValue: 'shows the latest number in the header',
})

/**
 * Everything a consumer needs, and nothing about where it will be stored.
 *
 * ⭐ `resultType` IS DERIVED, NOT DECLARED. It is the same `treeYieldsBool` the
 * three consumers already gate on — asked once, here, so the sheet and the
 * adapters cannot disagree about what a formula answers.
 */
export function authoredResult(evaluation, bindings = {}) {
  if (!evaluation || !evaluation.ok || !evaluation.ast) return null
  let bool = false
  try { bool = !!treeYieldsBool(evaluation.ast) } catch { bool = false }
  return Object.freeze({
    source: evaluation.source,
    ast: evaluation.ast,
    readback: evaluation.readback || null,
    repaintMode: (evaluation.verdict && evaluation.verdict.mode) || null,
    bindings: { ...bindings },
    resultType: bool ? 'boolean' : 'numeric',
  })
}

/**
 * Can this authored result BE the thing the member asked for?
 *
 * ⛔⛔ TYPED INTENT, ASKED ONCE. A condition must answer true or false; an info
 * field must answer a number and is REFUSED a boolean rather than printing 1/0.
 * Same resolver, opposite verdicts — so the two rules cannot drift apart. An
 * INDICATOR takes either: a 0/1 flag is a legitimate plot, and the sheet's own
 * PLOTS copy already offers "a 0/1 flag to scan on".
 *
 * ⛔ AND EVERY CHART CONSUMER ALSO NEEDS A TREE THE CHART CAN RUN. `interpret`
 * seeds every declared screener scalar as NaN when no `scalars` are passed, and a
 * chart never passes any — so `adr_pct > 5` would validate, save, and be false on
 * every bar. The picker hides those columns; this is the gate that means a formula
 * arriving by any OTHER door (import, screenshot, typing) cannot slip past.
 *
 * @returns {{ok: true} | {ok: false, reason: string, offer?: string}}
 */
export function validateFor(consumerKind, authored) {
  if (!authored) return { ok: false, reason: 'this formula does not read back yet' }

  // ⛔⛔ THE CHART GATE IS FOR CHART CONSUMERS ONLY, and a test caught me applying
  // it to all three. An `indicator` here is a USER DEFINITION — the chart draws it
  // AND the screener scans on it, from this same sheet — so refusing a screener
  // column would break the lane those columns exist for. A CONDITION and an INFO
  // VALUE have no such second life: they are chart settings, evaluated against
  // bars, and a screener scalar in one is NaN on every bar.
  if (consumerKind === 'condition' || consumerKind === 'infoValue') {
    const runnable = chartEvaluability(authored.ast)
    if (!runnable.ok) return { ok: false, reason: runnable.reason }
  }

  if (consumerKind === 'condition' && authored.resultType !== 'boolean') {
    return {
      ok: false,
      reason: 'a condition must answer true or false — compare it to something '
        + '(for example `rsi(close, 14) > 70`)',
      // ⭐ THE USEFUL NEXT MOVE, NAMED. A numeric tree is a perfectly good info
      // value; saying so beats telling a member only what they cannot do.
      offer: 'infoValue',
    }
  }
  if (consumerKind === 'infoValue' && authored.resultType === 'boolean') {
    return {
      ok: false,
      reason: 'this answers true or false — an info field shows a number. '
        + 'Use it as a Condition instead, or compare it into a number.',
      offer: 'condition',
    }
  }
  return { ok: true }
}

// ─── THE ADAPTERS ───────────────────────────────────────────────────────────
//
// ⛔ EACH ONE GOES THROUGH THE DOOR THAT ALREADY EXISTS. `addCondition` /
// `setCondition` and `addInfoField` / `setInfoField` are the pure settings writers
// the two settings tabs already use — same validation, same refusal-returns-the-
// same-object contract, same `preset: 'custom'`. A second writer here would be a
// second set of gates to keep in step, which is the shape this phase retires.

/**
 * A CONDITION — a key in the chart-settings blob.
 *
 * @param {object} settings  chart settings in
 * @param {object} authored  from `authoredResult`
 * @param {{name?: string, editId?: string}} opts
 * @returns {object} chart settings out (the SAME object on a refusal)
 */
export function saveAsCondition(settings, authored, { name, editId = null } = {}) {
  const check = validateFor('condition', authored)
  if (!check.ok) return settings
  if (!editId) {
    return addCondition(settings, {
      name: name || 'Condition', formula: authored.source, bindings: authored.bindings,
    })
  }
  // ⛔ EDIT KEEPS THE ID. `cond:*` is what the candle colours, the markers and the
  // background primitive are keyed on; minting a new one on an edit would detach a
  // member's visual actions from the condition they belong to.
  //
  // ⛔ AND IT GOES THROUGH THE EXISTING PER-FIELD WRITERS, one at a time, rather
  // than a new whole-object patch door. Each of them already refuses its own bad
  // value and returns the SAME settings object when it does, so a refusal halfway
  // through leaves the condition exactly as it was.
  let next = setConditionFormula(settings, editId, authored.source)
  if (name) next = renameCondition(next, editId, name)
  for (const [key, ref] of Object.entries(authored.bindings || {})) {
    next = setConditionBinding(next, editId, key, ref)
  }
  return next
}

/**
 * An INFO VALUE — a key in `header.infoFormulas`, plus its place in the row.
 *
 * ⛔ THE PRESENTATION IS NOT THE SHELL'S. Label, format, decimals, suffix and
 * colour are what the number LOOKS like; none of them is an input to the maths and
 * none of them appears in the evaluator's memo key. They arrive here from the
 * consumer's own configuration step, never from the authoring doors.
 */
export function saveAsInfoField(settings, authored, opts = {}) {
  const check = validateFor('infoValue', authored)
  if (!check.ok) return settings
  const { label, format, decimals, suffix, color, editId = null } = opts
  if (editId) {
    return setInfoField(settings, editId, {
      formula: authored.source, label, format, decimals, suffix, color,
    })
  }
  return addInfoField(settings, {
    label: label || 'Value',
    formula: authored.source,
    bindings: authored.bindings,
    format, decimals, suffix, color,
  })
}

/**
 * An INDICATOR — the one consumer whose store is a SERVER document.
 *
 * ⛔⛔ IT TAKES ITS STORE AS AN ARGUMENT. The shell must not import
 * `useUserDefinitions`, `nativeRegistry` or `instanceControls`: an indicator save
 * appends a version, may bump `compute.rev`, force-migrates every bound alert and
 * installs into a live registry before an instance may name it. That is a contract
 * the authoring shell has no business knowing. Injecting it keeps the seam honest
 * and keeps this module testable without a network.
 *
 * @param {object} authored
 * @param {{buildDocument: Function, validate: Function, save: Function,
 *          install: Function, attach?: Function}} store
 */
export async function saveAsIndicator(authored, store) {
  const check = validateFor('indicator', authored)
  if (!check.ok) return { ok: false, error: check.reason }
  const doc = store.buildDocument(authored)
  const { defs, errors } = store.validate([doc])
  if (errors.length || defs.length !== 1) {
    return { ok: false, error: errors.join('\n') || 'The registry refused this definition.' }
  }
  const res = await store.save(doc)
  if (!res || res.ok === false) return { ok: false, error: (res && res.error) || 'Save failed' }
  // ⛔ THE STORE MINTS THE ID, so what is installed and what an instance may name
  // is the STORE's document, never the draft's — an instance pointing at a draft id
  // is dropped by `normalizeInstances` on the very next paint.
  const stored = res.row || doc
  const installed = store.install(stored)
  if (installed && installed.ok === false) {
    // A formula that cannot draw is REPORTED as one, never quietly added to a chart.
    return { ok: true, row: stored, attached: false, warning: installed.error }
  }
  const attached = store.attach ? store.attach(stored) : false
  return { ok: true, row: stored, attached: !!attached }
}

/** One door, so a caller never has to know which adapter it wanted. */
export const ADAPTERS = Object.freeze({
  condition: saveAsCondition,
  infoValue: saveAsInfoField,
  indicator: saveAsIndicator,
})
