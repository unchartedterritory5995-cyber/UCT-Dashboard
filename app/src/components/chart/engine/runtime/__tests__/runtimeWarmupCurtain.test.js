// app/src/components/chart/engine/runtime/__tests__/runtimeWarmupCurtain.test.js
//
// ⭐⭐ UIE PHASE 2 — R-W's WARM-UP CURTAIN FOR A RUN (`runtimeColumns.js::computeOffListing`).
//
// A listing document (`meta.runtimeHistory === 'listing'`) on a chart whose history does
// not reach the listing used to be refused outright. It now draws the bars whose values
// do not depend on where the chart starts, withholds the ones before them, and refuses
// by name a script whose state never forgets its start. The proof that matters: the
// drawn values EQUAL the values of a run over the full history from the listing.
import { describe, it, expect } from 'vitest'
import {
  computeRuntimeColumns, convergedFrom, runtimeWarmupOf, RUNTIME_WARMUP_GUARD, RUNTIME_HISTORY_GUARD,
  RUNTIME_TIME_BUDGET_GUARD,
} from '../runtimeColumns.js'
import { runtimeObjectsWithheldOf } from '../runtimeObjects.js'

const FULL = 6000
const bars = Array.from({ length: FULL }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 17) + 4 * Math.sin(i / 5.3) + i * 0.01
  return { t: 1500000000 + i * 86400, o: c - 0.3, h: c + 1.1, l: c - 0.9, c, v: 1000 + (i % 29) * 7 }
})
const doc = (body, extra = {}) => ({
  id: 'w', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:w', outputs: { v: 0 }, source: `//@version=6\nindicator("w")\n${body}`, ...extra },
})
const EMA_STATE = doc('var float x = na\nx := na(x) ? close : 0.9 * x + 0.1 * close\nplot(x)\n')
const RSI = doc('plot(ta.rsi(close, 14))\n')
const close = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))
const D = { tf: 'D', newestBarIsForming: false }

describe('⭐ a listing document off the listing: the warm-up is withheld, the rest is drawn', () => {
  for (const [name, d] of [['a var recurrence', EMA_STATE], ['ta.rsi', RSI]]) {
    it(`${name}: every drawn bar EQUALS the run from the listing; the warm-up is NaN`, () => {
      const truth = computeRuntimeColumns(d, bars, { ...D, historyFromListing: true }).v
      const N = 3000
      const window = bars.slice(FULL - N)
      const got = computeRuntimeColumns(d, window, D)
      const w = runtimeWarmupOf(got)
      expect(w && w.withheldBars).toBeGreaterThan(0)
      expect(w.withheldBars).toBeLessThan(N / 2)
      for (let i = 0; i < w.withheldBars; i += 1) expect(Number.isNaN(got.v[i])).toBe(true)
      for (let i = w.withheldBars; i < N; i += 1) {
        expect(close(got.v[i], truth[FULL - N + i]), `bar ${i}`).toBe(true)
      }
    })
  }

  it('on the listing nothing changes: no curtain, every bar drawn', () => {
    const got = computeRuntimeColumns(EMA_STATE, bars, { ...D, historyFromListing: true })
    expect(runtimeWarmupOf(got)).toBeNull()
    expect(Number.isNaN(got.v[1])).toBe(false)
  })

  it('deterministic across reloads: two windows that start on different bars draw the same values where both draw', () => {
    const a = computeRuntimeColumns(RSI, bars.slice(FULL - 3000), D)
    const b = computeRuntimeColumns(RSI, bars.slice(FULL - 4500), D)
    const wa = runtimeWarmupOf(a).withheldBars
    for (let i = wa; i < 3000; i += 1) expect(close(a.v[i], b.v[i + 1500])).toBe(true)
  })

  for (const [name, body] of [
    ['bar_index in a plot', 'plot(bar_index)\n'],
    ['a running count', 'var int k = 0\nk += 1\nplot(k)\n'],
    ['a cumulative sum', 'plot(ta.cum(close))\n'],
  ]) {
    it(`⛔ ${name} never forgets its first bar: refused by name, nothing drawn`, () => {
      let err = null
      try { computeRuntimeColumns(doc(body), bars.slice(FULL - 3000), D) } catch (e) { err = e }
      expect(err && err.guard).toBe(RUNTIME_WARMUP_GUARD)
    })
  }

  it('⛔ a document that draws its own objects: plots drawn, drawings withheld by name', () => {
    const d = doc('var float x = na\nx := na(x) ? close : 0.9 * x + 0.1 * close\nplot(x)\n'
      + 'if bar_index % 50 == 0\n    label.new(bar_index, high, "x")\n', { objects: true })
    const got = computeRuntimeColumns(d, bars.slice(FULL - 3000), D)
    expect(runtimeWarmupOf(got).withheldBars).toBeGreaterThan(0)
    expect(runtimeObjectsWithheldOf(got).guard).toBe(RUNTIME_HISTORY_GUARD)
  })

  it('⛔ the second run counts against the same pane budget, and a stop is named', () => {
    let t = 0
    const now = () => { t += 0.05; return t }
    let err = null
    try { computeRuntimeColumns(RSI, bars.slice(FULL - 3000), D, { budgetMs: 200, now }) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
  })

  it('the old answer is still reachable (`warmupCurtain: false`) — the refusal it replaced', () => {
    let err = null
    try { computeRuntimeColumns(RSI, bars.slice(FULL - 3000), D, { warmupCurtain: false }) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_HISTORY_GUARD)
  })

  it('convergedFrom: the first bar of the agreeing tail, or null', () => {
    expect(convergedFrom({ v: [1, 2, 3, 4] }, { v: [9, 3, 4] }, 1)).toBe(2)
    expect(convergedFrom({ v: [1, 2, 3, 4] }, { v: [2, 3, 5] }, 1)).toBeNull()
    expect(convergedFrom({ v: [NaN, 2] }, { v: [NaN, 2] }, 0)).toBe(0)
  })
})
