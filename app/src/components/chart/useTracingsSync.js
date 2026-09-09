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

/** Does a server tracings document actually carry anything?
 *
 *  ⛔ AN EMPTY DOCUMENT IS NOT CONTENT. Treating `{}` or `{sheets: []}` as
 *  content would make the heal fire on every load for a user who has never drawn
 *  anything, re-importing nothing forever. Shape-tolerant on purpose: it reads
 *  whatever array-ish members the export carries rather than pinning one key,
 *  so a change to the export shape degrades to "no heal" instead of a crash.
 */
export function hasTracingContent(doc) {
  if (!doc || typeof doc !== 'object') return false
  for (const v of Object.values(doc)) {
    if (Array.isArray(v) && v.length > 0) return true
    if (v && typeof v === 'object' && Object.keys(v).length > 0) return true
  }
  return false
}

export default function useTracingsSync() {
  const { prefs, setPref, loading } = usePreferences()
  const hydratedRef = useRef(false)
  const pushTimerRef = useRef(null)
  const lastPushedRef = useRef(0)
  const lastAttemptedRef = useRef(0)   // newest stamp handed to the server, confirmed or not
  const dirtyRef = useRef(false)       // an unconfirmed push is still owed to the server

  const flushPush = useCallback(async () => {
    if (pushTimerRef.current) { clearTimeout(pushTimerRef.current); pushTimerRef.current = null }
    // Monotonic timestamp: never emit one <= the last we pushed (clock-skew guard),
    // so our own writes always read as newer than what we last put on the server.
    // Strictly monotonic across ATTEMPTS, not just confirmed pushes: a failed
    // push does not advance `lastPushedRef`, so keying off that alone would let
    // two attempts share a stamp and make "is this the newest attempt?" — the
    // question the dirty flag turns on — unanswerable.
    const updatedAt = Math.max(Date.now(), lastPushedRef.current + 1, lastAttemptedRef.current + 1)
    lastAttemptedRef.current = updatedAt
    const ok = await setPref(PREF_KEY, { updatedAt, doc: drawingsStore.exportTracings() })
    // ⛔ MOB-09 — THE HIGHWATERMARK MOVES ONLY ON A CONFIRMED WRITE, AND THE
    // TWO FAILURE DIRECTIONS ARE NOT SYMMETRIC.
    //
    // This used to run `writeHW(updatedAt)` BEFORE an unawaited `setPref`. The
    // highwatermark is a claim about what the SERVER has seen, and it was being
    // advanced on the strength of a request nobody checked. Any failed push --
    // offline, a 5xx, a tab closed mid-flight -- left the browser asserting it
    // had already seen version T while the server still held T-1. The adopt gate
    // is a strict `server.updatedAt > hw`, so from that moment the device could
    // NEVER adopt: the server holds drawings and this browser will not take them.
    // Observed live before the fix (server: two SPY drawings, device: none).
    //
    // Failing to advance costs one redundant adopt on the next load. Advancing
    // wrongly costs the user their drawings, silently and permanently. So the
    // write is awaited and the mark only moves on `true`.
    // ⛔ A STALE ACKNOWLEDGEMENT MUST NOT REGRESS NEWER STATE. Two pushes can be
    // in flight (a slow one, then a debounced newer one), and they can confirm
    // out of order. Advancing on any `ok` would let the OLDER response walk the
    // mark backwards from 101 to 100 and re-open the adopt gate against a
    // document the server has already superseded. The mark therefore only ever
    // moves FORWARD, and only for the push that actually carries the newest
    // stamp this hook has emitted.
    if (ok) {
      if (updatedAt > lastPushedRef.current) {
        lastPushedRef.current = updatedAt
        writeHW(updatedAt)
      }
      // Only the NEWEST attempt may declare us clean. An older push confirming
      // late says nothing about the newer one that is still unacknowledged.
      if (updatedAt === lastAttemptedRef.current) dirtyRef.current = false
    } else if (updatedAt === lastAttemptedRef.current) {
      // ⭐ EXPLICITLY DIRTY, NOT MERELY "not advanced". The document is still
      // owed to the server, and saying so is what makes the retry legitimate
      // rather than accidental. Nothing is scheduled here on purpose — retry
      // rides triggers that already exist (the next store change, the unmount
      // flush, the next mount's hydrate), so a server that stays down produces
      // one attempt per real event and never a timer storm.
      dirtyRef.current = true
    }
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
    const serverUsable = !!(server && server.doc && typeof server.updatedAt === 'number')
    // ⛔ AND THE REPAIR SHIPS WITH THE ORDERING FIX, because the ordering fix
    // alone helps only browsers that have not already gone wrong. A device whose
    // highwatermark was advanced by the old code is pinned FOREVER by the strict
    // `>` gate -- it is exactly the population that needs healing.
    //
    // The second clause is the heal: the server holds tracings and we hold NONE.
    // There is no interpretation of that state in which refusing to adopt is
    // right, and no local content to lose by adopting. It is deliberately NOT a
    // general "server wins" -- a device with its own content still obeys the
    // highwatermark, so this cannot resurrect a document the user deleted here.
    const serverHasContentWeLack =
      serverUsable && !drawingsStore.hasLocalTracingContent() && hasTracingContent(server.doc)
    if (serverUsable && (server.updatedAt > hw || serverHasContentWeLack)) {
      drawingsStore.importTracings(server.doc)         // adopt the newer cloud copy
      // Never move the mark BACKWARDS while healing: a stale server copy must not
      // re-open the adopt gate on every load.
      writeHW(Math.max(server.updatedAt, hw))
      lastPushedRef.current = Math.max(server.updatedAt, hw)
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
      // Don't drop a debounced push on navigate-away — and take ONE more run at
      // a push the server never confirmed. Bounded by construction: unmount
      // happens once per mount, so a server that stays down costs one attempt
      // per visit, never a retry loop.
      if (pushTimerRef.current || dirtyRef.current) flushPush()
    }
  }, [schedulePush, flushPush])

  return null
}
