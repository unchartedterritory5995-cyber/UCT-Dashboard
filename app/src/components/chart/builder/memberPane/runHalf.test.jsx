// app/src/components/chart/builder/memberPane/runHalf.test.jsx
//
// ─── ⭐⭐ ENGINE 53 — THE RUN HALF: DOOR, BIND AND CHART ──────────────────────────────
//
// A host-OK script whose object program lost drawings (`objectLoss` verdict `partial`)
// gets `compute.runtimeObjects` on its `ast` document (`hostPartialRunHalf`), and the
// chart draws the run's drawings ONLY where every gate passes on every run and the run's
// columns equal the host's (`nativeRegistry.js::withRunHalf`). Otherwise the host picture.
// Pending draws an empty object layer, never the host picture then a swap; never both.
//
// The script below plots two lines and, on its last bar, draws one line (the host program
// carries it) and labels each of the five newest bars that closed up — from inside a loop
// the host object program cannot follow (it loses the label: `partial`), and which the
// per-bar run executes as Pine does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { validateDefinition } from '../../engine/defSchema'
import { assessObjectLoss, RUN_HALF_DRAWING_SENTENCE, runHalfRefusedSentence } from '../../engine/ast/objectLoss'
import { runHalfOf, runtimeObjectsOf, RUNTIME_OBJECTS_KEY, carriesRunHalf } from '../../engine/runtime/runtimeObjects'
import { runtimeColumnsFor } from '../../engine/runtime/runtimeColumns'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../engine/runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, setRuntimeAllowList, setRuntimeKillList, runtimeSourceHash,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, __resetRuntimeAdmission, RUNTIME_FORMING_GUARD,
} from '../../engine/runtimeKill'
import { resetObjectRenderDrops } from '../../engine/objectRenderNotice'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'
import { RUN_HALF_SOURCE_STAMP } from './memberPaneDefinition'
import { setRunHalfObjectEvidence } from '../../engine/runHalfRailSeam'
import { storedBytesOf } from './storedBytes'
import fs from 'node:fs'
import path from 'node:path'
import { DOCUMENT_BYTE_BUDGET } from '../../engine/ast/graphDocument'
import { runHalfProgramDigest, RUN_HALF_PROGRAM_STAMP } from '../../engine/runHalfProgram'

const LF = String.fromCharCode(10)
const SRC = ['//@version=5', 'indicator("run half", overlay = true)', 'len = input.int(5, "len")',
  'm = ta.sma(close, len)', 'plot(m, "m")', 'plot(m * 2, "m2")', 'if barstate.islast',
  '    line.new(bar_index - 1, low, bar_index, high)', '    for i = 0 to 4',
  '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
// ⛔ CONTROL: the same plots and a label the host program carries — a clean drawing.
const CLEAN = ['//@version=5', 'indicator("clean", overlay = true)', 'm = ta.sma(close, 5)', 'plot(m, "m")',
  'if barstate.islast', '    label.new(bar_index, high, "up")'].join(LF)

const BARS = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 8 * Math.sin(i / 9) + i * 0.02
  return { t: 1420156800 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1e6 }
})
const CTX = Object.freeze({ tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false, historyFromListing: true })
const GUARD_TOKEN = /\b(pane|runtime|run-half|interpret|pine):[a-z]/

let seq = 0
const door = (source = SRC, opts = {}) => memberPaneDefinition({ source, name: 'rh', ...opts, id: opts.id || `u_member-pane-rh${++seq}` })
function install(def) {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}
const bind = (def, inputs, ctx = CTX) => registry.computeFor(def, BARS, inputs, ctx)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  // ⭐ ENGINE 54 (review) — this fixture's five loop labels come from a call the host program lost,
  // which the object rail admits only on recorded evidence (`run-half:uncompared-site` otherwise:
  // `runHalfObjectRail.test.jsx`); the gates and the column rail below are tested beside it
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(SRC), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
})
afterEach(() => {
  setRunHalfObjectEvidence([])
  cleanup()
  resetObjectRenderDrops()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  for (const d of registry.listDefinitions ? registry.listDefinitions() : []) {
    if (d && typeof d.id === 'string' && d.id.startsWith('u_member-pane-rh')) registry.uninstallUserDefinition(d.id)
  }
  vi.unstubAllEnvs()
})

