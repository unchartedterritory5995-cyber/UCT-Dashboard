// app/src/components/chart/engine/runtime/__tests__/w6ArrayMembers.test.js
//
// ─── ⭐⭐ W6-T5 — `array.*` COMPLETION ON THE RUNTIME LANE ──────────────────────
//
// Each member here is served from its Pine v6 REFERENCE entry and nothing else (the
// entries were read 2026-11-06 through `tools/pine_survey/pine_reference_extract.js`;
// each `describe` cites, in one short sentence, the rule it rests on). What an entry does
// not pin STOPS the run by name — `W6-A1` in `docs/pine/capture-queue-2026-11-06-w6.md`,
// probe `tools/visual_conformance/probes/vw-w6-array-members.pine` — and every such stop
// has a rail below that reaches it. `array.fill` / `array.insert` are the W19-R2 port
// (`w19r2Collections.test.js`); the three binary searches are Q-W19R2b.
//
// ⛔ EVERY FIXTURE IS `na`-FREE and MOVES with the bars: the expected value is computed
// here in JavaScript from the same bars, never typed in.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { Budget } from '../limits.js'

const N = 6
// ⭐ r1 — FRACTIONAL prices: `median` / `stdev` / `variance` are served only over an array the
// run can prove is float (one holding a fractional element), so whole-number bars would refuse.
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99.5 + i, h: 101.25 + i * 2, l: 98.75 - i, c: 100.5 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const per = (f) => BARS.map((b, i) => f(b, i))

function build(src, version = 6) {
  return buildRuntimeIr(`//@version=${version}\nindicator("t", overlay = true)\n${src}`, { bars: BARS, inputs: {} })
}
function runPine(src, version = 6) {
  const built = build(src, version)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}
const close = (got, want) => {
  expect(got.length).toBe(want.length)
  got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 9))
}

// JS references for the formulas
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length
const pvar = (xs) => { const m = mean(xs); return xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length }
const svar = (xs) => { const m = mean(xs); return xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1) }
const ohlc = (b) => [b.o, b.h, b.l, b.c]
const OHLC = 'a = array.from(open, high, low, close)\n'

describe('⭐ array.reverse — "The first array element becomes the last, and the last array element becomes the first."', () => {
  it('reverses in place, as a call and as a method', () => {
    const [f, l, g] = runPine(`${OHLC}array.reverse(a)\nplot(a.get(0))\nplot(a.get(3))\nb = array.from(open, close)\nb.reverse()\nplot(b.get(0))`)
    expect(f).toEqual(per((b) => b.c))
    expect(l).toEqual(per((b) => b.o))
    expect(g).toEqual(per((b) => b.c))
  })
  it('reverses the array itself: an alias sees it', () => {
    const [x] = runPine(`${OHLC}b = a\narray.reverse(a)\nplot(b.get(0))`)
    expect(x).toEqual(per((b) => b.c))
  })
})

describe('⭐ array.lastindexof — "the index of the last occurrence of the value, or -1 if the value is not found"', () => {
  it('the last of two, and -1 for a miss', () => {
    const [i, m] = runPine('a = array.from(close, open, close, low)\nplot(array.lastindexof(a, close))\nplot(a.lastindexof(-1.0))')
    expect(i).toEqual(per(() => 2))
    expect(m).toEqual(per(() => -1))
  })
  it('⛔ an `na` search value stops by name (W6-A1)', () => {
    expect(() => runPine('a = array.from(close)\nplot(array.lastindexof(a, na))')).toThrow(/array\.lastindexof of `na`.*W6-A1/)
  })
})

describe('⭐ array.range — "the difference between the min and max values"; na for an empty array', () => {
  it('max − min', () => {
    const [r] = runPine(`${OHLC}plot(array.range(a))`)
    close(r, per((b) => Math.max(...ohlc(b)) - Math.min(...ohlc(b))))
  })
  it('over the REAL elements (min / max skip `na`, measured RT7), and `na` when there are none', () => {
    const [r, e] = runPine('a = array.from(close, na, low)\nplot(array.range(a))\nplot(array.range(array.new_float()))')
    close(r, per((b) => b.c - b.l))
    expect(e.every(Number.isNaN)).toBe(true)
  })
})

describe('⭐ array.abs — "an array containing the absolute value of each element in the original array"', () => {
  it('a NEW array; the source is untouched', () => {
    const [s, src] = runPine('a = array.from(-close, open, low - high)\nb = array.abs(a)\nplot(array.sum(b))\nplot(a.get(0))')
    close(s, per((b) => b.c + b.o + Math.abs(b.l - b.h)))
    expect(src).toEqual(per((b) => -b.c))
  })
  it('⛔ an `na` element stops by name (W6-A1)', () => {
    expect(() => runPine('a = array.from(-close, na)\nplot(array.sum(array.abs(a)))')).toThrow(/array\.abs over an `na` element.*W6-A1/)
  })
})

