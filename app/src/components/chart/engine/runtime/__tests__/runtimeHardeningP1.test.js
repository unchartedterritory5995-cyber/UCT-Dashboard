// app/src/components/chart/engine/runtime/__tests__/runtimeHardeningP1.test.js
//
// ⭐⭐ UNIVERSAL INDICATOR ENGINE — PHASE 1, RUNTIME HARDENING (2026-10-11).
//
// One file per finding of the read-only runtime investigation, each proved on the
// REAL front end, lowering and VM (no mocks of the engine):
//   A. every declared limit is counted, and each stops by NAME (normal, boundary,
//      adversarial);
//   B. the opcode table encodes each number once;
//   C. the run memo is invalidated by an edit of the script, not only by new bars;
//   D. a document runs only on the engine (language / front end / IR) it was minted
//      for, and only while each mapped output index names what it named at mint;
//   E. a run is deterministic over identical bars, and a corrected bar recomputes.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRuntimeIr, RUNTIME_FRONTEND_LANGUAGE, RUNTIME_FRONTEND_VERSION } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { OP, OP_NAME, IMPLEMENTED } from '../program.js'
import { LIMIT_NAMES, DEFAULT_LIMITS, RuntimeLimitError } from '../limits.js'
import { RUNTIME_IR_VERSION } from '../ir.js'
import { POOL_LIMITS, collectsAbove } from '../../objectPool.js'
import {
  computeRuntimeColumns, runtimeColumnsFor, setRuntimeRunner, probeRuntimeProgram, probeObjectRuntime,
  runtimeVersionStamp, runtimeOutputSignature, utf8Bytes, RUNTIME_LIMIT_GUARD, RUNTIME_VERSION_GUARD,
} from '../runtimeColumns.js'

const N = 300
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = (decl = '') => `//@version=6\nindicator("t", overlay = true${decl})\n`

/** The real pipeline: build → lower → execute, with `limits` / `opts` handed to the VM. */
function run(src, { decl = '', limits, opts, objects = true } = {}) {
  const built = buildRuntimeIr(head(decl) + src, {
    bars: BARS, inputs: {}, ...(objects ? { objectsInRun: true } : { objectTrees: [] }), tf: 'D', basePeriod: 'D',
  })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  return execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  }, limits, opts)
}
const stopsWith = (fn, limit) => {
  let err = null
  try { fn() } catch (e) { err = e }
  expect(err, `expected a ${limit} stop`).toBeInstanceOf(RuntimeLimitError)
  expect(err.limit).toBe(limit)
  return err
}

const ACC = '//@version=5\nindicator("t")\nvar float s = 0.0\ns := s + close\nplot(s)\n'
const rows = () => BARS.map((b) => ({ ...b }))

afterEach(() => setRuntimeRunner(null))

// ─── A. limits ──────────────────────────────────────────────────────────────

