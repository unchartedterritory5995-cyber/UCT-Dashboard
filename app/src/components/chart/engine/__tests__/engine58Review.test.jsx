// app/src/components/chart/engine/__tests__/engine58Review.test.jsx
//
// ─── ENGINE 58 — THE INDEPENDENT REVIEW OF #1330 (FIX FIRST) AND THE S11 ROOT CAUSES ───
//
// One rail per finding, each proven able to fail (a mutant per rail, run 2026-11-15;
// see docs/pine/evidence/2026-11-14-engine58-colours/EVIDENCE.md). Every script below
// is written in this repo's own words; the numbers quoted from captures (377, 600,
// alpha 26 / 80) are named where they appear.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { translatePine, COLOUR_UNREAD, isPreV4PineVersion, NO_VERSION_GUARD, modernPineSyntaxIn } from '../ast/pine.js'
import { memberPaneDefinition, COLOUR_NONE, WITHHELD_COLOUR_INK } from '../../builder/memberPane/memberPaneDefinition.js'
import { isPresentationColour, safeCssColour, inkCssColour } from '../objectColour'
import { chartThemeOf } from '../objectTheme'
import { withThemeColour } from '../pool.js'
import { chipsFrom } from '../readout'
import IndicatorChip from '../../legend/IndicatorChip'
import LegendRow from '../../legend/LegendRow'
import { comparePlot, comparePaints, alphaOnlyColour } from '../../../../../../tools/vendor_harness/compare.mjs'

const tr = (src) => translatePine(src, { strict: true })
const presOf = (src, i = 0) => (tr(src).outputs || [])[i].presentation
const paintsOf = (src) => (tr(src).presentation || {}).paints || []
const v5 = (body, overlay = true) => `//@version=5\nindicator("t", overlay = ${overlay})\n${body}\n`
const DARK = { fg: '#CFCFCF', bg: '#0F0F0F', reason: null }
const tol = { abs: 1e-9, rel: 1e-9 }

function door(src) {
  const d = memberPaneDefinition({ source: src, id: 'u_member-pane-e58r', name: 'e58r' })
  if (!d.ok) return d
  const inputs = new Map((d.definition.inputs || []).map((x) => [x.key, x]))
  const plots = d.definition.plots.filter((p) => !p.conditionFor).map((p) => ({
    key: p.key,
    colour: typeof p.color === 'string' && p.color.startsWith('$') ? (inputs.get(p.color.slice(1)) || {}).default : p.color,
    colorWithheld: p.colorWithheld || null,
  }))
  return { ok: true, plots, notes: d.notes || [], definition: d.definition }
}

/** Every inline `color:` an element tree writes. */
// UCT Signature R2 (owner 11-16, colored values): a row's value colour rides a CSS custom property
// (`--row-color` / `--chip-color`, clamped in CSS to the label's lightness band), so those count as ink too.
const inks = (container) => [...container.querySelectorAll('[style]')]
  .map((e) => e.style.color || e.style.getPropertyValue('--row-color') || e.style.getPropertyValue('--chip-color'))
  .filter((c) => typeof c === 'string' && c !== '')

// ─── review 1 (HIGH) — a theme-reference plot colour is accepted, and a chip resolves it
describe('review 1 — the theme reference is a presentation colour, resolved where it is drawn', () => {
  it('the grammar accepts it (the server holds the same source; tests/test_definition_colour_trust.py)', () => {
    for (const c of ['chart.fg_color', 'chart.bg_color@85']) expect(isPresentationColour(c), c).toBe(true)
    for (const c of ['chart.fg_color@', 'chart.xx_color', 'chart.fg_color;x:y']) expect(isPresentationColour(c), c).toBe(false)
  })
  it('safeCssColour resolves it against a theme, and writes nothing without one', () => {
    expect(safeCssColour('chart.fg_color@85', DARK)).toBe('#CFCFCF26')
    expect(safeCssColour('chart.bg_color', DARK)).toBe('#0F0F0F')
    expect(safeCssColour('chart.fg_color@85')).toBeUndefined()
    // a gradient background cannot answer chart.bg_color: nothing, never a guess
    expect(safeCssColour('chart.bg_color', { fg: '#CFCFCF', bg: null })).toBeUndefined()
  })
  it('a legend chip of a theme-coloured plot wears the chart\'s colour (opts.theme)', () => {
    const def = { id: 'th', meta: { name: 'Th', shortName: 'TH' }, inputs: [], plots: [{ key: 'v', color: 'chart.fg_color@85', legend: {} }] }
    const chip = (opts) => chipsFrom([{ defId: 'th', plotKey: 'v', series: {}, lastValue: 1, instanceId: 'i' }],
      new Map(), () => def, () => ({}), null, [], opts)[0]
    expect(chip({ theme: DARK }).color).toBe('#CFCFCF26')
    expect(chip({}).color).toBeUndefined()
  })
})

