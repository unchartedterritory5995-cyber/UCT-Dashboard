// ─── WHICH OF A DEFINITION'S OUTPUTS IS "THE SIGNAL"? ───────────────────────
//
// ⭐⭐ ONE ANSWER, THREE CONSUMERS, AND THE COST OF TWO ANSWERS IS SILENT. A
// multi-plot definition has several columns; exactly one of them is the one a
// yes/no consumer means. The SCREENER already decided that question — it filters
// on `compute.scanPlot` — so a chart CONDITION that shaded on plot 1 while its
// ALERT fired on the scan plot would be two surfaces disagreeing about what the
// member built, with nothing to report because both are internally consistent.
//
// ⚠️ AND `Object.keys(cols)[0]` IS NOT A SUBSTITUTE. Key order is the order the
// registry happened to build the map in; it agrees with plot 1 today and is not a
// promise anything makes.

/**
 * @param {object|null} def  a user-definition document
 * @returns {string} the plot key a boolean consumer should read. `value` is the
 *   key `buildDefinition` writes for a single-tree document — the shape every
 *   promoted condition has — and callers that must not guess (an alert address)
 *   validate the result they build from it rather than trusting this fallback.
 */
export function signalPlotKey(def) {
  const compute = (def && def.compute) || {}
  if (typeof compute.scanPlot === 'string' && compute.scanPlot) return compute.scanPlot
  const plots = (def && def.plots) || []
  // ⛔ A GUIDE PLOT IS NOT A COLUMN. `levels` draws horizontal lines and produces
  // no series, so a definition carrying one first would otherwise name it.
  const first = plots.find((p) => p && p.key && p.role !== 'guide') || plots[0]
  if (first && typeof first.key === 'string' && first.key) return first.key
  return 'value'
}

/**
 * The column a boolean consumer should read out of a `computeFor` result.
 *
 * ⚠️ IT FALLS BACK TO THE FIRST KEY ONLY WHEN THE NAMED ONE IS ABSENT, and that
 * is the honest ordering: a document naming a plot the registry did not produce is
 * a document/registry mismatch, and drawing SOMETHING beats drawing nothing while
 * the caller still gets to report `null` when there is nothing at all.
 */
export function signalColumn(def, cols) {
  if (!cols) return null
  const key = signalPlotKey(def)
  if (cols[key]) return cols[key]
  const first = Object.keys(cols)[0]
  return first ? cols[first] : null
}
