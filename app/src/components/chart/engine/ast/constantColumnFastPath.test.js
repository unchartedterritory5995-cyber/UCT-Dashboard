// ─── ⭐ PERF (Fred RS filled chart, C1) — A BARE CONSTANT IS ITS COLUMN ─────────────────────────────────────────────
//
// `interpret.js::interpret` answers a tree that is one finite `num` with `toColumn` of the number at once, instead of
// the whole pipeline. These rails hold:
//   * the answer is the pipeline's, bit for bit, for every constant shape (positive, negative, -0, fractions, large),
//     over 0, 1 and many bars, with every option a door hands it, and nothing is written to its clock sink;
//   * a `num` that is not finite still takes the full path and is refused there by name;
//   * every runtime-lane document a member is served (corpus/committed, the RS script, every vendor capture) draws the
//     same columns, drawings and refusals, bit for bit, fast path on and off, and the corpus runs through it hundreds
//     of times (so the comparison is not vacuous).
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as INTERP from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'
import { RUNTIME_OBJECTS_KEY } from '../runtime/runtimeObjects.js'

const { interpret, __constantColumnFastPathOffForTests } = INTERP
afterEach(() => { __constantColumnFastPathOffForTests(false) })

const REPO = path.resolve(process.cwd(), '..')
const bothWays = (fn) => {
  __constantColumnFastPathOffForTests(true)
  let off
  try { off = { v: fn() } } catch (e) { off = { e: `${e && e.guard}: ${e && e.message}` } }
  __constantColumnFastPathOffForTests(false)
  let on
  try { on = { v: fn() } } catch (e) { on = { e: `${e && e.guard}: ${e && e.message}` } }
  return { off, on }
}
const sameColumn = (a, b) => a instanceof Float64Array && b instanceof Float64Array && a.length === b.length
  && a.every((x, i) => Object.is(x, b[i]))

describe('a bare constant is its column', () => {
  const bars = (n) => Array.from({ length: n }, (_, i) => ({ t: 1.7e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + (i % 5), v: 10 }))
  it('the pipeline\'s answer, bit for bit, for every constant shape, bar count and door option; nothing in the sink', () => {
    const optsList = [undefined, {}, { historyFromListing: true }, { historyFromListing: false, newestBarIsForming: true },
      { prefixProbe: 3 }, { tf: '5' }, { tf: 'D', listingKeys: true }]
    for (const value of [0, -0, 1, -1, 0.5, -2.25, 1e300, -1e-300, 250, 4200]) {
      for (const n of [0, 1, 7, 600]) {
        for (const o of optsList) {
          const call = (fastOff) => {
            __constantColumnFastPathOffForTests(fastOff)
            const sink = new Map()
            try {
              const v = interpret({ type: 'num', value }, bars(n), {}, undefined, undefined, o ? { ...o, chartClockSink: sink } : undefined)
              return { v, sink }
            } catch (e) { return { e: `${e && e.guard}: ${e && e.message}`, sink } } finally { __constantColumnFastPathOffForTests(false) }
          }
          const off = call(true)
          const on = call(false)
          expect(on.e, `${value}/${n}`).toBe(off.e)
          expect(sameColumn(on.v, off.v), `${value} over ${n} bars, opts ${JSON.stringify(o)}`).toBe(true)
          expect([on.sink.size, off.sink.size]).toEqual([0, 0])
        }
      }
    }
  })
  it('⛔ an input that shadows a table name is still refused by name, with a constant tree (the pipeline checks inputs first)', () => {
    for (const name of ['close', 'self', 'sma']) {
      const { off, on } = bothWays(() => interpret({ type: 'num', value: 1 }, bars(5), { [name]: 3 }))
      expect(off.e, name).toMatch(/shadows a table name/)
      expect(on.e, name).toBe(off.e)
    }
    // and an input that shadows nothing: the same column both ways
    const { off, on } = bothWays(() => interpret({ type: 'num', value: 4 }, bars(5), { myLen: 3 }))
    expect(sameColumn(on.v, off.v)).toBe(true)
  })
  it('⛔ a num that is not finite still takes the full path and is refused there, by name', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const { off, on } = bothWays(() => interpret({ type: 'num', value }, bars(5), {}))
      expect(off.e).toMatch(/interpret:node/)
      expect(on.e).toBe(off.e)
    }
  })
})

