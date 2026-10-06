// app/src/components/chart/builder/infoValueDoor.js
//
// ─── ⭐ P1 — THE BUILDER'S ONE CALL INTO THE INFO-VALUE SLICE ─────────────────
//
// VALUE intent asks for an Info Value after Save. The reference is the P1
// contract (P1-DESIGN §4): `{instanceId, plotKey, format}` — it names an
// INSTALLED output; it carries no AST, no source and no formula of its own.
//
// ⛔ THIS FILE OWNS NO STORE. The info-value slice owns the chart-settings key
// (`header.infoValues`, engine/infoValues.js), its persistence, the gate check
// and the rendering (engine/infoValueResolve.js). This door only asks it, and the
// sheet SAYS whatever it answers — it never claims a value is showing when
// nothing shows it.

import { addInfoValue, infoValueAddRefusal } from '../engine/infoValues'
import { infoValueOutputExists } from '../engine/infoValueResolve'
import { getDefinition } from '../engine/nativeRegistry'

export const INFO_VALUE_FORMAT_DEFAULT = 'auto'

/** The reference itself — the smallest thing that names an installed output. */
export function infoValueRefFor({ instanceId, plotKey, format = INFO_VALUE_FORMAT_DEFAULT }) {
  return Object.freeze({ instanceId: String(instanceId), plotKey: String(plotKey), format })
}

/** The instance `addInstance` just minted for `defId`: the one in `after`
 *  whose id was not in `before`. Never matched by name. */
export function addedInstanceId(before, after, defId) {
  const had = new Set(((before && before.indicatorInstances) || []).map((i) => i && i.instanceId))
  const added = ((after && after.indicatorInstances) || [])
    .find((i) => i && i.defId === defId && !had.has(i.instanceId))
  return added ? added.instanceId : null
}

/**
 * Ask the info-value slice to show `ref` in the chart header.
 *
 * It validates the reference against the LIVE instance and the definition's
 * declared outputs and writes nothing but the reference. Whether the output can
 * be EVALUATED on this chart is the gate's answer at read time, not here.
 *
 * @param {Function} [defOf] `(defId) => definition` — the installed registry.
 * @returns {{settings: object, added: boolean, reason?: string}}
 */
export function requestInfoValue(settings, ref, defOf = getDefinition) {
  if (!ref || !ref.instanceId || ref.instanceId === 'null' || !ref.plotKey) {
    return { settings, added: false, reason: 'There is no installed output to show as a value.' }
  }
  const refusal = infoValueAddRefusal(settings, ref, defOf, infoValueOutputExists)
  if (refusal) {
    return { settings, added: false, reason: `It could not be shown as a value: ${refusal}.` }
  }
  return { settings: addInfoValue(settings, ref, defOf, infoValueOutputExists), added: true }
}
