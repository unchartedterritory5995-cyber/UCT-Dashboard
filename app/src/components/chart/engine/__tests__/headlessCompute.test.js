// @vitest-environment node
// app/src/components/chart/engine/__tests__/headlessCompute.test.js
//
// ─── ⭐⭐ HEADLESS (Studio R6): A SAVED DEFINITION, COMPUTED WITH NO CHART, ITS WORK COUNTED ─────────
//
// `headlessCompute.js::computeHeadless(definition, bars, opts) -> {lane, outputs, work}` is the door the
// library and share cards' load budget reads, in the browser and in the server bundle. The rails:
//   1. DETERMINISM — the same definition over the same bars gives the same `work` (and the same
//      outputs, bit for bit) on every run, and on a second host: the BUILT server bundle, run under bare
//      node in a child process, gives the module's numbers;
//   2. ONE ROUTER — the lane is `computeLane.js::computeLaneOf`'s, the function `computeFor` dispatches
//      on (read off both modules' syntax trees, comments never counted), and the headless outputs ARE
//      `computeFor`'s columns for the same definition, bars and context;
//   3. REFUSAL BY NAME — every way a definition is not computed answers the engine's own code
//      (each one registered in `supportLoop/refusalCodes.json`), never a partial result;
//   4. THE REFERENCE SERIES — its digest is pinned, both hosts make the same bytes, every bar is valid
//      OHLC on an exchange session, and no clock or `Math.random` is read making it;
//   5. THE SERVER BUNDLE carries the export and the generator.
// Plus: no clock decides `work` (a host clock that jumps past every wall-clock stop changes nothing).
// The house set and RS Rating over the reference series are printed as the measurement table.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseJs } from 'acorn'
import { computeHeadless } from '../headlessCompute'
import { computeLaneOf, COMPUTE_LANE } from '../computeLane'
import * as registry from '../nativeRegistry'
import { runtimeColumnsFor, setRuntimeDoorClock } from '../runtime/runtimeColumns'
import { runtimeInputSpecsOf } from '../runtime/runtimeInputs.js'
import { DEFAULT_LIMITS } from '../runtime/limits'
import { MAX_EVALUATION_UNITS } from '../ast/interpret'
import { DEFAULT_BUDGET } from '../ast/budget'
import { fetchableOtherSymbols } from '../otherSymbols'
import {
  referenceBars, referenceBenchmarkBars, referenceDigest, referenceOptions, REFERENCE_BARS_SHA256,
  REFERENCE_BENCHMARK_SHA256, REFERENCE_BAR_COUNT, REFERENCE_START, REFERENCE_TIMEFRAME, REFERENCE_SYMBOL,
} from '../referenceSeries'
import { isTradingDay } from '../../../../lib/marketClock/sessionCalendar'
import { buildPineRuntime } from '../../../../../scripts/build-pine-runtime.mjs'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { __permitRuntimePaneForTests } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../runtimeKill'
import HOUSE from '../../house/houseIndicators.json'
import CODES from '../../supportLoop/refusalCodes.json'

vi.setConfig({ testTimeout: 180000 })

const APP = path.resolve(process.cwd())
const REPO = path.resolve(APP, '..')
const ENGINE = path.join(APP, 'src', 'components', 'chart', 'engine')
const LF = String.fromCharCode(10)
const lines = (...l) => [...l, ''].join(LF)
/** A definition as the store holds it: JSON. */
const stored = (d) => JSON.parse(JSON.stringify(d))

// ─── the corpus ───────────────────────────────────────────────────────────────────────────────────

const RS_SOURCE = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
/** RS Rating through the member door, as production mints it (the runtime pane on: its run half rides). */
function withRuntimePane(fn) {
  // a permitted member with the script graded, as `src/test-setup.js` sets per test (this also runs in
  // `beforeAll`), on a build whose runtime pane is on, as production's is
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  try {
    return fn()
  } finally {
    vi.unstubAllEnvs()
  }
}
function rsRatingDoc() {
  const r = withRuntimePane(() => memberPaneDefinition({ source: RS_SOURCE, id: 'u_rsrating', name: 'RS Rating' }))
  expect(r.ok, r.reason).toBe(true)
  return stored(r.definition)
}

