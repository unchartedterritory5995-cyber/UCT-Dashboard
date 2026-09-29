// app/src/components/chart/engine/ast/pineColourHelperReturn.test.js
//
// ─── A USER COLOUR HELPER RETURNS ITS LAST STATEMENT — AND ITS RULE IS CARRIED ─
//
// Measured against TradingView (vendor harness, NYSE:RDDT 1D, 2026-09-28):
// Madrid Moving Average Ribbon colours all eighteen lines through
//
//     maColor(_ma, _maRef) =>
//         diffMA = change(_ma)
//         macol = diffMA>=0 and _ma>_maRef ? LIME : … : GRAY
//
// and every one drew in the pane's gold where TradingView drew lime/maroon/red/
// green/gray (628 of 632 bars wrong on MMA05). Two engine gaps, both general:
//   1. a function body ENDING IN A DECLARATION returns that declaration's value
//      (Pine returns a body's last statement) — it was refused `pine:function-def`;
//   2. a colour argument that is a CALL to such a helper was never opened by the
//      conditional-colour reader, only by the static one.
// After both, the ribbon's 18 lines MATCH TradingView on every bar.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const V5 = '//@version=5\nindicator("t")\n'
const pres = (src) => {
  const t = translatePine(src)
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return t.outputs[0].presentation
}

describe('a function body that ENDS IN A DECLARATION returns it', () => {
  it('the value of `r = d + 1` is the function\'s value', () => {
    const t = translatePine(`${V5}f(x) =>\n    d = x * 2\n    r = d + 1\nplot(f(close))\n`)
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[0].formula).toBe('close * 2 + 1')
  })

  it('⛔ CONTROL — an EARLIER declaration is a local, never the value: a trailing bare expression still wins', () => {
    const t = translatePine(`${V5}f(x) =>\n    d = x * 2\n    d + 5\nplot(f(close))\n`)
    expect(t.outputs[0].formula).toBe('close * 2 + 5')
  })

  it('⛔ CONTROL — an `if` arm ending in a declaration still refuses (unmeasured on the vendor)', () => {
    const t = translatePine(`${V5}v = if close > open\n    y = 1\nelse\n    y = 0\nplot(v)\n`)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:block')
  })
})

describe('a colour argument that CALLS a helper carries the helper\'s conditional', () => {
  const HELPERS = 'LIME = #00FF00\nGRAY = #808080\n'

  it('⭐ the Madrid shape: a declaration-tailed helper, resolved in the CALL\'s frame', () => {
    const p = pres(`${V5}${HELPERS}maColor(_ma) =>\n    diffMA = ta.change(_ma)\n    macol = diffMA >= 0 ? LIME : GRAY\nplot(close, color = maColor(ta.sma(close, 5)))\n`)
    expect(p).toMatchObject({ colorUp: '#00FF00', colorDown: '#808080' })
    // `_ma` means what the call passed, and the local `diffMA` is inlined.
    expect(p.colorCondition.formula).toBe('change(sma(close, 5)) >= 0')
    expect(p.color).toBeUndefined()
  })

  it('the same rule when the helper ends in a bare expression', () => {
    const p = pres(`${V5}${HELPERS}maColor(_ma) =>\n    diffMA = ta.change(_ma)\n    diffMA >= 0 ? LIME : GRAY\nplot(close, color = maColor(ta.sma(close, 5)))\n`)
    expect(p.colorCondition.formula).toBe('change(sma(close, 5)) >= 0')
  })

  it('⛔ CONTROL — a helper met INSIDE a helper declines (one frame), never resolves against the outer call', () => {
    const p = pres(`${V5}${HELPERS}inner(_x) => _x >= 0 ? LIME : GRAY\nouter(_ma) => inner(ta.change(_ma))\nplot(close, color = outer(ta.sma(close, 5)))\n`)
    expect(p.colorDynamic).toBe(true)
    expect(p.colorCondition).toBeUndefined()
  })

  it('⛔ R36 — a helper-carried rule mints NO parameter; the same input in the VALUE still does', () => {
    const helper = 'LIME = #00FF00\nGRAY = #808080\npick(_x, _t) => _x > _t ? LIME : GRAY\n'
    const colourOnly = translatePine(`${V5}th = input.float(1.5, "Gate")\n${helper}plot(close, color = pick(close, th))\n`, { strict: true, paramManifest: true })
    expect(colourOnly.outputs[0].presentation.colorCondition.formula).toBe('close > 1.5')
    expect((colourOnly.inputParams || []).map((x) => x.title || x.label)).toEqual([])
    const inValue = translatePine(`${V5}th = input.float(1.5, "Gate")\n${helper}plot(close + th, color = pick(close, th))\n`, { strict: true, paramManifest: true })
    expect((inValue.inputParams || []).map((x) => x.title || x.label)).toEqual(['Gate'])
  })
})