describe('A — every declared limit is counted, and stops by name', () => {
  it('⭐ the conformance rail limits.js promised: each LIMIT_NAMES entry has an accounting site', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const src = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'limits.js')
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    const counted = (name) => new RegExp(`(charge|peak)\\('${name}'`).test(src)
      || new RegExp(`RuntimeLimitError\\('${name}'`).test(src)
      || (name === 'PROGRAM_SIZE' && /DEFAULT_LIMITS\.PROGRAM_SIZE/.test(src))
    const uncounted = LIMIT_NAMES.filter((n) => !counted(n))
    expect(uncounted).toEqual([])
  })

  it('OBJECT_OPERATIONS: every drawing call is counted, and an over-budget run stops by name', () => {
    const src = 'label.new(bar_index, close, "x")\n'
    const ok = run(src)
    expect(ok.budget.counts.OBJECT_OPERATIONS).toBe(N)                          // one call a bar
    stopsWith(() => run(src, { limits: { OBJECT_OPERATIONS: N - 1 } }), 'OBJECT_OPERATIONS')
    expect(() => run(src, { limits: { OBJECT_OPERATIONS: N } })).not.toThrow()  // boundary: exactly at the ceiling
  })

  it('LIVE_OBJECTS: drawings live after the collector are counted; an over-budget run stops by name', () => {
    const src = 'label.new(bar_index, close, "x")\n'
    const ok = run(src)
    // Pine's default label capacity is 50; the batched collector lets 5 past it.
    expect(ok.budget.counts.LIVE_OBJECTS).toBeLessThanOrEqual(collectsAbove(POOL_LIMITS.label.fallback))
    expect(ok.budget.counts.LIVE_OBJECTS).toBeGreaterThanOrEqual(POOL_LIMITS.label.fallback)
    stopsWith(() => run(src, { limits: { LIVE_OBJECTS: 10 } }), 'LIVE_OBJECTS')
  })

  it('⛔ LIVE_OBJECTS never refuses what Pine allows: 500 lines + 500 labels + 500 boxes run under the default', () => {
    const fam = ['line', 'label', 'box']
    const structural = fam.reduce((s, f) => s + collectsAbove(POOL_LIMITS[f].ceiling), 0) + 40 + 500
    expect(DEFAULT_LIMITS.LIVE_OBJECTS).toBe(structural)
    const src = 'line.new(bar_index, close, bar_index + 1, close)\n'
      + 'label.new(bar_index, close, "x")\n'
      + 'box.new(bar_index, high, bar_index + 1, low)\n'
    const res = run(src, { decl: ', max_lines_count = 500, max_labels_count = 500, max_boxes_count = 500' })
    expect(res.budget.counts.LIVE_OBJECTS).toBeLessThanOrEqual(DEFAULT_LIMITS.LIVE_OBJECTS)
    expect(res.budget.counts.LIVE_OBJECTS).toBe(3 * N)                         // 300 bars: nothing collected yet
  })

  it('MEMORY: a run accounts its held state; a tiny ceiling stops by name, the default does not', () => {
    const ok = run(ACC.split('\n').slice(2).join('\n'), { objects: false })
    expect(ok.budget.counts.MEMORY).toBeGreaterThanOrEqual(8 * N)               // at least its one output column
    expect(ok.budget.counts.MEMORY).toBeLessThan(DEFAULT_LIMITS.MEMORY)
    stopsWith(() => run('plot(close)\n', { objects: false, limits: { MEMORY: 100 } }), 'MEMORY')
  })

  it('MEMORY grows with what the run holds: live drawings are charged', () => {
    const plain = run('plot(close)\n', { objects: false }).budget.counts.MEMORY
    const drawn = run('plot(close)\nlabel.new(bar_index, close, "x")\n').budget.counts.MEMORY
    expect(drawn).toBeGreaterThan(plain)
  })

  it('WALL_TIME: measured from the first bar on the injected clock; a slow run stops by name', () => {
    let t = 0
    const now = () => { t += 10; return t }
    const err = stopsWith(() => run('plot(close)\n', { objects: false, limits: { WALL_TIME: 50 }, opts: { now } }), 'WALL_TIME')
    expect(err.ceiling).toBe(50)
    let u = 0
    expect(() => run('plot(close)\n', { objects: false, limits: { WALL_TIME: 1e9 }, opts: { now: () => { u += 1; return u } } })).not.toThrow()
  })

  it('REQUEST_FANOUT: a nested request run past the depth ceiling stops by name', () => {
    stopsWith(() => run('plot(close)\n', { objects: false, limits: { REQUEST_FANOUT: 2 }, opts: { requestDepth: 3 } }), 'REQUEST_FANOUT')
    expect(() => run('plot(close)\n', { objects: false, limits: { REQUEST_FANOUT: 3 }, opts: { requestDepth: 3 } })).not.toThrow()
  })

  it('PROGRAM_SIZE: a source past the byte ceiling is never handed to the front end, at every door', () => {
    const huge = ACC + `// ${'x'.repeat(DEFAULT_LIMITS.PROGRAM_SIZE)}\n`
    let err = null
    try { computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source: huge, outputs: { v: 0 } } }, rows(), { tf: 'D' }) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(err.message).toMatch(/PROGRAM_SIZE/)
    expect(probeRuntimeProgram(huge)).toMatchObject({ ok: false, refusal: { guard: RUNTIME_LIMIT_GUARD } })
    expect(probeObjectRuntime(huge, [])).toMatchObject({ ok: false, refusal: { guard: RUNTIME_LIMIT_GUARD } })
    // the boundary, in UTF-8 bytes rather than characters
    expect(utf8Bytes('aé€😀')).toBe(1 + 2 + 3 + 4)
    expect(probeRuntimeProgram(ACC).ok).toBe(true)
  })

  it('⛔ an ordinary script is untouched by every new limit (defaults)', () => {
    expect(() => run(ACC.split('\n').slice(2).join('\n'), { objects: false })).not.toThrow()
    expect(() => run('if bar_index % 10 == 0\n    label.new(bar_index, close, "x")\n')).not.toThrow()
  })
})

