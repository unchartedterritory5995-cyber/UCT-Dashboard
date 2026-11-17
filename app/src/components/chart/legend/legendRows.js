// app/src/components/chart/legend/legendRows.js
//
// ─── ONE LEGEND ROW PER NAME AN INDICATOR PRINTS ────────────────────────────
//
// `readout.legendChips` answers per PLOT, and it has to: the line-end tags, the
// info values and each popover are all per plot. A legend ROW is a different
// question. A member script names every one of its plots with the script's own
// name (`BuilderSheet` gives a plot `legend: {decimals}` and no label), so a
// script with 2 drawn averages and 21 hidden fill anchors printed 22 rows that
// all read "Uncharted Clouds" (owner, 2026-11-16: "need that to just be ONE").
//
// THE RULE, for the chips of one instance that print the same name:
//   - they are ONE row, led by the first plot that is drawn (and, among those, the
//     first that computed a value: a row led by an all-blank plot would wear that
//     plot's "no value on these bars" notice while its sibling prints a number);
//   - the other drawn plots ride on that row as extra values (`more`);
//   - a plot that is hidden while a sibling is drawn gets nothing: it is the
//     author's scaffolding (a `display.none` fill anchor, a colour-rule column),
//     and its eye could only ever hide the whole indicator;
//   - when the whole indicator is hidden, one hidden row stays: the way back.
//
// Plots that print DIFFERENT names (MACD and SIG, Ichimoku's TK and KJ) are not
// touched: the name is what tells those rows apart, so they stay rows.
//
// Pure, and it never copies a chip: a row's `chip` IS the `legendChips` row, so
// every handler and key downstream addresses the same plot it always did.

/** The most values one row prints (its own plus `more`); the rest fold into `+N`. */
export const LEGEND_ROW_VALUES_MAX = 6

const NO_MORE = Object.freeze([])

/**
 * @param {object[]} chips  `readout.legendChips` rows, in stack order: the whole chart's
 *   or one pane's. A pane is chosen per INSTANCE (`chipPaneHost`), so an instance's plots
 *   are always drawn together and the two lists group the same way.
 * @returns {{chip: object, more: object[]}[]} rows, ordered by each row's first plot
 */
export function legendRows(chips) {
  const groups = []
  const byKey = new Map()
  for (const c of (Array.isArray(chips) ? chips : [])) {
    if (!c) continue
    // Nothing to group on: the row stands alone.
    if (typeof c.instanceId !== 'string' || !c.instanceId) { groups.push([c]); continue }
    const key = `${c.instanceId}\u0000${c.label}`
    const g = byKey.get(key)
    if (g) g.push(c)
    else { const made = [c]; byKey.set(key, made); groups.push(made) }
  }
  return groups.map((members) => {
    if (members.length === 1) return { chip: members[0], more: NO_MORE }
    const drawn = members.filter((m) => m.hidden !== true)
    if (!drawn.length) return { chip: members[0], more: NO_MORE }
    const lead = drawn.find((m) => m.computed !== false) || drawn[0]
    return { chip: lead, more: drawn.length > 1 ? drawn.filter((m) => m !== lead) : NO_MORE }
  })
}
