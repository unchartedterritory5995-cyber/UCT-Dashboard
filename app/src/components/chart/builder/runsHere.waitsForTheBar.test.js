// app/src/components/chart/builder/runsHere.waitsForTheBar.test.js
//
// ─── ⭐ EVERY SCRIPT THE ASSISTANT IS SHOWN, RUN WITH THE NEWEST BAR STILL FORMING ────────
//
// ⚰️ Found live 2026-11-19. Every recipe and worked example was proven on a chart whose newest bar had
// FINISHED (`recipeContext`: `newestBarIsForming: false`) and under the test grant that lets any script
// onto the bar-by-bar lane. A member's chart has neither: the server admits a script by the capabilities
// it uses, and one that reads where the chart ends (`barstate.islast` and its like) is admitted for
// finished bars only (G6, `engine/runtimeKill.js`). So three recipes and three examples ran before the
// open and were refused all session long, on the chart of the member who asked for them; the refusal
// was then sent back for a repair that could not help, and shown as "does not run ... open it to fix it".
//
// This file runs each one the way a member's window does:
//   * no test grant: the script is admitted by a verdict latched the way the server's answer is, with
//     `historyOnly` exactly where the recipe index DECLARES it (`finishedBarsOnly`; the server's own
//     detector holds that declaration to its answer, `tests/test_pine_authoring.py`);
//   * the chart's newest bar FORMING, on both histories.
// A script that does not wait for the last bar must RUN. One that declares it does is reported as WAITING:
// not stopped, not repaired, under a headline that says what the member will see.

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as registry from '../engine/nativeRegistry'
import { RUNTIME_OBJECTS_KEY } from '../engine/runtime/runtimeObjects'
import { inspectSource } from './PineBox'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition'
import { editorStatus, PANEL_STATE } from './editorStatus'
import { verdictFrom, refusalOf } from './authoring/scriptAnswer'
import { shownStatus, SHOWN_STATE } from './PineEditorStatus'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import {
  __resetRuntimeAllowList, __resetRuntimeAdmission, __allowEveryRuntimeScriptForTests, runtimeAllowList,
  runtimeCapabilityAdmissionOn, latchRuntimeLists, latchRuntimeAdmission, runtimeSourceHash, RUNTIME_FORMING_GUARD,
} from '../engine/runtimeKill'
import { recipeBars, recipeContext, RECIPE_HISTORIES } from '../supportLoop/assistantRecipes'
import RECIPES from '../supportLoop/assistantRecipes.json'
import REFERENCE from '../supportLoop/assistantPineReference.json'
import { steadyRunClock } from '../supportLoop/testing/steadyRunClock'
import { runHere, verdictOnChart, RUN, WAITS_FOR_THE_BAR, WAITING_HEADLINE, WAITING_LINE, STOPPED_HEADLINE } from './runsHere'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')

const BARS = { daily: recipeBars('daily'), intraday: recipeBars('intraday') }
let made = 0
const paneOf = (source) => memberPaneDefinition({ source, id: `u_waits_${made += 1}`, name: 'script' })
const pasteVerdict = (source, pane) => verdictFrom(
  editorStatus({ report: inspectSource(source, 'pine'), pane, savedRow: null, inspectedSource: source }), pane)
/** The chart a member is on during the session: the same bars, the newest one still forming. */
const chart = (kind, history, forming) => ({ bars: BARS[kind], ctx: { ...recipeContext(kind, history), newestBarIsForming: forming } })
/** The server's admission answer for a script, latched the way the window latches it. */
const admit = (source, historyOnly) => latchRuntimeAdmission(runtimeSourceHash(source), { admitted: true, historyOnly })

/** Every script the assistant is shown that the bar-by-bar lane draws: {id, kind, chart, source, waits}. */
const SHOWN = [
  ...RECIPES.recipes.filter((r) => r.served && r.lane === 'runtime')
    .map((r) => ({ id: r.id, kind: 'recipe', chart: r.chart, source: r.source, waits: r.finishedBarsOnly === true })),
  ...REFERENCE.examples.filter((e) => e.ok && e.lane === 'runtime')
    .map((e) => ({ id: e.id, kind: 'example', chart: 'daily', source: e.source, waits: false })),
]

// ⛔ IN `beforeEach`, NOT `beforeAll`: `src/test-setup.js` hands every test the grant that lets any script onto
// the lane, before each one. Set once, the member's real admission below would be gone by the first test, and
// every script would "run" under the grant (which is how these were proven before, and why nobody saw it).
beforeAll(() => { __permitRuntimePaneForTests() })
beforeEach(() => {
  __resetRuntimeAllowList()            // no test grant: a script is drawn only by its own verdict
  __resetRuntimeAdmission()
  latchRuntimeLists({ kill: [], allow: [], capability_admission: true })
})
afterAll(() => { __resetRuntimeAdmission(); __allowEveryRuntimeScriptForTests() })
let runClock = null
beforeEach(() => { runClock = steadyRunClock() })
afterEach(() => { if (runClock) runClock.restore(); runClock = null })