// ─── review 2 (HIGH/MED) — a colour that draws nothing never makes the chip text invisible
describe('review 2 — a fully transparent colour gives the legend text its own readable ink', () => {
  it('inkCssColour: transparent forms are undefined (the legend\'s ink), real colours kept', () => {
    for (const c of ['#00000000', '#ff000000', '#0000', 'transparent', 'rgba(0, 0, 0, 0)', 'rgba(255,0,0,.0)']) expect(inkCssColour(c), c).toBeUndefined()
    for (const c of ['#7b68ee', '#FF000080', 'rgba(0, 0, 0, 0.5)', 'rgba(1,2,0)', 'red']) expect(inkCssColour(c), c).toBe(safeCssColour(c))
  })
  it('the chip: a withheld rule row\'s #00000000 writes no ink; a real colour does', () => {
    const chip = (color) => ({ defId: 'x', plotKey: 'v', instanceId: 'i', label: 'X', color, decimals: 2, value: 1, hidden: false, text: 'X 1' })
    const none = render(<IndicatorChip chip={chip(COLOUR_NONE)} onMenu={() => {}} />)
    expect(inks(none.container)).toEqual([])
    const some = render(<IndicatorChip chip={chip('#7b68ee')} onMenu={() => {}} />)
    expect(inks(some.container).length).toBeGreaterThan(0)
  })
  it('the legend row: the same', () => {
    // ⭐ landing train 1 — master's signature legend (2026-11-15) no longer inks the VERTICAL row's
    // name in the line's colour (the micro-rail carries it), so the text ink this review item guards
    // lives on the FLAT strip, and the vertical row is asked of its rail: a colour that draws nothing
    // paints neither (the row keeps the legend's own readable ink), a real colour paints both.
    const paints = (container) => [...container.querySelectorAll('[style]')]
      .map((e) => e.style.color || e.style.background).filter((c) => typeof c === 'string' && c !== '')
    expect(inks(render(<LegendRow rowId="r" label="EMA" value="1" color={COLOUR_NONE} />).container)).toEqual([])
    expect(inks(render(<LegendRow rowId="r" label="EMA" value="1" color="#c07be0" />).container).length).toBeGreaterThan(0)
    expect(paints(render(<LegendRow rowId="r" label="EMA" value="1" color={COLOUR_NONE} vertical />).container)).toEqual([])
    expect(paints(render(<LegendRow rowId="r" label="EMA" value="1" color="#c07be0" vertical />).container).length).toBeGreaterThan(0)
  })
})

// ─── review 3 (MEDIUM) — `transp =` folds into an OPAQUE colour only
describe('review 3 — an explicit transp never multiplies a colour\'s own alpha', () => {
  it('v4 plot(x, "T", #FF000080, 1, plot.style_line, 70) draws alpha 80', () => {
    const src = '//@version=4\nstudy("t")\nplot(close, "T", #FF000080, 1, plot.style_line, 70)\n'
    const p = presOf(src)
    expect(p.color.toUpperCase()).toBe('#FF000080')
    expect(p.opacity).toBeUndefined()
    expect(String(door(src).plots[0].colour).slice(7).toLowerCase()).toBe('80')
  })
  it('control: an opaque colour takes it (70 -> alpha 4d), color.new(c, 0) is opaque, color.new(c, 40) keeps 60', () => {
    const src = '//@version=4\nstudy("t")\nplot(close, "T", #FF0000, 1, plot.style_line, 70)\n'
    expect(presOf(src).opacity).toBeCloseTo(0.3, 12)
    expect(String(door(src).plots[0].colour).slice(7).toLowerCase()).toBe('4d')
    expect(presOf('//@version=4\nstudy("t")\nplot(close, color=color.new(color.red, 0), transp=70)\n').opacity).toBeCloseTo(0.3, 12)
    expect(presOf('//@version=4\nstudy("t")\nplot(close, color=color.new(color.red, 40), transp=70)\n').opacity).toBeCloseTo(0.6, 12)
  })
  it('a rule takes it on its opaque leaves only', () => {
    const p = presOf('//@version=4\nstudy("t")\nplot(close, color = close > open ? #00FF00 : #FF000080, transp = 50)\n')
    expect(p.opacity).toBeUndefined()
    expect([p.colorUp, p.colorDown].map((c) => c.slice(7).toLowerCase()).sort()).toEqual(['80', '80'])
  })
})

