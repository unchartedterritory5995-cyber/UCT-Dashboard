import React from 'react'
import styles from './ReviewNavControl.module.css'

/* The transport control for a review session — prev · position · next.
 *
 * ⭐ THE STANDARD IT IS BUILT TO: this is pressed dozens of times per review, so
 * it is designed for MUSCLE MEMORY, not novelty. It should feel like the
 * transport buttons on a piece of hardware — same place, same size, same
 * meaning, every time — which is why the variants below differ only in SHAPE and
 * never in order or semantics.
 *
 * ⛔ LOWER-LEFT, AND THAT IS THE SAME ARGUMENT THE LANDSCAPE RAIL MADE. The right
 * edge carries the price scale and the newest bars — the most valuable pixels on
 * the chart, and where a floating control would sit on top of the current price.
 * The left edge is the oldest bars. A control there covers the least information
 * on screen.
 *
 * ⛔ AND IT IS NOT A SECOND SOURCE OF TRUTH. It renders `position(session)` and
 * calls back; it holds no index of its own. Two things counting "12 of 47"
 * independently is how they start disagreeing.
 *
 * ⭐ THE SHIPPED SHAPE IS `pill`, AND IT WAS MEASURED, NOT CHOSEN.
 * `tools/nav_placement_probe.py` renders all three over the REAL chart under an
 * emulated coarse pointer, portrait and landscape:
 *
 *   variant  orient      obstruct%  minTarget  reach(R)  reach(L)  axisOverlap
 *   rail     portrait         2.61         44       382       143            0
 *   pill     portrait         2.75         44       320       125            0
 *   edge     portrait         2.35         40       330       112            0
 *
 *   · `edge` is DISQUALIFIED: 40px breaks the product's own 44px minimum.
 *   · Obstruction does not discriminate — all three cost ~2.4-2.8% of the chart.
 *   · Reach does. `pill` sits 62px closer to a right thumb than `rail`, and in
 *     landscape the two are identical anyway (the rail becomes a row there).
 *   · No variant intrudes on the price axis, in either orientation.
 *
 * ⚠️ AND THE MEASUREMENT SURFACED A TENSION WORTH STATING RATHER THAN AVERAGING
 * AWAY: a right-handed one-handed grip pivots at the BOTTOM-RIGHT, so a
 * left-anchored control is at the far corner — 320px of travel on a 390px phone,
 * outside the comfortable thumb arc. That is the price of keeping the price
 * scale and the newest bars unobstructed, and it is the right trade; but it is a
 * trade, and a bottom-right option is a legitimate follow-up to A/B.
 *
 * The variants remain because the probe re-measures them after any CSS change —
 * they are three class names, not three components.
 */

/** Rendered order is fixed across variants: previous, position, next. */
export const VARIANTS = ['rail', 'pill', 'edge']

export default function ReviewNavControl({
  variant = 'pill',
  label = '',            // "12 / 47"
  sourceLabel = '',      // "Momentum Scan"
  canPrev = false,
  canNext = false,
  onPrev,
  onNext,
  onOpenList,
  dimmed = false,        // idle fade — never `display:none`, so it cannot move
  className = '',
  testId,
}) {
  const v = VARIANTS.includes(variant) ? variant : 'rail'
  return (
    <div
      className={`${styles.root} ${styles[v]} ${dimmed ? styles.dimmed : ''} ${className}`}
      data-review-nav={v}
      data-testid={testId || `review-nav-${v}`}
      role="group"
      aria-label={sourceLabel ? `Review: ${sourceLabel}` : 'Review navigation'}
    >
      <button
        type="button"
        className={styles.btn}
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="Previous symbol"
      >
        <span aria-hidden="true">{v === 'rail' ? '↑' : '‹'}</span>
      </button>

      {/* ⛔ The position is a BUTTON, not a label. It is the cheapest possible
          "take me back to the list" — the same thumb, no travel, and it is the
          only affordance that answers "where am I?" and "get me out" at once. */}
      <button
        type="button"
        className={styles.pos}
        onClick={onOpenList}
        aria-label={sourceLabel ? `${label} in ${sourceLabel} — open the list` : `${label} — open the list`}
      >
        {label}
      </button>

      <button
        type="button"
        className={styles.btn}
        onClick={onNext}
        disabled={!canNext}
        aria-label="Next symbol"
      >
        <span aria-hidden="true">{v === 'rail' ? '↓' : '›'}</span>
      </button>
    </div>
  )
}
