// app/src/components/chart/engine/runtime/__tests__/methodsAndArrayMembers.test.js
//
// ─── ⭐⭐ C11 — A SCRIPT'S OWN `method`, AND THE ARRAY MEMBERS THE C11 SCRIPTS WRITE ─
//
// The C11 row of `docs/pine/vendor-harness/objects-triage-2026-09-28.md` is nine
// scripts whose drawings hang off ARRAYS written in the method form. Measured
// (step 1 of the lane): every one of them attaches on the host lane, so the
// runtime pane flag moves none of them, and the per-bar runtime lane — the only
// lane that HAS arrays — refused all nine on its front end before a single bar
// ran. The first walls, by script:
//
//   pro-trading-art      `method maintainPivot(array<float> a, …)` — runtime:udt-method
//   (and after it)       `srcArray.shift()`, `top.first()`, `top.max()` … runtime:array
//   trend-duration       `bullishCount.avg()`, `.shift()`               runtime:array
//   vdubus               `array.unshift`, `array.pop`                   runtime:array
//   htf-liquidity        `h_arr.unshift(…)`, `.pop()`                   runtime:array
//
// ⛔⛔ EVERY FIXTURE MOVES A VALUE. An array read of `close` is satisfied by a lane
// that never built the array, so each case pushes computed values, mutates them,
// and asserts a number only the real operation produces — derived from the bars
// in JavaScript, never typed.
//
// ⛔ AND WHAT PINE LEAVES UNMEASURED STAYS A NAMED STOP. A reduction over an `na`
// element, over an empty array, and an `na` search value are three places where
// the vendor's answer has not been watched; each stops the run BY NAME here, and
// the case says so, so nobody mistakes the stop for a gap to paper over.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, paramTypeHeads } from '../../ast/pineRuntimeFrontend.js'
import { lexPine } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i * 2, l: 98 - i, c: 100 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'
const closes = BARS.map((b) => b.c)
const highs = BARS.map((b) => b.h)

function build(src) {
  return buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
}
function runPine(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return outputs.map((o) => Array.from(o))
}
const nan = (xs) => xs.map((v) => (Number.isFinite(v) ? v : null))

// --------------------------------------------------------------------------- //
// A — a declared `method` is a user function whose receiver is argument 0
// --------------------------------------------------------------------------- //

describe('⭐⭐ A — `method f(T recv, …)` binds, and `recv.f(…)` calls it', () => {
  it('an array receiver: PTA\'s rolling window, statement form, read back through a value-form method', () => {
    // `maintainPivot` is pro-trading-art's own helper, verbatim in shape: push
    // the newest, shift the oldest, so the array is always the last 3 values.
    const out = runPine(
      'method roll(array<float> a, float v) =>\n'
      + '    a.push(v)\n'
      + '    a.shift()\n'
      + 'method middle(array<float> a) =>\n'
      + '    a.get(a.size() - 2)\n'
      + 'var w = array.new_float(3)\n'
      + 'w.roll(close)\n'
      + 'plot(w.middle())\n')
    // after bar i the window is [c(i-2), c(i-1), c(i)], so its middle is c(i-1);
    // the first bar's window is [na, na, c0] and its middle is na.
    const want = closes.map((_, i) => (i >= 1 ? closes[i - 1] : null))
    expect(nan(out[0])).toEqual(want)
  })

  it('⛔ DISCRIMINATOR — the dotted call and the plain call are one program, value for value', () => {
    const body = (call) => 'method grow(array<float> a, float v) =>\n'
      + '    a.push(v * 2)\n'
      + '    a.size()\n'
      + 'var w = array.new_float(0)\n'
      + `n = ${call}\n`
      + 'plot(n + w.get(w.size() - 1))\n'
    const dotted = runPine(body('w.grow(high)'))[0]
    const plain = runPine(body('grow(w, high)'))[0]
    expect(dotted).toEqual(plain)
    expect(dotted).toEqual(highs.map((h, i) => (i + 1) + h * 2))
  })

  it('a user-TYPE receiver: the field write reaches the caller\'s record', () => {
    const out = runPine(
      'type Acc\n'
      + '    float total = 0.0\n'
      + 'method add(Acc this, float d) =>\n'
      + '    this.total := this.total + d\n'
      + '    this.total\n'
      + 'var acc = Acc.new(0.0)\n'
      + 'acc.add(close)\n'
      + 'plot(acc.total)\n')
    let s = 0
    expect(out[0]).toEqual(closes.map((c) => (s += c)))
  })

  it('⛔ AN OVERLOADED METHOD STILL REFUSES, BY NAME — Pine picks by the receiver\'s type', () => {
    const r = build(
      'method pick(array<float> a) =>\n'
      + '    a.size()\n'
      + 'method pick(array<int> a) =>\n'
      + '    a.size() * 10\n'
      + 'var w = array.new_float(0)\n'
      + 'plot(w.pick())\n')
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:udt-method')
    expect(r.refusal.message).toContain('pick')
  })

  it('⛔ CONTROL — a PLAIN function is never called in the dotted form', () => {
    // Pine only lets a `method` be called `recv.f()`; a plain `f(a) =>` spelled
    // that way is not a call to it, and this lane must not decide it is.
    const r = build(
      'f(a) =>\n'
      + '    a.size()\n'
      + 'var w = array.new_float(0)\n'
      + 'plot(w.f())\n')
    expect(r.ok).toBe(false)
  })

  it('the declared parameter types are read off the header, nearest word wins', () => {
    const { tokens } = lexPine('method f(array<float> a, series int n, x) => a\n')
    const toks = tokens.slice(1, tokens.findIndex((t) => t.value === '=>') + 2)
    const arrow = toks.findIndex((t) => t.value === '=>')
    const m = paramTypeHeads(toks, arrow)
    expect(m.get('a')).toEqual({ word: 'array', typeArg: 'float' })
    expect(m.get('n')).toEqual({ word: 'int', typeArg: null })
    expect(m.has('x')).toBe(false)
  })
})

