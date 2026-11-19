// app/src/components/chart/builder/runsHere.test.js
//
// `runsHere.js`: the ONE authority for "does this script run on this chart". Held here to the real
// engine on the scripts that showed the gap: each PASSES the member's paste check and is refused by
// the run. And held to the chart's own notice strip: the sentences are the functions the binder
// asks, in the binder's order.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as registry from '../engine/nativeRegistry'
import { inspectSource } from './PineBox'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition'
import { editorStatus } from './editorStatus'
import { verdictFrom, RUNS_STATES } from './authoring/scriptAnswer'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../engine/runtimeKill'
import { setRuntimeRunner, computeRuntimeColumns } from '../engine/runtime/runtimeColumns'
import { recipeBars, recipeContext, RUN_STOP_PROBES } from '../supportLoop/assistantRecipes'
import { steadyRunClock } from '../supportLoop/testing/steadyRunClock'
import {
  runHere, runHereWhenLanded, verdictOnChart, RUN, MIN_BARS, NEEDS_THE_CHART, STOPPED_HEADLINE, CHECKING_HEADLINE,
  NOT_RUN_HEADLINE, sortFindings, WAITS_FOR_THE_BAR,
} from './runsHere'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
// (a script is run on a chart only where member scripts are drawn at all: `runsHere.js` asks the gate first)
vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')

const LF = String.fromCharCode(10)
const SUPPORT = path.resolve(process.cwd(), 'src/components/chart/supportLoop')
const recipe = (id) => fs.readFileSync(path.join(SUPPORT, 'assistantRecipes', `${id}.pine`), 'utf8')
const example = (id) => fs.readFileSync(path.join(SUPPORT, 'assistantExamples', `${id}.pine`), 'utf8')
const BARS = recipeBars('daily')
const chart = (history, bars = BARS) => ({ bars, ctx: recipeContext('daily', history) })
let made = 0
const paneOf = (source) => memberPaneDefinition({ source, id: `u_runs_here_${made += 1}`, name: 'script' })
/** What the member's paste check says, as the dock words it. */
const pasteVerdict = (source, pane) => verdictFrom(
  editorStatus({ report: inspectSource(source, 'pine'), pane, savedRow: null, inspectedSource: source }), pane)

const RUNNING_TOTAL = RUN_STOP_PROBES['running-total'].source
const TIMESTAMP = RUN_STOP_PROBES['timestamp-clock'].source
// A loop that never ends ON ANY ENGINE: its counter never moves. (Until 2026-11-19 this was a one-call
// `label.delete(array.shift(xs))` trim inside a `while`, which never ended only because of an engine
// defect; engine train 82 fixed the defect and the "endless" script ran. An example must not lean on a bug.)
const ENDLESS = ['//@version=5', 'indicator("probe", overlay=true)', 'var label[] xs = array.new_label(0)',
  'if close > close[1]', '    array.push(xs, label.new(bar_index, high, "a"))',
  'int turns = 0', 'int stuck = 0', 'while stuck < 1', '    turns := turns + 1',
  'plot(array.size(xs) + turns, "Labels kept")'].join(LF) + LF

beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
afterEach(() => { setRuntimeRunner(null) })
// a stepping clock (`supportLoop/testing/steadyRunClock.js`): these run whole recipes and assert what the
// engine SAID, and a run stopped by the wall clock on a busy box would be a stop nobody wrote
let runClock = null
beforeEach(() => { runClock = steadyRunClock() })
afterEach(() => { if (runClock) runClock.restore(); runClock = null })

