// app/src/components/chart/legend/IndicatorChip.jsx
import UIcon from '../../ui/UIcon'
import useLongPress from '../../mobile/useLongPress'
import styles from './IndicatorChip.module.css'

/**
 * ONE legend chip, and its controls.
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
 * ⛔ ONE ELEMENT, ONE TEXT NODE — NOT A WRAPPER AROUND A `.chipText` SPAN. Task
 * 3's first draft nested one for the ellipsis, and it DOUBLE-COUNTED every chip
 * in `stockChartWiring.test.jsx`'s `querySelectorAll('span')` reads: `MACD`
 * matched the outer chip and the inner text, and the case read two MACDs where
 * the chart drew one. That invariant SURVIVES the controls added at Task 4: the
 * control strip is a span with NO TEXT AT ALL (three `UIcon` SVGs), so it cannot
 * match a text predicate and it does not change `textContent` by one character.
 * Truncation is still `.chip`'s own `overflow`/`text-overflow`.
 *
 * ─── THE THING TASK 3 LEFT FOR THIS ONE ────────────────────────────────────
 *
 * ⛔ `pointer-events: auto` ON `.chip` IS THE WHOLE FEATURE, NOT POLISH.
 * `StockChart.module.css` `.legend` is `pointer-events: none` — the box sits over
 * the chart and must not swallow the crosshair — and THAT INHERITS. Task 3 shipped
 * the `+N` button un-clickable in a browser for an hour with a GREEN `more.click()`
 * test, because jsdom implements no pointer-events hit-testing. So every gate for
 * reachability in this file is an assertion on the CSS ARTIFACT, in both
 * directions (this file re-enables; the parent still disables), never on a
 * synthetic click. See `IndicatorChip.test.jsx`.
 *
 * ⚠️ THE COST, STATED: an interactive chip DOES swallow the crosshair over its own
 * ~120 px box. That is the trade every charting product makes for a clickable
 * legend, and it is why the box is the CHIP and not the legend.
 *
 * ⛔ THE CONTROLS ARE IN THE DOM AT ALL TIMES AND REVEALED BY CSS. Rendering them
 * off `useIsTouch()` would put the desktop variant on a phone at first paint —
 * `useMediaQuery` seeds from `matchMedia` at MOUNT and only updates on a `change`
 * event, and in a fixed mobile context that event never comes. This file imports
 * no breakpoint hook at all, and the test asserts that absence from source.
 *
 * ⛔ ALL THREE HANDLERS OR NONE. A read-only mount (`showDrawingTools={false}`:
 * Model Book, a grid cell, the export route) passes none and gets the inert chip
 * Task 3 shipped — the same gate the region menu's `<label> settings…` row uses,
 * for the same reason. A chip carrying two of three controls is a worse lie than
 * one carrying none, so a partial set renders none.
 *
 * @param {object}   chip             a `readout.legendChips` row
 * @param {string}   [className]      the caller's layout class (the vertical legend's)
 * @param {Function} [onToggleHidden] (instanceId) => void
 * @param {Function} [onOpenSettings] (instanceId) => void
 * @param {Function} [onRemove]       (instanceId) => void
 * @param {Function} [onMenu]         (chip, {x, y}) => void — right-click / long-press.
 *   ⚠️ THE WHOLE ROW, NOT THE ID. One instance can own SEVERAL chips (MACD's line
 *   and its signal), so an id alone cannot say which one was right-clicked — and
 *   the menu's title, its `Hide <label>` row and the alert address it opens on
 *   are all per-PLOT. The row is already in hand here; the caller would otherwise
 *   have to look it up and pick the first, which is a guess.
 */
export default function IndicatorChip({
  chip, className, onToggleHidden, onOpenSettings, onRemove, onMenu,
}) {
  const interactive = typeof onToggleHidden === 'function'
    && typeof onOpenSettings === 'function'
    && typeof onRemove === 'function'

  // ONE binding, both inputs (`mobile/useLongPress`): a 450 ms press on touch and
  // a right-click on desktop. Called unconditionally — hooks are not conditional —
  // and `openMenu` short-circuits when the mount passed no handler.
  const openMenu = (e) => {
    if (typeof onMenu !== 'function') return
    // ⛔ BOTH, AND EACH FOR ITS OWN REASON. `preventDefault` stops the browser's
    // native context menu (`useLongPress` does not do it for us); `stopPropagation`
    // keeps the event off the wrapper, so a right-click on a chip opens the CHIP's
    // menu and not the chart's region menu as well.
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onMenu(chip, { x: e?.clientX ?? 0, y: e?.clientY ?? 0 })
  }
  const longPress = useLongPress(openMenu)

  const cls = [styles.chip, chip.hidden ? styles.chipHidden : null, className]
    .filter(Boolean).join(' ')

  // ⛔ `stopPropagation` ON EVERY CONTROL. The chip is the long-press surface; a
  // tap on the eye must not also arm the menu, and a click must not reach the
  // wrapper underneath.
  const fire = (fn) => (e) => { e.stopPropagation(); fn(chip.instanceId) }

  return (
    <span
      className={cls}
      style={{ color: chip.color }}
      data-instance-id={chip.instanceId}
      data-plot-key={chip.plotKey}
      /* The state, readable without a colour comparison — the DOM half of the
         `hidden` contract `legendChips` produces. */
      data-hidden={chip.hidden ? 'true' : 'false'}
      title={interactive ? `${chip.label} — right-click for options` : undefined}
      {...(interactive ? longPress : null)}
    >
      {chip.text}
      {interactive && (
        <span className={styles.chipControls}>
          {/* ⚠️ EVERY `aria-label` NAMES THE CHIP. "Hide" on nine chips is nine
              identical controls to a screen reader; "Hide RSI(14)" is one. */}
          <button
            type="button"
            className={styles.chipBtn}
            aria-label={`${chip.hidden ? 'Show' : 'Hide'} ${chip.label}`}
            onClick={fire(onToggleHidden)}
          ><UIcon name="eye" size={11} gold={false} /></button>
          <button
            type="button"
            className={styles.chipBtn}
            aria-label={`${chip.label} settings`}
            onClick={fire(onOpenSettings)}
          ><UIcon name="gear" size={11} gold={false} /></button>
          <button
            type="button"
            className={`${styles.chipBtn} ${styles.chipBtnDanger}`}
            aria-label={`Remove ${chip.label}`}
            onClick={fire(onRemove)}
          ><UIcon name="x" size={11} gold={false} /></button>
        </span>
      )}
    </span>
  )
}
