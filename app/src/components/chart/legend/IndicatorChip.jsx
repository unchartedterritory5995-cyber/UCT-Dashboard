// app/src/components/chart/legend/IndicatorChip.jsx
import UIcon from '../../ui/UIcon'
import useLongPress from '../../mobile/useLongPress'
import styles from './IndicatorChip.module.css'

/**
 * ONE legend chip, and its ONE control.
 *
 * ⚰️⚰️ IT CARRIED AN EYE / GEAR / ✕ STRIP, AND TRACK B RETIRED IT. Three 11px
 * targets, revealed together on hover, with the one DESTRUCTIVE verb sitting
 * 4px from the routine one — on a chart that can carry eleven series that is
 * eleven chances to remove the wrong indicator with a control that never asked.
 * The replacement is ONE affordance that opens ONE popover, and the popover is
 * the same one right-click and long-press already opened, so there is exactly
 * one vocabulary for managing a plotted series. See `chipMenu.js`.
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
 * ⛔ THE CHIP'S `textContent` IS STILL `label + ' ' + value`, TO THE BYTE.
 * `stockChartWiring.test.jsx` reads the strip by finding spans whose text
 * matches `^(MACD|SIG) ` and comparing the whole string. Track B splits the
 * VALUE into its own span so it can carry its own ink — the outer chip's text is
 * unchanged, and the inner span holds only digits, so it cannot match a
 * label-anchored predicate and cannot be double-counted. `chipsFrom` guarantees
 * the split is lossless: it builds `text` as exactly
 * `${label} ${value.toFixed(decimals)}`, and `disambiguateSiblings` rebuilds
 * BOTH fields together when it renames a sibling.
 *
 * ⛔ THE RAIL IS AN `<i>`, NOT A `<span>`, for the same span-counting reason,
 * and it is `aria-hidden` — it restates the colour a sighted reader already has
 * and says nothing to anyone else.
 *
 * ─── THE THING THAT MAKES THE BOX CLICKABLE AT ALL ──────────────────────────
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
 * ⛔ THE CONTROL IS IN THE DOM AT ALL TIMES AND REVEALED BY CSS. Rendering it
 * off `useIsTouch()` would put the desktop variant on a phone at first paint —
 * `useMediaQuery` seeds from `matchMedia` at MOUNT and only updates on a `change`
 * event, and in a fixed mobile context that event never comes. This file imports
 * no breakpoint hook at all, and the test asserts that absence from source.
 *
 * ⛔ ONE HANDLER, NOT THREE. A read-only mount (`showDrawingTools={false}`:
 * Model Book, a grid cell, the export route) passes no `onMenu` and gets an
 * inert chip with no control at all — the same gate the three-button strip used,
 * reduced to the one door that now exists.
 *
 * @param {object}   chip        a `readout.legendChips` row
 * @param {string}   [className] the caller's layout class (the vertical legend's)
 * @param {Function} [onMenu]    (chip, {x, y}) => void — the ONE door: the
 *   affordance button, a right-click, and a long-press all call it.
 *   ⚠️ THE WHOLE ROW, NOT THE ID. One instance can own SEVERAL chips (MACD's line
 *   and its signal), so an id alone cannot say which one was pointed at — and the
 *   popover's title, its `Hide <label>` row and the alert address it opens on are
 *   all per-PLOT. The row is already in hand here; the caller would otherwise
 *   have to look it up and pick the first, which is a guess.
 * @param {Function} [onHover]   (instanceId | null) => void — Track B's plot
 *   identification. EPHEMERAL: the caller lifts the drawn series and puts it back,
 *   and nothing is persisted. Desktop enhancement only; every verb stays reachable
 *   without it.
 * @param {Function} [onBodyTap] (chip) => void — a plain tap/click on the chip
 *   BODY. Passed only by the phone shell, which has its own study editor sheet,
 *   and it WINS over the popover there so that surface is unchanged.
 *   `useLongPress`'s click-capture swallow keeps a fired long-press from also
 *   counting as a tap.
 * @param {object}   [repaint]   `engine/repaintVerdict.plotRepaintNotice` for
 *   THIS chip's plot, or null. `{mode, label, sentence, forward}`.
 *
 *   ⭐⭐ PER PLOT, NOT PER DEFINITION, WHICH IS THE OWNER'S RULING ARRIVING IN THE
 *   DOM. `ichimoku` draws five columns and exactly one of them moves under the
 *   user; a mark keyed on the definition would brand `TK` and `KJ`, which are
 *   clean by construction, and that trades a false "safe" for a false "unsafe".
 *
 *   ⛔ NULL IS "NO OPINION", NOT "CLEAN", AND THIS FILE NEVER RENDERS THE
 *   DIFFERENCE. A mark when there is a measured problem, and nothing at all
 *   otherwise.
 */
