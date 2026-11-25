// app/src/components/chart/engine/displayPaints.test.js
//
// ─── ⭐⭐ e97 U7 — A BAND'S, A LEVEL'S AND A PAINT'S `display` IS READ, AND BOUND AT THE INSTANCE'S SETTINGS ──────────
//
// ⚰️ Measured at the door before this unit:
//   · `fill(...)`'s `display` was NOT READ AT ALL: `display = display.none` and `display = show ? display.all :
//     display.none` with `show` false drew the band where TradingView draws nothing (the built-in VWAP's bands #2 and #3,
//     range-filter-x-hull's target ranges, uptrick-volatility-weighted-cloud's `dipthis` band);
//   · `hline(...)` with any display but the two literals VANISHED with no word on the member's pane, at every setting;
//   · `bgcolor` / `barcolor` with a setting's display were withheld at every setting.
//
// ⭐ NOW: the ONE display reader U6 built (`Resolver.displayOfNode` → `outputDisplayOf`) answers all four calls; a
// setting's choice rides as `hiddenWhen` (on `plots[].fill`, `paints[]`, and the level's guide row) and is decided per
// instance by the ONE helper every plot is (`knobBind.js::plotHiddenAt`); an unreadable display WITHHOLDS the band,
// level or paint by name. A setting only the display reads is the member's control. A host-lane level the translation
// could not read is said on the member's pane, as the runtime document already said it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { translatePine } from './ast/pine.js'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { plotHiddenAt } from './knobBind.js'
import { fillActiveFor } from './binder.js'
import { planBindings } from './pool'
import * as registry from './nativeRegistry'
import { validateDefinition } from './defSchema.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const H = '//@version=6\nindicator("t", overlay = false)\na = plot(close, "a")\nb = plot(open, "b")\n'

function door(body) {
  const r = memberPaneDefinition({ source: `${H}${body}\n` })
  expect(r.ok, r.reason).toBe(true)
  expect(validateDefinition(r.definition).ok, JSON.stringify(validateDefinition(r.definition).errors)).toBe(true)
  return r
}
const keysOf = (def) => (def.inputs || []).map((i) => i.key)
const bandOf = (def) => (def.plots || []).find((p) => p.fill)
/** The binder's own answer for a band at an instance's inputs. */
const bandDrawn = (def, inputs = {}) => fillActiveFor(bandOf(def).fill, { def, inst: { inputs } })
const guideOf = (def) => (def.plots || []).find((p) => p.style === 'hlines')
const notesOf = (r) => (r.notes || []).map((n) => n.note)

