// app/src/components/chart/engine/__tests__/vendorHarness/storeHeld.js
//
// ⭐ STORE-HELD ROWS (libraries chain, coordinator ruling 2026-11-19). A grade taken with a library store
// loaded (`PINE_LIBRARY_STORE`) depends on that store's code. Each row graded with the store therefore
// records WHICH versions it needed, as `<Author>/<Library>/<N>@<sha256>` (`storeHeld`). A run without the
// store (CI: library code is never committed) skips exactly those rows, by name, and no others: such a
// row is "store-held", never lost, never MATCH, never DIVERGE. The Python side is
// `tools/vendor_harness/store_held.py`; both read the same pin spelling.
//
// ⛔ The pins come from the registry the run LINKED from (`pineLibraryEntry`), so each sha is the code that
// was graded, never a re-read of a store on disk.
import { it } from 'vitest'
import { importPathsOf, pineLibraryEntry } from '../../ast/pineLibraryStore.js'

/** `path@sha256` for every registered version `source` reaches through its import lines (closed over what
 *  those versions import), sorted; [] when it imports nothing the registry holds. */
export function storeHeldOf(source) {
  const out = new Set()
  const queue = importPathsOf(source)
  const seen = new Set()
  while (queue.length) {
    const p = queue.shift()
    if (seen.has(p)) continue
    seen.add(p)
    const e = pineLibraryEntry(p)
    if (!e) continue
    out.add(`${p}@${e.sha256}`)
    queue.push(...importPathsOf(e.source))
  }
  return [...out].sort()
}

/** `[{path, sha256}]` of the loaded store (the paths the loader returned), sorted by path. */
export function libraryStorePins(paths) {
  return [...paths].sort().map((p) => ({ path: p, sha256: (pineLibraryEntry(p) || {}).sha256 || null }))
}

/** Are all of `pins` (`path@sha`) registered at exactly that sha in this process? */
export function storeHolds(pins) {
  return (pins || []).every((pin) => {
    const at = String(pin).lastIndexOf('@')
    const e = at > 0 ? pineLibraryEntry(String(pin).slice(0, at)) : null
    return !!e && e.sha256 === String(pin).slice(at + 1)
  })
}

/** `it` when the store this row was graded with is loaded here; otherwise SKIPPED BY NAME, saying which
 *  versions it needs ("store-held: …"), exactly as `itNeedsHeld` skips a licence-held capture. */
export function itNeedsStore(pins, name, fn, timeout) {
  if (!pins || !pins.length || storeHolds(pins)) return it(name, fn, timeout)
  return it.skip(`${name} [store-held: ${pins.join(', ')}]`, fn, timeout)
}
