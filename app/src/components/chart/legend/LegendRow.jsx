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
  /** A SIBLING OUTPUT of the row above — MACD's `SIG`, Bollinger's lower band.
   *
   *  ⭐⭐ LEGEND V2 §7: a multi-output indicator must not read as several
   *  unrelated studies stacked on top of each other. The grouping already exists
   *  upstream — `legendChips` walks the INSTANCE list, so an instance's plots are
   *  always consecutive — and this is the one thing the DOM was not saying about
   *  it. A secondary row indents by one step and nothing else changes: it keeps
   *  its own value, its own chevron and its own door, because the complaint that
   *  produced the all-rows rule was that clicking the second value did nothing.
   *
   *  ⛔ IT IS NOT A NESTING CONTAINER. A wrapper around each group would break
   *  the one-grid/`subgrid` alignment that puts every value on one right edge,
   *  which is the whole reason these rows are shaped the way they are. */
  secondary = false,
  /** Past the stack's row budget — the row keeps its DOM node and loses its box.
   *
   *  ⭐ FOLDED, NOT UNMOUNTED, for the reason `IndicatorChip.module.css`'s
   *  `.chipFolded` already records: the rows stay mounted so expanding is a class
   *  change rather than a remount, and nothing downstream sees the set of live
   *  rows flicker as a pane is dragged. */
  folded = false,
  /** The drawn line's colour — THE ROW WEARS IT, label and value alike.
   *
   *  ⭐⭐ RESTORED BY THE OWNER (2026-09-14, same day it went): *"every plot or
   *  label inside the legend like moving averages or any indicator showed up as
   *  the color of the plot on the chart"*. It is how a member reads a nine-line
   *  chart — the legend is the key, and a key printed in one colour names
   *  nothing. Track B took it off in favour of a 2×9px rail, then took the rail
   *  off too; what that left was neutral text with no way back to "which line is
   *  this?" except opening a menu.
   *
   *  ⚠️ THE ORIGINAL OBJECTION IS REAL AND IS ANSWERED UPSTREAM, NOT HERE: a
   *  member who picks a near-black plot colour gets a near-black label. Every
   *  caller passes `opaqueColor(...)`, which lifts a translucent line colour to
   *  full opacity against the canvas; a colour that is still unreadable is one
   *  the LINE is unreadable in too, and the fix for that belongs to the colour
   *  picker.
   *
   *  ⛔ ROWS WITH NO COLOUR STAY NEUTRAL, and that is the distinction the before
   *  picture draws: O/H/L/C and `Vol` are readings of the instrument, not of a
   *  plot somebody chose a colour for, so they keep the legend's own ink. */
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
  /** Engine-instance identity, for the callers that HAVE one (a pane readout
   *  for a UCT indicator) — absent for the callers that don't (legacy MA
   *  overlays, the volume strip). When given, mirrors `IndicatorChip`'s own
   *  `data-instance-id`/`data-plot-key`/`data-computed` triple verbatim, so a
   *  harness that already knows those three handles (this repo's own stated
   *  convention: "TESTIDS WHERE THEY EXIST... guessing at class names is how
   *  a harness silently measures the wrong element") finds a pane-placed
   *  study exactly the way it finds an overlay-placed one, with no separate
   *  selector and no plot-key guessing. Costs nothing when absent — three
   *  `undefined` attributes render as nothing. */
  instanceId,
  plotKey,
  computed,
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

  /* ⛔ THE VALUE INHERITS RATHER THAN RE-DECLARING. `.vVal`/`.flatVal` carry the
     bright legend ink so an UNCOLOURED row (OHLC, Vol) still reads as a value;
     a coloured row has to defeat that, and `inherit` does it by taking the row's
     own colour — one source of truth per row, and nothing to keep in sync if the
     token changes. */
  const ink = color ? { color } : undefined
  const valInk = color ? { color: 'inherit' } : undefined

  // ─── HORIZONTAL: one inline span. The span IS the target ───────────────
  if (!vertical) {
    return (
      <span
        className={`${styles.flat} ${tone} ${folded ? styles.rowFolded : ''} ${interactive ? styles.rowLive : ''}`}
        data-legend-row={rowId}
        data-hidden={hidden ? 'true' : 'false'}
        data-instance-id={instanceId}
        data-plot-key={plotKey}
        data-computed={computed === false ? 'false' : undefined}
        style={ink}
        {...trigger}
      >
        {/* ⭐ THE MICRO-RAIL, IN THE HORIZONTAL STRIP TOO (owner §21, 2026-09-16).
            A rail means "this readout corresponds to a plotted series", and that
            is a fact about the SERIES rather than about which layout names it —
            so the volume pane's own strip reads `▏ Vol 9.1M  ▏ SMA 50 34.6M` with
            the same rule the price stack uses.

            ⛔ EMITTED ONLY WHEN THERE IS A COLOUR, which is the exact inverse of
            the vertical variant's rule and is deliberate. Vertical is a grid and
            reserves the width so every label starts at one x; horizontal has no
            column to hold, so an unpainted rule would open a hole before every
            `O`, `H`, `L` and `C` in the flat legend. See `.railFlat`. */}
        {color ? <i className={styles.railFlat} style={{ background: color }} aria-hidden="true" /> : null}
        {label}{value ? <strong className={styles.flatVal} style={valInk}>{value}</strong> : null}
      </span>
    )
  }

  // ─── VERTICAL: ONE subgrid row that spans the legend's own tracks ──────────
  return (
    <span
      className={`${styles.vRow} ${tone} ${secondary ? styles.vRowSub : ''} ${folded ? styles.rowFolded : ''} ${interactive ? styles.rowLive : ''}`}
      data-legend-row={rowId}
      data-hidden={hidden ? 'true' : 'false'}
      data-instance-id={instanceId}
      data-plot-key={plotKey}
      data-computed={computed === false ? 'false' : undefined}
      style={ink}
      {...trigger}
    >
      {/* ⛔ THE LABEL CELL NEEDS THE SAME `inherit` THE VALUE DOES, and for the
          same reason: `.vLabel` declares its own colour, and a declaration on a
          CHILD beats a colour the parent only passes down. The horizontal variant
          needs nothing — its label is a bare text node, so it inherits. */}
      {/* ⭐⭐ THE MICRO-RAIL — 2×10px of the series' own colour, before the label.
       *
       * ⚰⚰ TWO COLOURED MARKS WERE RETIRED BEFORE THIS ONE AND IT IS NEITHER.
       * Track B's `.rail` (2×9px) REPLACED the coloured label, so nine rows read as
       * nine little coloured tabs with neutral text beside them. The composition
       * pass's 5×5 swatch was a SQUARE, which is DeepView's signature and read as a
       * bullet. This is a hairline rule that ACCOMPANIES a coloured label: the rail
       * and the label say the same thing in the same hue, so the rail reads as the
       * start of the label rather than as a mark of its own.
       *
       * ⛔ IT IS ALWAYS EMITTED, AND ONLY PAINTED WHEN THERE IS A COLOUR. A row with
       * no series colour of its own (`Vol`) keeps the indent so every label starts
       * at one x — the owner's target prints `Vol` aligned under `EMA 9`, not
       * hanging two pixels to its left. An unpainted rail is invisible and costs
       * exactly the width it reserves.
       *
       * ⛔ NOT A CONTROL. `aria-hidden`, no handler, no hover state of its own: the
       * ROW is the target and the rail is inside it, so pointing at the rail already
       * hovers the row. A screen reader has the label; "blue bar" adds nothing.
       *
       * ⛔ AND THE COLOUR COMES FROM THE SAME PLACE THE LABEL'S DOES — the caller's
       * already-resolved `opaqueColor(...)` / `chip.color`. No second colour source,
       * so the rail cannot disagree with the line it names. A hidden row dims both
       * together, because `.rowHidden` is on the ROW. */}
      <i className={styles.rail} style={color ? { background: color } : undefined} aria-hidden="true" />
      <span className={styles.vLabel} style={valInk}>{label}</span>
      {/* ⭐⭐ §3 — THE VALUE IS BRIGHT NEUTRAL, NOT THE SERIES COLOUR, and that is
          the whole colour system: COLOUR = which series, WHITE = the market value.
          ⚰ IT USED TO TAKE `valInk` (`color: inherit`) so label and value both wore
          the plot's hue; on a five-series chart that read as a rainbow and, worse,
          it made the NUMBER as easy or as hard to read as whatever colour the
          member had picked. The label keeps the hue — it is the identity — and the
          number is always the same crisp white, so the eye lands on it first at
          every hue. */}
      <span className={styles.vVal}>{value}</span>
      {/* ⛔ THE THIRD CELL IS STILL EMITTED, EMPTY. `.legendVertical` is ONE grid
          for the whole legend and fills by ORDER, so a row that emitted two cells
          would let the next row's label fall into the third track and cascade the
          whole legend out of true. It holds nothing now and measures zero. */}
      {/* ⚰⚰ THE PERMANENT CHEVRON IS RETIRED (owner). It made every study read as
          a navigation item when stacked, and it was the loudest chrome in a legend
          whose brief is to disappear behind its data. The cell is still EMITTED and
          still measures zero, because this grid fills by ORDER and a two-cell row
          would let the next row's label fall into the third track. */}
      <span className={styles.vCtl} />
    </span>
  )
}
