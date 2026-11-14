// app/src/components/chart/builder/memberPane/runHalfObjectRail.test.jsx
//
// ─── ⭐⭐ ENGINE 54 — THE RUN HALF'S OBJECT RAIL, ITS SITES, ITS PROGRAM BINDING, ITS TELEMETRY ──
//
// The run's drawings are drawn only where they ARE the host's at every create site the host
// draws (same source call, same count, order, bar and drawn row); nothing comparable refuses
// unless recorded evidence admits the script; the document's trees and object program must
// still digest to the stamp its door wrote; every refusal is counted and beaconed as
// {code, hash} only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { memberPaneDefinition, runHalfSites } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { validateDefinition } from '../../engine/defSchema'
import { runHalfRefusedSentence } from '../../engine/ast/objectLoss'
import { OBJECT_SITE_SOURCES } from '../../engine/ast/pine'
import { runHalfOf, runtimeObjectsOf, RUNTIME_OBJECTS_KEY } from '../../engine/runtime/runtimeObjects'
import { runtimeColumnsFor, probeRuntimeProgram } from '../../engine/runtime/runtimeColumns'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from '../../engine/runtimeKill'
import { resetObjectRenderDrops } from '../../engine/objectRenderNotice'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'
import {
  runHalfProgramDigest, runHalfProgramBound, RUN_HALF_PROGRAM_STAMP, RUN_HALF_PROGRAM_GRAPH_STAMP, canonicalJson,
} from '../../engine/runHalfProgram'
import {
  registerRunHalfObjectRail, registeredRunHalfObjectRail, setRunHalfObjectEvidence, runHalfEvidenceAdmits,
} from '../../engine/runHalfRailSeam'
import {
  runHalfObjectVerdict, RUN_HALF_OBJECT_RAIL, RUN_HALF_HOST_OBJECT_WITHHELD, RUN_HALF_NO_COMPARABLE_OBJECTS,
  RUN_HALF_UNCOMPARED_SITE,
} from '../../engine/runHalfObjectRail'
import {
  setRunHalfBeaconReporter, resetRunHalfTelemetry, runHalfRefusalCounts, runHalfBeaconOf, RUN_HALF_CODE_RE,
} from '../../engine/runHalfTelemetry'

const LF = String.fromCharCode(10)
// two plots; on its last bar ONE line the host program carries, and five loop labels it loses
const SRC = ['//@version=5', 'indicator("run half", overlay = true)', 'len = input.int(5, "len")',
  'm = ta.sma(close, len)', 'plot(m, "m")', 'plot(m * 2, "m2")', 'if barstate.islast',
  '    line.new(bar_index - 1, low, bar_index, high)', '    for i = 0 to 4',
  '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
// a DRAWING-ONLY partial script: no plot at all, so the column rail compares nothing
const DRAW_ONLY = ['//@version=5', 'indicator("draw only", overlay = true)', 'if barstate.islast',
  '    line.new(bar_index - 1, low, bar_index, high, color = color.red)', '    for i = 0 to 4',
  '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
// a drawing made by a user function inlined at two call sites (two host sites, one source call)
const FN = ['//@version=5', 'indicator("fn", overlay = true)', 'mk(y) =>', '    label.new(bar_index, y, "x")',
  'if barstate.islast', '    mk(high)', '    mk(low)', '    line.new(bar_index - 1, low, bar_index, high, color = color.red)',
  '    for i = 0 to 2', '        if close[i] > open[i]', '            box.new(bar_index - i, high[i], bar_index, low[i])',
  'plot(close)'].join(LF)

const BARS = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 8 * Math.sin(i / 9) + i * 0.02
  return { t: 1420156800 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1e6 }
})
const CTX = Object.freeze({ tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false, historyFromListing: true })
const GUARD_TOKEN = /\b(pane|runtime|run-half|interpret|pine):[a-z]/
const MATCH = (capture) => ({ capture, verdict: 'MATCH', objectsV2: true, runtimeOn: true })
/** ⭐ ENGINE 54 (review) — the Part 2 evidence that admits a run drawing at a site the rail did not
 *  compare (these fixtures' loop labels come from a call the host lost). A compared site that
 *  disagrees refuses whatever the evidence: the tests below that expect `object-rail` hold with it. */
const admit = (...srcs) => setRunHalfObjectEvidence(srcs.map((src) => ({ sha256: runtimeSourceHash(src), captures: [MATCH('a'), MATCH('b')] })))

