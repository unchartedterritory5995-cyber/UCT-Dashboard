// app/src/pages/cot/cotTooltip.js — body lines for a pane's Chart.js tooltip.
//
// Every pane's tooltip lists ALL four series for the hovered week, with the
// hovered pane's own series on top, so a reader never has to move between
// panes to compare groups for the same date.
import { GROUPS } from './cotRead'
import { fmtNum } from './cotFormat'

const OI = { key: 'openInterest', field: 'open_interest', label: 'Open Interest' }

export function tooltipLines(row, hoveredKey) {
  if (!row) return []
  const all  = [...GROUPS, OI]
  const head = all.filter(s => s.key === hoveredKey)
  const rest = all.filter(s => s.key !== hoveredKey)
  return [...head, ...rest].map(s => `${s.label}: ${fmtNum(row[s.field])}`)
}
