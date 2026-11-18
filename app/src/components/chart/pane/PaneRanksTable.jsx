// app/src/components/chart/pane/PaneRanksTable.jsx
//
// ─── THE PANE TABLE, RENDERED (UCT RS design round, 2026-11-08) ─────────────
//
// A compact strip in an indicator pane's top-right corner: each column code in
// the muted ink beside its 1-99 rank (`1M 52  3M 86  6M 78  12M 71 │ RS 82`). The
// model is `engine/paneTable.paneTableFor`'s (stamped on the chip by `readout.js`);
// this component draws exactly what it says and knows no definition.
//
// ⭐ ONE ROW, NOT A HEADER ROW AND A VALUE ROW (real-screen check, 2026-11-08).
// The first cut stacked the codes over the numbers like Deepvue's table: 33 px tall
// in a ~97 px pane, it sat over the RS line's NEWEST bars, which for a leader are
// exactly the top-right corner. One 18 px row lives in the band the pane label
// already occupies (the scale keeps the line out of the pane's top margin), so the
// newest bars stay in view. The pairs are a description list: code, then value.
//
// ⭐ BRAND: neutral ink, tabular numbers, 11 px, no gold (gold is the one
// look-here mark and it belongs to the before-price dot). A value takes the site's
// rating-band ink only when the model carries a `band` (the member's Rating
// colours switch). A missing rank is an en dash in the muted ink.
//
// ⭐ POSITION is the surface's: `StockChart.pinPaneLegend` pins the strip to its
// pane's top, left of the price scale, and steps it aside (`data-collapsed`) when
// it would touch the pane label — measured every frame, so a 390 px phone and a
// narrow Multi-Chart cell both fall back to the readout's Rating card.
//
// ⛔ The class names carry "legend" on purpose: the newsletter export
// (`pages/ChartRender.jsx`) hides `[class*="legend" i]`, and the pane label beside
// this strip is hidden there too, so the export moves no pixel either way.
import React, { forwardRef } from 'react'
import styles from './PaneRanksTable.module.css'

const BAND_CLASS = Object.freeze({
  lead: 'legendRankLead', strong: 'legendRankStrong', neutral: 'legendRankNeutral', lag: 'legendRankLag',
})

// ⭐ `canvas` ('light' | 'dark'): the canvas behind the strip, which StockChart
// samples at the pane-label height. The inks follow the canvas the way the pane
// label's do (`--legend-ink-*-low`, held >= 4.5:1 by `legendInk.js`), and the band
// inks take the light theme's darker gain / warn / loss on a light canvas (real-
// screen check, 2026-11-08: the dark-theme green and amber read ~2:1 on white).
// ⭐ `host` ('pane' | 'price', UCT RS split U2): on the PRICE pane the strip sits at
// the top of the canvas beside the price legend, so it takes the legend's own
// top-sample inks and panel ground (`data-host="price"` in the stylesheet); in a
// pane it keeps the low sample. Same markup either way.
const PaneRanksTable = forwardRef(function PaneRanksTable({ table, paneKey, canvas = 'dark', host = 'pane' }, ref) {
  if (!table || !Array.isArray(table.columns) || !table.columns.length) return null
  return (
    <div ref={ref} className={styles.legendRanksTable} data-pane-table={paneKey || ''}
      data-host={host === 'price' ? 'price' : 'pane'}
      data-canvas={canvas === 'light' ? 'light' : 'dark'} role="group" aria-label={table.label}>
      <dl className={styles.legendRankList}>
        {table.columns.map((c) => {
          const val = [styles.legendRankVal]
          if (c.missing) val.push(styles.legendRankMissing)
          else if (c.band && BAND_CLASS[c.band]) val.push(styles[BAND_CLASS[c.band]])
          return (
            <div key={c.key} data-col={c.key}
              className={c.emphasis ? `${styles.legendRankPair} ${styles.legendRankEmph}` : styles.legendRankPair}>
              <dt className={styles.legendRankHead}>{c.label}</dt>
              <dd className={val.join(' ')}
                {...(c.band ? { 'data-band': c.band } : null)}
                {...(c.missing ? { 'data-missing': '', 'aria-label': `${c.label} not rated` } : null)}>
                {c.text}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
})

export default PaneRanksTable
