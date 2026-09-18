// app/src/components/chart/engine/volumePresentation.js
//
// ─── HOW IS VOLUME PRESENTED? ONE ANSWER, ASKED BY EVERYONE ─────────────────
//
// ⚰️⚰️ THERE WERE TWO PREDICATES FOR ONE FACT, AND THEY COULD DISAGREE.
//
//   the renderer   `showVolume && (blankVolume || volumeSeparatePane
//                    || cs.volume.separatePane) || volOverlaySet.size > 0`
//   Chart Data     `cs.volume.separatePane === true
//                    || instances.some(i => displayTarget(i) === 'volume')`
//
// Both feed pane ORDER — the renderer through `resolvePaneOrder`'s `volumePane`
// option, Chart Data through the same option computed its own way — so a chart
// where they disagree has a map claiming a pane the renderer never allocates, or
// the reverse. Three distinct ways they diverge, all measured:
//
//   1. the renderer gates the whole answer on `showVolume`, which folds in the
//      `hideBase` prop and `isVolumeRemoved(cs)`; Chart Data gates on nothing.
//   2. the renderer reads the LEGACY `cs.volumeOverlayIndicators` definition
//      list; Chart Data reads INSTANCE display targets. Two overlay mechanisms,
//      each invisible to the other's predicate.
//   3. `blankVolume` and `volumeSeparatePane` are component PROPS. Chart Data is
//      handed settings and instances, so it could not see them even in
//      principle — which is the part that made this unfixable by copying the
//      expression from one file to the other.
//
// ⭐⭐ SO THE ANSWER TAKES ITS INPUTS EXPLICITLY. Everything the decision depends
// on is a named parameter, including the three that used to arrive as props. A
// caller that cannot supply one omits it and gets the settings-only answer,
// which is strictly better than a second expression that silently means
// something else — and the omission is visible at the call site instead of being
// buried in a re-derivation.
//
// ⛔ NO IMPORTS FROM THE RENDERER, AND NONE FROM `chartDataMap`. This is asked
// BY both of them; importing either way round would be the circular dependency
// the brief warns about.

import { resolveDisplayTarget, volumeOverlayPaneKeys } from './displayTarget'
import { isInstanceTombstone } from './instances'

/** Volume occupies a lightweight-charts pane of its own. */
export const VOLUME_AS_PANE = 'pane'
/** Volume is a band drawn inside the candles' pane. */
export const VOLUME_AS_BAND = 'band'
/** Volume is not presented at all. */
export const VOLUME_ABSENT = 'absent'

const liveInstances = (instances) => {
  const out = []
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    if (inst.hidden === true) continue
    let dead = false
    try { dead = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (dead) continue
    out.push(inst)
  }
  return out
}

/**
 * Is anything drawn INSIDE the volume pane? Either mechanism counts.
 *
 * ⚠️ BOTH LISTS, DELIBERATELY. `cs.volumeOverlayIndicators` is the legacy
 * per-definition list the renderer has always read; instance display targets are
 * how the same intent is expressed now. A chart mid-migration can have one and
 * not the other, and either one requires a real pane to draw into.
 */
export function volumeHasOverlay(cs, instances) {
  const legacy = Array.isArray(cs && cs.volumeOverlayIndicators)
    ? cs.volumeOverlayIndicators.length > 0
    : false
  if (legacy) return true
  for (const inst of liveInstances(instances)) {
    try { if (resolveDisplayTarget(inst, cs) === 'volume') return true } catch { /* unresolvable */ }
  }
  return false
}

/**
 * How volume is presented on this chart.
 *
 * @param {object}  o
 * @param {object}  o.cs                    merged chart settings
 * @param {object[]} [o.instances]          engine instances
 * @param {boolean} [o.shown]               volume is displayed at all. OMIT to
 *                                          assume it is — the settings-only
 *                                          answer. The renderer passes its
 *                                          `showVolume`, which folds in the
 *                                          `hideBase` prop.
 * @param {boolean} [o.blankVolume]         reserve an EMPTY labelled pane
 *                                          (breadth symbols). Implies a pane.
 * @param {boolean} [o.volumeSeparatePane]  the caller's own override prop.
 * @returns {'pane'|'band'|'absent'}
 */
