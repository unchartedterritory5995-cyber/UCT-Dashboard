// app/src/components/chart/engine/runtime/__tests__/finiteWindowNoRing.test.js
//
// ⭐⭐ engine NUMBER PENDING — A `finite` WINDOW IN A PROGRAM WITH NO HISTORY RING ANSWERS ITS EXTREME.
//
// `ta.lowest` / `ta.highest` / `ta.lowestbars` / `ta.highestbars` (the `finite` policy) read the bar's ordinal,
// `committed`, for their warm-up (`committed < span - 1` is `na`) and the `bars` members count back from it. The
// VM advanced `committed` only when the program held a history ring. A window over a source lowered IN PLACE
// (HIST-S2: an expression in an `if` arm or a function branch, where no line can commit it) keeps its own
// observation ring and holds no history slot, so in a program with no other ring every such window answered
// `na` whenever its span was above 1. Found by the libraries agent, 2026-11-19:
//   `if show` + `x := ta.lowest(low * 1, k)` with `k` cycling 1..4 read [95, na, na, na, 91, ...]
//   where the same call at the root (and Pine) reads [95, 94, 93, 92, 91, ...];
//   a FIXED length 3 read `na` on every bar.
// Each case here is the same call two ways (in place, and at the root, where it is served from a ring) on the
// same bars, plus the hand value.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 12
// lows fall 95, 94, …; highs cycle 105, 106, 107
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 105 + (i % 3), l: 95 - i, c: 100, v: 1 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
function run(src) {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  // `na` as null; a negated zero (`highestbars` is `-(bars back)`) compares as 0
  return { out: Array.from(r.outputs[0], (v) => (Number.isNaN(v) ? null : v === 0 ? 0 : v)), program }
}
const HEAD = '//@version=6\nindicator("t")\nshow = input.bool(true)\nvar int k = 0\nk := k % 4 + 1\n'
const inPlace = (call) => `${HEAD}float x = na\nif show\n    x := ${call}\nplot(x)\n`
const atRoot = (call) => `${HEAD}x = ${call}\nplot(x)\n`
const VAR_LOW = 'var float y = 0.0\ny := low\n'
const VAR_HIGH = 'var float y = 0.0\ny := high\n'
const K = Array.from({ length: N }, (_, i) => (i % 4) + 1)

describe('the in-place window holds no ring, so these programs have none at all (the shape this rail is about)', () => {
  it('ta.lowest(low * 1, k) in an `if` arm: no history slot, one per-bar window', () => {
    const { program } = run(inPlace('ta.lowest(low * 1, k)'))
    expect(program.history.length).toBe(0)
    expect(program.windows.map((w) => w.dynamic === true)).toEqual([true])
  })
})

describe('the libraries agent\'s repro: a per-bar length', () => {
  it('ta.lowest(low * 1, k) in place is the root form, and the hand value', () => {
    const hand = BARS.map((_, i) => Math.min(...BARS.slice(Math.max(0, i - K[i] + 1), i + 1).map((b) => b.l)))
    expect(hand.slice(0, 5)).toEqual([95, 94, 93, 92, 91])
    expect(run(inPlace('ta.lowest(low * 1, k)')).out).toEqual(hand)
    expect(run(atRoot('ta.lowest(low * 1, k)')).out).toEqual(hand)
  })
  it('ta.highestbars(high * 1, k) in place is the root form', () => {
    const root = run(atRoot('ta.highestbars(high * 1, k)')).out
    expect(root).toEqual([0, 0, 0, -1, 0, 0, -1, -2, 0, -1, -2, 0])
    expect(run(inPlace('ta.highestbars(high * 1, k)')).out).toEqual(root)
  })
  it('CONTROL: the skip policy (ta.sma) never read the ordinal, and still reads the same', () => {
    expect(run(inPlace('ta.sma(low * 1, k)')).out).toEqual(run(atRoot('ta.sma(low * 1, k)')).out)
  })
})

describe('a FIXED length through the VM (an in-place source over a variable): it read `na` on every bar', () => {
  it('ta.lowest(y * 1, 3): `na` on bars 0 and 1, then the 3-bar low', () => {
    const { out, program } = run(VAR_LOW.replace(/^/, HEAD) + 'float x = na\nif show\n    x := ta.lowest(y * 1, 3)\nplot(x)\n')
    expect(program.history.length).toBe(0)
    expect(out).toEqual([null, null, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84])
  })
  it('ta.highestbars(y * 1, 3): counts back in bars from the live bar', () => {
    const { out } = run(VAR_HIGH.replace(/^/, HEAD) + 'float x = na\nif show\n    x := ta.highestbars(y * 1, 3)\nplot(x)\n')
    expect(out).toEqual([null, null, 0, -1, -2, 0, -1, -2, 0, -1, -2, 0])
  })
})