describe('the member-pane gate is asked before anything is run', () => {
  it('with the gate off there is no run and no verdict from one: the engine is never called', () => {
    const pane = paneOf(RUNNING_TOTAL)
    let computed = 0
    const compute = (...args) => { computed += 1; return registry.computeFor(...args) }
    // CONTROL: with the gate on, this script on this chart is run, and stopped
    expect(runHere(pane, { ...chart('offListing'), compute }).state).toBe(RUN.STOPPED)
    expect(computed).toBe(1)
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '0')
    try {
      const off = runHere(pane, { ...chart('offListing'), compute })
      expect(off.state).toBe(RUN.NOT_RUN)
      expect(off.stops).toEqual([])
      expect(off.why).toBe('this build does not draw member scripts on charts')
      expect(computed).toBe(1)                                        // not called again
      // and a paste verdict joined with it is the paste verdict: a run that did not happen takes nothing away
      const pasted = pasteVerdict(RUNNING_TOTAL, pane)
      expect(verdictOnChart(pasted, off).runs).toBe(pasted.runs)
    } finally {
      vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    }
  })
})

describe('a script the paste check passes and the run refuses', () => {
  it('a running total: "runs" by the paste check, STOPPED by name on a chart that does not reach the listing', () => {
    const pane = paneOf(RUNNING_TOTAL)
    const pasted = pasteVerdict(RUNNING_TOTAL, pane)
    expect(pasted.runs).toBe(true)                                       // ⛔ what a member is told today
    expect(RUNS_STATES).toContain(pasted.state)
    const off = runHere(pane, chart('offListing'))
    expect(off.state).toBe(RUN.STOPPED)
    expect(off.stops.map((s) => s.guard)).toEqual(['runtime:warmup-never-converges'])
    expect(off.stops[0].sentence).toMatch(/depends on where the chart begins/)
    // the same script on a chart whose history reaches the listing runs: the stop is about THIS chart
    const from = runHere(pane, chart('fromListing'))
    expect(from.state).toBe(RUN.RAN)
    expect(from.stops).toEqual([])
  }, 120_000)

  it('a clock read (`timestamp`), and a loop that never ends: each stopped by the engine\'s own name', () => {
    // a clock read is answered on a chart whose symbol (with its exchange) the run is handed, and stopped
    // by name when it is handed none: the run must get the chart's own context, never a stand-in
    expect(runHere(paneOf(TIMESTAMP), chart('fromListing')).state).toBe(RUN.RAN)
    const noSymbol = { bars: BARS, ctx: { ...recipeContext('daily', 'fromListing'), symbol: null } }
    const clock = runHere(paneOf(TIMESTAMP), noSymbol)
    expect(clock.state).toBe(RUN.STOPPED)
    expect(clock.stops.map((s) => s.guard)).toEqual(['runtime:clock-zone'])
    const pane = paneOf(ENDLESS)
    expect(pasteVerdict(ENDLESS, pane).runs).toBe(true)
    const loop = runHere(pane, chart('fromListing'))
    expect(loop.state).toBe(RUN.STOPPED)
    // two sentences, both the engine's: the run stopped, and its drawings belong to that run
    expect(loop.stops.map((s) => s.guard)).toEqual(['runtime:limit', 'runtime:objects-without-run'])
    expect(loop.stops[0].sentence).toMatch(/number of passes one `while` loop may make/)
  }, 120_000)

  it('CONTROL: proven recipes RAN on both histories, with the warm-up said as a note where there is one', () => {
    for (const id of ['zigzag-percent', 'supply-demand-zones', 'volume-profile', 'rsi-divergence']) {
      for (const history of ['fromListing', 'offListing']) {
        const out = runHere(paneOf(recipe(id)), chart(history))
        expect(out.state, `${id} ${history}: ${JSON.stringify(out.stops)}`).toBe(RUN.RAN)
        expect(out.stops).toEqual([])
      }
    }
    const warm = runHere(paneOf(recipe('supply-demand-zones')), chart('offListing'))
    expect(warm.notes.some((n) => /Its values are drawn from bar \d+ on/.test(n))).toBe(true)
    expect(runHere(paneOf(recipe('supply-demand-zones')), chart('fromListing')).notes).toEqual([])
  }, 120_000)

  it('a script that reads another symbol is UNCHECKED beside the chart, never stopped', () => {
    const out = runHere(paneOf(example('another-symbol')), chart('fromListing'))
    expect(out.state).toBe(RUN.RAN)
    expect(out.stops).toEqual([])
    expect(out.unchecked.map((u) => u.guard)).toEqual(['other-symbol:bare'])
    expect(NEEDS_THE_CHART).toContain('other-symbol:bare')
    const said = verdictOnChart({ runs: true, withheld: [], notes: [], errors: [], headline: 'Runs' }, out)
    expect(said.runs).toBe(true)
    expect(said.notes.join(' ')).toMatch(/Not checked here \(other-symbol:bare\)/)
  }, 120_000)

  it('a refusal the engine THROWS is a stop too, in its own words, and a crash is never "ran"', () => {
    const pane = paneOf(RUNNING_TOTAL)
    const refusal = Object.assign(new Error('this script took more than 1000 ms to draw bar by bar, so it is stopped.'), { guard: 'runtime:time-budget' })
    const thrown = runHere(pane, { ...chart('fromListing'), compute: () => { throw refusal } })
    expect(thrown.state).toBe(RUN.STOPPED)
    expect(thrown.stops).toEqual([{ guard: 'runtime:time-budget', sentence: 'this script took more than 1000 ms to draw bar by bar, so it is stopped.' }])
    const crash = runHere(pane, { ...chart('fromListing'), compute: () => { throw new Error('boom') } })
    expect(crash.state).toBe(RUN.STOPPED)
    expect(crash.stops).toEqual([{ guard: 'run:threw', sentence: 'boom' }])
    expect(runHere(pane, { ...chart('fromListing'), compute: () => null }).state).toBe(RUN.NOT_RUN)
  })

  it('nothing to run on is NOT "ran": no definition, or a chart still loading', () => {
    const pane = paneOf(RUNNING_TOTAL)
    expect(runHere({ ok: false }, chart('offListing')).state).toBe(RUN.NOT_RUN)
    expect(runHere(null, chart('offListing')).state).toBe(RUN.NOT_RUN)
    expect(runHere(pane, { bars: BARS.slice(0, MIN_BARS - 1), ctx: recipeContext('daily', 'offListing') }).state).toBe(RUN.NOT_RUN)
    expect(runHere(pane, {}).state).toBe(RUN.NOT_RUN)
    expect(runHere(pane, { bars: null, ctx: null }).state).toBe(RUN.NOT_RUN)
  })
})