let seq = 0
const door = (source = SRC, opts = {}) => memberPaneDefinition({ source, name: 'rh', ...opts, id: opts.id || `u_member-pane-ro${++seq}` })
function install(def) {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}
const bind = (def, inputs, ctx = CTX) => registry.computeFor(def, BARS, inputs, ctx)
const clone = (x) => JSON.parse(JSON.stringify(x))
/** a lane answering with the real run, its drawings passed through `tamper` (a deep copy) */
const tamperedLane = (tamper) => (d, bars, inputs, ctx) => {
  const out = runtimeColumnsFor(d, bars, inputs, ctx)
  const res = { ...out }
  const p = clone(out[RUNTIME_OBJECTS_KEY])
  tamper(p)
  Object.defineProperty(res, RUNTIME_OBJECTS_KEY, { value: p, enumerable: false })
  return res
}
/** a copy of a minted document, edited, and (unless `keepStamp`) re-stamped */
function edited(def, edit, { keepStamp = false } = {}) {
  const d = clone(def)
  d.id = `${def.id}e${++seq}`
  edit(d)
  if (!keepStamp) d.compute.runtimeObjects[RUN_HALF_PROGRAM_STAMP] = runHalfProgramDigest(d)
  return d
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  setRunHalfObjectEvidence([])
  resetRunHalfTelemetry()
  setRunHalfBeaconReporter(() => {})
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  cleanup()
  resetObjectRenderDrops()
  setRunHalfObjectEvidence([])
  setRunHalfBeaconReporter(null)
  registry.registerRuntimeLane(runtimeColumnsFor)
  for (const d of registry.listDefinitions ? registry.listDefinitions() : []) {
    if (d && typeof d.id === 'string' && d.id.startsWith('u_member-pane-ro')) registry.uninstallUserDefinition(d.id)
  }
  vi.unstubAllEnvs()
})

describe('⭐⭐ both lanes name a drawing by the same source call', () => {
  it('the host site and the run object carry the same <line>:<column> for the same call', () => {
    const d = door(SRC)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    const { sites } = d.definition.compute.runtimeObjects
    expect(sites).toEqual({ s1: '8:5' })
    const cols = runtimeColumnsFor(install(d.definition).compute.runtimeObjects
      ? { id: 'x', compute: { kind: 'runtime', fn: 'runtime:x', rev: 1, source: SRC, outputs: {}, objects: true }, meta: { runtimeHistory: 'listing' } }
      : null, BARS, {}, CTX)
    const live = cols[RUNTIME_OBJECTS_KEY].live
    expect(live.filter((o) => o.family === 'line').map((o) => o.site)).toEqual(['8:5'])
    expect(new Set(live.filter((o) => o.family === 'label').map((o) => o.site))).toEqual(new Set(['11:13']))
  })

  it('an inlined function: two host sites, ONE source call, which the run lowers once', () => {
    const d = door(FN, { routeHostPartial: false })
    const ss = d.translation.objectDiagnostics[OBJECT_SITE_SOURCES]
    const probe = probeRuntimeProgram(FN, { objectsInRun: true })
    expect(probe.ok).toBe(true)
    const creates = []
    const walk = (ops) => { for (const op of ops || []) { if (op.k === 'create') creates.push(op); if (op.body) walk(op.body) } }
    walk(d.definition.objects.ops)
    const labelSites = creates.filter((o) => o.family === 'label').map((o) => ss[o.site])
    expect(labelSites).toEqual(['4:5', '4:5'])
    for (const op of creates) {
      expect(probe.objectSites, `${op.family} ${op.site}`).toContainEqual({ site: ss[op.site], fn: `${op.family}.new` })
    }
  })

  it('⛔ a host site the run does not make at the same call (or of another family) declines the run half', () => {
    const d = door(SRC, { routeHostPartial: false })
    const probe = probeRuntimeProgram(SRC, { objectsInRun: true })
    expect(runHalfSites(d.translation, d.definition.objects, probe.objectSites)).toEqual({ ok: true, sites: { s1: '8:5' } })
    const moved = probe.objectSites.map((s) => (s.fn === 'line.new' ? { ...s, site: '8:6' } : s))
    expect(runHalfSites(d.translation, d.definition.objects, moved).ok).toBe(false)
    const other = probe.objectSites.map((s) => (s.fn === 'line.new' ? { ...s, fn: 'box.new' } : s))
    expect(runHalfSites(d.translation, d.definition.objects, other).ok).toBe(false)
    expect(runHalfSites({ objectDiagnostics: {} }, d.definition.objects, probe.objectSites).ok).toBe(false)
  })

  it('the stored document validates with its sites and program stamp', () => {
    const d = door(SRC).definition
    expect(d.compute.runtimeObjects[RUN_HALF_PROGRAM_STAMP]).toMatch(/^[0-9a-f]{64}$/)
    expect(d.compute.runtimeObjects[RUN_HALF_PROGRAM_GRAPH_STAMP]).toBeUndefined()
    const v = validateDefinition(d)
    expect(v.ok, (v.errors || []).join(' | ')).toBe(true)
  })
})

