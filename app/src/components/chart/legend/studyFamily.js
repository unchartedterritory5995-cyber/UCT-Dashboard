// app/src/components/chart/legend/studyFamily.js
//
// ─── WHICH STUDIES SHARE A LINE IN THE LEGEND ───────────────────────────────
//
// The study stack is a column of LINES, and each line packs one FAMILY of related
// series. This module owns the one question that decides where the line breaks
// fall, and it is deliberately the only place that asks it.
//
// ⛔⛔ THE RENDERER MUST NOT NAME A DEFINITION. `enumerationSites.test.js` asserts
// that `StockChart.jsx` does not contain the string `movingAverage` at all, and it
// is right to: the whole point of the engine flip is that the chart component has
// no per-indicator knowledge left. A `defId === 'movingAverage'` test in the legend
// block was exactly the hand-written lane that rail exists to prevent — caught by
// it, on the first run, which is what it is for.
//
// ⭐⭐ SO THE DEFINITION DECLARES ITS OWN FAMILY (`meta.legendFamily`) and this
// reads it. A future indicator joins a family by saying so in the registry, where
// the rest of its identity already lives; nothing here and nothing in the renderer
// changes. A definition that declares nothing is its own family, which is the
// right default — one instance, one line.

/**
 * The moving averages' family key.
 *
 * ⚠️ TWO POPULATIONS, ONE LINE, AND THAT IS THE REASON THIS CONSTANT IS EXPORTED
 * RATHER THAN INLINED. `cs.overlays`' price averages are a positional array with
 * their own writers and their own compute; a `movingAverage` engine instance is a
 * different persistence mechanism entirely (see the definition's own note). They
 * are not merged and must not be — but to a member reading a chart they are all
 * "the moving averages", so the legend prints them on one line. Both sides key off
 * this symbol so they cannot drift apart by a typo.
 */
export const MA_FAMILY = 'ma'

/** Volume's family. It is its own idea and shares a line with nothing. */
export const VOLUME_FAMILY = 'vol'

/**
 * The family key for one engine chip.
 *
 * ⭐ THE DEFAULT IS THE INSTANCE, and that is what groups a multi-output study
 * with no extra rule: `legendChips` emits one chip per (instance, plot), so MACD's
 * line and its signal already carry the same `instanceId` and therefore land on
 * the same line. Bollinger's three bands likewise.
 *
 * ⛔ NEVER THE DEFINITION ID BY DEFAULT. Two RSIs are two studies a member added
 * separately and reads separately; collapsing them because they share a definition
 * would be the "generic bucket" the composition brief refuses. Only a definition
 * that OPTS IN with `meta.legendFamily` joins its siblings.
 *
 * @param {object} chip a `readout.legendChips` row
 * @param {object} [def] that chip's definition, or null when it cannot be resolved
 * @returns {string} the family key
 */
export function studyFamilyOf(chip, def) {
  const declared = def && def.meta && def.meta.legendFamily
  if (typeof declared === 'string' && declared) return declared
  return (chip && chip.instanceId) || ''
}
