import { describe, it, expect } from 'vitest'

import { translatePine, blockStatements, lexPine } from './pine.js'

/**
 * ⭐⭐ RT12 — a comma line whose segments are a binding (or a `:=`) and CALLS.
 *
 * Pine runs `a = x, f(y)` as the two statements written on two lines, left to
 * right (H2's rule, `h2CommaStatements.test.js`). `blockStatements` split a comma
 * line only when every segment bound or mutated a name, so two corpus lines
 * reached the translators whole:
 *
 *     Prev = highest(high-Mult*atr(Atr),Hhv),barssince(close>highest(…) and …)
 *                                       — atr-trailing-stoploss-strategy:12
 *     color colorout = out > sig ? greencolor : redcolor,
 *     plot(out, "…", color = colorout, linewidth = 3)
 *                                       — nonlinear-regression-zero-lag-moving-average-loxx:93
 *
 * (the second line's trailing `,` carries the next line's `plot` into the same
 * statement — `danglesIntoNextLine`). Both refused `pine:statement` at the comma.
 *
 * Checked the strongest way available: the comma form translates to EXACTLY what
 * the same statements on separate lines translate to.
 */
const src = (body, v = 5) => `//@version=${v}\n${v >= 5 ? 'indicator' : 'study'}("t")\n${body}\n`

const shapeOf = (out) => JSON.stringify({
  refusal: out.refusal && out.refusal.guard,
  outputs: (out.outputs || []).map((o) => ({
    title: o.title, kind: o.kind, ast: o.ast || null, refusal: o.refusal && o.refusal.guard,
  })),
})

const same = (comma, lines, v = 5) => {
  const a = translatePine(src(comma, v))
  const b = translatePine(src(lines, v))
  expect(shapeOf(a)).toBe(shapeOf(b))
  return a
}

const headersOf = (body) => {
  const { tokens, indents } = lexPine(src(body))
  return blockStatements(tokens, indents, 0).map((s) => s.header.map((t) => t.value).join(' '))
    .filter((h) => !h.startsWith('indicator'))
}

describe('RT12 — a binding and a call on one comma line are the two statements', () => {
  it('⭐ a binding then a discarded value call (atr-trailing-stoploss-strategy:12, v4 bare names)', () => {
    const out = same(
      'Prev = highest(high - 2.5 * atr(5), 10), barssince(close > highest(high, 10) and close > close[1])\nplot(Prev)',
      'Prev = highest(high - 2.5 * atr(5), 10)\nbarssince(close > highest(high, 10) and close > close[1])\nplot(Prev)', 4)
    expect(out.refusal).toBeFalsy()
    expect(out.outputs.filter((o) => o.kind === 'plot' && !o.refusal).length).toBe(1)
  })

  it('⭐ a binding whose trailing comma carries the next line\'s `plot` (loxx:93-94)', () => {
    const out = same(
      'float out = ta.sma(close, 3)\ncolor c = out > out[1] ? color.green : color.red,\nplot(out, "o", color = c)',
      'float out = ta.sma(close, 3)\ncolor c = out > out[1] ? color.green : color.red\nplot(out, "o", color = c)')
    expect(out.outputs.filter((o) => o.kind === 'plot' && !o.refusal).length).toBe(1)
  })

  it('a `:=` and a call, and a call between two bindings, split in order', () => {
    expect(headersOf('var float a = 0.0\na := a + 1, plot(a)'))
      .toEqual(['var float a = 0', 'a := a + 1', 'plot ( a )'])
    expect(headersOf('a = close, plot(a), b = open'))
      .toEqual(['a = close', 'plot ( a )', 'b = open'])
  })

  it('control: a line of calls only stays whole (the `screener(a), screener(b)` idiom)', () => {
    expect(headersOf('plot(close), plot(open)')).toEqual(['plot ( close ) , plot ( open )'])
  })

  it('control: a segment that is neither a binding nor a single call keeps the line whole', () => {
    expect(headersOf('a = close, close + 1')).toEqual(['a = close , close + 1'])
    expect(headersOf('a = close, plot(a) + 1')).toEqual(['a = close , plot ( a ) + 1'])
  })

  it('control: a trailing comma with nothing after it at the end of the script is not split', () => {
    const { tokens, indents } = lexPine('//@version=5\nindicator("t")\na = close,')
    const hs = blockStatements(tokens, indents, 0).map((s) => s.header.map((t) => t.value).join(' '))
    expect(hs[hs.length - 1]).toBe('a = close ,')
  })
})

describe('RT12 — `switch` arms written with a trailing comma (smart-money-breakouts-chartprime:78)', () => {
  it('⭐ the arms are the arms written without commas', () => {
    const out = same(
      'm = input.string("Dotted", "m", ["Dashed", "Dotted", "Solid"])\nv = switch m\n    "Dashed" => 1 ,\n    "Dotted" => 2 ,\n    => 3\nplot(v)',
      'm = input.string("Dotted", "m", ["Dashed", "Dotted", "Solid"])\nv = switch m\n    "Dashed" => 1\n    "Dotted" => 2\n    => 3\nplot(v)')
    // non-vacuity: the switch's plot is read (the joined arms refused the line)
    expect(out.outputs.filter((o) => o.kind === 'plot').length).toBe(1)
    same(
      'm = input.string("Dotted", "m", ["Dashed", "Dotted", "Solid"])\nv = switch m\n    "Dashed" => 1 ,\n    => 3\nplot(v)',
      'm = input.string("Dotted", "m", ["Dashed", "Dotted", "Solid"])\nv = switch m\n    "Dashed" => 1\n    => 3\nplot(v)')
  })

  it('⭐ the arm headers split, the dangling comma after the last arm dropped', () => {
    const { tokens, indents } = lexPine(src('v = switch close > open\n    true => 1 ,\n    => 2 ,'))
    const sw = blockStatements(tokens, indents, 0).find((s) => s.header[0].value === 'v')
    expect(sw.sub.map((s) => s.header.map((t) => t.value).join(' '))).toEqual(['true => 1', '=> 2'])
  })

  it('control: at the TOP level a `=>` is a definition, and the line is not split as arms', () => {
    expect(headersOf('f(x) => x + 1, g(y) => y')).toEqual(['f ( x ) => x + 1 , g ( y ) => y'])
  })
})
