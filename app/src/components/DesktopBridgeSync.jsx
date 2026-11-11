// app/src/components/DesktopBridgeSync.jsx
//
// A leaf, null-rendering but for the shell's stale-data banner, mounted at the app root beside <LogoPrewarm /> and only inside the desktop
// app (App.jsx checks isDesktopApp, so a browser never fetches this chunk). The desktop shell's
// messages are handled here rather than in Layout: this file holds its own effects and reads no
// shared context, because a shared render loop froze navigation app-wide for 4.5 hours in September.
import { useEffect, useSyncExternalStore } from 'react'
import DesktopStaleBanner from './DesktopStaleBanner'
import DesktopDeskToast from './DesktopDeskToast'
import { ackBeforeQuit, hasDesktopFeature, onBeforeQuit, onDeskVisibility, reportDesktopEvent } from '../lib/desktopBridge'
import { setDeskHidden } from '../lib/deskVisibility'
import { clearAppClosing, markAppClosing } from '../lib/appClosing'
import { requestDeskLaunch, withdrawDeskLaunch } from '../lib/popoutRegistry'
import { onPrefsUserChange, prefsUser } from '../lib/prefsSession'
import { isTerminalPopoutChild } from '../lib/reloadGuard'
import { hasDeskRecords } from '../pages/charts/popout/deskStore'

// A real quit closes well within this, and a Leave or Stay dialog over unsaved text is what can
// hold one open. Clearing inside that wait would dock boards a Leave is about to carry through.
export const QUIT_STILL_ALIVE_MS = 60000

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

  // Idle mode: while every app window is hidden or minimized, SWR stops polling (its isVisible reads
  // lib/deskVisibility). Unmounting clears it, so a shell that goes away never leaves polls paused.
  useEffect(() => {
    const off = onDeskVisibility((state) => setDeskHidden(state === 'hidden'))
    return () => {
      off()
      setDeskHidden(false)
    }
  }, [])

  // The desk comes back at launch whatever page the app opens on: tell ChartsDeskHost to hold the
  // workspace mounted so it can re-pop the windows. Only for the main window, which owns the desk.
  const uid = useSyncExternalStore(onPrefsUserChange, prefsUser, prefsUser) ?? null
  useEffect(() => {
    if (!uid) {
      withdrawDeskLaunch()
      return
    }
    if (!hasDesktopFeature('before-quit') || window.opener || isTerminalPopoutChild()) return
    if (hasDeskRecords(uid)) requestDeskLaunch()
  }, [uid])

  // Telemetry: a member is signed in in the main window. The shell sends first_signin once per
  // install, so repeating this on every launch costs nothing.
  useEffect(() => {
    if (!uid || window.opener || isTerminalPopoutChild()) return
    reportDesktopEvent('signed_in')
  }, [uid])

  return (
    <>
      <DesktopStaleBanner />
      <DesktopDeskToast />
    </>
  )
}
