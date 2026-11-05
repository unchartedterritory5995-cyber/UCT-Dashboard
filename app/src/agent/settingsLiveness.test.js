// ⛔ THE RAIL UNDER "A RECEIPT FOLLOWS A REAL CHANGE": the Agent may only write what the live surface READS.
// Both of the Agent's generic setters had the same defect: a value landed in stored state, the stored-state test passed,
// the receipt said done, and the surface ignored it. Read-back of the store cannot catch that; only the reader can.
// Source inspection on purpose: it runs on every key, every time, with nothing to mount.
//
//   chart.setSetting   every `eligible` row is read by the render path, or carries `inert` (which refuses) or `store`.
//   widget.setOption   default-deny: only `live: true` registry fields are offered, and each widget must read that key
//                      from `opts`. A new option therefore cannot be inert: unmarked it is refused, marked it must be read.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { ELIGIBLE_SETTINGS } from '../components/chart/chartSettingsDescriptors'
import { WIDGET_REGISTRY, WORKSPACE_MENU_TYPES } from '../widgets/registry'

registerBuiltins()
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(SRC, rel), 'utf8')
const CHART_RENDER_PATH = [
  'components/StockChart.jsx', 'components/chart/pane/ChartPane.jsx', 'components/chart/pane/ChartIdentityRow.jsx',
  'components/chart/swingLabelsPrimitive.js', 'components/chart/prevDayLevelsPrimitive.js', 'components/chart/crosshairMode.js', 'components/chart/legendMode.js',
  'components/chart/watermarkPrimitive.js',
].map(read).join('\n')
const leafOf = (id) => id.split('.').at(-1)
const readsLeaf = (src, leaf) => new RegExp(`(?:\\.|\\?\\.)${leaf}\\b|\\[['"]${leaf}['"]\\]|\\b${leaf}\\s*[,:}=]`).test(src)

describe('chart.setSetting: nothing the chart does not read', () => {
  it('every eligible row is read by the /charts render path, or declares where it really lives, or refuses', () => {
    const silent = ELIGIBLE_SETTINGS.filter(d => !d.inert && !d.store && !readsLeaf(CHART_RENDER_PATH, leafOf(d.id))).map(d => d.id)
    expect(silent).toEqual([])
  })
  it('a row declared inert for having no reader stays honest: once something reads it, the refusal must go', () => {
    expect(/\.maLineStyle\b/.test(CHART_RENDER_PATH)).toBe(false)
  })
  it('the props that beat a row are what its `store` / `inert` say (paneLook, ChartWidget)', () => {
    expect(read('components/chart/pane/paneLook.js')).toMatch(/volumePaneHeightPct: paneVolumePct\(prefs\)/)
    expect(read('pages/charts/widgets/ChartWidget.jsx')).toMatch(/watermarkX: wmPos\?\.x \?\? null/)
    expect(read('components/StockChart.jsx')).toMatch(/textColor: axisAuto\.ink/)
  })
})

describe('widget.setOption: nothing the widget does not read', () => {
  // each workspace type → its mounted component, from WidgetHost's own table, so a new widget is covered the day it exists
  const host = read('pages/charts/WidgetHost.jsx')
  const fileOf = Object.fromEntries([...host.matchAll(/^import (\w+) from '\.\/widgets\/(\w+)'/gm)].map(m => [m[1], `pages/charts/widgets/${m[2]}.jsx`]))
  const componentOf = (type) => new RegExp(`^\\s*${type}: \\{ component: (\\w+)`, 'm').exec(host)?.[1]
  const liveFields = WORKSPACE_MENU_TYPES.flatMap(t => (WIDGET_REGISTRY[t].paramsSchema || []).filter(f => f.live).map(f => [t, f.key]))

  it('there are live fields to check, and every one is read back from opts by its mounted widget', () => {
    expect(liveFields.length).toBeGreaterThan(0)
    for (const [type, key] of liveFields) {
      const file = fileOf[componentOf(type)]
      expect(file, `${type}: no widget file`).toBeTruthy()
      expect(read(file), `${type}.${key}`).toMatch(new RegExp(`opts(?:\\?\\.|\\.)${key}\\b`))
    }
  })
  it('the offered options are exactly the live fields (default-deny)', () => {
    const hints = getCapability('widget.setOption').hints
    for (const t of WORKSPACE_MENU_TYPES) {
      for (const f of WIDGET_REGISTRY[t].paramsSchema || []) {
        const named = new RegExp(`\\b${t}: [^;]*\\b${f.key} \\(`).test(hints)
        expect(named, `${t}.${f.key}`).toBe(f.live === true)
      }
    }
  })
  it('the rail can see a widget at all (guards the parse above)', () => {
    expect(readdirSync(join(SRC, 'pages/charts/widgets')).length).toBeGreaterThan(10)
    expect(fileOf[componentOf('fundamentals')]).toBe('pages/charts/widgets/FundamentalsWidget.jsx')
  })
})