describe('⛔⛔ EVERY OBJECT THE RUN DRAWS COMES FROM A COMPARED SITE (engine 54 review)', () => {
  it('auto-trendlines shape, pure: labels compared and equal, plus lines from a lost call: refused', () => {
    const lab = (id, site, x) => ({ family: 'label', id, site, createdBar: x, props: { x, y: 100 + x, text: 'p' } })
    const program = { ops: [{ k: 'create', family: 'label', site: 's3' }, { k: 'create', family: 'label', site: 's4' }] }
    const sites = { s3: '104:5', s4: '114:5' }
    const host = [lab(1, 's3', 10), lab(2, 's4', 20), lab(3, 's3', 30), lab(4, 's4', 40)]
    const runLabels = [lab(5, '104:5', 10), lab(6, '114:5', 20), lab(7, '104:5', 30), lab(8, '114:5', 40)]
    const lines = [{ family: 'line', id: 9, site: '68:19', createdBar: 41, props: { x1: 1, y1: 1, x2: 2, y2: 2 } }]
    const base = { program, sites, hostRun: { status: 'ok', live: host }, bars: BARS, tf: 'D', sourceSha256: 'ab'.repeat(32) }
    expect(runHalfObjectVerdict({ ...base, payload: { status: 'ok', live: runLabels } }), 'CONTROL: only compared sites')
      .toEqual({ ok: true, compared: 4 })
    const v = runHalfObjectVerdict({ ...base, payload: { status: 'ok', live: [...runLabels, ...lines] } })
    expect(v.ok).toBe(false)
    expect(v.code).toBe(RUN_HALF_UNCOMPARED_SITE)
    // a run object with no site at all is uncompared too
    const bare = runHalfObjectVerdict({ ...base, payload: { status: 'ok', live: [...runLabels, { ...lines[0], site: null }] } })
    expect(bare.code).toBe(RUN_HALF_UNCOMPARED_SITE)
    // ⭐ the Part 2 hook, and only it, admits such a run
    setRunHalfObjectEvidence([{ sha256: 'ab'.repeat(32), captures: [MATCH('a'), MATCH('b')] }])
    expect(runHalfObjectVerdict({ ...base, payload: { status: 'ok', live: [...runLabels, ...lines] } }).ok).toBe(true)
    setRunHalfObjectEvidence([{ sha256: 'ab'.repeat(32), captures: [MATCH('a')] }])
    expect(runHalfObjectVerdict({ ...base, payload: { status: 'ok', live: [...runLabels, ...lines] } }).code).toBe(RUN_HALF_UNCOMPARED_SITE)
  })

  it('at the bind: the line compared and equal, the loop labels from a lost call: refused; evidence admits', () => {
    const def = install(door().definition)
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_UNCOMPARED_SITE })
    expect(runtimeObjectsOf(bind(def))).toBe(null)
    const dOnly = install(door(DRAW_ONLY).definition)
    expect(runHalfOf(bind(dOnly))).toEqual({ state: 'refused', code: RUN_HALF_UNCOMPARED_SITE })
    admit(SRC)
    expect(runHalfOf(bind(def)).state).toBe('served')
    expect(runHalfOf(bind(dOnly)).code, 'evidence is per script').toBe(RUN_HALF_UNCOMPARED_SITE)
  })

  it('the member reads it in words', () => {
    const s = runHalfRefusedSentence(RUN_HALF_UNCOMPARED_SITE)
    expect(s).not.toBe(runHalfRefusedSentence('x:y'))
    expect(s).not.toMatch(GUARD_TOKEN)
  })
})

