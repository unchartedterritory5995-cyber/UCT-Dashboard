// app/src/components/chart/engine/ast/objectElseChain.test.js
//
// ─── ⛔⛔ C22 (H14) — AN `else` ARM RUNS ONLY WHEN EVERY ARM ABOVE IT WAS FALSE ─
//
//     if c1
//         label.new(…, "A")
//     else if c2
//         label.new(…, "B")
//     else
//         label.new(…, "C")
//
// The object reader carried only the LAST condition's negation into each later
// arm: the bare `else` above read `not c2`, so on a bar where `c1` and `c3` both
// held it drew arm ONE and arm THREE. ⚰️ MEASURED on NYSE:RDDT 1D bars 401–631
// (`close > open` / `close > close[1]`): the `else` label on 124 bars where Pine
// draws it on 107 — live on the objects pane, with a clean drop ledger. The
// value lane folded the same chain right (a nested ternary); only the object
// guards had drifted. `pineObjects.js`'s `else` branch is the rule.
//
// ⭐ The oracle is a Pine replay written here, bar by bar, over synthetic bars
// whose conditions overlap on purpose (every combination of c1, c2, c3 occurs).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'

const LF = String.fromCharCode(10)

/** 120 daily bars; open/close move on three co-prime periods so every
 *  combination of the chain's conditions appears. */
function synthBars(n = 120) {
  const out = []
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    const c = 100 + 5 * Math.sin(i / 3) + 3 * Math.cos(i / 7) + (i % 5)
    const o = 100 + 4 * Math.cos(i / 4) + (i % 3)
    out.push({ t: d, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 + i })
  }
  return out
}

function drawn(source, bars) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const d = memberPaneDefinition({ source, id: 'u_else_chain', name: 'chain' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, { tf: 'D', symbol: { ticker: 'SYN', exchange: 'NYSE' } })
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  expect(run.status).toBe('ok')
  const got = {}
  for (const o of run.live) if (o.family === 'label') got[o.props.text] = (got[o.props.text] || 0) + 1
  return got
}

const script = (...arms) => ['//@version=5', 'indicator("chain", overlay=true, max_labels_count=500)', 'plot(close)',
  ...arms].join(LF)

describe('⛔⛔ C22 — each later arm of an if/else-if chain negates EVERY earlier condition', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  const bars = synthBars()
  const c1 = (i) => bars[i].c > bars[i].o
  const c2 = (i) => i > 0 && bars[i].c > bars[i - 1].c
  const c3 = (i) => bars[i].c > 103

  it('if / else if / else — the bare `else` is not(c1) and not(c2)', () => {
    const got = drawn(script(
      'if close > open',
      '    label.new(bar_index, high, "A")',
      'else if close > close[1]',
      '    label.new(bar_index, high, "B")',
      'else',
      '    label.new(bar_index, low, "C")',
    ), bars)
    const want = { A: 0, B: 0, C: 0 }
    for (let i = 0; i < bars.length; i += 1) {
      if (c1(i)) want.A += 1
      else if (c2(i)) want.B += 1
      else want.C += 1
    }
    expect(got).toEqual(want)
  })

  it('if / else if / else if / else — the third arm is not(c1) and not(c2) and c3', () => {
    const got = drawn(script(
      'if close > open',
      '    label.new(bar_index, high, "A")',
      'else if close > close[1]',
      '    label.new(bar_index, high, "B")',
      'else if close > 103',
      '    label.new(bar_index, high, "C")',
      'else',
      '    label.new(bar_index, low, "D")',
    ), bars)
    const want = { A: 0, B: 0, C: 0, D: 0 }
    for (let i = 0; i < bars.length; i += 1) {
      if (c1(i)) want.A += 1
      else if (c2(i)) want.B += 1
      else if (c3(i)) want.C += 1
      else want.D += 1
    }
    expect(got).toEqual(want)
    // non-vacuity: the fixture really has bars where c1 and a later arm's own
    // condition hold together — the case the defect drew twice
    expect(bars.some((b, i) => c1(i) && !c2(i) && c3(i))).toBe(true)
    expect(bars.some((b, i) => c1(i) && c2(i))).toBe(true)
  })

  it('CONTROL — a two-arm chain was already right and is unchanged', () => {
    const got = drawn(script(
      'if close > open',
      '    label.new(bar_index, high, "A")',
      'else',
      '    label.new(bar_index, low, "B")',
    ), bars)
    const want = { A: 0, B: 0 }
    for (let i = 0; i < bars.length; i += 1) { if (c1(i)) want.A += 1; else want.B += 1 }
    expect(got).toEqual(want)
  })
})