export default function IndicatorChip({
  chip, className, onMenu, onHover, onBodyTap, repaint,
  // ⭐⭐ `grid` — THE VERTICAL LEGEND'S TWO-COLUMN VARIANT (owner, 2026-09-10).
  //
  // ⚰️ IN THE VERTICAL LEGEND THIS CHIP USED TO TAKE `.vlFull` — `grid-column:
  // 1 / -1` — so `RSI(14) 57.3` rendered as ONE blob spanning both tracks, at
  // `.chip`'s own `600 11px`. Two things were wrong with that and the owner
  // reported both: the number did not line up with Open / High / Low / Close and
  // the moving averages stacked above it, and the label was a different size from
  // every row it sat under.
  //
  // ⛔ SO IT SPLITS INTO THE SAME TWO CELLS EVERY OTHER ROW EMITS, plus the
  // control gutter — not a nested grid, because `.legendVertical` is ONE grid for
  // the whole legend and that shared track is exactly what puts every value on
  // the same right edge.
  grid = false,
}) {
  const interactive = typeof onMenu === 'function'

  // ONE binding, both inputs (`mobile/useLongPress`): a 450 ms press on touch and
  // a right-click on desktop. Called unconditionally — hooks are not conditional —
  // and `openMenu` short-circuits when the mount passed no handler.
  const openMenu = (e) => {
    if (typeof onMenu !== 'function') return
    // ⛔ BOTH, AND EACH FOR ITS OWN REASON. `preventDefault` stops the browser's
    // native context menu (`useLongPress` does not do it for us); `stopPropagation`
    // keeps the event off the wrapper, so a right-click on a chip opens the CHIP's
    // popover and not the chart's region menu as well.
    e?.preventDefault?.()
    e?.stopPropagation?.()
    onMenu(chip, { x: e?.clientX ?? 0, y: e?.clientY ?? 0 })
  }
  const longPress = useLongPress(openMenu)

  const cls = [styles.chip, chip.hidden ? styles.chipHidden : null,
    chip.computed === false ? styles.chipEmpty : null, className]
    .filter(Boolean).join(' ')

  /** The VALUE, formatted the way the inline chip's own text is.
   *
   * 🔴 `chip.value` IS THE RAW COLUMN NUMBER. `readout.js` built `text` as
   * `${label} ${value.toFixed(decimals)}`, so a variant that prints `chip.value`
   * raw puts `57.959877655480824` next to prices carrying two places. Caught in
   * the browser, not by a test.
   *
   * ⛔ IT REUSES THE ROW'S OWN `decimals`, which `readout.js` resolves from
   * `plots[].legend.decimals` and defaults to 2 — never a number typed here. */
  // 🔴 `Number.isFinite(chip.value)`, NEVER `Number.isFinite(Number(chip.value))`.
  // A HIDDEN chip carries `value: null` by contract (`legendChips`: *"a hidden
  // plot carries no value"*), and `Number(null)` is **0**, which is finite — so
  // the coercing form printed `RSI(14) 0.0` for a line that is not on the chart.
  // MEASURED: it was already latent in the grid variant before Track B, where the
  // hidden row simply showed `0.00` in its value cell; splitting the inline chip's
  // value out is what made the same expression reachable from the layout every
  // test reads, and turned a quiet wrong number into a red case.
  const chipValueText = (typeof chip.value === 'number' && Number.isFinite(chip.value))
    ? chip.value.toFixed(Number.isInteger(chip.decimals) ? chip.decimals : 2)
    : ''

  // One sentence, both layouts.
  const chipTitle = chip.computed === false
    ? `${chip.label} — no value on these bars. Its window reaches back further `
      + 'than the history loaded here; try a longer timeframe or a shorter length.'
    : (interactive ? `${chip.label} — click for options` : undefined)

  // ⛔ THE CONTROL, THE RAIL, THE REPAINT MARK AND EVERY DATA ATTRIBUTE ARE BUILT
  // ONCE AND SHARED BY BOTH LAYOUTS. Two copies of a control is two places for
  // the affordance to drift.
  const rail = (
    <i className={styles.chipRail} style={{ backgroundColor: chip.color }} aria-hidden="true" />
  )
  const marks = (
    <>
      {repaint && (
        <span
          className={styles.chipRepaint}
          data-repaint={repaint.mode}
          role="img"
          aria-label={`${chip.label} ${String(repaint.mode).replace(/-/g, ' ')} — ${repaint.sentence}`}
          title={`${String(repaint.mode).replace(/-/g, ' ')} — ${repaint.sentence}`}
        ><UIcon name="warning" size={11} gold={false} /></span>
      )}
    </>
  )
  // ⛔ A BUTTON WITH NO TEXT AT ALL — one `UIcon` SVG — so it cannot match a text
  // predicate and does not change `textContent` by one character.
  const controlStrip = interactive ? (
    <span className={styles.chipControls}>
      {/* ⚠️ THE `aria-label` NAMES THE CHIP. "Options" on nine chips is nine
          identical controls to a screen reader; "RSI(14) options" is one. */}
      <button
        type="button"
        className={styles.chipBtn}
        aria-label={`${chip.label} options`}
        aria-haspopup="menu"
        onClick={(e) => { e.stopPropagation(); openMenu(e) }}
      ><UIcon name="chevronDown" size={11} gold={false} /></button>
    </span>
  ) : null

  // ⭐ THE BODY OPENS THE POPOVER unless the mount brought its own tap
  // destination (the phone shell's study editor). `stopPropagation` for the same
  // reason the control does — a click on the chip must not also reach the chart
  // wrapper underneath and open a region menu.
  const onBody = typeof onBodyTap === 'function'
    ? (e) => { e.stopPropagation(); onBodyTap(chip) }
    : (interactive ? (e) => { e.stopPropagation(); openMenu(e) } : undefined)

  const hoverProps = typeof onHover === 'function' ? {
    onMouseEnter: () => onHover(chip.instanceId),
    onMouseLeave: () => onHover(null),
  } : null

  // The value, as its own ink. Absent (hidden / off-cursor / never computed) the
  // chip prints `chip.text`, which in that case IS the bare label.
  const body = chipValueText
    ? <>{chip.label}{' '}<span className={styles.chipVal}>{chipValueText}</span></>
    : chip.text

  if (grid) {
    // ⛔ THREE CELLS, LIKE EVERY OTHER ROW IN THAT GRID. A two-cell row would let
    // the next row's label fall into the control gutter — see
    // `StockChart.module.css` `.legendVertical`.
    //
    // ⛔ THE LABEL CELL KEEPS EVERY ATTRIBUTE THE ONE-BOX CHIP CARRIED —
    // `data-instance-id`, `data-plot-key`, `data-hidden`, `data-computed`, the
    // long-press binding and the body click. Six files and three rails address a
    // chip by those, and splitting the layout must not split the identity.
    return (
      /* 🔴 ONE ROW BOX, NOT THREE SIBLING CELLS. `.legend` is
         `pointer-events: none`, so the COLUMN GAPS between sibling cells were not
         hit targets and the pointer left the row every time it crossed one: the
         control could not be clicked, and hovering a chip's VALUE armed nothing.
         `subgrid` keeps the label and value on the legend's own tracks — which is
         the alignment this variant exists for — while the row is one continuous
         hover box. */
      <span
        className={`${styles.chipGridRow} ${chip.hidden ? styles.chipHidden : ''} ${className || ''}`}
        {...hoverProps}
      >
        <span
          className={`${cls} ${styles.chipGridLabel}`}
          data-instance-id={chip.instanceId}
          data-plot-key={chip.plotKey}
          data-hidden={chip.hidden ? 'true' : 'false'}
          data-computed={chip.computed === false ? 'false' : undefined}
          title={chipTitle}
          {...(interactive ? longPress : null)}
          onClick={onBody}
        >{rail}{chip.label}{marks}</span>
        {/* ⛔ THE CALLER'S CLASS IS ON THE ROW, NOT ON EACH CELL. The one it
            passes here is `.chipFolded` — `display: none` — and hiding one cell
            of three would leave the value and the gutter occupying tracks with
            nothing in front of them. */}
        <span className={styles.chipGridVal}>{chipValueText}</span>
        <span className={styles.chipGridCtl}>{controlStrip}</span>
      </span>
    )
  }

  return (
    <span
      className={cls}
      data-instance-id={chip.instanceId}
      data-plot-key={chip.plotKey}
      /* The state, readable without a colour comparison — the DOM half of the
         `hidden` contract `legendChips` produces. */
      data-hidden={chip.hidden ? 'true' : 'false'}
      /* ⭐⭐ AND WHETHER IT COMPUTED ANYTHING. MEASURED: a visible indicator that
         computed NOTHING and a visible one with the cursor off the chart produced
         byte-identical chips. ⛔ ABSENT MEANS NOT ASKED — `computed` is undefined
         for a hidden plot, because `binder.js` skips a hidden instance before
         computing it. */
      data-computed={chip.computed === false ? 'false' : undefined}
      title={chipTitle}
      {...(interactive ? longPress : null)}
      {...hoverProps}
      onClick={onBody}
    >
      {rail}
      {body}
      {marks}
      {controlStrip}
    </span>
  )
}
