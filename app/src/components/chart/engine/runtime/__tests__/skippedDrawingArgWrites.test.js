// app/src/components/chart/engine/runtime/__tests__/skippedDrawingArgWrites.test.js
//
// ⭐⭐ engine 83 — A DRAWING CALL THIS LANE SKIPS STILL RUNS WHAT ITS ARGUMENTS WRITE.
//
// A runtime-lane document that does not draw its own objects is built with `objectTrees` (the object program
// owns every drawing call), and the front end SKIPS a drawing call. ⚰️ It skipped the call's arguments too, so
// `label.delete(array.shift(xs))` never shrank `xs`: a script capping its drawings kept every one in the list
// (found by the Studio session: 8 lines, 5 on the last bar in Pine, 149 here), and `while array.size(xs) > n`
// ran to the 10,000-pass limit. 9 of 9 one-call forms were wrong; 9 of 9 two-step forms right.
// `pineRuntimeFrontend.js::skippedDrawingWrites` runs each argument's write, in Pine's order, or refuses by name
// where it cannot (a write on only some evaluations, a `var` initialiser).
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 14
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 105 + i, l: 95, c: 100 + i, v: 1 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const H = '//@version=6\nindicator("t", overlay = true)\n'
/** the plots of `src`, built as a runtime document whose drawings the object program owns (or, `own`, as one
 *  that draws its own) */
const plots = (src, own = false) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {}, pane: true, ...(own ? { objectsInRun: true } : { objectTrees: [] }) })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const p = lowerIrProgram(b.ir)
  return execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true }).outputs
    .map((o) => Array.from(o, (v) => (Number.isNaN(v) ? null : v)))
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {}, pane: true, objectTrees: [] })
  return b.ok ? null : b.refusal
}
const NEW = {
  label: 'label.new(bar_index, close, "x")',
  line: 'line.new(bar_index, close, bar_index + 1, close)',
  box: 'box.new(bar_index, high, bar_index + 1, low)',
}
const TAKE = { shift: 'array.shift(xs)', pop: 'array.pop(xs)', remove: 'array.remove(xs, 0)' }
const capped = (fam, take, oneCall, loop = 'if') => `${H}var xs = array.new<${fam}>()\n`
  + `array.push(xs, ${NEW[fam]})\n`
  + `${loop} array.size(xs) > 5\n`
  + (oneCall ? `    ${fam}.delete(${TAKE[take]})\n` : `    old = ${TAKE[take]}\n    ${fam}.delete(old)\n`)
  + 'plot(array.size(xs))\n'
const SIZES = Array.from({ length: N }, (_, i) => Math.min(i + 1, 5))

describe('a drawing deleted as it leaves its list: the list shrinks (9 one-call forms = their two-step forms)', () => {
  for (const fam of Object.keys(NEW)) {
    for (const take of Object.keys(TAKE)) {
      it(`${fam}.delete(${TAKE[take]})`, () => {
        const one = plots(capped(fam, take, true))
        const two = plots(capped(fam, take, false))
        expect(one).toEqual(two)
        expect(one[0]).toEqual(SIZES)
      })
    }
  }
  it('`while array.size(xs) > 5` ends, at 5, as the run that draws its own objects does', () => {
    const src = capped('line', 'shift', true, 'while')
    expect(plots(src)[0]).toEqual(SIZES)
    expect(plots(src, true)[0]).toEqual(SIZES)
  })
})

