// app/src/components/chart/builder/authoring/builtInOffer.js
//
// ─── ⭐ AN ANSWER THAT OFFERS AN ACTION: "ADD IT TO THIS CHART" (2026-11-18) ───────────
//
// Some names a member asks Create Indicator for are not formulas at all: they are UCT's own
// built-in indicators (the RS Rating is a rank across every stock, computed by the server). The
// door used to treat such a name as a formula to write. Now it answers by name, with no assistant
// call, and offers the one action that is the real answer: add that built-in to this chart.
//
// THREE RULES, each held by `builtInOffer.test.js`:
//
//   1. ONLY WHAT THIS BUILD CAN ADD IS EVER OFFERED. The window tells the door which of the
//      library's built-in names its own registry offers right now (`offerableBuiltIns`: the same
//      `isDefinitionOffered` question the Indicators list asks, so a definition the live server
//      does not publish is not on the list). The door offers nothing else, and the tap asks the
//      same question again before it writes (`applyOffer`).
//   2. AN OFFER NAMES A LIBRARY BUILT-IN OR IT IS NOTHING. The answer carries an indicator id; the
//      window acts on it only when that id is one of the built-in names it shipped with
//      (`checkedLibrary.json`, `builtIns`). The words on the button are the window's own.
//   3. A RESTORED CONVERSATION OFFERS NOTHING. An offer is for the chart as it stood when the
//      answer arrived; a transcript read back from the session has none (`withoutOffer`).

import { BUILT_IN_NAMES } from './checkedLibrary'
import { addInstance } from '../../engine/instanceControls'

export const OFFER_ADD_BUILT_IN = 'add_built_in'

const rowOf = (indicator) => BUILT_IN_NAMES.find((b) => b && b.indicator === indicator) || null

/**
 * The built-in indicator ids this window can add to a chart right now, for the door.
 * @param {{registry: object, isOffered: Function, canWrite: boolean}} ctx
 */
export function offerableBuiltIns({ registry, isOffered, canWrite = true } = {}) {
  if (!canWrite || !registry || typeof registry.getDefinition !== 'function' || typeof isOffered !== 'function') return []
  return BUILT_IN_NAMES
    .map((b) => b.indicator)
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => {
      const def = registry.getDefinition(id)
      return !!def && isOffered(def) === true
    })
}

/**
 * The offer an answer carries, as the window will show it, or null. Only the indicator id is
 * read from the answer; the name and the button's words are the window's own.
 */
export function liveOffer(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== OFFER_ADD_BUILT_IN) return null
  const row = typeof raw.indicator === 'string' ? rowOf(raw.indicator) : null
  if (!row) return null
  return { kind: OFFER_ADD_BUILT_IN, indicator: row.indicator, name: row.builtInName, label: `Add ${row.builtInName} to this chart` }
}

/** A transcript entry with no offer on it (a restored conversation, a taken offer). */
export function withoutOffer(entry) {
  if (!entry || typeof entry !== 'object' || !('offer' in entry)) return entry
  const { offer: _dropped, ...rest } = entry
  return rest
}

/** Is an instance of this definition on the chart already (and not removed)? */
function onChart(settings, defId) {
  const list = settings && Array.isArray(settings.indicatorInstances) ? settings.indicatorInstances : []
  return list.some((inst) => inst && inst.defId === defId && inst.removed !== true)
}

/**
 * The tap. Asks again whether this build offers the indicator, then makes the same write the
 * Indicators list makes for a first add. Never throws; writes nothing itself.
 * @returns {{ok: true, next: object, line: string} | {ok: false, line: string}}
 */
export function applyOffer(offer, { settings, registry, isOffered } = {}) {
  const live = liveOffer(offer)
  if (!live) return { ok: false, line: 'That could not be added from here.' }
  const def = registry && typeof registry.getDefinition === 'function' ? registry.getDefinition(live.indicator) : null
  if (!def || typeof isOffered !== 'function' || isOffered(def) !== true) {
    return { ok: false, line: `${live.name} is not offered on this chart right now, so nothing was added.` }
  }
  if (!settings || typeof settings !== 'object') return { ok: false, line: 'This chart cannot be changed from here, so nothing was added.' }
  if (onChart(settings, live.indicator)) return { ok: false, line: `${live.name} is already on this chart.` }
  const next = addInstance(settings, live.indicator, registry)
  if (next === settings) return { ok: false, line: `${live.name} could not be added to this chart.` }
  return { ok: true, next: { ...next, preset: 'custom' }, line: `Added ${live.name} to this chart.` }
}
