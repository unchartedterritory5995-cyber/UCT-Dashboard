// ─── ⭐⭐ C37 — `chart.fg_color` / `chart.bg_color`: THE CHART'S OWN COLOURS ────
//
// Pine's two theme built-ins are the colours of the chart the script runs on.
// The vendor captures were taken on TradingView's LIGHT theme: every slot a
// script fills from `chart.fg_color` reads `#0f0f0f`, every `chart.bg_color`
// `#ffffff`. Our chart is a different chart, with the member's own colours — so
// the same script is CORRECT here when it wears OUR chart's foreground and
// background, and it is wrong to hard-code TradingView's.
//
// THE RULE (`objectTheme.js`): a theme colour is carried as a REFERENCE and
// resolved where it is drawn, against the chart's own settings. In the colour
// column it is THEME-RELATIVE: not graded against the capture's colour.
//
// WHAT THE CAPTURE *CAN* GRADE, and this rail does:
//   · WHICH slots are theme slots, and which of the two — every slot we carry as
//     a foreground reference is one where TradingView drew its foreground, every
//     background reference one where it drew its background (so a reference on
//     the wrong slot, or `fg` for `bg`, is caught by the capture);
//   · that nothing else changed beside them — the slots that are NOT theme
//     references in the same capture still agree colour for colour.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { censusOf } from './colourColumn'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { toRenderState } from '../../objectRenderState'
import {
  chartThemeOf, resolveThemeColour, isThemeColour, parseThemeColour, themeColourWithTransparency,
  THEME_FG, THEME_BG,
} from '../../objectTheme'
import { translatePine } from '../../ast/pine'
import { mergeChartSettings, CHART_DEFAULTS } from '../../../chartDefaults'
import * as registry from '../../nativeRegistry'
import { createBinder } from '../../binder'
import { addInstance } from '../../instanceControls'
import { createFakeChart } from '../fakeChart'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => {
  const loaded = loadCapture(path.join(DIR, `${id}.json`))
  if (!loaded.capture) throw new Error(`${id}: not a capture — ${loaded.reason}`)
  return loaded.capture
}

/** TradingView's own two colours on the captured (light) chart — READ off the
 *  captures by the assertions below, stated once here only to name them. */
const TV_LIGHT = { fg: '#0f0f0fff', bg: '#ffffffff' }

const CASES = [
  // [capture, theme slots expected: {'kind.slot': count}, other graded slots beside them?]
  ['trend-duration-forecast-chartprime-rddt-1d-2026-09-28', { 'cell.text_color': 20 }, true],
  ['market-structure-by-leviathan-rddt-1d-2026-09-28', { 'label.textcolor': 16 }, true],
  ['ict-killzones-pivots-tfo-rddt-1d-2026-09-28', {
    'table.bgcolor': 1, 'table.frame_color': 1, 'table.border_color': 1, 'cell.text_color': 3,
  }, false],
]

describe('C37 — the capture grades WHICH slots are the theme\'s, and which of the two', () => {
  for (const [id, expected, gradedBeside] of CASES) {
    it(`⭐ ${id}: every theme reference sits where TradingView drew its own theme colour`, () => {
      const row = censusOf(load(id))
      const themed = row.objects.rows.filter((r) => r.state === 'themeRelative')
      const got = {}
      for (const r of themed) got[`${r.kind}.${r.slot}`] = (got[`${r.kind}.${r.slot}`] || 0) + 1
      expect(got).toEqual(expected)
      for (const r of themed) {
        const which = parseThemeColour(r.ours).which
        expect(r.vendor, `${r.kind}.${r.slot} ${r.where}: ours ${r.ours}`).toBe(TV_LIGHT[which])
      }
      // ⛔ and nothing beside them is left uncarried or wrong
      const bad = row.objects.rows.filter((r) => r.state === 'notCarried' || r.state === 'carriedDiffers')
      expect(bad.map((r) => `${r.kind}.${r.slot} ${r.where}: vendor ${r.vendor} ours ${r.ours}`)).toEqual([])
      // ⛔ NON-VACUITY: where the capture pairs other COLOURED objects too, they are
      // graded and agree (ict-killzones' paired, script-coloured slots are all the theme's)
      const carried = row.objects.rows.filter((r) => r.state === 'agree').length
      expect(carried > 0).toBe(gradedBeside)
    }, 120000)
  }

  it('🔴 CONTROL — the mapping check can fail: a slot TradingView drew in another colour is not its theme\'s', () => {
    // trend-duration's HEADER cells are the script's own trend colours; were one
    // carried as a foreground reference, the capture would contradict it.
    const row = censusOf(load('trend-duration-forecast-chartprime-rddt-1d-2026-09-28'))
    const header = row.objects.rows.filter((r) => r.kind === 'cell' && r.slot === 'text_color' && r.state === 'agree')
    expect(header.length).toBe(14)
    expect(header.every((r) => r.vendor !== TV_LIGHT.fg)).toBe(true)
  }, 120000)
})

