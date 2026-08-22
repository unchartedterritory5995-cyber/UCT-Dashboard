// app/src/pages/cot/cotTooltip.js — body lines for a pane's Chart.js tooltip.
//
// Every pane's tooltip lists ALL series for the hovered week, with the
// hovered pane's own series on top, so a reader never has to move between
// panes to compare groups for the same date. When a price proxy is loaded
// its close rides along as a fifth line (first when the price pane is hovered).
import { GROUPS } from './cotRead'
import { fmtNum } from './cotFormat'

const OI = { key: 'openInterest', field: 'open_interest', label: 'Open Interest' }

/**
 * @param {object|null} row        the COT record for the hovered week
 * @param {string}      hoveredKey 'commercials' | 'largeSpecs' | 'smallSpecs' | 'openInterest' | 'price'
 * @param {{ticker:string, close:number|null}=} price  proxy close for that week
 */
export function tooltipRows(row, hoveredKey, price) {
  if (!row) return []
  const series = [...GROUPS, OI].map(s => ({ key: s.key, label: s.label, value: fmtNum(row[s.field]) }))
  if (price && price.close != null && Number.isFinite(price.close)) {
    series.push({ key: 'price', label: `Price (${price.ticker})`, value: price.close.toFixed(2) })
  }
  const head = series.filter(s => s.key === hoveredKey)
  const rest = series.filter(s => s.key !== hoveredKey)
  return [...head, ...rest].map(s => ({ ...s, hot: s.key === hoveredKey }))
}

export function tooltipLines(row, hoveredKey, price) {
  return tooltipRows(row, hoveredKey, price).map(r => `${r.label}: ${r.value}`)
}
