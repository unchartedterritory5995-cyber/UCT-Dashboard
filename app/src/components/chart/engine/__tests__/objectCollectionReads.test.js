// app/src/components/chart/engine/__tests__/objectCollectionReads.test.js
//
// ─── ⭐⭐ C16 — A SCRIPT THAT EDITS ITS OWN LIST OF DRAWINGS ─────────────────
//
// The corpus keeps drawings in `array<box>`/`array<line>` and edits that list as
// it runs. Three shapes carry almost all of it:
//
//   · bounded eviction   `if array.size(rays) > maxRays`
//                            `line.delete(array.shift(rays))`   (rsi-horizontal)
//   · a mitigation loop  `for i = array.size(bs) - 1 to 0`
//                            `box b = array.get(bs, i)`
//                            `if low < box.get_bottom(b)`
//                                `box.delete(b)` / `array.remove(bs, i)`
//                            `else` `box.set_right(b, bar_index + 8)`  (institutional-smc)
//   · clear-all          `for i = 0 to array.size(bs) - 1` `box.delete(array.get(bs, i))`
//
// Every expectation below is Pine's rule run by hand in plain JavaScript over the
// same bars — never our runtime's own output read back (`lesson_gate_that_cannot_fail`).
// Each case goes through the MEMBER DOOR (`memberPaneDefinition`) and the object
// runtime it feeds, so what is tested is what a member's chart runs.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { translatePine } from '../ast/pine'

const N = 120
/** Deterministic, uneven bars, rising steeply over the last 30 so the
 *  mitigation fixture creates 8 zones, evicts 4 past its cap of 3, mitigates 1
 *  and ends holding 3 — every branch of the loop, measured by the model below. */
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + 12 * Math.sin(i / 7) + 5 * Math.sin(i / 2.3) + (i > 90 ? 4 * (i - 90) : 0)
  const o = base + 2 * Math.sin(i * 1.7)
  const c = base + 2 * Math.cos(i * 1.3)
  const h = Math.max(o, c) + 1 + Math.abs(Math.sin(i * 0.9)) * 3
  const l = Math.min(o, c) - 1 - Math.abs(Math.cos(i * 1.1)) * 3
  return { t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), o, h, l, c, v: 1e6 + i }
})
const Q = String.fromCharCode(34)
const H = (extra = '') => `//@version=6\nindicator(${Q}t${Q}, overlay=true, max_lines_count=500, max_boxes_count=500${extra})\nplot(close)\n`

