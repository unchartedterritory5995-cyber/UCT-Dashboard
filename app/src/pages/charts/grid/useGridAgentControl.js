// app/src/pages/charts/grid/useGridAgentControl.js
//
// ⭐ UCT AGENT ⇄ MULTI CHART, THE GRID ITSELF. What a member does to the WHOLE grid from the Multi Charts menu — its layout,
// entering and leaving it, the two sync toggles, Groups, a saved grid, the shared settings, maximizing one cell, resetting
// a cell to their own chart — reachable by the Agent (agent/capabilities/multiChart.js) through the SAME writers the menu,
// the picker and the cell buttons call:
//   useMultiChartState            enterGrid / exitGrid / applyCustomLayout / setSyncCrosshair / setSyncTimeRange /
//                                 setGroupsMode / applyGridTemplate / updateCellAt / setSettingsOpen / setMaxId
//   gridGroupActions              pickGroup / stepGroup / switchGroup / refreshGroup (the menu's fetch-and-fill)
//   useChartLayouts               the multichart rows of /api/charts/layouts (Save grid as… / the ✕ on "My grids")
// and an exact Undo over `snapshot` / `restoreSnapshot` (the persisted board, byte for byte).
//
// Mounted where `mc` lives (ChartsWorkspace), so the Agent reaches the grid from the board too ("show me a 2×2").
// The object is STABLE (every read is live through a ref), so the Agent host built once around it never goes stale.
// ⛔ Admin / global scope is not here: a grid the Agent saves is always the member's own (C3-054 is owner-blocked), and it
// deletes only the member's own grids.
import { useMemo, useRef } from 'react'
import useChartLayouts from '../../../hooks/useChartLayouts'
import { gridTemplateLayout } from './gridLayouts'
import { fetchGroups } from './groupsApi'
import { pickGroup, stepGroup, switchGroup, refreshGroup } from './gridGroupActions'

const isGrid = (t) => t?.layout?.kind === 'multichart'

export default function useGridAgentControl(mc) {
  const { global: globalLayouts, mine: myLayouts, saveLayout, deleteLayout } = useChartLayouts()
  const live = useRef(null)
  live.current = { mc, globalLayouts, myLayouts, saveLayout, deleteLayout }
  return useMemo(() => {
    const m = () => live.current.mc
    return {
      state: () => m().state,
      maxId: () => m().maxId ?? null,
      settingsOpen: () => !!m().settingsOpen,
      snapshot: () => m().snapshot(),
      restoreSnapshot: (raw) => m().restoreSnapshot(raw),
      enterGrid: (layoutId) => m().enterGrid(layoutId),
      exitGrid: () => m().exitGrid(),
      applyCustomLayout: (rows, cols) => m().applyCustomLayout(rows, cols),
      setSyncCrosshair: (on) => m().setSyncCrosshair(on),
      setSyncTimeRange: (on) => m().setSyncTimeRange(on),
      setGroupsMode: (on) => m().setGroupsMode(on),
      setSettingsOpen: (on) => m().setSettingsOpen(!!on),
      setMaxId: (id) => m().setMaxId?.(id ?? null),
      // "Reset to my chart" (GridChartCell.resetToMyChart): the cell drops its own settings and draws the member's chart again;
      // its Style pick and timeframe stay. Written through the cell's own merge (updateCellAt), never a fork of anything.
      resetCell: (id) => {
        const cur = m().state.cells
        const i = cur.findIndex(c => c.id === id)
        if (i < 0) return false
        const { settings: _drop, ...rest } = cur[i]
        m().updateCellAt(i, rest)
        return true
      },
      // the Undo of a cell change: that one cell exactly as it was (its id finds it)
      restoreCell: (json) => {
        let cell = null
        try { cell = JSON.parse(json) } catch { cell = null }
        const i = cell ? m().state.cells.findIndex(c => c.id === cell.id) : -1
        if (i < 0) return false
        m().updateCellAt(i, cell)
        return true
      },
      // Groups: exactly the menu's functions
      groups: () => fetchGroups(),
      pickGroup: (g) => pickGroup(m(), g),
      stepGroup: (dir) => stepGroup(m(), dir),
      switchGroup: (id, name) => switchGroup(m(), id, name, { curName: m().state.group?.name || null }),
      refreshGroup: () => refreshGroup(m()),
      // Saved grids: the multichart rows of the layouts service, as the menu lists them (Prebuilt grids, then My grids)
      savedGrids: () => [
        ...(live.current.globalLayouts || []).filter(isGrid).map(t => ({ id: t.id, name: t.name, scope: 'global', layout: t.layout })),
        ...(live.current.myLayouts || []).filter(isGrid).map(t => ({ id: t.id, name: t.name, scope: 'user', layout: t.layout })),
      ],
      applySaved: (tpl) => m().applyGridTemplate(tpl),
      // create-only: an Agent save never replaces a grid of that name (the server refuses with 409 instead)
      saveGrid: (name, layout = gridTemplateLayout(m().state)) => live.current.saveLayout({ name, layout, groups: null, scope: 'user', createOnly: true }),
      deleteGrid: (id) => live.current.deleteLayout(id),
    }
  }, [])
}
