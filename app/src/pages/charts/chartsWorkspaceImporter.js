// The one importer of the Charts workspace page: ChartsDeskHost's lazy() and App.jsx's route
// prefetch both use it, so they can never resolve different modules.
export const importChartsWorkspace = () => import('./ChartsWorkspace')