/** Every runtime-lane document a member is served: the runtime pane's own, or a host document's run half. */
function servedDocs() {
  const out = []
  const seenSrc = new Set()
  const add = (key, src) => { if (!seenSrc.has(src)) { seenSrc.add(src); out.push({ key, src }) } }
  for (const dir of ['corpus/committed', 'docs/pine/rs-rating']) {
    for (const f of fs.readdirSync(path.join(REPO, dir)).filter((x) => x.endsWith('.pine')).sort()) add(`${dir}/${f}`, fs.readFileSync(path.join(REPO, dir, f), 'utf8'))
  }
  const caps = path.join(REPO, 'tests/fixtures/vendor/harness')
  for (const f of fs.readdirSync(caps).filter((x) => x.endsWith('.json')).sort()) {
    let j = null
    try { j = JSON.parse(fs.readFileSync(path.join(caps, f), 'utf8')) } catch { continue }
    if (j && j.source && typeof j.source.text === 'string') add(`capture/${f}`, j.source.text)
  }
  const docs = []
  for (const { key, src } of out) {
    let d
    try { d = memberPaneDefinition({ source: src, id: 'u_ccf', name: 'x' }) } catch { continue }
    if (!d || !d.ok) continue
    const def = d.definition
    if (def.compute && def.compute.kind === 'runtime') docs.push({ key, doc: def })
    else if (def.compute && def.compute.runtimeObjects) {
      const ro = def.compute.runtimeObjects
      docs.push({ key, doc: { id: 'u_ccf_half', compute: { kind: 'runtime', fn: 'runtime:u_ccf_half', source: ro.source, objects: true, outputs: ro.outputs }, meta: { runtimeHistory: 'listing' } } })
    }
  }
  return docs
}

describe('every runtime-lane document a member is served draws the same, fast path on and off', () => {
  it('columns, drawings and refusals, bit for bit, over a daily chart (and the corpus exercises the fast path)', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const days = []
    for (let t = Date.UTC(2020, 0, 6) / 1000; days.length < 1500; t += 86400) {
      const d = new Date(t * 1000)
      if (![0, 6].includes(d.getUTCDay())) days.push(d.toISOString().slice(0, 10))
    }
    const rows = days.map((t, i) => {
      const c = 100 + Math.sin(i / 9) * 5 + Math.cos(i / 31) * 2 + i * 0.02
      return { t, o: c - 0.3, h: c + 1.2, l: c - 1.1, c, v: 2e5 + (i % 11) * 1000 }
    })
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true,
      symbol: { ticker: 'SPY', exchange: 'AMEX', securityType: 'fund', industry: 'Investment Trusts/Mutual Funds', sector: 'Miscellaneous' } }
    const docs = servedDocs()
    expect(docs.length).toBeGreaterThan(80)
    let served = 0
    let constants = 0
    for (const { key, doc } of docs) {
      const run = () => {
        resetRuntimeSessions(); resetRuntimeLedgers()
        const cols = computeRuntimeColumns(doc, rows, ctx, { now: () => 0 })
        return JSON.stringify(Object.keys(cols).map((k) => [k, Array.from(cols[k], (x) => (Object.is(x, -0) ? '-0' : Number.isNaN(x) ? 'n' : x))]))
          + JSON.stringify(cols[RUNTIME_OBJECTS_KEY] || null)
      }
      const { off, on } = bothWays(run)
      // how many of this document's columns are bare constants (its own build, the trees counted as they are asked)
      try {
        buildRuntimeIr(String(doc.compute.source), { bars: rows, inputs: {}, objectsInRun: doc.compute.objects === true, tf: 'D', basePeriod: 'D',
          columnInterpret: (tree, b, inputs, o) => { if (tree && tree.type === 'num') constants += 1; return interpret(tree, b, inputs, undefined, undefined, o) } })
      } catch { /* a build that refuses counts nothing */ }
      expect(on.e, key).toBe(off.e)
      expect(on.v === off.v, key).toBe(true)
      if (on.v !== undefined) served += 1
    }
    expect(served).toBeGreaterThan(60)
    expect(constants, 'bare constants the corpus hands the evaluator (380 on 2026-11-19)').toBeGreaterThan(300)
  }, 600000)
})
