// app/src/components/chart/engine/__tests__/vendorHarness/builtinSource.js
//
// ─── ⭐⭐ e95 (unit 2) — A BUILT-IN TRADINGVIEW STUDY IS GRADED ON ITS PUBLISHED SOURCE, HELD LOCALLY ──────────────
//
// A built-in captured by hand (added from TradingView's Indicators dialog, `study.id` = `Script$STD;<id>@tv-scripting`)
// has no Pine in its capture: `source.text` is the batch label ("TradingView built-in STD;VWAP added from the Indicators
// dialog ... not Pine"), so our member door was handed English and refused it (`pine:character`) before reading
// anything the study computes. The study's code is TradingView's published source, which the full census already
// fetched and pinned (`docs/pine/census-full/population.json`: the `builtin` row whose `scriptIdPart` is that id, and its
// sha256).
//
// COORDINATOR RULING (2026-11-22, F1): our side of such a capture is the published source, read from a LOCAL store
// (`%LOCALAPPDATA%/uct-vendor-batch/builtin-sources/<id>.pine`, or `UCT_HARNESS_BUILTIN_SOURCES`), and only at the
// population's sha256. It is NEVER committed (it is TradingView's code). A row graded on it is stamped `sourceHeld`
// (`source/<id>@<sha256>`, `storeHeld.js`), and a run without the store names it "source-held", never MATCH or DIVERGE
// (`tools/vendor_harness/store_held.py`). The capture itself is never edited: its receipt still validates the bytes the
// rig recorded; only the script OUR side runs is the held one.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BUILTIN_SOURCE_ENV = 'UCT_HARNESS_BUILTIN_SOURCES'
const STUDY_RX = /^Script\$(STD;[A-Za-z0-9_%;.!-]+)@tv-scripting/
const POPULATION = path.resolve(process.cwd(), '..', 'docs', 'pine', 'census-full', 'population.json')

/** The local store of built-in sources, read per call. */
export function builtinSourceDir() {
  if (process.env[BUILTIN_SOURCE_ENV]) return path.resolve(process.env[BUILTIN_SOURCE_ENV])
  const base = process.env.LOCALAPPDATA || process.env.TEMP || os.tmpdir()
  return path.join(base, 'uct-vendor-batch', 'builtin-sources')
}

let pinsMemo = null
/** ⛔ TEST SEAM — rails pin a test id to a test text's sha256 (TradingView's code is never committed); null restores. */
export function __setBuiltinPinsForTests(map) { pinsMemo = map ? new Map(Object.entries(map)) : null }
/** `scriptIdPart` → sha256 for every built-in row of the full census population (the one authority on its bytes). */
export function builtinPins() {
  if (pinsMemo) return pinsMemo
  pinsMemo = new Map()
  let doc = null
  try { doc = JSON.parse(fs.readFileSync(POPULATION, 'utf8')) } catch { return pinsMemo }
  const rows = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.rows) ? doc.rows : [])
  for (const r of rows) {
    if (r && typeof r.scriptIdPart === 'string' && /^STD;/.test(r.scriptIdPart) && /^[0-9a-f]{64}$/.test(String(r.sha256))) {
      pinsMemo.set(r.scriptIdPart, String(r.sha256))
    }
  }
  return pinsMemo
}

/** Is this capture's `source.text` a script at all (a version line, or a declaration call)? */
const isPine = (text) => typeof text === 'string' && /(^|\n)\s*\/\/\s*@version\s*=|(^|\n)\s*(indicator|study|strategy)\s*\(/.test(text)

/** The built-in id (`STD;VWAP`) of a hand-added built-in whose capture holds no Pine, else null. */
export function builtinStudyOf(capture) {
  const id = capture && capture.study && typeof capture.study.id === 'string' ? (STUDY_RX.exec(capture.study.id) || [])[1] : null
  if (!id) return null
  const text = capture.source && capture.source.text
  return isPine(text) ? null : id
}

/** For a hand-added built-in: `{id, sha256, text}` (the held published source at the population's pin), or `{id,
 *  sha256, why}` when it is not held here (no pin, no file, or other bytes). Null for every other capture. */
export function heldBuiltinSourceOf(capture) {
  const id = builtinStudyOf(capture)
  if (!id) return null
  const sha256 = builtinPins().get(id) || null
  if (!sha256) return { id, sha256: null, why: `the census population pins no source for ${id}` }
  const file = path.join(builtinSourceDir(), `${id}.pine`)
  let bytes = null
  try { bytes = fs.readFileSync(file) } catch { return { id, sha256, why: `no held source at ${id}.pine` } }
  const got = crypto.createHash('sha256').update(bytes).digest('hex')
  if (got !== sha256) return { id, sha256, why: `the held ${id}.pine is not the pinned source (sha256 ${got.slice(0, 12)})` }
  return { id, sha256, text: bytes.toString('utf8') }
}

/** `[{id, sha256}]` of every held built-in source this run can read at its pin (the run document's `sourceHeldStore`). */
export function builtinSourceStorePins() {
  let names = []
  try { names = fs.readdirSync(builtinSourceDir()).filter((f) => f.endsWith('.pine')).sort() } catch { return [] }
  const out = []
  for (const f of names) {
    const id = f.slice(0, -5)
    const pin = builtinPins().get(id)
    if (!pin) continue
    const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(builtinSourceDir(), f))).digest('hex')
    if (got === pin) out.push({ id, sha256: pin })
  }
  return out
}
