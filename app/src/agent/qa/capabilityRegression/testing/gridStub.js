// CAPABILITY REGRESSION · the Multi Chart grid's control surface (#1030), in memory — the GRID fixture board's host.gridControl.
// The same method set pages/charts/grid/useGridAgentControl.js hands the Agent (capabilities/multiChart.js reads nothing
// else), over a plain state object shaped like useMultiChartState's persisted board: { mode, layout, cells, syncCrosshair,
// syncTimeRange, groupsMode, group }. `snapshot` / `restoreSnapshot` are that board as JSON (the real hook's are
// multichart_state, byte for byte). No Groups source and no saved grids: the corpus asserts the grid's own state only.
import { LAYOUTS, parseLayoutId } from '../../../../pages/charts/grid/gridLayouts'

const cellsFor = (n, prev = []) => Array.from({ length: n }, (_, i) => prev[i] || { id: `g${i + 1}`, sym: null, tf: 'D' })

export function makeGridControl(seedSyms = ['NVDA']) {
  let st = { mode: 'workspace', layout: '2x2', cells: cellsFor(4, seedSyms.map((sym, i) => ({ id: `g${i + 1}`, sym, tf: 'D' }))),
    syncCrosshair: false, syncTimeRange: false, groupsMode: false, group: null }
  let maxId = null
  let settingsOpen = false
  const reshape = (id) => { const l = parseLayoutId(id); st = { ...st, mode: 'grid', layout: l.id, cells: cellsFor(l.cellCount, st.cells) } }
  return {
    state: () => st,
    maxId: () => maxId,
    settingsOpen: () => settingsOpen,
    snapshot: () => JSON.stringify(st),
    restoreSnapshot: (raw) => { st = JSON.parse(raw) },
    enterGrid: (layoutId) => { if (layoutId && LAYOUTS.some(l => l.id === layoutId)) reshape(layoutId); else st = { ...st, mode: 'grid' } },
    exitGrid: () => { st = { ...st, mode: 'workspace' }; maxId = null },
    applyCustomLayout: (rows, cols) => reshape(`${rows}x${cols}`),
    setSyncCrosshair: (on) => { st = { ...st, syncCrosshair: !!on } },
    setSyncTimeRange: (on) => { st = { ...st, syncTimeRange: !!on } },
    setGroupsMode: (on) => { st = { ...st, groupsMode: !!on, ...(on ? {} : { group: null }) } },
    setSettingsOpen: (on) => { settingsOpen = !!on },
    setMaxId: (id) => { maxId = id ?? null },
    resetCell: () => false,
    restoreCell: () => false,
    groups: async () => [],
    pickGroup: async () => ({ ok: false, error: 'no groups in this fixture' }),
    stepGroup: async () => ({ ok: false, error: 'no groups in this fixture' }),
    switchGroup: async () => ({ ok: false, error: 'no groups in this fixture' }),
    refreshGroup: async () => ({ ok: false, error: 'no groups in this fixture' }),
    savedGrids: () => [],
    applySaved: () => false,
    saveGrid: async () => null,
    deleteGrid: async () => null,
  }
}
