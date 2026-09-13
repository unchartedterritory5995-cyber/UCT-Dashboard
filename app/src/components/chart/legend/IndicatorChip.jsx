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
 * @param {Function} [onBodyTap]      (chip) => void — a plain tap/click on the chip
 *   BODY (TradingView's tap-the-legend-name → settings). Passed only by mounts
 *   that have somewhere native to send it (the phone shell's editor sheet);
 *   absent, the body stays inert exactly as Task 4 shipped it. Like `onMenu` it
 *   takes THE ROW — the tapped chip names the exact instance, which is the
 *   whole point over a first-live lookup. `useLongPress`'s click-capture
 *   swallow keeps a fired long-press from also counting as a tap.
 * @param {object}   [repaint]        `engine/repaintVerdict.plotRepaintNotice` for
 *   THIS chip's plot, or null. `{mode, label, sentence, forward}`.
 *
 *   ⭐⭐ PER PLOT, NOT PER DEFINITION, WHICH IS THE OWNER'S RULING ARRIVING IN THE
 *   DOM. `ichimoku` draws five columns and exactly one of them moves under the
 *   user; a mark keyed on the definition would brand `TK` and `KJ`, which are
 *   clean by construction, and that trades a false "safe" for a false "unsafe".
 *   The prop is a per-(instance, plot) value because a chip is.
 *
 *   ⛔ NULL IS "NO OPINION", NOT "CLEAN", AND THIS FILE NEVER RENDERS THE
 *   DIFFERENCE. Sixteen of seventeen shipped computes are hand-written and the
 *   linter cannot read a line of them, so most chips get null because nothing
 *   measured them — not because something did. A green tick here would write
 *   *"the linter agreed"* over silence, which is the sentence the whole
 *   decidability vocabulary exists to make impossible. So: a mark when there is a
 *   measured problem, and nothing at all otherwise.
 */
export default function IndicatorChip({
  chip, className, onToggleHidden, onOpenSettings, onRemove, onMenu, onBodyTap, repaint,
  // ⭐⭐ `grid` — THE VERTICAL LEGEND'S TWO-COLUMN VARIANT (owner, 2026-09-10).
  //
  // ⚰️ IN THE VERTICAL LEGEND THIS CHIP USED TO TAKE `.vlFull` — `grid-column:
  // 1 / -1` — so `RSI(14) 57.3` rendered as ONE blob spanning both tracks, at
  // `.chip`'s own `600 11px`. Two things were wrong with that and the owner
  // reported both: the number did not line up with Open / High / Low / Close and
  // the moving averages stacked above it, and the label was a different size from
  // every row it sat under. A legend whose last row is the only one out of true
  // reads as broken even when the value is right.
  //
  // ⛔ SO IT SPLITS INTO THE SAME TWO CELLS EVERY OTHER ROW EMITS, plus the
  // control gutter — not a nested grid, because `.legendVertical` is ONE grid for
  // the whole legend and that shared track is exactly what puts every value on
  // the same right edge. A wrapper would take one cell and leave the alignment
  // where it started.
  //
  // ⚠️ AND IT DROPS `.chip`'s FONT so the row inherits the legend's, which is
  // what `.legendCompact` shrinks. A row that brings its own type cannot agree
  // with its neighbours at two densities.
  grid = false,
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

  const cls = [styles.chip, chip.hidden ? styles.chipHidden : null,
    chip.computed === false ? styles.chipEmpty : null, className]
    .filter(Boolean).join(' ')

  // ⛔ `stopPropagation` ON EVERY CONTROL. The chip is the long-press surface; a
  // tap on the eye must not also arm the menu, and a click must not reach the
  // wrapper underneath.
  const fire = (fn) => (e) => { e.stopPropagation(); fn(chip.instanceId) }

  /** The VALUE, formatted the way the inline chip's own text is.
   *
   * 🔴 `chip.value` IS THE RAW COLUMN NUMBER. The inline layout never touches it —
   * it prints `chip.text`, which `readout.js` built as
   * `${label} ${value.toFixed(decimals)}` — so the grid variant's first draft put
   * `57.959877655480824` in the value column, next to prices carrying two places.
   * Caught in the browser, not by a test: every chip case asserts on `text`.
   *
   * ⛔ IT REUSES THE ROW'S OWN `decimals`, which `readout.js` resolves from
   * `plots[].legend.decimals` and defaults to 2 — never a number typed here. A
   * plot that declares four places means four. */
  const chipValueText = Number.isFinite(Number(chip.value))
    ? Number(chip.value).toFixed(Number.isInteger(chip.decimals) ? chip.decimals : 2)
    : ''

  // One sentence, both layouts — see `marks` / `controlStrip` below.
  const chipTitle = chip.computed === false
    ? `${chip.label} — no value on these bars. Its window reaches back further `
      + 'than the history loaded here; try a longer timeframe or a shorter length.'
    : (interactive ? `${chip.label} — right-click for options` : undefined)

  // ⛔ THE CONTROLS, THE REPAINT MARK AND EVERY DATA ATTRIBUTE ARE BUILT ONCE AND
  // SHARED BY BOTH LAYOUTS. Two copies of a control strip is two places for the
  // eye to stop matching the ✕, which is the drift this file's own header warns
  // about one level up.
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
  const controlStrip = interactive ? (
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
  ) : null

  if (grid) {
    // ⛔ THREE CELLS, LIKE EVERY OTHER ROW IN THAT GRID. A two-cell row would let
    // the next row's label fall into the control gutter — see
    // `StockChart.module.css` `.legendVertical`.
    //
    // ⛔ THE LABEL CELL KEEPS EVERY ATTRIBUTE THE ONE-BOX CHIP CARRIED —
    // `data-instance-id`, `data-plot-key`, `data-hidden`, `data-computed`, the
    // long-press binding and the body tap. Six files and three rails address a
    // chip by those, and splitting the layout must not split the identity.
    return (
      /* 🔴 ONE ROW BOX, NOT THREE SIBLING CELLS — the same fix `LegendRow` took,
         for the same four reported bugs. `.legend` is `pointer-events: none`, so
         the COLUMN GAPS between sibling cells were not hit targets and the
         pointer left the row every time it crossed one: the controls could not be
         clicked, and hovering a chip's VALUE armed nothing at all. `subgrid` keeps
         the label and value on the legend's own tracks — which is the alignment
         this variant exists for — while the row is one continuous hover box. */
      <span
        className={`${styles.chipGridRow} ${chip.hidden ? styles.chipHidden : ''} ${className || ''}`}
        style={{ color: chip.color }}
      >
        <span
          className={`${cls} ${styles.chipGridLabel}`}
          data-instance-id={chip.instanceId}
          data-plot-key={chip.plotKey}
          data-hidden={chip.hidden ? 'true' : 'false'}
          data-computed={chip.computed === false ? 'false' : undefined}
          title={chipTitle}
          {...(interactive ? longPress : null)}
          onClick={typeof onBodyTap === 'function'
            ? (e) => { e.stopPropagation(); onBodyTap(chip) }
            : undefined}
        >{chip.label}{marks}</span>
        {/* ⛔ THE CALLER'S CLASS IS ON THE ROW, NOT ON EACH CELL. The one it
            passes here is `.chipFolded` — `display: none` — and hiding one cell
            of three would leave the value and the gutter occupying tracks with
            nothing in front of them. A fold takes the whole row or none of it,
            which one wrapper makes structural rather than remembered. */}
        <span className={styles.chipGridVal}>{chipValueText}</span>
        <span className={styles.chipGridCtl}>{controlStrip}</span>
      </span>
    )
  }

  return (
    <span
      className={cls}
      style={{ color: chip.color }}
      data-instance-id={chip.instanceId}
      data-plot-key={chip.plotKey}
      /* The state, readable without a colour comparison — the DOM half of the
         `hidden` contract `legendChips` produces. */
      data-hidden={chip.hidden ? 'true' : 'false'}
      /* ⭐⭐ AND WHETHER IT COMPUTED ANYTHING. MEASURED: a visible indicator that
         computed NOTHING and a visible one with the cursor off the chart produced
         byte-identical chips — same label, same null value, same `hidden: false`.
         The all-NaN one draws no line and takes no pane (`pool.js` trap #4), so
         the legend said exactly what it says when you are simply not hovering, and
         the far commoner cause is the second one. A member reading the ambiguous
         chip reaches for the mouse instead of for the length.
         ⛔ ABSENT MEANS NOT ASKED. `computed` is undefined for a hidden plot,
         because `binder.js` skips a hidden instance before computing it — so this
         renders the attribute only when the question was actually put. */
      data-computed={chip.computed === false ? 'false' : undefined}
      title={chipTitle}
      {...(interactive ? longPress : null)}
      /* The body tap short-circuits like `openMenu`, and stops propagation for
         the same reason the controls do — a tap on the chip must not also reach
         the wrapper underneath. The controls' own stopPropagation keeps their
         clicks from ever arriving here. */
      onClick={typeof onBodyTap === 'function'
        ? (e) => { e.stopPropagation(); onBodyTap(chip) }
        : undefined}
    >
      {chip.text}
      {marks}
      {controlStrip}
    </span>
  )
}
