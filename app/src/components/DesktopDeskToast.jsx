// app/src/components/DesktopDeskToast.jsx
//
// Tells the member that a board could not reopen at launch while they were on another page. The
// workspace's own notice only shows with the board, so this is a leaf outside it, in the desktop
// app only, reading one primitive like UpdateReadyToast. position: fixed moves nothing else.
import { useSyncExternalStore } from 'react'
import { dismissDeskLaunchBlocked, isDeskLaunchBlocked, subscribePopouts } from '../lib/popoutRegistry'
import styles from './UpdateReadyToast.module.css'

export default function DesktopDeskToast() {
  const blocked = useSyncExternalStore(subscribePopouts, isDeskLaunchBlocked)
  if (!blocked) return null
  return (
    <div className={styles.toast} role="status" data-testid="desk-launch-blocked-toast">
      <span>A board could not reopen in its own window, so it is back on your Charts page.</span>
      <button type="button" className={styles.btn} onClick={dismissDeskLaunchBlocked}>Dismiss</button>
    </div>
  )
}