describe('⭐⭐ the door mints a run half for a host-partial script', () => {
  it('the fixture IS host-partial: plots drawn, the loop label lost by the host program', () => {
    const d = door(SRC, { routeHostPartial: false })
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBeUndefined()
    expect(assessObjectLoss(d.translation).verdict).toBe('partial')
  })

  it('mints compute.runtimeObjects on the ast document, the host program kept as the fallback', () => {
    const d = door()
    expect(d.ok, d.reason).toBe(true)
    expect(d.runHalf).toEqual({ minted: true, columns: 2 })
    const c = d.definition.compute
    expect(c.kind).toBe('ast')
    expect(c.runtimeObjects.source).toBe(SRC)
    expect(Object.keys(c.runtimeObjects.outputs).sort()).toEqual(['out2', 'value'])
    expect(c.runtimeObjects.runtimeLanguage).toBe('pine')
    expect(Array.isArray(c.runtimeObjects.runtimeOutputSignature)).toBe(true)
    expect(d.definition.objects).toBeTruthy()
    const note = d.definition.meta.disclosures.find((n) => n.note.includes(RUN_HALF_DRAWING_SENTENCE))
    expect(note, 'the drawing note says where the drawings may come from').toBeTruthy()
    const v = validateDefinition(d.definition)
    expect(v.ok, (v.errors || []).join(' | ')).toBe(true)
  })

  it('⛔ declined, the document is byte-identical to the door that never asks (routeHostPartial: false)', () => {
    const id = 'u_member-pane-rhsame'
    const base = JSON.stringify(door(SRC, { id, routeHostPartial: false }).definition)
    setRuntimeKillList([runtimeSourceHash(SRC)])
    const killed = door(SRC, { id })
    expect(killed.runHalfDeclined.code).toBe('runtime:killed')
    expect(JSON.stringify(killed.definition)).toBe(base)
    setRuntimeKillList([])
    setRuntimeAllowList([])
    const ungraded = door(SRC, { id })
    expect(ungraded.runHalfDeclined.code).toBe('runtime:not-yet-graded')
    expect(JSON.stringify(ungraded.definition)).toBe(base)
  })

  it('⛔ the runtime pane off (every member without the stage): no run half, byte-identical', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const id = 'u_member-pane-rhoff'
    const off = door(SRC, { id })
    expect(off.runHalfDeclined.code).toBe('run-half:pane-off')
    expect(JSON.stringify(off.definition)).toBe(JSON.stringify(door(SRC, { id, routeHostPartial: false }).definition))
    expect(JSON.stringify(off.definition)).not.toContain('runtimeObjects')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __resetRuntimePanePermission()
    const unlatched = door()
    expect(unlatched.runHalfDeclined.code).toBe('run-half:pane-off')
    expect(unlatched.definition.compute.runtimeObjects).toBeUndefined()
  })

  it('⛔ CONTROL — a clean drawing is never routed: no run half, no decline, byte-identical', () => {
    const id = 'u_member-pane-rhclean'
    const d = door(CLEAN, { id })
    expect(d.ok, d.reason).toBe(true)
    expect(assessObjectLoss(d.translation).verdict).toBe('clean')
    expect(d.runHalf).toBeUndefined()
    expect(d.runHalfDeclined).toBeUndefined()
    expect(JSON.stringify(d.definition)).toBe(JSON.stringify(door(CLEAN, { id, routeHostPartial: false }).definition))
  })

  it('⛔ a document the run half would push past the store\'s 64 KiB is not minted', () => {
    const pad = `// ${'x'.repeat(70000)}`
    const d = door(`${SRC}${LF}${pad}${LF}`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.runHalfDeclined && d.runHalfDeclined.code).toBe('run-half:size')
    expect(d.definition.compute.runtimeObjects).toBeUndefined()
  })

  it('⛔ at the border the door counts the FINISHED document as the store will (never mint, then fail to save)', () => {
    const withPad = (n) => `${SRC}${LF}// ${'x'.repeat(n)}${LF}`
    const id = 'u_member-pane-rhborder'
    // the largest comment for which the run half is still minted
    let lo = 0
    let hi = 66000
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (door(withPad(mid), { id }).runHalf) lo = mid; else hi = mid
    }
    const minted = door(withPad(lo), { id })
    expect(minted.runHalf).toBeTruthy()
    const bytes = storedBytesOf(minted.definition)
    expect(bytes).toBeLessThanOrEqual(DOCUMENT_BYTE_BUDGET)
    expect(bytes, 'a borderline document, not a small one').toBeGreaterThan(DOCUMENT_BYTE_BUDGET - 64)
    const over = door(withPad(hi), { id })
    expect(over.runHalfDeclined && over.runHalfDeclined.code).toBe('run-half:size')
    expect(JSON.stringify(over.definition)).toBe(JSON.stringify(door(withPad(hi), { id, routeHostPartial: false }).definition))
    expect(over.notes).toEqual(door(withPad(hi), { id, routeHostPartial: false }).notes)
  })

  // ⭐ A6 — THE DECLINE NAMES THE TRUE CAUSE. ⚰️ vdubus-pattern-gen-v2's read "with the run half the document is 4095605
  // bytes": its HOST document alone is 4,077,043 bytes (its `objects` program) and the run half adds 18,539, so the
  // sentence blamed the run half for a size the host document already has.
  const committed = (slug) => fs.readFileSync(path.resolve(process.cwd(), '..', 'corpus/committed', `${slug}.pine`), 'utf8')
  it('A6 — a host document already past the cap is named as the cause, with the run half\'s small share', () => {
    const d = door(committed('vdubus-pattern-gen-v2-restored-refined__66dc68412e'))
    expect(d.runHalfDeclined && d.runHalfDeclined.code).toBe('run-half:size')
    const m = /^the document is (\d+) bytes as the store counts it WITHOUT the run half, already past its (\d+)-byte cap; the run half would add (\d+) bytes$/.exec(d.runHalfDeclined.why)
    expect(m, d.runHalfDeclined.why).toBeTruthy()
    expect(Number(m[1])).toBe(storedBytesOf(d.definition))
    expect(Number(m[1])).toBeGreaterThan(Number(m[2]))
    expect(Number(m[3])).toBeLessThan(Number(m[1]))
    // ⭐ ITEM 2 — the preview is still this host answer; what Add keeps is decided on the SAME count
    // (`oversizeKeep.test.jsx` holds the rest)
    expect(d.definition.compute.kind).toBe('ast')
    expect(d.oversize && d.oversize.bytes).toBe(Number(m[1]))
  }, 240000)
  it('A6 CONTROL — where the run half is what passes the cap (dual-view-htf), the sentence still says so', () => {
    const d = door(committed('dual-view-htf-candlestick-patterns-theultimator5__e0385fb61b'))
    expect(d.runHalfDeclined && d.runHalfDeclined.code).toBe('run-half:size')
    const m = /^with the run half the document is (\d+) bytes as the store counts it, past its (\d+)-byte cap \((\d+) without it; the run half adds (\d+)\)$/.exec(d.runHalfDeclined.why)
    expect(m, d.runHalfDeclined.why).toBeTruthy()
    expect(Number(m[3])).toBe(storedBytesOf(d.definition))
    expect(Number(m[3])).toBeLessThanOrEqual(Number(m[2]))
    expect(Number(m[1])).toBe(Number(m[3]) + Number(m[4]))
  }, 240000)
})

