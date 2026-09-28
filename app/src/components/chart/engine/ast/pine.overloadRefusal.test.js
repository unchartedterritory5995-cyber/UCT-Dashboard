// app/src/components/chart/engine/ast/pine.overloadRefusal.test.js
//
// ─── ⛔⛔ H14 — A FUNCTION DEFINED TWICE REFUSES; IT NEVER PICKS A BODY ────────
//
// Pine resolves same-named functions by the TYPES of their arguments. This engine
// keys a function by its NAME, so a second definition silently replaced the first
// for every call. ⚰️ Measured on production `1f4d7a309`:
//
//     f(int x) => x * 10
//     f(float x) => x + 1
//     plot(f(bar_index))      → translated to `barindex + 1`   (TradingView: bar_index * 10)
//
// A wrong number, drawn without a word. Until type-directed resolution exists the
// name refuses by name — but only where it is USED, so a script that merely
// defines an overload is not over-refused.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const script = (...lines) => ['//@version=5', 'indicator("t", overlay=true)', ...lines, ''].join('\n')
const run = (...lines) => translatePine(script(...lines))

describe('an overloaded user function refuses by name', () => {
  it('⭐ the measured case: same arity, different parameter types, refuses instead of drawing the wrong body', () => {
    const out = run('f(int x) => x * 10', 'f(float x) => x + 1', 'plot(f(bar_index))')
    expect(out.ok, out.ok ? out.outputs[out.selected].formula : '').toBe(false)
    expect(out.refusal.guard).toBe('pine:function-def')
    expect(out.refusal.message).toMatch(/`f` is defined more than once \(an overload\)/)
  })

  it('⭐ order does not matter — neither body wins', () => {
    const out = run('f(float x) => x + 1', 'f(int x) => x * 10', 'plot(f(close))')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function-def')
  })

  it('⭐ a first definition that REFUSED cannot be replaced by a later one that folds', () => {
    // The first body refuses (a per-bar memory this grammar has no node for); the
    // old code let the second definition overwrite the refusal and answer calls.
    const out = run('f(x, y) => fixnan(x)', 'f(x, y) => x + y', 'plot(f(close, open))')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function-def')
    expect(out.refusal.message).toMatch(/overload/)
  })

  it('⭐ an arity overload refuses as an overload too (it used to refuse against whichever body won)', () => {
    const out = run('f(x) => x * 10', 'f(x, y) => x + y', 'plot(f(close))')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function-def')
    expect(out.refusal.message).toMatch(/overload/)
  })

  it('⛔ an overload that is defined and never called costs nothing', () => {
    const out = run('f(int x) => x * 10', 'f(float x) => x + 1', 'plot(close)')
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close')
  })

  it('⛔ CONTROL: one definition still folds, so the guard is not refusing every function', () => {
    const out = run('f(x) => x * 10', 'plot(f(bar_index))')
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('barindex * 10')
  })

  it('⛔ CONTROL: two DIFFERENT function names are not an overload', () => {
    const out = run('f(x) => x * 10', 'g(x) => x + 1', 'plot(f(bar_index) + g(close))')
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
  })

  // A row's formula is `source`; read through ONE helper so the control below
  // proves the read can see a drawn row (a wrong field name would pass vacuously).
  const drawnSources = (source) => {
    const d = memberPaneDefinition({ source, id: 'u_ovl', name: 'ovl' })
    return d.ok ? (d.rows || []).filter((r) => !r.hidden).map((r) => r.source) : []
  }

  it('⛔ CONTROL: the member door draws a single-definition function, and the read sees it', () => {
    expect(drawnSources(script('f(x) => x * 10', 'plot(f(close), title="one")'))).toEqual(['close * 10'])
  })

  it('⭐ the member door draws NO row from the overload — never the wrong body', () => {
    const drawn = drawnSources(script('f(int x) => x * 10', 'f(float x) => x + 1',
      'plot(f(close), title="flt")', 'plot(f(bar_index), title="int")'))
    expect(drawn).toEqual([])
  })
})
