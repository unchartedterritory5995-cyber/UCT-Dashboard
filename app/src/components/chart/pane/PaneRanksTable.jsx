// app/src/components/chart/pane/PaneRanksTable.jsx
//
// ─── THE PANE TABLE, RENDERED (UCT RS design round, 2026-11-08) ─────────────
//
// A compact two-row table in an indicator pane's top-right corner: the header
// row of column codes (`1M 3M 6M 12M RS`), the value row of 1-99 ranks. The model
// is `engine/paneTable.paneTableFor`'s (stamped on the chip by `readout.js`); this
// component draws exactly what it says and knows no definition.
//
// ⭐ BRAND: neutral ink, tabular numbers, 11 px, no gold (gold is the one
// look-here mark and it belongs to the before-price dot). A value takes the site's
// rating-band ink only when the model carries a `band` (the member's Rating
// colours switch). A missing rank is an en dash in the muted ink.
//
// ⭐ POSITION is the surface's: `StockChart.pinPaneLegend` pins the table to its
// pane's top, left of the price scale, and steps it aside (`data-collapsed`) when
// it would touch the pane label — measured every frame, so a 390 px phone and a
// narrow Multi-Chart cell both fall back to the readout's Rating card.
//
// ⛔ The class names carry "legend" on purpose: the newsletter export
// (`pages/ChartRender.jsx`) hides `[class*="legend" i]`, and the pane label beside
// this table is hidden there too, so the export moves no pixel either way.
import React, { forwardRef } from 'react'
import styles from './PaneRanksTable.module.css'

const BAND_CLASS = Object.freeze({
  lead: 'legendRankLead', strong: 'legendRankStrong', neutral: 'legendRankNeutral', lag: 'legendRankLag',
})

const PaneRanksTable = forwardRef(function PaneRanksTable({ table, paneKey }, ref) {
  if (!table || !Array.isArray(table.columns) || !table.columns.length) return null
  return (
    <div ref={ref} className={styles.legendRanksTable} data-pane-table={paneKey || ''}>
      <table aria-label={table.label}>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c.key} scope="col" data-col={c.key}
                className={c.emphasis ? `${styles.legendRankHead} ${styles.legendRankEmph}` : styles.legendRankHead}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {table.columns.map((c) => {
              const cls = [styles.legendRankVal]
              if (c.emphasis) cls.push(styles.legendRankEmph)
              if (c.missing) cls.push(styles.legendRankMissing)
              else if (c.band && BAND_CLASS[c.band]) cls.push(styles[BAND_CLASS[c.band]])
              return (
                <td key={c.key} data-col={c.key} className={cls.join(' ')}
                  {...(c.band ? { 'data-band': c.band } : null)}
                  {...(c.missing ? { 'data-missing': '', 'aria-label': `${c.label} not rated` } : null)}>
                  {c.text}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
})

export default PaneRanksTable
