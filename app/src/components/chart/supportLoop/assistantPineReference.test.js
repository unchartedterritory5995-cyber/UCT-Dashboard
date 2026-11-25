// app/src/components/chart/supportLoop/assistantPineReference.test.js
//
// ⭐ THE COMMITTED REFERENCE IS THE CURRENT BUILD'S ANSWER. `assistantPineReference.json` is
// regenerated here, from the engine's own tables and through the member's own paste path, and
// compared with the committed bytes. A change to what the engine serves reds this file until the
// reference is regenerated in the same change:
//
//   (cd app && WRITE_ASSISTANT_PINE_REFERENCE=1 node node_modules/vitest/vitest.mjs run \
//      src/components/chart/supportLoop/assistantPineReference.test.js)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { steadyRunClock } from './testing/steadyRunClock'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

import { inspectSource } from '../builder/PineBox'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { editorStatus } from '../builder/editorStatus'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission, setRuntimeCapabilityAdmission,
  latchRuntimeAdmission, runtimeSourceHash, runtimeAllowList, runtimeCapabilityAdmissionOn, RUNTIME_FORMING_GUARD,
} from '../engine/runtimeKill'
import { __resetHostKnownDivergence, hostKnownDivergenceActive } from '../engine/hostKnownDivergence'
import { asMember, grantRuntimeGate } from '../../../testing/runtimeGate'
import { RUNTIME_OUTPUT_CALLS } from '../engine/ast/pineRuntimeFrontend'
import DOOR_NAMES from './doorNameCoverage.json'
import EXAMPLE_INDEX from './assistantExamples/index.json'
import GAP_PROBES from './assistantGapProbes.json'
import { buildAssistantGaps, GAP_KINDS } from './assistantGaps'
import RECIPE_INDEX from './assistantRecipes/index.json'
import {
  buildAssistantRecipes, buildRunStops, drawsObjects, drawingsMade, recipeBars, recipeContext, RECIPE_CHARTS, RECIPE_HISTORIES,
  RUN_STOP_PROBES, WRONG_VALUE_GUARD, NEWEST_BAR_BLANK_GUARD, MEMBER_ANSWER, memberProofStands,
} from './assistantRecipes'
import * as nativeRegistry from '../engine/nativeRegistry'
import { RUNTIME_OBJECTS_KEY } from '../engine/runtime/runtimeObjects'
import { drawingLossOf, LOST_DRAWINGS_HEADLINE } from '../builder/authoring/scriptAnswer'
import { DRAWING_NOTE_NAME } from '../engine/ast/objectLoss'
import { translatePine } from '../engine/ast/pine'
import { EVENTS_KEY } from '../engine/pineEvents'
import { FINANCIAL_KEY } from '../engine/pineFinancial'
import { probeScript, refusalsOf } from './doorNameCoverage'
import {
  buildAssistantPineReference, servedOutputs, outputProbeScript, OUTPUT_PROBES, PITFALL_PROBES, RUNS_STATES, DRAWING_FAMILIES,
} from './assistantPineReference'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
// WHAT IS GENERATED MUST NOT DEPEND ON BOX LOAD EITHER: a recipe stopped by the wall clock on a busy runner
// would be written (or compared) as one that does not run. Every run in this file reads a stepping clock.
let runClock = null
beforeEach(() => { runClock = steadyRunClock() })
afterEach(() => { if (runClock) runClock.restore(); runClock = null })

const HERE = path.resolve(process.cwd(), 'src/components/chart/supportLoop')
const FILE = path.join(HERE, 'assistantPineReference.json')
const ALLOWLIST = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', 'api', 'data', 'pine_runtime_allowlist.json'), 'utf8'))
const LF = String.fromCharCode(10)
const EXAMPLES = EXAMPLE_INDEX.examples.map((e) => ({
  ...e, source: fs.readFileSync(path.join(HERE, 'assistantExamples', e.file), 'utf8').replace(/\r\n/g, LF),
}))

// ⛔⛔ THE REFERENCE IS NEVER WRITTEN FROM A TREE THAT IS BEHIND MASTER (2026-11-19). The first copy
// of this file was generated in a sparse worktree that was hundreds of files behind: an older
// engine and an older admission table, so the committed "current build's answer" was a stale
// build's. In WRITE mode every engine file this generator reads is compared with origin/master's
// blob (a file's own line endings aside), and the write is refused when any differs. A change
// that edits one of those files on purpose names it:
//   ASSISTANT_PINE_REFERENCE_CHANGED=app/src/components/chart/engine/x.js,...
const REPO = path.resolve(process.cwd(), '..')
const INPUT_PREFIXES = Object.freeze([
  'app/src/components/chart/engine', 'app/src/components/chart/builder/memberPane',
  'app/src/components/chart/builder/PineBox.jsx', 'app/src/components/chart/builder/editorStatus.js',
  'app/src/components/chart/supportLoop/doorNameCoverage.json', 'api/data/pine_runtime_allowlist.json',
])
const NOT_AN_INPUT = Object.freeze(['/__tests__/', '/__fixtures__/', '/__truth__/', '.test.'])
const CR = String.fromCharCode(13)

/** The git blob id of some bytes. */
export function blobId(bytes) {
  const head = Buffer.from(`blob ${bytes.length}${String.fromCharCode(0)}`)
  return crypto.createHash('sha1').update(Buffer.concat([head, bytes])).digest('hex')
}

/** Is this file on disk what `sha` names (as it is, or with Windows line endings folded)? */
export function sameAsBlob(bytes, sha) {
  if (!bytes) return false
  if (blobId(bytes) === sha) return true
  const folded = Buffer.from(bytes.toString('latin1').split(CR + LF).join(LF), 'latin1')
  return blobId(folded) === sha
}