describe('⛔⛔ the object rail at the bind', () => {
  // these fixtures' loop labels come from a lost call: admitted by evidence, so each test below
  // isolates a COMPARED site, which refuses whatever the evidence
  beforeEach(() => admit(SRC, DRAW_ONLY))
  it('CONTROL: the honest run half is served (the line compared, the labels drawn by the run)', () => {
    const cols = bind(install(door().definition))
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    expect(runtimeObjectsOf(cols).live.filter((o) => o.family === 'label')).toHaveLength(5)
  })

  it('a compared drawing that differs (an anchor past the tolerance, a colour, a style) is refused', () => {
    const def = install(door().definition)
    for (const [why, edit] of [
      ['anchor', (l) => { l.props.y1 = l.props.y1 * (1 + 1e-6) }],
      ['colour', (l) => { l.props.color = '#FF0000' }],
      ['style', (l) => { l.props.style = 'dashed' }],
      ['width', (l) => { l.props.width = 3 }],
    ]) {
      registry.registerRuntimeLane(tamperedLane((p) => edit(p.live.find((o) => o.family === 'line'))))
      expect(runHalfOf(bind(def)), why).toEqual({ state: 'refused', code: RUN_HALF_OBJECT_RAIL })
    }
    // ⛔ CONTROL: inside the tolerance the drawing is the same drawing
    registry.registerRuntimeLane(tamperedLane((p) => { const l = p.live.find((o) => o.family === 'line'); l.props.y1 *= 1 + 1e-12 }))
    expect(runHalfOf(bind(def)).state).toBe('served')
  })

  it('⛔ SITE IDS ARE THE PAIRING: the same line made at another call is not the host\'s line', () => {
    const def = install(door().definition)
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'line').site = '8:6' }))
    expect(runHalfOf(bind(def)).state).toBe('refused')
    expect([RUN_HALF_HOST_OBJECT_WITHHELD, RUN_HALF_OBJECT_RAIL]).toContain(runHalfOf(bind(def)).code)
    // and a run object claiming the host's call is held to it
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'label').site = '8:5' }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_OBJECT_RAIL })
  })

  it('⛔ the run WITHHOLDS a drawing the host draws (a warm-up, a collector, anything): refused', () => {
    const def = install(door().definition)
    registry.registerRuntimeLane(tamperedLane((p) => { p.live = p.live.filter((o) => o.family !== 'line') }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_HOST_OBJECT_WITHHELD })
  })

  it('⛔ made on another bar is another drawing', () => {
    const def = install(door().definition)
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'line').createdBar -= 1 }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_OBJECT_RAIL })
  })

  it('⛔ a drawing-only partial script (NO plot): the column rail compares nothing, the object rail does', () => {
    const d = door(DRAW_ONLY)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    expect(Object.keys(d.definition.compute.runtimeObjects.outputs)).toEqual([])
    const def = install(d.definition)
    expect(runHalfOf(bind(def)).state, 'CONTROL').toBe('served')
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'line').props.color = '#00FF00' }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_OBJECT_RAIL })
  })

  it('⛔ an unregistered rail is a refusal, never a pass', () => {
    const def = install(door().definition)
    const was = registeredRunHalfObjectRail()
    registerRunHalfObjectRail(null)
    try {
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: registry.RUN_HALF_RAIL_NOT_LOADED })
    } finally { registerRunHalfObjectRail(was) }
    expect(runHalfOf(bind(def)).state).toBe('served')
  })
})

