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
//
// ⭐⭐ HELD INPUTS, TWO KINDS, ONE RULE (coordinator ruling 2026-11-19, Q-FRED-NHDOT): a row graded with a LOCAL supply
// record (`ourSide.recordedSupplyFileOf`: the held directory, never tests/fixtures/vendor-supply) records it too,
// `supply/<captureId>@<sha256 of the record's bytes>` (`supplyHeld`), and a run without that record skips the row by
// name ("supply-held: …") exactly as it skips a store-held one.
import { it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { importPathsOf, pineLibraryEntry } from '../../ast/pineLibraryStore.js'
import { recordedSupplyFileOf, supplyHeldDir } from './ourSide.js'
import { builtinStudyOf, builtinPins, heldBuiltinSourceOf } from './builtinSource.js'

const SUPPLY_PIN = /^supply\/([a-z0-9][a-z0-9.!-]*)@([0-9a-f]{64})$/
// ⭐⭐ e95 (unit 2, ruling F1) — the THIRD held kind: a hand-added built-in graded on its published source
// (`builtinSource.js`), `source/<STD id>@<sha256>` (`sourceHeld`), named "source-held" where it is not held.
const SOURCE_PIN = /^source\/(STD;[A-Za-z0-9_%;.!-]+)@([0-9a-f]{64})$/
const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** `[source/<id>@sha256]` for a hand-added built-in the population pins (held here or not), else []. */
export function sourceHeldOf(capture) {
  const id = builtinStudyOf(capture)
  const pin = id ? builtinPins().get(id) : null
  return pin ? [`source/${id}@${pin}`] : []
}

/** `[supply/<id>@sha256]` when this capture's recorded supply is a HELD record, else []. */
export function supplyHeldOf(captureId) {
  const at = recordedSupplyFileOf(captureId)
  return at && at.held ? [`supply/${captureId}@${sha256Of(at.file)}`] : []
}

/** `[{captureId, sha256}]` of every held record this run can read (a committed record of the same id shadows it). */
export function supplyHeldStorePins() {
  const dir = supplyHeldDir()
  let names = []
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() } catch { return [] }
  return names.map((f) => f.slice(0, -5)).filter((id) => {
    const at = recordedSupplyFileOf(id)
    return at && at.held
  }).map((id) => ({ captureId: id, sha256: sha256Of(path.join(dir, `${id}.json`)) }))
}

/** Is every pin (library `path@sha` or supply `supply/<id>@sha`) held here at exactly that sha? */
export function heldHolds(pins) {
  return (pins || []).every((pin) => {
    const src = SOURCE_PIN.exec(String(pin))
    if (src) {
      const held = heldBuiltinSourceOf({ study: { id: `Script$${src[1]}@tv-scripting` }, source: { text: '' } })
      return !!held && typeof held.text === 'string' && held.sha256 === src[2]
    }
    const s = SUPPLY_PIN.exec(String(pin))
    if (!s) return storeHolds([pin])
    const at = recordedSupplyFileOf(s[1])
    return !!at && at.held && sha256Of(at.file) === s[2]
  })
}

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
  if (!pins || !pins.length || heldHolds(pins)) return it(name, fn, timeout)
  return it.skip(`${name} [${heldReading(pins)}]`, fn, timeout)
}

/** The name of a held row, as `store_held.reading` spells it: "store-held: …", "supply-held: …", or both. */
export function heldReading(pins) {
  const supply = (pins || []).filter((p) => SUPPLY_PIN.test(String(p)))
  const source = (pins || []).filter((p) => SOURCE_PIN.test(String(p)))
  const store = (pins || []).filter((p) => !SUPPLY_PIN.test(String(p)) && !SOURCE_PIN.test(String(p)))
  return [store.length ? `store-held: ${store.join(', ')}` : null, supply.length ? `supply-held: ${supply.join(', ')}` : null,
    source.length ? `source-held: ${source.join(', ')}` : null]
    .filter(Boolean).join('; ')
}

/** A row's held pins, both kinds, as `store_held.pins_of` reads them. */
export function heldPinsOf(row) {
  return [...(Array.isArray(row && row.storeHeld) ? row.storeHeld : []),
    ...(Array.isArray(row && row.supplyHeld) ? row.supplyHeld : []),
    ...(Array.isArray(row && row.sourceHeld) ? row.sourceHeld : [])].sort()
}