describe('on a chart whose newest bar is still forming', () => {
  it('there are scripts of both kinds to judge, and the declared ones are the only ones that wait', () => {
    expect(SHOWN.length).toBeGreaterThanOrEqual(12)
    expect(SHOWN.filter((s) => s.waits).map((s) => s.id).sort()).toEqual(['volume-profile', 'weekday-returns-table'])
    expect(SHOWN.some((s) => s.kind === 'example')).toBe(true)
    expect(WAITS_FOR_THE_BAR).toEqual([RUNTIME_FORMING_GUARD])
    // the member's real gate is what these run under: no grant, admission by capability on
    expect(runtimeAllowList()).toEqual([])
    expect(runtimeCapabilityAdmissionOn()).toBe(true)
    expect(REFERENCE.historyOnly).toContain('realtime-state')
  })

  it('⛔ every script that does not wait for the last bar RUNS, on both histories, with nothing stopped', () => {
    const wrong = []
    for (const s of SHOWN.filter((x) => !x.waits)) {
      admit(s.source, false)
      for (const history of RECIPE_HISTORIES) {
        const out = runHere(paneOf(s.source), chart(s.chart, history, true))
        if (out.state !== RUN.RAN || out.stops.length || out.waiting.length) {
          wrong.push(`${s.kind} ${s.id} (${history}): ${out.state} ${JSON.stringify(out.stops.concat(out.waiting).map((x) => x.guard))} ${out.why || ''}`)
        }
      }
    }
    expect(wrong).toEqual([])
  }, 900_000)

  it("CONTROL: these run under the member's gate, not the test grant: a script with no admission verdict is not drawn", () => {
    const s = SHOWN.find((x) => x.id === 'fibonacci-swings')
    const pane = paneOf(s.source)                         // (nothing latched for it in this test)
    const out = runHere(pane, chart(s.chart, 'fromListing', true))
    expect({ ok: pane.ok, state: out.state, stops: out.stops.length }).not.toEqual({ ok: true, state: RUN.RAN, stops: 0 })
    // and a script the server REFUSED is not drawn either
    latchRuntimeAdmission(runtimeSourceHash(s.source), { admitted: false, historyOnly: false })
    const refused = paneOf(s.source)
    const again = runHere(refused, chart(s.chart, 'fromListing', true))
    expect({ ok: refused.ok, state: again.state, stops: again.stops.length }).not.toEqual({ ok: true, state: RUN.RAN, stops: 0 })
  }, 300_000)

  it('a script that DECLARES it waits is reported as waiting: never stopped, never sent for repair', () => {
    for (const s of SHOWN.filter((x) => x.waits)) {
      admit(s.source, true)
      for (const history of RECIPE_HISTORIES) {
        const pane = paneOf(s.source)
        const out = runHere(pane, chart(s.chart, history, true))
        expect(out.state, `${s.id} ${history}: ${JSON.stringify(out.stops)}`).toBe(RUN.RAN)
        expect(out.stops).toEqual([])
        expect(out.waiting.map((w) => w.guard)).toEqual([RUNTIME_FORMING_GUARD])
        expect(out.waiting[0].sentence).toMatch(/newest bar is still forming/)
        // what the dock and the builder's box say, and that no repair is asked for
        const said = verdictOnChart(pasteVerdict(s.source, pane), out)
        expect(said.runs).toBe(true)
        expect(said.waits).toBe(true)
        expect(said.headline).toBe(WAITING_HEADLINE)
        expect(said.headline).not.toBe(STOPPED_HEADLINE)
        expect(said.notes[0]).toBe(WAITING_LINE)
        expect(said.notes[1]).toBe(out.waiting[0].sentence)
        expect(said.errors).toEqual([])
        expect(refusalOf({ pine: s.source, round: 0 }, said)).toBe(null)
        // and the same script on the same chart once the bar has finished: drawn, nothing waiting
        const closed = runHere(paneOf(s.source), chart(s.chart, history, false))
        expect(closed.state, `${s.id} ${history} finished`).toBe(RUN.RAN)
        expect(closed.waiting).toEqual([])
        expect(verdictOnChart(pasteVerdict(s.source, pane), closed).waits).toBeUndefined()
      }
    }
  }, 900_000)

  it('a chart that cannot say whether its newest bar has finished waits too (the engine fails closed)', () => {
    const s = SHOWN.find((x) => x.id === 'volume-profile')
    admit(s.source, true)
    const out = runHere(paneOf(s.source), chart(s.chart, 'fromListing', null))
    expect(out.state).toBe(RUN.RAN)
    expect(out.waiting.map((w) => w.guard)).toEqual([RUNTIME_FORMING_GUARD])
    expect(out.waiting[0].sentence).toMatch(/cannot say yet whether its newest bar has finished/)
  }, 300_000)

  it('CONTROL: a real stop on a forming bar is still a stop, and is not hidden behind "waiting"', () => {
    const total = ['//@version=5', 'indicator("probe")', 'var float total = 0.0', 'total := total + volume', 'plot(total, "Total")'].join(String.fromCharCode(10)) + String.fromCharCode(10)
    admit(total, false)
    const out = runHere(paneOf(total), chart('daily', 'offListing', true))
    expect(out.state).toBe(RUN.STOPPED)
    expect(out.waiting).toEqual([])
    const said = verdictOnChart(pasteVerdict(total, paneOf(total)), out)
    expect(said.runs).toBe(false)
    expect(said.headline).toBe(STOPPED_HEADLINE)
  }, 300_000)
})

