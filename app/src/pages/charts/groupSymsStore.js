// app/src/pages/charts/groupSymsStore.js
//
// ⭐ THE COLOUR GROUPS' SYMBOLS, OUTSIDE THE BOARD'S RENDER (switch render cuts, 2026-11-20).
//
// `groupSyms` was ChartsWorkspaceBoard STATE, so every symbol switch re-rendered the whole board: its own
// ~4,000-line body, the grid, every widget host and every widget under them, the ones that show no symbol
// at all included (measured on production, 2026-11-20, a render probe on the flip proof: the switch's
// first render pass was the entire board, and in it not even the charts' requested symbol had moved yet).
//
// The board now owns this store instead, and `useWorkspace()` subscribes to it
// (`WorkspaceContext.jsx`): a symbol change re-renders the components that read the workspace, and the
// board, the grid and the widget hosts stay as they are. The workspace value itself no longer changes on a
// switch. Writes keep `useState`'s shape (a value or an updater; an unchanged value is no write).

export function createGroupSymsStore(initial) {
  let snap = initial
  const subs = new Set()
  return {
    get: () => snap,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
    set: (next) => {
      const v = typeof next === 'function' ? next(snap) : next
      if (Object.is(v, snap)) return
      snap = v
      for (const fn of [...subs]) fn()
    },
  }
}
