// ─── ⭐⭐ (engine 95, input-kind) A `var` NOTHING REASSIGNS, READ AS TEXT, IS ITS `input.string` ─────────────────
//
// `var anchor = input.string(defval = "Session", options = [...])` holds its initializer on every bar (Pine runs it once,
// on bar 0, and nothing writes it again). As a `switch` subject or an `==` operand it is the same text the plain binding
// `anchor = input.string(...)` is, which the host lane has always read (`Resolver.stringValueOf`, `enumCompare`). Before,
// the `var` form refused: `pine:input-kind` at `anchor == "Earnings"`, `pine:block` at `switch anchor` (TradingView's own
// VWAP anchor shape, written by two corpus scripts), while the runtime lane already folded it (`dataTextInputVars`).
// The rails hold the two forms to ONE translation on the host lane, the run to the same values, and a reassigned `var`
// to its refusal.
import { describe, it, expect } from 'vitest'
import { translatePine, Resolver, parseWholeExpression, lexPine } from './pine'
import { TABLE } from './parse.js'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from '../nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'

const H = ['//@version=5', 'indicator("var text input", overlay = true)']
const OPTS = 'options = ["Earnings", "Session", "Week"]'
const SWITCH = ['isNew = switch anchor', '    "Earnings" => close > open', '    "Week" => timeframe.change("W")',
  '    "Session" => timeframe.change("D")', '    => false']
const shape = (decl, body) => [...H, decl, ...body].join('\n')
const VAR = `var anchor = input.string(defval = "Session", title = "Anchor", ${OPTS})`
const PLAIN = `anchor = input.string(defval = "Session", title = "Anchor", ${OPTS})`
const BODIES = {
  'a `switch` subject': [...SWITCH, 'plot(isNew ? 1 : 0, "a")'],
  'an `==` operand': ['isEsd = anchor == "Earnings" or anchor == "Week"', 'plot(isEsd ? 1 : close, "a")'],
  'both, as the VWAP anchor writes them': [...SWITCH, 'isEsd = anchor == "Earnings"', 'plot(isNew and not isEsd ? 1 : 0, "a")'],
}
const formulas = (src, opts) => (translatePine(src, { strict: true, ...opts }).outputs || []).map((o) => (o.refusal ? `refused:${o.refusal.guard}` : o.formula))

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 5) + i * 86400000).toISOString().slice(0, 10),
  o: 100, h: 102, l: 98, c: i % 2 ? 101 : 99, v: 1000 + i }))