describe('⛔⛔ the run half runs the document\'s OWN script (review 1)', () => {
  const FOREIGN = CLEAN
  it('the door stamps the script it translated', () => {
    const d = door()
    expect(d.definition.meta[RUN_HALF_SOURCE_STAMP]).toBe(runtimeSourceHash(SRC))
    const declined = door(SRC, { routeHostPartial: false })
    expect(declined.definition.meta[RUN_HALF_SOURCE_STAMP]).toBeUndefined()
  })

  it('FORGED: another script\'s run half on this document is refused at the bind, nothing drawn from it', () => {
    const minted = door().definition
    const forged = JSON.parse(JSON.stringify(minted))
    forged.id = `${minted.id}f`
    forged.compute.runtimeObjects = { source: FOREIGN, outputs: {} }
    const def = install(forged)
    const cols = bind(def)
    expect(runHalfOf(cols)).toEqual({ state: 'refused', code: 'run-half:source-unbound' })
    expect(runtimeObjectsOf(cols)).toBe(null)
  })

  it('⛔ no stamp, or a stamp naming another script: refused; CONTROL: the honest document is served', () => {
    const minted = door().definition
    const noStamp = JSON.parse(JSON.stringify(minted))
    noStamp.id = `${minted.id}n`
    delete noStamp.meta[RUN_HALF_SOURCE_STAMP]
    expect(runHalfOf(bind(install(noStamp))).code).toBe('run-half:source-unbound')
    const wrong = JSON.parse(JSON.stringify(minted))
    wrong.id = `${minted.id}w`
    wrong.meta[RUN_HALF_SOURCE_STAMP] = runtimeSourceHash(FOREIGN)
    expect(runHalfOf(bind(install(wrong))).code).toBe('run-half:source-unbound')
    expect(runHalfOf(bind(install(minted))).state).toBe('served')
  })

  it('⛔ the schema refuses a run half beside run-read colours of another script', () => {
    const minted = JSON.parse(JSON.stringify(door().definition))
    minted.compute.runtimeColours = { source: FOREIGN, at: [{ line: 3, column: 1, node: {}, kind: 'colour' }], keys: ['rtcolour1'] }
    const v = validateDefinition(minted)
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.startsWith('compute.runtimeObjects.source'))).toBe(true)
  })
})

