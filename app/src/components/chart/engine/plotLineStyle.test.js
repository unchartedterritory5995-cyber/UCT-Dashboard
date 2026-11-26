// app/src/components/chart/engine/plotLineStyle.test.js
//
// ─── ⭐⭐ e98 E1 — A PLOT'S `linestyle` IS DRAWN, OR SAID BY NAME; NEVER SOLID IN SILENCE ─────────────────────────────
//
// ⚰️ Pine v6 (September 2025) lets `plot()` take `linestyle = plot.linestyle_dashed / _dotted / _solid`. The engine
// honoured a line style on `hline` only: `plot(ta.sma(close, 50), linestyle = plot.linestyle_dashed)` was served and
// drawn SOLID with no word, on both lanes (measured at the member door, 2026-11-25), a silent wrong picture.
//
// ⭐ NOW: ONE reader (`pine.js::Resolver.outputLineStyleOf`) answers a plot's linestyle: a style (`lineStyle`), a
// setting's choice (`plots[].lineStyleWhen`, each arm U6's knob test, checked by the one checker
// `defSchema.hiddenWhenProblem` and evaluated by the one helper `knobBind.js::knobTestAt` that `hiddenWhen` uses), or
// unreadable (`lineStyleUnread`: drawn solid and SAID by name). Carried only on a style that plots a line (Pine's
// release notes: "takes effect only for `style` arguments that plot lines"); an area's edge is drawn solid and said.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { translatePine } from './ast/pine.js'
import { memberPaneDefinition, settleLineStyleWhen } from '../builder/memberPane/memberPaneDefinition'
import { plotLineStyleAt, plotHiddenAt, knobTestAt } from './knobBind.js'
import { validateDefinition, lineStyleWhenProblem, PLOT_LINE_STYLES } from './defSchema.js'
import { planBindings, seriesOptionsForPlot, lineStyleValue } from './pool.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const H = '//@version=6\nindicator("t", overlay = true)\n'
const SMA = 'ta.sma(close, 50)'

function door(body) {
  const r = memberPaneDefinition({ source: `${H}${body}\n` })
  expect(r.ok, r.reason).toBe(true)
  return r
}
const plotOf = (def, label) => def.plots.find((p) => p.label === label)
const notesText = (r) => (r.notes || []).map((n) => n.note).join('\n')
/** The line style an instance with these inputs draws (the binder's own answer, through the pool's plan). */
const styleAt = (def, label, inputs = {}) => plotLineStyleAt(plotOf(def, label), def, inputs).lineStyle || 'solid'

describe('e98 E1 — a literal linestyle is carried onto the plot the chart draws', () => {
  it('dashed, dotted and solid; named, after positional arguments, and through a plain binding', () => {
    const r = door(`plot(${SMA}, "a", linestyle = plot.linestyle_dashed)\n`
      + `plot(${SMA}, "b", color.red, 2, plot.style_line, linestyle = plot.linestyle_dotted)\n`
      + `plot(${SMA}, "c", linestyle = plot.linestyle_solid)\n`
      + `ls = plot.linestyle_dotted\nplot(${SMA}, "d", linestyle = ls)\n`
      + `plot(${SMA}, "e", style = plot.style_stepline, linestyle = plot.linestyle_dashed)\n`
      + `plot(${SMA}, "f", style = plot.style_linebr, linestyle = plot.linestyle_dashed)`)
    const def = r.definition
    expect(def.plots.map((p) => [p.label, p.lineStyle])).toEqual([
      ['a', 'dashed'], ['b', 'dotted'], ['c', undefined], ['d', 'dotted'], ['e', 'dashed'], ['f', 'dashed']])
    expect(def.plots.some((p) => p.lineStyleWhen)).toBe(false)
    expect(validateDefinition(def).ok).toBe(true)
    expect(notesText(r)).not.toContain('solid line')
  })

  it('a plot that writes no linestyle carries no line style field (its document is what it was)', () => {
    const { definition: def } = door(`plot(${SMA}, "a")`)
    expect(Object.keys(plotOf(def, 'a'))).not.toContain('lineStyle')
    const t = translatePine(`${H}plot(${SMA}, "a")\n`, { basePeriod: 'D', strict: true })
    expect(Object.keys(t.outputs[0]).filter((k) => /^lineStyle/.test(k))).toEqual([])
  })

  it('the renderer draws it: the series options carry the library\'s dashed / dotted', () => {
    const LineStyle = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 }
    const { definition: def } = door(`plot(${SMA}, "a", linestyle = plot.linestyle_dashed)\n`
      + `plot(${SMA}, "b", linestyle = plot.linestyle_dotted)\nplot(${SMA}, "c")`)
    const opts = (label) => seriesOptionsForPlot(plotOf(def, label), { LineStyle }).lineStyle
    expect([opts('a'), opts('b'), opts('c')]).toEqual([LineStyle.Dashed, LineStyle.Dotted, LineStyle.Solid])
    expect(lineStyleValue('dashed', LineStyle)).toBe(2)
  })
})

