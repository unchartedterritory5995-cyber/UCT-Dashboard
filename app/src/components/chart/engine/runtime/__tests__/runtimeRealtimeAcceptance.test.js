// app/src/components/chart/engine/runtime/__tests__/runtimeRealtimeAcceptance.test.js
//
// ⭐⭐ UIE PHASE B (2026-10-11) — WHAT THE RUNTIME DOES WHEN A BAR MOVES, AS IT IS TODAY.
//
// The runtime reruns from bar 0 on every new bars array (no incremental step, no
// intrabar rollback — documented, not claimed otherwise). These pin the consequences a
// chart relies on: a tick on the forming bar changes only that bar; a bar closing appends
// without rewriting history; the forming flag reaches `barstate.isconfirmed`; and a caller
// that cannot say whether the newest bar is forming gets a NAMED refusal, never a guess.
import { describe, it, expect } from 'vitest'
import { computeRuntimeColumns } from '../runtimeColumns.js'

const N = 120
const mk = (n = N) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 5) + i * 0.1
  return { t: 1700000000 + i * 86400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const def = (body) => ({ id: 'rt', compute: { kind: 'runtime', fn: 'runtime:rt', outputs: { v: 0 },
  source: `//@version=6\nindicator("t")\n${body}` } })
const SUM = def('var float s = 0.0\ns := s + close\nplot(s)\n')
const EMA = def('var float x = 0.0\nx := x + close\nplot(ta.ema(x, 5))\n')

describe('⭐ a tick, a close, and the forming flag', () => {
  it('a tick on the forming bar changes that bar only — every closed bar is byte-identical', () => {
    for (const d of [SUM, EMA]) {
      const before = computeRuntimeColumns(d, mk(), { tf: 'D', newestBarIsForming: true }).v
      const ticked = mk()
      ticked[N - 1] = { ...ticked[N - 1], c: ticked[N - 1].c + 3 }
      const after = computeRuntimeColumns(d, ticked, { tf: 'D', newestBarIsForming: true }).v
      expect(after.slice(0, N - 1)).toEqual(before.slice(0, N - 1))
      expect(after[N - 1]).not.toBe(before[N - 1])
    }
  })

  it('a bar closing and a new one opening appends — the history already drawn is unchanged', () => {
    const before = computeRuntimeColumns(SUM, mk(N), { tf: 'D', newestBarIsForming: false }).v
    const after = computeRuntimeColumns(SUM, mk(N + 1), { tf: 'D', newestBarIsForming: true }).v
    expect(after.length).toBe(N + 1)
    expect(after.slice(0, N)).toEqual(before)
  })

  it('the forming flag reaches barstate.isconfirmed: only a bar KNOWN to be closed is confirmed', () => {
    const conf = def('plot(barstate.isconfirmed ? 1 : 0)\n')
    const forming = computeRuntimeColumns(conf, mk(), { tf: 'D', newestBarIsForming: true }).v
    const closed = computeRuntimeColumns(conf, mk(), { tf: 'D', newestBarIsForming: false }).v
    expect(forming[N - 1]).toBe(0)
    expect(closed[N - 1]).toBe(1)
    expect(forming.slice(0, N - 1).every((x) => x === 1)).toBe(true)
  })

  it('⛔ a caller that cannot say whether the newest bar is forming gets a named refusal, never a guess', () => {
    const conf = def('plot(barstate.isconfirmed ? 1 : 0)\n')
    let err = null
    try { computeRuntimeColumns(conf, mk(), { tf: 'D', newestBarIsForming: null }) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:realtime-untold')
  })

  it('repeated runs over identical bars are identical (no hidden state between runs)', () => {
    const a = computeRuntimeColumns(EMA, mk(), { tf: 'D', newestBarIsForming: false })
    const b = computeRuntimeColumns(EMA, mk(), { tf: 'D', newestBarIsForming: false })
    const c = computeRuntimeColumns(EMA, mk(), { tf: 'D', newestBarIsForming: false })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })
})
