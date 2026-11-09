// "A new version is ready." A null-rendering-until-needed leaf: ALL of its state is here, in
// primitives read from external stores, so Layout gains no state and a render here cannot loop the
// shell (a shared render loop froze navigation app-wide for 4.5 hours in September; the rail is
// UpdateReadyToast.test.jsx). position: fixed, so it moves nothing on viewport-locked pages.
import { useEffect, useSyncExternalStore } from 'react'
import { subscribePopouts, hasOpenPopouts } from '../lib/popoutRegistry'
import { acquireBuildWatch } from '../lib/buildWatch'
import {
  subscribeUpdateRequired, isUpdateAnnounced, reloadNow,
} from '../lib/reloadGuard'
import styles from './UpdateReadyToast.module.css'

export const COPY_PLAIN = 'A new version of UCT is ready.'
export const COPY_POPOUTS = 'A new version of UCT is ready. Your popped-out windows will close, and you can restore boards afterward.'

export default function UpdateReadyToast({ watch = true }) {
  const announced = useSyncExternalStore(subscribeUpdateRequired, isUpdateAnnounced)
  const popouts = useSyncExternalStore(subscribePopouts, hasOpenPopouts)

  // The watcher is a page-level singleton (lib/buildWatch.js): this leaf only holds a reference.
  useEffect(() => (watch ? acquireBuildWatch() : undefined), [watch])

  if (!announced) return null
  return (
    <div className={styles.toast} role="status" data-testid="update-ready-toast">
      <span>{popouts ? COPY_POPOUTS : COPY_PLAIN}</span>
      <button type="button" className={styles.btn} onClick={() => reloadNow()}>Reload</button>
    </div>
  )
}