describe('⛔ the door\'s other gates (review 2: X2, X3, X4, X8)', () => {
  it('X4: a windowed script (calc_bars_count) is declined', () => {
    const w = SRC.replace('indicator("run half", overlay = true)', 'indicator("run half", overlay = true, calc_bars_count = 100)')
    const d = door(w)
    expect(d.ok, d.reason).toBe(true)
    expect(assessObjectLoss(d.translation).verdict).toBe('partial')
    expect(d.runHalfDeclined && d.runHalfDeclined.code).toBe('runtime:calc-bars-count')
    expect(d.definition.compute.runtimeObjects).toBeUndefined()
  })

  it('X8: a hidden row is never mapped into the column rail', () => {
    const h = SRC.replace('plot(m * 2, "m2")', 'plot(m * 2, "m2")\nplot(m * 3, "anchor", display = display.none)')
    const d = door(h)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toEqual({ minted: true, columns: 2 })
    const hiddenKeys = d.definition.plots.filter((p) => p.hidden).map((p) => p.key)
    expect(hiddenKeys.length).toBeGreaterThan(0)
    for (const k of hiddenKeys) expect(Object.keys(d.definition.compute.runtimeObjects.outputs)).not.toContain(k)
  })
})

describe('⛔ the bind\'s other gates (review 2: X5, X7)', () => {
  /** a lane answering with the host's own columns (so only the gate under test can refuse) */
  // ⭐ ENGINE 54 — with the RUN's own drawings, so the object rail holds and only the gate
  // under test can refuse
  const hostEcho = (hostCols, tamper = null) => (d, bars) => {
    const out = { value: Float64Array.from(hostCols.value), out2: Float64Array.from(hostCols.out2) }
    if (tamper) tamper(out)
    const real = runtimeColumnsFor(d, bars, {}, CTX)[RUNTIME_OBJECTS_KEY]
    Object.defineProperty(out, RUNTIME_OBJECTS_KEY, { value: real, enumerable: false })
    return out
  }

  it('X5: the script\'s own runtime.error, reached on these bars, refuses the run half before the run is asked', () => {
    const stops = SRC.replace('plot(m, "m")', 'plot(m, "m")\nif bar_index == 250\n    runtime.error("stop here")')
    const d = door(stops)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    const def = install(d.definition)
    const host = bind(install(door(SRC).definition))
    let asked = 0
    registry.registerRuntimeLane((...a) => { asked += 1; return hostEcho(host)(...a) })
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:runtime.error' })
    expect(asked, 'the run is not asked once the host has stopped').toBe(0)
  })

  it('X7: na against a number is a disagreement, in either direction', () => {
    const def = install(door().definition)
    const host = bind(install(door(SRC, { routeHostPartial: false }).definition))
    const i = host.value.findIndex((x) => Number.isFinite(x))
    registry.registerRuntimeLane(hostEcho(host))
    expect(runHalfOf(bind(def)).state, 'CONTROL: the host\'s own columns agree').toBe('served')
    registry.registerRuntimeLane(hostEcho(host, (o) => { o.value[i + 5] = NaN }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: registry.RUN_HALF_COLUMN_RAIL })
    const j = host.out2.findIndex((x) => Number.isNaN(x))
    expect(j, 'the host has a warm-up bar').toBeGreaterThanOrEqual(0)
    registry.registerRuntimeLane(hostEcho(host, (o) => { o.out2[j] = 1 }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: registry.RUN_HALF_COLUMN_RAIL })
  })
})

