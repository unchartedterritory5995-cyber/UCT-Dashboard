// app/src/components/chart/engine/paneMarginsProjection.js
//
// ─── THE BANDS FOLLOW THE INSTANCES, WITHOUT paneMargins.js KNOWING ─────────
//
// ⛔ THE CONSTRAINT THIS EXISTS TO HONOUR: **`paneMargins.js` is consumed, not
// owned.** It has its own `PANES` stacking list, its own crash fix (`1c1b84bf`:
// 1,178 illegal layouts → 0, 2,918 working layouts byte-identical), and its own
// tests, and the engine has never been allowed to extend it — `placement.js`'s
// header says adding an engine key to that list would reserve vertical space for
// something rendering nothing.
//
// But after Flip B the INSTANCE list is the authority on which indicators exist,
// and `computePaneMargins` reads `cs.indicators[key].enabled`. Rather than teach
// it a second input, this projects the instance list back into the shape it
// already reads. The module keeps its signature, its list and its tests; the
// engine still never extends it; and the projection is PROVABLE — for a
// legacy-equivalent blob `computePaneMargins(projected)` must be deep-equal to
// `computePaneMargins(cs)`, which `paneMarginsProjection.test.js` asserts for all
// 512 subsets of the nine stacked panes, on both volume settings, including the
// stacks that enter the shave loop `1c1b84bf` added.
//
// EXISTENCE, NOT VISIBILITY. A hidden instance still reserves its band, exactly
// as a declutter-hidden legacy indicator did. `engineOwnedDefIds` takes the same
// posture for authority, and for the same reason: a band that appeared and
// vanished as the user hid an indicator would re-lay-out the whole chart.
//
// ⚠️ IT RUNS INSIDE THE PAINT, so it never throws: a booby-trapped getter or a
// malformed record is skipped, not raised. A throw here is a blank chart through
// StockChart's ErrorBoundary, which is a worse answer than a missing band.

import { isInstanceTombstone } from '../chartDefaults'

/**
 * `cs`, with `indicators[<id>].enabled` rewritten from the instance list for
 * every FLIPPED id.
 *
 * Returns the SAME OBJECT when there is nothing to project (no flipped ids), so
 * the pre-Flip-B path allocates nothing per paint and `computePaneMargins`'
 * callers see the identity they always saw. ⚠️ The short-circuit is on the FLIP
 * SET and not on the instance list: "nothing is flipped" is the dark state,
 * "there are no instances" is not, and every Flip-A chart has instances.
 *
 * @param {object} cs merged chart settings
 * @param {object[]} instances the instance list the engine will draw from
 * @param {Set<string>} flippedIds `ENGINE_FLIPPED_DEF_IDS`
 * @returns {object}
 */
export function csForPaneMargins(cs, instances, flippedIds) {
  if (!flippedIds || flippedIds.size === 0) return cs
  if (!cs || typeof cs !== 'object') return cs

  const live = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (tombstone) continue
    if (typeof inst.defId !== 'string' || !inst.defId) continue
    live.add(inst.defId)
  }

  const indicators = { ...(cs.indicators || {}) }
  for (const id of flippedIds) {
    // ONE FIELD. The rest of the section is carried through — this blob is a
    // `cs`, and the next reader will not know it was built for one consumer.
    indicators[id] = { ...(indicators[id] || {}), enabled: live.has(id) }
  }
  return { ...cs, indicators }
}