describe('e97 U7 — a band (`fill`)', () => {
  it('`display.none` is not drawn (TradingView draws nothing); `display.pane` is drawn', () => {
    expect(bandOf(door('fill(a, b, color = color.red, display = display.none)').definition)).toBe(undefined)
    expect(bandOf(door('fill(a, b, color = color.red, display = display.data_window)').definition)).toBe(undefined)
    const { definition: def } = door('fill(a, b, color = color.red, display = display.pane)')
    expect(bandDrawn(def)).toBe(true)
  })

  it.each([
    ['a ternary on an input.bool', 'show = input.bool(false, "Show")\nfill(a, b, color = color.red, display = show ? display.all : display.none)'],
    ['a parenthesised ternary (range-filter-x-hull\'s shape)', 'show = input(false, "Show")\nfill(a, b, color = color.red, display = (show ? display.all : display.none))'],
    ['a plain binding (the built-in VWAP\'s `displayBand2`)', 'show = input(false, "Show")\nd = show ? display.all : display.none\nfill(a, b, color = color.red, display = d)'],
  ])('%s: hidden at the default, drawn when the member turns it on, and the setting is declared', (_, body) => {
    const { definition: def } = door(body)
    expect(keysOf(def)).toContain('show')
    expect(bandOf(def).fill.hiddenWhen).toBeTruthy()
    expect(bandDrawn(def)).toBe(false)
    expect(bandDrawn(def, { show: true })).toBe(true)
    expect(bandDrawn(def, { show: 1 })).toBe(true)
  })

  it('a bare `input(true)` setting (the built-in VWAP\'s `showBand_1`): drawn at the default, and the member\'s control', () => {
    const { definition: def } = door('show = input(true, "Show")\nfill(a, b, color = color.red, display = show ? display.all : display.none)')
    expect(keysOf(def)).toContain('show')
    expect(bandDrawn(def)).toBe(true)
    expect(bandDrawn(def, { show: false })).toBe(false)
  })

  it('⛔ an unreadable display WITHHOLDS the band, by name (never drawn)', () => {
    const r = door('f() => display.all\nfill(a, b, color = color.red, display = f())')
    expect(bandOf(r.definition)).toBe(undefined)
    expect(notesOf(r).join(' | ')).toContain('`fill` is not drawn: its `display`')
  })

  it('a band between two levels takes its display the same way', () => {
    const { definition: def } = door('show = input.bool(false, "Show")\nh1 = hline(70, "h1")\nh2 = hline(30, "h2")\n'
      + 'fill(h1, h2, color = color.red, display = show ? display.all : display.none)')
    expect(keysOf(def)).toContain('show')
    const band = def.plots.find((p) => p.fill)
    expect(fillActiveFor(band.fill, { def, inst: { inputs: {} } })).toBe(false)
    expect(fillActiveFor(band.fill, { def, inst: { inputs: { show: true } } })).toBe(true)
  })

  it('CONTROL: a band with no display is drawn, with no `hiddenWhen`', () => {
    const { definition: def } = door('fill(a, b, color = color.red)')
    expect(bandOf(def).fill.hiddenWhen).toBe(undefined)
    expect(bandDrawn(def)).toBe(true)
  })
})

describe('e97 U7 — a level (`hline`)', () => {
  const RSI = '//@version=6\nindicator("t")\nplot(close, "a")\n'
  it('a ternary on a setting: the guide carries `hiddenWhen`; the planner hangs it only while the instance shows it', () => {
    const r = memberPaneDefinition({ source: `${RSI}show = input.bool(false, "Show")\nhline(50, "mid", display = show ? display.all : display.none)\n`, id: 'u_e97_u7_h', name: 't' })
    expect(r.ok).toBe(true)
    expect(keysOf(r.definition)).toContain('show')
    expect(guideOf(r.definition).hiddenWhen).toBeTruthy()
    const { installed, errors } = registry.installUserDefinitions([r.definition])
    expect(errors).toEqual([])
    try {
      const reg = { getDefinition: (id) => (id === installed[0].id ? installed[0] : null) }
      const guidesAt = (inputs) => planBindings([{ instanceId: 'i:u7', defId: installed[0].id, inputs }], reg, null, { plotHidden: plotHiddenAt })
        .bind.flatMap((x) => (x.guides || []).map((g) => g.key))
      expect(guidesAt({})).toEqual([])
      expect(guidesAt({ show: true })).toEqual(['hline1'])
    } finally {
      registry.uninstallUserDefinition(installed[0].id)
    }
  })

  it('⛔ an unreadable display is withheld and SAID on the member\'s pane (the host lane was silent)', () => {
    const r = memberPaneDefinition({ source: `${RSI}f() => display.all\nhline(50, "mid", display = f())\n` })
    expect(r.ok).toBe(true)
    expect(guideOf(r.definition)).toBe(undefined)
    expect(notesOf(r).join(' | ')).toContain('`hline` is not drawn: its `display`')
  })

  it('a level withheld for another reason is said on the member\'s pane too (the one sentence-maker both documents ask)', () => {
    const r = memberPaneDefinition({ source: `${RSI}x = input.int(3)\ny = input.int(4)\nhline(x + y, "h")\n` })
    expect(r.ok).toBe(true)
    expect(notesOf(r).join(' | ')).toContain('`hline` is not drawn: its price is computed from settings')
  })

  it('CONTROL: `display.none` is not drawn and not "withheld" (the author\'s own hiding)', () => {
    const r = memberPaneDefinition({ source: `${RSI}hline(50, "mid", display = display.none)\n` })
    expect(guideOf(r.definition)).toBe(undefined)
    expect(notesOf(r).join(' | ')).not.toContain('`hline` is not drawn')
  })
})

