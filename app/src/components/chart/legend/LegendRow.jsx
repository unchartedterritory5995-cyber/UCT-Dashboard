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
// and the chip now open the SAME popover through the same shaped callback, wear
// the same colour rail and grade their value the same way — but they stay two
// files, because the four structural facts above are real and a single component
// carrying `if (isVolumeStrip)` would be the risk this change exists to avoid.
//
// ⚰️⚰️ THE EYE / GEAR / ✕ STRIP IS GONE. Three 11px targets with the destructive
// one beside the routine ones, on as many rows as the chart has series. One
// affordance, one popover — see `chipMenu.js` and `IndicatorChip.jsx`.
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
import UIcon from '../../ui/UIcon'
import styles from './LegendRow.module.css'

/**
 * @param {string}   rowId        stable identity (`ma:2`, `volume`, an instanceId)
 * @param {string}   label        `EMA 9`, `Vol`
 * @param {string}   [value]      already formatted; empty renders an empty value cell
 * @param {string}   [color]      the line's colour — the RAIL wears it
 * @param {boolean}  [hidden]     drawn dimmed, exactly like `.chipHidden`
 * @param {boolean}  [vertical]   subgrid row vs inline strip
 * @param {Function} [onOpen]     `(rowId, {x, y}) => void` — the ONE door. The
 *   affordance button, a click on the row body and a right-click all call it.
 *
 * ⛔ ONE HANDLER OR NONE — the same gate the three-verb strip used, reduced to the
 * one door that now exists. A read-only mount (Model Book, a grid cell, the
 * `/r/chart` export route) passes none and gets an inert row.
 */
export default function LegendRow({
  rowId, label, value, color, hidden = false, vertical = false,
  // ⭐ THE LEGEND'S OWN TEXT INK, FOR THE CONTROL ONLY (owner: "make sure the
  // buttons match the brightness of the OHLC labels").
  //
  // ⛔ IT CANNOT BE `currentColor` AND IT CANNOT BE A TOKEN. The OHLC labels take
  // `legendColor`, the colour a member picks in Chart Settings → Header, so a
  // token would match on the default theme and drift the moment anybody changed
  // it. This is the same value, from the same place, which is the only way
  // "match" stays true.
  baseColor,
  /** What the control CALLS this row, when that is not what the row is labelled.
   *
   *  ⭐ MACD IS WHY IT EXISTS. Its pane prints two rows — `MACD 2.3999` and
   *  `SIG 1.6272` — and both act on ONE instance, so the second row's control
   *  announced "SIG" for a door that manages MACD entirely. The volume strip is
   *  the other reason: its row carries no text at all. Defaults to `label`. */
  controlLabel,
  onOpen,
  /** `(hoverKey | null) => void` — Track B's plot identification. EPHEMERAL. */
  onHover,
  /** What `onHover` is called WITH, when that is not the row id.
   *
   *  ⛔ A LEGACY MOVING AVERAGE NEEDS THIS AND NOTHING ELSE DOES. Its `rowId` is
   *  `ma:<storedSlot>` — the index in `cs.overlays`, which is what the hide and
   *  remove verbs address — but the drawn series lives at
   *  `overlaySeriesRefs.current[<renderIndex>]`, and the two differ the moment a
   *  tombstone or the synthetic SMA 5 is in the list. Passing the render index as
   *  a separate key is how one row addresses two different arrays without either
   *  of them having to know about the other. Defaults to `rowId`, which is
   *  correct for a pane readout (whose row id IS the instance id). */
  hoverKey,
}) {
  const ctlName = controlLabel || label || 'this series'
  const interactive = typeof onOpen === 'function'

  // ⛔ `stopPropagation` ON EVERY DOOR, like the chip's: a click must not also
  // reach the chart wrapper underneath and open a region menu.
  const fire = (e) => {
    e.stopPropagation()
    e.preventDefault?.()
    onOpen(rowId, { x: e.clientX ?? 0, y: e.clientY ?? 0 })
  }

  // ⭐ `data-legend-ctl` ON THE CONTROL CELL — a stable, UNHASHED hook. A host
  // that wants the control revealed by a hover on ITSELF rather than on the row
  // cannot name `.flatCtl`: it is a CSS-module class in this file and the
  // generated name is not addressable from another stylesheet. The volume-pane
  // strip needs exactly that (its `LegendRow` carries no text of its own, so the
  // row has no hoverable area) and `StockChart.module.css` keys off this.
  //
  // ⛔ ALWAYS IN THE DOM, REVEALED BY CSS — never rendered off a hover flag.
  //
  // ⚰️ THE FIRST DRAFT RENDERED THESE ONLY WHILE `hovered` WAS TRUE, which is why
  // they could not be clicked: React tore them out the instant the pointer
  // crossed a column gap, mid-approach. Collapsed-but-present also keeps the
  // control in the tab order and lets `:focus-within` open it for a keyboard
  // user, which a conditionally-rendered control can never do.
  const controls = interactive ? (
    <span className={styles.controls}>
      <button
        type="button"
        className={styles.btn}
        aria-label={`${ctlName} options`}
        aria-haspopup="menu"
        title={`${ctlName} — click for options`}
        onClick={fire}
      ><UIcon name="chevronDown" size={11} gold={false} /></button>
    </span>
  ) : null

  const tone = hidden ? styles.rowHidden : ''
  const rail = color
    ? <i className={styles.rail} style={{ backgroundColor: color }} aria-hidden="true" />
    : null
  const hoverProps = typeof onHover === 'function' ? {
    onMouseEnter: () => onHover(hoverKey === undefined ? rowId : hoverKey),
    onMouseLeave: () => onHover(null),
  } : null
  const bodyProps = interactive ? {
    onClick: fire,
    onContextMenu: fire,
    title: `${ctlName} — click for options`,
  } : null

  // ─── HORIZONTAL: one inline span, control revealed after the value ─────────
  if (!vertical) {
    return (
      <span
        className={`${styles.flat} ${tone} ${interactive ? styles.rowLive : ''}`}
        data-legend-row={rowId}
        data-hidden={hidden ? 'true' : 'false'}
        {...hoverProps}
        {...bodyProps}
      >
        {rail}{label}{value ? <strong className={styles.flatVal}>{value}</strong> : null}
        <span className={styles.flatCtl} data-legend-ctl style={{ color: baseColor }}>{controls}</span>
      </span>
    )
  }

  // ─── VERTICAL: ONE subgrid row that spans the legend's own tracks ──────────
  return (
    <span
      className={`${styles.vRow} ${tone} ${interactive ? styles.rowLive : ''}`}
      data-legend-row={rowId}
      data-hidden={hidden ? 'true' : 'false'}
      {...hoverProps}
      {...bodyProps}
    >
      <span className={styles.vLabel}>{rail}{label}</span>
      <span className={styles.vVal}>{value}</span>
      {/* ⛔ THE CELL IS EMITTED WHETHER OR NOT IT HAS A CONTROL. It is the row's
          third subgrid track, and a row that emitted two cells would leave the
          legend's control column unclaimed on that line. */}
      <span className={styles.vCtl} data-legend-ctl style={{ color: baseColor }}>{controls}</span>
    </span>
  )
}
