// app/src/components/chart/engine/__tests__/vendorHarness/harness.js
//
// ─── THE HARNESS, END TO END: files → captures → our side → verdicts ─────────
//
// Walks a directory of captures, adapts the legacy formats it can, validates
// every capture (shape + receipt + source sha), runs the member door on the
// vendor's bars, and grades the result. Returns the machine-readable verdicts
// AND the inventory of every file it saw and could not compare, with the
// reason — a file silently skipped is a file that reads as "passed".

import fs from 'node:fs'
import path from 'node:path'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { compareCapture, renderSummary } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { detectFormat, fromObservation, fromProbeRows } from '../../../../../../../tools/vendor_harness/adapters.mjs'
import { runOurSide } from './ourSide'

export const REPO = path.resolve(process.cwd(), '..')
export const VENDOR_DIR = path.join(REPO, 'tests/fixtures/vendor')
export const HARNESS_DIR = path.join(VENDOR_DIR, 'harness')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out.sort()
}

/** One file → a v1 capture, or the reason it is not one. */
export function loadCapture(file) {
  const rel = path.relative(REPO, file).replace(/\\/g, '/')
  let json
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return { file: rel, format: 'unreadable', reason: `not JSON: ${err.message}` }
  }
  const { format, reason } = detectFormat(json, path.basename(file))
  if (format === 'harness-v1') return { file: rel, format, capture: json }
  if (format === 'observation') return { file: rel, format, capture: fromObservation(json, { path: rel }) }
  if (format === 'probe-rows') {
    const cap = fromProbeRows(json, {
      basename: path.basename(file),
      readProbe: (p) => fs.readFileSync(path.join(REPO, p), 'utf8'),
    })
    if (cap.refused) return { file: rel, format, reason: cap.refused }
    return { file: rel, format, capture: cap }
  }
  return { file: rel, format, reason }
}

/** Grade one capture object. */
export function gradeCapture(capture) {
  const integrity = validateCapture(capture)
  // ⛔ AN INVALID CAPTURE IS NEVER RUN. Running our side on bars whose receipt
  // failed would grade our engine against numbers nobody can vouch for.
  const ours = integrity.ok ? runOurSide(capture) : null
  const verdict = compareCapture(capture, ours, { integrity })
  return { verdict, ours, integrity }
}

/**
 * @param {string[]} dirs
 * @returns {{results: object[], inventory: object[], table: string}}
 */
export function runHarness(dirs = [VENDOR_DIR]) {
  const files = [...new Set(dirs.flatMap((d) => walk(d)))]
  const results = []
  const inventory = []
  for (const f of files) {
    const loaded = loadCapture(f)
    if (!loaded.capture) {
      inventory.push({ file: loaded.file, format: loaded.format, reason: loaded.reason })
      continue
    }
    const { verdict, ours } = gradeCapture(loaded.capture)
    results.push({ file: loaded.file, format: loaded.format, ...verdict, ourNotes: ours ? ours.notes : [] })
  }
  return { results, inventory, table: renderSummary(results), files: files.length }
}
