// app/src/components/chart/legend/IndicatorChip.jsx
import styles from './IndicatorChip.module.css'

/**
 * ONE legend chip.
 *
 * ⛔ IT MUST RENDER INSIDE `StockChart`'s legend container, AND THAT IS NOT A
 * LAYOUT PREFERENCE. `pages/ChartRender.jsx` injects
 * `#chart-export [class*="legend" i]{display:none !important}` into the parity
 * and newsletter-export route; the legend container's CSS-module class contains
 * "legend", so a chip inside it inherits the hide. A chip rendered as a SIBLING
 * would appear in every branded export the hand-made charts never carried, and
 * would move all 46 pixel-parity baselines at once. Asserted from the AST in
 * `engine/__tests__/parityGateBlindness.test.js` and from the DOM in
 * `engine/__tests__/legendFromDefinitions.test.jsx`.
 *
 * Presentational only: it holds no settings, reads no registry and writes
 * nothing. Every action is a prop — and Task 4's actions are not here yet, so
 * there is no control on it that writes nowhere.
 *
 * ⭐ THE SEAM TASK 4 TAKES. The chip already carries its `instanceId` (as a prop
 * AND as `data-instance-id`, so a popover can be anchored to it without a
 * lookup), is ONE element with ONE text node, and accepts `className` so the
 * caller — not this file — decides layout. Task 4 adds handlers and the
 * interactive element in one commit; nothing here has to be restructured for it.
 *
 * ⛔ ONE ELEMENT, ONE TEXT NODE — NOT A WRAPPER AROUND A `.chipText` SPAN. The
 * first draft nested one for the ellipsis, and it DOUBLE-COUNTED every chip in
 * `stockChartWiring.test.jsx`'s `querySelectorAll('span')` reads: `MACD` matched
 * the outer chip and the inner text, and the case read two MACDs where the chart
 * drew one. Truncation is `.chip`'s own `overflow`/`text-overflow` instead.
 *
 * @param {object} chip a `readout.legendChips` row
 * @param {string} [className] the caller's layout class (the vertical legend's)
 */
export default function IndicatorChip({ chip, className }) {
  const cls = [styles.chip, chip.hidden ? styles.chipHidden : null, className]
    .filter(Boolean).join(' ')
  return (
    <span
      className={cls}
      style={{ color: chip.color }}
      data-instance-id={chip.instanceId}
      data-plot-key={chip.plotKey}
      /* The state, readable without a colour comparison — the DOM half of the
         `hidden` contract `legendChips` produces. */
      data-hidden={chip.hidden ? 'true' : 'false'}
      /* ⛔ NO `title` TOOLTIP, AND THAT IS DELIBERATE. `StockChart.module.css`
         `.legend` is `pointer-events: none` (the box sits over the chart and
         must not swallow the crosshair), and that inherits — so a chip receives
         no hover and a `title` on it would NEVER open. An affordance that cannot
         fire is worse than none. Task 4 flips `pointer-events: auto` on the chip
         and adds the hover row and the tooltip together, in the commit that
         gives them somewhere to write. The `+N` button next to it already sets
         `pointer-events: auto` for exactly this reason — see its CSS comment. */
    >{chip.text}</span>
  )
}