// ─── updated on every bar, on a LONG chart ────────────────────────────────────────────
// A script that updates its drawings on every bar must not pile them up: the lines, labels and boxes are made
// once and MOVED with their setters, so a 5,000-bar chart holds exactly as many as a 300-bar one, and none is
// withheld by the per-kind limits. (The run's wall time is not asserted here, a busy runner would decide it;
// measured 2026-11-19 on 5,000 bars against the one-second budget: about a tenth to a sixth of it.)
function longChart(count) {
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const out = []
  let close = 100
  const day = new Date(Date.UTC(2005, 0, 3))
  const two = (n) => String(n).padStart(2, '0')
  while (out.length < count) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const o = close * (1 + (rnd() - 0.5) * 0.01)
      close = o * (1 + (rnd() - 0.49) * 0.04)
      out.push({ t: `${day.getUTCFullYear()}-${two(day.getUTCMonth() + 1)}-${two(day.getUTCDate())}`, o,
        h: Math.max(o, close) * (1 + rnd() * 0.01), l: Math.min(o, close) * (1 - rnd() * 0.01), c: close, v: Math.round(1e6 * (1 + rnd())) })
    }
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return out
}

describe('a drawing updated on every bar is moved, never piled up', () => {
  it('5,000 bars hold exactly the drawings 300 bars do, with none withheld', () => {
    const long = longChart(5000)
    const drawn = (source, bars) => {
      admit(source, false)
      const pane = paneOf(source)
      const cols = registry.computeFor(pane.definition, bars, undefined, { ...recipeContext('daily', 'fromListing'), newestBarIsForming: true })
      expect(registry.columnErrors(cols) || {}).toEqual({})
      const run = cols[RUNTIME_OBJECTS_KEY]
      expect(run && run.status).toBe('ok')
      expect(run.withheldCounts || {}).toEqual({})
      return run.counts
    }
    const moved = [
      { id: 'fibonacci-swings', source: SHOWN.find((x) => x.id === 'fibonacci-swings').source, want: { line: 7, label: 7 } },
      { id: 'levels-from-a-list', source: SHOWN.find((x) => x.id === 'levels-from-a-list').source, want: { line: 7, label: 7 } },
    ]
    for (const m of moved) {
      const short = drawn(m.source, long.slice(0, 300))
      const all = drawn(m.source, long)
      expect(all, m.id).toEqual(short)
      expect({ line: all.line, label: all.label }, m.id).toEqual(m.want)
    }
    // CONTROL: the count can grow. The zigzag recipe draws one line per confirmed swing, so a longer chart holds more
    const zig = SHOWN.find((x) => x.id === 'zigzag-percent').source
    admit(zig, false)
    const lines = (bars) => {
      const cols = registry.computeFor(paneOf(zig).definition, bars, undefined, { ...recipeContext('daily', 'fromListing'), newestBarIsForming: true })
      return cols[RUNTIME_OBJECTS_KEY].counts.line
    }
    expect(lines(long)).toBeGreaterThan(lines(long.slice(0, 300)))
  }, 600_000)
})

describe('the editor panel says the same', () => {
  const status = (run) => ({ state: PANEL_STATE.RUNS, headline: 'Runs on the chart', run })
  const waiting = [{ guard: RUNTIME_FORMING_GUARD, sentence: 'not drawn while the newest bar is still forming' }]

  it('a run that waits for the bar leads with "Draws once this bar has finished"', () => {
    const shown = shownStatus(status({ state: RUN.RAN, stops: [], unchecked: [], waiting, notes: [] }))
    expect(shown.headline).toBe(WAITING_HEADLINE)
    expect(shown.state).toBe(SHOWN_STATE.WAITS_FOR_THE_BAR)
  })

  it('CONTROL: a run with nothing waiting keeps the status, and a stop still leads', () => {
    expect(shownStatus(status({ state: RUN.RAN, stops: [], unchecked: [], waiting: [], notes: [] })).headline).toBe('Runs on the chart')
    expect(shownStatus(status({ state: RUN.RAN, stops: [], unchecked: [], notes: [] })).headline).toBe('Runs on the chart')
    expect(shownStatus(status({ state: RUN.STOPPED, stops: [{ guard: 'g', sentence: 's' }], unchecked: [], waiting, notes: [] })).headline).toBe(STOPPED_HEADLINE)
    // a status that never said "runs" is not turned into "draws once the bar has finished"
    expect(shownStatus({ state: PANEL_STATE.NOT_YET, headline: 'Not yet', run: { state: RUN.RAN, stops: [], unchecked: [], waiting, notes: [] } }).headline).toBe('Not yet')
  })
})