describe('C37 — a theme reference is drawn in the chart\'s OWN colours', () => {
  const cap = load('trend-duration-forecast-chartprime-rddt-1d-2026-09-28')
  const held = () => runOurSide(cap).objects.held

  it('⭐ the member\'s chart colours, whatever they are — and never TradingView\'s', () => {
    const live = held()
    const bars = toProductBars(cap)
    const fgCells = (theme) => toRenderState(live, { bars, tf: 'D', theme }).tables[0].cells
      .filter((c) => c.col >= 1 && c.row >= 1 && c.row <= 10).map((c) => c.text_color)
    const ours = chartThemeOf(mergeChartSettings({}))
    expect(ours).toEqual({ fg: CHART_DEFAULTS.textColor.toUpperCase(), bg: CHART_DEFAULTS.background.toUpperCase(), reason: null })
    expect(new Set(fgCells(ours))).toEqual(new Set([ours.fg]))
    // a member who repaints the chart repaints the script with it
    const light = chartThemeOf({ textColor: '#1f2328', background: '#ffffff', bgMode: 'solid' })
    expect(new Set(fgCells(light))).toEqual(new Set(['#1F2328']))
    // ⛔ TradingView's foreground appears only if the member's chart IS that colour
    expect(fgCells(ours)).not.toContain('#0F0F0F')
  }, 120000)

  it('⛔ with no theme handed in the slot has no colour of its own (the renderer\'s default), never a guess', () => {
    const state = toRenderState(held(), { bars: toProductBars(cap), tf: 'D' })
    const cells = state.tables[0].cells.filter((c) => c.col >= 1 && c.row >= 1 && c.row <= 10)
    expect(cells.length).toBe(20)
    for (const c of cells) expect(c.text_color).toBeUndefined()
  }, 120000)

  it('⛔ a GRADIENT background is unresolved, by name — Pine\'s value for it is documented, not witnessed (Q-T1)', () => {
    const theme = chartThemeOf({ textColor: '#706b5e', background: '#17181a', bgMode: 'gradient', bgGradient: { top: '#16233b', bottom: '#17181a' } })
    expect(theme).toEqual({ fg: '#706B5E', bg: null, reason: 'theme:gradient-background' })
    expect(resolveThemeColour(THEME_BG, theme)).toBeUndefined()
    expect(resolveThemeColour(THEME_FG, theme)).toBe('#706B5E')
  })
})

