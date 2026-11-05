// ── UCT Agent in MULTI CHART: what a plan may do while the grid is on screen ────────────────────────────────
//
// Chart, indicator and drawing changes run on the grid's cells through the ordinary planner, policy, receipts and Undo
// (agent/host.js: gridEntries, scopeHostToGrid). This file says what does not carry over, before anything is planned:
//   ⛔ the Charts board is out of sight, and the workspace offers none of its controls here. A change to it would land
//      where the member cannot see it, so it is refused, named, and nothing runs.
//   ⛔ Groups mode refills the whole grid when one ticker changes, so a ticker change to "one chart" would be a false receipt.
//   ⛔ a cell draws no watermark, whatever its settings say (GridChartCell: hideWatermark).
//   ⛔ a maximized cell is the only one on screen. A change to a cell behind it would land out of sight, however it was named.
// …and what a receipt must add, because the change reaches past the chart it names.

import { getCapability, getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'

const BOARD_KINDS = new Set(['board', 'workspace'])
export const GRID_BOARD_REFUSAL = 'that changes the Charts board, which is hidden while Multi Chart is on. Exit Multi Chart (Layouts ▸ Multi Chart) and ask again.'
export const GRID_GROUPS_REFUSAL = 'Groups mode refills the whole grid when one ticker changes, so I can’t change a ticker on just one chart here. Turn Groups off (Layouts ▸ Multi Chart) to change a single chart.'
export const GRID_WATERMARK_REFUSAL = 'Multi Chart cells don’t show a watermark, so that setting would change nothing you can see.'
export const GRID_HIDDEN_REFUSAL = 'that chart is hidden behind the maximized one. Restore the grid and ask again.'

/** Is this op aimed at a cell other than the maximized one? */
function behindMaximized(op, cap, host, maximized) {
  if (!maximized || cap.query) return false
  const kind = getTargetKind(cap.target)
  const snap = kind?.list?.(host)?.find(s => s.ref === op.target)
  const cell = chartRefOf(kind, snap)
  return !!cell && cell !== maximized
}

/** → { refuse: sentence } (nothing runs) | { note: sentence for the receipt } | null. */
export function screenGridOps(ops, host) {
  const grid = host?.charts?.grid?.() || null
  let note = null
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    if (!cap) continue
    if (BOARD_KINDS.has(cap.target) || (cap.target === 'layouts' && !cap.query)) return { refuse: GRID_BOARD_REFUSAL }
    if (behindMaximized(o, cap, host, grid?.maximized?.())) return { refuse: GRID_HIDDEN_REFUSAL }
    if (o.action === 'chart.setSymbol' && grid?.groupsMode()) return { refuse: GRID_GROUPS_REFUSAL }
    if (o.action === 'chart.setSetting' && String(o.args?.setting).startsWith('watermark.')) return { refuse: GRID_WATERMARK_REFUSAL }
    if (o.action === 'chart.goToDate' && grid?.syncTimeRange()) note = 'Time-range sync is on, so the other charts in this grid may follow that view.'
    if (cap.target === 'drawing' && !note) {
      const shownOn = host?.drawings?.read?.(o.target)?.charts || []
      if (shownOn.length > 1) note = `Drawings belong to the symbol, so this shows on ${shownOn.join(' and ')}.`
    }
  }
  return note ? { note } : null
}
