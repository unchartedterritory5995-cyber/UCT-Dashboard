// app/src/components/chart/builder/memberPane/useElapsedSince.js
//
// ⭐⭐ e96 (coordinator ruling 2026-11-23): HOW LONG A CHECK HAS RUN, kept current. Real scripts take minutes in the member
// door's worker, so every "checking" surface (the member pane's building line, the editor status panel's headline) says
// for how long it has been checking ("Checking your script... 0:42", `PineEditorStatus.jsx::checkingText`), counted
// from the check's start on the page (`memberDoorAsync.js::sinceOf`, `useMemberDoor.js::useWorkerJob.since`).
import { useEffect, useState } from 'react'

/** How often a running check's elapsed time is re-read, in ms. */
export const ELAPSED_TICK_MS = 1000

/** The ms since `since` (a page-clock time, `Date.now`), re-read every `ELAPSED_TICK_MS` while `since` is a number;
 *  null when there is no check. */
export function useElapsedSince(since, now = Date.now) {
  const [, setTick] = useState(0)
  const live = typeof since === 'number' && Number.isFinite(since)
  useEffect(() => {
    if (!live) return undefined
    const id = setInterval(() => setTick((n) => n + 1), ELAPSED_TICK_MS)
    return () => clearInterval(id)
  }, [live, since])
  return live ? Math.max(0, now() - since) : null
}
