// app/src/components/chart/engine/__tests__/objectSeriesWindows.test.js
//
// ─── ⭐⭐ C11b — A `var` NUMERIC ARRAY KEPT AS A BOUNDED WINDOW, READ BY A DRAWING ──
//
// `arrayWindows.js` reads such an array as the series it is: slot j (newest
// first) is `ta.valuewhen(cond, value, j)`. Every expectation below is Pine's own
// array run by hand over the same bars (a JS array pushed, unshifted, popped and
// shifted exactly as the script says) — never our runtime's output read back.
// Each case goes through the MEMBER DOOR and the object runtime it feeds.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'

const N = 90
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + 12 * Math.sin(i / 7) + 5 * Math.sin(i / 2.3)
  const o = base + 2 * Math.sin(i * 1.7)
  const c = base + 2 * Math.cos(i * 1.3)
  return {
    t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    o, h: Math.max(o, c) + 1 + Math.abs(Math.sin(i * 0.9)) * 3, l: Math.min(o, c) - 1, c, v: 1e6,
  }
})
const Q = String.fromCharCode(34)
const HEAD = `//@version=5\nindicator(${Q}t${Q}, overlay=true, max_labels_count=500)\nplot(close)\n`

function run(body) {
  const d = memberPaneDefinition({ source: HEAD + body, id: 'u_c11b_win', name: 'c11b' })
  expect(d.ok, d.reason).toBe(true)
  const diag = d.translation.objectDiagnostics || {}
  const reader = objectReaderFor(d.definition, BARS, { tf: 'D', symbol: 'TEST' })
  if (!reader) return { diag, labels: [] }
  const r = evaluateObjects(reader.program, { barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t })
  return { diag, labels: r.live.filter((o) => o.family === 'label') }
}
const up = (i) => BARS[i].c > BARS[i].o

