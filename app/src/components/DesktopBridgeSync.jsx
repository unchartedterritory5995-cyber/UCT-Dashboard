// app/src/components/DesktopBridgeSync.jsx
//
// A leaf, null-rendering but for the shell's stale-data banner, mounted at the app root beside <LogoPrewarm /> and only inside the desktop
// app (App.jsx checks isDesktopApp, so a browser never fetches this chunk). The desktop shell's
// messages are handled here rather than in Layout: this file holds its own effects and reads no
// shared context, because a shared render loop froze navigation app-wide for 4.5 hours in September.
import { useEffect } from 'react'
import DesktopStaleBanner from './DesktopStaleBanner'
import { ackBeforeQuit, onBeforeQuit } from '../lib/desktopBridge'
import { clearAppClosing, markAppClosing } from '../lib/appClosing'

// A real quit closes well within this (the shell waits at most 500 ms for the ack).
export const QUIT_STILL_ALIVE_MS = 10000

export default function DesktopBridgeSync() {
  // A quit must not dock boards: the windows closing are part of it, and docking would delete the
  // record the next launch restores from. Marked BEFORE the ack, which is what lets the shell close.
  useEffect(() => {
    let stillAlive = null
    const off = onBeforeQuit(() => {
      markAppClosing()
      ackBeforeQuit()
      if (stillAlive) clearTimeout(stillAlive)
      stillAlive = setTimeout(clearAppClosing, QUIT_STILL_ALIVE_MS)
    })
    return () => {
      off()
      if (stillAlive) clearTimeout(stillAlive)
    }
  }, [])

  return <DesktopStaleBanner />
}