describe('⛔ a refused run half over a host picture with no drawings still says why (review 3)', () => {
  // the original fixture: the host program loses EVERY drawing (`definition.objects` is null)
  const SRC0 = SRC.replace(`${LF}    line.new(bar_index - 1, low, bar_index, high)`, '')
  it('⭐ ENGINE 54 — nothing the host draws to compare: refused (no comparable object), the sentence said', () => {
    const d = door(SRC0)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    expect(runHalfOf(bind(install(d.definition)))).toEqual({ state: 'refused', code: 'run-half:no-comparable-objects' })
  })
  it('the member reads the refusal sentence, and a layer the run drew before is emptied', () => {
    // ⭐ ENGINE 54 — a run half with nothing comparable is refused (above); the Part 2 hook
    // admits it on recorded evidence, which is what lets this chart draw the run's labels first
    setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(SRC0), captures: [
      { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
      { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
    const d = door(SRC0)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    expect(d.definition.objects).toBeFalsy()
    const def = install(d.definition)
    const fakeChart = createFakeChart()
    const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((x) => x.defId === def.id)
    const states = []
    const sync = () => binder.sync({
      enabled: true, cs, instances, registry, bars: BARS, tf: 'D', symbol: CTX.symbol, newestBarIsForming: false,
      historyFromListing: true, adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
    })
    sync()
    expect(states[states.length - 1] && states[states.length - 1].labels.length).toBe(5)
    setRuntimeAllowList([])
    sync()
    expect(states[states.length - 1]).toBe(null)
    render(<AttachedPineDisclosures settings={cs} registry={registry} />)
    const t = screen.queryByTestId('pine-attached-disclosures')?.textContent || ''
    expect(t).toContain(runHalfRefusedSentence('pane:not-graded'))
    expect(t).not.toMatch(GUARD_TOKEN)
    binder.teardown()
    setRunHalfObjectEvidence([])
  })
})

describe('⭐⭐ the bind draws the run\'s drawings only where every gate passes', () => {
  it('served: the run\'s labels ride beside the host columns, which are untouched', () => {
    const def = install(door().definition)
    const cols = bind(def)
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    expect(runtimeObjectsOf(cols).live.filter((o) => o.family === 'label')).toHaveLength(5)
    expect(Object.keys(cols)).not.toContain(RUNTIME_OBJECTS_KEY)
    const host = install(door(SRC, { routeHostPartial: false }).definition)
    const hostCols = bind(host)
    expect(Array.from(cols.value)).toEqual(Array.from(hostCols.value))
    expect(Array.from(cols.out2)).toEqual(Array.from(hostCols.out2))
  })

  it('⛔ the kill list, at the bind (this tab\'s list AND the server\'s stamp)', () => {
    const minted = door().definition
    const def = install(minted)
    setRuntimeKillList([runtimeSourceHash(SRC)])
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:killed' })
    setRuntimeKillList([])
    const stamped = install({ ...minted, id: `${minted.id}s`, meta: { ...minted.meta, runtimeKilled: 'listed' } })
    expect(runHalfOf(bind(stamped))).toEqual({ state: 'refused', code: 'pane:killed' })
  })

  it('⛔ the allowlist, at the bind (this tab\'s list AND the server\'s stamp)', () => {
    const minted = door().definition
    const def = install(minted)
    setRuntimeAllowList([])
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:not-graded' })
    __allowEveryRuntimeScriptForTests()
    const stamped = install({ ...minted, id: `${minted.id}g`, meta: { ...minted.meta, runtimeNotGraded: 'not graded' } })
    expect(runHalfOf(bind(stamped))).toEqual({ state: 'refused', code: 'pane:not-graded' })
  })

  it('⛔⛔ G6 — admitted by capability for CLOSED-BAR HISTORY only (this fixture reads barstate): refused by name on a forming or untold bar; CONTROL: served on a closed bar', () => {
    const def = install(door().definition)
    setRuntimeAllowList([])
    setRuntimeCapabilityAdmission(true)
    try {
      latchRuntimeAdmission(runtimeSourceHash(SRC), { admitted: true, historyOnly: true })
      expect(runHalfOf(bind(def))).toEqual({ state: 'served', code: null })                 // newestBarIsForming: false
      expect(runHalfOf(bind(def, undefined, { ...CTX, newestBarIsForming: true }))).toEqual({ state: 'refused', code: RUNTIME_FORMING_GUARD })
      expect(runHalfOf(bind(def, undefined, { ...CTX, newestBarIsForming: null }))).toEqual({ state: 'refused', code: RUNTIME_FORMING_GUARD })
      expect(runHalfRefusedSentence(RUNTIME_FORMING_GUARD)).toMatch(/only been checked against TradingView on finished bars/)
      // CONTROL: admitted without the history-only restriction, a forming bar is served
      latchRuntimeAdmission(runtimeSourceHash(SRC), { admitted: true })
      expect(runHalfOf(bind(def, undefined, { ...CTX, newestBarIsForming: true }))).toEqual({ state: 'served', code: null })
    } finally {
      __resetRuntimeAdmission()
      __allowEveryRuntimeScriptForTests()
    }
  })

  it('⛔ a revoked latch: refused on the next run, and the memo key moves with it', () => {
    const def = install(door().definition)
    const before = registry.computeSignature(def, undefined, CTX)
    expect(runHalfOf(bind(def)).state).toBe('served')
    __resetRuntimePanePermission()
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:not-permitted' })
    expect(registry.computeSignature(def, undefined, CTX)).not.toBe(before)
  })

  it('⛔ a build without the runtime pane: refused', () => {
    const def = install(door().definition)
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:not-built' })
  })

  // ⭐⭐ SETTINGS PARITY (2c) — the run half at the chart's own settings. It used to be refused the
  // moment ANY setting moved; now the run is handed the chart's values, and only a moved setting a
  // DRAWING reads needs evidence of its own (`runHalfSettingsAdmitted`).
  it('a moved plot width never reaches the run: served (the drawings are the same at any width)', () => {
    const def = install(door().definition)
    const k = (def.inputs || []).find((i) => i.key === 'lineWidth')
    expect(k, 'a declared input').toBeTruthy()
    expect(runHalfOf(bind(def, { lineWidth: k.default + 2 })).state).toBe('served')
  })

  it('a moved length no drawing reads: the run is handed it, the column rail holds, served on the defaults\' evidence', () => {
    const def = install(door().definition)
    const len = (def.inputs || []).find((i) => i.fromParam || i.key === 'len')
    expect(len, 'the length is a setting (a folded param or an input)').toBeTruthy()
    const cols = bind(def, { [len.key]: 9 })
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    // the host column moved with the setting, and the run's (held by the column rail) with it
    expect(Array.from(cols.value)).not.toEqual(Array.from(bind(def).value))
  })

  describe('a setting only the drawings read', () => {
    const SRC_N = ['//@version=5', 'indicator("run half n", overlay = true)', 'len = input.int(5, "len")',
      'n = input.int(5, "How many", minval = 1, maxval = 5)',
      'm = ta.sma(close, len)', 'plot(m, "m")', 'plot(m * 2, "m2")', 'if barstate.islast',
      '    line.new(bar_index - 1, low, bar_index, high)', '    for i = 0 to n - 1',
      '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
    const ev = (extra = []) => setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(SRC_N), captures: [
      { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
      { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }, ...extra] }])

    it('is declared on load (`fromRunHalf`), keyed by its Pine name, with the author\'s bounds', () => {
      ev()
      const def = install(door(SRC_N).definition)
      expect(def.inputs.find((i) => i.key === 'n')).toMatchObject({ type: 'int', default: 5, min: 1, max: 5, fromRunHalf: true })
    })

    it('⛔ moved without evidence for it: refused by name, and the host program draws nothing it folded', () => {
      ev()
      const def = install(door(SRC_N).definition)
      expect(runHalfOf(bind(def, { n: 2 }))).toEqual({ state: 'refused', code: 'runtime:member-inputs' })
      expect(runHalfOf(bind(def)).state, 'CONTROL: at the default').toBe('served')
    })

    it('⭐ moved with two counted captures taken at it moved: served, and the run draws what the setting says', () => {
      ev([{ capture: 'c', verdict: 'MATCH', objectsV2: true, runtimeOn: true, inputs: { n: 2 } },
        { capture: 'd', verdict: 'MATCH', objectsV2: true, runtimeOn: true, inputs: { n: 3 } }])
      const def = install(door(SRC_N).definition)
      const all = runtimeObjectsOf(bind(def)).live.filter((o) => o.family === 'label').length
      const cols = bind(def, { n: 2 })
      expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
      const two = runtimeObjectsOf(cols).live.filter((o) => o.family === 'label').length
      expect(two).toBeLessThanOrEqual(2)
      expect(two).toBeLessThan(all)
    })

    it('⛔ one counted capture is not evidence', () => {
      ev([{ capture: 'c', verdict: 'MATCH', objectsV2: true, runtimeOn: true, inputs: { n: 2 } }])
      const def = install(door(SRC_N).definition)
      expect(runHalfOf(bind(def, { n: 2 })).code).toBe('runtime:member-inputs')
    })
  })

  it('⛔⛔ THE COLUMN RAIL: a run column that is not the host\'s column refuses the drawings', () => {
    const minted = door().definition
    const { value, out2 } = minted.compute.runtimeObjects.outputs
    const swapped = JSON.parse(JSON.stringify(minted))
    swapped.id = `${minted.id}x`
    swapped.compute.runtimeObjects.outputs = { value: out2, out2: value }
    // ⭐ ENGINE 54 — re-stamped, so the program binding holds and the column rail is what refuses
    swapped.compute.runtimeObjects[RUN_HALF_PROGRAM_STAMP] = runHalfProgramDigest(swapped)
    const def = install(swapped)
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: registry.RUN_HALF_COLUMN_RAIL })
    expect(runtimeObjectsOf(bind(def))).toBe(null)
  })

  it('⛔ no ctx (a probe that is not a chart) asks nothing of the run', () => {
    const def = install(door().definition)
    const cols = registry.computeFor(def, BARS, undefined)
    expect(runHalfOf(cols)).toBe(null)
  })

  describe('a run this lane cannot serve', () => {
    // ⭐ ENGINE 54 — a payload function receives the run's real drawings (`live`), so a control
    // that keeps them passes the object rail
    const fake = (payload) => (def, bars) => {
      const out = runtimeColumnsFor(def, bars, {}, CTX)
      const res = { ...out }
      const p = typeof payload === 'function' ? payload(out[RUNTIME_OBJECTS_KEY].live) : payload
      if (p !== undefined) Object.defineProperty(res, RUNTIME_OBJECTS_KEY, { value: p, enumerable: false })
      return res
    }
    it('pending: a run in flight (no drawings attached yet)', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(() => ({}))
      expect(runHalfOf(bind(def))).toEqual({ state: 'pending', code: 'runtime:in-flight' })
      expect(runtimeObjectsOf(bind(def))).toBe(null)
    })
    // ONE WITHHOLDING, ONE REASON (2026-11-16): seen on production, the note read "the script
    // reads another symbol or timeframe, which this chart cannot hand that run" for the seconds
    // the other symbol's bars took to load, then a different reason once they had.
    const waiting = () => Object.assign(new Error('this script reads another symbol whose bars are still loading'),
      { guard: 'runtime:request', pending: true })
    it('pending: a run waiting for another symbol\'s bars is held, and no cause is worded', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(() => { throw waiting() })
      expect(runHalfOf(bind(def))).toEqual({ state: 'pending', code: registry.RUN_HALF_REQUEST_PENDING })
      expect(runtimeObjectsOf(bind(def))).toBe(null)
    })
    it('the wait RESOLVES: once the run can answer, the answer is the one a chart that never waited gets', () => {
      const def = install(door().definition)
      const never = runHalfOf(bind(def))
      expect(never.state, 'CONTROL: this document is served when nothing waits').toBe('served')
      registry.registerRuntimeLane(() => { throw waiting() })
      expect(runHalfOf(bind(def)).state).toBe('pending')
      // the bars arrive: the same lane as before the wait, asked again
      registry.registerRuntimeLane(runtimeColumnsFor)
      expect(runHalfOf(bind(def))).toEqual(never)
      // and a wait that ends in a refusal ends on that refusal's own sentence, the same one a
      // chart that never waited reads (one withholding, one reason, on every surface)
      registry.registerRuntimeLane(() => { throw Object.assign(new Error('refused'), { guard: 'runtime:request' }) })
      const refused = runHalfOf(bind(def))
      expect(refused).toEqual({ state: 'refused', code: 'runtime:request' })
      expect(runHalfRefusedSentence(refused.code)).toMatch(/cannot hand that run/)
      expect(runHalfRefusedSentence(registry.RUN_HALF_REQUEST_PENDING), 'the pending code is never worded as a cause')
        .not.toMatch(/cannot hand that run/)
    })
    it('pending: the same wait, reached as a withheld payload beside the plain run\'s columns', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(fake({ status: 'WITHHELD', live: [], guard: 'runtime:request', reason: 'x', pending: true }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'pending', code: registry.RUN_HALF_REQUEST_PENDING })
    })
    it('CONTROL: a request the run REFUSES (not a wait) is still refused, with its own code', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(() => { throw Object.assign(new Error('refused'), { guard: 'runtime:request' }) })
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:request' })
      registry.registerRuntimeLane(fake({ status: 'WITHHELD', live: [], guard: 'runtime:request', reason: 'x' }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:request' })
    })
    it('⛔ a family the run withholds that the host program draws: refused', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(fake({ status: 'ok', live: [], withheld: { line: 'not measured' } }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'run-half:family-withheld' })
      registry.registerRuntimeLane(fake((live) => ({ status: 'ok', live, withheld: { box: 'not measured' } })))
      expect(runHalfOf(bind(def)).state, 'CONTROL: a family the host does not draw').toBe('served')
    })
    it('⛔ drawings withheld whole, or a run that stopped: refused', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(fake({ status: 'WITHHELD', live: [], guard: 'runtime:history-start', reason: 'r' }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:history-start' })
      registry.registerRuntimeLane(fake({ status: 'OBJECT_UNWITNESSED', live: [], reason: 'r' }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:objects-stopped' })
    })
  })
})