describe('C37 — the reference itself', () => {
  const LF = String.fromCharCode(10)
  const prog = (...lines) => translatePine(['//@version=6', 'indicator("t", overlay = true)', ...lines].join(LF) + LF, {}).objects
  const colourOf = (p, slot) => p.ops.find((op) => op.k === 'create').props[slot].node

  it('the Pine name rides as the colour; `color.new` on it sets a transparency that rides along', () => {
    const p = prog('if barstate.islast', '    label.new(bar_index, high, "x", color = chart.bg_color, textcolor = color.new(chart.fg_color, 80))')
    expect(colourOf(p, 'color')).toEqual({ c: 'lit', hex: 'chart.bg_color' })
    expect(colourOf(p, 'textcolor')).toEqual({ c: 'lit', hex: 'chart.fg_color@80' })
    const theme = { fg: '#112233', bg: '#445566' }
    expect(resolveThemeColour('chart.bg_color', theme)).toBe('#445566')
    // alpha round((1 − 80/100) × 255) = 51 = 0x33 — the object lane's one formula
    expect(resolveThemeColour('chart.fg_color@80', theme)).toBe('#11223333')
  })

  it('a name bound to it, and a `var` seeded with it, are followed', () => {
    const p = prog('txt = chart.fg_color', 'var color bg = chart.bg_color', 'if barstate.islast', '    label.new(bar_index, high, "x", color = bg, textcolor = txt)')
    expect(colourOf(p, 'color')).toEqual({ c: 'lit', hex: 'chart.bg_color' })
    expect(colourOf(p, 'textcolor')).toEqual({ c: 'lit', hex: 'chart.fg_color' })
  })

  it('⛔ a script\'s own binding of the name wins; anything that is not a reference is untouched', () => {
    expect(isThemeColour('chart.fg_color')).toBe(true)
    expect(isThemeColour('chart.bg_color@35')).toBe(true)
    for (const c of ['#FFFFFF', 'transparent', 'chart.fg_color@', 'chart.fg_color@101x', 'chart.left_visible_bar_time', null, undefined, 7]) {
      expect(isThemeColour(c), String(c)).toBe(false)
      expect(resolveThemeColour(c, { fg: '#000000', bg: '#FFFFFF' })).toBe(c)
    }
    expect(themeColourWithTransparency('chart.fg_color@80', 0)).toBe('chart.fg_color')
    expect(themeColourWithTransparency('chart.fg_color', 101)).toBeNull()
    expect(themeColourWithTransparency('#FFFFFF', 10)).toBeNull()
  })

  it('⛔ the PLOT lane does not carry a theme colour: still declared `colorDynamic`, by name', () => {
    // A plot's colour is a member-editable colour input whose default must be a
    // concrete colour; a default that follows the chart is a decision this lane
    // does not take. The line keeps drawing (ruling R-G).
    const t = translatePine(['//@version=6', 'indicator("t")', 'plot(close, color = chart.fg_color)'].join(LF) + LF, {})
    expect(t.outputs[0].presentation.colorDynamic).toBe(true)
    expect(t.outputs[0].presentation.color).toBeUndefined()
  })
})

describe('C37 — through the chart binding: the objects repaint when the chart\'s colours change', () => {
  const N = 12
  const BARS = Array.from({ length: N }, (_, i) => ({
    t: 1_700_000_000 + i * 86400, o: 100, h: 102, l: 98, c: 100 + i, v: 1000,
  }))
  const SRC = ['//@version=6', 'indicator("t", overlay = true)',
    'if barstate.islast', '    label.new(bar_index, close, "x", color = chart.bg_color, textcolor = chart.fg_color)',
    'plot(close)'].join(String.fromCharCode(10))

  const drawn = (settings) => {
    const door = memberPaneDefinition({ source: SRC, id: 'u_member-pane-c37theme', name: 't' })
    expect(door.ok, door.reason).toBe(true)
    const { installed, errors } = registry.installUserDefinitions([door.definition])
    expect(errors).toEqual([])
    const def = installed[0]
    try {
      const fake = createFakeChart()
      const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
      const cs = addInstance(mergeChartSettings(settings), def.id, registry)
      const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
      const states = []
      const sigs = []
      const sync = (withCs) => binder.sync({
        enabled: true, cs: withCs, instances, registry, bars: BARS, tf: 'D',
        symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false,
        adjustTime: (t) => t,
        applyData: (series, data) => series.setData(data),
        plan: { fresh: true },
        resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
        // the real layer repaints only when the SIGNATURE it is handed changes
        createObjectLayer: () => ({ set: (s, sig) => { states.push(s); sigs.push(sig) }, clear: () => {} }),
      })
      sync(cs)
      // the SAME bars and program, the chart repainted
      sync({ ...cs, textColor: '#101010', background: '#fafafa' })
      binder.teardown()
      return {
        drawn: states.filter(Boolean).map((s) => s.labels.map((l) => [l.color, l.textcolor])),
        sigs,
      }
    } finally {
      registry.uninstallUserDefinition(def.id)
    }
  }

  it('⭐ the label wears the chart\'s background and foreground, and follows a change of either', () => {
    const got = drawn({ textColor: '#706b5e', background: '#17181a' })
    expect(got.drawn).toEqual([
      [['#17181A', '#706B5E']],
      [['#FAFAFA', '#101010']],
    ])
    // ⛔ and the layer is TOLD it changed: same bars, same program, a new signature
    expect(got.sigs.length).toBe(2)
    expect(got.sigs[0]).not.toBe(got.sigs[1])
  }, 60000)
})
