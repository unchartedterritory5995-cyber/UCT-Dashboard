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
import { pairObjects } from './objectColours'
import { gradePaints } from './paintColours'
import { vi } from 'vitest'
import { objectsOnlyPaneEnabled } from '../../objectsOnlyPaneGate'
import { runtimePaneEnabled, runtimePanePermitted, __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { runtimeAllowList, __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { __gradeWithoutPaneClockForTests, paneBudgetMs } from '../../runtime/runtimeColumns'

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
 *  A capture whose `bgcolor` / `barcolor` paints differ from TradingView's — or
 *  that the door withholds — grades DIVERGE (`compare.mjs::comparePaints` states
 *  the rule). Same contract as `objectColourGraded`: `gradeCapture(c, {paints:
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
export function gradeCapture(capture, opts = {}) {
  const integrity = validateCapture(capture)
  // ⛔ AN INVALID CAPTURE IS NEVER RUN. Running our side on bars whose receipt
  // failed would grade our engine against numbers nobody can vouch for.
  // ⭐ RT8 — every grade runs without the runtime pane's wall clock, whichever
  // rail asks (a rail that stubs the flags itself included): a verdict must not
  // depend on how busy the machine is; the VM's instruction-counted limits still
  // bound the run. ONE switch, here — a second in `enterDoorState` was measured
  // redundant (its mutation left every rail green). The clock is put back.
  const clockWas = paneBudgetMs() === null
  __gradeWithoutPaneClockForTests(true)
  let ours
  try {
    ours = integrity.ok ? runOurSide(capture) : null
  } finally {
    __gradeWithoutPaneClockForTests(clockWas)
  }
  // The colour slots of every object PAIRED with the capture's own record — only
  // where the capture recorded objects and our object lane ran.
  const objectColours = objectColourGraded(opts) && capture.objects
    && ours && ours.ok && ours.objects && ours.objects.ok && Array.isArray(ours.objects.held)
    ? pairObjects(capture, ours.objects)
    : null
  const paints = paintsGraded(opts) && ours && ours.ok ? gradePaints(capture, ours) : null
  const verdict = compareCapture(capture, ours, { integrity, objectColours, paints })
  return { verdict, ours, integrity }
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
    const { verdict, ours } = gradeCapture(loaded.capture, opts)
    results.push({ file: loaded.file, format: loaded.format, ...verdict, ourNotes: ours ? ours.notes : [] })
  }
  return { results, inventory, table: renderSummary(results), files: files.length }
}

// ─── ⭐⭐ RT8 (step 87) — THE DOOR STATE IS SET, NEVER INHERITED ──────────────
//
// GT made the runtime pane need TWO answers: the build flag AND a per-member
// permission latched in module state (`runtimePaneGate.js`), plus a graded script
// (`runtimeKill.js` allowlist). `src/test-setup.js` grants both in a `beforeEach`.
// ⛔ A grade made OUTSIDE a test body (the corpus CLI graded in its `describe`
// body, at collection time) runs before that hook: the permission is unlatched, the
// runtime lane declines every script, and a "runtime" run silently reports the
// objects-only numbers (measured at 476412b297: MATCH 79 / DIVERGE 80 /
// INCONCLUSIVE 136 with `VITE_PINE_RUNTIME_PANE_ENABLED=1`, the same as without).
//
// So every measurement names its state and this helper ENTERS it: both build
// flags stubbed explicitly, and for `runtime` the member permitted and every
// script graded HERE, in the state, not by a hook it may run before. It returns
// the gates' own answers so a run can record (and a rail can check) what the
// door really saw.
export const DOOR_STATES = Object.freeze(['off', 'on', 'runtime'])

/** Enter one door state (the caller restores with `vi.unstubAllEnvs()`). */
export function enterDoorState(state) {
  if (!DOOR_STATES.includes(state)) throw new Error(`unknown door state ${JSON.stringify(state)}`)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', state === 'off' ? '' : '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', state === 'runtime' ? '1' : '')
  if (state === 'runtime') {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  }
  return doorGates()
}

/** What the door's own gates answer right now. */
export function doorGates() {
  return {
    objectsOnly: objectsOnlyPaneEnabled(),
    runtime: runtimePaneEnabled(),
    runtimePermitted: runtimePanePermitted(),
    runtimeAllow: runtimeAllowList().join(','),
    paneBudgetMs: paneBudgetMs(),
  }
}

/** ⛔ The state must be the one asked for, or the run is not measuring it: the
 *  sentence saying how the gates disagree, or null when they agree. */
export function doorStateMismatch(state, gates) {
  const want = { off: [false, false], on: [true, false], runtime: [true, true] }[state]
  if (!want || !gates || gates.objectsOnly !== want[0] || gates.runtime !== want[1]) {
    return `door state ${state} not entered: gates read ${JSON.stringify(gates)}`
  }
  return null
}

/** Run `fn` in one door state; the env stubs are undone after. */
export function withDoorState(state, fn) {
  const gates = enterDoorState(state)
  const wrong = doorStateMismatch(state, gates)
  if (wrong) {
    vi.unstubAllEnvs()
    throw new Error(wrong)
  }
  try {
    return fn(gates)
  } finally {
    vi.unstubAllEnvs()
  }
}

/** The state an ambient environment asks for (the CLI's default when
 *  `VENDOR_HARNESS_STATE` is unset): the two build flags as set in the process. */
export function ambientDoorState(env = process.env) {
  if (env.VITE_PINE_RUNTIME_PANE_ENABLED === '1') return 'runtime'
  return env.VITE_PINE_OBJECTS_ONLY_PANE_ENABLED === '1' ? 'on' : 'off'
}
