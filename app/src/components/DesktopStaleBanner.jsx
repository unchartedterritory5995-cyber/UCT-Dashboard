// app/src/components/DesktopStaleBanner.jsx
//
// The desktop app's one stale-data banner. A leaf rendered by DesktopBridgeSync, so only the
// desktop app ever mounts it, and its state cannot reach Layout.
//
// The shell's plan names net.isOnline() and powerMonitor 'resume', and today's bridge carries
// neither. navigator.onLine is the renderer's own read of the same OS state, and the shell does
// not throttle its main window, so a long gap between two ticks is the machine having slept.
import { useEffect, useState } from 'react'
import styles from './DesktopStaleBanner.module.css'

export const TICK_MS = 5000
export const RESUME_GAP_MS = 60000
export const CATCH_UP_MS = 20000

const MESSAGES = {
  offline: 'You are offline. Prices and charts on screen are not updating.',
  catchingUp: 'Reconnecting. Data on screen may be a moment behind.',
}

const isOffline = () => navigator.onLine === false

export default function DesktopStaleBanner() {
  const [kind, setKind] = useState(() => (isOffline() ? 'offline' : null))

  useEffect(() => {
    let hideTimer = null
    const clearHide = () => {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = null
    }
    const goOffline = () => {
      clearHide()
      setKind('offline')
    }
    const catchUp = () => {
      clearHide()
      setKind('catchingUp')
      hideTimer = setTimeout(() => {
        hideTimer = null
        setKind(null)
      }, CATCH_UP_MS)
    }

    let last = Date.now()
    const tick = setInterval(() => {
      const now = Date.now()
      const gap = now - last
      last = now
      if (gap > RESUME_GAP_MS && !isOffline()) catchUp()
    }, TICK_MS)

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', catchUp)
    return () => {
      clearInterval(tick)
      clearHide()
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', catchUp)
    }
  }, [])

  if (!kind) return null
  return <div className={styles.banner} role="status">{MESSAGES[kind]}</div>
}