describe('e98 E1 — a linestyle a setting chooses is the member\'s control, bound per instance', () => {
  it('an input.bool: dashed at the default, solid when the member turns it off', () => {
    const { definition: def } = door('d = input.bool(true, "Dash")\n'
      + `plot(${SMA}, "m", linestyle = d ? plot.linestyle_dashed : plot.linestyle_solid)\n`
      + `plot(${SMA}, "n", linestyle = d ? plot.linestyle_solid : plot.linestyle_dotted)`)
    expect(def.inputs.map((i) => i.key)).toContain('d')
    const m = plotOf(def, 'm')
    expect(m.lineStyle).toBe('dashed')
    expect(m.lineStyleWhen.map((a) => a.lineStyle)).toEqual(['solid', 'dashed'])
    expect(validateDefinition(def).ok).toBe(true)
    expect(styleAt(def, 'm')).toBe('dashed')
    expect(styleAt(def, 'm', { d: 0 })).toBe('solid')
    expect(styleAt(def, 'm', { d: 1 })).toBe('dashed')
    expect(styleAt(def, 'n')).toBe('solid')
    expect(styleAt(def, 'n', { d: 0 })).toBe('dotted')
  })

  it('an input.string with options: each option draws its own style (a nested ternary on ==)', () => {
    const { definition: def } = door('ls = input.string("Dotted", "Style", options = ["Solid", "Dashed", "Dotted"])\n'
      + `plot(${SMA}, "m", linestyle = ls == "Dashed" ? plot.linestyle_dashed : ls == "Dotted" ? plot.linestyle_dotted : plot.linestyle_solid)`)
    expect(def.inputs.find((i) => i.key === 'ls')).toBeTruthy()
    expect(plotOf(def, 'm').lineStyle).toBe('dotted')
    expect(styleAt(def, 'm')).toBe('dotted')
    expect(styleAt(def, 'm', { ls: 'Dashed' })).toBe('dashed')
    expect(styleAt(def, 'm', { ls: 'Solid' })).toBe('solid')
    expect(styleAt(def, 'm', { ls: 'Dotted' })).toBe('dotted')
  })

  it('the pool\'s plan draws the instance\'s style (the option the binder hands the plan)', () => {
    const { definition: def } = door('d = input.bool(true, "Dash")\n'
      + `plot(${SMA}, "m", linestyle = d ? plot.linestyle_dashed : plot.linestyle_solid)`)
    const registry = { getDefinition: (id) => (id === def.id ? def : null) }
    const planned = (inputs) => planBindings([{ instanceId: 'i:1', defId: def.id, inputs }], registry, null,
      { plotLineStyle: plotLineStyleAt }).bind.find((b) => b.plotKey === plotOf(def, 'm').key).plot.lineStyle
    expect(planned({})).toBe('dashed')
    expect(planned({ d: 0 })).toBe('solid')
  })

  it('a setting that does not come across is decided at its default (no lineStyleWhen naming a setting the document lacks)', () => {
    const when = { type: 'series', name: 'd' }
    const arms = () => [{ when: { type: 'op', name: '!', args: [when] }, lineStyle: 'solid' }, { when, lineStyle: 'dashed' }]
    const rows = [
      { key: 'a', lineStyle: 'dashed', lineStyleWhen: arms() },
      { key: 'b', lineStyle: 'solid', lineStyleWhen: arms() },
      { key: 'c', lineStyle: 'dashed', lineStyleWhen: arms() },
    ]
    settleLineStyleWhen(rows.slice(0, 2), new Set(['color']))
    settleLineStyleWhen(rows.slice(2), new Set(['d']))
    expect(rows[0]).toEqual({ key: 'a', lineStyle: 'dashed' })
    expect(rows[1]).toEqual({ key: 'b' })
    expect(rows[2].lineStyleWhen).toEqual(arms())
  })

  it('a knob test is evaluated by the ONE helper hiddenWhen uses (knobTestAt), and an unevaluable arm is never taken', () => {
    const def = { inputs: [{ key: 'd', type: 'int', default: 1, min: 0, max: 1 }] }
    const when = { type: 'series', name: 'd' }
    expect(knobTestAt(when, def, {})).toBe(1)
    expect(knobTestAt(when, def, { d: 0 })).toBe(0)
    expect(plotHiddenAt({ hiddenWhen: when }, def, { d: 0 })).toBe(false)
    // a bare number is itself (a static arm), for both readers
    expect(knobTestAt({ type: 'num', value: 0 }, def, {})).toBe(0)
    expect(plotHiddenAt({ hiddenWhen: { type: 'num', value: 0 } }, def, {})).toBe(false)
    expect(plotLineStyleAt({ lineStyle: 'solid', lineStyleWhen: [{ when: { type: 'num', value: 1 }, lineStyle: 'dotted' }] }, def, {}).lineStyle).toBe('dotted')
    const plot = { lineStyle: 'dotted', lineStyleWhen: [{ when: { type: 'series', name: 'nowhere' }, lineStyle: 'dashed' }] }
    expect(plotLineStyleAt(plot, def, {}).lineStyle).toBe('dotted')
    // a plot with no lineStyleWhen is returned as is (a document saved before it draws as it did)
    const plain = { lineStyle: 'dashed' }
    expect(plotLineStyleAt(plain, def, {})).toBe(plain)
  })
})