describe('⛔ nothing comparable: refused, unless recorded evidence admits the script (the Part 2 hook)', () => {
  // the host program loses every drawing: nothing it draws can be compared
  const SRC0 = SRC.replace(`${LF}    line.new(bar_index - 1, low, bar_index, high)`, '')
  it('refused with no evidence, with one capture, with a non-MATCH; admitted with two MATCH captures', () => {
    const d = door(SRC0)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    expect(d.definition.objects).toBeFalsy()
    const def = install(d.definition)
    const h = runtimeSourceHash(SRC0)
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_NO_COMPARABLE_OBJECTS })
    setRunHalfObjectEvidence([{ sha256: h, captures: [MATCH('a')] }])
    expect(runHalfOf(bind(def)).code).toBe(RUN_HALF_NO_COMPARABLE_OBJECTS)
    setRunHalfObjectEvidence([{ sha256: h, captures: [MATCH('a'), MATCH('a')] }])
    expect(runHalfOf(bind(def)).code, 'two records of ONE capture are one capture').toBe(RUN_HALF_NO_COMPARABLE_OBJECTS)
    setRunHalfObjectEvidence([{ sha256: h, captures: [MATCH('a'), { ...MATCH('b'), verdict: 'DIVERGE' }] }])
    expect(runHalfOf(bind(def)).code).toBe(RUN_HALF_NO_COMPARABLE_OBJECTS)
    setRunHalfObjectEvidence([{ sha256: h, captures: [MATCH('a'), { ...MATCH('b'), runtimeOn: false }] }])
    expect(runHalfOf(bind(def)).code).toBe(RUN_HALF_NO_COMPARABLE_OBJECTS)
    setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(SRC), captures: [MATCH('a'), MATCH('b')] }])
    expect(runHalfOf(bind(def)).code, 'another script\'s evidence').toBe(RUN_HALF_NO_COMPARABLE_OBJECTS)
    setRunHalfObjectEvidence([{ sha256: h, captures: [MATCH('a'), MATCH('b')] }])
    expect(runHalfEvidenceAdmits(h)).toBe(true)
    expect(runHalfOf(bind(def)).state).toBe('served')
  })

  it('a family the host withholds WHOLE is not comparable; one it withholds in part refuses', () => {
    const live = [{ family: 'line', id: 1, site: 's1', createdBar: 5, props: { x1: 1, y1: 1, x2: 2, y2: 2 } }]
    const program = { ops: [{ k: 'create', family: 'line', site: 's1' }] }
    const sites = { s1: '8:5' }
    const payload = { status: 'ok', live: [{ ...live[0], site: '8:5' }] }
    const base = { program, sites, payload, bars: BARS, tf: 'D' }
    expect(runHalfObjectVerdict({ ...base, hostRun: { status: 'ok', live } }).ok, 'CONTROL').toBe(true)
    expect(runHalfObjectVerdict({ ...base, hostRun: { status: 'ok', live: [], withheld: { line: 1 } } }).code)
      .toBe(RUN_HALF_NO_COMPARABLE_OBJECTS)
    expect(runHalfObjectVerdict({ ...base, hostRun: { status: 'ok', live, withheld: { line: 1 } } }).code)
      .toBe(RUN_HALF_OBJECT_RAIL)
    expect(runHalfObjectVerdict({ ...base, hostRun: { status: 'OBJECT_RUNTIME_ERROR', live: [] } }).code)
      .toBe(RUN_HALF_OBJECT_RAIL)
    expect(runHalfObjectVerdict({ ...base, sites: {}, hostRun: { status: 'ok', live } }).code, 'an unmapped host site')
      .toBe(RUN_HALF_OBJECT_RAIL)
    expect(runHalfObjectVerdict({ ...base, hostRun: { status: 'ok', live: [] }, payload: { status: 'ok', live: [] } }).code,
      'compared sites holding nothing on either side').toBe(RUN_HALF_NO_COMPARABLE_OBJECTS)
  })

  it('a fill is compared by which compared lines it spans', () => {
    const L = (id, site, y) => ({ family: 'line', id, site, createdBar: 5, props: { x1: 1, y1: y, x2: 2, y2: y } })
    const F = (id, site, a, b) => ({ family: 'linefill', id, site, createdBar: 5, props: { line1: { __ref: a }, line2: { __ref: b }, color: '#ff000080' } })
    const program = { ops: [{ k: 'create', family: 'line', site: 's1' }, { k: 'create', family: 'line', site: 's2' }, { k: 'create', family: 'linefill', site: 's3' }] }
    const sites = { s1: '3:1', s2: '4:1', s3: '5:1' }
    const host = [L(1, 's1', 10), L(2, 's2', 20), F(3, 's3', 1, 2)]
    const run = (a, b) => [L(7, '3:1', 10), L(9, '4:1', 20), F(12, '5:1', a, b)]
    const base = { program, sites, hostRun: { status: 'ok', live: host }, bars: BARS, tf: 'D' }
    expect(runHalfObjectVerdict({ ...base, payload: { status: 'ok', live: run(7, 9) } }).ok).toBe(true)
    expect(runHalfObjectVerdict({ ...base, payload: { status: 'ok', live: run(9, 7) } }).code).toBe(RUN_HALF_OBJECT_RAIL)
  })
})

