// app/src/components/chart/engine/runtime/__tests__/themeColoursRuntime.test.js
//
// ─── ⭐⭐ ENGINE 84 (CO-2) — `chart.fg_color` / `chart.bg_color` ON THE RUNTIME LANE ──────────────
//
// TradingView: the two are the chart's own background and its high-contrast foreground (the light-theme capture
// `vw-theme-colours-spy-1d-2026-10-01` reads #0f0f0f on #ffffff). The host reader carries each as a THEME REFERENCE
// (`objectTheme.js`, `chart.fg_color@40`) resolved where it is drawn, against the member's own chart. The runtime lane
// refused both (`pine:builtin` in a drawing, `runtime:colour` in a colour value). It now carries the SAME reference,
// in the number form its colours take (`objectTheme.packedThemeColour`), turned back into that reference string where
// the run's colour leaves the run (`colours.js::packedToObjectHex`), and resolved by the same `resolveThemeColour`.
//
// The rail: for a LIGHT and a DARK chart, the runtime lane and the host reader resolve the same colour, as values,
// through `color.new(…, t)` at whole t (a fixed one and one the bar computes), and as `textcolor`.
import { describe, it, expect } from 'vitest'

import { translatePine } from '../../ast/pine.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { toRenderState } from '../../objectRenderState.js'
import { packedPointColour, withPackedTheme, columnColorsForPlot } from '../../pool.js'
import {
  chartThemeOf, resolveThemeColour, packedThemeColour, themeColourOfPacked, THEME_PACKED_BASE,
} from '../../objectTheme.js'
import { packedToObjectHex, hexToPacked } from '../colours.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 100 + i, h: 103 + i, l: 97 + i, c: 101 + (i % 2 ? 2 : -1), v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

const THEMES = {
  light: chartThemeOf({ textColor: '#131722', background: '#ffffff', bgMode: 'solid' }),
  dark: chartThemeOf({ textColor: '#d1d4dc', background: '#131722', bgMode: 'solid' }),
}

/** The host reader's colour for a label slot: the reference its object program carries, resolved. */
function hostLabel(body, slot, theme) {
  const t = translatePine(HEAD + body, { objects: true })
  const create = t.objects.ops.find((op) => op.k === 'create' && op.family === 'label') || t.objects.ops.find((op) => op.k === 'create')
  const node = create.props[slot].node
  expect(node.c).toBe('lit')
  return { ref: node.hex, drawn: resolveThemeColour(node.hex, theme) }
}
/** The runtime lane's colour for the same slot: its DRAWING build's object, drawn by the render state. */
function runtimeLabel(body, slot, theme) {
  const built = buildRuntimeIr(HEAD + body, { bars: BARS, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t) })
  const live = res.objects.finish().live
  const label = live.find((o) => o.family === 'label')
  const state = toRenderState(live, { bars: BARS, tf: 'D', theme })
  return { ref: label.props[slot], drawn: state.labels[0][slot] }
}

const LABELS = {
  'textcolor = chart.fg_color': ['if barstate.islast\n    label.new(bar_index, close, "x", textcolor = chart.fg_color)\n', 'textcolor'],
  'color = chart.bg_color': ['if barstate.islast\n    label.new(bar_index, close, "x", color = chart.bg_color)\n', 'color'],
  'textcolor = color.new(chart.fg_color, 40)': ['if barstate.islast\n    label.new(bar_index, close, "x", textcolor = color.new(chart.fg_color, 40))\n', 'textcolor'],
  'a name bound to it': ['txt = chart.fg_color\nif barstate.islast\n    label.new(bar_index, close, "x", textcolor = txt)\n', 'textcolor'],
  'a `var` seeded with it': ['var color bg = chart.bg_color\nif barstate.islast\n    label.new(bar_index, close, "x", color = bg)\n', 'color'],
}

describe('CO-2 — a label coloured by the chart\'s theme: the runtime lane and the host reader draw the same colour', () => {
  for (const [what, [body, slot]] of Object.entries(LABELS)) {
    for (const [name, theme] of Object.entries(THEMES)) {
      it(`${what}, on a ${name} chart`, () => {
        const host = hostLabel(body, slot, theme)
        const run = runtimeLabel(body, slot, theme)
        expect(run.ref).toBe(host.ref)
        expect(run.drawn).toBe(host.drawn)
        expect(typeof run.drawn).toBe('string')
      })
    }
  }
  it('⛔ non-vacuous: the light and dark charts draw it in different colours', () => {
    const [body, slot] = LABELS['textcolor = chart.fg_color']
    expect(runtimeLabel(body, slot, THEMES.light).drawn).not.toBe(runtimeLabel(body, slot, THEMES.dark).drawn)
  })
})

