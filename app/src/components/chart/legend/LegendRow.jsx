// app/src/components/chart/legend/LegendRow.jsx
//
// ─── ONE LEGEND ROW FOR THE THINGS THAT ARE NOT ENGINE INSTANCES ────────────
//
// ⚰️ THE MOVING AVERAGES AND THE VOLUME PANE HAD NO CONTROLS AT ALL, and for a
// reason that stopped being true: they were not removable, so a legend row that
// offered "remove" would have written nowhere. `IndicatorChip` has carried an
// eye / gear / ✕ strip since chart-UX-walls Task 4 — but only for engine
// INSTANCES, because only an instance had `setInstanceHidden`, `removeInstance`
// and a settings dialog to point at. `chartDefaults`'s overlay TOMBSTONE gave the
// MA overlays and the volume pane the missing verb, so this row gives them the
// missing controls.
//
// ⛔ IT IS NOT `IndicatorChip` WITH AN `if`. That component's whole shape is
// built around an instance: `data-instance-id`, per-plot repaint marks,
// `chip.computed`, the `+N` fold, the phone dot, and a `stockChartWiring` rail
// that counts its spans by text. An MA row has none of those facts and needs one
// it does not have — a value that lands in the vertical legend's VALUE COLUMN.
//
// ─── THE ROW IS ONE BOX, AND THAT IS THE WHOLE BUG FIX ──────────────────────
//
// 🔴 THE FIRST DRAFT EMITTED THREE SIBLING GRID CELLS AND TRACKED HOVER IN REACT.
// Every one of the four defects the owner reported came out of that one decision,
// because `StockChart.module.css` `.legend` is `pointer-events: none` — so the
// COLUMN GAPS between the cells are not hit targets at all, and the pointer
// "leaves the legend" every time it crosses one:
//
//   · the buttons vanished before they could be clicked (crossing the 10px gap
//     between the value and the controls fired the container's leave);
//   · they flickered off and on between the label and the value (same gap);
//   · a row whose value cell forgot `pointer-events: auto` never armed at all;
//   · and `.vlHead` / `.vlChange` span `1 / -1`, so when the control track grew
//     the date and the day-change RE-CENTRED over three columns and slid right.
//
// ⭐ SO THE ROW IS A REAL ELEMENT NOW, laid out with `grid-template-columns:
// subgrid` — it spans the legend's tracks and its children map onto them, so the
// columns still line up across every row while the ROW ITSELF is one continuous
// hover box from the first letter of the label to the last digit of the value,
// gaps included. Hover is plain CSS `:hover` on that box; there is no hover state
// in React any more, and therefore nothing left that can disagree with the
// pointer.
import UIcon from '../../ui/UIcon'
import styles from './LegendRow.module.css'

/**
 * @param {string}   rowId        stable identity (`ma:2`, `volume`) — every verb takes it
 * @param {string}   label        `EMA 9`, `Vol`
 * @param {string}   [value]      already formatted; empty renders an empty value cell
 * @param {string}   [color]      the line's colour — the row wears it
 * @param {boolean}  [hidden]     drawn dimmed, exactly like `.chipHidden`
 * @param {boolean}  [vertical]   subgrid row vs inline strip
 * @param {Function} [onToggleHidden] (rowId) => void
 * @param {Function} [onOpenSettings] (rowId) => void
 * @param {Function} [onRemove]       (rowId) => void
 *
 * ⛔ ALL THREE HANDLERS OR NONE — the same gate `IndicatorChip` uses, for the
 * same reason. A read-only mount (Model Book, a grid cell, the `/r/chart` export
 * route) passes none and gets an inert row; a row carrying two of three controls
 * is a worse lie than one carrying none.
 */