describe('⛔⛔ the program binding (the forgery residual)', () => {
  beforeEach(() => admit(SRC))
  it('an edited tree, an edited object program, an edited site map, a missing stamp: refused; re-stamped: served', () => {
    const minted = door().definition
    // a COHERENT forgery (it installs): another script's translated trees under this run half
    const other = door(SRC.replace('plot(m * 2, "m2")', 'plot(m * 3, "m2")'), { routeHostPartial: false }).definition
    const forgedTree = edited(minted, (d) => {
      d.compute = { ...clone(other.compute), runtimeObjects: d.compute.runtimeObjects }
    }, { keepStamp: true })
    expect(runHalfOf(bind(install(forgedTree)))).toEqual({ state: 'refused', code: registry.RUN_HALF_PROGRAM_UNBOUND })
    const forgedObjects = edited(minted, (d) => { d.objects.ops = d.objects.ops.slice(1) }, { keepStamp: true })
    expect(runHalfOf(bind(install(forgedObjects))).code).toBe(registry.RUN_HALF_PROGRAM_UNBOUND)
    const forgedSites = edited(minted, (d) => { d.compute.runtimeObjects.sites = { s1: '11:13' } }, { keepStamp: true })
    expect(runHalfOf(bind(install(forgedSites))).code).toBe(registry.RUN_HALF_PROGRAM_UNBOUND)
    const noStamp = edited(minted, (d) => { delete d.compute.runtimeObjects[RUN_HALF_PROGRAM_STAMP] }, { keepStamp: true })
    // ⭐ review of #1202: a document with NO stamp at all was minted by an older engine, said so
    expect(runHalfOf(bind(install(noStamp))).code).toBe(registry.RUN_HALF_PROGRAM_UNSTAMPED)
    expect(runHalfRefusedSentence(registry.RUN_HALF_PROGRAM_UNSTAMPED)).not.toBe(runHalfRefusedSentence(registry.RUN_HALF_PROGRAM_UNBOUND))
    expect(runHalfRefusedSentence(registry.RUN_HALF_PROGRAM_UNSTAMPED)).toMatch(/older version/)
    expect(runHalfRefusedSentence(registry.RUN_HALF_PROGRAM_UNSTAMPED)).not.toMatch(GUARD_TOKEN)
    // a stamp that is present and wrong is still "changed"
    const wrongStamp = edited(minted, (d) => { d.compute.runtimeObjects[RUN_HALF_PROGRAM_STAMP] = '0'.repeat(64) }, { keepStamp: true })
    expect(runHalfOf(bind(install(wrongStamp))).code).toBe(registry.RUN_HALF_PROGRAM_UNBOUND)
    expect(runHalfOf(bind(install(edited(minted, () => {})))).state, 'CONTROL: re-stamped, unchanged').toBe('served')
  })

  it('a document in its graph form is checked on its graph against the graph stamp', () => {
    const def = { id: 'g', compute: { kind: 'ast', scanPlot: 'value', graph: { nodes: [{ k: 1 }], roots: {} },
      trees: { value: { type: 'num', value: 2 } }, runtimeObjects: { source: 'x', outputs: {}, sites: {} } }, objects: null }
    const g = runHalfProgramDigest(def)
    def.compute.runtimeObjects[RUN_HALF_PROGRAM_GRAPH_STAMP] = g
    expect(runHalfProgramBound(def)).toBe(true)
    // the hydrated forest is derived: a different one does not move the graph's digest
    const other = clone(def)
    other.compute.trees.value.value = 3
    expect(runHalfProgramDigest(other)).toBe(g)
    const moved = clone(def)
    moved.compute.graph.nodes[0].k = 2
    expect(runHalfProgramBound(moved)).toBe(false)
    expect(canonicalJson({ b: 1, a: [NaN, undefined, 'x'] })).toBe('{"a":[null,null,"x"],"b":1}')
  })
})

describe('⭐ the chart: an object-rail refusal draws the host picture and says why', () => {
  it('the host line, none of the run\'s labels, and the sentence in words', () => {
    const def = install(door().definition)
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'line').props.width = 4 }))
    const fakeChart = createFakeChart()
    const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((x) => x.defId === def.id)
    const states = []
    binder.sync({
      enabled: true, cs, instances, registry, bars: BARS, tf: 'D', symbol: CTX.symbol, newestBarIsForming: false,
      historyFromListing: true, adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
    })
    const last = states[states.length - 1]
    expect(last.labels).toHaveLength(0)
    expect(last.lines).toHaveLength(1)
    render(<AttachedPineDisclosures settings={cs} registry={registry} />)
    const t = screen.queryByTestId('pine-attached-disclosures')?.textContent || ''
    expect(t).toContain(runHalfRefusedSentence(RUN_HALF_OBJECT_RAIL))
    expect(t).not.toMatch(GUARD_TOKEN)
    binder.teardown()
  })

  it('⛔ every engine-54 code has its own sentence, none a guard token', () => {
    const general = runHalfRefusedSentence('x:y')
    for (const code of [RUN_HALF_OBJECT_RAIL, RUN_HALF_HOST_OBJECT_WITHHELD, RUN_HALF_NO_COMPARABLE_OBJECTS, RUN_HALF_UNCOMPARED_SITE,
      registry.RUN_HALF_PROGRAM_UNBOUND, registry.RUN_HALF_RAIL_NOT_LOADED]) {
      const s = runHalfRefusedSentence(code)
      expect(s, code).not.toBe(general)
      expect(s, code).not.toMatch(GUARD_TOKEN)
    }
  })
})

