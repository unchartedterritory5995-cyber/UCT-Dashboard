// app/src/components/chart/engine/ast/arrayUnmodelledWrites.test.js
//
// ─── ⛔⛔ H14 — AN ARRAY WRITE THE HOST LANE DOES NOT MODEL REFUSES THE READ ───
//
// Measured on production `9b28d4fa4`, 2026-09-27: the plan-time vector folded
// every read to the slots it held at CREATION, and the walk dropped writes it did
// not model without a word. The member door accepted each script below and drew
// `close - 0` (or `close - 1`) where TradingView draws the written value:
//
//   · a write inside an `if` — name form, method form, and `x = if …`
//   · a write inside a user function, to a global or to the array it is handed
//   · a top-level write read through an intermediate binding (the 2026-09-23
//     closing-pass guard caught only a DIRECT read, because a binding snapshots
//     the environment before that pass runs)
//
// Every case drives the shipped door (`translatePine`, and `memberPaneDefinition`
// for the member-facing half) and compares what a member would get.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const HEAD = '//@version=5\nindicator("t")\n'
const translate = (body) => translatePine(`${HEAD}${body}`)
const door = (body) => memberPaneDefinition({ source: `${HEAD}${body}`, id: 'u_t', name: 't' })
const formulas = (body) => {
  const t = translate(body)
  expect(t.ok, t.ok ? '' : `${t.refusal && t.refusal.guard}: ${t.refusal && t.refusal.message}`).toBe(true)
  return t.outputs.map((o) => o.formula)
}

/** Each shape drew a wrong line on production. It must now refuse by name, at
 *  the WRITE's line, and the member door must refuse it too. */
const REFUSED = {
  'a write inside an `if`': [
    'var a = array.new_float(1, 0.0)\nif close > open\n    array.set(a, 0, close)\nplot(close - array.get(a, 0), "x")\n', 5],
  'a method-form write inside an `if`': [
    'var a = array.new_float(1, 0.0)\nif close > open\n    a.set(0, close)\nplot(close - array.get(a, 0), "x")\n', 5],
  'a `push` inside an `if`, read by `array.size`': [
    'var a = array.new_float(0)\nif close > open\n    array.push(a, close)\nplot(close - array.size(a), "x")\n', 5],
  'a `clear` inside an `if`, read by `array.size`': [
    'var a = array.new_float(1, 5.0)\nif close > open\n    array.clear(a)\nplot(close - array.size(a), "x")\n', 5],
  'a write inside `x = if …`': [
    'a = array.new_float(1, 0.0)\nx = if close > open\n    array.set(a, 0, close)\n    1\nelse\n    2\nplot(close - array.get(a, 0) + x, "x")\n', 5],
  'a user function writing the array it is handed': [
    'f(arr) =>\n    array.set(arr, 0, close)\n    0\na = array.new_float(1, 0.0)\nf(a)\nplot(close - array.get(a, 0), "x")\n', 7],
  'a user function with a TYPED array parameter': [
    'f(float[] arr) =>\n    array.set(arr, 0, close)\n    0\na = array.new_float(1, 0.0)\nf(a)\nplot(close - array.get(a, 0), "x")\n', 7],
  'a user function writing a global array': [
    'a = array.new_float(1, 0.0)\nf() =>\n    array.set(a, 0, close)\n    0\nf()\nplot(close - array.get(a, 0), "x")\n', 5],
  'a top-level write read through a binding': [
    'a = array.new_float(1, 0.0)\narray.set(a, 0, close)\ny = array.get(a, 0)\nplot(close - y, "x")\n', 4],
  'a `var` array read BEFORE a later conditional write': [
    'var a = array.new_float(1, 0.0)\ny = array.get(a, 0)\nif close > open\n    array.set(a, 0, close)\nplot(close - y, "x")\n', 6],
}

describe('⛔⛔ H14 — a write the host lane does not model refuses the read', () => {
  for (const [shape, [body, line]] of Object.entries(REFUSED)) {
    it(`⛔ ${shape} — refuses \`pine:collection\` at line ${line}, and the door refuses it`, () => {
      const t = translate(body)
      expect(t.ok).toBe(false)
      const r = t.refusal || (t.outputs[0] && t.outputs[0].refusal)
      expect(r && r.guard).toBe('pine:collection')
      expect(r.line).toBe(line)
      expect(r.message).toMatch(/`a` is written at line \d+ by a statement this lane does not model/)
      const d = door(body)
      expect(d.ok).toBe(false)
      expect(d.guard).toBe('pine:collection')
    })
  }
})

describe('⭐ CONTROLS — what the lane DOES model still translates', () => {
  it('⭐ an unrollable top-level `for` that fills the array is modelled, not refused', () => {
    expect(formulas('a = array.new_float(2, 0.0)\nfor i = 0 to 1\n    array.set(a, i, close[i])\n'
      + 'y = array.get(a, 1)\nplot(close - y, "x")\n')).toEqual(['close - close[1]'])
  })

  it('⭐ an array nothing writes reads its creation value', () => {
    expect(formulas('a = array.new_float(3, 5.0)\nplot(close * array.get(a, 2), "x")\n'))
      .toEqual(['close * 5'])
  })

  it('⭐ `array.size` survives a `set`, which cannot change the size', () => {
    expect(formulas('a = array.new_float(3, 0.0)\nif close > open\n    array.set(a, 0, close)\n'
      + 'plot(close * array.size(a), "x")\n')).toEqual(['close * 3'])
  })

  it('⭐ a scalar written inside an `if` still folds (the recurrence path is untouched)', () => {
    expect(formulas('var float s = 0.0\nif close > open\n    s := close\nplot(close - s, "x")\n'))
      .toEqual(['close - accum(0, close > open ? close : self, 250)'])
  })

  it('⭐ a function that writes ONLY its own local array does not taint a caller\'s array', () => {
    expect(formulas('f(x) =>\n    tmp = array.new_float(1, 0.0)\n    array.set(tmp, 0, x)\n    x\n'
      + 'a = array.new_float(1, 2.0)\nz = f(close)\nplot(z * array.get(a, 0), "x")\n'))
      .toEqual(['close * 2'])
  })
})
