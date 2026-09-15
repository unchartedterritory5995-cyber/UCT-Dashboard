// app/src/components/chart/legend/LegendRow.jsx
//
// ─── ONE LEGEND ROW FOR EVERYTHING THAT IS NOT AN INLINE CHIP ───────────────
//
// It serves three surfaces that `IndicatorChip` cannot:
//
//   · the legacy moving-average overlays and the volume pane (`cs.overlays`,
//     `cs.volume`) — not engine instances, so they have no `instanceId`, no
//     per-plot repaint mark and no `chip.computed`;
//   · the VOLUME strip, whose row carries no label and no value of its own
//     because the three readings beside it are already the volume pane's;
//   · every indicator PANE's own top-left readout, which must not be an
//     `<IndicatorChip>` — `parityGateBlindness.test.js` asserts from the AST that
//     every chip is a descendant of the legend element, and a chip here would
//     fail that and print in every branded export.
//
// ⭐⭐ TRACK B UNIFIED THE INTERACTION WITHOUT MERGING THE COMPONENTS. This row
// and the chip open the SAME popover through the same shaped callback and grade
// their value the same way — but they stay two files, because the four structural
// facts above are real and a single component carrying `if (isVolumeStrip)` would
// be the risk this change exists to avoid.
//
// ⚰️ THE COLOUR RAIL IS RETIRED (owner, 2026-09-14) — see `IndicatorChip.jsx`.
// `color` is still accepted and still ignored for the TEXT; the row is neutral,
// and "which line is this?" is answered by the popover the row opens, which names
// it in words. ⚰️⚰️ NOT by the line: a +1px lift under the pointer answered it
// for a day and was retired with the chevron — pointing at a label must not
// redraw the chart.
//
// ⚰️⚰️ TWO GENERATIONS OF CONTROL LIVED HERE AND BOTH ARE RETIRED — the eye /
// gear / ✕ strip, then the single chevron that had to grow a gutter to live in.
// **THE ROW IS THE CONTROL.** Click it, right-click it, or focus it and press
// Enter. Nothing is revealed, nothing reserves space, nothing collides. See
// `IndicatorChip.jsx` for the full account.
//
// ─── THE ROW IS ONE BOX, AND THAT IS STILL THE WHOLE BUG FIX ────────────────
//
// 🔴 THE FIRST DRAFT EMITTED THREE SIBLING GRID CELLS AND TRACKED HOVER IN REACT.
// Every one of the four defects the owner reported came out of that one decision,
// because `StockChart.module.css` `.legend` is `pointer-events: none` — so the
// COLUMN GAPS between the cells are not hit targets at all, and the pointer
// "leaves the legend" every time it crosses one. The row is a real element laid
// out with `grid-template-columns: subgrid`, so the columns still line up across
// every row while the ROW ITSELF is one continuous hover box from the first
// letter of the label to the last digit of the value, gaps included. Hover is
// plain CSS `:hover` on that box; there is no hover state in React.
import styles from './LegendRow.module.css'

/**
 * @param {string}   rowId        stable identity (`ma:2`, `volume`, an instanceId)
 * @param {string}   label        `EMA 9`, `Vol`
 * @param {string}   [value]      already formatted; empty renders an empty value cell
 * @param {string}   [color]      the line's colour. ⚰️ ACCEPTED AND UNUSED: the
 *   rail that wore it is retired, and the row's text is deliberately neutral. It
 *   stays in the signature because every caller passes it and the phone tier of
 *   the CHIP still needs the same value — dropping it here would make the two
 *   components' call sites disagree for no gain.
 * @param {boolean}  [hidden]     drawn dimmed, exactly like `.chipHidden`
 * @param {boolean}  [vertical]   subgrid row vs inline strip
 * @param {Function} [onOpen]     `(rowId, {x, y}) => void` — the ONE door. A
 *   click, a right-click and Enter/Space on the focused row all call it.
 *   ⭐ THE ANCHOR IS THE ROW'S OWN RECTANGLE, not the pointer — a keyboard
 *   activation has no `clientX`, and one anchor then serves every input.
 *
 * ⛔ ONE HANDLER OR NONE — the same gate the three-verb strip used, reduced to the
 * one door that now exists. A read-only mount (Model Book, a grid cell, the
 * `/r/chart` export route) passes none and gets an inert row.
 */