describe('e98 E1 — never drawn solid in silence', () => {
  it('a linestyle this engine cannot read is drawn solid AND said by the plot\'s title', () => {
    const r = door(`plot(${SMA}, "m", linestyle = close > open ? plot.linestyle_dashed : plot.linestyle_solid)\n`
      + `plot(${SMA}, "n", linestyle = plot.linestyle_wavy)`)
    expect(plotOf(r.definition, 'm').lineStyle).toBeUndefined()
    expect(plotOf(r.definition, 'n').lineStyle).toBeUndefined()
    const text = notesText(r)
    expect(text).toContain('`m` is drawn with a solid line: its `linestyle` chooses between line styles on a condition that is not one of the script\'s settings')
    expect(text).toContain('`n` is drawn with a solid line: its `linestyle = plot.linestyle_wavy` is not a line style constant')
  })

  it('an area\'s edge is drawn solid and said; a histogram or circles draw as before with no word (Pine ignores it there)', () => {
    const r = door(`plot(${SMA}, "ar", style = plot.style_area, linestyle = plot.linestyle_dashed)\n`
      + `plot(${SMA}, "hi", style = plot.style_histogram, linestyle = plot.linestyle_dashed)\n`
      + `plot(${SMA}, "ci", style = plot.style_circles, linestyle = plot.linestyle_dotted)`)
    for (const l of ['ar', 'hi', 'ci']) expect(plotOf(r.definition, l).lineStyle).toBeUndefined()
    const text = notesText(r)
    expect(text).toContain('`ar` is drawn with a solid line: its `linestyle` (dashed) is not reproduced on an area plot here')
    expect(text).not.toContain('`hi`')
    expect(text).not.toContain('`ci`')
  })

  it('a plot its author hid says nothing about its line', () => {
    const r = door(`plot(${SMA}, "m", display = display.none, linestyle = close > open ? plot.linestyle_dashed : plot.linestyle_solid)\nplot(close, "v")`)
    expect(notesText(r)).not.toContain('`m` is drawn with a solid line')
  })
})

describe('e98 E1 — the schema: lineStyleWhen in the one knob-test grammar', () => {
  const D = { type: 'op', name: '==', args: [{ type: 'series', name: 'ls' }, { type: 'num', value: 1 }] }
  it('accepts arms of the knob test, refuses anything else by name', () => {
    expect(lineStyleWhenProblem([{ when: D, lineStyle: 'dashed' }])).toBeNull()
    expect(lineStyleWhenProblem([])).toContain('expected a non-empty list')
    expect(lineStyleWhenProblem([{ when: { type: 'op', name: '+', args: [D, D] }, lineStyle: 'dashed' }]))
      .toBe('[0].when: the operator `+` is not part of a setting test')
    expect(lineStyleWhenProblem([{ when: D, lineStyle: 'wavy' }])).toContain('[0].lineStyle: expected one of')
    expect(lineStyleWhenProblem([{ when: D, lineStyle: 'dashed' }, { when: D, lineStyle: 'dashed' }])).toContain('is chosen twice')
    expect(lineStyleWhenProblem([{ when: D, lineStyle: 'dashed', extra: 1 }])).toContain('unknown field')
    expect(lineStyleWhenProblem(PLOT_LINE_STYLES.concat('solid').map((s) => ({ when: D, lineStyle: s })))).toContain('holds more than')
  })
})

/** The code with its comments removed (block comments, then line comments not inside a quote on that line), so a call
 *  written in a comment is never read as code. */
function stripComments(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks.split('\n').map((line) => {
    let quote = null
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
    }
    return line
  }).join('\n')
}

describe('e98 E1 — the binder hands its plan the one per-instance line style (source rail)', () => {
  const PASSES = /planBindings\([^)]*\{[^}]*\bplotLineStyle:\s*plotLineStyleAt\b[^}]*\}\)/
  it('control: the scan reads code, never a comment', () => {
    expect(PASSES.test(stripComments('planBindings(a, b, c, {\n  // plotLineStyle: plotLineStyleAt\n})'))).toBe(false)
    expect(PASSES.test(stripComments('planBindings(a, b, c, {\n  plotLineStyle: plotLineStyleAt,\n})'))).toBe(true)
  })
  it('binder.js passes plotLineStyleAt to planBindings', () => {
    const src = stripComments(fs.readFileSync(path.join(HERE, 'binder.js'), 'utf8'))
    expect(src).toMatch(PASSES)
  })
})
