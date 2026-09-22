// ── THE VIEW SURVIVES A DATASET EDIT ─────────────────────────────────────────
//
// ⛔⛔ THE BUG THIS FILE EXISTS TO KILL. `updateChart` re-anchors the horizontal
// view whenever the bar COUNT changes, and it did so by preserving
// BARS-FROM-RIGHT. That is invariant under a PREPEND (older history arrives at
// the front, the newest bar does not move) and the surrounding comment says so
// outright — but the branch fires on ANY count change, and a live APPEND moves
// the newest bar. Preserving distance-from-the-right then drags the window
// FORWARD by exactly the number of appended bars. Measured: every 5m boundary
// moved a user-owned view +1 bar / +300s, accumulating into the owner's report
// that a fast-moving chart "snaps back toward the right" after they pan.
//
// ⭐ THE RULE. Remap by the TIME the member is looking at, which is invariant
// under BOTH edits. Find where the old left-edge bar's timestamp now sits and
// keep the same width. A prepend shifts that index right — the view is
// preserved, which was the branch's original purpose — and an append leaves it
// alone, so there is no drift. One rule that is correct for both, instead of a
// rule for one that silently mishandles the other.
//
// ⚠️⚠️ COUNT CHANGE DOES NOT NAME THE MUTATION. A prepend of 3 and an append of
// 3 are the same number. A replace that drops 2 from the front and adds 2 to the
// back is the same COUNT. The classifier below therefore reads BOUNDARY
// TIMESTAMPS, never lengths — and `classifyMutation` exists to be tested, not to
// drive the remap: the time anchor is correct without first knowing which case
// it is in, so classification is evidence, not control flow. If the remap ever
// starts branching on the classifier, the single-rule property is gone.
//
// ⛔⛔ OWNERSHIP SELECTS THE INVARIANT; IT DOES NOT SWITCH THE FIX OFF. Two
// different things are correct depending on who holds the camera:
//
//   owned    the member chose a time window -> PRESERVE TIME. New candles land
//            off to the right and the window does not move.
//   unowned  the chart is a live tape -> PRESERVE BARS-FROM-RIGHT, so the newest
//            candle keeps its screen position and the chart follows.
//
// ⚠️ THIS WAS MEASURED, AND AN EARLIER READING OF IT WAS WRONG. A reproducer
// run appeared to show the un-owned variant drifting exactly like the owned one,
// which argued for one time-anchored rule for both. That run shared a single
// page across variants, so `userViewMovedRef` had latched during an earlier
// drag and the "un-owned" variant was never un-owned. With per-scenario
// isolation the un-owned chart froze instead: its right pad walked 4.05 -> 3.05
// -> 2.05 -> 0.05 while the window stayed put, i.e. the newest candle was two
// boundaries from leaving the screen on a chart nobody had touched.
//
// This is NOT "skip the remap when the user owns the view". Both paths still
// remap, both still handle the prepend this branch exists for; what ownership
// decides is WHICH quantity is held constant.

/** What actually happened to the dataset, read from boundary timestamps. */
export function classifyMutation(prevBars, nextBars) {
  const a = Array.isArray(prevBars) ? prevBars : []
  const b = Array.isArray(nextBars) ? nextBars : []
  if (!a.length || !b.length) return 'unknown'
  const t = (arr, i) => arr[i]?.t
  const aFirst = t(a, 0), aLast = t(a, a.length - 1)
  const bFirst = t(b, 0), bLast = t(b, b.length - 1)
  if (aFirst == null || aLast == null || bFirst == null || bLast == null) return 'unknown'
  // A different ticker (or a replay cut) shares no bars at all.
  if (bLast < aFirst || bFirst > aLast) return 'replacement'
  const grewFront = bFirst < aFirst
  const lostFront = bFirst > aFirst
  const grewBack = bLast > aLast
  const lostBack = bLast < aLast
  if (!grewFront && !lostFront && !grewBack && !lostBack) {
    // Same span. Either nothing moved or the contents were rewritten in place
    // (a split self-heal, a sanitize pass) — either way the camera should not
    // move, and both map to "no edge moved".
    return a.length === b.length ? 'identity' : 'same-span'
  }
  if (grewFront && grewBack) return 'compound'
  if (grewFront) return 'prepend'
  // ⚠️ A CAPPED WINDOW THAT DROPS ITS OLDEST BAR WHILE APPENDING IS NOT AN
  // APPEND, and calling it one is how a camera bug hides: every index shifts
  // LEFT by the number of dropped bars, so a logical range that was correct a
  // moment ago now names different candles. The time anchor is immune, which is
  // the point — but the classifier must still say what happened, or the next
  // person reading a trace sees "append" and stops looking.
  if (lostFront && grewBack) return 'roll'
  if (grewBack) return 'append'
  // Front or back RETREATED without a compensating gain: a trimmed window or a
  // shorter refetch.
  return 'replacement'
}