export default function LegendRow({
  rowId, label, value, hidden = false, vertical = false,
  // ⚰️ `color` AND `baseColor` ARE ACCEPTED AND IGNORED.
  //
  // `color` inked the whole row, then the 2×9px rail before its name; `baseColor`
  // inked the control strip in the member's own legend colour ("make sure the
  // buttons match the brightness of the OHLC labels"). Neither has a subject: the
  // row is neutral text and there is no control. They stay in the signature
  // because six call sites pass them and removing them from all six is churn with
  // no behaviour attached — the row already inherits the legend's ink.
  // eslint-disable-next-line no-unused-vars
  color,
  // ⚰️ see above. It existed to ink the control strip
  // in the member's own legend colour ("make sure the buttons match the
  // brightness of the OHLC labels"); there is no control to ink. The prop stays in
  // the signature because six call sites pass it and removing it from them is
  // churn with no behaviour attached — the row's own text already inherits that
  // colour from the legend it sits in.
  // eslint-disable-next-line no-unused-vars
  baseColor,
  /** What the control CALLS this row, when that is not what the row is labelled.
   *
   *  ⭐ MACD IS WHY IT EXISTS. Its pane prints two rows — `MACD 2.3999` and
   *  `SIG 1.6272` — and both act on ONE instance, so the second row's control
   *  announced "SIG" for a door that manages MACD entirely. The volume strip is
   *  the other reason: its row carries no text at all. Defaults to `label`. */
  controlLabel,
  onOpen,
  // ⚰️ `onHover` AND `hoverKey` ARE GONE. They drove the hover lift — a pixel
  // added to the drawn series while the pointer was on its label — retired by the
  // owner after production use: hovering a legend must not mutate the plot.
  // `hoverKey` existed only because a legacy MA's row id (`ma:<storedSlot>`) is
  // not the index its drawn series lives at; with nothing to reach, the second
  // address is not needed either.
}) {
  const ctlName = controlLabel || label || 'this series'
  const interactive = typeof onOpen === 'function'

  // ⛔ `stopPropagation` ON EVERY DOOR, like the chip's: a click must not also
  // reach the chart wrapper underneath and open a region menu on top of ours.
  //
  // ⭐ AND THE ANCHOR IS THE ROW, NOT THE POINTER — `currentTarget` is the row on
  // every path, so a keyboard activation lands in the same place a click does.
  // `ContextPopover` clamps from there, so a row near the bottom still flips up.
  const fire = (e) => {
    e.stopPropagation()
    e.preventDefault?.()
    const el = e.currentTarget
    const r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    onOpen(rowId, r ? { x: r.left, y: r.bottom + 3 } : { x: e.clientX ?? 0, y: e.clientY ?? 0 })
  }

  /** The semantics of a menu trigger, or nothing at all.
   *
   *  ⛔ A READ-ONLY ROW IS NOT FOCUSABLE AND CARRIES NO ROLE — announcing a button
   *  that opens nothing is worse than announcing plain text, which is what an
   *  export-route or Model Book row is.
   *
   *  ⛔ AND THE `aria-label` NAMES THE ROW, not the verb. "Options" on six rows is
   *  six identical controls to a screen reader; `SIG`'s row names MACD, because
   *  `controlLabel` is what says which INSTANCE the menu will act on. */
  const trigger = interactive ? {
    role: 'button',
    tabIndex: 0,
    'aria-haspopup': 'menu',
    'aria-label': `${ctlName} options`,
    title: `${ctlName} — click for options`,
    onClick: fire,
    onContextMenu: fire,
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
      e.preventDefault()
      fire(e)
    },
  } : null

  const tone = hidden ? styles.rowHidden : ''

  // ─── HORIZONTAL: one inline span. The span IS the target ───────────────
  if (!vertical) {
    return (
      <span
        className={`${styles.flat} ${tone} ${interactive ? styles.rowLive : ''}`}
        data-legend-row={rowId}
        data-hidden={hidden ? 'true' : 'false'}
        {...trigger}
      >
        {label}{value ? <strong className={styles.flatVal}>{value}</strong> : null}
      </span>
    )
  }

  // ─── VERTICAL: ONE subgrid row that spans the legend's own tracks ──────────
  return (
    <span
      className={`${styles.vRow} ${tone} ${interactive ? styles.rowLive : ''}`}
      data-legend-row={rowId}
      data-hidden={hidden ? 'true' : 'false'}
      {...trigger}
    >
      <span className={styles.vLabel}>{label}</span>
      <span className={styles.vVal}>{value}</span>
      {/* ⛔ THE THIRD CELL IS STILL EMITTED, EMPTY. `.legendVertical` is ONE grid
          for the whole legend and fills by ORDER, so a row that emitted two cells
          would let the next row's label fall into the third track and cascade the
          whole legend out of true. It holds nothing now and measures zero. */}
      <span className={styles.vCtl} />
    </span>
  )
}