describe('⭐ refusal telemetry: counted per document session, beaconed {code, hash}, never the source', () => {
  beforeEach(() => admit(SRC))
  it('one count per refusal entered (not per paint), one beacon per (script, code), no source', () => {
    const sent = []
    setRunHalfBeaconReporter((b) => sent.push(b))
    const def = install(door().definition)
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'line').props.width = 4 }))
    bind(def); bind(def); bind(def)
    const key = `${def.id}|${runtimeSourceHash(SRC).slice(0, 12)}`
    expect(runHalfRefusalCounts()[key]).toEqual({ [RUN_HALF_OBJECT_RAIL]: 1 })
    registry.registerRuntimeLane(runtimeColumnsFor)
    expect(runHalfOf(bind(def)).state).toBe('served')
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'line').props.width = 4 }))
    bind(def)
    expect(runHalfRefusalCounts()[key], 'served in between: entered again').toEqual({ [RUN_HALF_OBJECT_RAIL]: 2 })
    expect(sent).toEqual([{ code: RUN_HALF_OBJECT_RAIL, hash: runtimeSourceHash(SRC).slice(0, 12) }])
    for (const b of sent) {
      expect(Object.keys(b).sort()).toEqual(['code', 'hash'])
      expect(JSON.stringify(b)).not.toContain('indicator(')
      expect(JSON.stringify(runHalfRefusalCounts())).not.toContain('indicator(')
    }
  })

  it('⛔ a code outside the pattern (a sentence) is never sent', () => {
    expect(runHalfBeaconOf(SRC, 'the run draws a label differently')).toBe(null)
    expect(runHalfBeaconOf(SRC, 'run-half:object-rail')).toEqual({ code: 'run-half:object-rail', hash: runtimeSourceHash(SRC).slice(0, 12) })
    expect(RUN_HALF_CODE_RE.test('pane:not-graded')).toBe(true)
  })
})

// ─── REVIEW OF #1202 (CHANGES-REQUIRED at 3a0b463ea6) ─────────────────────────────────────
const TXT = ['//@version=5', 'indicator("txt", overlay = true)', 'm = ta.sma(close, 5)', 'plot(m, "m")',
  'if barstate.islast', '    label.new(bar_index, high, "#abc", tooltip = "#fff")', '    for i = 0 to 2',
  '        if close[i] > open[i]', '            line.new(bar_index - i, low[i], bar_index, high[i])'].join(LF)
// G7: two label.new calls of the same shape on lines 6 and 7
const PAIR = ['//@version=5', 'indicator("pair", overlay = true)', 'm = ta.sma(close, 5)', 'plot(m, "m")',
  'if barstate.islast', '    label.new(bar_index, high, "a")', '    label.new(bar_index, high, "a")', '    for i = 0 to 2',
  '        if close[i] > open[i]', '            line.new(bar_index - i, low[i], bar_index, high[i])'].join(LF)
// G8: a label changed by setters after it is made
const SETTER = ['//@version=5', 'indicator("setter", overlay = true)', 'm = ta.sma(close, 5)', 'plot(m, "m")',
  'if barstate.islast', '    lb = label.new(bar_index, high, "a")', '    label.set_text(lb, "b")', '    label.set_y(lb, low)',
  '    for i = 0 to 2', '        if close[i] > open[i]', '            line.new(bar_index - i, low[i], bar_index, high[i])'].join(LF)