/** The generator's input files that differ from origin/master (or are missing here). */
function staleInputs(read = (rel) => (fs.existsSync(path.join(REPO, rel)) ? fs.readFileSync(path.join(REPO, rel)) : null)) {
  const listing = execFileSync('git', ['ls-tree', '-r', 'origin/master', ...INPUT_PREFIXES],
    { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  const stale = []
  for (const row of listing.split(LF)) {
    const tab = row.indexOf(String.fromCharCode(9))
    if (tab < 0) continue
    const rel = row.slice(tab + 1)
    if (NOT_AN_INPUT.some((part) => rel.includes(part))) continue
    const sha = row.slice(0, tab).split(' ')[2]
    if (!sameAsBlob(read(rel), sha)) stale.push(rel)
  }
  return stale
}

/** The member's paste path on one script: the report, the pane, and the status panel's verdict. */
let n = 0
/** ⛔ LOST DRAWINGS ARE NOT "RUNS" (2026-11-19). The lane that takes a script can carry its plots and
 *  lose its drawing program; the status says so as a NOTE beside "runs". Read here as data, by the
 *  SAME function the dock uses (`scriptAnswer.drawingLossOf`), so the reference, the gaps list and the
 *  recipes never call such a script served. */
const LOST_STATE = 'drawings-lost'
function verdictOf(source) {
  const report = inspectSource(source, 'pine')
  const pane = memberPaneDefinition({ source, id: `u_ref_${n += 1}`, name: 'probe' })
  const status = editorStatus({ report, pane, savedRow: null, inspectedSource: source })
  const lost = drawingLossOf(pane)
  if (lost && pane.ok === true) return { ok: false, lane: pane.lane || 'host', state: LOST_STATE, headline: LOST_DRAWINGS_HEADLINE, lost }
  return { ok: pane.ok === true, lane: pane.lane || 'host', state: status.state, headline: status.headline }
}

const GAPS_FILE = path.join(HERE, 'assistantGaps.json')

/** The paste path's verdict with the engine's own reason, for a probe that does not run fully. */
function gapVerdictOf(source) {
  const report = inspectSource(source, 'pine')
  const pane = memberPaneDefinition({ source, id: `u_gap_${n += 1}`, name: 'probe' })
  const status = editorStatus({ report, pane, savedRow: null, inspectedSource: source })
  const withheld = (status.items || []).filter((i) => i && i.severity === 'withheld')
  const first = withheld[0] || null
  const lost = pane.ok === true ? drawingLossOf(pane) : null
  if (lost) return { ok: false, lane: pane.lane || 'host', state: LOST_STATE, headline: LOST_DRAWINGS_HEADLINE, guard: 'drawings:lost', family: 'objects', why: lost }
  return {
    ok: pane.ok === true, lane: pane.lane || 'host', state: status.state, headline: status.headline,
    guard: (first && first.guard) || pane.guard || (pane.runtimeDeclined && pane.runtimeDeclined.code) || null,
    family: (first && first.family) || null,
    why: (first && (first.reason || first.why)) || (pane.runtimeDeclined && pane.runtimeDeclined.why) || pane.reason || '',
  }
}

const build = (over = {}) => buildAssistantPineReference({
  allowlist: ALLOWLIST, doorNames: DOOR_NAMES, examples: EXAMPLES, verdictOf, outputCalls: RUNTIME_OUTPUT_CALLS, ...over,
})

const RECIPES_FILE = path.join(HERE, 'assistantRecipes.json')
const RECIPES = RECIPE_INDEX.recipes.map((r) => ({
  ...r, source: fs.readFileSync(path.join(HERE, 'assistantRecipes', r.file), 'utf8').replace(/\r\n/g, LF),
}))
const RECIPE_BARS = Object.fromEntries(RECIPE_CHARTS.map((kind) => [kind, recipeBars(kind)]))

/** A real run of a script on a recipe chart: the engine's own columns and its own refusals. */
function computeOf(source, chart, history, { dropLast = 0, forming = false } = {}) {
  const pane = memberPaneDefinition({ source, id: `u_recipe_${n += 1}`, name: 'recipe' })
  if (!pane.ok || !pane.definition) return { ok: false, guard: pane.guard || 'not-built', why: pane.reason || '', values: 0 }
  const bars = dropLast > 0 ? RECIPE_BARS[chart].slice(0, -dropLast) : RECIPE_BARS[chart]
  let cols
  try {
    // (`forming`: the chart's own fact about its newest bar, the one the session-hours rule reads)
    cols = nativeRegistry.computeFor(pane.definition, bars, undefined, { ...recipeContext(chart, history), newestBarIsForming: forming === true })
  } catch (e) {
    return { ok: false, guard: (e && e.guard) || 'threw', why: String((e && e.message) || e), values: 0 }
  }
  const errors = nativeRegistry.columnErrors(cols) || {}
  const first = Object.keys(errors)[0]
  if (first) return { ok: false, guard: errors[first].guard || 'refused', why: errors[first].message || '', values: 0 }
  const keys = Object.keys(cols)
  const column = keys.length ? cols[keys[0]] : []
  let values = 0
  let last = null
  for (let i = 0; i < column.length; i += 1) if (Number.isFinite(column[i])) { values += 1; last = column[i] }
  const newest = column.length ? column[column.length - 1] : NaN
  return { ok: true, values, last, newest, drawings: drawingsOfRun(pane.definition, cols) }
}

/**
 * What became of a script's drawings on this run, from the engine's own records:
 *   lost      the lane that took the script could not carry part of its drawing program (it says so
 *             in a disclosure named `DRAWING_NOTE_NAME`, which the status shows as a NOTE)
 *   withheld  the run's drawings were withheld by name (the guard), or null
 *   partial   the run made some kinds of drawing and withheld others
 *   made      how many drawings the run holds, or how many drawing steps the host program carries
 */
function drawingsOfRun(def, cols) {
  const runOwns = !!(def.compute && def.compute.objects === true)
  // (a document whose RUN owns its drawings carries a disclosure of the same name that is not a loss:
  // "made by the same bar-by-bar run". Its losses are in the run's own record, read below.)
  const lost = !runOwns && ((def.meta && def.meta.disclosures) || []).some((d) => d && d.name === DRAWING_NOTE_NAME)
  const payload = cols[RUNTIME_OBJECTS_KEY] || null
  const hostWithheld = nativeRegistry.runtimeObjectsWithheld(def, cols)
  if (runOwns) {
    const okRun = !!payload && payload.status === 'ok' && Array.isArray(payload.live)
    return {
      lost, made: okRun ? payload.live.length : 0,
      withheld: okRun ? null : ((payload && (payload.guard || payload.status)) || (nativeRegistry.runtimeWarmupOf && nativeRegistry.runtimeWarmupOf(cols) ? 'runtime:history-start' : 'no-drawings')),
      partial: okRun && Object.keys(payload.withheldCounts || {}).length > 0,
    }
  }
  const ops = def.objects && Array.isArray(def.objects.ops) ? def.objects.ops.length : 0
  return { lost, made: ops, withheld: hostWithheld ? hostWithheld.guard : null, partial: false }
}

/** One run of a script, as the generator records it for a member: drawn, waiting for the bar, or the stop. */
function memberAnswer(source, chart, history, forming) {
  const c = computeOf(source, chart, history, { forming })
  if (c.ok === true) return c.values > 0 && (!drawsObjects(source) || drawingsMade(c.drawings)) ? MEMBER_ANSWER.RUNS : 'drew nothing'
  return c.guard === RUNTIME_FORMING_GUARD ? MEMBER_ANSWER.WAITS : `stopped: ${c.guard}`
}

/** The server's admission answer for a recipe: admitted, and for finished bars only when the recipe says so
 *  (`tests/test_pine_authoring.py` holds that flag to the server's own detector, recipe by recipe). */
const verdictFor = (waits) => ({ admitted: true, historyOnly: waits === true })

/**
 * ⭐ THE SAME SCRIPT BEHIND A MEMBER'S DOORS (2026-11-20). Everything else in this file runs under the test
 * grant (`src/test-setup.js`: every script admitted, the host lane's known-divergence list ignored), which is
 * how a recipe that a member's chart refused all session was once written here as served. This takes the
 * grant back for ONE script: no allowlist, the known-divergence list applied, capability admission on, and the
 * server's verdict latched for this exact source. Then the grant is put back, because the rest of the same
 * test generates under it.
 * ⛔ Called from inside a test only (the gate rails, `src/testing/runtimeGate.js`). The describe below runs the
 * same recipes behind `asMember`, the shared way to stand behind those doors, and holds the two to each other.
 */
const memberSeen = new Map()
function memberOf(source, chart, history, waits) {
  const key = [runtimeSourceHash(source), chart, history, waits === true].join('|')
  if (memberSeen.has(key)) return memberSeen.get(key)
  __resetRuntimeAllowList()
  __resetHostKnownDivergence()
  __resetRuntimeAdmission()
  setRuntimeCapabilityAdmission(true)
  latchRuntimeAdmission(runtimeSourceHash(source), verdictFor(waits))
  let out
  try {
    out = { forming: memberAnswer(source, chart, history, true), finished: memberAnswer(source, chart, history, false) }
  } finally {
    __resetRuntimeAdmission()
    grantRuntimeGate()
  }
  memberSeen.set(key, out)
  return out
}

describe('assistantRecipes.json: every recipe is proven twice, by the paste check and by a real run', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
  const recipes = (over = {}) => buildAssistantRecipes({ recipes: RECIPES, verdictOf, computeOf, memberOf, ...over })

  it('regenerates byte-for-byte (WRITE_ASSISTANT_PINE_REFERENCE=1 rewrites it)', () => {
    const text = `${JSON.stringify(recipes(), null, 1)}${LF}`
    if (process.env.WRITE_ASSISTANT_PINE_REFERENCE === '1') {
      const named = String(process.env.ASSISTANT_PINE_REFERENCE_CHANGED || '').split(',').map((x) => x.trim()).filter(Boolean)
      expect(staleInputs().filter((rel) => !named.includes(rel)), 'NOT WRITTEN: engine files differ from origin/master').toEqual([])
      fs.writeFileSync(RECIPES_FILE, text)
    }
    const committed = fs.existsSync(RECIPES_FILE) ? fs.readFileSync(RECIPES_FILE, 'utf8').replace(/\r\n/g, LF) : ''
    expect(committed === text,
      'assistantRecipes.json is stale: the engine now answers a recipe differently. Regenerate it with '
      + 'WRITE_ASSISTANT_PINE_REFERENCE=1; a recipe that stopped running must be fixed or removed.').toBe(true)
  }, 600_000)

  it('every recipe in the folder is SERVED today, on both histories', () => {
    const out = recipes()
    expect(out.recipes.map((r) => r.id)).toEqual(RECIPE_INDEX.recipes.map((r) => r.id))
    expect(new Set(out.recipes.map((r) => r.id)).size).toBe(out.recipes.length)
    for (const r of out.recipes) {
      expect(RECIPE_CHARTS, r.id).toContain(r.chart)
      expect(r.asks.length, r.id).toBeGreaterThan(0)
      expect(r.asks.every((a) => a === a.toLowerCase() && a.trim() === a && a.length > 2), r.id).toBe(true)
      expect(r.source.startsWith('//@version=5'), r.id).toBe(true)
      expect(RUNS_STATES, `${r.id}: ${r.headline}`).toContain(r.state)
      for (const h of RECIPE_HISTORIES) {
        expect(r.runs[h].ok, `${r.id} on a chart ${h}: ${r.runs[h].guard} ${r.runs[h].why || ''}`).toBe(true)
        expect(r.runs[h].values, `${r.id} on a chart ${h} has no value anywhere`).toBeGreaterThan(0)
        if (r.draws) expect(drawingsMade(r.runs[h].drawings), `${r.id} on a chart ${h}: its drawings ${JSON.stringify(r.runs[h].drawings)}`).toBe(true)
        // as a member has it: drawn once the bar has finished, and while it forms unless the recipe says it waits
        expect(r.member[h], `${r.id} on a chart ${h}, as a member`).toEqual({
          forming: r.finishedBarsOnly === true ? MEMBER_ANSWER.WAITS : MEMBER_ANSWER.RUNS, finished: MEMBER_ANSWER.RUNS,
        })
      }
      expect(r.draws, r.id).toBe(drawsObjects(r.source))
      expect(r.served, r.id).toBe(true)
    }
    // the generator left the grant as it found it
    expect(runtimeAllowList()).toEqual(['*'])
    expect(runtimeCapabilityAdmissionOn()).toBe(false)
    expect(hostKnownDivergenceActive()).toBe(false)
  }, 600_000)

  it('CONTROL: a recipe is not served unless the MEMBER\'s proof stands, in either direction', () => {
    const pasteOk = () => ({ ok: true, lane: 'runtime', state: 'runs-with-notes', headline: 'Runs' })
    const made = { made: 3, lost: false, withheld: null, partial: false }
    const withMember = (memberOfFake) => recipes({ verdictOf: pasteOk, computeOf: () => ({ ok: true, values: 3, drawings: made }), memberOf: memberOfFake, stopProbes: {} }).recipes
    const honest = (_s, _c, _h, waits) => ({ forming: waits ? 'waits' : 'runs', finished: 'runs' })
    expect(withMember(honest).every((r) => r.served === true)).toBe(true)
    // no proof given at all: nothing is served
    const none = buildAssistantRecipes({ recipes: RECIPES, verdictOf: pasteOk, computeOf: () => ({ ok: true, values: 3, drawings: made }), stopProbes: {} }).recipes
    expect(none.every((r) => r.served === false && r.member.fromListing.forming === MEMBER_ANSWER.NOT_PROVEN)).toBe(true)
    expect(withMember(() => null).every((r) => r.served === false)).toBe(true)
    // stopped while the bar forms, on ONE history only: not served
    const stoppedOff = withMember((s, c, h, waits) => (h === 'offListing' ? { forming: 'stopped: pane:not-graded', finished: 'runs' } : honest(s, c, h, waits)))
    expect(stoppedOff.every((r) => r.served === false && r.member.offListing.forming === 'stopped: pane:not-graded')).toBe(true)
    // not drawn once the bar has finished: not served
    expect(withMember(() => ({ forming: 'runs', finished: 'stopped: x' })).every((r) => r.served === false)).toBe(true)
    // ⛔ an UNDECLARED recipe that waits is not served (a member would read "does not run" all session) ...
    const everyoneWaits = withMember(() => ({ forming: 'waits', finished: 'runs' }))
    expect(everyoneWaits.filter((r) => r.finishedBarsOnly !== true).every((r) => r.served === false)).toBe(true)
    expect(everyoneWaits.filter((r) => r.finishedBarsOnly === true).every((r) => r.served === true)).toBe(true)
    // ... and a DECLARED one that does not wait is not served either (the member would be told it waits)
    const nobodyWaits = withMember(() => ({ forming: 'runs', finished: 'runs' }))
    expect(nobodyWaits.filter((r) => r.finishedBarsOnly === true).length).toBeGreaterThan(0)
    expect(nobodyWaits.filter((r) => r.finishedBarsOnly === true).every((r) => r.served === false)).toBe(true)
    expect(nobodyWaits.filter((r) => r.finishedBarsOnly !== true).every((r) => r.served === true)).toBe(true)
    // the rule itself, by hand
    const both = (forming, finished) => ({ fromListing: { forming, finished }, offListing: { forming, finished } })
    expect(memberProofStands(both('runs', 'runs'), false)).toBe(true)
    expect(memberProofStands(both('waits', 'runs'), true)).toBe(true)
    expect(memberProofStands(both('waits', 'runs'), false)).toBe(false)
    expect(memberProofStands(both('runs', 'runs'), true)).toBe(false)
    expect(memberProofStands({ fromListing: { forming: 'runs', finished: 'runs' } }, false)).toBe(false)   // one history missing
    expect(memberProofStands(null, false)).toBe(false)
  })

  it('CONTROL: a recipe the run refuses is not served, whatever the paste check says', () => {
    const pasteOk = () => ({ ok: true, lane: 'runtime', state: 'runs-with-notes', headline: 'Runs' })
    const refusedOffListing = recipes({
      verdictOf: pasteOk,
      computeOf: (_s, _c, history) => (history === 'offListing'
        ? { ok: false, guard: 'runtime:warmup-never-converges', why: 'depends on the first bar', values: 0 } : { ok: true, values: 10 }),
    })
    expect(refusedOffListing.recipes.every((r) => r.served === false && r.runs.offListing.guard === 'runtime:warmup-never-converges'
      && r.runs.fromListing.ok === true)).toBe(true)
    // ⛔ A SCRIPT THAT DRAWS IS NOT SERVED UNLESS ITS DRAWINGS ARE MADE, on both histories: lost by the
    // lane ("runs, with 1 note"), withheld by the run, made in part, or none made at all
    const made = { made: 3, lost: false, withheld: null, partial: false }
    const drawing = (bad, history = 'offListing') => recipes({
      verdictOf: pasteOk,
      computeOf: (_s, _c, h) => ({ ok: true, values: 10, drawings: h === history ? { ...made, ...bad } : made }),
    }).recipes.filter((r) => r.draws)
    expect(drawing({}).length).toBeGreaterThan(5)
    expect(drawing({}).every((r) => r.served === true)).toBe(true)
    for (const bad of [{ lost: true }, { withheld: 'runtime:objects-without-run' }, { partial: true }, { made: 0 }]) {
      expect(drawing(bad).every((r) => r.served === false), JSON.stringify(bad)).toBe(true)
      expect(drawing(bad, 'fromListing').every((r) => r.served === false), JSON.stringify(bad)).toBe(true)
    }
    // a recipe that only plots is not asked about drawings
    const plotsOnly = recipes({ verdictOf: pasteOk, computeOf: () => ({ ok: true, values: 10 }) }).recipes.filter((r) => !r.draws)
    expect(plotsOnly.length).toBeGreaterThan(3)
    expect(plotsOnly.every((r) => r.served === true && !('drawings' in r.runs.offListing))).toBe(true)
    expect(drawsObjects('// label.new(1, 2)' + LF + 'plot(close)')).toBe(false)             // a comment is not a drawing
    expect(drawsObjects('if x' + LF + '    label.new(bar_index, high, "a")')).toBe(true)
    // a run with no refusal and no value anywhere is not served either
    const empty = recipes({ verdictOf: pasteOk, computeOf: () => ({ ok: true, values: 0 }) })
    expect(empty.recipes.every((r) => r.served === false)).toBe(true)
    // and a recipe the paste check does not pass is never computed
    let computed = 0
    const notPasted = recipes({
      verdictOf: () => ({ ok: false, lane: 'host', state: 'not-yet', headline: 'Not yet' }),
      computeOf: () => { computed += 1; return { ok: true, values: 10 } },
      stopProbes: {},                       // (the run-stop probes are computed whatever the recipes do)
    })
    expect(computed).toBe(0)
    expect(notPasted.recipes.every((r) => r.served === false && r.runs.fromListing.guard === 'not-computed')).toBe(true)
    const all = recipes({ verdictOf: pasteOk, computeOf: () => ({ ok: true, values: 3, drawings: made }) })
    expect(all.recipes.every((r) => r.served === true)).toBe(true)
  })

  it('a stop of the run stands only while the engine still refuses its probe, and the paste check passes each', () => {
    const out = recipes()
    expect(out.stops.map((s) => s.id)).toEqual(Object.keys(RUN_STOP_PROBES).sort())
    // ⭐ WHICH STOPS STAND IS THE ENGINE'S ANSWER, NEVER THIS TEST'S. ⚰️ 2026-11-19: this block said
    // "today the one-call delete stands"; an engine train had fixed it an hour before this file merged,
    // and master went red on a fix. What is held now: a stop that stands, stands under ITS OWN guard;
    // each fact a sentence states is true exactly while its stop stands; and each probe can report both
    // answers (the CONTROLS, with a made-up run). The generated file follows the engine (the
    // byte-for-byte test above: regenerate after an engine change); these lines follow the file.
    const by = Object.fromEntries(out.stops.map((s) => [s.id, s]))
    const GUARD = {
      'running-total': 'runtime:warmup-never-converges', 'timestamp-clock': 'runtime:clock-zone',
      'delete-in-one-call': WRONG_VALUE_GUARD, 'higher-timeframe-newest-bar': NEWEST_BAR_BLANK_GUARD,
      'higher-timeframe-one-bar-back': NEWEST_BAR_BLANK_GUARD,
    }
    expect(Object.keys(by).sort()).toEqual(Object.keys(GUARD).sort())
    for (const [id, s] of Object.entries(by)) {
      expect(s, id).toEqual({ id, history: RUN_STOP_PROBES[id].history, standing: s.standing, guard: s.standing ? GUARD[id] : null })
    }
    // ⛔ the clock probe does NOT stand: on the chart's own context (a symbol with its exchange) `timestamp`
    // is answered. It was "refused" only while this harness passed no symbol (see the context rail below).
    expect(by['timestamp-clock'].standing).toBe(false)
    // ⛔ the one-call delete is a WRONG VALUE while it stands: the run finishes and the list it trims is
    // not five long (every label ever pushed is still in it). Written in two steps it is right on any engine.
    const oneCall = computeOf(RUN_STOP_PROBES['delete-in-one-call'].source, 'daily', 'fromListing')
    expect(oneCall.ok).toBe(true)
    expect(by['delete-in-one-call'].standing).toBe(oneCall.last !== 5)
    const twoSteps = RUN_STOP_PROBES['delete-in-one-call'].source
      .replace('    label.delete(array.shift(xs))', `    old = array.shift(xs)${LF}    label.delete(old)`)
    expect(twoSteps).not.toBe(RUN_STOP_PROBES['delete-in-one-call'].source)
    expect(computeOf(twoSteps, 'daily', 'fromListing').last).toBe(5)
    // CONTROLS: the probe reports both answers
    const deleteProbe = { p: { ...RUN_STOP_PROBES['delete-in-one-call'] } }
    expect(buildRunStops({ computeOf: () => ({ ok: true, values: 5, last: 5 }), probes: deleteProbe }))
      .toEqual([{ id: 'p', history: 'fromListing', standing: false, guard: null }])
    expect(buildRunStops({ computeOf: () => ({ ok: true, values: 5, last: 212 }), probes: deleteProbe }))
      .toEqual([{ id: 'p', history: 'fromListing', standing: true, guard: WRONG_VALUE_GUARD }])
    // ⛔ the weekly read is a BLANK on the chart's newest bar, mid-week, while it stands
    const midWeek = computeOf(RUN_STOP_PROBES['higher-timeframe-newest-bar'].source, 'daily', 'fromListing', { dropLast: 3 })
    expect(midWeek.ok).toBe(true)
    expect(by['higher-timeframe-newest-bar'].standing).toBe(!Number.isFinite(midWeek.newest))
    // (every other bar from the first finished week on has a value either way)
    expect(midWeek.values).toBe(RECIPE_BARS.daily.length - 3 - 4 - (Number.isFinite(midWeek.newest) ? 0 : 1))
    // on a chart that ends on the last bar of its week, the newest bar has the value on any engine
    expect(Number.isFinite(computeOf(RUN_STOP_PROBES['higher-timeframe-newest-bar'].source, 'daily', 'fromListing').newest)).toBe(true)
    // CONTROLS: the probe reports both answers
    const weeklyProbe = { p: { ...RUN_STOP_PROBES['higher-timeframe-newest-bar'] } }
    expect(buildRunStops({ computeOf: () => ({ ok: true, values: 5, newest: 1 }), probes: weeklyProbe })[0].standing).toBe(false)
    expect(buildRunStops({ computeOf: () => ({ ok: true, values: 5, newest: Number.NaN }), probes: weeklyProbe })[0])
      .toEqual({ id: 'p', history: 'fromListing', standing: true, guard: NEWEST_BAR_BLANK_GUARD })
    // the running total, while it stands, is refused by the engine's own name for it
    expect(buildRunStops({ computeOf: () => ({ ok: false, guard: 'runtime:warmup-never-converges' }), probes: { p: { ...RUN_STOP_PROBES['running-total'] } } })[0])
      .toEqual({ id: 'p', history: 'offListing', standing: true, guard: 'runtime:warmup-never-converges' })
    // ⛔ the reason these are probed by a RUN: the member's paste check says each one runs
    for (const id of Object.keys(RUN_STOP_PROBES)) {
      const v = verdictOf(RUN_STOP_PROBES[id].source)
      expect(v.ok && RUNS_STATES.includes(v.state), `${id}: ${v.headline}`).toBe(true)
    }
    // the running total is refused only where the history does not reach the listing
    expect(computeOf(RUN_STOP_PROBES['running-total'].source, 'daily', 'fromListing').ok).toBe(true)
    // CONTROL: on an engine that computes everything, no stop stands
    expect(buildRunStops({ computeOf: () => ({ ok: true, values: 5, last: 5, newest: 1 }) }).every((s) => s.standing === false && s.guard === null)).toBe(true)
  }, 600_000)

  it('every WORKED EXAMPLE of the reference also computes, on both histories, with no refusal', () => {
    // the examples are shown to the assistant in every script turn: the paste check proved them when the
    // reference was generated; this holds them to a real run as well (the check the recipes get)
    // ⛔ ONE IS NAMED, NOT SKIPPED: it reads another symbol, whose bars the CHART fetches and hands the run.
    // This harness hands none, and the engine says exactly that; any other answer for it is a change to look at.
    const NEEDS_THE_CHARTS_OTHER_SYMBOL = { 'another-symbol': 'other-symbol:bare' }
    const refused = []
    for (const e of EXAMPLES) {
      for (const history of RECIPE_HISTORIES) {
        const c = computeOf(e.source, 'daily', history)
        if (e.id in NEEDS_THE_CHARTS_OTHER_SYMBOL) {
          expect(c.ok ? 'computed' : c.guard, `${e.id} on a chart ${history}`).toBe(NEEDS_THE_CHARTS_OTHER_SYMBOL[e.id])
        } else if (!c.ok) refused.push(`${e.id} on a chart ${history}: ${c.guard}`)
        else if (drawsObjects(e.source) && !drawingsMade(c.drawings)) refused.push(`${e.id} on a chart ${history}: its drawings ${JSON.stringify(c.drawings)}`)
      }
    }
    expect(refused).toEqual([])
    expect(EXAMPLES.map((e) => e.id)).toContain('another-symbol')
    expect(EXAMPLES.length - Object.keys(NEEDS_THE_CHARTS_OTHER_SYMBOL).length).toBeGreaterThanOrEqual(10)
  }, 600_000)

  it('⛔ the real-run context is the one the CHART builds: the same five facts, and a symbol with the same fields', () => {
    // read from StockChart.jsx (comments removed): what it hands its binder, and what `symbolMeta` holds
    // StockChart reads its bar arrays through its render box (`__heavy.x` while rendering, `__heavy.committed.x` after a
    // commit: chart/latestCallback.js); `unbox` reads the source as the values it names, so these facts compare values, not spellings.
    const unbox = (t) => t.split('__heavy.committed.').join('').split('__heavy.').join('').replace(/[ \t]*\/\* eslint-disable-line react-hooks\/exhaustive-deps -- the box \(__heavy\)[^*]*\*\//g, '')
    const chart = unbox(fs.readFileSync(path.join(REPO, 'app/src/components/StockChart.jsx'), 'utf8').split(CR).join(''))
    const code = (text) => text.split(LF).map((l) => l.split('//')[0].trim()).filter(Boolean)
    const binder = code(chart.slice(chart.indexOf('registry: engineRegistry,'), chart.indexOf('historyWindowBars:')))
    const FACTS = { sym: 'sym,', symbol: 'symbol: symbolMeta,', tf: 'tf: resolvedTf,', newestBarIsForming: 'newestBarIsForming: data?.newest_bar_is_forming ?? null,', historyFromListing: 'historyFromListing,' }
    for (const line of Object.values(FACTS)) expect(binder, `StockChart no longer hands its binder: ${line}`).toContain(line)
    // (2026-11-19) the memo's deps also name `_firstTradeDate`: the symbol's optional LISTING fact (a conditional spread, so
    // not a `field:` line here). A recipe chart claims no listing, and an absent fact claims none (requestSupply refuses).
    const meta = chart.slice(chart.indexOf('const symbolMeta = useMemo(() => ('), chart.indexOf('), [sym, tickerMeta'))
    expect(meta.length, 'CONTROL: the memo slice ends at its deps').toBeLessThan(2000)
    const fields = [...meta.matchAll(/^\s{6}([a-zA-Z]+):/gm)].map((m) => m[1])
    expect(fields).toEqual(['ticker', 'exchange', 'industry', 'sector', 'securityType'])
    for (const kind of RECIPE_CHARTS) {
      for (const history of RECIPE_HISTORIES) {
        const ctx = recipeContext(kind, history)
        expect(Object.keys(ctx).sort()).toEqual(Object.keys(FACTS).sort())
        expect(typeof ctx.symbol).toBe('object')                       // ⛔ never a string: the run would have no symbol
        expect(Object.keys(ctx.symbol)).toEqual(fields)
        expect(ctx.sym).toBe(ctx.symbol.ticker)
        expect(ctx.historyFromListing).toBe(history === 'fromListing')
      }
    }
    // the exchange is one this engine has a witnessed spelling for
    const scope = JSON.parse(fs.readFileSync(path.join(REPO, 'app/src/components/chart/engine/ast/symbolScope.json'), 'utf8'))
    expect(Object.keys(scope.confirmed)).toContain(recipeContext('daily', 'fromListing').symbol.exchange)
    // CONTROL: the context this harness first used (a string for the symbol) is refused where the chart's is answered
    const stamp = RUN_STOP_PROBES['timestamp-clock'].source
    const pane = memberPaneDefinition({ source: stamp, id: `u_ctx_${n += 1}`, name: 'probe' })
    const withString = nativeRegistry.computeFor(pane.definition, RECIPE_BARS.daily, undefined, { ...recipeContext('daily', 'fromListing'), symbol: 'AMEX:SPY' })
    expect(Object.values(nativeRegistry.columnErrors(withString) || {}).map((e) => e.guard)).toContain('runtime:clock-zone')
    const asTheChart = nativeRegistry.computeFor(pane.definition, RECIPE_BARS.daily, undefined, recipeContext('daily', 'fromListing'))
    expect(Object.values(nativeRegistry.columnErrors(asTheChart) || {}).map((e) => e.guard)).not.toContain('runtime:clock-zone')
  }, 300_000)

  it('the recipe bars are the same bars every time', () => {
    for (const kind of RECIPE_CHARTS) {
      const a = recipeBars(kind), b = recipeBars(kind)
      expect(a).toEqual(b)
      expect(a.every((x) => x.h >= Math.max(x.o, x.c) && x.l <= Math.min(x.o, x.c) && x.v > 0)).toBe(true)
    }
    expect(recipeBars('daily')).toHaveLength(2000)
    expect(recipeBars('intraday')).toHaveLength(40 * 78)
    expect(typeof recipeBars('daily')[0].t).toBe('string')
    expect(typeof recipeBars('intraday')[0].t).toBe('number')
  })
})

// ─── the same recipes behind `asMember`, the shared way to stand behind a member's doors ───────────────
//
// The generator above takes the test grant back by hand, for one script inside one test, because it must
// generate under the grant in the same breath. This describe stands behind the doors the way every other
// suite does (`asMember`, `src/testing/runtimeGate.js`) and asks each recipe again. The two must agree: if a
// door is ever added to the member's side, `asMember` learns it, this goes red, and the generator's own
// narrowing is known to be short by one.
describe('assistantRecipes.json: what the file records for a member is what a member\'s doors give', () => {
  const COMMITTED = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'))
  asMember({
    allow: true, hkd: true,
    admission: Object.fromEntries(RECIPES.map((r) => [runtimeSourceHash(r.source), verdictFor(r.finishedBarsOnly === true)])),
  })
  // (each test hands the grant back: the describes after this one grant in `beforeAll`, and a gate left narrowed
  // here would make that hook look like one that moved the gate behind a test's back, GATE-BLIND)
  afterEach(() => { __resetRuntimeAdmission(); grantRuntimeGate() })

  it('these tests stand behind the member\'s doors, not the grant', () => {
    expect(runtimeAllowList()).toEqual([])
    expect(runtimeCapabilityAdmissionOn()).toBe(true)
    expect(hostKnownDivergenceActive()).toBe(true)
  })

  it('every recipe, forming and finished, on both histories', () => {
    const wrong = []
    for (const r of RECIPES) {
      const row = COMMITTED.recipes.find((x) => x.id === r.id)
      for (const h of RECIPE_HISTORIES) {
        const now = { forming: memberAnswer(r.source, r.chart, h, true), finished: memberAnswer(r.source, r.chart, h, false) }
        if (JSON.stringify(now) !== JSON.stringify(row && row.member && row.member[h])) {
          wrong.push(`${r.id} (${h}): the file says ${JSON.stringify(row && row.member && row.member[h])}, a member's doors give ${JSON.stringify(now)}`)
        }
      }
    }
    expect(wrong).toEqual([])
  }, 900_000)

  it('CONTROL: behind these doors a script with no verdict is not drawn, and one admitted for finished bars only waits', () => {
    const r = RECIPES.find((x) => x.id === 'fibonacci-swings')
    // the same script, one comment longer: another source, so no verdict was latched for it
    const unknown = `${r.source}${LF}// (no verdict for this text)${LF}`
    expect(memberAnswer(unknown, r.chart, 'fromListing', false)).toMatch(/^stopped: /)
    expect(memberAnswer(r.source, r.chart, 'fromListing', true)).toBe(MEMBER_ANSWER.RUNS)
    // the forming-bar rule is live here: a recipe that reads the last bar waits while it forms, and only then
    const waiting = RECIPES.filter((x) => x.finishedBarsOnly === true)
    expect(waiting.map((x) => x.id).sort()).toEqual(['volume-profile', 'weekday-returns-table'])
    for (const w of waiting) {
      expect(memberAnswer(w.source, w.chart, 'fromListing', true), w.id).toBe(MEMBER_ANSWER.WAITS)
      expect(memberAnswer(w.source, w.chart, 'fromListing', false), w.id).toBe(MEMBER_ANSWER.RUNS)
    }
  }, 600_000)
})

describe('assistantGaps.json is the engine\'s own answer on each gap probe', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
  const gaps = (over = {}) => buildAssistantGaps({ probes: GAP_PROBES.probes, verdictOf: gapVerdictOf, ...over })

  it('regenerates byte-for-byte (WRITE_ASSISTANT_PINE_REFERENCE=1 rewrites it)', () => {
    const text = `${JSON.stringify(gaps(), null, 1)}${LF}`
    if (process.env.WRITE_ASSISTANT_PINE_REFERENCE === '1') {
      const named = String(process.env.ASSISTANT_PINE_REFERENCE_CHANGED || '').split(',').map((x) => x.trim()).filter(Boolean)
      expect(staleInputs().filter((rel) => !named.includes(rel)), 'NOT WRITTEN: engine files differ from origin/master').toEqual([])
      fs.writeFileSync(GAPS_FILE, text)
    }
    const committed = fs.existsSync(GAPS_FILE) ? fs.readFileSync(GAPS_FILE, 'utf8').replace(/\r\n/g, LF) : ''
    expect(committed === text,
      'assistantGaps.json is stale: the engine now answers a probe differently. Regenerate it with '
      + 'WRITE_ASSISTANT_PINE_REFERENCE=1 and rebuild GAPS.md (python tools/assistant_gaps_build.py) in the same change.').toBe(true)
  }, 300_000)

  it('every probe is a whole script of a known kind, and a probe that runs carries no refusal', () => {
    const out = gaps()
    expect(out.probes.map((p) => p.id)).toEqual(GAP_PROBES.probes.map((p) => p.id))
    expect(new Set(out.probes.map((p) => p.id)).size).toBe(out.probes.length)
    for (const p of out.probes) {
      expect(GAP_KINDS, p.id).toContain(p.kind)
      expect(p.source.startsWith('//@version=5'), p.id).toBe(true)
      expect(p.source.includes('indicator('), p.id).toBe(true)
      if (p.runs) expect('why' in p || 'guard' in p, p.id).toBe(false)
      else expect((p.why || p.headline).length, p.id).toBeGreaterThan(0)
    }
    // both answers exist today: something the engine serves, and something it does not
    expect(out.probes.some((p) => p.runs)).toBe(true)
    expect(out.probes.some((p) => !p.runs)).toBe(true)
  }, 300_000)

  it('CONTROL: the verdict decides, not the probe list', () => {
    const allRun = gaps({ verdictOf: () => ({ ok: true, lane: 'host', state: 'runs', headline: 'Runs fully' }) })
    expect(allRun.probes.every((p) => p.runs && !('why' in p))).toBe(true)
    const noneRun = gaps({ verdictOf: () => ({ ok: false, lane: 'host', state: 'not-yet', headline: 'Not yet', guard: 'pine:x', family: 'builtin', why: 'no' }) })
    expect(noneRun.probes.every((p) => !p.runs && p.guard === 'pine:x' && p.why === 'no')).toBe(true)
    // "runs with a value withheld" is not "runs"
    const withheld = gaps({ verdictOf: () => ({ ok: true, lane: 'host', state: 'runs-withheld', headline: 'Runs, 1 value withheld', why: 'x' }) })
    expect(withheld.probes.every((p) => !p.runs)).toBe(true)
  })
})

describe('assistantPineReference.json is the current build\'s answer', () => {
  beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })

  it('regenerates byte-for-byte (WRITE_ASSISTANT_PINE_REFERENCE=1 rewrites it)', () => {
    const text = `${JSON.stringify(build(), null, 1)}${LF}`
    if (process.env.WRITE_ASSISTANT_PINE_REFERENCE === '1') {
      const named = String(process.env.ASSISTANT_PINE_REFERENCE_CHANGED || '').split(',').map((x) => x.trim()).filter(Boolean)
      const stale = staleInputs().filter((rel) => !named.includes(rel))
      expect(stale, 'NOT WRITTEN: these engine files differ from origin/master, so the reference would describe '
        + 'another build. Bring the tree up to master (or name a file this change edits on purpose in '
        + 'ASSISTANT_PINE_REFERENCE_CHANGED).').toEqual([])
      fs.writeFileSync(FILE, text)
    }
    const committed = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, LF) : ''
    expect(committed === text,
      'assistantPineReference.json is stale: the engine now serves something else. Regenerate it with '
      + 'WRITE_ASSISTANT_PINE_REFERENCE=1 (see this file\'s header) and commit it with the change.').toBe(true)
  }, 300_000)

  it('every worked example runs fully on the member\'s path: one that did not would teach a script the engine refuses', () => {
    const ref = build()
    expect(ref.examples.length).toBeGreaterThanOrEqual(10)
    for (const e of ref.examples) {
      expect(e.ok, `${e.id}: ${e.headline}`).toBe(true)
      expect(RUNS_STATES, `${e.id}: ${e.state} (${e.headline})`).toContain(e.state)
    }
    // each of the things the assistant could not make before has an example that shows it
    const all = ref.examples.map((e) => e.source).join(LF)
    for (const needle of ['table.new', 'table.cell', 'label.new', 'line.new', 'line.delete', 'box.new', 'fill(', 'plotshape(',
      'bgcolor(', 'barcolor(', 'array.push', 'for ', 'request.security', 'ta.pivothigh', 'input.int', 'str.tostring']) {
      expect(all.includes(needle), needle).toBe(true)
    }
  }, 300_000)

  it('lists a drawing function only for an ADMITTED family, with the engine\'s own parameters', () => {
    const ref = build()
    expect(ref.families).toEqual([...DRAWING_FAMILIES])
    expect(ref.drawing.table.map((o) => o.name)).toEqual(expect.arrayContaining(['table.new', 'table.cell', 'table.clear']))
    expect(ref.drawing.line.find((o) => o.name === 'line.new').params).toEqual(expect.arrayContaining(['x1', 'y1', 'x2', 'y2']))
    const names = Object.values(ref.drawing).flat().map((o) => o.name)
    expect(names.some((x) => x.startsWith('linefill.') || x.startsWith('polyline.'))).toBe(false)
    // take a family's admission away and it is gone, constants and limits with it
    const caps = { ...ALLOWLIST.capabilities, 'obj:table': { ...ALLOWLIST.capabilities['obj:table'], admitted: false } }
    const without = build({ allowlist: { ...ALLOWLIST, capabilities: caps } })
    expect(without.families).toEqual(['line', 'label', 'box'])
    expect(without.drawing.table).toBeUndefined()
    expect(without.admitted).not.toContain('obj:table')
    // and with no array admission there is no array function
    const noArrays = { ...ALLOWLIST.capabilities, 'collections:array': { admitted: false } }
    expect(build({ allowlist: { ...ALLOWLIST, capabilities: noArrays } }).arrays).toEqual([])
    expect(ref.arrays).toEqual(expect.arrayContaining(['array.push', 'array.new_float', 'array.size']))
    expect(ref.arrays.some((x) => x.startsWith('map.') || x.startsWith('matrix.') || x.includes(' '))).toBe(false)
  }, 300_000)

  it('a value function is listed with the call the door itself proved', () => {
    const ref = build()
    const sma = ref.values.find((v) => v.name === 'ta.sma')
    expect(sma && sma.call).toMatch(/^ta\.sma\(/)
    expect(ref.values.length).toBe(Object.values(DOOR_NAMES.names).filter((v) => v.status === 'reachable').length)
    // a name the door does not reach is not listed, whatever TradingView has
    const unreached = Object.entries(DOOR_NAMES.names).find(([, v]) => v.status !== 'reachable')[0]
    expect(ref.values.some((v) => v.name === unreached)).toBe(false)
  }, 300_000)

  /** ⭐⭐ (train e95) A daily chart of the recipe symbol with EVERY data door answering: the corporate-events door
   *  (T4 E2, E1's record shape) and the financial door (T4 F1b, F1a's), each holding one row from the first bar. */
  function doorsAnsweringContext() {
    const bars = RECIPE_BARS.daily
    const sym = recipeContext('daily', 'fromListing').symbol.ticker
    const day = (i) => bars[i].t
    const events = { schema: 'uct.pine-events/v1', symbol: sym, state: 'ready', families: {
      earnings: { state: 'ok', knownFrom: day(0), rows: [{ date: day(100), actual: 1.5, estimate: 1.4 }] },
      dividends: { state: 'ok', knownFrom: day(0), rows: [{ exDate: day(120), gross: 0.77, currency: 'USD' }] },
      splits: { state: 'ok', knownFrom: day(0), rows: [{ date: day(140), numerator: 4, denominator: 1 }] } } }
    const financial = { schema: 'uct.pine-financial/v1', symbol: sym, family: 'financial', familyState: 'ok', state: 'ready',
      refreshedAt: 1, fields: { 'TOTAL_REVENUE:FQ': { state: 'ok', knownFrom: day(0), points: [
        { publicAt: 0, knownFrom: day(0), v: 100, periodEnd: day(0), method: 'direct', staleFrom: '2099-12-31' }] } } }
    return { bars, ctx: { ...recipeContext('daily', 'fromListing'), exchangeOf: () => null, secondary: new Map([
      [EVENTS_KEY, { status: 'available', events, symbol: sym, rev: 1 }],
      [FINANCIAL_KEY, { status: 'available', financial, symbol: sym, rev: '1' }]]) } }
  }

  /** The member's path on one value call: it translates, the paste check runs it, and a real run refuses nothing. */
  function valueCallServed(call, { bars, ctx }) {
    const source = probeScript(call)
    const t = translatePine(source)
    const translated = refusalsOf(t).length === 0 && (t.outputs || []).some((o) => o && !o.refusal && o.formula)
    if (!translated) return `does not translate (${(refusalsOf(t)[0] || {}).guard || 'no output'})`
    const v = verdictOf(source)
    if (!v.ok || !RUNS_STATES.includes(v.state)) return `the paste check does not run it (${v.state}: ${v.headline})`
    const pane = memberPaneDefinition({ source, id: `u_val_${n += 1}`, name: 'probe' })
    let cols
    try { cols = nativeRegistry.computeFor(pane.definition, bars, undefined, ctx) } catch (e) { return `the run threw (${(e && e.guard) || (e && e.message)})` }
    const errs = Object.values(nativeRegistry.columnErrors(cols) || {})
    return errs.length ? `the run refuses it (${errs.map((e) => e.guard).join(', ')})` : null
  }

  it('⭐⭐ (train e95) every value call it hands the assistant translates and is SERVED on the member\'s path', () => {
    // the COMMITTED reference: what the assistant is actually handed, not a rebuild of it
    const committed = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    const doors = doorsAnsweringContext()
    expect(committed.values.length).toBeGreaterThan(100)
    const refused = committed.values.map((v) => [v.name, v.call, valueCallServed(v.call, doors)]).filter(([, , why]) => why)
    expect(refused, refused.map(([name, call, why]) => `${name}: ${call}: ${why}`).join(LF)).toEqual([])
    // each data read the parse rewrites is listed with its whole call, the one its door serves
    for (const name of ['request.earnings', 'request.dividends', 'request.splits', 'request.financial']) {
      const v = committed.values.find((x) => x.name === name)
      if (v) expect(v.call, name).toMatch(/^request\.[a-z]+\(syminfo\.tickerid, /)
    }
  }, 300_000)

  it('CONTROL (train e95): the bare data read the reference once listed passes the paste check and is refused when it runs', () => {
    const doors = doorsAnsweringContext()
    for (const call of ['request.earnings()', 'request.dividends()', 'request.splits()', 'request.financial()']) {
      expect(verdictOf(probeScript(call)).ok, call).toBe(true)
      expect(valueCallServed(call, doors), call).toMatch(/^the run refuses it \(pine:request\)$/)
    }
    // and the same read with its arguments written is served (the control can say yes)
    expect(valueCallServed('request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_off, barmerge.lookahead_on)', doors)).toBe(null)
    // CONTROL: a call the member's install refuses is caught by the paste check
    expect(valueCallServed('ta.highestbars(close)', doors)).toMatch(/^the paste check does not run it/)
  }, 300_000)

  it('an output call is asked of the paste path, and only one that runs is served', () => {
    const ref = build()
    expect(ref.outputs.map((o) => o.name).sort()).toEqual(Object.keys(OUTPUT_PROBES).sort())
    const served = servedOutputs(ref)
    expect(served).toEqual(expect.arrayContaining(['plot', 'plotshape', 'bgcolor', 'barcolor', 'fill']))
    for (const o of ref.outputs) {
      if (!served.includes(o.name)) expect(o.ok && RUNS_STATES.includes(o.state), o.name).toBe(false)
    }
    // CONTROL: a path that refuses everything serves nothing
    const refusing = build({ verdictOf: () => ({ ok: false, lane: 'host', state: 'not-yet', headline: 'Not yet' }) })
    expect(servedOutputs(refusing)).toEqual([])
    expect(refusing.examples.every((e) => e.ok === false)).toBe(true)
    expect(outputProbeScript('plot')).toContain('plot(close')
  }, 300_000)

  it('a pitfall stands only while the engine still does not draw it', () => {
    const ref = build()
    expect(ref.pitfalls.map((p) => p.id)).toEqual(Object.keys(PITFALL_PROBES).sort())
    // today this one stands: untitled plots kept only as fill anchors draw nothing.
    // (Named, not the whole list: a probe added for a shape the engine will withhold LATER stands the day it does.)
    const standing = ref.pitfalls.filter((p) => p.standing).map((p) => p.id)
    expect(standing).toContain('untitled-fill-anchor')
    // ⭐ e96 (HLINE_DEFAULTS[3|4|5], Q-HLINE-3 witnessed by #2596's vw-hline-defaults-v{3,4,5}): the v5 `hline` probe
    // now runs fully (drawn in TradingView's witnessed default, nothing withheld), so its pitfall no longer stands.
    // It stood while v5's default colour, style and width were unwitnessed ("pine:colour-default-unwitnessed").
    expect(standing).not.toContain('hline')
    // and standing is exactly "the probe did not run fully", for every probe
    for (const p of ref.pitfalls) expect(p.standing, p.id).toBe(!RUNS_STATES.includes(p.state))
    // CONTROL: on an engine that runs everything, no pitfall stands
    const running = build({ verdictOf: () => ({ ok: true, lane: 'host', state: 'runs', headline: 'Runs fully' }) })
    expect(running.pitfalls.every((p) => p.standing === false)).toBe(true)
  }, 300_000)

  it('the stale-tree check can tell a file that matches master from one that does not', () => {
    const lf = Buffer.from(`a${LF}b${LF}`)
    const crlf = Buffer.from(`a${CR}${LF}b${CR}${LF}`)
    const sha = blobId(lf)
    expect(sha).toBe('422c2b7ab3b3c668038da977e4e93a5fc623169c')          // what `git hash-object` gives for those bytes
    expect(sameAsBlob(lf, sha)).toBe(true)
    expect(sameAsBlob(crlf, sha)).toBe(true)                                // a checkout's line endings are not a difference
    expect(sameAsBlob(Buffer.from(`a${LF}c${LF}`), sha)).toBe(false)        // one changed line is
    expect(sameAsBlob(null, sha)).toBe(false)                               // a file that is missing here is
  })

  it('every colour function it lists is one a script can call (an engine-internal step never is)', () => {
    const ref = build()
    expect(ref.colours).toEqual(expect.arrayContaining(['color.new', 'color.rgb', 'color.from_gradient']))
    for (const name of ref.colours) expect(name, name).toMatch(/^[A-Za-z_][A-Za-z0-9_.]*$/)
  }, 300_000)
  it('names the engine refuses are listed apart, never among what is served', () => {
    const ref = build()
    expect(ref.refusedNames).toEqual(expect.arrayContaining(['barstate.isnew', 'syminfo.type']))
    for (const name of ref.refusedNames) {
      expect(ref.barstate.includes(name) || ref.symbol.includes(name) || ref.values.some((v) => v.name === name), name).toBe(false)
    }
  }, 300_000)
})
