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
import { viewAt } from './capabilities/chart'

const BOARD_KINDS = new Set(['board', 'workspace'])
export const GRID_BOARD_REFUSAL = 'that changes the Charts board, which is hidden while Multi Chart is on. Exit Multi Chart (Layouts ▸ Multi Chart) and ask again.'
export const GRID_GROUPS_REFUSAL = 'Groups mode refills the whole grid when one ticker changes, so I can’t change a ticker on just one chart here. Turn Groups off (Layouts ▸ Multi Chart) to change a single chart.'
export const GRID_WATERMARK_REFUSAL = 'Multi Chart cells don’t show a watermark, so that setting would change nothing you can see.'
const EMPTY_CELL_OK = new Set(['chart.setSymbol', 'chart.setTimeframe'])
export const GRID_EMPTY_CELL_REFUSAL = 'That cell is empty, so there is no chart there to change yet. Put a ticker on it first (say “put SPY on the empty cell”), then ask again.'
export const GRID_HIDDEN_REFUSAL = 'that chart is hidden behind the maximized one. Restore the grid and ask again.'

/** Is this op aimed at a cell other than the maximized one? */
function behindMaximized(op, cap, host, maximized) {
  if (!maximized || cap.query) return false
  const kind = getTargetKind(cap.target)
  const snap = kind?.list?.(host)?.find(s => s.ref === op.target)
  const cell = chartRefOf(kind, snap)
  return !!cell && cell !== maximized
}

const SYNC_WAIT_MS = 600
const viewOf = (host, ref) => { try { return host?.charts?.read?.(ref)?.view ?? null } catch { return null } }
const rightEdgeOf = (host, ref) => viewOf(host, ref)?.rightMs ?? null
const pause = (ms) => new Promise(r => setTimeout(r, ms))
const andNames = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
/** What a receipt says of the other cells, from what they did. */
export function gridSyncSentence(moved, stayed) {
  if (!stayed.length) return 'Time-range sync is on, so the other charts in this grid moved with it.'
  const verb = stayed.length === 1 ? 'was' : 'were'
  if (!moved.length) return `Time-range sync is on, but the other charts stayed where they ${verb}.`
  return `Time-range sync is on: ${andNames(moved)} moved with it, ${andNames(stayed)} stayed where ${stayed.length === 1 ? 'it' : 'they'} ${verb}.`
}
/**
 * A date jump with time-range sync on: whether the other cells follow is decided by each cell, on a later frame, and depends
 * on the view and on their history. Called BEFORE the change, this keeps their right edges; the function it returns is called
 * after, and answers with the sentence for what moved. null when no cell can follow.
 */
export function watchGridSync(ops, host) {
  const grid = host?.charts?.grid?.() || null
  const jump = (ops || []).find(o => o?.action === 'chart.goToDate')
  if (!jump || !grid?.syncTimeRange?.()) return null
  const others = (host.charts.list?.() || []).filter(c => c.ref !== jump.target && c.symbol)
  if (!others.length) return null
  const before = new Map(others.map(c => [c.ref, rightEdgeOf(host, c.ref)]))
  return async () => {
    const t0 = Date.now()
    // arrived, not merely moved: a live chart's right edge moves by itself, so a cell counts only once it stands where the jump went
    const target = rightEdgeOf(host, jump.target)
    const movedNow = () => others.filter(c => rightEdgeOf(host, c.ref) !== before.get(c.ref) && target != null && viewAt(viewOf(host, c.ref), target))
    while (movedNow().length < others.length && Date.now() - t0 < SYNC_WAIT_MS) await pause(50)
    const moved = movedNow()
    return gridSyncSentence(moved.map(c => c.symbol), others.filter(c => !moved.includes(c)).map(c => c.symbol))
  }
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
    // pl-auto u-workspace-09 (BROWSER-MOCK-MODEL): "log scale in the empty cell" was receipted as changed while the cell, with no
    // ticker, draws no chart at all. Only what an empty cell shows can change on it (its ticker, its timeframe); the rest is refused
    // in words, never receipted.
    if (cap.target === 'chart' && !cap.query && !EMPTY_CELL_OK.has(o.action)) {
      let c = null
      try { c = host?.charts?.read?.(o.target) || null } catch { c = null }
      if (c && 'symbol' in c && !String(c.symbol || '').trim()) return { refuse: GRID_EMPTY_CELL_REFUSAL }
    }
    if (cap.target === 'drawing' && !note) {
      const shownOn = host?.drawings?.read?.(o.target)?.charts || []
      if (shownOn.length > 1) note = `Drawings belong to the symbol, so this shows on ${shownOn.join(' and ')}.`
    }
  }
  return note ? { note } : null
}