describe('what it says IS what the chart would say', () => {
  it('the sentence of a stopped run is the engine function\'s own, the one the notice strip shows', () => {
    const pane = paneOf(RUNNING_TOTAL)
    const cols = registry.computeFor(pane.definition, BARS, undefined, recipeContext('daily', 'offListing'))
    const strip = registry.runtimeRunStopOf(pane.definition, cols)
    expect(strip && strip.guard).toBe('runtime:warmup-never-converges')
    expect(runHere(pane, chart('offListing')).stops).toEqual([{ guard: strip.guard, sentence: strip.sentence.replace(/\s+/g, ' ').trim() }])
  }, 120_000)

  it('the binder still asks the same four functions in the same order (comments removed)', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/binder.js'), 'utf8')
    const from = src.indexOf('const noteRuntimeErrorStop = ')
    expect(from).toBeGreaterThan(0)
    const body = src.slice(from, src.indexOf('setRuntimeErrorNotice(instanceId, sentence, noticeScope)', from))
      .split(LF).map((l) => l.split('//')[0]).join(LF)
    const order = ['runtimeErrorStopOf(cols)', 'runtimeRunStopOf(def, cols)', 'runtimeColourStopOf(def, cols)', 'hostLaneStopOf(cols)']
      .map((call) => body.indexOf(call))
    expect(order.every((i) => i > 0), `one of the four is gone from the binder: ${order}`).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // and this module asks them in that order too
    const mine = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/builder/runsHere.js'), 'utf8')
      .split(LF).map((l) => l.split('//')[0]).join(LF)
    const own = ['runtimeErrorStopOf(cols)', 'runtimeRunStopOf(def, cols)', 'runtimeColourStopOf(def, cols)', 'hostLaneStopOf(cols)']
      .map((call) => mine.indexOf(call))
    expect(own.every((i) => i > 0)).toBe(true)
    expect([...own].sort((a, b) => a - b)).toEqual(own)
  })
})

