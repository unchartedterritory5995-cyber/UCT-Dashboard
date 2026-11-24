// app/src/data/deviceStore/residue.js — what the device store leaves in a browser, and removing it when the store is
// off there (review of #2537, M9: "nothing ever deletes the packs").
//
// ⭐ WHEN (review of #2563): source.deviceSource decides from WHY the store is off (switch.deviceStoreOffReason). Only
// the member's own '0' and the server's purge delete at once; off BY DEFAULT keeps the packs unless the store has not
// run here for DEVICE_FILES_STALE_MS; the kills and any other value keep them.
// ⭐ THE CHEAP CHECK. Most browsers never ran the store, and they must pay nothing for this: no import, no timer, no
// OPFS call. So a page whose store is off reads ONE more localStorage key (the marker; the switch already read its own),
// once (when the BarStore is created), and does nothing more unless it says files may be here:
//   'uct.deviceStore.files'  '1'  the store ran here (client.start writes it, and again on every generation committed
//                                 or held-seed status: an off tab's removal settling just after this tab started must
//                                 not leave it saying "nothing here", review of #2563 LOW-1)
//                            '0'  removed (or nothing could be here): never looked at again
//                            none never ran here... unless a switch key is stored (a tester who ran it before this
//                                 marker existed; the caller says so, from the switch's own read). Looked at once.
//   'uct.deviceStore.lastRun'  when the store last ran here (ms): the stale rule. No stamp: never stale. It NEVER moves
//                            backwards (a clock set back after running ahead leaves the newer stamp) by up to
//                            DEVICE_LAST_RUN_FUTURE_MAX_MS; a stamp further ahead of a run's clock is corrupt (a clock once
//                            set to 2099 would keep an abandoned seed "not stale" for ever: review of #2537 head
//                            107dea1ee1, P-3 a) and the run overwrites it. A page left on refreshes it on its 30-minute
//                            re-check and every committed generation (client.js). To the stale rule a stamp that far
//                            ahead is corrupt too (deviceFilesStale): stale-eligible, for a browser whose LAST run
//                            wrote it and that never runs the store again (review of #2537 head f16a87dd98, Q-1.4).
//   'uct.deviceStore.staleSince'  the first off-by-default load that saw the seed stale (ms). A stale seed goes only
//                            when a SECOND such load, at least DEVICE_FILES_STALE_CONFIRM_MS later, still sees it stale
//                            (review of #2563 round 2: the rule trusts the local clock, so one load under a clock that ran
//                            ahead is never enough); a load that sees it not stale, or the store running, clears it.
// ⭐ THE REMOVAL runs from the page with the async OPFS API (no worker, no client), at idle after the first chart
// paint, at most once per page load. A removal another tab blocks (its worker still holds the files open) keeps the
// marker, so the next page load tries again.
//
// ⛔ NO IMPORTS: io.js (the worker's file I/O) takes STORE_DIR from here, and the worker bundle must stay free of page
// code.

/** The store's OPFS directory (io.js opfsIO, and the removal here). */
export const STORE_DIR = 'uct-device-store'
/** '1' the store ran in this browser; '0' its files were removed (see the header). */
export const DEVICE_FILES_KEY = 'uct.deviceStore.files'
/** When the store last started in this browser (ms since the epoch, as a string). */
export const DEVICE_LAST_RUN_KEY = 'uct.deviceStore.lastRun'
/** Off by default, packs unused this long are deleted: 30 days. A narrow window or a metered connection for a while
 *  costs no download; a browser that left the store behind for good does not keep ~80 MB forever. */
export const DEVICE_FILES_STALE_MS = 30 * 86_400_000
/** A run stamp more than this far ahead of a run's own clock is corrupt, and the run overwrites it: 7 days. */
export const DEVICE_LAST_RUN_FUTURE_MAX_MS = 7 * 86_400_000
/** The first stale off-by-default load (ms), see the header. */
export const DEVICE_STALE_SINCE_KEY = 'uct.deviceStore.staleSince'
/** ...and how long a second stale load must come after it: 24 h. */
export const DEVICE_FILES_STALE_CONFIRM_MS = 86_400_000

/** May device-store files exist in this browser? ONE localStorage read (the marker); `switchKeyStored` (the switch's
 *  own read: some value is stored) stands in for a marker written before this one existed. Never throws. */
export function deviceFilesMayExist(switchKeyStored = false) {
  try {
    const m = localStorage.getItem(DEVICE_FILES_KEY)
    if (m !== null) return m === '1'
    return switchKeyStored === true
  } catch { return false }
}

