// app/src/components/chart/engine/ast/requestEmptyTimeframe.test.js
//
// ─── C28b — `request.security(sym, "", x)` IS THE CHART'S OWN TIMEFRAME, AND A
//     COLOUR COMPUTED THROUGH A REQUEST IS CARRIED ─────────────────────────────
//
// Pine's reference for `request.security`: "To use the chart's main timeframe,
// use an empty string or the `timeframe.period` variable." The `""` spelling fell
// through to `pine:request`; and a plot colour written as a request —
//
//     plot(basis, color = request.security(syminfo.tickerid, timeframeInput,
//          close > basis[1] ? c1 : close < basis[1] ? c2 : na))
//
// — was not opened at all, so the line drew in the pane's gold. ⚰️ MEASURED on
// donchian-channels (NYSE:RDDT 1D): 533 bars of gold where TradingView draws
// blue, red or nothing. The vendor rail is `vendorHarness.c28Donchian.test.js`.
import { describe, it, expect } from 'vitest'
import { translatePine, printFormula } from './pine'

const LF = String.fromCharCode(10)
const src = (...lines) => ['//@version=6', 'indicator("req", overlay = true)', ...lines].join(LF) + LF
const last = (source) => {
  const r = translatePine(source, {})
  return r.outputs[r.outputs.length - 1]
}

describe('C28b — the empty timeframe is the chart\'s own', () => {
  it('⭐ a literal `""` is the identity, as `timeframe.period` is', () => {
    const a = last(src('plot(request.security(syminfo.tickerid, "", close * 2))'))
    const b = last(src('plot(request.security(syminfo.tickerid, timeframe.period, close * 2))'))
    expect(a.refusal).toBeFalsy()
    expect(printFormula(a.ast)).toBe(printFormula(b.ast))
    expect(printFormula(a.ast)).toBe('close * 2')
  })

  it('⭐ an `input.timeframe` defaulting to `""` is the identity too', () => {
    const o = last(src('tfi = input.timeframe("", "TF")', 'plot(request.security(syminfo.tickerid, tfi, high))'))
    expect(o.refusal).toBeFalsy()
    expect(printFormula(o.ast)).toBe('high')
  })

  it('🔴 CONTROL — a multi-period code still refuses by name', () => {
    const o = last(src('plot(request.security(syminfo.tickerid, "3M", close))'))
    expect(o.refusal && o.refusal.guard).toBe('pine:request')
  })
})

describe('C28b — a colour computed through a request is the inner rule, asked there', () => {
  it('⭐ a two-colour rule: its test moves inside the request (the identity folds away)', () => {
    const o = last(src('plot(close, color = request.security(syminfo.tickerid, "", close > open ? color.red : color.green))'))
    expect(o.refusal).toBeFalsy()
    const pres = o.presentation || o
    expect(pres.colorDynamic).toBeFalsy()
    expect(pres.colorCondition && pres.colorCondition.formula).toBe('close > open')
  })

  it('⭐ an `na`-gated chain: palette plus index, the gap a transparent entry', () => {
    const o = last(src(
      'b = ta.sma(close, 5)',
      'plot(b, color = request.security(syminfo.tickerid, "", close > b[1] ? color.new(#445b84, 50) : close < b[1] ? color.new(#844444, 50) : na))'))
    const pres = o.presentation || o
    expect(pres.colorDynamic).toBeFalsy()
    expect(pres.colorPalette).toHaveLength(3)
    expect(pres.colorIndex && pres.colorIndex.formula).toMatch(/^close > sma\(close, 5\)\[1\] \? 0 : close < sma\(close, 5\)\[1\] \? 1 : 2$/)
  })

  it('🔴 CONTROL — a request the resolver refuses leaves the colour declared uncarried', () => {
    const o = last(src('plot(close, color = request.security(syminfo.tickerid, "3M", close > open ? color.red : color.green))'))
    const pres = o.presentation || o
    expect(pres.colorDynamic).toBe(true)
    expect(pres.colorCondition).toBeUndefined()
  })
})
