// app/src/data/deviceStore/residue.js — what the device store leaves in a browser, and removing it when the store is
// off there (review of #2537, M9: "nothing ever deletes the packs").
//
// ⭐ THE CHEAP CHECK. Most browsers never ran the store, and they must pay nothing for this: no import, no timer, no
// OPFS call. So a page whose store is off reads TWO localStorage keys, once (source.deviceSource, when the BarStore is
// created), and does nothing more unless they say files may be here:
//   'uct.deviceStore.files'  '1'  the store ran here (client.start writes it: its worker may have written files)
//                            '0'  removed (or nothing could be here): never looked at again
//                            none never ran here... unless a switch key is stored ('uct.deviceStore' set to anything):
//                                 a tester who ran it before this marker existed. Looked at once, then '0'.
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
/** switch.js DEVICE_STORE_KEY (not imported: tests mock switch.js); source.offCleanup.test.js pins the literal. */
const SWITCH_KEY = 'uct.deviceStore'

/** May device-store files exist in this browser? The cheap check: at most two localStorage reads. Never throws. */
export function deviceFilesMayExist() {
  try {
    const m = localStorage.getItem(DEVICE_FILES_KEY)
    if (m !== null) return m === '1'
    return localStorage.getItem(SWITCH_KEY) !== null
  } catch { return false }
}

/** The store is starting in this browser: its files may exist from now on. One write, only the first time. */
export function noteDeviceFiles() {
  try { if (localStorage.getItem(DEVICE_FILES_KEY) !== '1') localStorage.setItem(DEVICE_FILES_KEY, '1') } catch { /* storage blocked */ }
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
