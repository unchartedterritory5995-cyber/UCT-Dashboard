// app/src/components/chart/supportLoop/reportDoor.jsx
//
// ⭐ The A3 door's two pieces a HOST needs (`docs/pine/support-loop/PHASE-A.md`):
// whether the server's report flag is on, and the dialog, loaded on first open.
// Kept apart from `importGaps.js` (and its 755-name allowlist) so the chart chunk,
// which only offers the chip-menu row, pays for neither the translator reader nor
// the dialog until a member asks for it.

import { lazy, Suspense } from 'react'

const ReportMismatchDialog = lazy(() => import('./ReportMismatchDialog'))

/** The A3 dialog, loaded on first open. */
export function LazyReportMismatchDialog(props) {
  if (!props.open) return null
  return (
    <Suspense fallback={null}>
      <ReportMismatchDialog {...props} />
    </Suspense>
  )
}
