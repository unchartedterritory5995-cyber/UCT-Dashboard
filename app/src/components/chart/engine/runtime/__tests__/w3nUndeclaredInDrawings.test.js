// app/src/components/chart/engine/runtime/__tests__/w3nUndeclaredInDrawings.test.js
//
// ─── W3W4-D3 — NAMES THE RUNTIME LANE REFUSED AS "UNDECLARED BUILTIN" ───────────
//
// Spike (the three sole-blocked drawing scripts, read from corpus/committed):
//   correlation-matrix                         `correlation(a, b, n)` (v1 spelling)  -> SERVED here
//   previous-day-high-and-low-separators-...   `ta.pivot_point_levels(...)`          -> real missing builtin
//   volume-profile-auto-line-v2                `time(timeframe)` (function form)     -> real missing builtin
// and `ta.correlation` (heat-map-seasons, v5) is the same name in its v5 spelling.
//
// OUTCOME (D3 fix r1): NOTHING is served by the runtime lane. The first build re-spelled
// `correlation` over runtime state through the host lane's builder, but the committed capture
// (r11-corr-pct-spy-2026-09-11.json) pins only na-free self-correlation, and over a source that
// can carry `na` (a slot, a request.security result, a gap) the builder's sma/stdev drop na per
// window and the result leaves [-1, 1] (-47.64 measured). A source that is na-free by
// construction is already served by the columnar lane before the runtime lane sees it (probed:
// zero hits), so the respelling would have served nothing the capture pins. It was removed, and
// `correlation` over runtime state stays refused BY NAME until the capture in
// docs/pine/capture-queue-2026-11-05-w34-d3.md lands. The other two names need kernels (a pivot
// table; a timeframe calendar) and stay refused BY NAME too.
//
// Numbers are graded against Pearson's definition written out in plain JS, never
// against the expansion.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i * 0.7) * 3,
  h: 106 + i * 0.3,
  l: 94 - i * 0.1,
  c: 100 + i * 0.4 + Math.cos(i * 1.3) * 4,
  v: 1000 + ((i * 7919) % 613),
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const X = BARS.map((b) => b.c * 2 - b.o)
const Y = BARS.map((b) => b.v)
const STATE = 'var float x = 0.0\nx := close * 2 - open\nvar float y = 0.0\ny := volume\n'
const head = (v) => `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("t")\n`

const build = (version, body, opts = {}) => buildRuntimeIr(`${head(version)}${STATE}${body}`, { bars: BARS, inputs: {}, ...opts })
function run(version, body) {
  const built = build(version, body)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}
const refusalOf = (version, body, opts) => {
  const b = build(version, body, opts)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

// Pearson's r over the last n bars, from the definition (not from sma/stdev).
const pearson = (xs, ys, n) => xs.map((_, i) => {
  if (i - n + 1 < 0) return NaN
  const a = xs.slice(i - n + 1, i + 1)
  const b = ys.slice(i - n + 1, i + 1)
  const ma = a.reduce((p, q) => p + q, 0) / n
  const mb = b.reduce((p, q) => p + q, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  a.forEach((v, k) => { sab += (v - ma) * (b[k] - mb); saa += (v - ma) ** 2; sbb += (b[k] - mb) ** 2 })
  return sab / Math.sqrt(saa * sbb)
})
const near = (ours, ref) => {
  expect(ours.length).toBe(ref.length)
  let compared = 0
  ref.forEach((r, i) => {
    if (Number.isNaN(r)) { expect(Number.isNaN(ours[i]), `bar ${i}`).toBe(true); return }
    expect(Math.abs(ours[i] - r), `bar ${i}: ours ${ours[i]}, Pearson ${r}`).toBeLessThanOrEqual(1e-9)
    compared += 1
  })
  expect(compared).toBeGreaterThan(N / 2)
}


const GAP_SLOT = 'var float z = na\nz := bar_index % 7 == 3 ? na : close\n'

describe('correlation over runtime state stays refused by name (no capture pins na handling)', () => {
  it.each([
    ['v5 mutable slots', 5, 'plot(ta.correlation(x, y, 8))\n'],
    ['v4 mutable slots, bare spelling', 4, 'plot(correlation(x, y, 8))\n'],
    ['one slot and one bar field', 5, 'plot(ta.correlation(x, volume, 8))\n'],
    ['the na-gapped slot probe that served -47.64', 5, `${GAP_SLOT}plot(ta.correlation(z, y, 5))\n`],
  ])('%s', (_, version, body) => {
    const r = refusalOf(version, body)
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
    expect(r.token).toMatch(/correlation$/)
  })
  it('the wrong spelling for the version is refused the same way (v5 bare, v4 ta.)', () => {
    expect(refusalOf(5, 'plot(correlation(x, y, 8))\n').token).toBe('correlation')
    expect(refusalOf(4, 'plot(ta.correlation(x, y, 8))\n').token).toBe('ta.correlation')
  })
  it('the object door answers as it did on master (not an unrestricted serve)', () => {
    expect(refusalOf(5, 'plot(ta.correlation(x, y, 8))\n', { objectDoor: true }).guard)
      .toMatch(/^runtime:/)
  })
})

describe('the na-free columnar path is untouched, and every served value obeys |r| <= 1', () => {
  it('INVARIANT: na-free pure calls stay inside [-1, 1] and match Pearson', () => {
    for (const [body, a, b, n] of [
      ['plot(ta.correlation(close * 2 - open, volume, 8))\n', X, Y, 8],
      ['plot(ta.correlation(high - low, close, 5))\n', BARS.map((q) => q.h - q.l), BARS.map((q) => q.c), 5],
      ['plot(ta.correlation(close, -close, 12))\n', BARS.map((q) => q.c), BARS.map((q) => -q.c), 12],
    ]) {
      const out = run(5, body)
      const defined = out.filter(Number.isFinite)
      expect(defined.length).toBeGreaterThan(N / 2)
      defined.forEach((v) => expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9))
      near(out, pearson(a, b, n))
    }
  })
  it('TradingView capture rules (r11-corr-pct): na until the window fills, self-correlation is 1', () => {
    const out = run(5, 'plot(ta.correlation(close * 2 - open, close * 2 - open, 20))\n')
    out.forEach((v, i) => {
      if (i < 19) expect(Number.isNaN(v), `bar ${i} must be na`).toBe(true)
      else expect(Math.abs(v - 1), `bar ${i}`).toBeLessThan(1e-9)
    })
  })
  it('control: the reference is not a constant (a wrong formula would be seen)', () => {
    const r = pearson(X, Y, 8).filter(Number.isFinite)
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(0.2)
  })
})

describe('the other two sole-blocked names stay refused as undeclared, by name', () => {
  it('`ta.pivot_point_levels` (a real missing builtin, for W1 list)', () => {
    const r = refusalOf(5, 'p = ta.pivot_point_levels("Traditional", x > 0)\nplot(array.get(p, 0))\n')
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
    expect(r.token).toBe('ta.pivot_point_levels')
  })
  it('`time(timeframe)` (a real missing builtin: needs a timeframe calendar)', () => {
    const r = refusalOf(5, 'plot(ta.change(time(x > 0 ? "D" : "W")))\n')
    expect(r.guard).toBe('runtime:call-undeclared-builtin-state')
    expect(r.token).toBe('time')
  })
  it('control: the `time` variable is unaffected', () => {
    expect(() => run(5, 'plot(time - time[1])\n')).not.toThrow()
  })
})