/** Has the store not started here for DEVICE_FILES_STALE_MS? No stamp or an unreadable one: NOT stale (keep). A stamp
 *  from the future up to DEVICE_LAST_RUN_FUTURE_MAX_MS ahead (a clock set back after a run): NOT stale. A stamp further
 *  ahead is corrupt, as it is to a run (noteDeviceFiles), and stale-ELIGIBLE: a browser whose LAST run wrote one (its
 *  clock far ahead then) has no later run to overwrite it, and kept its seed until real time passed the stamp (review of
 *  #2537 head f16a87dd98, Q-1.4). deviceFilesStaleConfirmed still wants two such loads 24 h apart. Never throws. */
export function deviceFilesStale(nowMs) {
  try {
    const t = Number(localStorage.getItem(DEVICE_LAST_RUN_KEY))
    if (!Number.isFinite(t) || t <= 0) return false
    if (t > nowMs) return t - nowMs > DEVICE_LAST_RUN_FUTURE_MAX_MS
    return nowMs - t >= DEVICE_FILES_STALE_MS
  } catch { return false }
}

/** Is a stale deletion due on this off-by-default load? Stale now (deviceFilesStale) AND an earlier load already saw it
 *  stale at least DEVICE_FILES_STALE_CONFIRM_MS ago; the first stale load only records itself, and a load that sees it
 *  not stale forgets the record. A record from the future (a clock set back) restarts it. Never throws. */
export function deviceFilesStaleConfirmed(nowMs) {
  try {
    if (!deviceFilesStale(nowMs)) {
      if (localStorage.getItem(DEVICE_STALE_SINCE_KEY) !== null) localStorage.removeItem(DEVICE_STALE_SINCE_KEY)
      return false
    }
    const since = Number(localStorage.getItem(DEVICE_STALE_SINCE_KEY))
    if (!Number.isFinite(since) || since <= 0 || since > nowMs) {
      localStorage.setItem(DEVICE_STALE_SINCE_KEY, String(nowMs))
      return false
    }
    return nowMs - since >= DEVICE_FILES_STALE_CONFIRM_MS
  } catch { return false }
}

/** The store runs in this browser: its files may exist. The marker is (re)written when it does not say so; `nowMs`
 *  (the store running: started, a re-check, a generation) also stamps the run, NEVER backwards (unless the stamp is more
 *  than DEVICE_LAST_RUN_FUTURE_MAX_MS ahead: corrupt, overwritten), and forgets any stale record. Never throws. */
export function noteDeviceFiles(nowMs) {
  try { if (localStorage.getItem(DEVICE_FILES_KEY) !== '1') localStorage.setItem(DEVICE_FILES_KEY, '1') } catch { /* storage blocked */ }
  if (!Number.isFinite(nowMs)) return
  try {
    const had = Number(localStorage.getItem(DEVICE_LAST_RUN_KEY))
    const newer = Number.isFinite(had) && had > nowMs && had - nowMs <= DEVICE_LAST_RUN_FUTURE_MAX_MS
    if (!newer) localStorage.setItem(DEVICE_LAST_RUN_KEY, String(nowMs))
    if (localStorage.getItem(DEVICE_STALE_SINCE_KEY) !== null) localStorage.removeItem(DEVICE_STALE_SINCE_KEY)
  } catch { /* storage blocked */ }
}

/** Remove the store's directory (every pack, partial, marker and record). Resolves 'removed' | 'none' | 'failed';
 *  never rejects. 'failed' keeps the marker (the next page load tries again). */
export async function removeDeviceFiles(storage) {
  let out = 'failed'
  try {
    if (!storage || typeof storage.getDirectory !== 'function') out = 'none'
    else {
      const root = await storage.getDirectory()
      try { await root.removeEntry(STORE_DIR, { recursive: true }); out = 'removed' } catch (e) {
        if (e?.name !== 'NotFoundError') throw e
        out = 'none'
      }
    }
  } catch { return 'failed' }
  try { localStorage.setItem(DEVICE_FILES_KEY, '0') } catch { /* storage blocked */ }
  return out
}

/** requestIdleCallback with a deadline (8 s), or 3 s (the client's own idle). */
export function whenIdle(fn) {
  try { if (typeof requestIdleCallback === 'function') { requestIdleCallback(() => fn(), { timeout: 8000 }); return } } catch { /* fall through */ }
  setTimeout(fn, 3000)
}