/**
 * Where should the visible logical range go after a dataset edit?
 *
 * Pure. Returns the new range plus WHY it was chosen, so a harness can assert on
 * the strategy and not merely on the numbers landing somewhere plausible.
 *
 * `lastCandleFraction` is the on-screen position the newest candle is re-pinned
 * to when no valid mapping exists (0 = hard right, 0.75 = three-quarters in).
 */
export function remapVisibleRange({ prevBars, nextBars, prevRange, lastCandleFraction = 0,
                                    followRight = false }) {
  const next = Array.isArray(nextBars) ? nextBars : []
  const prev = Array.isArray(prevBars) ? prevBars : []
  const mutation = classifyMutation(prev, next)
  const pr = prevRange
  const newBarCount = next.length
  const oldBarCount = prev.length
  const lastIdx = newBarCount - 1
  const width = (pr?.to ?? 0) - (pr?.from ?? 0)

  // The old LEFT EDGE is the anchor: it is what the member's eye is parked on,
  // and unlike the right edge it is not the thing a live append moves.
  //
  // ⛔⛔ THE ANCHOR IS A BAR PLUS AN OFFSET, NEVER JUST A BAR. `pr.from` is
  // FRACTIONAL and may be NEGATIVE, and an earlier cut of this function threw
  // both away by clamping `Math.round(pr.from)` into the array. Measured
  // consequences, both real:
  //   · a member zoomed in at from=186.756 was snapped to 187 — a whole bar,
  //     +300s of visible-window drift on 5m, on every single data commit;
  //   · a member panned back past the first bar (from=-405, and -2100 on a deep
  //     pan) was slammed to 0 — a 597-bar / 4308-bar jump, which is the
  //     "it snaps back" report in its most violent form.
  // Keep the residual and re-apply it: the clamp then only chooses WHICH bar to
  // look up, and no longer decides where the member is standing.
  let anchorTime = null
  let anchorOffset = 0
  if (prev.length && pr) {
    const i = Math.max(0, Math.min(prev.length - 1, Math.round(pr.from)))
    anchorTime = prev[i]?.t ?? null
    anchorOffset = pr.from - i
  }
  let anchorIndex = null
  if (anchorTime != null) {
    // Bars are time-ordered; scan from the end because the anchor normally sits
    // close to where it already was. Stop as soon as we pass it going back.
    for (let i = next.length - 1; i >= 0; i--) {
      const ti = next[i]?.t
      if (ti === anchorTime) { anchorIndex = i; break }
      if (typeof ti === 'number' && typeof anchorTime === 'number' && ti < anchorTime) break
    }
  }

  // Fall back to the historical bars-from-right math only when the anchor bar is
  // GONE (a replace refetch that dropped it). The validity guard below still
  // catches a mapping that would land off real bars.
  const barsFromRight = oldBarCount - (pr?.to ?? 0)
  const useAnchor = anchorIndex != null && !followRight
  const from = useAnchor ? anchorIndex + anchorOffset
                         : (newBarCount - barsFromRight) - width
  const to = from + width
  const strategy = useAnchor ? 'time-anchor' : 'bars-from-right'

  // A mapping that pushes the window entirely into the empty right-pad leaves the
  // member staring at a bare price axis until "Reset view" — so require it to land
  // on REAL bars (the newest bar stays reachable: to > 0 AND from < lastIdx).
  if (width > 0 && Number.isFinite(from) && Number.isFinite(to) && to > 0 && from < lastIdx) {
    return { from, to, strategy, mutation, anchorTime, anchorIndex, anchorOffset }
  }
  if (width > 0 && lastIdx > 0) {
    const to2 = lastIdx + width * (1 - lastCandleFraction)
    return { from: to2 - width, to: to2, strategy: 'repin', mutation, anchorTime, anchorIndex, anchorOffset }
  }
  return { from: null, to: null, strategy: 'none', mutation, anchorTime, anchorIndex, anchorOffset }
}
