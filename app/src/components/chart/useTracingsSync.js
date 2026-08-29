// app/src/components/chart/useTracingsSync.js — cross-device sync for Tracings.
//
// Mount ONCE on the charts surface. Bridges the (synchronous, localStorage-backed)
// drawingsStore tracings layer to the server via the existing preferences store, so
// a user's sheets follow them across devices. Newer-wins at the whole-document
// level (a highwatermark of the last server updatedAt this browser has seen):
//
//  • Hydrate: on first load, if the server copy is newer than our highwatermark we
//    ADOPT it (importTracings); otherwise our local copy is source of truth and we
//    push it up.
//  • Push: any store change schedules a debounced push of the full export blob,
//    stamped with a monotonic updatedAt; a pending push is FLUSHED on unmount so a
//    drawing made right before navigating away is never dropped.
//
// LWW caveat (documented, Phase-3 to refine): a device with unsynced local drawings
// adopts the cloud copy on its first sync, and two devices editing at once keep the
// later writer's whole document. This is add/replace-consistent, not a field-merge.
import { useEffect, useRef, useCallback } from 'react'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import * as drawingsStore from './drawingsStore'

const PREF_KEY = 'tracings_doc'
const HW_KEY = 'uct-tracings-sync-hw'        // localStorage: last server updatedAt this browser has seen
const PUSH_DEBOUNCE_MS = 1500

function readHW() {
  try { return Number(localStorage.getItem(HW_KEY)) || 0 } catch { return 0 }
}
function writeHW(ts) {
  try { localStorage.setItem(HW_KEY, String(ts)) } catch { /* quota — sync still works in-session */ }
}

export default function useTracingsSync() {
  const { prefs, setPref, loading } = usePreferences()
  const hydratedRef = useRef(false)
  const pushTimerRef = useRef(null)
  const lastPushedRef = useRef(0)

  const flushPush = useCallback(() => {
    if (pushTimerRef.current) { clearTimeout(pushTimerRef.current); pushTimerRef.current = null }
    // Monotonic timestamp: never emit one <= the last we pushed (clock-skew guard),
    // so our own writes always read as newer than what we last put on the server.
    const updatedAt = Math.max(Date.now(), lastPushedRef.current + 1)
    lastPushedRef.current = updatedAt
    writeHW(updatedAt)
    setPref(PREF_KEY, { updatedAt, doc: drawingsStore.exportTracings() })
  }, [setPref])

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(flushPush, PUSH_DEBOUNCE_MS)
  }, [flushPush])

  // Hydrate from the server exactly once, newer-wins.
  useEffect(() => {
    if (loading || hydratedRef.current) return
    hydratedRef.current = true
    const server = parsePref(prefs[PREF_KEY], null)   // { updatedAt, doc } | null
    const hw = readHW()
    if (server && server.doc && typeof server.updatedAt === 'number' && server.updatedAt > hw) {
      drawingsStore.importTracings(server.doc)         // adopt the newer cloud copy
      writeHW(server.updatedAt)
      lastPushedRef.current = server.updatedAt
      return
    }
    // Our copy is source of truth (no server copy, or ours is not older) — share it.
    if (drawingsStore.hasLocalTracingContent()) schedulePush()
  }, [loading, prefs, schedulePush])

  // Push on any local change (debounced), and flush a pending push on unmount.
  useEffect(() => {
    const unsub = drawingsStore.subscribeAnyChange(() => {
      if (hydratedRef.current) schedulePush()          // don't push before reconciling with the server
    })
    return () => {
      unsub()
      if (pushTimerRef.current) flushPush()             // don't drop a debounced push on navigate-away
    }
  }, [schedulePush, flushPush])

  return null
}