// --------------------------------------------------------------------------- //
// B — the array members, each moving a value only it can produce
// --------------------------------------------------------------------------- //

/** A window of the last three highs, newest LAST, built by push/shift. */
const WIN = 'var w = array.new_float(0)\n'
  + 'w.push(high)\n'
  + 'if w.size() > 3\n'
  + '    w.shift()\n'
const win = (i) => highs.slice(Math.max(0, i - 2), i + 1)

describe('⭐⭐ B — first / last / shift / pop / unshift / remove / concat', () => {
  it('first and last read the two ends; shift as a STATEMENT drops its value', () => {
    const [f, l] = runPine(`${WIN}plot(w.first())\nplot(w.last())\n`)
    expect(f).toEqual(highs.map((_, i) => win(i)[0]))
    expect(l).toEqual(highs)
  })

  it('shift and pop RETURN what they remove', () => {
    const [s, p] = runPine(
      'a = array.from(close, high, low)\n'
      + 'b = array.from(close, high, low)\n'
      + 'plot(a.shift() + a.size())\n'
      + 'plot(array.pop(b) + array.size(b))\n')
    expect(s).toEqual(closes.map((c) => c + 2))
    expect(p).toEqual(BARS.map((b) => b.l + 2))
  })

  it('unshift puts the newest FIRST — the other end from push', () => {
    const [f] = runPine(
      'var w = array.new_float(0)\n'
      + 'w.unshift(close)\n'
      + 'if w.size() > 2\n'
      + '    array.pop(w)\n'
      + 'plot(w.first() - w.last())\n')
    expect(f).toEqual(closes.map((c, i) => (i === 0 ? 0 : c - closes[i - 1])))
  })

  it('remove takes out the element at an index and returns it', () => {
    const [r] = runPine(
      'a = array.from(close, high, low)\n'
      + 'x = a.remove(1)\n'
      + 'plot(x * 10 + a.size() + a.get(1) / 1000)\n')
    expect(r.map((v) => Math.round(v * 1000))).toEqual(
      BARS.map((b) => Math.round((b.h * 10 + 2 + b.l / 1000) * 1000)))
  })

  it('concat appends the second array to the FIRST and returns that same array', () => {
    const [n, same] = runPine(
      'a = array.from(close)\n'
      + 'b = array.from(high, low)\n'
      + 'c = array.concat(a, b)\n'
      + 'plot(a.size())\n'
      + 'c.push(1.0)\n'
      + 'plot(a.size())\n')
    expect(n).toEqual(BARS.map(() => 3))
    // ⛔ THE REFERENCE HALF: a push through `c` is a push to `a`.
    expect(same).toEqual(BARS.map(() => 4))
  })
})