describe('⭐ array.join — "concatenating all the elements of an array, separated by the specified separator string"', () => {
  it('text elements, joined by the separator', () => {
    const [len, eq] = runPine([
      's = bar_index % 2 == 0 ? "even" : "odd"',
      'a = array.from(s, "x", "yz")',
      'j = array.join(a, "--")',
      'plot(str.length(j))',
      'plot(j == s + "--x--yz" ? 1 : 0)',
    ].join('\n'))
    expect(len).toEqual(per((_, i) => (i % 2 === 0 ? 4 : 3) + 2 + 1 + 2 + 2))
    expect(eq).toEqual(per(() => 1))
  })
  it('⛔ numbers stop by name (how a float is formatted is W6-A1), and so does a missing separator', () => {
    expect(() => runPine('a = array.from(close, open)\nplot(str.length(array.join(a, ",")))')).toThrow(/array\.join over a non-text element.*W6-A1/)
    expect(() => runPine('a = array.from("a", "b")\nplot(str.length(array.join(a)))')).toThrow(/array\.join with no separator.*W6-A1/)
  })
})

describe('⭐⭐ array.variance / array.stdev / array.covariance — `biased` "Optional. The default is true."; true = "a biased estimate of the entire population", false = "an unbiased estimate of a sample"', () => {
  it('the default is the POPULATION form (divide by n)', () => {
    const [v, s] = runPine(`${OHLC}plot(array.variance(a))\nplot(array.stdev(a))`)
    close(v, per((b) => pvar(ohlc(b))))
    close(s, per((b) => Math.sqrt(pvar(ohlc(b)))))
  })
  it('`biased = true` is the same; `biased = false` the SAMPLE form (divide by n − 1)', () => {
    const [vt, vf, sf] = runPine(`${OHLC}plot(array.variance(a, true))\nplot(array.variance(a, false))\nplot(a.stdev(false))`)
    close(vt, per((b) => pvar(ohlc(b))))
    close(vf, per((b) => svar(ohlc(b))))
    close(sf, per((b) => Math.sqrt(svar(ohlc(b)))))
  })
  it('covariance, both forms', () => {
    const [ct, cf] = runPine(`${OHLC}b = array.from(close, open, high, volume)\nplot(array.covariance(a, b))\nplot(array.covariance(a, b, false))`)
    const cov = (bar, d) => {
      const xs = ohlc(bar)
      const ys = [bar.c, bar.o, bar.h, bar.v]
      const mx = mean(xs)
      const my = mean(ys)
      return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / d
    }
    close(ct, per((b) => cov(b, 4)))
    close(cf, per((b) => cov(b, 3)))
  })
  it('`na` for an empty array (covariance: when BOTH are empty)', () => {
    const outs = runPine('e = array.new_float()\nplot(array.variance(e))\nplot(array.stdev(e))\nplot(array.covariance(e, array.new_float()))')
    for (const o of outs) expect(o.every(Number.isNaN)).toBe(true)
  })
  it('⛔ what the entries do not pin stops by name (W6-A1)', () => {
    expect(() => runPine('a = array.from(close, na)\nplot(array.variance(a))')).toThrow(/array\.variance over an `na` element.*W6-A1/)
    expect(() => runPine('a = array.from(close, na)\nplot(array.stdev(a))')).toThrow(/array\.stdev over an `na` element.*W6-A1/)
    expect(() => runPine('a = array.from(close, na)\nplot(array.covariance(a, a))')).toThrow(/array\.covariance over an `na` element.*W6-A1/)
    expect(() => runPine('a = array.from(close)\nplot(array.variance(a, false))')).toThrow(/biased = false.*over 1 element.*W6-A1/)
    expect(() => runPine('plot(array.covariance(array.from(close), array.from(close, open)))')).toThrow(/arrays of 1 and 2 elements.*W6-A1/)
  })
})

