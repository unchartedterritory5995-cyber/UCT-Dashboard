// app/src/components/chart/engine/formingReason.js
//
// ⭐ G6 — WHY A SCRIPT WAITS FOR A FINISHED BAR, IN THE SERVER'S OWN TERMS. ONE authority for the words.
//
// The server admits three capabilities for finished bars only (`rollout_gate.PINE_CAPABILITY_FORMING_UNGRADED`)
// and names them per script (`historyOnly`, latched as `historyOnlyIds` in `runtimeKill.js`). Three sentences
// say why a script is held back on a forming bar: a runtime document's refusal (`runtimeKill.js::
// runtimeFormingRefusalOf`), a run colour's (`nativeRegistry.js::runtimeColourWhy`) and a run half's
// (`ast/objectLoss.js::runHalfRefusedSentence`). All three DERIVE their reason from `formingReasonOf` here;
// none restates it (found by Deepvue: a script reading another symbol was told it "reads barstate").
// ⛔ A LEAF: it imports nothing, so the near-leaf `objectLoss.js` can read it without the lane.

/** What a script does that is admitted for finished bars only, by the server's capability id. Each phrase
 *  completes "this script ...". */
export const FORMING_REASON_BY_ID = Object.freeze({
  'realtime-state': 'reads the state of the bar as it forms (barstate or the clock)',
  varip: 'keeps a `varip` value that changes within a forming bar',
  'request-other': 'reads another symbol or timeframe',
})
/** ⛔ FAIL CLOSED: an id this tab does not know, or no id at all, is still a refusal, said plainly. */
export const FORMING_REASON_UNKNOWN = 'uses a part of Pine'

/** The reason words for a latched verdict's ids: each id once, in the server's order, joined by "and". */
export function formingReasonOf(ids) {
  const said = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const phrase = Object.prototype.hasOwnProperty.call(FORMING_REASON_BY_ID, id) ? FORMING_REASON_BY_ID[id] : FORMING_REASON_UNKNOWN
    if (!said.includes(phrase)) said.push(phrase)
  }
  return said.length ? said.join(' and ') : FORMING_REASON_UNKNOWN
}
