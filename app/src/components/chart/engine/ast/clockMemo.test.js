// ─── ⭐ PERF (Fred RS filled chart, C4) — THE CLOCK, ONCE PER BARS ──────────────────────────────────────────────────
//
// `interpret.js::clockColumnsOf` keeps `computeClock`'s thirteen columns per bars ARRAY, per timeframe and forming
// tri-state, with the bar times they came from, and hands every caller its own copy. These rails hold:
//   * a second ask of the same bars, timeframe and tri-state computes nothing and answers the same columns, bit for bit;
//   * another timeframe, another tri-state, or the same array with a time changed in place computes again, and answers
//     what a fresh computation answers;
//   * what a caller does to its copy reaches no later caller;
//   * every runtime-lane document a member is served draws the same columns, drawings and refusals, bit for bit, memo
//     on and off, on a daily chart and on a 5m chart, and the corpus computes the clock fewer times with it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as IND from '../../indicators.js'
import { clockColumnsOf, __clockMemoOffForTests } from './interpret.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'
import { RUNTIME_OBJECTS_KEY } from '../runtime/runtimeObjects.js'

// every clock the evaluator computes is counted (the computation itself, wrapped)
vi.mock('../../indicators.js', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, computeClock: vi.fn(m.computeClock) }
})
afterEach(() => { __clockMemoOffForTests(false) })
const REPO = path.resolve(process.cwd(), '..')

const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const fiveMin = (days) => days.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = 100 + k + Math.sin(j / 9)
  return { t: ET(d, 9, 30) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 + j }
}))
const NOV = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11']
const sameCols = (a, b) => Object.keys(b).length === Object.keys(a).length
  && Object.keys(b).every((k) => a[k].length === b[k].length && a[k].every((x, i) => Object.is(x, b[k][i])))
const fresh = (b, tf, f) => {
  __clockMemoOffForTests(true)
  try { return clockColumnsOf(b, tf, f) } finally { __clockMemoOffForTests(false) }
}

describe('the clock, once per bars', () => {
  it('a second ask computes nothing and answers the same; another tf, tri-state or changed time computes again, exactly', () => {
    const bars = fiveMin(NOV)
    IND.computeClock.mockClear()
    const first = clockColumnsOf(bars, '5', false)
    const again = clockColumnsOf(bars, '5', false)
    expect(IND.computeClock).toHaveBeenCalledTimes(1)
    expect(sameCols(again, first)).toBe(true)
    expect(sameCols(again, fresh(bars, '5', false))).toBe(true)
    for (const [tf, f] of [['15', false], ['5', true], ['5', null], [undefined, false]]) {
      IND.computeClock.mockClear()
      const got = clockColumnsOf(bars, tf, f)
      expect(IND.computeClock, `${tf}/${f}`).toHaveBeenCalledTimes(1)
      expect(sameCols(got, fresh(bars, tf, f)), `${tf}/${f}`).toBe(true)
    }
    // the same array, its newest bar's time moved in place: computed again, and the new times' answer
    bars[bars.length - 1] = { ...bars[bars.length - 1], t: bars[bars.length - 1].t + 86400 }
    IND.computeClock.mockClear()
    const moved = clockColumnsOf(bars, '5', false)
    expect(IND.computeClock).toHaveBeenCalledTimes(1)
    expect(sameCols(moved, fresh(bars, '5', false))).toBe(true)
  })
  it('what a caller does to its copy reaches no later caller', () => {
    const bars = fiveMin(NOV)
    const first = clockColumnsOf(bars, '5', false)      // computed (and kept)
    const keep = Float64Array.from(first.hour)
    for (const k of Object.keys(first)) first[k].fill(-7)
    const hit = clockColumnsOf(bars, '5', false)        // from the kept columns
    expect(Array.from(hit.hour)).toEqual(Array.from(keep))
    for (const k of Object.keys(hit)) hit[k].fill(-9)
    const again = clockColumnsOf(bars, '5', false)      // from the kept columns again
    expect(Array.from(again.hour)).toEqual(Array.from(keep))
  })
})

