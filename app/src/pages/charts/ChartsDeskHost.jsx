// Keeps the Charts workspace mounted while a board or widget is popped out, so changing page in
// the main window no longer closes the windows on the other monitors.
//
// It renders inside Layout's <main>, directly before the routed page, exactly where the /charts
// route element used to sit: the workspace's DOM position is unchanged and there is no wrapper.
// The /charts route itself now renders nothing (`ChartsRouteSlot`); this is the only mount.
//
// ⛔ With nothing popped it behaves exactly as the route did: mounted on /charts, gone on any other
// page. The hold only starts while it is ALREADY mounted (the latch below), because a portal window
// can also belong to something else (BreadthDrillModal) and must never mount a hidden workspace on
// a page that never had one.
//
// ⛔ State lives HERE, not in Layout, and is one primitive read from the registry, not a context
// object (a shared render loop froze navigation for 4.5 hours, rail in ChartsDeskHost.test.jsx).
import { Suspense, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import lazy from '../../utils/lazyWithRetry'
import { subscribePopouts, hasOpenPopouts, isDeskLaunchPending } from '../../lib/popoutRegistry'
import { importChartsWorkspace } from './chartsWorkspaceImporter'

const ChartsWorkspace = lazy(importChartsWorkspace)

// Case-insensitive because React Router's matching is: /Charts resolves to the /charts route.
const isChartsPath = (pathname) => /^\/charts\/?$/i.test(pathname)

/** The /charts route element: routing still resolves, and the host owns what shows. */
export function ChartsRouteSlot() { return null }

export default function ChartsDeskHost({ fallback = null }) {
  const { pathname } = useLocation()
  const windowOpen = useSyncExternalStore(subscribePopouts, hasOpenPopouts)
  // Desktop app only: the desk has records to bring back. Hidden here until the windows exist.
  const launchPending = useSyncExternalStore(subscribePopouts, isDeskLaunchPending)
  const onCharts = isChartsPath(pathname)
  const [held, setHeld] = useState(false)
  const mounted = onCharts || launchPending || (held && windowOpen)
  // Adjusting state during render (not an effect) so the workspace is never rendered once more on
  // a page it no longer belongs to. Settles in one pass: `held` only ever follows `mounted`.
  if (held !== mounted) setHeld(mounted)
  if (!mounted) return null
  return (
    <Suspense fallback={onCharts ? fallback : null}>
      <ChartsWorkspace hidden={!onCharts} />
    </Suspense>
  )
}
