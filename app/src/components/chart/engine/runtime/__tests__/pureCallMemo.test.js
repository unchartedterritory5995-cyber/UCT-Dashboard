// ─── ⭐⭐ e99 b2 — A PURE LEAF CALL ANSWERED FROM A MEMO, ITS ACCOUNT REPLAYED (`pureCalls.js`) ─────────────────
// These rails hold:
//   1. the classifier is conservative: only a leaf whose body reads nothing but its arguments qualifies
//      (a constant-reading leaf yes; a history read, a `var`, a window builtin, a caller of another function, no;
//      on kernel-channel exactly one function, `kernelWeight`, is memoised);
//   2. EXACT: kernel-channel over SPY 1D, memo on and off, gives byte-identical columns AND identical budget counts,
//      and stops on the same bar with the same numbers under the shipped limits;
//   3. an impure function is never answered from a memo (its values stay right);
//   4. `-0` and `0` are different arguments.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { RuntimeLimitError } from '../limits.js'
import { pureLeafFunctionsOf } from '../pureCalls.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from '../../__tests__/vendorHarness/ourSide'

const REPO = path.resolve(process.cwd(), '..')
const KC = path.join(REPO, 'corpus/committed/kernel-channel-backquant__d8c4b7f75c.pine')
const SPY = path.join(REPO, 'tests/fixtures/vendor/harness/machine-learning-moving-average-backquant-spy-1d-2026-11-17.json')
beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })
afterEach(() => vi.unstubAllEnvs())

const daily = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 7) + i * 0.05
  return { t: 1500000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) * 10 }
})
const head = '//@version=6\nindicator("pcm", overlay = false)\n'
function compile(src, n) {
  const bars = daily(n)
  const built = buildRuntimeIr(head + src, { bars, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  return { p: lowerIrProgram(built.ir), bars }
}
function vmRun(src, n, opts = {}) {
  const { p, bars } = compile(src, n)
  const ctx = { bars: n, series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k]))),
    columns: p.columns, confirmed: true, barTimes: bars.map((b) => b.t), requestBars: {} }
  try {
    const res = execute(p, ctx, undefined, opts)
    return { p, bars, outputs: res.outputs, counts: { ...res.budget.counts } }
  } catch (err) {
    if (!(err instanceof RuntimeLimitError)) throw err
    return { p, err }
  }
}
const pureByName = (p) => {
  const flags = pureLeafFunctionsOf(p)
  return Object.fromEntries(p.functions.map((f, i) => [f.name, flags[i]]))
}
const sameColumn = (a, b) => a.length === b.length && Array.prototype.every.call(a, (v, i) => Object.is(v, b[i]))
const L = (...lines) => `${lines.join('\n')}\n`

describe('e99 b2 — pure leaf calls from a memo', () => {
  it('the classifier is conservative', () => {
    const src = L(
      'w(int i, float bw) =>', '    float u = i / bw', '    u > 1.0 ? 0.0 : 1.0 - math.pow(u, 2.0)',
      'c(int i) =>', '    close[i]',
      'v() =>', '    var int n = 0', '    n += 1', '    n',
      'outer(int i) =>', '    w(i, 2.0) + 1.0',
      'm(float x) =>', '    ta.sma(x, 3)',
      'plot(w(1, 2.0) + c(0) + v() + outer(1) + m(close))')
    const { p } = compile(src, 20)
    expect(pureByName(p)).toEqual({ w: 1, c: 0, v: 0, outer: 0, m: 0 })
  })

  it('⛔ EXACT: kernel-channel over SPY 1D, memo on and off, identical columns, counts and stop', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const door = enterMemberDoor(fs.readFileSync(KC, 'utf8'))
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    const rows = JSON.parse(fs.readFileSync(SPY, 'utf8')).bars.rows
    const run = (pureMemo, limits) => {
      let counts = null
      let out = null
      let err = null
      let memo = null
      const t0 = performance.now()
      try {
        out = computeRuntimeColumns(door.def, rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })),
          { tf: 'D', newestBarIsForming: false, historyFromListing: true },
          { budgetMs: 600000, ...(limits ? { limits } : {}), ...(pureMemo ? {} : { pureMemo: false }),
            onBudget: (b) => { counts = { ...b.counts }; memo = b.pureMemo || null } })
      } catch (e) { err = e }
      return { out, counts, err, memo, ms: performance.now() - t0 }
    }
    const lifted = { TOTAL_INSTRUCTIONS: 1e15 }
    const on = run(true, lifted)
    const off = run(false, lifted)
    expect(on.err).toBe(null)
    expect(Object.keys(on.out).sort()).toEqual(Object.keys(off.out).sort())
    for (const k of Object.keys(off.out)) {
      if (ArrayBuffer.isView(off.out[k]) || Array.isArray(off.out[k])) expect(sameColumn(on.out[k], off.out[k]), k).toBe(true)
      else expect(on.out[k], k).toEqual(off.out[k])
    }
    expect(on.counts).toEqual(off.counts)
    // the memo engaged (kernelWeight, the one pure leaf: 300 calls a bar, ~100 distinct argument sets) and only when on
    expect(on.memo).toMatchObject({ functions: 1 })
    expect(on.memo.hits).toBeGreaterThan(2500000)
    expect(on.memo.entries).toBeLessThan(1000)
    expect(off.memo).toBe(null)
    // eslint-disable-next-line no-console
    console.log(`kernel-channel SPY 8,509: memo ${Math.round(on.ms)} ms, no memo ${Math.round(off.ms)} ms`)
    const sOn = run(true)
    const sOff = run(false)
    expect(sOn.err && sOn.err.message).toBe(sOff.err && sOff.err.message)
    expect(sOn.err.guard).toBe('runtime:limit')
  }, 180000)

  it('⛔ an impure function is never answered from a memo', () => {
    const r = vmRun(L('c(int i) =>', '    close[i]', 'v() =>', '    var int n = 0', '    n += 1', '    n',
      'plot(c(0))', 'plot(v())'), 60)
    const closes = r.bars.map((b) => b.c)
    const [a, b] = Object.values(r.outputs)
    expect(Array.from(a)).toEqual(closes)
    expect(Array.from(b)).toEqual(closes.map((_, i) => i + 1))
  })

  it('⛔ a leaf reading a column that VARIES over the run is not memoised (its values stay right)', () => {
    const src = L('g(int i) =>', '    i + close * 2.0', 'plot(g(1))')
    const on = vmRun(src, 40)
    const off = vmRun(src, 40, { pureMemo: false })
    const col = Object.values(on.outputs)[0]
    expect(Array.from(col)).toEqual(on.bars.map((b) => 1 + b.c * 2))
    expect(sameColumn(col, Object.values(off.outputs)[0])).toBe(true)
  })

  it('-0 and 0 are different arguments', () => {
    const src = L('f(float x) =>', '    x * 2.0', 'plot(f(bar_index % 2 == 0 ? 0.0 : -0.0))')
    const on = vmRun(src, 10)
    const off = vmRun(src, 10, { pureMemo: false })
    expect(pureByName(on.p).f).toBe(1)
    const col = Object.values(on.outputs)[0]
    expect(sameColumn(col, Object.values(off.outputs)[0])).toBe(true)
    expect(Object.is(col[1], -0)).toBe(true)
    expect(on.counts).toEqual(off.counts)
  })
})
