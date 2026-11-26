// The one importer of the Charts workspace page: ChartsDeskHost's lazy() and App.jsx's route
// prefetch both use it, so they can never resolve different modules.
//
// ⭐ It also remembers the module once it has loaded (`loadedChartsWorkspace`), so ChartsDeskHost's
// lazy() can hand React the module SYNCHRONOUSLY when the boot prefetch already landed. Without that,
// React.lazy around an async factory suspends on the first render even with the module in hand, the
// boundary commits its fallback, and React 19.2 holds the reveal for 300 ms after it: every request
// the chart makes (its own bars first) waited on that timer (ChartsDeskHost.firstCommit.test.jsx).
let loaded = null

export const importChartsWorkspace = () => import('./ChartsWorkspace').then((mod) => {
  loaded = mod
  return mod
})

/** The workspace module if it has loaded in this page, else null. */
export const loadedChartsWorkspace = () => loaded