describe('⭐ array.median — "the median of an array\'s elements"; na for an empty array', () => {
  it('odd count over a float array: the middle value, as a call and as a method', () => {
    const [m3, mm] = runPine('a3 = array.from(high, open, close)\nplot(array.median(a3))\nplot(a3.median())')
    close(m3, per((b) => [b.o, b.h, b.c].sort((x, y) => x - y)[1]))
    close(mm, per((b) => [b.o, b.h, b.c].sort((x, y) => x - y)[1]))
  })
  it('⛔ (review B1) an EVEN count stops by name: the entry gives no even-count rule (W6-A1)', () => {
    expect(() => runPine(`${OHLC}plot(a.median())`)).toThrow(/array\.median over an even count \(4\).*W6-A1/)
  })
  it.each(['median', 'stdev', 'variance'])('⛔ (review B1) %s over an array of whole numbers stops by name: `array<int>` returns `series int`, rounding unstated (W6-A1)', (name) => {
    const re = new RegExp(`array\\.${name} over an array of whole numbers.*W6-A1`)
    expect(() => runPine(`a = array.from(1, 2, 4)\nplot(array.${name}(a))`)).toThrow(re)
    expect(() => runPine(`a = array.new_int()\narray.push(a, 1)\narray.push(a, 2)\narray.push(a, 4)\nplot(array.${name}(a))`)).toThrow(re)
  })
  it('`na` for an empty array; ⛔ an `na` element stops by name (W6-A1)', () => {
    const [e] = runPine('plot(array.median(array.new_float()))')
    expect(e.every(Number.isNaN)).toBe(true)
    expect(() => runPine('a = array.from(close, na, open)\nplot(array.median(a))')).toThrow(/array\.median over an `na` element.*W6-A1/)
  })
})

describe('⭐ array.percentile_nearest_rank — "the value for which the specified percentage of array values (percentile) are less than or equal to it, using the nearest-rank method"', () => {
  it('rank ceil(p·n / 100) of the sorted values', () => {
    const [p25, p50, p100] = runPine(`${OHLC}plot(array.percentile_nearest_rank(a, 25))\nplot(array.percentile_nearest_rank(a, 50))\nplot(a.percentile_nearest_rank(100))`)
    const sorted = (b) => ohlc(b).sort((x, y) => x - y)
    close(p25, per((b) => sorted(b)[0]))
    close(p50, per((b) => sorted(b)[1]))
    close(p100, per((b) => sorted(b)[3]))
  })
  it('a whole rank stays whole: 7% of 100 values is the 7th, not the 8th (0.07 * 100 is 7.000000000000001)', () => {
    const [p] = runPine('a = array.new_float()\nfor k = 0 to 99\n    array.push(a, close + k)\nplot(array.percentile_nearest_rank(a, 7))')
    close(p, per((b) => b.c + 6))
  })
  it('`na` for an empty array; ⛔ p outside (0, 100] and an `na` element stop by name (W6-A1)', () => {
    const [e] = runPine('plot(array.percentile_nearest_rank(array.new_float(), 50))')
    expect(e.every(Number.isNaN)).toBe(true)
    expect(() => runPine(`${OHLC}plot(array.percentile_nearest_rank(a, 0))`)).toThrow(/at 0 .*W6-A1/)
    expect(() => runPine(`${OHLC}plot(array.percentile_nearest_rank(a, 101))`)).toThrow(/at 101 .*W6-A1/)
    expect(() => runPine('a = array.from(close, na)\nplot(array.percentile_nearest_rank(a, 50))')).toThrow(/over an `na` element.*W6-A1/)
  })
})

describe('⭐⭐ array.sort — "The sort order: order.ascending (default) or order.descending."', () => {
  it('real numbers, ascending by default, in place', () => {
    const [s0, s3] = runPine(`${OHLC}array.sort(a)\nplot(a.get(0))\nplot(a.get(3))`)
    expect(s0).toEqual(per((b) => Math.min(...ohlc(b))))
    expect(s3).toEqual(per((b) => Math.max(...ohlc(b))))
  })
  it('descending, as a call and as a method', () => {
    const [d0, m0] = runPine(`${OHLC}array.sort(a, order.descending)\nplot(a.get(0))\nb = array.from(low, high, close)\nb.sort(order.descending)\nplot(b.get(2))`)
    expect(d0).toEqual(per((b) => Math.max(...ohlc(b))))
    expect(m0).toEqual(per((b) => Math.min(b.l, b.h, b.c)))
  })
  it('⛔ an `na` element stops by name: where Pine places `na` is W6-A1', () => {
    expect(() => runPine('a = array.from(close, na, open)\narray.sort(a)\nplot(a.get(0))')).toThrow(/array\.sort over an `na` element.*W6-A1/)
  })
  it('⛔ text stops by name: codepoint or locale order, and case, is W6-A1', () => {
    expect(() => runPine('a = array.from("b", "A", "a")\narray.sort(a)\nplot(str.length(a.get(0)))')).toThrow(/array\.sort over text.*W6-A1/)
  })
})

describe('⭐ array.sort_indices over real numbers — "It does not modify the original array."', () => {
  it('the ranking, and the source is unchanged', () => {
    const [i0, src0] = runPine(`${OHLC}i = array.sort_indices(a)\nplot(i.get(0))\nplot(a.get(0))`)
    expect(i0).toEqual(per((b) => ohlc(b).indexOf(Math.min(...ohlc(b)))))
    expect(src0).toEqual(per((b) => b.o))
  })
})

