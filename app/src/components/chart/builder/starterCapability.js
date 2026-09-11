// ─── WHICH STARTERS A GIVEN CONSUMER CAN ACTUALLY USE ───────────────────────
//
// ⛔⛔ A STARTER THAT SAVES CLEANLY AND CAN NEVER FIRE IS WORSE THAN NO STARTER.
// The Library is the onboarding path — a member picks one of the firm's own
// setups to learn what a formula looks like — so a starter offered in the wrong
// mode does not merely fail, it teaches the wrong thing.
//
// ⚠️ MEASURED on the 8 shipped starters: ALL EIGHT are boolean, and only ONE
// (`Oops Reversal`) is chart-evaluable. The other seven read `screener_rows`
// columns, which `interpret` seeds as NaN when no `scalars` are passed — and a
// chart never passes any. In a chart CONDITION mode they would be seven setups
// that validate, save, and never paint.
//
// ⭐ ITS INPUT IS DERIVED, NEVER TYPED. `resultType` and `chartEvaluable` are
// computed in `StarterLibrary.buildFrom` from the parsed tree, using the same
// `treeYieldsBool` the three consumers gate on and the same scalar test the
// runtime guard uses — so a starter cannot advertise a capability it lacks.

/**
 * @param {string|null} consumerKind  'indicator' | 'condition' | 'infoValue' |
 *   'scan' | null. `scan`/null is the screener, where every column is at home.
 * @param {Array} list  starter entries carrying `resultType` + `chartEvaluable`
 */
export function startersFor(consumerKind, list) {
  const all = Array.isArray(list) ? list : []
  // ⛔⛔ `indicator` IS NOT A CHART-ONLY CONSUMER, AND A TEST CAUGHT ME ASSUMING IT
  // WAS. A definition authored in this sheet is a USER DEFINITION: the chart draws
  // it, and the SCREENER scans on it — `ScreensManager` mounts the very same sheet.
  // All eight shipped starters are screener setups, so filtering them out of the
  // definition lane would empty the Library on the surface it was built for, and
  // break a shipped flow. Only the two consumers that are unambiguously chart-only
  // — a chart CONDITION and a chart INFO VALUE — get the capability filter.
  //
  // ⏳ When a definition can declare that it targets the CHART specifically, it
  // should get this filter too. Named, not built.
  if (!consumerKind || consumerKind === 'scan' || consumerKind === 'indicator') return all
  return all.filter((e) => {
    // Every chart consumer needs a tree the chart can actually evaluate.
    if (!e.chartEvaluable) return false
    if (consumerKind === 'condition') return e.resultType === 'boolean'
    if (consumerKind === 'infoValue') return e.resultType === 'numeric'
    return true
  })
}
