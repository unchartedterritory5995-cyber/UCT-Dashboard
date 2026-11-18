// UCT Agent's reach into Tools → Compare Symbols (agent/capabilities/comparePanel.js, compare.openView).
//
// ⭐ The SAME door every other opener uses: the `uct:compare-open` window event (COMPARE_OPEN_EVENT) that a chart's
// "Open the rotation map" link dispatches. ChartsWorkspace opens the panel on it (desktop only) and the open panel
// switches its tab on it, so the Agent never sets the panel's state itself.
//
// `get()` returns ChartsWorkspace's compare state through a ref (the host memo stays dependency-free):
//   { mobile, grid, open, tab, intent, hasChart(), percentOn(), close() }
// `tab` is the tab the panel REPORTS on screen (CompareSymbolsPanel onTabChange), `intent` the last event's detail.
//
// ⛔ No event is dispatched where the panel cannot open: the phone shell (mounts no panel), Multi Chart (no Tools menu),
//    or a board with no chart (the workspace's openCompare would ADD a chart widget to the saved layout first).

import { COMPARE_OPEN_EVENT } from './compareGroups'

export function compareAgentSource(get) {
  const where = (r) => !!r && !r.mobile && !r.grid
  return {
    read: () => {
      const r = get()
      if (!r) return null
      const open = !!r.open
      return {
        here: where(r),
        open,
        tab: open ? (r.tab ?? null) : null,
        intent: open ? (r.intent ?? null) : null,
        hasChart: !!r.hasChart?.(),
        // the chart the panel will work on has % scale on: mounting the panel turns it off and SAVES that
        // (CompareSymbolsPanel's resolve → setPercentScale(false)), so the Agent does not open it then
        scaleLocked: !open && !!r.percentOn?.(),
      }
    },
    open: (detail) => {
      const r = get()
      if (!where(r) || !r.hasChart?.()) return false
      window.dispatchEvent(new CustomEvent(COMPARE_OPEN_EVENT, { detail }))
      return true
    },
    // the panel's own × (ChartsWorkspace's onClose)
    close: () => {
      const r = get()
      if (!r || typeof r.close !== 'function') return false
      r.close()
      return true
    },
  }
}
