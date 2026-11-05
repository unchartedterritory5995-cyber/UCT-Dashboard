// app/src/pages/charts/grid/gridAgentAdapter.js
//
// ⭐ UCT AGENT ⇄ MULTI CHART. A grid cell is a controlled {sym, tf, chartType, settings} record, not a ChartWidget, so the
// Agent's chart target (agent/host.js) reaches it through two entries in the workspace's own `chartApiById` registry:
//
//   GRID_BOARD_KEY        MultiChartGrid's description of the grid itself (cells, layout, selection, what the sync toggles do)
//   gridCellKey(cell.id)  GridChartCell's adapter: read + commit through the SAME onChange a click in that cell uses
//
// Pure helpers only: what a cell's stored state looks like to the Agent, and the next cell a patch writes.

export const GRID_BOARD_KEY = 'grid:board'
export const gridCellKey = (id) => `grid:cell:${id}`

// A cell's per-cell Style pick (`cell.chartType`) WINS over its settings blob, so the Agent's "stored settings" must carry
// it: a type change has to move the pick (or the canvas would not change under a receipt that says it did), and an Undo has
// to put the pick back. An unforked cell with a pick has no blob to carry it in; this marker says so, and is never saved.
const UNFORKED = '__gridUnforked'

/** The cell's stored settings as the Agent reads, fingerprints and restores them. */
export function cellStored(cell) {
  const s = cell?.settings ?? null
  if (!cell?.chartType) return s
  return s ? { ...s, chartType: cell.chartType } : { chartType: cell.chartType, [UNFORKED]: true }
}

/** The next cell a chart patch ({settings?, tf?, symbol?}) writes. `settings` present (even null) stores exactly that blob.
 *  A null `symbol` is the Undo of a ticker put on an empty cell: `clearSym` tells the grid's merge to empty it. */
export function cellPatch(cell, patch) {
  const next = { ...cell }
  if ('tf' in patch) next.tf = patch.tf
  if (patch.symbol) next.sym = patch.symbol
  else if ('symbol' in patch) { next.sym = null; next.clearSym = true }
  if ('settings' in patch) {
    const raw = patch.settings
    if (raw == null) next.settings = null
    else {
      const { [UNFORKED]: unforked, ...blob } = raw
      next.settings = unforked ? null : blob
      // `unforked` only ever comes from a pick, so it restores one even if the member has since cleared it
      if ((cell?.chartType || unforked) && typeof raw.chartType === 'string' && raw.chartType !== cell?.chartType) next.chartType = raw.chartType
    }
  }
  return next
}
