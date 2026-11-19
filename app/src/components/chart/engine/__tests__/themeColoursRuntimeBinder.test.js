// app/src/components/chart/engine/__tests__/themeColoursRuntimeBinder.test.js
//
// ⭐⭐ ENGINE NUMBER PENDING (CO-2) — THROUGH THE CHART BINDING: a RUNTIME-lane row whose per-bar colour is the
// chart's theme colour is drawn in the member's own chart colours, for a light and a dark chart, and repaints when
// they change. The unit rail (`runtime/__tests__/themeColoursRuntime.test.js`) proves the carrier and the resolver;
// this one proves the binder hands the chart's theme to every colour plan it draws a run's column with
// (`pool.withPackedTheme`): a plot's points and a `bgcolor`.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { mergeChartSettings } from '../../chartDefaults'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { createFakeChart } from './fakeChart'
import { __permitRuntimePaneForTests } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../runtimeKill'
import { chartThemeOf, resolveThemeColour } from '../objectTheme'

// every colour list a `bgcolor` paint is handed (`createBackgroundPrimitive`'s `setOptions`), recorded
const PAINTS = vi.hoisted(() => [])
vi.mock('../paintPrimitive', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    createBackgroundPrimitive: (initial) => {
      const h = real.createBackgroundPrimitive(initial)
      return { ...h, setOptions: (patch) => { if (patch && patch.colors) PAINTS.push(patch.colors.slice()); return h.setOptions(patch) } }
    },
  }
})

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const N = 12
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 100, h: 104, l: 96, c: 100 + ((i * 7) % 5), v: 1000,
}))
// a running total built inside a `for`: the host lane refuses it (`pine:reassign`, ruling R7), the runtime serves it
const SRC = ['//@version=6', 'indicator("t")',
  'float s = 0.0', 'for i = 0 to 2', '    s += close[i]',
  'plot(s, "s", color = s > s[1] ? chart.fg_color : color.new(color.red, 0))',
  'bgcolor(s > s[1] ? color.new(chart.bg_color, 70) : na)'].join(String.fromCharCode(10))

beforeAll(() => {
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
})

function drawn(settings, settings2) {
  const door = memberPaneDefinition({ source: SRC, id: 'u_member-pane-co2theme', name: 't' })
  expect(door.ok, door.reason).toBe(true)
  expect(door.lane).toBe('runtime')
  const { installed, errors } = registry.installUserDefinitions([door.definition])
  expect(errors).toEqual([])
  const def = installed[0]
  try {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings(settings), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    const sync = (withCs) => binder.sync({
      enabled: true, cs: withCs, instances, registry, bars: BARS, tf: 'D',
      symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false,
      adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: () => {}, clear: () => {} }),
    })
    const lineColours = () => {
      const sets = fake.calls.filter((c) => c.on === 'series' && c.method === 'setData')
      const last = sets[sets.length - 1]
      return last.args[0].map((p) => p.color)
    }
    PAINTS.length = 0
    sync(cs)
    const first = lineColours()
    const paintFirst = PAINTS[PAINTS.length - 1] || null
    let second = null
    let paintSecond = null
    if (settings2) { sync({ ...cs, ...settings2 }); second = lineColours(); paintSecond = PAINTS[PAINTS.length - 1] || null }
    binder.teardown()
    return { first, second, paintFirst, paintSecond }
  } finally {
    registry.uninstallUserDefinition(def.id)
  }
}

describe('CO-2 — through the binding: a runtime row coloured by the chart\'s theme', () => {
  const LIGHT = { textColor: '#131722', background: '#ffffff' }
  const DARK = { textColor: '#d1d4dc', background: '#131722' }

  it('⭐ the plot\'s points wear the chart\'s foreground where the script picks it, light and dark, and repaint', () => {
    const got = drawn(LIGHT, DARK)
    const fgLight = resolveThemeColour('chart.fg_color', chartThemeOf(mergeChartSettings(LIGHT)))
    const fgDark = resolveThemeColour('chart.fg_color', chartThemeOf(mergeChartSettings(DARK)))
    expect(fgLight).not.toBe(fgDark)
    // the theme-coloured points are exactly the chart's foreground on each chart, nowhere a reference string
    expect(got.first.some((c) => c === fgLight)).toBe(true)
    expect(got.second.some((c) => c === fgDark)).toBe(true)
    for (const c of [...got.first, ...got.second]) expect(String(c)).not.toMatch(/chart\./)
    // the same bars switch colour, and only the theme ones
    got.first.forEach((c, i) => {
      if (c === fgLight) expect(got.second[i]).toBe(fgDark)
      else expect(got.second[i]).toBe(c)
    })
  }, 60000)

  it('⭐ the `bgcolor` paints the chart\'s background at 70 where the script picks it, light and dark, and repaints', () => {
    const got = drawn(LIGHT, DARK)
    const bgLight = resolveThemeColour('chart.bg_color@70', chartThemeOf(mergeChartSettings(LIGHT)))
    const bgDark = resolveThemeColour('chart.bg_color@70', chartThemeOf(mergeChartSettings(DARK)))
    expect(bgLight).not.toBe(bgDark)
    expect(got.paintFirst && got.paintFirst.some((c) => c === bgLight)).toBe(true)
    expect(got.paintSecond && got.paintSecond.some((c) => c === bgDark)).toBe(true)
    for (const c of [...got.paintFirst, ...got.paintSecond]) expect(String(c)).not.toMatch(/chart\./)
  }, 60000)
})