// ─── B. opcodes ─────────────────────────────────────────────────────────────

describe('B — the opcode table encodes each number once', () => {
  it('⭐ no two opcodes share a number, and 90 names CARRIED2 (the opcode the VM executes as 90)', () => {
    const nums = Object.values(OP)
    expect(new Set(nums).size).toBe(nums.length)
    expect(OP_NAME[90]).toBe('CARRIED2')
    expect(OP.CARRIED2).toBe(90)
  })
  it('the reserved object opcodes are not executable', () => {
    for (const k of ['OBJ_CREATE', 'OBJ_UPDATE', 'OBJ_DELETE']) expect(IMPLEMENTED.has(OP[k])).toBe(false)
  })
})

// ─── C. memo ────────────────────────────────────────────────────────────────

describe('C — an edited script never reuses the previous columns', () => {
  const def = (source, version) => ({ id: 'rt-memo', version, compute: { kind: 'runtime', fn: 'runtime:rt-memo', source, outputs: { v: 0 } } })

  it('⭐ same id, same bars array, edited source → the edited columns, not the cached ones', () => {
    const r = rows()
    const a = runtimeColumnsFor(def(ACC, 1), r, null, { tf: 'D' })
    const edited = def(ACC.replace('s := s + close', 's := s + 2 * close'), 1)
    const b = runtimeColumnsFor(edited, r, null, { tf: 'D' })
    expect(b.v).toEqual(computeRuntimeColumns(edited, r, { tf: 'D' }).v)
    expect(b.v[N - 1]).not.toBe(a.v[N - 1])
  })
  it('the same document object over the same bars is still served from the memo', () => {
    const r = rows()
    const d = def(ACC, 1)
    expect(runtimeColumnsFor(d, r, null, { tf: 'D' })).toBe(runtimeColumnsFor(d, r, null, { tf: 'D' }))
  })
  it('a version change, an output-map change and a symbol change each recompute', () => {
    const r = rows()
    const first = runtimeColumnsFor(def(ACC, 1), r, null, { tf: 'D' })
    expect(runtimeColumnsFor(def(ACC, 2), r, null, { tf: 'D' })).not.toBe(first)
    const remapped = { ...def(ACC, 1), compute: { ...def(ACC, 1).compute, outputs: { w: 0 } } }
    expect(Object.keys(runtimeColumnsFor(remapped, r, null, { tf: 'D' }))).toEqual(['w'])
    const same = def(ACC, 1)
    const onAapl = runtimeColumnsFor(same, r, null, { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } })
    expect(runtimeColumnsFor(same, r, null, { tf: 'D', symbol: { ticker: 'NVDA', exchange: 'NASDAQ' } })).not.toBe(onAapl)
    expect(runtimeColumnsFor(same, r, null, { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } })).toBe(onAapl)
    expect(first.v.length).toBe(N)
  })
})