describe('e97 U7 — a paint (`bgcolor` / `barcolor`)', () => {
  it.each(['bgcolor', 'barcolor'])('%s on a setting: `hiddenWhen` on the paint, decided by the instance\'s setting', (kind) => {
    const { definition: def } = door(`show = input.bool(false, "Show")\n${kind}(close > open ? color.red : na, display = show ? display.all : display.none)`)
    expect(keysOf(def)).toContain('show')
    const paint = def.paints.find((p) => p.kind === kind)
    expect(plotHiddenAt(paint, def, {})).toBe(true)
    expect(plotHiddenAt(paint, def, { show: true })).toBe(false)
  })

  it('off the pane at every setting is not carried; an unreadable display is withheld by name', () => {
    expect(door('bgcolor(close > open ? color.red : na, display = display.data_window)').definition.paints).toBe(undefined)
    const r = door('f() => display.all\nbgcolor(close > open ? color.red : na, display = f())')
    expect(r.definition.paints).toBe(undefined)
    expect(notesOf(r).join(' | ')).toContain('`bgcolor` (line 6) is not drawn: its `display`')
  })

  it('the binder asks plotHiddenAt for every paint (source rail, comments stripped)', () => {
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    const src = strip(fs.readFileSync(path.join(HERE, 'binder.js'), 'utf8'))
    expect(src).toMatch(/paints\.forEach\(\(p, i\) => \{\s*if \(!p\) return\s*if \(plotHiddenAt\(p, def, inst\.inputs\)\) return/)
    expect(src).toContain('plotHidden: plotHiddenAt')
  })
})

describe('e97 U7 — the translation: one reader, and a display read mints nothing', () => {
  it('the same `hiddenWhen` tree for a plot, a band, a level and a paint over one setting', () => {
    const t = translatePine(`${H}show = input.bool(false, "Show")\nplot(high, "c", display = show ? display.all : display.none)\n`
      + 'fill(a, b, color = color.red, display = show ? display.all : display.none)\n'
      + 'hline(50, "h", display = show ? display.all : display.none)\n'
      + 'bgcolor(color.red, display = show ? display.all : display.none)\n', { strict: true })
    const want = JSON.stringify(t.outputs.find((o) => o.title === 'c').hiddenWhen)
    expect(want).toContain('show')
    expect(JSON.stringify(t.presentation.fills[0].hiddenWhen)).toBe(want)
    expect(JSON.stringify(t.presentation.levels[0].hiddenWhen)).toBe(want)
    expect(JSON.stringify(t.presentation.paints[0].hiddenWhen)).toBe(want)
  })

  it('parameter ids do not move when a display is read (`paramManifest`): the same ids as the literal display', () => {
    const ids = (display) => (translatePine(`${H}len = input.int(5, "len")\nplot(ta.sma(close, len), "s")\n`
      + 'show = input.bool(false, "Show")\n'
      + `fill(a, b, color = color.red, display = ${display})\nhline(50, "h", display = ${display})\n`
      + `bgcolor(color.red, display = ${display})\n`
      + 'len2 = input.int(7, "len2")\nplot(ta.sma(close, len2), "s2")\n', { strict: true, paramManifest: true }).inputParams || [])
      .map((p) => `${p.id}:${p.sourceName}`)
    const literal = ids('display.all')
    expect(literal.map((x) => x.split(':')[1])).toEqual(['len', 'len2'])
    expect(ids('show ? display.all : display.none')).toEqual(literal)
  })
})