export function resolveVolumePresentation(o) {
  const cs = (o && o.cs) || {}
  const shown = o && o.shown === false ? false : true
  if (!shown) return VOLUME_ABSENT

  // ⛔ AN OVERLAY FORCES A PANE WHATEVER THE FLAG SAYS — there is nothing for an
  // overlaid oscillator to draw into otherwise. That is the renderer's
  // long-standing rule and it is the one that must win.
  if (volumeHasOverlay(cs, o && o.instances)) return VOLUME_AS_PANE
  if (o && o.blankVolume === true) return VOLUME_AS_PANE
  if (o && o.volumeSeparatePane === true) return VOLUME_AS_PANE
  if (cs.volume && cs.volume.separatePane === true) return VOLUME_AS_PANE
  return VOLUME_AS_BAND
}

/**
 * Are the NATIVE VOLUME BARS drawn in a pane of their own?
 *
 * ⚰️ IT WAS CALLED `volumeOwnsPane`, AND THE NAME WAS THE BUG. Volume bars do
 * not OWN the volume pane; they are one possible RESIDENT of it. Seventeen of
 * the twenty-three consumers of the old name were asking whether the RECTANGLE
 * EXISTS — pane order, pane count, stretch shares, `firstPaneIndex`, the
 * realiser's `volumeKey`, the chip router, Chart Data's map — and got an answer
 * about the BARS. See `volumePaneRequired` below.
 *
 * ⛔ ASK THIS ONE ONLY WHERE THE BARS THEMSELVES ARE THE SUBJECT: which pane
 * index to `addSeries` them into, which price scale they take, whether they are
 * a band inside the candles instead, and where their moving average rides.
 */
export function nativeVolumeOwnsPane(o) {
  return resolveVolumePresentation(o) === VOLUME_AS_PANE
}

/**
 * The instance ids RESIDENT in the volume pane — `displayTarget`'s own answer.
 *
 * ⛔ NOT A SECOND SCAN. `volumeOverlayPaneKeys` is the set `computePaneLayout`
 * already subtracts through `excludeKeys` (a guest carves no pane of its own),
 * and it applies the hidden/tombstoned filters that list has to apply. Deriving
 * residency a second way here is how "the layout says the pane is empty" and
 * "the renderer says it has a tenant" learn to disagree.
 */
export function volumeResidentKeys(cs, instances) {
  try { return volumeOverlayPaneKeys(instances, cs || {}) } catch { return new Set() }
}

/**
 * ⭐⭐ DOES THE VOLUME PANE EXIST? The locked rule, as a predicate:
 *
 *     A DISPLAY PANE EXISTS IF IT HAS A RESIDENT PLOTTED SERIES.
 *     VOLUME BARS DO NOT OWN THE VOLUME PANE. DISPLAY RESIDENTS OWN IT.
 *
 * So the pane is there when the native bars are presented as a pane — OR when
 * anything else RESIDES in it, whatever the bars are doing.
 *
 * ⚰️⚰️ THE DEFECT THIS EXISTS TO CLOSE. `resolveVolumePresentation` opens with
 * `if (!shown) return VOLUME_ABSENT`, which short-circuits before it ever asks
 * `volumeHasOverlay`. Removing native Volume therefore told every pane-existence
 * consumer the rectangle was gone while a guest was still drawing in it —
 * measured as `{cs, instances: [MA sent to Volume], shown: false}` → `'absent'`.
 * `placement.js`'s guest branch is gated on that same answer, so the guest did
 * not merely lose its pane: it bound nothing and VANISHED FROM THE CHART.
 *
 * ⛔ SOURCE IS NOT DISPLAY. An `MA(Volume)` whose Display is *Price* reads volume
 * and resides in the candles; it holds no pane here, and must not. `displayTarget`
 * is the only thing asked, and it answers about DESTINATION.
 *
 * @param {object} o the same options `resolveVolumePresentation` takes.
 */
export function volumePaneRequired(o) {
  if (resolveVolumePresentation(o) === VOLUME_AS_PANE) return true
  return volumeResidentKeys(o && o.cs, o && o.instances).size > 0
}
