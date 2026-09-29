// app/src/components/chart/engine/__tests__/objectLatchedGuards.test.js
//
// ─── C16 — AN `if` IS EVALUATED ONCE, WHERE IT STANDS ────────────────────────
//
// Pine evaluates an `if` condition once and then runs its block (or its `else`).
// The object program carried the condition on every op of the block and
// re-evaluated it per op — harmless for a pure condition, and WRONG for one that
// reads object state the block itself changes. Measured on institutional-smc:
//
//     if low < box.get_bottom(b)
//         box.delete(b)                 ← b is gone…
//         array.remove(bull_boxes, i)   ← …so `get_bottom(b)` is `na` here and
//                                         the remove never ran
//
// leaving a dead slot that later evicted a live zone TradingView still holds.
// A condition that reads object state is now LATCHED (`{k:'latch'}`), and every
// op of its block and of its `else` reads the one answer.
//
// ⭐ C16 also reads an `input.string` default as the text a drawing carries
// (there is no knob for it in this product); v4's `input(type=input.symbol)` is
// NOT a string input and stays unread.
//
// Every expectation is Pine run by hand over the same bars.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { translatePine } from '../ast/pine'

const N = 80
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + 10 * Math.sin(i / 5) + 4 * Math.sin(i / 1.7)
  const o = base + 2 * Math.sin(i * 1.9)
  const c = base + 2 * Math.cos(i * 1.4)
  return {
    t: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    o, c, h: Math.max(o, c) + 1.5, l: Math.min(o, c) - 1.5, v: 1e6,
  }
})
const Q = String.fromCharCode(34)
const H = (v = 6) => `//@version=${v}\nindicator(${Q}t${Q}, overlay=true, max_labels_count=500, max_boxes_count=500)\nplot(close)\n`

function run(source) {
  const d = memberPaneDefinition({ source, id: 'u_c16l', name: 'c16l' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, BARS, { inputs: undefined, tf: 'D', symbol: 'TEST' })
  const r = evaluateObjects(reader.program, {
    barCount: BARS.length, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return { d, r }
}
const labelsOf = (r) => r.live.filter((o) => o.family === 'label').map((o) => [o.props.x, o.props.text])

describe('⭐ C16 — a block that changes what its own condition reads', () => {
  const MAKE = 'var box z = na\nif close > open\n    z := box.new(bar_index, high, bar_index + 1, low, text="z")\n'

  it('the op AFTER a delete in the block still runs — the condition was read once, before it', () => {
    const { r } = run(H() + MAKE + [
      'if close < box.get_bottom(z)',
      '    box.delete(z)',
      `    label.new(bar_index, low, ${Q}gone${Q})`,
    ].join('\n') + '\n')
    // Pine by hand: z is (re)made on an up bar; a close under its bottom deletes it
    // and labels the bar; a deleted z reads `na`, so nothing fires until a new one.
    let z = null
    const want = []
    BARS.forEach((b, i) => {
      if (b.c > b.o) z = { bottom: b.l }
      if (z && b.c < z.bottom) { z = null; want.push([i, 'gone']) }
    })
    expect(want.length, 'the fixture must delete at least once').toBeGreaterThan(0)
    expect(labelsOf(r)).toEqual(want)
  })

  it('an `else` does not run on a bar its `if` ran — even when the `if` made the condition false', () => {
    const { r } = run(H() + MAKE + [
      'if close > box.get_top(z)',
      '    box.set_top(z, close + 1000)',
      'else',
      `    label.new(bar_index, high, ${Q}under${Q})`,
    ].join('\n') + '\n')
    let z = null
    const want = []
    BARS.forEach((b, i) => {
      if (b.c > b.o) z = { top: b.h }
      const top = z ? z.top : NaN
      if (z && b.c > top) z.top = b.c + 1000
      else if (z) want.push([i, 'under'])
    })
    // ⛔ The fixture's first bar is an up bar, so `z` holds a box on every bar and
    // the condition is never `na` — the one case where Pine's `else` and this
    // lane's `not` of a live condition are not the same question.
    expect(BARS[0].c > BARS[0].o).toBe(true)
    expect(want.length).toBeGreaterThan(0)
    expect(labelsOf(r)).toEqual(want)
  })
})

describe('⭐ C16 — an `input.string` default is the text a drawing carries', () => {
  it('`input.string` and a bare string `input` are read; the label carries the default', () => {
    const { r, d } = run(H() + [
      'cap = input.string("Order Block", "Caption")',
      'if close > open',
      '    label.new(bar_index, high, cap)',
    ].join('\n') + '\n')
    expect(d.translation.objectDiagnostics.dropReasons || {}).toEqual({})
    const ups = BARS.map((b, i) => (b.c > b.o ? i : null)).filter((i) => i !== null)
    expect(labelsOf(r)).toEqual(ups.map((i) => [i, 'Order Block']))
    const v4 = translatePine(H(4).replace('indicator(', 'study(') + [
      'cap = input(defval="Zone", title="Caption")',
      'if close > open',
      '    label.new(bar_index, high, cap)',
    ].join('\n') + '\n', { strict: true }).objectDiagnostics
    expect((v4.dropReasons || {})['create:label']).toBeUndefined()
  })

  it('⛔ v4 `input(type=input.symbol)` is not a string input — its label is not drawn', () => {
    const dg = translatePine(H(4).replace('indicator(', 'study(') + [
      'coin = input(defval="BINANCE:BTCUSDT", type=input.symbol, title="Ticker")',
      'if close > open',
      '    label.new(bar_index, high, coin)',
    ].join('\n') + '\n', { strict: true }).objectDiagnostics
    expect(dg.dropReasons['create:label']).toBe(1)
  })
})