describe('⭐⭐ C11b — a bounded window is read as a series', () => {
  it('⭐ newest-in-front, one slot, filled through a FUNCTION (htf-liquidity\'s `update_arrays`)', () => {
    const { diag, labels } = run([
      'upd(o, h_arr, h) =>',
      '    if o > o[1]',
      '        h_arr.unshift(h[1])',
      '    if h_arr.size() > 1',
      '        h_arr.pop()',
      'var ph = array.new_float()',
      'upd(open, ph, high)',
      'if ph.size() > 0 and close > open',
      '    label.new(bar_index, ph.get(0), "p")',
    ].join('\n') + '\n')
    expect(diag.dropReasons || {}).toEqual({})
    // Pine by hand.
    const arr = []
    const pine = []
    BARS.forEach((b, i) => {
      if (i > 0 && b.o > BARS[i - 1].o) arr.unshift(BARS[i - 1].h)
      if (arr.length > 1) arr.pop()
      if (arr.length > 0 && up(i)) pine.push([i, arr[0]])
    })
    expect(pine.length).toBeGreaterThan(10)
    expect(labels.map((l) => [l.createdBar, l.props.y])).toEqual(pine)
  })

  it('⭐ newest-at-the-end, fixed length, `push` then `shift` — first / last / get(k)', () => {
    const { diag, labels } = run([
      'var w = array.new_float(3)',
      'if close > open',
      '    w.push(close)',
      '    w.shift()',
      'if not na(w.first())',
      '    label.new(bar_index, w.last(), str.tostring(w.get(0)) + "/" + str.tostring(w.get(1)))',
    ].join('\n') + '\n')
    expect(diag.dropReasons || {}).toEqual({})
    const arr = [NaN, NaN, NaN]
    const pine = []
    BARS.forEach((b, i) => {
      if (up(i)) { arr.push(b.c); arr.shift() }
      if (!Number.isNaN(arr[0])) pine.push([i, arr[2], arr[0], arr[1]])
    })
    expect(pine.length).toBeGreaterThan(10)
    expect(labels.map((l) => [l.createdBar, l.props.y])).toEqual(pine.map(([i, y]) => [i, y]))
    // The caption reads the same slots; compared as numbers (Pine's `str.tostring`
    // formatting is not what this rail is about).
    labels.forEach((l, k) => {
      const [a, b] = String(l.props.text).split('/').map(Number)
      expect(a).toBeCloseTo(pine[k][2], 6)
      expect(b).toBeCloseTo(pine[k][3], 6)
    })
  })

  it('⛔ a condition that is `na` on a bar is FALSE there (as Pine\'s `if` reads it), not a reset of the window', () => {
    const { labels } = run([
      'b = bar_index % 5 == 0 ? na : close > 0',
      'var w = array.new_float()',
      'if b and close > open',
      '    w.unshift(high)',
      'if w.size() > 2',
      '    w.pop()',
      'if w.size() > 1',
      '    label.new(bar_index, w.get(1), "x")',
    ].join('\n') + '\n')
    const arr = []
    const pine = []
    BARS.forEach((b, i) => {
      if (i % 5 !== 0 && b.c > b.o) arr.unshift(b.h)
      if (arr.length > 2) arr.pop()
      if (arr.length > 1) pine.push([i, arr[1]])
    })
    expect(pine.length).toBeGreaterThan(10)
    expect(labels.map((l) => [l.createdBar, l.props.y])).toEqual(pine)
  })

  it('⭐ a window capped by `if size > K` counts its slots as they fill', () => {
    const { labels } = run([
      'var w = array.new_float()',
      'if close > open',
      '    array.push(w, high)',
      'if array.size(w) > 4',
      '    array.shift(w)',
      'label.new(bar_index, low, str.tostring(array.size(w)))',
      'if w.size() >= 1',
      '    label.new(bar_index, w.last(), "n")',
    ].join('\n') + '\n')
    const arr = []
    const sizes = []
    const lasts = []
    BARS.forEach((b, i) => {
      if (up(i)) arr.push(b.h)
      if (arr.length > 4) arr.shift()
      sizes.push([i, String(arr.length)])
      if (arr.length >= 1) lasts.push([i, arr[arr.length - 1]])
    })
    const byText = labels.filter((l) => l.props.text !== 'n').map((l) => [l.createdBar, l.props.text])
    expect(byText).toEqual(sizes)
    expect(labels.filter((l) => l.props.text === 'n').map((l) => [l.createdBar, l.props.y])).toEqual(lasts)
  })

  it('⭐ a LIST OF DRAWINGS filled with `unshift` and evicted with `pop` keeps the newest two', () => {
    const d = memberPaneDefinition({
      source: HEAD + [
        'var ls = array.new_line()',
        'if close > open',
        '    ls.unshift(line.new(bar_index, high, bar_index + 1, high))',
        'if ls.size() > 2',
        '    line.delete(ls.pop())',
        'if ls.size() > 0',
        '    ls.get(0).set_x2(bar_index + 5)',
      ].join('\n') + '\n',
      id: 'u_c11b_unshift', name: 'c11b',
    })
    expect(d.ok, d.reason).toBe(true)
    expect(d.translation.objectDiagnostics.dropReasons || {}).toEqual({})
    const reader = objectReaderFor(d.definition, BARS, { tf: 'D', symbol: 'TEST' })
    const r = evaluateObjects(reader.program, { barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t })
    // Pine by hand: the list holds bar indices newest first; slot 0's x2 moves.
    const list = []
    const x2 = new Map()
    BARS.forEach((b, i) => {
      if (up(i)) { list.unshift(i); x2.set(i, i + 1) }
      if (list.length > 2) list.pop()
      if (list.length > 0) x2.set(list[0], i + 5)
    })
    const lines = r.live.filter((o) => o.family === 'line')
    expect(lines.map((l) => l.props.x1).sort((a, b) => a - b)).toEqual([...list].sort((a, b) => a - b))
    for (const l of lines) expect(l.props.x2, `line from bar ${l.props.x1}`).toBe(x2.get(l.props.x1))
  })

  describe('⛔ refused by name, never drawn from a guess', () => {
    const refusedWith = (body, want) => {
      const { labels, diag } = run(body)
      expect(labels, 'a drawing was made from an array this reader cannot follow').toEqual([])
      expect(diag.droppedOps).toBeGreaterThan(0)
      if (want) expect(JSON.stringify(diag)).toMatch(want)
    }
    it('two places that add', () => refusedWith([
      'var w = array.new_float()',
      'if close > open',
      '    w.unshift(high)',
      'if close < open',
      '    w.unshift(low)',
      'if w.size() > 1',
      '    w.pop()',
      'if w.size() > 0',
      '    label.new(bar_index, w.get(0), "x")',
    ].join('\n') + '\n'))
    it('a read BEFORE the last write', () => refusedWith([
      'var w = array.new_float()',
      'if close > open',
      '    w.push(high)',
      'if w.size() > 0',
      '    label.new(bar_index, w.last(), "x")',
      'if w.size() > 3',
      '    w.shift()',
    ].join('\n') + '\n'))
    it('a cap that is an input, not a number written into the script', () => refusedWith([
      'k = input.int(3, "k")',
      'var w = array.new_float()',
      'if close > open',
      '    w.push(high)',
      'if w.size() > k',
      '    w.shift()',
      'if w.size() > 0',
      '    label.new(bar_index, w.last(), "x")',
    ].join('\n') + '\n'))
    it('an index that moves as a growing window fills (`first` of a pushed window)', () => refusedWith([
      'var w = array.new_float()',
      'if close > open',
      '    w.push(high)',
      'if w.size() > 3',
      '    w.shift()',
      'if w.size() > 0',
      '    label.new(bar_index, w.first(), "x")',
    ].join('\n') + '\n'))
    it('a window shortened by ANOTHER array\'s length that is not filled in step with it', () => refusedWith([
      'upd(a, b) =>',
      '    if close > open',
      '        a.unshift(high)',
      '    if high > high[1]',
      '        b.unshift(low)',
      '    if a.size() > 1',
      '        a.pop()',
      '        b.pop()',
      'var wa = array.new_float()',
      'var wb = array.new_float()',
      'upd(wa, wb)',
      'if wb.size() > 0',
      '    label.new(bar_index, wb.get(0), "x")',
    ].join('\n') + '\n'))
    it('a reduction it does not fold (`max`)', () => refusedWith([
      'var w = array.new_float(3)',
      'if close > open',
      '    w.push(high)',
      '    w.shift()',
      'if not na(w.first())',
      '    label.new(bar_index, w.max(), "x")',
    ].join('\n') + '\n'))
  })
})