// ─── D. version integrity ───────────────────────────────────────────────────

describe('D — a document runs only on the engine it was minted for', () => {
  const stamp = runtimeVersionStamp(probeRuntimeProgram(ACC).outputs)
  const doc = (meta) => ({ id: 'v', compute: { kind: 'runtime', fn: 'runtime:v', source: ACC, outputs: { v: 0 } }, meta })
  const refusalOf = (d) => { try { computeRuntimeColumns(d, rows(), { tf: 'D' }); return null } catch (e) { return e } }

  it('the stamp names the language, both versions and each output', () => {
    expect(stamp).toEqual({
      runtimeLanguage: RUNTIME_FRONTEND_LANGUAGE, runtimeFrontend: RUNTIME_FRONTEND_VERSION,
      runtimeIr: RUNTIME_IR_VERSION, runtimeOutputSignature: runtimeOutputSignature(probeRuntimeProgram(ACC).outputs),
    })
    expect(stamp.runtimeOutputSignature[0]).toMatch(/^plot/)
  })
  it('⭐ a stamped document runs; a document minted before the stamp (no meta) runs exactly as before', () => {
    expect(refusalOf(doc(stamp))).toBeNull()
    expect(refusalOf(doc(undefined))).toBeNull()
    expect(computeRuntimeColumns(doc(stamp), rows(), { tf: 'D' })).toEqual(computeRuntimeColumns(doc(undefined), rows(), { tf: 'D' }))
  })
  it('a newer front end / IR, or another language, is refused by name', () => {
    expect(refusalOf(doc({ ...stamp, runtimeIr: RUNTIME_IR_VERSION + 1 }))).toMatchObject({ guard: RUNTIME_VERSION_GUARD })
    expect(refusalOf(doc({ ...stamp, runtimeFrontend: RUNTIME_FRONTEND_VERSION + 1 }))).toMatchObject({ guard: RUNTIME_VERSION_GUARD })
    expect(refusalOf(doc({ ...stamp, runtimeLanguage: 'thinkscript' }))).toMatchObject({ guard: RUNTIME_VERSION_GUARD })
  })
  it('⛔ an output index that now names a different output is refused, never drawn under the wrong name', () => {
    const drifted = { ...stamp, runtimeOutputSignature: ['fill:somewhere-else'] }
    const err = refusalOf(doc(drifted))
    expect(err).toMatchObject({ guard: RUNTIME_VERSION_GUARD })
    expect(err.message).toMatch(/plot `v`/)
  })
})

// ─── E. determinism ─────────────────────────────────────────────────────────

describe('E — historical determinism', () => {
  it('⭐ identical bars (two separate arrays) → identical columns and identical drawings', () => {
    const d = { id: 'det', compute: { kind: 'runtime', fn: 'runtime:det', source: ACC, outputs: { v: 0 } } }
    expect(computeRuntimeColumns(d, rows(), { tf: 'D' })).toEqual(computeRuntimeColumns(d, rows(), { tf: 'D' }))
    const draw = 'if bar_index % 10 == 0\n    label.new(bar_index, close, str.tostring(bar_index))\n'
    const a = run(draw).objects.finish()
    const b = run(draw).objects.finish()
    expect(a.live).toEqual(b.live)
  })
  it('a corrected historical bar (a new bars array) recomputes from bar 0', () => {
    const d = { id: 'corr', compute: { kind: 'runtime', fn: 'runtime:corr', source: ACC, outputs: { v: 0 } } }
    const before = runtimeColumnsFor(d, rows(), null, { tf: 'D' })
    const fixed = rows()
    fixed[10] = { ...fixed[10], c: fixed[10].c + 5 }
    const after = runtimeColumnsFor(d, fixed, null, { tf: 'D' })
    expect(after.v[9]).toBe(before.v[9])                                        // before the correction: unchanged
    expect(after.v[N - 1]).toBeCloseTo(before.v[N - 1] + 5, 9)                  // carried state absorbs it
  })
})