describe('⭐ v6 array.every / array.some — "zero values are considered false, and all others true"', () => {
  it('every: all non-zero; some: at least one non-zero', () => {
    const [e1, e0, s1, s0] = runPine([
      'a = array.from(close, open)',
      'z = array.from(close - close, open)',
      'n = array.from(close - close, 0.0)',
      'plot(array.every(a) ? 1 : 0)',
      'plot(array.every(z) ? 1 : 0)',
      'plot(z.some() ? 1 : 0)',
      'plot(array.some(n) ? 1 : 0)',
    ].join('\n'))
    expect(e1).toEqual(per(() => 1))
    expect(e0).toEqual(per(() => 0))
    expect(s1).toEqual(per(() => 1))
    expect(s0).toEqual(per(() => 0))
  })
  it('⛔ an empty array, an `na` element and a pre-v6 script stop by name (W6-A1)', () => {
    expect(() => runPine('plot(array.every(array.new_float()) ? 1 : 0)')).toThrow(/array\.every of an empty array.*W6-A1/)
    expect(() => runPine('a = array.from(close, na)\nplot(array.some(a) ? 1 : 0)')).toThrow(/array\.some over an `na` element.*W6-A1/)
    expect(() => runPine('a = array.from(close)\nplot(array.every(a) ? 1 : 0)', 5)).toThrow(/older than v6.*W6-A1/)
  })
  it('⛔ the unmeasured fill of a sized bool array is never read — in any array argument', () => {
    expect(() => runPine('a = array.new_bool(3)\nplot(array.every(a) ? 1 : 0)')).toThrow(/array\.every reads an element/)
    expect(() => runPine('a = array.from(close)\nb = array.new_bool(1)\nplot(array.covariance(a, b))')).toThrow(/array\.covariance reads an element/)
  })
})

describe('⛔ `array.slice` stays a copy linked to its source: the new writers refuse through it', () => {
  it.each(['array.fill(b, close)', 'array.reverse(b)', 'array.sort(b)', 'array.insert(b, 0, close)'])('%s', (stmt) => {
    expect(() => runPine(`${OHLC}b = array.slice(a, 0, 2)\n${stmt}\nplot(a.get(0))`)).toThrow(/shares storage with an `array\.slice`/)
  })
})

describe('⛔ KEPT REFUSED BY NAME at build, until a capture settles them (W6-A1, Q-W19R2b)', () => {
  it.each([
    ['array.percentile_linear_interpolation', 'array.percentile_linear_interpolation(a, 50)'],
    ['array.standardize', 'array.sum(array.standardize(a))'],
    ['array.percentrank', 'array.percentrank(a, 0)'],
    ['array.mode', 'array.mode(a)'],
    ['array.binary_search', 'array.binary_search(a, close)'],
    ['array.binary_search_leftmost', 'array.binary_search_leftmost(a, close)'],
    ['array.binary_search_rightmost', 'array.binary_search_rightmost(a, close)'],
  ])('%s', (name, expr) => {
    const built = build(`${OHLC}plot(${expr})`)
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:array')
    expect(built.refusal.message).toContain(name)
  })
  it('CONTROL — a served member over the same array builds', () => {
    expect(build(`${OHLC}plot(array.median(a))`).ok).toBe(true)
  })
})

// ⭐⭐ THE OBJECT DOOR'S RUN KEEPS MASTER'S ANSWER for `array.median` / `array.stdev`.
// The C18 door's run is the one caller that carries `budget.unmeasured`
// (`runtimeColumns.js::runtimeObjectValues`); there, an empty array still answers the
// probe and elements still stop by name, exactly as master's `unmeasuredReduction` did.
describe('⛔ under the C18 door\'s probe, median / stdev answer as master did', () => {
  const runProbed = (src) => {
    const built = build(src)
    if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
    const program = lowerIrProgram(built.ir)
    const budget = new Budget()
    budget.unmeasured = { probe: -7.5, colourProbe: 0, hits: [] }
    const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true },
      undefined, { budget })
    return { outs: outputs.map((o) => Array.from(o)), hits: budget.unmeasured.hits }
  }
  it.each(['median', 'stdev'])('%s: elements stop the run by name', (name) => {
    expect(() => runProbed(`${OHLC}plot(array.${name}(a))`)).toThrow(new RegExp(`array\\.${name} — this runtime does not compute it yet`))
  })
  it.each(['median', 'stdev'])('%s: an empty array answers the probe and records the hit', (name) => {
    const { outs, hits } = runProbed(`plot(array.${name}(array.new_float()))`)
    expect(outs[0]).toEqual(per(() => -7.5))
    expect(hits).toEqual(per(() => `array.${name}`))
  })
  it('CONTROL — the same calls without a probe compute the reference formula', () => {
    const [m] = runPine('a = array.from(high, open, close)\nplot(array.median(a))')
    close(m, per((b) => [b.o, b.h, b.c].sort((x, y) => x - y)[1]))
  })
})