describe('a run handed to a worker is waited for, never repeated and never called "runs"', () => {
  it('pending until its columns land, then the engine\'s answer', async () => {
    const jobs = []
    setRuntimeRunner((def, rows, ctx, done) => { jobs.push({ def, rows, ctx, done }) })
    const pane = paneOf(RUNNING_TOTAL)
    expect(runHere(pane, chart('offListing')).state).toBe(RUN.PENDING)
    const waited = runHereWhenLanded(pane, chart('offListing'), { timeoutMs: 20_000 })
    expect(jobs).toHaveLength(1)                                         // asked for once, not once per look
    const { def, rows, ctx, done } = jobs[0]
    let cols = null, err = null
    try { cols = computeRuntimeColumns(def, rows, ctx) } catch (e) { err = e }
    done(err, cols)                                                      // what the worker does when it finishes
    const out = await waited
    expect(out.state).toBe(RUN.STOPPED)
    expect(out.stops.map((s) => s.guard)).toEqual(['runtime:warmup-never-converges'])
    expect(jobs).toHaveLength(1)
  }, 120_000)

  it('a run that does not land in time is PENDING, and PENDING is never "runs"', async () => {
    setRuntimeRunner(() => { /* a worker that never answers */ })
    const pane = paneOf(recipe('zigzag-percent'))
    const out = await runHereWhenLanded(pane, chart('fromListing'), { timeoutMs: 30 })
    expect(out.state).toBe(RUN.PENDING)
    const said = verdictOnChart({ runs: true, withheld: [], notes: [], errors: [], headline: 'Runs on the chart' }, out)
    expect(said.runs).toBe(false)
    expect(said.headline).toBe(CHECKING_HEADLINE)
    expect(said.errors).toEqual([])                                      // nothing to send back for repair: nothing was refused
  }, 60_000)

  it('a run that is not pending resolves at once and subscribes to nothing', async () => {
    let subscribed = 0
    const out = await runHereWhenLanded(paneOf(recipe('gap-zones')), chart('fromListing'),
      { onLanded: () => { subscribed += 1; return () => {} } })
    expect(out.state).toBe(RUN.RAN)
    expect(subscribed).toBe(0)
  }, 60_000)
})

