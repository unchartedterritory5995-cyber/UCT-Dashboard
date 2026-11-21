// app/src/components/chart/builder/inspectView.js
//
// ⭐⭐ THE PASTE WORKER (2026-11-21) — WHAT PASTEBOX READS OF A REPORT, AND NOTHING ELSE CROSSES TO THE PAGE
//
// A report (`inspectSource` / `inspectPine`) carries every output's tree (`ast`), every output's read-back through the
// formula door (`downstream`, which holds a second tree) and the script's object program (`objects`). Measured on the
// heavy script of #2254's trace: 62.5 MB of structured clone (objects 32.4 MB, downstream 20.9 MB, ast 7.7 MB), up to
// 1.2 s to receive on the page's main thread. PasteBox reads of them only:
//
//   - each output's placements of the script's inputs, found in its tree (`placementsOf`);
//   - whether each output's column is a number rather than a condition (`numericOf`);
//   - for a thinkScript / TC2000 / native paste, the import verdict (`verdictOf`);
//   - of `downstream`: `ok`, `readback`, `guard`, `error` (the read-back line, `importGaps`);
//   - the object program, ONLY when the member presses Use (`inspectAsync.askHeldObjects`).
//
// So the report's worker derives the first three from the full report and sends the report without the trees and
// the program (`reportForPage`); the full report stays in that worker (the editor status panel's status is made there,
// `inspectAsync.js`, the hub). A report this page computed (no workers) is full, and PasteBox derives the same three
// itself, with these same functions: one computation, wherever it runs.
import { paramLocatorsIn } from './pineParamManifest'
import { yieldsCondition } from './toCondition'
import { importVerdict } from '../engine/ast/importVerdict'

/** Each output's placements of the script's inputs (C2D.1/C2D.2), or null when the script declares none. */
export function placementsOf(report) {
  const params = (report && report.inputParams) || []
  if (!params.length) return null
  return (report.outputs || []).map((o) => (o && o.ast ? paramLocatorsIn(params, o.ast) : []))
}

/** Whether an output's column is a number a member may turn into a screen (a comparison beside it). */
export function numericOf(out) {
  return !!(out && out.formula && !yieldsCondition(out.formula))
}

/** The four-class verdict of a non-Pine import (I2), null for Pine. */
export function verdictOf(report) {
  return report && report.dialect !== 'pine' ? importVerdict(report) : null
}

/** What the page reads of an output's read-back through the formula door. */
export const DOWNSTREAM_READ = Object.freeze(['ok', 'readback', 'guard', 'error'])

/** A copy of `value` without the named own properties; every other own property kept with its descriptor. */
function without(value, drop) {
  const out = {}
  for (const k of Reflect.ownKeys(value)) {
    if (drop.includes(k)) continue
    Object.defineProperty(out, k, Object.getOwnPropertyDescriptor(value, k))
  }
  return out
}

/** `arr.map(fn)`, keeping the array's own properties that are not its items (a tag a walker reads). */
function mapKeeping(arr, fn) {
  const out = arr.map(fn)
  for (const k of Reflect.ownKeys(arr)) {
    if (k === 'length' || (typeof k === 'string' && String(k >>> 0) === k && (k >>> 0) < arr.length)) continue
    Object.defineProperty(out, k, Object.getOwnPropertyDescriptor(arr, k))
  }
  return out
}

function downstreamForPage(down) {
  if (!down || typeof down !== 'object') return down
  const out = {}
  for (const k of DOWNSTREAM_READ) if (Object.prototype.hasOwnProperty.call(down, k)) out[k] = down[k]
  return out
}

function outputForPage(o) {
  if (!o || typeof o !== 'object') return o
  const out = without(o, ['ast', 'downstream'])
  if (Object.prototype.hasOwnProperty.call(o, 'downstream')) {
    Object.defineProperty(out, 'downstream', { ...Object.getOwnPropertyDescriptor(o, 'downstream'), value: downstreamForPage(o.downstream) })
  }
  return out
}

/**
 * ⭐ The report as the page reads it: without the trees, the read-backs' trees and the object program, with what
 * PasteBox derives from them (`pageView`: `placements`, `numeric` per output, `verdict`, and `objectsHeld`, whether
 * the program stayed in the worker).
 */
export function reportForPage(report) {
  if (!report || typeof report !== 'object') return report
  const outputs = Array.isArray(report.outputs) ? report.outputs : null
  const light = without(report, ['objects', 'outputs'])
  if (Object.prototype.hasOwnProperty.call(report, 'outputs')) {
    Object.defineProperty(light, 'outputs', { ...Object.getOwnPropertyDescriptor(report, 'outputs'),
      value: outputs ? mapKeeping(outputs, outputForPage) : report.outputs })
  }
  light.pageView = {
    placements: placementsOf(report),
    numeric: (outputs || []).map(numericOf),
    verdict: verdictOf(report),
    objectsHeld: !!report.objects,
  }
  return light
}

// ─── A REFUSAL'S STAMP CROSSES ONCE ───────────────────────────────────────────────────────────────────────────────
// Every refusal a report holds is stamped with the text it was made of (`refusal.source`, so a suggestion is applied
// to the text the engine read: `PineBox.applySuggestion`). A script refused output by output carries its whole text
// once per output (measured: 545 KB of a 745 KB report, a 48 KB script with eleven refused outputs). The page holds
// that text already (the job's own `source`), so it crosses as a mark and is put back on the page.
const JOB_TEXT = 'jobText'
const isJobText = (v) => !!v && typeof v === 'object' && v[JOB_TEXT] === true

function refusalsOf(report) {
  const out = []
  if (report && report.refusal && typeof report.refusal === 'object') out.push([report, 'refusal'])
  for (const o of (report && Array.isArray(report.outputs) ? report.outputs : [])) {
    if (o && o.refusal && typeof o.refusal === 'object') out.push([o, 'refusal'])
  }
  return out
}

/** The light report with each refusal stamped with `source` carrying a mark instead (copies; the report is not changed). */
export function stampsForCrossing(light, source) {
  if (typeof source !== 'string') return light
  for (const [holder, key] of refusalsOf(light)) {
    const r = holder[key]
    if (r.source !== source) continue
    const marked = without(r, ['source'])
    marked.source = { [JOB_TEXT]: true }
    Object.defineProperty(holder, key, { ...Object.getOwnPropertyDescriptor(holder, key), value: marked })
  }
  return light
}

/** The marks put back: each refusal's stamp is the job's `source` again (on the report that crossed, in place). */
export function stampsFromCrossing(report, source) {
  for (const [holder, key] of refusalsOf(report)) {
    const r = holder[key]
    if (isJobText(r.source)) r.source = source
  }
  return report
}
