import { buildDefinition, draftDefId } from './BuilderSheet'
import { evaluateFormula } from './FormulaField'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from './builderInputs'
import { validateUserDefinitions, installUserDefinitions } from '../engine/nativeRegistry'
import { saveUserDefinition } from '../../../hooks/useUserDefinitions'

// ─── THE STORE `promoteCondition` IS HANDED ─────────────────────────────────
//
// ⭐⭐ FOUR FUNCTIONS, AND EVERY ONE OF THEM IS THE SHIPPED DOOR. `buildDefinition`
// is the Builder's own document writer, `validateUserDefinitions` is the registry's
// own gate, `saveUserDefinition` is the hook the sheet POSTs through and
// `installUserDefinitions` is what makes a document drawable. Nothing here is a
// second implementation of anything — this module only SEQUENCES them behind the
// shape `conditionPromotion` declares, so the promotion flow can be unit-tested
// against a double and still run the real path in the product.
//
// ⛔ A PROMOTED CONDITION IS A PLAIN SINGLE-PLOT DOCUMENT, deliberately. No
// custom plots, no levels, no price-pane placement — that is the byte-identical
// shape `buildDefinition` has written since Phase D, which 21 stored definitions
// depend on. A promotion that invented a richer document would make "the same
// formula, authored two ways" produce two different `astHash`es.
//
// ⚠️ AND THE MEMBER CAN STILL EDIT IT AFTERWARDS. What promotion creates is an
// ordinary user definition: it appears in the Library, it opens in the Builder and
// it can be plotted. That is the point of the third shape — one authored truth
// with several consumers, not a hidden object the alert lane owns.

/**
 * @param {string} source  the condition's own formula text
 * @param {string} name    the condition's own name
 * @returns a definition document, or THROWS with the reason the formula did not
 *   settle — `conditionPromotion` catches it at the `build` step, where the
 *   condition is still untouched.
 */
function buildDocument({ source, name }) {
  const evaluation = evaluateFormula(String(source || ''), BUILDER_INPUT_SCOPE)
  if (!evaluation || !evaluation.ok || !evaluation.ast) {
    throw new Error(
      (evaluation && evaluation.error)
      || 'this condition’s formula does not read back, so it cannot be saved',
    )
  }
  // ⛔ THE VERDICT IS REQUIRED, NOT DEFAULTED. `mode` is the repaint badge, and a
  // document carrying a guessed one would be gated by `validateUserDefinitions`
  // against a claim nobody measured.
  if (!evaluation.verdict) {
    throw new Error('this condition’s formula has no settled repaint verdict yet')
  }
  return buildDefinition({
    source: evaluation.source,
    ast: evaluation.ast,
    mode: evaluation.verdict.mode,
    readback: evaluation.readback,
    inputs: BUILDER_INPUTS,
    defId: draftDefId(),
    version: 1,
    name: String(name || '').trim() || 'Condition',
  })
}

/**
 * POST, then reconcile the document with what the STORE minted.
 *
 * ⛔⛔ THE SERVER OWNS THE ID, THE VERSION AND THE REV. `create_definition`
 * overwrites `definition["id"]`, so installing the draft would put a definition
 * under an id nothing stored — the exact defect an instance naming a draft id was.
 * The reconciliation is the same three fields `BuilderSheet.save` reconciles, for
 * the same reason, which is why they are listed here rather than spread wholesale.
 */
async function save(doc) {
  const res = await saveUserDefinition(doc, null)
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'the formula could not be saved' }
  const row = res.row || { def_id: doc.id, version: doc.version, rev: 1 }
  const definition = {
    ...doc,
    id: row.def_id || doc.id,
    ...(Number.isInteger(row.version) ? { version: row.version } : {}),
    compute: { ...doc.compute, ...(Number.isInteger(row.rev) ? { rev: row.rev } : {}) },
  }
  return { ok: true, row: { ...row, def_id: definition.id, definition } }
}

function install(definition) {
  const { installed, errors } = installUserDefinitions([definition])
  if (errors.length || installed.length !== 1) {
    return {
      ok: false,
      // Saved, but not drawable — said out loud, because the alternative is a
      // condition that renders nothing and explains nothing.
      error: errors.join('\n') || 'Saved, but this formula could not be added to the chart.',
    }
  }
  return { ok: true }
}

/**
 * The store, plus the registry probe `conditionCapability` reads.
 *
 * @param {object|null} registry  the engine registry — `hasDefinition` is what
 *   separates DURABLE from SOURCE_UNAVAILABLE, so it is threaded through rather
 *   than left to the default "trust it".
 */
export function promotionStore(registry = null) {
  return {
    buildDocument,
    validate: validateUserDefinitions,
    save,
    install,
    hasDefinition: registry && typeof registry.getDefinition === 'function'
      ? (id) => !!registry.getDefinition(id)
      : undefined,
  }
}

export const __testing = { buildDocument, save, install }
