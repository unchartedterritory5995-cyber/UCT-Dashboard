// app/src/components/chart/engine/displayKnob.test.js
//
// ─── ⭐⭐ e97 U6 — A PLOT'S `display` IS READ, AND BOUND AT THE INSTANCE'S SETTINGS ─────────────────────────────────
//
// ⚰️ The host lane read only a literal `display = display.none` (`pine.js::outputHidden`), so
// `plot(x, display = show ? display.all : display.none)` with `show = input.bool(false)` was DRAWN where TradingView
// draws nothing at the defaults: a silent wrong picture (about 40 committed arguments, 8 reference ones, the built-in
// MA family's smoothing bands, VWAP's bands 2 and 3). `display.data_window` and `display.all - display.pane` plots were
// drawn on the pane too. The runtime lane withheld a candle whose display was anything but a bare name.
//
// ⭐ NOW (design D1, coordinator ruling 2026-11-25): ONE reader (`Resolver.outputDisplayOf`) answers each output's
// display: hidden at every setting (`offPane`), hidden as the member's settings decide (`plots[].hiddenWhen`, a knob
// test), or unreadable (`displayUnread`, withheld by name: never guessed as drawn). ONE helper
// (`knobBind.js::plotHiddenAt`) answers "hidden for this instance" for every binder site and the legend. A setting only
// the display reads is declared as the member's control. A script whose every output its author hid is served,
// drawing nothing, as on TradingView. A document saved before `hiddenWhen` reads exactly as it always did.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { plotHiddenAt, hiddenAtLeafDefaults } from './knobBind.js'
import { validateDefinition, hiddenWhenProblem } from './defSchema.js'
import { drawingOf } from '../../../../../tools/vendor_harness/compare.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const H = '//@version=6\nindicator("t", overlay = true)\n'

function door(body) {
  const r = memberPaneDefinition({ source: `${H}${body}\n` })
  expect(r.ok, r.reason).toBe(true)
  return r
}
const plotOf = (def, label) => def.plots.find((p) => p.label === label)
/** Hidden for an instance with these inputs (the binder's own answer). */
const hiddenAt = (def, label, inputs = {}) => plotHiddenAt(plotOf(def, label), def, inputs)

describe('e97 U6 — the four shapes, bound at the instance\'s settings', () => {
  it('A: a ternary on an input.bool: hidden at the default, drawn when the member turns it on (and the reverse)', () => {
    const { definition: def } = door('show = input.bool(false, "Show")\n'
      + 'plot(close, "on-when-shown", display = show ? display.all : display.none)\n'
      + 'plot(open, "off-when-shown", display = show ? display.none : display.all)')
    expect(def.inputs.map((i) => i.key)).toContain('show')
    expect(hiddenAt(def, 'on-when-shown')).toBe(true)
    expect(hiddenAt(def, 'on-when-shown', { show: 1 })).toBe(false)
    expect(hiddenAt(def, 'off-when-shown')).toBe(false)
    expect(hiddenAt(def, 'off-when-shown', { show: 1 })).toBe(true)
  })

  it('B: a ternary on an input COMPARISON (an enum setting): decided by the option the member picks', () => {
    const { definition: def } = door('ma = input.string("None", "MA", options = ["None", "SMA"])\n'
      + 'plot(close, "band", display = ma != "None" ? display.all : display.none)')
    expect(def.inputs.map((i) => i.key)).toContain('ma')
    expect(hiddenAt(def, 'band')).toBe(true)
    expect(hiddenAt(def, 'band', { ma: 'SMA' })).toBe(false)
  })

  it('C: arms that are combinations, and D: a variable bound to a combination or to a ternary', () => {
    const { definition: def } = door('show = input.bool(true, "Show")\n'
      + 'loc = display.data_window + display.status_line\n'
      + 'd = show ? display.all - display.status_line : display.none\n'
      + 'plot(close, "combo-arm", display = d)\n'
      + 'plot(open, "data-window-only", display = loc)\n'
      + 'plot(high, "all-but-status", display = display.all - display.status_line)\n'
      + 'plot(low, "all-but-pane", display = display.all - display.pane)')
    expect(hiddenAt(def, 'combo-arm')).toBe(false)
    expect(hiddenAt(def, 'combo-arm', { show: 0 })).toBe(true)
    // off the pane at every setting: `hidden: true` (computed, never drawn), no knob
    expect(plotOf(def, 'data-window-only')).toMatchObject({ hidden: true })
    expect(plotOf(def, 'data-window-only').hiddenWhen).toBeUndefined()
    expect(plotOf(def, 'all-but-pane')).toMatchObject({ hidden: true })
    expect(hiddenAt(def, 'all-but-status')).toBe(false)
  })

  it('⛔ an unreadable display is withheld BY NAME, never guessed as drawn', () => {
    const r = door('f() => display.all\nplot(close, "computed", display = f())\nplot(open, "plain")')
    expect(plotOf(r.definition, 'computed')).toMatchObject({ hidden: true })
    expect(r.notes.map((n) => n.note).join('\n')).toContain('`computed` is not drawn: its `display` is not a display constant')
  })

  it('a literal display.none is unchanged: hidden, no knob', () => {
    const { definition: def } = door('plot(close, "a", display = display.none)\nplot(open, "b")')
    expect(plotOf(def, 'a')).toMatchObject({ hidden: true })
    expect(plotOf(def, 'a').hiddenWhen).toBeUndefined()
    expect(hiddenAt(def, 'b')).toBe(false)
  })
})