/** The run half's own runtime document, as `nativeRegistry::runHalfDefOf` builds it for the chart (a
 *  MEASUREMENT of what the chart's run half costs, beside the host document's own work), with the host
 *  document's other-symbol list so it is handed the bars the chart fetched for the host. */
function runHalfDoc(def) {
  const ro = def.compute.runtimeObjects
  const meta = { runtimeHistory: 'listing', otherSymbols: def.meta.otherSymbols, recurrenceOrigin: def.meta.recurrenceOrigin }
  for (const k of ['runtimeLanguage', 'runtimeFrontend', 'runtimeIr', 'runtimeOutputSignature']) if (ro[k] !== undefined) meta[k] = ro[k]
  return stored({
    id: `${def.id}~run`, version: def.version,
    compute: { kind: 'runtime', fn: `runtime:${def.id}~run`, rev: 1, source: ro.source, outputs: { ...ro.outputs }, objects: true },
    inputs: runtimeInputSpecsOf(ro.source).specs, meta,
  })
}

const RT_SOURCE = lines('//@version=5', 'indicator("headless rt")', 'var float s = 0.0', 's := s + close - open',
  'plot(s, "s")', 'plot(ta.sma(close, 20), "m")')
const rtDoc = (id, source = RT_SOURCE, meta = {}) => stored({
  id, version: 1, compute: { kind: 'runtime', fn: `runtime:${id}`, source, outputs: { value: 0, m: 1 } },
  meta: { name: id, ...meta }, plots: [{ key: 'value' }, { key: 'm' }],
})

let BARS, OPTS, RS, RS_RUN, CORPUS
beforeAll(() => {
  BARS = referenceBars()
  OPTS = referenceOptions()
  RS = rsRatingDoc()
  RS_RUN = runHalfDoc(RS)
  CORPUS = [
    ...HOUSE.indicators.map((h) => ({ name: h.name, def: h.definition })),
    { name: 'RS Rating (member door)', def: RS },
    { name: 'RS Rating, its run half', def: RS_RUN },
    { name: 'a runtime document', def: rtDoc('u_headless_rt') },
  ]
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  registry.registerRuntimeLane(null)
  setRuntimeDoorClock(null)
})

/** sha256 of a series' Float64 bytes (a plain array is read as Float64, `NaN` kept). */
function digestOf(values) {
  const col = values instanceof Float64Array ? values : Float64Array.from(values)
  return createHash('sha256').update(new Uint8Array(col.buffer, col.byteOffset, col.byteLength)).digest('hex')
}
/** The drawn outputs with each series reduced to its digest: key, title, order and withholdings kept. */
const entriesBrief = (entries) => entries.map((e) => ({ key: e.key, title: e.title, values: digestOf(e.values),
  ...(e.withheld ? { withheld: e.withheld } : {}) }))
const brief = (r) => (r.refusal ? { lane: r.lane, refusal: r.refusal.code } : { lane: r.lane, work: r.work, outputs: entriesBrief(r.outputs) })
/** The plots the chart draws, in plot order (no `hidden` helper, no `hlines` guide). */
const drawnPlots = (def) => (def.plots || []).filter((p) => p && typeof p.key === 'string' && p.style !== 'hlines' && p.hidden !== true)

// ─── 1. determinism ───────────────────────────────────────────────────────────────────────────────