function run(source) {
  const d = memberPaneDefinition({ source, id: 'u_c16', name: 'c16' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, BARS, { inputs: undefined, tf: 'D', symbol: 'TEST' })
  expect(reader, 'objectReaderFor returned null').toBeTruthy()
  const r = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return { d, r, diag: d.translation.objectDiagnostics || {} }
}
const diagOf = (source) => translatePine(source, { strict: true }).objectDiagnostics || {}

describe('⭐ C16 — bounded eviction: `if array.size(rays) > N` + `line.delete(array.shift(rays))`', () => {
  const SRC = H() + [
    'var array<line> rays = array.new<line>()',
    'if close > open',
    '    array.push(rays, line.new(bar_index, close, bar_index + 1, close))',
    'if array.size(rays) > 4',
    '    line.delete(array.shift(rays))',
  ].join('\n') + '\n'

  it('is carried whole — no drop — and holds exactly the lines Pine holds', () => {
    const { r, diag } = run(SRC)
    expect(diag.dropReasons || {}).toEqual({})
    // Pine by hand: every up bar pushes a line; past 4 the oldest is deleted.
    const held = []
    BARS.forEach((b, i) => {
      if (b.c > b.o) held.push(i)
      if (held.length > 4) held.shift()
    })
    const lines = r.live.filter((o) => o.family === 'line').map((o) => o.props.x1)
    expect(lines).toEqual(held)
    expect(held.length).toBe(4)
  })

  it('⭐ the method spellings read the same: `rays.size()` and `rays.shift().delete()`', () => {
    const a = run(SRC).r.live.map((o) => o.props.x1)
    const b = run(H() + [
      'var array<line> rays = array.new<line>()',
      'if close > open',
      '    rays.push(line.new(bar_index, close, bar_index + 1, close))',
      'if rays.size() > 4',
      '    rays.shift().delete()',
    ].join('\n') + '\n').r.live.map((o) => o.props.x1)
    expect(b).toEqual(a)
  })

  it('⭐ `array.pop` takes the LAST slot — the newest line goes, not the oldest', () => {
    const { r, diag } = run(H() + [
      'var array<line> rays = array.new<line>()',
      'if close > open',
      '    array.push(rays, line.new(bar_index, close, bar_index + 1, close))',
      'if array.size(rays) > 4',
      '    line.delete(array.pop(rays))',
    ].join('\n') + '\n')
    expect(diag.dropReasons || {}).toEqual({})
    const held = []
    BARS.forEach((b, i) => {
      if (b.c > b.o) held.push(i)
      if (held.length > 4) held.pop()
    })
    expect(r.live.map((o) => o.props.x1)).toEqual(held)
  })
})

describe('⭐ C16 — the mitigation loop (institutional-smc, lines 132–149)', () => {
  const SRC = H() + [
    'var box[] bull_boxes = array.new_box()',
    'is_bull_fvg = low > high[2] and close > open',
    'if is_bull_fvg',
    '    if array.size(bull_boxes) >= 3',
    '        box.delete(array.shift(bull_boxes))',
    '    box b = box.new(left=bar_index - 2, top=low, right=bar_index + 10, bottom=high[2], text="OB")',
    '    array.push(bull_boxes, b)',
    'if array.size(bull_boxes) > 0',
    '    for i = array.size(bull_boxes) - 1 to 0',
    '        box b = array.get(bull_boxes, i)',
    '        if low < box.get_bottom(b)',
    '            box.delete(b)',
    '            array.remove(bull_boxes, i)',
    '        else',
    '            box.set_right(b, bar_index + 8)',
  ].join('\n') + '\n'

  /** Pine by hand: a deleted box's slot stays in the array until the script
   *  removes it — which this script always does in the same breath. */
  function model() {
    const live = new Map()
    const arr = []
    let id = 0
    BARS.forEach((b, i) => {
      if (i >= 2 && b.l > BARS[i - 2].h && b.c > b.o) {
        if (arr.length >= 3) live.delete(arr.shift())
        id += 1
        live.set(id, { left: i - 2, top: b.l, bottom: BARS[i - 2].h, right: i + 10 })
        arr.push(id)
      }
      if (arr.length > 0) {
        for (let k = arr.length - 1; k >= 0; k -= 1) {
          const bx = live.get(arr[k])
          if (bx && b.l < bx.bottom) {
            live.delete(arr[k])
            arr.splice(k, 1)
          } else if (bx) {
            bx.right = i + 8
          }
        }
      }
    })
    return [...live.values()]
  }

  it('is carried whole, and every box — left, top, bottom and the right the loop moved — is Pine\'s', () => {
    const { r, diag } = run(SRC)
    expect(diag.dropReasons || {}).toEqual({})
    const want = model()
    expect(want.length, 'the fixture must end holding zones').toBe(3)
    const got = r.live.filter((o) => o.family === 'box')
      .map((o) => ({ left: o.props.left, top: o.props.top, bottom: o.props.bottom, right: o.props.right }))
    expect(got).toEqual(want)
  })

  it('⛔ a loop whose END bound reads a length the body changes is refused — v6 re-reads `to`', () => {
    const dg = diagOf(H() + [
      'var box[] bs = array.new_box()',
      'if close > open',
      '    array.push(bs, box.new(bar_index, high, bar_index + 1, low))',
      'if array.size(bs) > 0',
      '    for i = 0 to array.size(bs) - 1',
      '        if low < box.get_bottom(array.get(bs, 0))',
      '            array.remove(bs, 0)',
    ].join('\n') + '\n')
    expect(dg.dropReasons['loop:bounds']).toBe(1)
  })
})

describe('⛔ C16 — a list that lost a change is never read', () => {
  it('a push this chart cannot guard diverges the list: its length and slots are withheld, and the delete is a lost removal', () => {
    const dg = diagOf(H() + [
      'var array<line> rays = array.new<line>()',
      'var float[] xs = array.new_float()',
      'array.push(xs, close)',
      'if array.size(xs) > 3',
      '    array.push(rays, line.new(bar_index, close, bar_index + 1, close))',
      'if array.size(rays) > 4',
      '    line.delete(array.shift(rays))',
    ].join('\n') + '\n')
    expect(dg.dropReasons['guard:coll_push']).toBe(1)
    expect(dg.dropReasons['coll:diverged']).toBeGreaterThanOrEqual(2)
    expect(dg.lostRemovals.some((x) => x.via === 'coll:diverged' && x.family === 'line')).toBe(true)
  })

  it('⛔ CONTROL — the same script with a readable push reads its list', () => {
    const dg = diagOf(H() + [
      'var array<line> rays = array.new<line>()',
      'if close > open',
      '    array.push(rays, line.new(bar_index, close, bar_index + 1, close))',
      'if array.size(rays) > 4',
      '    line.delete(array.shift(rays))',
    ].join('\n') + '\n')
    expect((dg.dropReasons || {})['coll:diverged']).toBeUndefined()
  })

  it('⛔ a script\'s OWN `size` method is not read as the length', () => {
    const body = [
      'var array<line> rays = array.new<line>()',
      'if close > open',
      '    array.push(rays, line.new(bar_index, close, bar_index + 1, close))',
      'if rays.size() > 4',
      '    line.delete(array.shift(rays))',
    ].join('\n') + '\n'
    const lengthRead = (src) => JSON.stringify(translatePine(src, { strict: true }).objects || null).includes('"v":"size"')
    expect(lengthRead(H() + 'method size(array<line> a) => 2\n' + body)).toBe(false)
    // ⛔ CONTROL — without the script's own method the same line IS the length
    expect(lengthRead(H() + body)).toBe(true)
  })
})