export default function LegendRow({
  rowId, label, value, color, hidden = false, vertical = false,
  // ⭐ THE LEGEND'S OWN TEXT INK, FOR THE CONTROLS ONLY (owner: "make sure the
  // buttons match the brightness of the OHLC labels").
  //
  // ⛔ IT CANNOT BE `currentColor` AND IT CANNOT BE A TOKEN. The row wears the
  // LINE's colour, so `currentColor` would paint the buttons EMA-9 blue on one
  // row and SMA-200 purple on the next — a control tinted with the member's data
  // is one they can style into invisibility. And a token is not what the OHLC
  // labels use either: those take `legendColor`, the colour a member picks in
  // Chart Settings → Header, so a token would match on the default theme and
  // drift the moment anybody changed it. This is the same value, from the same
  // place, which is the only way "match" stays true.
  baseColor,
  /** What the three controls CALL this row, when that is not what the row is
   *  labelled.
   *
   *  ⭐ MACD IS WHY IT EXISTS. Its pane prints two rows — `MACD 2.3999` and
   *  `SIG 1.6272` — and both act on ONE instance, so the second row's buttons
   *  announced "Remove SIG" for a control that removes MACD entirely. A screen
   *  reader would have been told the wrong thing about a destructive action.
   *  Defaults to `label`, which is correct for every single-plot row. */
  controlLabel,
  onToggleHidden, onOpenSettings, onRemove,
}) {
  const ctlName = controlLabel || label
  const interactive = typeof onToggleHidden === 'function'
    && typeof onOpenSettings === 'function'
    && typeof onRemove === 'function'

  // ⛔ `stopPropagation` ON EVERY CONTROL, like the chip's: a click on the eye
  // must not also reach the chart wrapper underneath and open a region menu.
  const fire = (fn) => (e) => { e.stopPropagation(); fn(rowId) }

  // ⭐ `data-legend-ctl` ON BOTH CONTROL CELLS — a stable, UNHASHED hook. A host
  // that wants the controls revealed by a hover on ITSELF rather than on the row
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
  // three buttons in the tab order and lets `:focus-within` open the strip for a
  // keyboard user, which a conditionally-rendered control can never do.
  const controls = interactive ? (
    <span className={styles.controls}>
      {/* ⚠️ EVERY `aria-label` NAMES THE ROW. "Hide" on six rows is six identical
          controls to a screen reader; "Hide EMA 9" is one. */}
      <button
        type="button"
        className={styles.btn}
        aria-label={`${hidden ? 'Show' : 'Hide'} ${ctlName}`}
        title={`${hidden ? 'Show' : 'Hide'} ${ctlName}`}
        onClick={fire(onToggleHidden)}
      ><UIcon name={hidden ? 'eyeOff' : 'eye'} size={11} gold={false} /></button>
      <button
        type="button"
        className={styles.btn}
        aria-label={`${ctlName} settings`}
        title={`${ctlName} settings`}
        onClick={fire(onOpenSettings)}
      ><UIcon name="gear" size={11} gold={false} /></button>
      {/* ⚰️ REMOVE CARRIED A 10px SAFETY MARGIN, copied from
          `IndicatorChip.module.css`'s `.chipBtnDanger` and its measurement: on the
          inline chip the controls sit after a LIVE NUMBER, so one extra glyph (a
          minus sign) moved every button 5.4px and the ✕ that was Settings a moment
          ago was Remove. THAT HAZARD CANNOT HAPPEN HERE — the value is in its own
          grid column and this strip never reflows under the pointer — so the
          margin bought nothing and cost the even spacing the owner asked for. Red
          on hover is what tells the destructive control apart. */}
      <button
        type="button"
        className={`${styles.btn} ${styles.btnDanger}`}
        aria-label={`Remove ${ctlName}`}
        title={`Remove ${ctlName} from this chart`}
        onClick={fire(onRemove)}
      ><UIcon name="x" size={11} gold={false} /></button>
    </span>
  ) : null

  const tone = hidden ? styles.rowHidden : ''

  // ─── HORIZONTAL: one inline span, controls revealed after the value ────────
  //
  // The flat strip already grows to the right and carries no column alignment to
  // protect, so here the controls simply follow the number — which is also what
  // `IndicatorChip` does on this layout, so the two kinds of row behave alike.
  if (!vertical) {
    return (
      <span
        className={`${styles.flat} ${tone}`}
        style={{ color }}
        data-legend-row={rowId}
        data-hidden={hidden ? 'true' : 'false'}
      >
        {label}{value ? <strong className={styles.flatVal}>{value}</strong> : null}
        <span className={styles.flatCtl} data-legend-ctl style={{ color: baseColor }}>{controls}</span>
      </span>
    )
  }

  // ─── VERTICAL: ONE subgrid row that spans the legend's own tracks ──────────
  return (
    <span
      className={`${styles.vRow} ${tone}`}
      style={{ color }}
      data-legend-row={rowId}
      data-hidden={hidden ? 'true' : 'false'}
    >
      <span className={styles.vLabel}>{label}</span>
      <span className={styles.vVal}>{value}</span>
      {/* ⛔ THE CELL IS EMITTED WHETHER OR NOT IT HAS CONTROLS. It is the row's
          third subgrid track, and a row that emitted two cells would leave the
          legend's control column unclaimed on that line. */}
      <span className={styles.vCtl} data-legend-ctl style={{ color: baseColor }}>{controls}</span>
    </span>
  )
}