// ─── review 4 (MEDIUM, coordinator ruling) — no `//@version` + v4+ syntax is refused by name
describe('review 4 — a no-pragma script in v4+ syntax is refused by name, never guessed', () => {
  it('refused at the door, with the sentence asking for the header', () => {
    const d = memberPaneDefinition({ source: 'indicator("u")\nplot(close, title="r", color=color.red)\n', id: 'u_member-pane-nov' })
    expect(d.ok).toBe(false)
    expect(d.guard).toBe(NO_VERSION_GUARD)
    expect(d.reason).toMatch(/no `\/\/@version` header/)
    expect(d.reason).toMatch(/`\/\/@version=5`/)
  })
  it.each([
    ['ta.*', 'study("u")\nplot(ta.sma(close, 3))\n', 'ta.sma'],
    ['input.*', 'study("u")\nn = input.int(3)\nplot(sma(close, n))\n', 'input.int'],
    ['var', 'study("u")\nvar x = 0.0\nplot(close)\n', null],
    ['plot.style_', 'study("u")\nplot(close, style=plot.style_line)\n', 'plot.style_line'],
  ])('the form %s is found', (_k, src, form) => {
    const f = modernPineSyntaxIn(src)
    expect(f).not.toBeNull()
    if (form) expect(f).toBe(form)
  })
  it('controls: v1 forms, and a modern word in a comment or a string, are not', () => {
    expect(modernPineSyntaxIn('study("u")\nplot(sma(close, 3), color=red)\n')).toBeNull()
    expect(modernPineSyntaxIn('study("ta.sma")\n// later: color.red, var x\nplot(close, color=red)\n')).toBeNull()
    const ok = memberPaneDefinition({ source: 'study("u")\nplot(close, title="r", color=red)\n', id: 'u_member-pane-v1' })
    expect(ok.ok, ok.reason).toBe(true)
    // …and a script that declares its version is never asked
    expect(memberPaneDefinition({ source: '//@version=5\nindicator("u")\nplot(ta.sma(close, 3))\n', id: 'u_member-pane-v5' }).ok).toBe(true)
  })
  // landing train 1: the four forms carry no lookbehind (iOS 16 floor); "not preceded by a word character
  // or a dot" is a consumed prefix and the form is the capture, so the boundary is railed on both sides
  it('the boundary: a longer name, or a member of something else, is not the namespace; the first column is', () => {
    expect(modernPineSyntaxIn('study("u")@x = beta.gamma@y = meta.color@plot(close)@'.split('@').join(String.fromCharCode(10)))).toBeNull()
    expect(modernPineSyntaxIn('study("u")@y = foo.line.new@z = a.plot.style_line@plot(close)@'.split('@').join(String.fromCharCode(10)))).toBeNull()
    expect(modernPineSyntaxIn('study("u")@myindicator(1)@lib.library(2)@plot(close)@'.split('@').join(String.fromCharCode(10)))).toBeNull()
    expect(modernPineSyntaxIn('ta.sma(close, 3)')).toBe('ta.sma')
    expect(modernPineSyntaxIn('x=color.red')).toBe('color.red')
    expect(modernPineSyntaxIn('indicator ("u")')).toBe('indicator (')
    expect(modernPineSyntaxIn('study("u")@  varip n = 0@'.split('@').join(String.fromCharCode(10)))).toBe('varip n')
  })
  it('the legacy predicate is strict: undefined is an error, null is v1', () => {
    expect(() => isPreV4PineVersion(undefined)).toThrow(/needs the script's Pine version/)
    expect(isPreV4PineVersion(null)).toBe(true)
    expect(isPreV4PineVersion(3)).toBe(true)
    expect(isPreV4PineVersion(4)).toBe(false)
  })
})

// ─── review 5 (coordinator ruling) — a WHOLE-withheld colour draws in the neutral ink, named
describe('review 5 — a whole-withheld colour is drawn in the chart\'s neutral ink, with "colour not reproduced"', () => {
  const src = v5('plot(close, "Line", color = color.from_gradient(close, low, high, color.red, color.rgb(0, 0, close)))', false)
  it('neither invisible nor gold: the theme foreground, resolved on the chart', () => {
    const d = door(src)
    expect(d.plots[0].colour).toBe(WITHHELD_COLOUR_INK)
    expect(d.plots[0].colour).not.toBe(COLOUR_NONE)
    expect(d.plots[0].colorWithheld.code).toBe(COLOUR_UNREAD)
    expect(withThemeColour({ color: d.plots[0].colour }, DARK).color).toBe('#CFCFCF')
  })
  it('the disclosure names it, without the code', () => {
    const d = door(src)
    expect(d.notes.some((n) => /`Line`: colour not reproduced: /.test(n.note))).toBe(true)
    expect(d.notes.some((n) => /pine:colour/.test(n.note))).toBe(false)
  })
  it('control: a rule row\'s per-bar gaps are still nothing (Pine\'s na colour), not the ink', () => {
    const d = door(v5('plot(close, color = close > open ? color.teal : color.red)', false))
    expect(d.plots[0].colour).toBe(COLOUR_NONE)
    expect(d.plots[0].colorWithheld.points).toBe(true)
  })
})

// ─── review 6 (LOW) — a theme reference is graded on its alpha byte
describe('review 6 — the harness grades a theme reference\'s alpha, not its hue', () => {
  it('alphaOnlyColour keeps the alpha only', () => {
    expect(alphaOnlyColour('#0f0f0f26')).toBe('#00000026')
    expect(alphaOnlyColour('#CFCFCF')).toBe('#000000ff')
    expect(alphaOnlyColour(null)).toBeNull()
  })
  it('the same alpha on two hues agrees; a different alpha differs', () => {
    const times = [1, 2]
    const run = (ours) => comparePlot({ times, vendor: [1, 2], ours: [1, 2], tol,
      vendorColors: ['#0f0f0f26', '#0f0f0f26'].map(alphaOnlyColour), ourColors: ours.map(alphaOnlyColour) })
    expect(run(['#CFCFCF26', '#CFCFCF26']).colorMismatches).toBe(0)
    expect(run(['#CFCFCF40', '#CFCFCF26']).colorMismatches).toBe(1)
  })
})

// ─── review 7 (LOW) — an alpha read from a setting is not baked at its default
describe('review 7 — a transparency that reads an input is withheld by name', () => {
  it('transp = tp (tp = input(40)): withheld; literal arithmetic still folds', () => {
    const p = presOf('//@version=4\nstudy("t")\ntp = input(40)\nplot(close, color=color.red, transp=tp)\n')
    expect(p.colorWithheld.code).toBe(COLOUR_UNREAD)
    expect(p.colorWithheld.reason).toMatch(/setting/)
    expect(p.opacity).toBeUndefined()
    expect(presOf('//@version=4\nstudy("t")\nplot(close, color=color.red, transp=100 - 60)\n').opacity).toBeCloseTo(0.6, 12)
  })
  it('color.new(<rule>, T) and color.new(chart.fg_color, T) with T from an input are not carried', () => {
    const rule = presOf(v5('t = input.int(60)\nc = close > open ? color.teal : color.red\nplot(close, color = color.new(c, t))', false))
    expect(rule.colorUp).toBeUndefined()
    expect(presOf(v5('t = input.int(85)\nplot(close, color = color.new(chart.fg_color, t))', false)).color).not.toBe('chart.fg_color@85')
    // control: a literal T is carried
    expect(presOf(v5('c = close > open ? color.teal : color.red\nplot(close, color = color.new(c, 60))', false)).colorUp).toBeTruthy()
  })
})

// ─── S11 A — a never-reassigned `var` with a one-colour seed IS that colour
describe('S11 A — a never-reassigned var colour is its seed, in the plot and paint lanes', () => {
  it('a paint (money-flow-index\'s bgcolor shape) and a plot', () => {
    const [bg] = paintsOf(v5('var color c = color.new(color.green, 80)\nplot(close)\nbgcolor(c)'))
    expect(bg.withheld).toBeUndefined()
    expect(bg.color).toBe('#4CAF50')
    expect(bg.opacity).toBeCloseTo(0.2, 12)
    const p = presOf(v5('var color c = color.new(color.green, 80)\nplot(close, color = c)'))
    expect(p.color).toBe('#4CAF50')
    expect(p.opacity).toBeCloseTo(0.2, 12)
  })
  it('a barcolor rule over var input colours (inside-bar-setup\'s shape)', () => {
    const [b] = paintsOf(v5('var bull = input.color(color.lime, "Bull")\nplot(close)\nbarcolor(close > open ? bull : na)'))
    expect(b.withheld).toBeUndefined()
    expect(JSON.stringify(b)).toMatch(/#00E676/i)
  })
  it('controls: a `:=` anywhere keeps it a state; a seed that reads the bar stays withheld', () => {
    const re = presOf(v5('var color c = color.red\nif close > open\n    c := color.green\nplot(close, color = c)'))
    expect(re.color).toBeUndefined()
    // …and a `:=` ELSEWHERE, after the read: the binding the plot sees is still the
    // `var`'s own state, so only the script-wide reassignment set can say no
    const later = presOf(v5('var color c = color.red\nplot(close, color = c)\nif close > open\n    c := color.green'))
    expect(later.color).toBeUndefined()
    const [p2] = paintsOf(v5('var color c = color.red\nplot(close)\nbgcolor(c)\nc := color.green'))
    expect(p2.color).toBeUndefined()
    const bar = presOf(v5('var color c = close > open ? color.red : color.green\nplot(close, color = c)'))
    expect(bar.color).toBeUndefined()
    expect(bar.colorUp).toBeUndefined()
  })
})

// ─── S11 B — a paint's show_last folds like its offset
describe('S11 B — show_last folds to the number TradingView draws', () => {
  it('dual-supertrend\'s `show_last = v_show_last` (input.int 377) and LRC-DGT\'s `3 * len` (600)', () => {
    const [a] = paintsOf(v5('v_show_last = input.int(377, "Visible Bars")\nplot(close)\nbarcolor(color.red, show_last = v_show_last)'))
    expect(a.withheld).toBeUndefined()
    expect(a.showLast).toBe(377)
    const [b] = paintsOf(v5('len = input.int(200, "Length")\nplot(close)\nbgcolor(color.red, show_last = 3 * len)'))
    expect(b.showLast).toBe(600)
  })
  it('control: a show_last that reads the bar is still withheld by name', () => {
    expect(paintsOf(v5('plot(close)\nbgcolor(color.red, show_last = bar_index)'))[0].withheld.code).toBe('paint:show-last')
  })
})

// ─── S11 C — a withheld paint TradingView paints on NO bar is undrawn on both sides
describe('S11 C — comparePaints counts withheld-and-unpainted as undrawn', () => {
  it('vendorPainted 0 is not a disagreement', () => {
    const g = comparePaints({ rows: [{ id: 'p1', kind: 'barcolor', state: 'withheld', displayed: true, vendorPainted: 0 }] })
    expect(g.undrawn).toBe(1)
    expect(g.differing).toBe(0)
  })
  it('control: a withheld paint TradingView did paint still differs', () => {
    const g = comparePaints({ rows: [{ id: 'p1', kind: 'barcolor', state: 'withheld', displayed: true, vendorPainted: 12 }] })
    expect(g.undrawn).toBe(0)
    expect(g.verdict).toBe('DIVERGE')
  })
})

// ─── S11 D — the theme reference rides on plotshape / plotchar too
describe('S11 D — a marker coloured chart.fg_color carries the theme reference', () => {
  it('market-trend-levels\' Signal shape: carried, and resolved on a light chart to its text colour', () => {
    expect(presOf(v5('plotshape(close > open, "Signal", color = chart.fg_color)')).color).toBe('chart.fg_color')
    expect(presOf(v5('plotchar(close > open, "Signal", "x", color = color.new(chart.fg_color, 50))')).color).toBe('chart.fg_color@50')
    const light = chartThemeOf({ textColor: '#000000', background: '#FFFFFF', bgMode: 'solid' })
    expect(withThemeColour({ color: 'chart.fg_color' }, light).color).toBe('#000000')
  })
})