describe('e97 U6 — an old saved document reads exactly as today', () => {
  it('without hiddenWhen, plotHiddenAt is `hidden === true` and nothing else, whatever the inputs', () => {
    const def = { inputs: [{ key: 'show', type: 'int', default: 0 }], plots: [] }
    for (const hidden of [true, false, undefined, 'yes', 1]) {
      for (const inputs of [{}, { show: 1 }, { show: 0 }]) {
        expect(plotHiddenAt({ key: 'p', hidden }, def, inputs), `${hidden} ${JSON.stringify(inputs)}`).toBe(hidden === true)
      }
    }
  })

  it('⛔ a hiddenWhen this binding cannot evaluate is HIDDEN (fail closed), and one decided at the defaults reads them', () => {
    const def = { inputs: [], plots: [] }
    expect(plotHiddenAt({ key: 'p', hiddenWhen: { type: 'series', name: 'notDeclared' } }, def, {})).toBe(true)
    const leaf = { type: 'series', name: 's' }
    Object.defineProperty(leaf, 'inputDefault', { value: 0, enumerable: false })
    expect(hiddenAtLeafDefaults(leaf)).toBe(false)
    expect(hiddenAtLeafDefaults({ type: 'op', name: '!', args: [leaf] })).toBe(true)
  })
})

describe('e97 U6 — a script whose every output its author hid is served, drawing nothing', () => {
  it.each([
    ['display.none', 'plot(close, "a", display = display.none)'],
    ['display.data_window', 'plot(close, "a", display = display.data_window)'],
    ['both', 'plot(close, "a", display = display.none)\nplot(open, "b", display = display.data_window)'],
  ])('%s', (_, body) => {
    const r = door(body)
    expect(r.definition.plots.every((p) => p.hidden === true)).toBe(true)
  })

  it('⛔ CONTROL: one that also WRITES a drawing is not carved out (TradingView draws it; measured: session-highs-and-lows)', () => {
    const r = memberPaneDefinition({ source: `${H}plot(close, "a", display = display.none)\n`
      + 'var label lb = na\nif barstate.islast\n    lb := label.new(bar_index, high, str.tostring(close))\n' })
    expect(r.ok && r.definition && r.definition.plots.every((p) => p.hidden === true)
      && !((r.definition.objects || {}).ops || []).length).toBe(false)
  })

  it('⛔ CONTROL: one whose only output is UNREADABLE is not carved out (it is withheld, not the author\'s hiding)', () => {
    const r = memberPaneDefinition({ source: `${H}f() => display.all\nplot(close, "a", display = f())\n` })
    expect(r.ok).toBe(false)
  })
})

describe('e97 U6 — the schema: hiddenWhen is a setting test and nothing else', () => {
  it('accepts a knob test; refuses arithmetic, an unknown node, and hiddenWhen beside hidden: true', () => {
    expect(hiddenWhenProblem({ type: 'op', name: '!', args: [{ type: 'series', name: 's' }] })).toBe(null)
    expect(hiddenWhenProblem({ type: 'op', name: '+', args: [{ type: 'series', name: 's' }, { type: 'num', value: 1 }] }))
      .toContain('the operator `+` is not part of a setting test')
    expect(hiddenWhenProblem({ type: 'call', name: 'sma', args: [] })).toContain('`call` is not part of a setting test')
    const { definition: def } = door('show = input.bool(false, "Show")\nplot(close, "a", display = show ? display.all : display.none)')
    expect(validateDefinition(def).ok).toBe(true)
    const bad = { ...def, plots: def.plots.map((p) => (p.label === 'a' ? { ...p, hidden: true } : p)) }
    expect(JSON.stringify(validateDefinition(bad).errors || [])).toContain('hiddenWhen: a plot with `hidden: true`')
  })
})

describe('e97 U6 — every binder site and the legend ask plotHiddenAt (source rail)', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  // a plot's own `hidden` read directly: `<x>.plot.hidden`, `hp.hidden`, `p.hidden`, `plot.hidden` (never `inst.hidden`)
  const DIRECT = /\b(?:\w+\.plot|hp|p|plot)\.hidden\b/g
  it('CONTROL: the scan sees a direct read where one is written', () => {
    expect(strip('if (b.plot.hidden === true) x()\n// p.hidden in a comment').match(DIRECT)).toEqual(['b.plot.hidden'])
  })
  it.each(['binder.js', 'readout.js'])('%s reads no plot\'s `hidden` directly', (file) => {
    const src = strip(fs.readFileSync(path.join(HERE, file), 'utf8'))
    expect(src.match(DIRECT) || []).toEqual([])
    expect(src).toContain('plotHiddenAt(')
  })
})

describe('e97 U6 — the harness names the drawing, beside the values', () => {
  it('drawingOf', () => {
    expect(drawingOf(true, true)).toEqual({ drawing: 'both hide it' })
    expect(drawingOf(false, false)).toEqual({ drawing: 'both draw it' })
    expect(drawingOf(true, false)).toEqual({ drawing: 'TradingView hides it (display none); ours draws it' })
    expect(drawingOf(false, true)).toEqual({ drawing: 'ours hides it; TradingView draws it' })
    expect(drawingOf(false, null)).toEqual({})
  })
})
