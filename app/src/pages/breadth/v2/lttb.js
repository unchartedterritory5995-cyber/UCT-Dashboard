/**
 * V2-3 · LTTB downsampling — DELEGATED TO ECHARTS' OWN NATIVE `sampling` OPTION.
 *
 * ⚰️ THIS FILE ORIGINALLY HAND-ROLLED A LARGEST-TRIANGLE-THREE-BUCKETS IMPLEMENTATION —
 * ~150 lines, unioning per-key selected indices into one shared set and re-slicing every
 * series by it. It was mutation-proved and passing before this correction was found, and
 * is worth recording exactly why it was thrown away rather than shipped:
 *
 *   1. `01-audit.md:305`'s actual text (checked after the fact, not before) is *"client:
 *      ECharts `sampling: 'lttb'` so a 4,700-point line draws at pixel density without
 *      dropping extremes"* — the audit named ECharts' OWN BUILT-IN series option, not a
 *      server response field and not a bespoke client algorithm. A hand-rolled
 *      implementation was solving a problem the installed library already solves.
 *   2. Verified against the ACTUALLY INSTALLED package (`node_modules/echarts@6.0.0`,
 *      `lib/processor/dataSample.js`) rather than assumed from memory: `sampling` is
 *      registered for BOTH `line` and `bar` series (`chart/line/install.js:68`,
 *      `chart/bar/install.js:56` — both needed, since A-28 draws `adv_decline`/`hvc_52w`
 *      as bars), it operates on `cartesian2d` coordinate systems generally (category axes
 *      included, not just continuous ones — the "different axis types" worry that first
 *      motivated a bespoke implementation was unfounded), and — the decisive property —
 *      it downsamples EACH SERIES' OWN INTERNAL RENDER DATA via
 *      `seriesModel.setData(data.lttbDownSample(...))`. It never touches `xAxis.data`.
 *   3. That last property is what makes the native option strictly BETTER for this
 *      chart, not merely simpler: the "one shared x-axis across every panel" invariant
 *      (W2-2, mutation-proofed in `chartOption.test.js`) needed a hand-rolled UNION of
 *      selected indices only because a hand-rolled re-slice of `dates` would otherwise
 *      shrink the shared axis differently per key. ECharts' native option never shrinks
 *      the axis at all — every category slot stays present, and each series
 *      independently decides how many of them it bothers to draw a vertex at — so the
 *      union-and-reslice machinery this file used to contain SOLVES A PROBLEM THAT DOES
 *      NOT EXIST under the native option. It also adapts to the ACTUAL rendered pixel
 *      width, device pixel ratio and current zoom level automatically (recomputed on
 *      every resize/zoom via `baseAxis.getExtent()`), which a one-shot, fixed-target
 *      client computation cannot do without re-running itself on every interaction.
 *
 * So this module now owns exactly one decision — ABOVE WHAT POINT COUNT is downsampling
 * worth turning on — and `chartOption.js` reads it, without needing (or re-implementing)
 * ECharts' internal algorithm.
 *
 * ⛔⛔ THE THRESHOLD ITSELF IS UNCHANGED, AND THE MEASUREMENT BEHIND IT STILL HOLDS. See
 * D-053: real wheel-zoom, phone viewport, 365 -> 4,530 points, first paint within 2% and
 * zoom-settle within 11% across the WHOLE range — no cliff, no trend. The trigger is
 * still the viewport's own resolution (4x the measured 380px mobile width), not a
 * render-time cliff that was never found.
 */

//: 4x the measured mobile viewport width (380px). See D-053 for the measurement.
export const THRESHOLD_POINTS = 1500

/** Should a series/panel this long ask ECharts to downsample it? */
export function shouldSample(pointCount) {
  return (pointCount ?? 0) > THRESHOLD_POINTS
}