function servedDocs() {
  const out = []
  const seen = new Set()
  const add = (src) => { if (!seen.has(src)) { seen.add(src); out.push(src) } }
  for (const dir of ['corpus/committed', 'docs/pine/rs-rating']) {
    for (const f of fs.readdirSync(path.join(REPO, dir)).filter((x) => x.endsWith('.pine')).sort()) add(fs.readFileSync(path.join(REPO, dir, f), 'utf8'))
  }
  const caps = path.join(REPO, 'tests/fixtures/vendor/harness')
  for (const f of fs.readdirSync(caps).filter((x) => x.endsWith('.json')).sort()) {
    let j = null
    try { j = JSON.parse(fs.readFileSync(path.join(caps, f), 'utf8')) } catch { continue }
    if (j && j.source && typeof j.source.text === 'string') add(j.source.text)
  }
  const docs = []
  for (const src of out) {
    let d
    try { d = memberPaneDefinition({ source: src, id: 'u_clk', name: 'x' }) } catch { continue }
    if (!d || !d.ok) continue
    const def = d.definition
    if (def.compute && def.compute.kind === 'runtime') docs.push(def)
    else if (def.compute && def.compute.runtimeObjects) {
      const ro = def.compute.runtimeObjects
      docs.push({ id: 'u_clk_half', compute: { kind: 'runtime', fn: 'runtime:u_clk_half', source: ro.source, objects: true, outputs: ro.outputs }, meta: { runtimeHistory: 'listing' } })
    }
  }
  return docs
}

describe('every runtime-lane document a member is served draws the same, memo on and off', () => {
  const days = []
  for (let t = Date.UTC(2020, 0, 6) / 1000; days.length < 1500; t += 86400) {
    const d = new Date(t * 1000)
    if (![0, 6].includes(d.getUTCDay())) days.push(d.toISOString().slice(0, 10))
  }
  const DAILY = days.map((t, i) => { const c = 100 + Math.sin(i / 9) * 5 + i * 0.02; return { t, o: c - 0.3, h: c + 1.2, l: c - 1.1, c, v: 2e5 + (i % 11) * 1000 } })
  const CHARTS = [
    ['daily', DAILY, { tf: 'D', newestBarIsForming: false, historyFromListing: true }],
    ['5m', fiveMin(NOV), { tf: '5', newestBarIsForming: true, historyFromListing: true }],
  ]
  for (const [name, rows, base] of CHARTS) {
    it(`${name}: columns, drawings and refusals, bit for bit (and the clock is computed fewer times)`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      const ctx = { ...base, symbol: { ticker: 'SPY', exchange: 'AMEX', securityType: 'fund', industry: 'Investment Trusts/Mutual Funds', sector: 'Miscellaneous' } }
      const docs = servedDocs()
      expect(docs.length).toBeGreaterThan(80)
      const computed = { on: 0, off: 0 }
      for (const doc of docs) {
        const run = (off) => {
          __clockMemoOffForTests(off)
          resetRuntimeSessions(); resetRuntimeLedgers()
          IND.computeClock.mockClear()
          try {
            const cols = computeRuntimeColumns(doc, rows.slice(), ctx, { now: () => 0 })
            return JSON.stringify(Object.keys(cols).map((k) => [k, Array.from(cols[k], (x) => (Object.is(x, -0) ? '-0' : Number.isNaN(x) ? 'n' : x))]))
              + JSON.stringify(cols[RUNTIME_OBJECTS_KEY] || null)
          } catch (e) { return `refused ${e.guard}: ${e.message}` } finally {
            computed[off ? 'off' : 'on'] += IND.computeClock.mock.calls.length
            __clockMemoOffForTests(false)
          }
        }
        const off = run(true)
        const on = run(false)
        expect(on).toBe(off)
      }
      expect(computed.on, `computed ${computed.on} with the memo, ${computed.off} without`).toBeLessThan(computed.off)
    }, 600000)
  }
})
