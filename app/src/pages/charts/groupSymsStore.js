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

/**
 * ⭐ ONE BOARD'S VIEW OF THE GROUPS' SYMBOLS (2026-11-27, the board keep-alive's layer mode; boardVisibility.js).
 *
 * A hidden layer board stays mounted, so a symbol switch on the board in front would switch its linked charts too (each
 * a bar-store key it no longer subscribes to). Each board slot reads `source` through this view instead: while the
 * board's handle `vis` is hidden the view holds the symbols as of the hide and tells nobody of a change; the show
 * reads `source` again, and tells its readers only when the symbols moved meanwhile. Writes go to `source`.
 * The view is the slot's for life (its identity never changes at a hide or a show, so neither re-renders a reader).
 * ⛔ `scope` is the SOURCE: the identity the board's group decisions are keyed on (handoffGroups.js), so a chart reading
 * through a view joins the same decision the board's setGroupSym makes (ChartWidget `groupScope`).
 */
export function createBoardGroupSymsView(source, vis) {
  let held = null   // { snap } while the board is hidden
  const subs = new Set()
  const emit = () => { for (const fn of [...subs]) fn() }
  const onVis = () => {
    if (vis.state !== 'visible') {
      if (!held) held = { snap: source.get() }
    } else if (held) {
      const was = held.snap
      held = null
      if (!Object.is(was, source.get())) emit()
    }
  }
  if (vis?.state === 'hidden') held = { snap: source.get() }
  if (typeof vis?.subscribe === 'function') vis.subscribe(onVis)
  let unsource = null
  return {
    scope: source,
    get: () => (held ? held.snap : source.get()),
    subscribe: (fn) => {
      subs.add(fn)
      if (!unsource) unsource = source.subscribe(() => { if (!held) emit() })
      return () => {
        subs.delete(fn)
        if (!subs.size && unsource) { unsource(); unsource = null }
      }
    },
    set: (next) => source.set(next),
  }
}
