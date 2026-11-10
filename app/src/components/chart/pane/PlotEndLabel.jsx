// app/src/components/chart/pane/PlotEndLabel.jsx
//
// ─── THE LINE-END LABEL, RENDERED (UCT RS split, U2) ────────────────────────
//
// One small tag at the last finite point of a plot: `RS 96` at the right end of
// the RS line, the way MarketSurge prints the rating where the line ends. The
// model is `engine/endLabel.js`'s (stamped on the chip by `readout.js` as
// `chip.endLabel`); this component draws the text in the plot's own colour and
// knows no definition.
//
// ⭐ POSITION is the surface's: `StockChart.pinEndLabel` writes `left` / `top`
// every frame from the host series' own `priceToCoordinate` and the time scale's
// `timeToCoordinate`, so the tag rides the line through scroll and zoom, on an
// `own:` scale in the price pane and in an indicator pane alike. It is hidden
// (`data-hidden`, visibility only, so its width can still be measured) while the
// point is off the plot or the tag would not fit left of it
// (`endLabel.endLabelPlacement`).
//
// ⭐ ON THE PHONE TOO (F3, 2026-11-10). The host used to read its chips off the
// crosshair payload, and the phone shell keeps no payload off-hover
// (`alwaysShowLegend: false`), so the tag only ever showed under a finger; it is
// now hosted from `StockChart.offHoverEndTagChips` whenever the payload is
// absent. Not hidden on phones by design: it is the number at the line's end,
// like the axis' own last-value tag.
//
// ⭐ TYPE: the legend chips' family (11 px, 600, tabular numbers) on the pane
// label's panel ground, so it reads as legend furniture, not as a drawing. The ink
// is the plot's colour, set inline the way `IndicatorChip` sets a chip's.
//
// ⛔ The class name carries "legend" on purpose: the newsletter export
// (`pages/ChartRender.jsx`) hides `[class*="legend" i]`, and the pane label and
// the ranks strip beside this tag are hidden there too, so the export moves no
// pixel either way.
import React, { forwardRef } from 'react'
import styles from './PlotEndLabel.module.css'

// ⛔ No `data-instance-id` here: the tour and several rails count those nodes as
// the chips a chart draws, and a tag is not a chip.
const PlotEndLabel = forwardRef(function PlotEndLabel({ text, color, labelKey }, ref) {
  return (
    <div ref={ref} className={styles.legendEndTag} data-end-label={labelKey || ''} data-hidden=""
      style={color ? { color } : undefined} aria-hidden="true">
      {typeof text === 'string' ? text : ''}
    </div>
  )
})

export default PlotEndLabel
