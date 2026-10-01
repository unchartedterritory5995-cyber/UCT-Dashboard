// app/src/components/chart/engine/__tests__/objectWindowWhileCap.test.js
//
// ─── ⭐⭐ C40 — A NUMERIC WINDOW CAPPED BY A `while` IS THE SAME WINDOW ────────
//
// C11b reads a `var` numeric array that one statement fills and a length check
// keeps short as the series it is (`arrayWindows.js`). The corpus writes that
// length check two ways:
//
//     if ups.size() > 4            while array.size(swingPrices) > maxSwingHistory
//         ups.shift()                  array.shift(swingPrices)        renderingnature
//                                      array.shift(swingBars)
//
// The second refused the whole window ("written inside `while`"), and the main
// walk replaced the array with an opaque `pine:collection` at the loop. A `while`
// whose body ONLY evicts — one element of each array per pass, the measured one
// among them — is the `if`'s eviction repeated until the length fits, and the
// model adds at most one element on a bar it serves, so it is the same window.
//
// ⛔ Nothing else inside a `while` is read, and the PLOT lane still refuses every
// read of the array (its writers are not modelled there).
//
// Every expectation is Pine's own arrays run by hand over the same bars.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const HEAD = `//@version=5${LF}indicator(${Q}w${Q}, overlay=true)${LF}`
const tr = (lines, tail = 'plot(close)') => translatePine(`${HEAD}${lines.join(LF)}${LF}${tail}${LF}`, {})

const N = 80
const BARS = Array.from({ length: N }, (_, i) => {
  const d = new Date(Date.UTC(2021, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  const c = 100 + 9 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7)
  const o = 100 + 9 * Math.sin((i - 1) / 5) + 2 * Math.cos(i / 2.1)
  return { t: d, o, h: Math.max(o, c) + 1 + (i % 5) * 0.25, l: Math.min(o, c) - 1 - (i % 3) * 0.5, c, v: 1 }
})
const up = (i) => BARS[i].c > BARS[i].o
const run = (t) => {
  const reader = t.objects ? objectReaderFor({ objects: t.objects }, BARS, { tf: 'D', newestBarIsForming: false }) : null
  if (!reader) return { live: [], stats: {}, status: null }
  return evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}
const textOf = (r) => r.live.filter((o) => o.family === 'label').map((o) => o.props.text)
const LABEL = (expr) => ['if barstate.islast', `    label.new(bar_index, high, ${expr})`]

describe('⭐⭐ C40 — `while a.size() > K` → `a.shift()` is the window\'s own cap', () => {
  const SRC = (kw, order) => [
    'var int[] ups = array.new_int()',
    'if close > open',
    order === 'unshift' ? '    ups.unshift(bar_index)' : '    ups.push(bar_index)',
    `${kw} ups.size() > 4`,
    order === 'unshift' ? '    ups.pop()' : '    ups.shift()',
    ...LABEL(`str.tostring(ups.get(0)) + ${Q}/${Q} + str.tostring(ups.get(3)) + ${Q}/${Q} + str.tostring(ups.size())`),
  ]
  const replay = (order) => {
    const a = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) { if (order === 'unshift') a.unshift(i); else a.push(i) }
      while (a.length > 4) { if (order === 'unshift') a.pop(); else a.shift() }
    }
    return `${a[0]}/${a[3]}/${a.length}`
  }
  for (const order of ['push', 'unshift']) {
    it(`${order} window: the label reads what Pine's array holds on the last bar`, () => {
      const t = tr(SRC('while', order))
      expect(t.objectDiagnostics.droppedOps).toBe(0)
      const r = run(t)
      expect(r.status).toBe(OBJECT_STATUS.OK)
      expect(textOf(r)).toEqual([replay(order)])
      // …and it is the `if` form's window, element for element
      expect(textOf(run(tr(SRC('if', order))))).toEqual([replay(order)])
    })
  }

  it('two arrays kept in step by one `while` (`array.shift(a)` / `array.shift(b)`)', () => {
    const t = tr([
      'var int[] at = array.new_int()',
      'var float[] px = array.new_float()',
      'if close > open',
      '    array.push(at, bar_index)',
      '    array.push(px, high)',
      'while array.size(at) > 3',
      '    array.shift(at)',
      '    array.shift(px)',
      ...LABEL(`str.tostring(array.get(at, 0)) + ${Q}@${Q} + str.tostring(array.get(px, 0), ${Q}#.00${Q})`),
    ])
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const at = []
    const px = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) { at.push(i); px.push(BARS[i].h) }
      while (at.length > 3) { at.shift(); px.shift() }
    }
    expect(textOf(run(t))).toEqual([`${at[0]}@${px[0].toFixed(2)}`])
  })
})

describe('⛔ C40 — what is still refused, by name', () => {
  it('a `while` body that does anything but evict keeps the window refused', () => {
    const t = tr([
      'var int[] ups = array.new_int()',
      'if close > open',
      '    ups.push(bar_index)',
      'while ups.size() > 4',
      '    ups.shift()',
      '    ups.set(0, 1)',
      ...LABEL('str.tostring(ups.get(0))'),
    ])
    expect(t.objects).toBeFalsy()
    expect(t.objectDiagnostics.dropReasons).toEqual({ 'create:label': 1 })
  })

  it('…as does a `while` that does not shorten the array it measures, or shortens one twice', () => {
    for (const body of [['    other.shift()'], ['    ups.shift()', '    ups.shift()']]) {
      const t = tr([
        'var int[] ups = array.new_int()',
        'var int[] other = array.new_int()',
        'if close > open',
        '    ups.push(bar_index)',
        '    other.push(bar_index)',
        'while ups.size() > 4',
        ...body,
        ...LABEL('str.tostring(ups.get(0))'),
      ])
      expect(t.objects).toBeFalsy()
      expect(t.objectDiagnostics.dropReasons).toEqual({ 'create:label': 1 })
    }
  })

  it('⛔ the PLOT lane still refuses every read of the array — nothing is folded off its creation', () => {
    const t = tr([
      'var int[] ups = array.new_int()',
      'if close > open',
      '    array.push(ups, bar_index)',
      'while array.size(ups) > 4',
      '    array.shift(ups)',
    ], `plot(array.size(ups) > 0 ? array.get(ups, 0) : na, ${Q}first${Q})`)
    expect(t.outputs).toHaveLength(1)
    expect(t.outputs[0].refusal).toBeTruthy()
    expect(t.outputs[0].refusal.guard).toBe('pine:collection')
    expect(t.outputs[0].refusal.message).toContain('`ups`')
  })
})
