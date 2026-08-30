// app/src/components/research-kit/charts/useMeasuredWidth.js
//
// ONE owner for 'how wide is this chart, really'. Both SVG charts in this kit
// (ImpliedVsRealized, ReactionBars) were written with a fixed 320-unit viewBox +
// `preserveAspectRatio="xMidYMid meet"` + a hard pixel height, which is
// HEIGHT-limited at any container wider than 320px: the scale pins at 1, so the
// chart draws 320px wide and CENTRES inside its box. Measured live in the
// earnings modal before the fix: 320 units inside a 714px canvas, ink covering
// 36% of the width, labels stuck at their literal 7-8 unit sizes.
//
// Feeding the MEASURED pixel width back as the viewBox width pins the scale at
// exactly 1, so one viewBox unit is one CSS pixel at any size.
//
// ⛔ MEASURE THE <svg>, NOT ITS WRAPPER. A consumer may size the SVG
// independently of the wrapper: EarningsHistorySection sets
// `width: calc(100% - 58px)` + 44/14 margins on `[data-testid="rk-reaction"]`
// so ReactionBars' quarter axis lands on LollipopChart's ECharts grid insets.
// Measuring the wrapper there gave 709 for an SVG rendering at 651 — a 0.918
// scale, which quietly falsifies the 1:1 claim this hook exists to make (11px
// labels rendering at 10.1px). The element whose width the viewBox describes
// is the only correct thing to measure.
//
// ⛔ Extracted rather than copied into the second chart. Two hand-written
// copies of one rule is how the fix reaches one lane and not its mirror
// (lesson_one_grammar_four_hand_written_copies); the callback-ref subtlety
// below is exactly the kind of detail a copy loses.
import { useEffect, useState } from 'react'

/**
 * The wrapper's live pixel width, or `fallback` until (and unless) it can be
 * measured. Feeding this back as the viewBox width is what pins the scale at
 * 1 — see the VIEWBOX docblock for what the fixed-320 box was doing instead.
 *
 * `ResizeObserver` is guarded exactly the way every other chart wrapper in
 * this repo guards it (e.g. pages/charts/widgets/NhnlPulseWidget.jsx:154):
 * jsdom does not implement it, so under test this returns the fallback and
 * the geometry stays byte-identical to the pre-change 320-unit box. That is
 * deliberate — it keeps `pairGeometry`'s existing unit tests meaningful
 * rather than silently re-baselining them against a measured width that no
 * test environment can produce.
 */
export default function useMeasuredWidth(fallback) {
  // ⛔ A CALLBACK REF, NOT useRef. This measured 320 forever in the real modal
  // while every test passed: on the first render the payload has not arrived,
  // `hasAnything` is false, and the component returns <EmptyState/> — so the
  // wrapper div does not exist yet. A `useEffect(..., [ref])` runs ONCE against
  // that absent node, bails on `!el`, and never runs again, because a `useRef`
  // object is referentially stable for the life of the component: the element
  // appearing later is invisible to the dependency array. A callback ref is
  // CALLED by React when the node attaches, so the measurement happens whenever
  // the chart actually mounts — including after SWR resolves.
  //
  // The unit tests could not have caught this: they render with data already
  // present, so the div is there on the first pass. `mounts empty first` below
  // is the rail for the real ordering.
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(null)
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const read = () => {
      // getBoundingClientRect, not clientWidth: this ref goes on the <svg>
      // itself (see below) and `clientWidth` is not meaningful on an SVG
      // element in every engine. Rounded so a sub-pixel layout jitter cannot
      // churn the viewBox.
      const w = Math.round(node.getBoundingClientRect().width)
      // A detached or display:none wrapper measures 0; drawing a 0-wide
      // viewBox would divide the slot by zero and collapse every bar onto
      // x=NaN. Keep the last good width (or the fallback) instead.
      if (w > 0) setWidth(w)
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])
  return [setNode, width ?? fallback]
}