describe('1. the same definition over the same bars gives the same work, every run', () => {
  it('twice in one process: the same work and the same outputs, bit for bit, for every corpus definition', () => {
    for (const { name, def } of CORPUS) {
      const a = computeHeadless(def, BARS, OPTS)
      const b = computeHeadless(def, referenceBars(), referenceOptions())
      expect(a.refusal, `${name}: ${a.refusal && a.refusal.message}`).toBeUndefined()
      expect(Number.isInteger(a.work) && a.work > 0, name).toBe(true)
      expect(brief(b), name).toEqual(brief(a))
    }
  })

  it('no clock decides it: a host clock that jumps past every wall-clock stop changes no work and no column', () => {
    const before = CORPUS.map(({ def }) => brief(computeHeadless(def, BARS, OPTS)))
    let t = 0
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => { t += 60000; return t })
    vi.spyOn(Date, 'now').mockImplementation(() => { t += 60000; return t })
    const after = CORPUS.map(({ def }) => brief(computeHeadless(def, BARS, OPTS)))
    expect(after).toEqual(before)
    // ⛔ the control: the jumping clock DOES stop the chart's own door, so it was live during the run
    registry.registerRuntimeLane(runtimeColumnsFor)
    const cols = registry.computeFor(rtDoc('u_headless_clock_control'), BARS, {}, { tf: 'D', historyFromListing: true, newestBarIsForming: false })
    expect(registry.columnErrors(cols).value && registry.columnErrors(cols).value.guard).toBe('runtime:time-budget')
  })
})

// ─── 2. one router ────────────────────────────────────────────────────────────────────────────────

