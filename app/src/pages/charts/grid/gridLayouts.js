// app/src/pages/charts/grid/gridLayouts.js
//
// Fixed-grid layout math for the /charts Multi-Chart grid mode. Ported from the
// orphaned V1 (pages/multichart/multiChartLayouts.js) and extended: 3x2/3x3/4x4
// presets, a custom N×M generator, and GRID_MAX_CELLS clamping for state
// hydrated from prefs (a stale save from before a cap downgrade must degrade
// gracefully instead of mounting more charts than the cap allows).

import { CHART_TYPE_OPTIONS } from '../../../components/chart/chartDefaults'

// Hard ceiling on cells in a grid. 16 pending the perf spike (see the design
// spec's decision tree) — lower it there, never raise it without a spike run.
export const GRID_MAX_CELLS = 16

// Preset layouts offered in the Multi Charts dropdown, in display order.
export const LAYOUTS = [
  { id: '1x2', rows: 1, cols: 2, cellCount: 2, label: 'Side by side' },
  { id: '2x1', rows: 2, cols: 1, cellCount: 2, label: 'Stacked' },
  { id: '2x2', rows: 2, cols: 2, cellCount: 4, label: '2×2' },
  { id: '2x3', rows: 2, cols: 3, cellCount: 6, label: '2×3' },
  { id: '3x2', rows: 3, cols: 2, cellCount: 6, label: '3×2' },
  { id: '3x3', rows: 3, cols: 3, cellCount: 9, label: '3×3' },
  { id: '4x4', rows: 4, cols: 4, cellCount: 16, label: '4×4' },
]

// Custom N×M (and preset-id parsing). Rows/cols clamp to [1, 4] and the total
// to GRID_MAX_CELLS, so no input path can produce an over-cap grid.
export function makeLayout(rows, cols) {
  const r = Math.max(1, Math.min(4, Math.floor(Number(rows) || 1)))
  const c = Math.max(1, Math.min(4, Math.floor(Number(cols) || 1)))
  return { id: `${r}x${c}`, rows: r, cols: c, cellCount: Math.min(r * c, GRID_MAX_CELLS) }
}

export function parseLayoutId(layoutId) {
  const m = /^(\d+)x(\d+)$/.exec(String(layoutId || ''))
  if (!m) return makeLayout(2, 2)
  return makeLayout(Number(m[1]), Number(m[2]))
}

function genId() {
  return Math.random().toString(36).slice(2, 8)
}

export function makeEmptyCell() {
  return { id: genId(), sym: null, tf: 'D' }
}

// First-run grid: the V1 watch-panel preset (2x2 of the index complex) so grid
// mode never opens as a dead wall of "+ Add ticker" slots.
export function makeDefaultState() {
  return {
    layout: '2x2',
    cells: [
      { id: genId(), sym: 'QQQ', tf: 'D' },
      { id: genId(), sym: 'SPY', tf: 'D' },
      { id: genId(), sym: 'IWM', tf: 'D' },
      { id: genId(), sym: 'DIA', tf: 'D' },
    ],
    syncCrosshair: false,
    syncTimeRange: false,
    groupsMode: false,
    group: null,
  }
}

// Layout switch keeps existing cells row-major: shrinking truncates the tail,
// growing appends empty cells with FRESH ids (surviving cells keep their id so
// keyed React children — and their live chart instances — never remount).
export function reconcileCells(cells, cellCount) {
  const prev = Array.isArray(cells) ? cells : []
  const count = Math.max(1, Math.min(GRID_MAX_CELLS, cellCount | 0))
  if (prev.length >= count) return prev.slice(0, count)
  return [...prev, ...Array.from({ length: count - prev.length }, makeEmptyCell)]
}

const VALID_TFS = new Set(['1', '5', '15', '30', '60', 'D', 'W', 'M'])
// Derived from the canonical picker list so sanitizer and picker cannot drift.
const VALID_CHART_TYPES = new Set(CHART_TYPE_OPTIONS.map(([code]) => code))

// Validate a persisted group descriptor. Unknown => null (feature degrades to
// a plain grid rather than restoring a bogus group).
function sanitizeGroup(g) {
  if (!g || typeof g !== 'object') return null
  const id = typeof g.id === 'string' && g.id ? g.id : null
  if (!id) return null
  const by = g.by === 'rs' ? 'rs' : 'today'
  const n = Number.isFinite(g.n) ? Math.max(1, Math.min(GRID_MAX_CELLS, g.n | 0)) : null
  // Carry the curated display name so the heat header restores it instantly on
  // reload (no fetchGroups round-trip that can lag or fail-empty and leave the
  // raw snake_case id showing).
  const name = typeof g.name === 'string' && g.name.trim() ? g.name.trim() : null
  return { id, by, ...(n ? { n } : {}), ...(name ? { name } : {}) }
}

// Sanitize state hydrated from the multichart_state pref (or an old V1 blob).
// Never trust persisted shapes: bad tf → 'D', bad sym → empty cell, over-cap
// cell lists → clamped to the layout (which itself clamps to GRID_MAX_CELLS).
export function sanitizeState(raw) {
  const fallback = makeDefaultState()
  if (!raw || typeof raw !== 'object') return fallback
  const layout = parseLayoutId(raw.layout)
  const cells = (Array.isArray(raw.cells) ? raw.cells : [])
    .slice(0, layout.cellCount)
    .map(c => ({
      id: typeof c?.id === 'string' && c.id ? c.id : genId(),
      sym: typeof c?.sym === 'string' && c.sym.trim() ? c.sym.trim().toUpperCase() : null,
      tf: VALID_TFS.has(c?.tf) ? c.tf : 'D',
      chartType: VALID_CHART_TYPES.has(c?.chartType) ? c.chartType : null,
    }))
  const group = sanitizeGroup(raw.group)
  return {
    layout: layout.id,
    cells: reconcileCells(cells, layout.cellCount),
    syncCrosshair: raw.syncCrosshair === true,
    syncTimeRange: raw.syncTimeRange === true,
    // A non-null group implies scanning is on — mirrors applyGridTemplate's
    // `groupsMode: !!s.group` invariant so a board persisted with a group but
    // no groupsMode key (pre-feature save) doesn't hydrate into a contradictory
    // UI (badges/header on, scanning checkbox off).
    groupsMode: raw.groupsMode === true || !!group,
    group,
  }
}