describe('every skip site runs the write, in Pine\'s order', () => {
  it('a float list read inside a drawing\'s argument is shifted (`label.new(bar_index, array.shift(fs))`)', () => {
    const src = `${H}var fs = array.new<float>()\narray.push(fs, close)\nif array.size(fs) > 3\n`
      + '    label.new(bar_index, array.shift(fs), "x")\nplot(array.size(fs))\nplot(array.size(fs) > 0 ? array.get(fs, 0) : na)\n'
    const two = src.replace('    label.new(bar_index, array.shift(fs), "x")\n', '    y = array.shift(fs)\n    label.new(bar_index, y, "x")\n')
    expect(plots(src)).toEqual(plots(two))
    expect(plots(src)[0]).toEqual(Array.from({ length: N }, (_, i) => Math.min(i + 1, 3)))
  })
  it('the order of two writes in one call is Pine\'s, left to right (`remove(xs, 1)` before `shift(xs)`)', () => {
    const src = `${H}var xs = array.new<float>()\narray.push(xs, close)\nif array.size(xs) == 3\n`
      + '    label.new(bar_index, array.remove(xs, 1), str.tostring(array.shift(xs)))\n'
      + 'plot(array.size(xs))\nplot(array.size(xs) > 0 ? array.get(xs, 0) : na)\n'
    const two = src.replace('    label.new(bar_index, array.remove(xs, 1), str.tostring(array.shift(xs)))\n',
      '    a = array.remove(xs, 1)\n    b = array.shift(xs)\n    label.new(bar_index, a, str.tostring(b))\n')
    expect(plots(src)).toEqual(plots(two))
    // closes 100, 101, 102: remove(1) leaves [100, 102], shift leaves [102] (the other order leaves [101])
    expect(plots(src)[1][2]).toBe(102)
  })
  it('a script function that writes the list (`label.delete(takeOldest(xs))`) runs, as its two-step form does', () => {
    const src = `${H}takeOldest(array<label> a) =>\n    array.shift(a)\nvar xs = array.new<label>()\n`
      + 'array.push(xs, label.new(bar_index, close, "x"))\nif array.size(xs) > 5\n    label.delete(takeOldest(xs))\nplot(array.size(xs))\n'
    const two = src.replace('    label.delete(takeOldest(xs))\n', '    old = takeOldest(xs)\n    label.delete(old)\n')
    expect(plots(src)).toEqual(plots(two))
    expect(plots(src)[0]).toEqual(SIZES)
  })
  it('CONTROL: a script function that only DRAWS, read inside a drawing\'s argument, is the object program\'s and not run', () => {
    const src = `${H}dx(array<int> a) =>\n    l = line.new(bar_index - 20, close, bar_index - 10, close)\n`
      + '    l.set_x2(l.get_x1() + a.avg() + 1)\n    l.get_x2() - l.get_x1()\nvar ia = array.from(1, 2)\n'
      + 'if barstate.islast\n    label.new(bar_index, 0, str.tostring(dx(ia)))\nplot(array.size(ia))\n'
    expect(refusalOf(src)).toBe(null)
    expect(plots(src)[0]).toEqual(Array(N).fill(2))
  })
  it('`ln := line.new(…, array.pop(ys), …)` pops where the assignment runs', () => {
    const src = `${H}var ys = array.new<float>()\nvar line ln = na\narray.push(ys, close)\narray.push(ys, high)\n`
      + 'ln := line.new(bar_index, array.pop(ys), bar_index + 1, close)\nplot(array.size(ys))\n'
    expect(plots(src)[0]).toEqual(Array.from({ length: N }, (_, i) => i + 1))
  })
  it('a method on a handle (`ln.set_y1(array.shift(ys))`) shifts', () => {
    const src = `${H}var ys = array.new<float>()\nvar ln = line.new(0, 0, 1, 1)\narray.push(ys, close)\narray.push(ys, high)\n`
      + 'ln.set_y1(array.shift(ys))\nplot(array.size(ys))\n'
    expect(plots(src)[0]).toEqual(Array.from({ length: N }, (_, i) => i + 1))
  })
})

describe('where the write cannot run at the skip, refused by name; with no write, nothing changes', () => {
  it('a write on only some evaluations (a `?:` arm) is refused, naming it', () => {
    const r = refusalOf(`${H}var xs = array.new<label>()\narray.push(xs, label.new(bar_index, close, "x"))\n`
      + 'label.delete(array.size(xs) > 5 ? array.shift(xs) : na)\nplot(array.size(xs))\n')
    expect(r && r.guard).toBe('runtime:object-op')
    expect(r.message).toMatch(/`array\.shift\(\)`.*only some of the bars/)
  })
  it('a write inside a drawing minted as a value (`array.push(xs, line.new(…, array.pop(ys), …))`) is refused', () => {
    const r = refusalOf(`${H}var ys = array.new<float>()\nvar xs = array.new<line>()\narray.push(ys, close)\narray.push(ys, high)\n`
      + 'array.push(xs, line.new(bar_index, array.pop(ys), bar_index + 1, close))\nplot(array.size(ys))\n')
    expect(r && r.guard).toBe('runtime:object-op')
    expect(r.message).toMatch(/`array\.pop\(\)`.*where this lane cannot run it/)
  })
  it('a write in a `var` drawing\'s initialiser (it runs once) is refused', () => {
    const r = refusalOf(`${H}var ys = array.from(1.0, 2.0, 3.0)\nvar ln = line.new(0, array.shift(ys), 1, 1)\nplot(array.size(ys))\n`)
    expect(r && r.guard).toBe('runtime:object-op')
    expect(r.message).toMatch(/`array\.shift\(\)`/)
  })
  it('CONTROL: a drawing whose arguments write nothing is skipped as before, and the plots are the same', () => {
    const src = `${H}var xs = array.new<float>()\narray.push(xs, close)\nlabel.new(bar_index, array.get(xs, 0), str.tostring(array.size(xs)))\nplot(array.size(xs))\n`
    expect(plots(src)[0]).toEqual(Array.from({ length: N }, (_, i) => i + 1))
  })
})
