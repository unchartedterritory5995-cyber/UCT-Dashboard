// app/src/components/chart/engine/runtime/__tests__/namedBuiltinArgs.test.js
//
// ─── ⭐⭐ ENGINE NUMBER PENDING (A2) — A NAMED ARGUMENT ON A SERVED BUILT-IN TAKES ITS DECLARED POSITION ─────────
//
// The Pine v6 reference's syntax lines name the parameters: `color.new(color, transp)`, `color.rgb(red, green, blue,
// transp)`, `color.from_gradient(value, bottom_value, top_value, bottom_color, top_color)`,
// `array.new_<type>(size, initial_value)`, `array.new<type>(size, initial_value)`. The runtime lane refused any named
// argument on these (`runtime:statement`, "a named argument `size` on `array.new_float`"). A named argument now goes to
// its parameter and positional ones fill from the left (the review-L3 rule `ta.sma(source = …, length = …)`), so the
// call IS the positional call: the same program, the same values.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 100 + i, h: 103 + i, l: 97 + i, c: 101 + (i % 3), v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=6\nindicator("t")\n'

const build = (body) => buildRuntimeIr(HEAD + body, { bars: BARS, inputs: {} })
function run(body) {
  const b = build(body)
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: true })
  const outs = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }).outputs
    .map((o) => Array.from(o))
  return { ir: JSON.stringify(b.ir.statements), outs }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || x === b[i])

// [named form, positional form]; each body holds the call in a runtime-only place (a `var` the bars reassign)
const PAIRS = {
  'color.new(color =, transp =)': [
    'var color c = na\nc := color.new(color = close > open ? color.red : color.blue, transp = 50)\nbgcolor(c)\n',
    'var color c = na\nc := color.new(close > open ? color.red : color.blue, 50)\nbgcolor(c)\n'],
  'color.new(transp =, color =), either order': [
    'var color c = na\nc := color.new(transp = 40, color = color.green)\nbgcolor(c)\n',
    'var color c = na\nc := color.new(color.green, 40)\nbgcolor(c)\n'],
  'color.new(positional, transp =)': [
    'var color c = na\nc := color.new(color.green, transp = 20)\nbgcolor(c)\n',
    'var color c = na\nc := color.new(color.green, 20)\nbgcolor(c)\n'],
  'color.rgb(red =, green =, blue =, transp =)': [
    'var color c = na\nc := color.rgb(red = close, green = 50, blue = open, transp = 10)\nbgcolor(c)\n',
    'var color c = na\nc := color.rgb(close, 50, open, 10)\nbgcolor(c)\n'],
  'array.new_float(size =, initial_value =)': [
    'var a = array.new_float(size = 3, initial_value = 1.5)\narray.push(a, close)\nplot(array.sum(a))\n',
    'var a = array.new_float(3, 1.5)\narray.push(a, close)\nplot(array.sum(a))\n'],
  'array.new<float>(initial_value =, size =), either order': [
    'var a = array.new<float>(initial_value = 2.0, size = 2)\narray.push(a, close)\nplot(array.sum(a))\n',
    'var a = array.new<float>(2, 2.0)\narray.push(a, close)\nplot(array.sum(a))\n'],
  'array.new_int(size =) alone': [
    'var a = array.new_int(size = 4)\nplot(array.size(a))\n',
    'var a = array.new_int(4)\nplot(array.size(a))\n'],
}

describe('A2 — a named argument takes its declared position: the call is the positional call', () => {
  for (const [what, [named, positional]] of Object.entries(PAIRS)) {
    it(what, () => {
      const a = run(named)
      const b = run(positional)
      expect(a.ir).toBe(b.ir)
      expect(a.outs.length).toBe(b.outs.length)
      a.outs.forEach((o, k) => expect(same(o, b.outs[k]), `output ${k}`).toBe(true))
      expect(a.outs[0].some((v) => Number.isFinite(v) && v !== 0)).toBe(true)
    })
  }
})

describe('A2 — what stays refused, by name', () => {
  const refused = (body, re) => {
    const r = build(body)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:statement')
    expect(r.refusal.message).toMatch(re)
  }
  it('a name the reference does not list', () => {
    refused('var color c = na\nc := color.new(colour = color.red, transp = 50)\nbgcolor(c)\n', /a named argument `colour` on `color.new`/)
  })
  it('a parameter given twice', () => {
    refused('var color c = na\nc := color.new(color.red, color = color.blue)\nbgcolor(c)\n', /a named argument `color` on `color.new`/)
  })
  it('a positional argument after a named one', () => {
    refused('var a = array.new_float(size = 3, 1.5)\nplot(array.size(a))\n', /a named argument `size` on `array.new_float`/)
  })
  it('a parameter skipped before one that is given (no default is invented)', () => {
    refused('var color c = na\nc := color.rgb(red = 10, blue = 20)\nbgcolor(c)\n', /a named argument `red` on `color.rgb`/)
  })
})