describe('⛔⛔ review of #1202: TEXT is compared exactly, only a colour slot as a colour', () => {
  const L = (id, site, props) => ({ family: 'label', id, site, createdBar: 5, props: { x: 3, y: 101, text: 'Up', ...props } })
  const program = { ops: [{ k: 'create', family: 'label', site: 's1' }] }
  const verdict = (h, r) => runHalfObjectVerdict({ program, sites: { s1: '6:5' }, bars: BARS, tf: 'D',
    hostRun: { status: 'ok', live: [L(1, 's1', h)] }, payload: { status: 'ok', live: [L(2, '6:5', r)] } })
  it('pure: colour-shaped text and tooltips that differ are refused; a colour slot is still a colour', () => {
    expect(verdict({ text: '#abc' }, { text: '#AABBCC' }).code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(verdict({ text: 'rgb(1,2,3)' }, { text: '#010203' }).code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(verdict({ tooltip: '#fff' }, { tooltip: '#FFFFFF' }).code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(verdict({ text: 'Up' }, { text: 'up' }).code, 'CONTROL: case is text').toBe(RUN_HALF_OBJECT_RAIL)
    expect(verdict({ text: '#abc' }, { text: '#abc' }).ok, 'CONTROL: the same text').toBe(true)
    expect(verdict({ color: '#abc', textcolor: 'rgb(1,2,3)' }, { color: '#AABBCC', textcolor: '#010203' }).ok,
      'a colour SLOT keeps one spelling').toBe(true)
    expect(verdict({ color: '#abc' }, { color: '#abd' }).code).toBe(RUN_HALF_OBJECT_RAIL)
  })
  it("pure: a table cell's text is exact, its colours are colours", () => {
    const T = (id, site, cell) => ({ family: 'table', id, site, createdBar: 0, props: { position: 'top_right' },
      cells: [{ col: 0, row: 0, props: { text: 'x', ...cell } }] })
    const prog = { ops: [{ k: 'create', family: 'table', site: 's1' }] }
    const v = (h, r) => runHalfObjectVerdict({ program: prog, sites: { s1: '6:5' }, bars: BARS, tf: 'D',
      hostRun: { status: 'ok', live: [T(1, 's1', h)] }, payload: { status: 'ok', live: [T(2, '6:5', r)] } })
    expect(v({ text: '#fff' }, { text: '#FFFFFF' }).code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(v({ bgcolor: '#fff' }, { bgcolor: '#FFFFFF' }).ok).toBe(true)
  })
  it("at the bind: a run label whose text or tooltip is the colour-shaped spelling of the host's is refused", () => {
    admit(TXT)
    const d = door(TXT)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    const def = install(d.definition)
    expect(runHalfOf(bind(def)).state, 'CONTROL: honest').toBe('served')
    for (const [k, v] of [['text', '#AABBCC'], ['text', 'rgb(170,187,204)'], ['tooltip', '#FFFFFF']]) {
      registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'label').props[k] = v }))
      expect(runHalfOf(bind(def)), `${k} ${v}`).toEqual({ state: 'refused', code: RUN_HALF_OBJECT_RAIL })
    }
  })
})

describe('⛔ review of #1202: a theme reference never equals a literal', () => {
  const Ln = (id, site, color) => ({ family: 'line', id, site, createdBar: 5, props: { x1: 1, y1: 1, x2: 2, y2: 2, color } })
  const program = { ops: [{ k: 'create', family: 'line', site: 's1' }] }
  const v = (h, r) => runHalfObjectVerdict({ program, sites: { s1: '6:5' }, bars: BARS, tf: 'D',
    hostRun: { status: 'ok', live: [Ln(1, 's1', h)] }, payload: { status: 'ok', live: [Ln(2, '6:5', r)] } })
  it("host chart.fg_color against the run's #2962FF (the slot default) is refused; the same reference agrees", () => {
    expect(v('chart.fg_color', '#2962FF').code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(v('#2962FF', 'chart.fg_color').code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(v('chart.fg_color', 'chart.bg_color').code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(v('chart.fg_color@50', 'chart.fg_color').code).toBe(RUN_HALF_OBJECT_RAIL)
    expect(v('chart.fg_color', 'chart.fg_color').ok, 'CONTROL').toBe(true)
  })
})

describe('⛔ review of #1202: two same-shape calls keep two sites (G7); a setter is compared at its final state (G8)', () => {
  it('G7: label.new on lines 6 and 7, same arguments: two sites in the probe, the door and the run; served', () => {
    admit(PAIR)
    const probe = probeRuntimeProgram(PAIR, { objectsInRun: true })
    expect(probe.objectSites.filter((x) => x.fn === 'label.new').map((x) => x.site).sort()).toEqual(['6:5', '7:5'])
    const d = door(PAIR)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    expect(Object.values(d.definition.compute.runtimeObjects.sites).sort()).toEqual(['6:5', '7:5'])
    const cols = bind(install(d.definition))
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    expect(runtimeObjectsOf(cols).live.filter((o) => o.family === 'label').map((o) => o.site)).toEqual(['6:5', '7:5'])
  })
  it("G8: the host and the run agree at the label's FINAL text and y; a run at its create-time props is refused", () => {
    admit(SETTER)
    const d = door(SETTER)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    const def = install(d.definition)
    const cols = bind(def)
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    const lab = runtimeObjectsOf(cols).live.find((o) => o.family === 'label')
    expect(lab.props.text).toBe('b')
    expect(lab.props.y).toBe(BARS[BARS.length - 1].l)
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'label').props.text = 'a' }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_OBJECT_RAIL })
    registry.registerRuntimeLane(tamperedLane((p) => { p.live.find((o) => o.family === 'label').props.y = BARS[BARS.length - 1].h }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: RUN_HALF_OBJECT_RAIL })
  })
})