/** Every node of a syntax tree (comments are not nodes, so prose never counts). */
function* nodesOf(node) {
  if (!node || typeof node.type !== 'string') return
  yield node
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'range') continue
    if (Array.isArray(v)) for (const c of v) yield* nodesOf(c)
    else if (v && typeof v === 'object' && typeof v.type === 'string') yield* nodesOf(v)
  }
}
const treeOf = (file) => parseJs(fs.readFileSync(path.join(ENGINE, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' })
const fnNamed = (tree, name) => [...nodesOf(tree)].find((n) => n.type === 'FunctionDeclaration' && n.id && n.id.name === name)
const callsTo = (node, name) => [...nodesOf(node)].filter((n) => n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === name).length
/** A comparison that reads `.kind` itself: a second router. ⛔ `def?.compute?.kind` parses as a
 *  `ChainExpression` around the member read (the mutation proof found the probe blind to it). */
const unchain = (s) => (s && s.type === 'ChainExpression' ? s.expression : s)
const kindTests = (node) => [...nodesOf(node)].filter((n) => n.type === 'BinaryExpression'
  && [n.left, n.right].map(unchain).some((s) => s.type === 'MemberExpression' && !s.computed && s.property.name === 'kind')).length

describe('2. the lane is the chart router\'s, and the outputs are the chart\'s columns', () => {
  it('computeFor and computeHeadless each ask computeLaneOf, and neither reads compute.kind itself', () => {
    const computeFor = fnNamed(treeOf('nativeRegistry.js'), 'computeFor')
    const headless = treeOf('headlessCompute.js')
    expect(callsTo(computeFor, 'computeLaneOf')).toBe(1)
    expect(kindTests(computeFor)).toBe(0)
    expect(callsTo(fnNamed(headless, 'computeHeadless'), 'computeLaneOf')).toBe(1)
    expect(kindTests(headless)).toBe(0)
    // ⛔ the control: the probe finds a kind test where one is written
    expect(kindTests(parseJs("if (def.compute.kind === 'ast') f()", { ecmaVersion: 'latest' }))).toBe(1)
    expect(kindTests(parseJs("if (def?.compute?.kind === 'ast') f()", { ecmaVersion: 'latest' }))).toBe(1)
  })

  it('every corpus definition is computed on computeLaneOf\'s lane; a lane with no counter throws, naming it', () => {
    for (const { name, def } of CORPUS) expect(computeHeadless(def, BARS, OPTS).lane, name).toBe(computeLaneOf(def))
    expect(new Set(CORPUS.map(({ def }) => computeLaneOf(def)))).toEqual(new Set([COMPUTE_LANE.AST, COMPUTE_LANE.RUNTIME]))
    const others = [registry.NATIVE_DEFS[0], ...registry.SERVER_DEFS.slice(0, 1)]
    expect(others.length).toBeGreaterThan(0)
    for (const def of others) {
      let thrown = null
      try { computeHeadless(def, BARS, OPTS) } catch (e) { thrown = e }
      expect(thrown && thrown.lane, def.id).toBe(computeLaneOf(def))
      expect([COMPUTE_LANE.NATIVE, COMPUTE_LANE.SERVER]).toContain(thrown.lane)
    }
  })

  it('the headless outputs ARE computeFor\'s columns for the same definition, bars and context', () => {
    registry.registerRuntimeLane(runtimeColumnsFor)
    // the chart's door on a clock that never moves (the vendor harness's seam): its 1,000 ms pane budget
    // is a property of the box, and this compares values, not the box
    setRuntimeDoorClock(() => 0)
    for (const { name, def } of CORPUS) {
      const keys = fetchableOtherSymbols(def)
      const ctx = {
        tf: REFERENCE_TIMEFRAME, symbol: REFERENCE_SYMBOL, historyFromListing: true, newestBarIsForming: false,
        ...(keys.length ? { secondary: new Map(keys.map((k) => [k, { bars: OPTS.otherBars(k), status: 'available' }])) } : {}),
      }
      const chart = registry.computeFor(def, BARS, {}, ctx)
      const headless = computeHeadless(def, BARS, OPTS)
      expect(headless.outputs.map((e) => e.key), name).toEqual(drawnPlots(def).map((p) => p.key))
      for (const e of headless.outputs) expect(digestOf(e.values), `${name}: ${e.key}`).toBe(digestOf(chart[e.key]))
    }
  })
})

describe('2b. outputs: one entry per drawn plot, by key, titled as the chart titles it', () => {
  it('in plot order; hidden helpers and guides are not drawn; values are a plain number[] per bar', () => {
    for (const { name, def } of CORPUS) {
      const r = computeHeadless(def, BARS, OPTS)
      expect(r.outputs.map((e) => e.key), name).toEqual(drawnPlots(def).map((p) => p.key))
      for (const e of r.outputs) expect(Array.isArray(e.values) && e.values.length === BARS.length, `${name}: ${e.key}`).toBe(true)
    }
    // ATR Extension draws `ext`; its colour-rule helper `ext_cs` (hidden) and its `levels` guide are not drawn
    expect(computeHeadless(house('atr_extension'), BARS, OPTS).outputs.map((e) => [e.key, e.title]))
      .toEqual([['ext', 'ATR Extensio']])
  })

  it('an untitled plot is null; two plots sharing a title stay two entries, apart by key and position', () => {
    // the member door's reading of a script: untitled, titled twice the same, untitled again
    const src = lines('//@version=5', 'indicator("titles")', 'plot(close)', 'plot(open, title="A")', 'plot(high, "A")',
      'x = ta.sma(close, 5)', 'plot(x)')
    const door = memberPaneDefinition({ source: src, id: 'u_titles', name: 'titles' })
    expect(door.ok, door.reason).toBe(true)
    const r = computeHeadless(stored(door.definition), BARS, OPTS)
    expect(r.outputs.map((e) => e.key)).toEqual(['value', 'out2', 'out3', 'out4'])
    // ⚠️ `value`: the door labels an untitled FIRST plot with the indicator's name; a host document that
    // kept no script cannot tell that stand-in from a title, so the chart's form (and this) reads it
    expect(r.outputs.map((e) => e.title)).toEqual(['titles', 'A', 'A', null])
    expect(digestOf(r.outputs[1].values)).toBe(digestOf(BARS.map((b) => b.o)))
    expect(digestOf(r.outputs[2].values)).toBe(digestOf(BARS.map((b) => b.h)))
    // with its script kept (a runtime document), the untitled first plot is null too
    const rt = computeHeadless(rtDoc('u_untitled'), BARS, OPTS)
    expect(rt.outputs.map((e) => [e.key, e.title])).toEqual([['value', null], ['m', null]])
    // a script only the per-bar lane can run (two `var`s that read each other), minted by the door as a runtime
    // document with its script kept, untitled first plot and a title used twice
    const runtimeDoor = withRuntimePane(() => memberPaneDefinition({ source: lines('//@version=5', 'indicator("rt titles")',
      'var float s = 0.0', 'var float q = 0.0', 'q := s', 's := q + close', 'plot(s)', 'plot(q, "Q")', 'plot(q * 2, "Q")'),
    id: 'u_rt_titles', name: 'rt titles' }))
    expect(runtimeDoor.ok, runtimeDoor.reason).toBe(true)
    expect(runtimeDoor.definition.compute.kind).toBe('runtime')
    const r2 = computeHeadless(stored(runtimeDoor.definition), BARS, OPTS)
    expect(r2.refusal, JSON.stringify(r2.refusal)).toBeUndefined()
    expect(r2.outputs.map((e) => e.title)).toEqual([null, 'Q', 'Q'])
    expect(new Set(r2.outputs.map((e) => e.key)).size).toBe(3)
    expect(digestOf(r2.outputs[2].values)).not.toBe(digestOf(r2.outputs[1].values))
  })
})

describe("2c. each lane's work has a hard ceiling, read from the module that counts it", () => {
  it("the formula lane's ceiling is derived: the per-tree node cap x TradingView's 64 plots x a helper each", () => {
    expect(MAX_EVALUATION_UNITS).toBe(DEFAULT_BUDGET.maxNodes * 64 * 2)
    for (const { name, def } of CORPUS) {
      const r = computeHeadless(def, BARS, OPTS)
      const ceiling = r.lane === COMPUTE_LANE.AST ? MAX_EVALUATION_UNITS : DEFAULT_LIMITS.TOTAL_INSTRUCTIONS
      expect(r.work, name).toBeLessThan(ceiling)
    }
  })

  it('past it, a counted run is refused by name (budget:nodes); the chart, which counts nothing, draws it', () => {
    // 170 trees of 101 nodes each: every tree inside the per-tree cap, the whole run past the ceiling
    const trees = {}
    const plots = []
    for (let i = 0; i < 170; i += 1) {
      let node = { type: 'series', name: 'close' }
      for (let j = 0; j < 50; j += 1) node = { type: 'op', name: '+', args: [node, { type: 'num', value: i * 1000 + j + 1 }] }
      trees[`p${i}`] = node
      plots.push({ key: `p${i}`, style: 'line' })
    }
    const wide = stored({ id: 'u_wide', version: 1, compute: { kind: 'ast', fn: 'sha256:wide', ast: trees.p0, trees },
      plots, inputs: [], meta: { name: 'wide' } })
    const bars = BARS.slice(0, 300)
    const r = computeHeadless(wide, bars, OPTS)
    expect(r.refusal && r.refusal.code, JSON.stringify(r.refusal || { work: r.work })).toBe('budget:nodes')
    expect(r.refusal.message).toContain(String(MAX_EVALUATION_UNITS))
    const chart = registry.computeFor(wide, bars, {}, { tf: 'D' })
    expect(registry.columnErrors(chart)).toEqual({})
    expect(Object.keys(chart)).toHaveLength(170)
    // ⛔ the control: under the ceiling, the same shape computes and counts every node
    const narrow = stored({ ...wide, compute: { ...wide.compute, trees: Object.fromEntries(Object.entries(trees).slice(0, 100)) },
      plots: plots.slice(0, 100) })
    expect(computeHeadless(narrow, bars, OPTS).work).toBe(100 * 101)
  })
})

// ─── 3. refusal by name ───────────────────────────────────────────────────────────────────────────

const house = (slug) => HOUSE.indicators.find((h) => h.slug === slug).definition
const withMeta = (def, meta) => ({ ...def, meta: { ...def.meta, ...meta } })
const PER_BAR = lines('//@version=5', 'indicator("per bar")', 'var float s = 0.0', 'for i = 0 to 20000', '    s := s + i', 'plot(s)')
// ~100 instructions a pass, 1,000 passes a bar: under the per-bar ceiling and the loop ceiling, so the
// WHOLE-RUN instruction ceiling is the one met (~bar 2,000 of 5,000)
const WHOLE_RUN = lines('//@version=5', 'indicator("whole run")', 'var float a = 0.0', 'var float b = 0.0',
  'var float c = 0.0', 'var float d = 0.0', 'for i = 0 to 999', '    a := a + i * 2 - 1', '    b := b + a / 3 + i',
  '    c := c + b * 0.5 - a', '    d := d + c - b + i', '    a := a - d * 0.25 + c', '    b := b - a + d / 7',
  '    c := c + d - a * 0.125', '    d := d - c + b / 9', 'plot(a + b + c + d)')
const REACHED = lines('//@version=5', 'indicator("reached")', 'if bar_index == 10', '    runtime.error("stop here")', 'plot(close)')
const one = (id, source) => ({ ...rtDoc(id, source), compute: { kind: 'runtime', fn: `runtime:${id}`, source, outputs: { value: 0 } }, plots: [{ key: 'value' }] })

describe('3. a refused definition answers the engine\'s own code, never a partial result', () => {
  const CASES = [
    ['a served row on the runtime kill list', () => rtDoc('u_k', RT_SOURCE, { runtimeKilled: 'definition `u_k` is on the server\'s runtime kill list' }), 'runtime:killed'],
    ['a served row not yet graded', () => rtDoc('u_g', RT_SOURCE, { runtimeNotGraded: 'this script has not been checked yet' }), 'runtime:not-yet-graded'],
    ['a served row on the host known-divergence list', () => withMeta(house('atr_extension'), { hostKnownDivergence: 'this script is not drawn: x' }), 'pine:known-divergence'],
    // ⭐ HELD WITHHOLDS — a saved copy minted before its script's narrow withholds, served stamped, on both lanes
    ['a served runtime row saved before its held withholds', () => rtDoc('u_hw', RT_SOURCE, { heldDivergence: 'pine:held-divergence: this saved copy is not drawn: x' }), 'pine:held-divergence'],
    ['a served host row saved before its held withholds', () => withMeta(house('atr_extension'), { heldDivergence: 'pine:held-divergence: this saved copy is not drawn: x' }), 'pine:held-divergence'],
    ['a run past the per-bar instruction ceiling', () => one('u_pb', PER_BAR), 'runtime:limit', 'INSTRUCTIONS_PER_BAR'],
    // ⭐ the ceiling the stop names is `limits.js`'s own (`DEFAULT_LIMITS.TOTAL_INSTRUCTIONS`), in the member's words
    ['a run past the WHOLE-RUN instruction ceiling', () => one('u_wr', WHOLE_RUN), 'runtime:limit', 'TOTAL_INSTRUCTIONS',
      DEFAULT_LIMITS.TOTAL_INSTRUCTIONS.toLocaleString('en-US')],
    ['the script\'s own runtime.error, reached', () => one('u_re', REACHED), 'pine:runtime.error'],
    ['a host document declaring runtime.error checks', () => withMeta(house('atr_extension'), { runtimeErrors: [{ line: 3 }] }), 'pine:runtime.error'],
    ['a host plot past its node budget', () => ({ ...house('atr_extension'), compute: { ...house('atr_extension').compute, budget: { maxNodes: 2 } } }), 'budget:nodes'],
  ]
  for (const [what, make, code, limit, says] of CASES) {
    it(`${what}: ${code}${limit ? ` (${limit})` : ''}`, () => {
      const r = computeHeadless(make(), BARS, OPTS)
      expect(r.refusal && r.refusal.code, JSON.stringify(r.refusal || { work: r.work })).toBe(code)
      expect(r.outputs).toBeNull()
      expect(r.work).toBeNull()
      expect(typeof r.refusal.message === 'string' && r.refusal.message.length > 0).toBe(true)
      if (limit) expect(r.refusal.limit).toBe(limit)
      if (says) expect(r.refusal.message).toContain(says)
      expect(CODES.codes, `${code} is not a registered refusal code`).toContain(code)
    })
  }

  it('another symbol not handed to it: the bind\'s own code, never an all-na column (host and runtime lanes)', () => {
    const bare = { tf: REFERENCE_TIMEFRAME, symbol: REFERENCE_SYMBOL, historyFromListing: true }
    for (const def of [house('relative_strength_vs_spy'), RS, RS_RUN]) {
      const r = computeHeadless(def, BARS, bare)
      expect(r.refusal, def.id).toBeDefined()
      // the host bind's code on the host lane; the run's own request refusal on the runtime lane
      expect(r.refusal.code, def.id).toBe(r.lane === COMPUTE_LANE.AST ? 'other-symbol:no-bars' : 'runtime:request')
      expect(CODES.codes).toContain(r.refusal.code)
    }
    // ⛔ the control: handed the bars, each computes
    for (const def of [house('relative_strength_vs_spy'), RS, RS_RUN]) expect(computeHeadless(def, BARS, OPTS).refusal).toBeUndefined()
  })

  it('a host document carrying a run half gives its values and NAMES the run part not computed', () => {
    const r = computeHeadless(RS, BARS, OPTS)
    expect(RS.compute.runtimeObjects).toBeTruthy()
    expect(r.runParts).toEqual(['runtimeObjects'])
    expect(computeHeadless(house('atr_extension'), BARS, OPTS).runParts).toBeUndefined()
  })
})

// ─── 4. the reference series ──────────────────────────────────────────────────────────────────────

describe('4. the reference series', () => {
  it('is 5,000 valid daily bars on exchange sessions from its start date, and its digest is the pinned one', () => {
    expect(BARS).toHaveLength(REFERENCE_BAR_COUNT)
    expect(REFERENCE_BAR_COUNT).toBe(5000)
    expect(BARS[0].t).toBe(REFERENCE_START)
    for (let i = 0; i < BARS.length; i += 1) {
      const b = BARS[i]
      expect(isTradingDay(b.t), b.t).toBe(true)
      if (i) expect(b.t > BARS[i - 1].t, b.t).toBe(true)
      expect(b.l > 0 && b.l <= Math.min(b.o, b.c) && Math.max(b.o, b.c) <= b.h && Number.isInteger(b.v) && b.v > 0, JSON.stringify(b)).toBe(true)
    }
    expect(referenceDigest(BARS)).toBe(REFERENCE_BARS_SHA256)
    expect(referenceDigest(referenceBenchmarkBars())).toBe(REFERENCE_BENCHMARK_SHA256)
    expect(referenceBenchmarkBars().map((b) => b.t)).toEqual(BARS.map((b) => b.t))
  })

  it('reads no clock and no Math.random: with all three throwing, the same bytes', () => {
    const boom = () => { throw new Error('a clock or Math.random was read') }
    vi.spyOn(Date, 'now').mockImplementation(boom)
    vi.spyOn(globalThis.performance, 'now').mockImplementation(boom)
    vi.spyOn(Math, 'random').mockImplementation(boom)
    expect(referenceDigest(referenceBars())).toBe(REFERENCE_BARS_SHA256)
    // …and neither does the host lane's compute
    expect(computeHeadless(house('atr_extension'), referenceBars(), referenceOptions()).work).toBeGreaterThan(0)
  })
})

// ─── 5. the server bundle, a second host ──────────────────────────────────────────────────────────

describe('5. the server bundle carries the export and the generator, and computes the same numbers', () => {
  let dir, built
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-headless-'))
    built = await buildPineRuntime({ outfile: path.join(dir, 'pine-runtime.mjs'), logLevel: 'silent', env: {} })
  }, 120000)

  it('exports computeHeadless, the lane router and the reference series', () => {
    const text = fs.readFileSync(built.outfile, 'utf8')
    const tail = text.slice(text.lastIndexOf('export {'))
    for (const name of ['computeHeadless', 'computeLaneOf', 'COMPUTE_LANE', 'referenceBars', 'referenceBenchmarkBars',
      'referenceDigest', 'referenceOptions', 'REFERENCE_BARS_SHA256']) expect(tail, name).toMatch(new RegExp(`\\b${name}\\b`))
  })

  it('under bare node, the bundle makes the pinned bytes and every corpus definition\'s work and outputs', () => {
    fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify(CORPUS))
    const script = [
      "import { createHash } from 'node:crypto'",
      "import { readFileSync } from 'node:fs'",
      "import * as m from './pine-runtime.mjs'",
      "const corpus = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'))",
      'const digestOf = (v) => { const c = Float64Array.from(v); return createHash(\'sha256\').update(new Uint8Array(c.buffer, c.byteOffset, c.byteLength)).digest(\'hex\') }',
      'const digests = (entries) => entries.map((e) => ({ key: e.key, title: e.title, values: digestOf(e.values), ...(e.withheld ? { withheld: e.withheld } : {}) }))',
      'const bars = m.referenceBars()',
      'const results = corpus.map(({ name, def }) => { const r = m.computeHeadless(def, bars, m.referenceOptions()); return [name, r.refusal ? { lane: r.lane, refusal: r.refusal.code } : { lane: r.lane, work: r.work, outputs: digests(r.outputs) }] })',
      'console.log(JSON.stringify({ bars: m.referenceDigest(bars), benchmark: m.referenceDigest(m.referenceBenchmarkBars()), results }))',
    ].join(LF)
    fs.writeFileSync(path.join(dir, 'child.mjs'), script)
    const r = spawnSync(process.execPath, ['child.mjs'], { cwd: dir, encoding: 'utf8', timeout: 170000 })
    expect(r.status, r.stderr).toBe(0)
    const got = JSON.parse(r.stdout.trim().split(LF).pop())
    expect(got.bars).toBe(REFERENCE_BARS_SHA256)
    expect(got.benchmark).toBe(REFERENCE_BENCHMARK_SHA256)
    const here = CORPUS.map(({ name, def }) => [name, brief(computeHeadless(def, BARS, OPTS))])
    expect(got.results).toEqual(here)
  })
})

// ─── the measurement (printed; the budget is the Studio's to set) ─────────────────────────────────

describe('the reference measurement: the house set and RS Rating over the reference series', () => {
  it('every house indicator and RS Rating computes; the table is printed', () => {
    const rows = CORPUS.filter(({ def }) => def !== CORPUS[CORPUS.length - 1].def).map(({ name, def }) => {
      const r = computeHeadless(def, BARS, OPTS)
      expect(r.refusal, name).toBeUndefined()
      return { name, lane: r.lane, work: r.work, ...(r.runParts ? { runParts: r.runParts.join(',') } : {}) }
    })
    console.log(`headless work over the reference series (${REFERENCE_BAR_COUNT} daily bars from ${REFERENCE_START}, `
      + `sha256 ${REFERENCE_BARS_SHA256.slice(0, 12)}):${LF}${rows.map((x) => `  ${x.name} | ${x.lane} | ${x.work}`
      + `${x.runParts ? ` | not counted: ${x.runParts}` : ''}`).join(LF)}`)
  })
})