describe('⭐⭐ B2 — indexof / includes / max / min / sum / avg', () => {
  it('max, min, indexof and includes over a moving window', () => {
    const [mx, mn, ix, inc, exc] = runPine(`${WIN}plot(w.max())\nplot(w.min())\n`
      + 'plot(w.indexof(w.max()))\nplot(w.includes(high) ? 1 : 0)\nplot(w.includes(low) ? 1 : 0)\n')
    expect(mx).toEqual(highs.map((_, i) => Math.max(...win(i))))
    expect(mn).toEqual(highs.map((_, i) => Math.min(...win(i))))
    // 0, 1, 2, 2, … — the index moves with the window, so a constant cannot pass
    expect(ix).toEqual(highs.map((_, i) => win(i).indexOf(Math.max(...win(i)))))
    // ⛔ THE PAIR: the window holds this bar's high and never a low.
    expect(inc).toEqual(highs.map(() => 1))
    expect(exc).toEqual(highs.map(() => 0))
  })

  it('sum and avg', () => {
    const [s, a] = runPine(`${WIN}plot(w.sum())\nplot(w.avg())\n`)
    const sum = (xs) => xs.reduce((t, v) => t + v, 0)
    expect(s).toEqual(highs.map((_, i) => sum(win(i))))
    expect(a).toEqual(highs.map((_, i) => sum(win(i)) / win(i).length))
  })
})

// --------------------------------------------------------------------------- //
// C — what Pine leaves unmeasured stops the run by name
// --------------------------------------------------------------------------- //

describe('⛔ C — the unmeasured and the impossible stop BY NAME, never answer na', () => {
  it('first / shift / pop of an EMPTY array stop the script, as Pine does', () => {
    for (const call of ['a.first()', 'a.last()', 'a.shift()', 'array.pop(a)']) {
      expect(() => runPine(`a = array.new_float(0)\nplot(${call})\n`), call)
        .toThrow(/the array is empty/)
    }
  })

  // ⚰️ RT7 — an `na` ELEMENT and an `na` SEARCH value are MEASURED now
  // (`vw-array-na-spy-1d-2026-10-02`, `rt7ArrayNa.test.js`): skipped, and found nowhere.
  // ⭐ H7 (step 92h) — and `sum` / `avg` over ZERO real elements are MEASURED now
  // (CAP4 Q-RT7a, E03-E06): `na`, never 0, and no stop.
  it('a sum / avg over zero real elements is na (measured), in the method form too', () => {
    expect(nan(runPine('a = array.new_float(2)\nplot(a.sum())\n')[0]).every((x) => x === null)).toBe(true)
    expect(nan(runPine('a = array.new_float(0)\nplot(a.avg())\n')[0]).every((x) => x === null)).toBe(true)
  })

  it('an na SEARCH value finds nothing (measured), in the method form too', () => {
    expect(runPine('a = array.from(close)\nplot(a.indexof(close[1]))\n')[0][0]).toBe(-1)
  })

  it('⛔ `array.slice` is a VIEW in Pine — served as a copy only while neither side is written', () => {
    // ⚰️ C18 — this refused at build. It is served now, and the view/copy
    // difference is refused where it could show: a write to the slice OR to its
    // source after the slice stops the run by name (`collections.js::SLICED`).
    const ok = runPine('a = array.from(close, high)\nb = array.slice(a, 0, 1)\nplot(b.size())\nplot(b.get(0))\n')
    expect(ok[0]).toEqual(new Array(N).fill(1))
    expect(ok[1]).toEqual(closes)
    expect(() => runPine('a = array.from(close, high)\nb = array.slice(a, 0, 1)\narray.set(b, 0, 5.0)\nplot(b.size())\n'))
      .toThrow(/array\.set: this array shares storage with an `array\.slice`/)
    expect(() => runPine('a = array.from(close, high)\nb = array.slice(a, 0, 1)\narray.push(a, 5.0)\nplot(b.size())\n'))
      .toThrow(/array\.push: this array shares storage with an `array\.slice`/)
    // ⛔ CONTROL — `array.copy` of a slice is an ordinary array, freely written.
    const c = runPine('a = array.from(close, high)\nb = array.copy(array.slice(a, 0, 1))\narray.set(b, 0, 5.0)\nplot(b.get(0))\n')
    expect(c[0]).toEqual(new Array(N).fill(5))
  })
})
