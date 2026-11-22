// app/src/components/chart/engine/__tests__/w4T13CandleFrontend.test.js
//
// W4-T13 - `plotcandle` / `plotbar` in the runtime front end. The pane's two doors ask for the
// run's plot colours (`plotColours`) and, with them, a candle is four price outputs plus its
// colour outputs. Everything else - the live OBJECT door, a build that did not ask - keeps the
// refusal master gives, by name.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr, RUNTIME_CANDLE_ROLES } from '../ast/pineRuntimeFrontend.js'
import { probeObjectRuntime } from '../runtime/runtimeColumns.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const build = (body, opts = {}) => buildRuntimeIr(H + body, { bars: [], inputs: {}, objectTrees: [], pane: true, symbolAtBind: true, ...opts })

const CANDLE = 'plotcandle(open, high, low, close, "C", color = close > open ? color.green : color.red, wickcolor = color.gray, bordercolor = na)\n'

describe('W4-T13 - the front end', () => {
  it('⭐ ON: a candle is open/high/low/close outputs in that order, its colours appended after every other output', () => {
    const r = build(`${CANDLE}plot(close, "p")\n`, { plotColours: true })
    expect(r.ok, JSON.stringify(r.refusal)).toBe(true)
    const o = r.ir.outputs
    expect(o.slice(0, 5).map((x) => [x.call, x.role || null])).toEqual([
      ['plotcandle', 'open'], ['plotcandle', 'high'], ['plotcandle', 'low'], ['plotcandle', 'close'], ['plot', null],
    ])
    // colours (body, wick, border) after every price output, named by the close they colour
    expect(o.slice(5).map((x) => x.call)).toEqual(['colour', 'colour', 'colour'])
    expect(o.slice(5).every((x) => x.of === 3)).toBe(true)
    const close = o[3]
    expect(close.colour.output).toBe(5)
    expect(close.wick.output).toBe(6)
    expect(close.border.output).toBe(7) // `bordercolor = na` rides as an all-na column
    expect(close.candle.title).toBe('C')
  })

  it('⛔ OFF (the live object door, and every build that did not ask): the refusal is master\'s, by name', () => {
    for (const call of ['plotcandle', 'plotbar']) {
      const r = build(`${call}(open, high, low, close)\n`)
      expect(r.ok).toBe(false)
      expect(r.refusal.guard).toBe('runtime:presentation')
    }
  })

  it('⛔ the OBJECT door keeps its presentation-only refusal for a script that draws a candle', () => {
    const p = probeObjectRuntime(`${H}plotcandle(open, high, low, close, "C", color.green, color.green, bordercolor = color.green)\n`, [])
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).toBe('runtime:presentation')
  })

  it('a plotbar takes only a body colour', () => {
    const r = build('plotbar(open, high, low, close, "B", color = color.blue)\n', { plotColours: true })
    expect(r.ok).toBe(true)
    const close = r.ir.outputs[3]
    expect(close.call).toBe('plotbar')
    expect(close.colour.output).toBe(4)
    expect(close.wick).toBeUndefined()
  })

  it('named arguments pick the right series by NAME (a swapped high / low would draw backwards)', () => {
    const r = build('plotcandle(close = close, low = low, high = high, open = open, color = color.green, wickcolor = color.green, bordercolor = color.green)\n', { plotColours: true })
    expect(r.ok, JSON.stringify(r.refusal)).toBe(true)
    expect(r.ir.outputs.slice(0, 4).map((x) => x.role)).toEqual(['open', 'high', 'low', 'close'])
  })

  it('⛔ every shape this lane cannot read refuses BY NAME rather than drawing something else', () => {
    // a parameter nobody measured
    expect(build('plotcandle(open, high, low, close, transp = 20)\n', { plotColours: true }).refusal.guard).toBe('runtime:presentation')
    // a missing price
    const missing = build('plotcandle(open, high, low)\n', { plotColours: true })
    expect(missing.refusal.guard).toBe('runtime:statement')
    expect(missing.refusal.message || missing.refusal.detail || JSON.stringify(missing.refusal)).toMatch(/close/)
    // text and colours are not prices
    expect(build('plotcandle("a", high, low, close)\n', { plotColours: true }).ok).toBe(false)
    expect(build('plotcandle(color.red, high, low, close)\n', { plotColours: true }).refusal.guard).toBe('runtime:colour')
    // a colour that is a number
    const num = build('plotcandle(open, high, low, close, color = close)\n', { plotColours: true })
    expect(num.ok).toBe(true)
    expect(num.ir.outputs[3].colour.refused).toBeTruthy()
  })

  it('r1: `group` is the ordinal WITHIN a call kind (the pane pairs per kind), and the roles are the exported list', () => {
    const k = 'color = color.green, wickcolor = color.green, bordercolor = color.green'
    const r = build(`plotcandle(open, high, low, close, ${k})\nplotbar(open, high, low, close, color = color.red)\nplotcandle(open, high, low, close, ${k})\nplotbar(open, high, low, close, color = color.red)\n`, { plotColours: true })
    expect(r.ok, JSON.stringify(r.refusal)).toBe(true)
    const closes = r.ir.outputs.filter((o) => o.role === 'close').map((o) => [o.call, o.group])
    expect(closes).toEqual([['plotcandle', 0], ['plotbar', 0], ['plotcandle', 1], ['plotbar', 1]])
    expect(r.ir.outputs.slice(0, 4).map((o) => o.role)).toEqual([...RUNTIME_CANDLE_ROLES])
  })
})
