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

import { resolveDisplayTarget } from './displayTarget'
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
 * The `volumePane` option `resolvePaneOrder` takes — the single question the two
 * old predicates were both trying to answer.
 */
export function volumeOwnsPane(o) {
  return resolveVolumePresentation(o) === VOLUME_AS_PANE
}
