/**
 * V2-2's default selection (D-052).
 *
 * ⛔⛔ WHY THIS EXISTS. V1's default is two PERCENTAGE metrics, so V2-2's panel split
 * produced exactly ONE panel on first load and the feature was invisible: a member — and
 * a reviewer reading the screenshots — would see a single chart and no stack. The split
 * was proved by rails and by nothing a person could look at. A feature whose whole point
 * is structural, defaulting to the one selection that cannot show the structure, is a
 * release nobody can evaluate.
 *
 * ⛔ V1'S DEFAULT IS UNTOUCHED. `BreadthCharts.jsx`'s `DEFAULT_SELECTED` is the shipped
 * product's first view and is not this increment's to move. This list applies ONLY when
 * V2-2 is on, so a flag-off member's first load is byte-identical — which is what
 * `flagOff.golden.html` asserts.
 *
 * ⭐ THE EXTRA METRIC IS DERIVED, NOT CHOSEN BY TASTE. "Most used" is measured as
 * "appears in the most `CHART_PRESETS`" — the firm's own record of what it reaches for,
 * rather than my opinion of what looks good.
 *
 * ⚠️ THE DERIVATION TIED, AND A TIE IS NOT A RESULT. Measured 2026-09-17 over 36 presets:
 * `new_52w_highs` (unit `count`) and `vix` (unit `vix`) BOTH appear 4 times. Taking the
 * alphabetical winner would have dressed a coin-flip as a measurement. The tiebreak is
 * stated instead, and it is a reason rather than a preference:
 *
 *     ⭐ Prefer the COUNT family, because the rest of DC-2 needs it exercised.
 *       · A-28 specifies BARS for counts — V2-3's mark work has something to draw.
 *       · The era note attaches to COUNT PANELS ("Counts depend on the measured
 *         universe…") — V2-3's headline honest-state has a surface to appear on.
 *     `vix` is a volatility level: a second family, but it exercises neither.
 *
 * ⛔ PINNED AS A LITERAL, WITH A RAIL THAT RE-DERIVES IT. A default that silently follows
 * the preset table would move the goldens whenever a preset is added — a member-visible
 * change nobody decided. The rail re-runs the derivation and fails if the pin stops being
 * a legitimate winner, so a registry change becomes a REVIEWABLE red rather than a quiet
 * drift. (Same idiom as pinning a flag's declared default rather than only its behaviour.)
 */

/** V1's default, restated here ONLY so the extra can be appended to it. */
export const V1_DEFAULT_SELECTED = ['breadth_score', 'pct_above_50sma']

/**
 * The derived addition. See the tie note above.
 * ⛔ Change this only with a decision record — `defaults.test.js` re-derives it.
 */
export const V2_DEFAULT_EXTRA = 'new_52w_highs'

/** What the V2 tab opens on when V2-2 is live. */
export const V2_DEFAULT_SELECTED = [...V1_DEFAULT_SELECTED, V2_DEFAULT_EXTRA]

/**
 * The default for a given flag state.
 *
 * ⛔ V2-2 OFF ⇒ V1's default exactly. The shell without a chart has no use for a third
 * series, and more importantly the flag-off path must not diverge by even one key.
 */
export function defaultSelectionFor({ v22 }) {
  return v22 ? V2_DEFAULT_SELECTED : V1_DEFAULT_SELECTED
}