describe('⭐⭐ the chart: one picture, never both, never host-then-swap', () => {
  function chart(def, { lane } = {}) {
    if (lane) registry.registerRuntimeLane(lane)
    const fakeChart = createFakeChart()
    const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    const states = []
    const sync = () => binder.sync({
      enabled: true, cs, instances, registry, bars: BARS, tf: 'D', symbol: CTX.symbol, newestBarIsForming: false,
      historyFromListing: true, adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
    })
    const text = () => {
      cleanup()
      render(<AttachedPineDisclosures settings={cs} registry={registry} />)
      return screen.queryByTestId('pine-attached-disclosures')?.textContent || ''
    }
    return { binder, states, sync, text }
  }
  const labels = (s) => (s && Array.isArray(s.labels) ? s.labels.length : null)

  it('served: the run\'s five labels, set ONCE — the host program is not drawn beside them', () => {
    const def = install(door().definition)
    const c = chart(def)
    c.sync()
    expect(c.states).toHaveLength(1)
    expect(labels(c.states[0])).toBe(5)
    expect(c.states[0].lines).toHaveLength(1)
    c.binder.teardown()
  })

  it('⛔ CONTROL: the host document draws the host picture (its line, no loop labels)', () => {
    const def = install(door(SRC, { routeHostPartial: false }).definition)
    expect(carriesRunHalf(def)).toBe(false)
    const c = chart(def)
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(0)
    expect(c.states[c.states.length - 1].lines).toHaveLength(1)
    c.binder.teardown()
  })

  it('⛔ pending: the layer is EMPTY (never the host picture first), and a pending answer is never memoised', () => {
    const def = install(door().definition)
    let landed = false
    const c = chart(def, { lane: (d, bars, inputs, ctx) => (landed ? runtimeColumnsFor(d, bars, inputs, ctx) : {}) })
    c.sync()
    expect(c.states.every((s) => s === null), 'nothing but an empty layer while pending').toBe(true)
    landed = true
    c.sync() // the same bars and inputs: a memoised pending answer would draw nothing again
    expect(labels(c.states[c.states.length - 1])).toBe(5)
    c.binder.teardown()
  })

  it('⛔ refused: the host picture, and the member reads why — in words, never a guard token', () => {
    const def = install(door().definition)
    setRuntimeAllowList([])
    const c = chart(def)
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(0)
    const t = c.text()
    expect(t).toContain(runHalfRefusedSentence('pane:not-graded'))
    expect(t).not.toMatch(GUARD_TOKEN)
    c.binder.teardown()
  })

  it('⛔ a latch revoked under an open chart: the next sync draws the host picture', () => {
    const def = install(door().definition)
    const c = chart(def)
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(5)
    __resetRuntimePanePermission()
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(0)
    c.binder.teardown()
  })
})

describe('the member\'s sentences', () => {
  it('⛔ no refusal code reaches a sentence as a token', () => {
    for (const code of ['pane:not-built', 'pane:not-permitted', 'pane:killed', 'pane:not-graded', 'pane:forming-ungraded', 'runtime:member-inputs',
      'runtime:runtime.error', 'runtime:history-start', 'runtime:warmup-never-converges', 'run-half:column-rail',
      'run-half:family-withheld', 'runtime:not-loaded', 'runtime:load-failed', 'runtime:request', 'runtime:limit',
      'runtime:time-budget', 'runtime:CALL_COUNT', 'interpret:bind-time-text', 'runtime:objects-stopped', 'x:y', '', null]) {
      const s = runHalfRefusedSentence(code)
      expect(s, String(code)).not.toMatch(GUARD_TOKEN)
      expect(s.startsWith('The complete set of this script\'s drawings isn\'t shown on this chart: ')).toBe(true)
    }
  })
})
