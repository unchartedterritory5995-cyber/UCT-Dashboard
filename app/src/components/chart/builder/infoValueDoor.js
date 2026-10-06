// app/src/components/chart/builder/infoValueDoor.js
//
// ─── ⭐ P1 — THE BUILDER'S ONE CALL INTO THE INFO-VALUE SLICE ─────────────────
//
// VALUE intent asks for an Info Value after Save. The reference is the P1
// contract (P1-DESIGN §4): `{instanceId, plotKey, format}` — it names an
// INSTALLED output; it carries no AST, no source and no formula of its own.
//
// ⛔ THIS FILE OWNS NO STORE. The info-value slice owns the chart-settings key,
// its persistence, the gate check and the rendering. Until that slice is
// integrated, `requestInfoValue` answers `{added: false}` with the reason, and
// the sheet SAYS so — it never claims a value is showing when nothing shows it.
//
// ⚠️ INTEGRATION: replace the body of `requestInfoValue` with the info slice's
// exported "add an info value" function, `(settings, ref) → settings`. Its
// contract is exactly this file's signature; the sheet does not change.

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
 * @returns {{settings: object, added: boolean, reason?: string}}
 */
export function requestInfoValue(settings, ref) {
  if (!ref || !ref.instanceId || !ref.plotKey) {
    return { settings, added: false, reason: 'There is no installed output to show as a value.' }
  }
  return {
    settings,
    added: false,
    reason: 'Showing a value in the chart header is not available in this build yet.',
  }
}
