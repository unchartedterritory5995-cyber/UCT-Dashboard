/* WHICH CARDS ARE ALIVE — the feed's whole safety argument, as a pure function.
 *
 * ⛔⛔ THE BUDGET IS THE FEATURE. The desktop grid measured 16 live cells at
 * ~900 ms to frame and +63 MB heap. A 50-symbol review feed that mounted a
 * chart per card is not a slow feature, it is a memory incident on a phone —
 * so the number of LIVE charts must be bounded by construction, not by hoping
 * the list stays short.
 *
 * ⛔ AND `useStaggeredMount` DOES NOT BOUND IT. That hook is an admission queue:
 * it limits how many mount AT ONCE and, by its own stated contract, NEVER
 * unmounts a live id. Feeding it fifty ids would admit three at a time until
 * all fifty were mounted — every budget met on the way to the incident. The
 * windowing has to happen first, here, and the queue then orders the admissions
 * INSIDE the window.
 *
 * ⭐ SO THE POLICY IS A PURE FUNCTION, deliberately separated from the
 * IntersectionObserver that feeds it. An observer needs layout, which jsdom does
 * not have, so a policy tangled with it could only ever be verified by hand on a
 * device — and "≤3 charts" is exactly the property that must be provable.
 */

/** How many cards either side of the centred one stay live. */
export const FEED_RADIUS = 1

/** The hard ceiling on live charts, whatever the radius says. */
export const FEED_MAX_LIVE = 2 * FEED_RADIUS + 1

/**
 * The ids that may hold a live chart, given which card the member is looking at.
 *
 * ⭐ CENTRED, NOT LEADING. A window of "this card and the next two" leaves the
 * card you just scrolled UP to as a placeholder, which is the direction a
 * reviewer moves when they want a second look — the one moment the feed must
 * not blink.
 *
 * ⛔ AND IT CLAMPS RATHER THAN SLIDES. At the top of the list the window is
 * [0, 1], not [0, 1, 2] borrowed forward: a member at the first card is not
 * looking at the third, and mounting it spends a third of the budget on a chart
 * nobody has scrolled to. The list ends are where a feed is cheapest; that is
 * not a reason to make them expensive.
 */
export function feedWindow(ids, centre, radius = FEED_RADIUS) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const r = Math.max(0, radius | 0)
  const i = Math.max(0, Math.min(ids.length - 1, centre | 0))
  return ids.slice(Math.max(0, i - r), Math.min(ids.length, i + r + 1))
}

/**
 * Which card is "the one being looked at", from the observer's entries.
 *
 * ⛔ MOST-VISIBLE WINS, AND TIES GO TO THE EARLIER CARD. Two half-visible cards
 * straddling the fold is the steady state of a scroll, and a rule that flipped
 * on a rounding difference would re-window — and therefore unmount and remount a
 * chart — on every frame of a slow drag. The earlier card is also the one the
 * reader's eye is leaving, which is where the context is.
 *
 * @param {Array<{index:number, ratio:number}>} seen
 * @param {number} fallback  the centre to keep when nothing is visible at all.
 */
export function centreFrom(seen, fallback = 0) {
  let best = null
  for (const s of Array.isArray(seen) ? seen : []) {
    if (!s || !Number.isFinite(s.index) || !Number.isFinite(s.ratio)) continue
    if (s.ratio <= 0) continue
    if (!best || s.ratio > best.ratio + 1e-6
      || (Math.abs(s.ratio - best.ratio) <= 1e-6 && s.index < best.index)) {
      best = s
    }
  }
  return best ? best.index : fallback
}