/** A colour column from the run, drawn bar by bar as the binder draws it (`withPackedTheme`, `packedPointColour`). */
function drawnColumn(body, theme) {
  const b = buildRuntimeIr(HEAD + body, { bars: BARS, inputs: {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  const program = lowerIrProgram(b.ir, { historyFromListing: true })
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  const idx = b.ir.outputs.findIndex((o) => o.call === 'bgcolor')
  const plan = columnColorsForPlot(withPackedTheme({ colorMode: 'column:c', colorPacked: {} }, theme))
  return Array.from(r.outputs[idx]).map((v) => packedPointColour(plan.packed, v))
}

describe('CO-2 — a per-bar colour column holding the chart\'s theme colour is drawn in the chart\'s colour', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    it(`bgcolor(color.new(chart.bg_color, 80)), on a ${name} chart, is the host reference resolved`, () => {
      const got = drawnColumn('bgcolor(color.new(chart.bg_color, 80))\n', theme)
      expect(got.every((c) => c === resolveThemeColour('chart.bg_color@80', theme))).toBe(true)
    })
    it(`a transparency the bar computes (\`close > open ? 20 : 60\`), on a ${name} chart`, () => {
      const got = drawnColumn('bgcolor(color.new(chart.fg_color, close > open ? 20 : 60))\n', theme)
      BARS.forEach((bar, i) => {
        expect(got[i]).toBe(resolveThemeColour(`chart.fg_color@${bar.c > bar.o ? 20 : 60}`, theme))
      })
      expect(new Set(got).size).toBe(2)
    })
    it(`a choice between the theme colour and a fixed one, on a ${name} chart`, () => {
      const got = drawnColumn('bgcolor(close > open ? chart.fg_color : color.new(color.red, 50))\n', theme)
      BARS.forEach((bar, i) => {
        expect(got[i]).toBe(bar.c > bar.o ? resolveThemeColour('chart.fg_color', theme)
          : packedToObjectHex(hexToPacked('#F23645', 50)))
      })
    })
  }
  it('⛔ with no theme handed in, a bar holding the theme colour has no colour (never a guess)', () => {
    const got = drawnColumn('bgcolor(chart.bg_color)\n', null)
    expect(got.every((c) => c === null)).toBe(true)
  })
  it('the plan carries the theme in its signature, so a theme change repaints', () => {
    const a = columnColorsForPlot(withPackedTheme({ colorMode: 'column:c', colorPacked: {} }, THEMES.light))
    const b = columnColorsForPlot(withPackedTheme({ colorMode: 'column:c', colorPacked: {} }, THEMES.dark))
    expect(a.packed.sig).not.toBe(b.packed.sig)
  })
})

describe('CO-2 — what stops by name: the chart\'s colour is not in the computation', () => {
  const stopsWith = (body, re) => {
    const b = buildRuntimeIr(HEAD + body, { bars: BARS, inputs: {} })
    expect(b.ok, b.refusal && b.refusal.message).toBe(true)
    const program = lowerIrProgram(b.ir, { historyFromListing: true })
    let thrown = null
    try { execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }) } catch (e) { thrown = e }
    expect(thrown, 'the run did not stop').not.toBeNull()
    expect(String(thrown.message)).toMatch(re)
  }
  it('a comparison that meets the theme colour', () => {
    // (a `var` reassigned per bar keeps the comparison on this lane; a pure one is the host's, refused by name there)
    stopsWith('var color c = color.white\nc := close > open ? chart.bg_color : color.white\nbgcolor(c == color.white ? color.red : na)\n',
      /compared with the chart's theme colour/)
  })
  it('a gradient with the theme colour as an endpoint', () => {
    stopsWith('bgcolor(color.from_gradient(close, 90, 110, chart.bg_color, color.red))\n', /theme colour as an endpoint/)
  })
  it('a transparency that is not a whole number', () => {
    stopsWith('bgcolor(color.new(chart.fg_color, 87.5))\n', /not a whole/)
  })
  it('CONTROL: a script that never names the theme compares colours as before (no extra step in its program)', () => {
    const src = HEAD + 'var color c = color.white\nc := close > open ? color.blue : color.white\nbgcolor(c == color.white ? color.red : na)\n'
    const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(true)
    expect(JSON.stringify(b.ir)).not.toContain('color comparable')
  })
})

describe('CO-2 — the carrier', () => {
  it('lies above every packed colour and round-trips the reference', () => {
    expect(THEME_PACKED_BASE).toBe(2 ** 32)
    for (const ref of ['chart.fg_color', 'chart.bg_color', 'chart.fg_color@40', 'chart.bg_color@100']) {
      const v = packedThemeColour(ref)
      expect(v).toBeGreaterThan(0xffffffff)
      expect(themeColourOfPacked(v)).toBe(ref)
      expect(packedToObjectHex(v)).toBe(ref)
    }
    for (const v of [0, 0xffffffff, NaN, 2 ** 32 + 101, 2 ** 32 + 256 + 101, 1.5]) expect(themeColourOfPacked(v)).toBeNull()
  })
  it('⛔ a script\'s own binding of the name wins', () => {
    const b = buildRuntimeIr(`${HEAD}float chart_fg = 1.0\nplot(close)\n`, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(true)
  })
})