describe('host lane: the `var` form is the plain form', () => {
  for (const [label, body] of Object.entries(BODIES)) {
    it(`${label}: one translation, default and member-door (live knob) alike`, () => {
      const v = formulas(shape(VAR, body))
      expect(v.every((f) => !String(f).startsWith('refused'))).toBe(true)
      expect(v).toEqual(formulas(shape(PLAIN, body)))
      const knob = { declareInputs: 'all', enumInputs: true }
      expect(formulas(shape(VAR, body), knob)).toEqual(formulas(shape(PLAIN, body), knob))
    })

    it(`${label}: the member door serves it, drawing what the plain form draws`, () => {
      const dv = memberPaneDefinition({ source: shape(VAR, body), id: 'u_vti_v', name: 'v' })
      const dp = memberPaneDefinition({ source: shape(PLAIN, body), id: 'u_vti_p', name: 'p' })
      expect(dv.ok, dv.reason).toBe(true)
      const cv = computeFor(dv.definition, BARS, undefined, { tf: 'D' })
      const cp = computeFor(dp.definition, BARS, undefined, { tf: 'D' })
      expect(Object.values(columnErrors(cv))).toEqual([])
      expect(Array.from(Object.values(cv)[0])).toEqual(Array.from(Object.values(cp)[0]))
    })
  }

  it('⛔ CONTROL: a `var` the script reassigns, even BELOW the read, is not fixed text: it keeps its refusal', () => {
    // bar 3 on reads "Week" at the top of the script, so the initializer would draw the wrong arm from there on
    const src = shape(VAR, [...BODIES['a `switch` subject'], 'if bar_index == 2', '    anchor := "Week"'])
    expect(formulas(src)[0]).toMatch(/^refused:/)
    expect(formulas(shape(VAR, BODIES['a `switch` subject']))[0]).not.toMatch(/^refused:/)
  })

  it('⛔ SCOPE: a `var` holding a string LITERAL is left as it was (its own unit, measured separately)', () => {
    // `var string MODE = "Fixed"` would read the same way, soundly, but reaches far more scripts than this unit measured
    const src = [...H, 'var string MODE = "Fixed"', 'plot(MODE == "Fixed" ? 1 : 0, "a")'].join('\n')
    expect(formulas(src)[0]).toMatch(/^refused:/)
  })

  it('⛔ the reassignment scan is what decides it: a Resolver built WITHOUT it reads every `var` as before', () => {
    const seed = parseWholeExpression(lexPine('input.string(defval = "Session", options = ["Session", "Week"])').tokens)
    const env = new Map([['anchor', { kind: 'state', seed, seedEnv: new Map(), update: { type: 'selfref' }, updateEnv: new Map() }]])
    const text = (opts) => new Resolver(env, TABLE, new Map(), opts).stringValueOf({ type: 'name', name: 'anchor' })
    expect(text({ mutated: new Map() })).toBe('Session')
    expect(text({ mutated: new Map([['anchor', []]]) })).toBe(null)
    expect(text({})).toBe(null)
  })

  it('⛔ CONTROL: a `var` whose initializer is per-bar text is never read per bar (it holds the value of bar 0)', () => {
    // `var t = close > open ? "up" : "down"` is decided ONCE, on bar 0: following the seed as a per-bar ternary would
    // draw a different value on every bar after the first. The host keeps it refused (the run reads it correctly).
    const src = [...H, 'var t = close > open ? "up" : "down"', 'plot(t == "up" ? 1 : 0, "a")'].join('\n')
    expect(formulas(src).every((f) => String(f).startsWith('refused'))).toBe(true)
  })
})

describe('runtime lane: the run draws the same values (it already read this shape)', () => {
  let n = 0
  const run = (src) => {
    n += 1
    const id = `u_vti_rt${n}`
    const doc = { id, meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: `runtime:${id}`, outputs: { a: 0 }, source: src } }
    try { return Array.from(computeRuntimeColumns(doc, BARS, { tf: 'D', historyFromListing: true, newestBarIsForming: false }).a) } finally { resetRuntimeSessions(); resetRuntimeLedgers() }
  }
  for (const [label, body] of Object.entries(BODIES)) {
    it(`${label}: the run draws the plain form's values, and the host lane draws the run's`, () => {
      const v = run(shape(VAR, body))
      expect(v.length).toBe(N)
      expect(v).toEqual(run(shape(PLAIN, body)))
      const d = memberPaneDefinition({ source: shape(VAR, body), id: 'u_vti_h', name: 'h' })
      expect(d.ok, d.reason).toBe(true)
      // ⚠️ from bar 1: on bar 0 the host lane draws `timeframe.change(...)` as na where the run draws 0, for the plain
      // form exactly as for the `var` form (a host/run difference this unit does not touch, logged as a finding)
      expect(Array.from(Object.values(computeFor(d.definition, BARS, undefined, { tf: 'D' }))[0]).slice(1)).toEqual(v.slice(1))
    })
  }

  it('⛔ CONTROL: a `var` the script reassigns reads its new text from that bar on (the run is never handed the seed)', () => {
    const v = run(shape(VAR, ['if bar_index == 2', '    anchor := "Week"', 'plot(anchor == "Week" ? 1 : 0, "a")']))
    expect(v).toEqual(BARS.map((_, i) => (i >= 2 ? 1 : 0)))
    // below the read: bar 3 on reads "Week" at the top of the script
    const below = run(shape(VAR, ['plot(anchor == "Week" ? 1 : 0, "a")', 'if bar_index == 2', '    anchor := "Week"']))
    expect(below).toEqual(BARS.map((_, i) => (i >= 3 ? 1 : 0)))
  })
})