describe('the verdict a member sees, joined with the run', () => {
  const pasted = { runs: true, attaches: true, state: 'runs-with-notes', lane: 'runtime', headline: 'Runs on the chart, with 1 note',
    withheld: [], notes: ['Drawn bar by bar.'], errors: [] }
  const stop = { guard: 'runtime:warmup-never-converges', sentence: 'Its values depend on where the chart begins.' }

  it('a stopped run takes "runs" away, leads with the engine\'s sentence and sends it back for repair', () => {
    const v = verdictOnChart(pasted, { state: RUN.STOPPED, stops: [stop], unchecked: [], notes: [] })
    expect(v.runs).toBe(false)
    expect(v.headline).toBe(STOPPED_HEADLINE)
    expect(v.withheld).toEqual([stop.sentence])
    expect(v.errors).toEqual([stop.sentence])
    expect(v.notes).toEqual(pasted.notes)
    expect(v.ranHere).toBe(RUN.STOPPED)
    const long = verdictOnChart(pasted, { state: RUN.STOPPED, stops: [{ guard: 'g', sentence: 'x'.repeat(900) }], unchecked: [], notes: [] }, { maxChars: 300 })
    expect(long.errors[0]).toHaveLength(300)
  })

  it('a run that ran keeps the paste verdict and adds its own notes; a run with nothing to run on changes nothing but says so', () => {
    const ran = verdictOnChart(pasted, { state: RUN.RAN, stops: [], unchecked: [], notes: ['Its values are drawn from bar 965 on.'] })
    expect(ran.runs).toBe(true)
    expect(ran.headline).toBe(pasted.headline)
    expect(ran.notes).toEqual(['Drawn bar by bar.', 'Its values are drawn from bar 965 on.'])
    // ⛔ a script that was NOT run is never headlined "runs" (review 2026-11-19: the only mark was a field nobody read)
    const none = verdictOnChart(pasted, { state: RUN.NOT_RUN, stops: [], unchecked: [], notes: [], why: 'the chart has no bars to run it on yet' })
    expect(none).toEqual({ ...pasted, ranHere: RUN.NOT_RUN, notRun: true, headline: NOT_RUN_HEADLINE,
      notes: ['It was not run here (the chart has no bars to run it on yet). Open it in the editor on a chart to see it run.', ...pasted.notes] })
    expect(none.runs).toBe(true)                                     // the check passed: nothing to repair
    expect(verdictOnChart(pasted, { state: RUN.NOT_RUN, stops: [], unchecked: [], notes: [] }).notes[0])
      .toBe('It was not run here (there was no chart to run it on). Open it in the editor on a chart to see it run.')
  })

  it('⛔ a run never GIVES "runs" to a script the paste check refused', () => {
    const refused = { ...pasted, runs: false, state: 'not-yet', headline: 'Not yet: Inputs', errors: ['an input it cannot hold'] }
    for (const state of Object.values(RUN)) {
      const v = verdictOnChart(refused, { state, stops: [], unchecked: [], notes: [] })
      expect(v.runs).toBe(false)
      expect(v.headline).toBe('Not yet: Inputs')
      expect(v.errors).toEqual(['an input it cannot hold'])
    }
    expect(verdictOnChart(null, { state: RUN.RAN })).toBe(null)
    expect(verdictOnChart(pasted, null)).toBe(pasted)
  })
})

// ─── what a run found, sorted (review 2026-11-19) ─────────────────────────────────────
describe('a forming-bar refusal is "waiting" however it arrives', () => {
  const FORMING = WAITS_FOR_THE_BAR[0]

  it('by the run\'s own guard, by the code a column carries, and by the drawings that belong to that run', () => {
    const out = sortFindings([
      { guard: FORMING, sentence: 'not drawn on this chart (pane:forming-ungraded): the bar is forming', code: null },
      { guard: 'runtime:colour-not-served', sentence: 'The colours from `bgcolor` aren\'t shown on this chart.', code: FORMING },
      { guard: 'runtime:objects-without-run', sentence: 'This script\'s drawings are not drawn: its run computed nothing.', code: FORMING },
    ])
    expect(out.state).toBe(RUN.RAN)
    expect(out.stops).toEqual([])
    expect(out.waiting.map((w) => w.guard)).toEqual([FORMING, 'runtime:colour-not-served', 'runtime:objects-without-run'])
    expect(Object.keys(out.waiting[0]).sort()).toEqual(['guard', 'sentence'])      // the code is the sorter's, not the reader's
  })

  it('CONTROL: the same guards with no forming code are stops, and one real stop makes the run STOPPED', () => {
    const colours = { guard: 'runtime:colour-not-served', sentence: 'not shown', code: 'runtime:time-budget' }
    const drawings = { guard: 'runtime:objects-without-run', sentence: 'not drawn', code: null }
    expect(sortFindings([colours]).state).toBe(RUN.STOPPED)
    expect(sortFindings([drawings]).stops.map((s) => s.guard)).toEqual(['runtime:objects-without-run'])
    const mixed = sortFindings([{ guard: FORMING, sentence: 'forming', code: null }, drawings])
    expect(mixed.state).toBe(RUN.STOPPED)
    expect(mixed.waiting).toHaveLength(1)
    expect(mixed.stops).toHaveLength(1)
    // what the chart has not handed the run is never "waiting" and never a stop
    const other = sortFindings([{ guard: NEEDS_THE_CHART[0], sentence: 'needs SPY', code: FORMING }])
    expect(other).toEqual({ state: RUN.RAN, stops: [], unchecked: [{ guard: NEEDS_THE_CHART[0], sentence: 'needs SPY' }], waiting: [] })
    expect(sortFindings(null)).toEqual({ state: RUN.RAN, stops: [], unchecked: [], waiting: [] })
  })
})

