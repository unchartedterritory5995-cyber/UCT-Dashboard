// app/src/components/chart/engine/ast/pine.c46MainWalkStepOver.test.js
//
// ─── C46 TRIAL — THE MAIN WALK STEPS OVER A LOOP INSIDE AN `if` CHAIN ────────
//
// ⛔⛔ THIS FILE LIVES ON THE TRIAL BRANCH ONLY (`pine/c46-stepover-trial`). The
// mechanism it rails is NOT on the lane branch: no committed vendor capture
// exercises it (the 47 and the committed harness dir, both flag states: 0
// entries changed), so by the lane brief it stays refused by name until the
// capture queued in `docs/pine/capture-queue-2026-10-01-loop-in-block.md` lands.
//
// What the trial does: a top-level `if` chain whose fold stops AT a loop is folded
// a second time, stepping over the loop (C31's rule: a loop's only effect on the
// names around it is what its body writes). The names the loop writes refuse; every
// other top-level name the chain writes folds as it would in a chain with no loop.
import { describe, it, expect } from 'vitest'
import { translatePine, printFormula } from './pine.js'

const HEAD = ['//@version=6', 'indicator("t", overlay=true)', 'plot(close, "real")']
const src = (...lines) => [...HEAD, ...lines].join('\n')
const out = (t, title) => (t.outputs || []).find((o) => o.title === title)
const served = (t, title) => { const o = out(t, title); return !!(o && !o.refusal && o.ast) }

describe('C46 trial — a chain that stopped at a loop is folded again, stepping over it', () => {
  it('⭐ a name the loop does not write folds as it does in a chain with no loop', () => {
    const withLoop = translatePine(src(
      'float m = 0.0', 'if close > open', '    for i = 0 to 9', '        x = i * 2', '    m := high - low', 'plot(m, "m")',
    ))
    const without = translatePine(src('float m = 0.0', 'if close > open', '    m := high - low', 'plot(m, "m")'))
    expect(served(without, 'm')).toBe(true)
    expect(served(withLoop, 'm')).toBe(true)
    expect(printFormula(out(withLoop, 'm').ast)).toBe(printFormula(out(without, 'm').ast))
  })

  it('⛔⛔ a name the loop WRITES refuses, by the sentence the loop gives it', () => {
    const t = translatePine(src(
      'float m = 0.0', 'float acc = 0.0', 'if close > open', '    for i = 0 to 9', '        acc := acc + close[i]', '    m := high - low',
      'plot(acc, "acc")', 'plot(m, "m")',
    ))
    // a refused output carries no title: it is the second output, by position
    expect(t.outputs[1].refusal.guard).toBe('pine:reassign')
    expect(t.outputs[1].refusal.message).toMatch(/`acc` — a running total built inside a `for`/)
    expect(served(t, 'm')).toBe(true)
  })

  it('⛔ a name derived from what the loop writes refuses too', () => {
    const t = translatePine(src(
      'float m = 0.0', 'float acc = 0.0', 'if close > open', '    for i = 0 to 9', '        acc := acc + close[i]', '    m := acc / 10',
      'plot(m, "m")',
    ))
    expect(t.outputs[1].refusal.guard).toBe('pine:reassign')
    expect(t.outputs[1].refusal.message).toMatch(/`acc`/)
  })

  it('a drawing call in the chain does not stop the second fold (measured, not designed)', () => {
    const t = translatePine(src(
      'float m = 0.0', 'if close > open', '    for i = 0 to 9', '        x = i * 2', '    m := high - low',
      '    label.new(bar_index, high, "x")', 'plot(m, "m")',
    ))
    expect(printFormula(out(t, 'm').ast)).toBe('close > open ? high - low : 0')
  })

  it('⛔⛔ an input only the stepped chain reaches gains a SOURCE id; none moves', () => {
    const lines = [
      'a = input.int(5, "A")', 'b = input.int(7, "B")',
      'float m = 0.0', 'if close > open', '    for i = 0 to 9', '        x = i * 2', '    m := ta.sma(close, a)',
      'plot(m, "m")', 'plot(ta.sma(close, b), "b")',
    ]
    const t = translatePine(src(...lines), { strict: true, paramManifest: true })
    expect(t.inputParams.map((p) => [p.id, p.sourceName])).toEqual([['__uct_param_1001', 'a'], ['__uct_param_1002', 'b']])
    // refuse the chain (as the lane branch does) and `b` is where it was
    const refused = translatePine(src(...lines), { strict: true, paramManifest: true, testRefuseBlock: () => true })
    expect(refused.inputParams.map((p) => [p.id, p.sourceName])).toEqual([['__uct_param_1002', 'b']])
  })
})
