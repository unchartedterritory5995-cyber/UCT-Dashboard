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
import { compareCapture, renderSummary, compareObjectsV2, MATCH_SUBSTITUTED } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { detectFormat, fromObservation, fromProbeRows } from '../../../../../../../tools/vendor_harness/adapters.mjs'
import { runOurSide } from './ourSide'
import { supplyAttributionOf, otherSymbolUnsettledOf, supplyBehindOf } from './supplyAttribution'
import { pairObjects } from './objectColours'
import { pairRecords, attachXSidecar } from './objectRecords'
import { gradePaints } from './paintColours'
// ⭐⭐ (2026-11-17) — a strategy's trades are its output: graded on the run the member door made (`strategyLane.js`)
import { strategyRanView, strategyLaneGradeOf, foldStrategyGrade } from './strategyLane.js'

export const REPO = path.resolve(process.cwd(), '..')
export const VENDOR_DIR = path.join(REPO, 'tests/fixtures/vendor')
export const HARNESS_DIR = path.join(VENDOR_DIR, 'harness')

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  // a single capture file is its own list (a CLI run over named captures: `VENDOR_HARNESS_DIR=a.json;b.json`)
  if (fs.statSync(dir).isFile()) {
    if (dir.endsWith('.json')) out.push(dir)
    return out.sort()
  }
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
  if (format === 'harness-v1') {
    // ⭐ U13 — a capture taken before tv_capture.js recorded the x table may have an xmap
    // sidecar at `<run>/xmap/<id>.json` (capture session S10): attached BESIDE it
    // (`objectRecords.js::attachXSidecar`), never written into it.
    const side = json && json.id ? path.join(path.dirname(file), '..', 'xmap', `${json.id}.json`) : null
    if (side && fs.existsSync(side)) {
      let sidecar = null
      try { sidecar = JSON.parse(fs.readFileSync(side, 'utf8')) } catch { sidecar = { unreadable: true } }
      attachXSidecar(json, sidecar)
    }
    return { file: rel, format, capture: json }
  }
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

/** ⭐⭐ C44 — OBJECT COLOUR IS PART OF THE VERDICT, ON BY DEFAULT.
 *  An object family grades MATCH only when the colours of its paired objects
 *  agree too (`compare.mjs::objectColourRows` states the rule; § C44 of the
 *  triage doc has the numbers). The option exists so the verdict as it was
 *  before can be reproduced exactly — `gradeCapture(c, {objectColour: false})`,
 *  or `VENDOR_HARNESS_OBJECT_COLOUR=0` for a whole run — never to make a red
 *  capture green: every graded verdict also carries `verdictWithoutColour`, so
 *  the two numbers are read side by side from ONE run.
 *  Read at call time, so a test may stub the variable. */
export function objectColourGraded(opts = {}) {
  if (opts.objectColour !== undefined) return !!opts.objectColour
  return process.env.VENDOR_HARNESS_OBJECT_COLOUR !== '0'
}

/** ⭐⭐ B1 (step 61) — PAINTS ARE PART OF THE VERDICT, ON BY DEFAULT.
 *  A capture whose `bgcolor` / `barcolor` paints differ from TradingView's grades
 *  DIVERGE; one the door withholds BY NAME grades INCONCLUSIVE, as a plot does
 *  (G5 ruling 2026-11-15; `compare.mjs::comparePaints` states the rule). Same contract as `objectColourGraded`: `gradeCapture(c, {paints:
 *  false})`, or `VENDOR_HARNESS_PAINTS=0` for a whole run, reproduces the verdict
 *  as it was before; every graded verdict also carries `verdictWithoutPaints`,
 *  so both numbers are read side by side from ONE run.
 *  Read at call time, so a test may stub the variable. */
export function paintsGraded(opts = {}) {
  if (opts.paints !== undefined) return !!opts.paints
  return process.env.VENDOR_HARNESS_PAINTS !== '0'
}

/** Grade one capture object.
 *  @param {{objectColour?: boolean, paints?: boolean}} [opts] */