describe('the run itself sorts a forming-bar refusal as waiting, on each path it arrives by', () => {
  const FORMING = WAITS_FOR_THE_BAR[0]
  const SAID = 'this script reads the state of the bar as it forms, so it is not drawn bar by bar while the newest bar is still forming'
  /** What the engine hands back for a run it refused: no columns, and each output's refusal beside them. */
  const refusedCols = (errors) => Object.defineProperty({}, '__columnErrors', { value: Object.freeze(errors), enumerable: false })
  const run = (definition, errors) => runHere({ ok: true, definition }, { ...chart('fromListing'), compute: () => refusedCols(errors) })

  it('a script with a drawing program: its drawings wait with the run, they are not a second thing wrong', () => {
    const def = { id: 'u_w1', compute: { kind: 'runtime', outputs: { value: {} } }, objects: { ops: [{ kind: 'label' }] } }
    const out = run(def, { value: { guard: FORMING, message: SAID } })
    expect(out.state).toBe(RUN.RAN)
    expect(out.stops).toEqual([])
    expect(out.waiting.map((w) => w.guard)).toEqual([FORMING, 'runtime:objects-without-run'])
    expect(verdictOnChart({ runs: true, withheld: [], notes: [], errors: [], headline: 'Runs' }, out).waits).toBe(true)
  })

  it('CONTROL: the same script refused for another reason is STOPPED, drawings and all', () => {
    const def = { id: 'u_w2', compute: { kind: 'runtime', outputs: { value: {} } }, objects: { ops: [{ kind: 'label' }] } }
    const out = run(def, { value: { guard: 'runtime:time-budget', message: 'this script took more than 1000 ms' } })
    expect(out.state).toBe(RUN.STOPPED)
    expect(out.waiting).toEqual([])
    expect(out.stops.map((x) => x.guard)).toEqual(['runtime:time-budget', 'runtime:objects-without-run'])
  })

  it('a column refused under its own guard with the forming bar as its CODE waits too', () => {
    const def = { id: 'u_w3', compute: { kind: 'ast', outputs: { value: {} } } }
    const cols = Object.defineProperty({ value: new Float64Array(BARS.length) }, '__columnErrors',
      { value: Object.freeze({ tint: { guard: 'runtime:colour-not-served', code: FORMING, message: SAID } }), enumerable: false })
    const out = runHere({ ok: true, definition: def }, { ...chart('fromListing'), compute: () => cols })
    expect(out.state).toBe(RUN.RAN)
    expect(out.waiting.map((w) => w.guard)).toEqual(['runtime:colour-not-served'])
    // CONTROL: with any other code it is a stop
    const other = Object.defineProperty({ value: new Float64Array(BARS.length) }, '__columnErrors',
      { value: Object.freeze({ tint: { guard: 'runtime:colour-not-served', code: 'runtime:time-budget', message: 'x' } }), enumerable: false })
    expect(runHere({ ok: true, definition: def }, { ...chart('fromListing'), compute: () => other }).state).toBe(RUN.STOPPED)
  })
})
