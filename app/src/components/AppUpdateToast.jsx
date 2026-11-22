// "A new version of the UCT app is ready." The desktop shell downloads app updates in the background
// (uct-desktop src/main/app-update.ts); this offers the restart. Main window only: a board or a
// Terminal pop-out never shows it. Later hides it for this version; ignoring it is safe because the
// shell installs on the next quit anyway. Loaded only inside the app (DesktopBridgeSync is lazy).
import { useEffect, useState } from 'react'
import { getAppUpdate, hasDesktopFeature, onAppUpdate, restartToUpdate } from '../lib/desktopBridge'
import { isTerminalPopoutChild } from '../lib/reloadGuard'
import styles from './AppUpdateToast.module.css'

export const COPY = 'A new version of the UCT app is ready.'

export default function AppUpdateToast() {
  const [update, setUpdate] = useState(null)
  const [dismissed, setDismissed] = useState(null)

  useEffect(() => {
    if (!hasDesktopFeature('app-update') || window.opener || isTerminalPopoutChild()) return undefined
    let live = true
    getAppUpdate().then((u) => { if (live) setUpdate((cur) => cur ?? u) })
    const off = onAppUpdate((u) => setUpdate(u))
    return () => {
      live = false
      off()
    }
  }, [])

  if (!update || dismissed === update.version) return null
  return (
    <div className={styles.toast} role="status" data-testid="app-update-toast">
      <span>{COPY}</span>
      <button type="button" className={styles.btn} onClick={() => restartToUpdate()}>Restart to update</button>
      <button type="button" className={styles.later} onClick={() => setDismissed(update.version)}>Later</button>
    </div>
  )
}