export function gradeCapture(original, opts = {}) {
  const integrity = validateCapture(original)
  // ⭐⭐ (2026-11-17) — a Strategy Tester capture is graded on the bars TradingView's strategy RAN
  // (`strategyLane.js::strategyRanView`): a newest bar it had not run is neither side's evidence. Validated
  // whole first (its receipt is over every bar); every other capture is graded exactly as it is.
  const { view: capture, unrun } = integrity.ok ? strategyRanView(original) : { view: original, unrun: null }
  // ⛔ AN INVALID CAPTURE IS NEVER RUN. Running our side on bars whose receipt
  // failed would grade our engine against numbers nobody can vouch for.
  const ours = integrity.ok ? runOurSide(capture) : null
  // The colour slots of every object PAIRED with the capture's own record — only
  // where the capture recorded objects and our object lane ran.
  const objectColours = objectColourGraded(opts) && capture.objects
    && ours && ours.ok && ours.objects && ours.objects.ok && Array.isArray(ours.objects.held)
    ? pairObjects(capture, ours.objects)
    : null
  const paints = paintsGraded(opts) && ours && ours.ok ? gradePaints(capture, ours) : null
  // SUPPLY-ATTRIBUTED (coordinator ruling on #1541): only where the supply symbol has a committed witness
  const supplyAttribution = integrity.ok && ours && ours.ok ? supplyAttributionOf(capture) : null
  const otherSymbolUnsettled = integrity.ok && ours && ours.ok ? otherSymbolUnsettledOf(capture) : null
  // SUPPLY BEHIND THE CAPTURE (coordinator ruling, 2026-11-18): a forming newest bar the recorded supply cannot answer
  const supplyBehind = integrity.ok && ours && ours.ok ? supplyBehindOf(capture) : null
  const indicator = compareCapture(capture, ours, { integrity, objectColours, paints, supplyAttribution, otherSymbolUnsettled, supplyBehind })
  // ⭐⭐ THE STRATEGY GRADE, FOLDED IN where the capture holds a Strategy Tester report or our door ran a
  // broker document (`strategyLane.js`, THE FOLD); null, and the verdict unchanged, everywhere else
  const strategy = integrity.ok ? strategyLaneGradeOf(capture, ours, { unrun }) : null
  const verdict = foldStrategyGrade(indicator, strategy)
  const objectsV2 = objectsV2Of(capture, ours, verdict)
  // ⭐ L7 — a run with substituted inputs never reads MATCH, the v2 objects report included
  // (capability admission reads `objectsV2: MATCH` for an `obj:*` family).
  if (objectsV2 && verdict.substituted && objectsV2.verdict === 'MATCH') objectsV2.verdict = MATCH_SUBSTITUTED
  return { verdict, ours, integrity, objectsV2 }
}

/** ⭐ OBJECTS v2 — every paired record graded field by field
 *  (`compare.mjs::compareObjectsV2`). A SEPARATE report beside the verdict: the
 *  verdict, and every ratchet that reads it, stays v1. `null` where v1 graded no
 *  objects. */
export function objectsV2Of(capture, ours, verdict) {
  if (!verdict || !verdict.objects) return null
  const pairing = capture.objects && capture.objects.records
    && ours && ours.ok && ours.objects && ours.objects.ok && Array.isArray(ours.objects.held)
    ? pairRecords(capture, ours.objects)
    : null
  return compareObjectsV2(verdict.objects, pairing, (ours && ours.objects && ours.objects.withheldFamilies) || [])
}

/**
 * @param {string[]} dirs
 * @returns {{results: object[], inventory: object[], table: string}}
 */
export function runHarness(dirs = [VENDOR_DIR], opts = {}) {
  const files = [...new Set(dirs.flatMap((d) => walk(d)))]
  const results = []
  const inventory = []
  for (const f of files) {
    const loaded = loadCapture(f)
    if (!loaded.capture) {
      inventory.push({ file: loaded.file, format: loaded.format, reason: loaded.reason })
      continue
    }
    const { verdict, ours, objectsV2 } = gradeCapture(loaded.capture, opts)
    results.push({ file: loaded.file, format: loaded.format, ...verdict, ourNotes: ours ? ours.notes : [],
      ...(objectsV2 ? { objectsV2 } : {}) })
  }
  return { results, inventory, table: renderSummary(results), files: files.length }
}
