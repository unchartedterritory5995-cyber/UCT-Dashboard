// ⛔ THE RAIL UNDER "A RECEIPT FOLLOWS A REAL CHANGE": the Agent may only write what the live surface READS.
// Both of the Agent's generic setters had the same defect: a value landed in stored state, the stored-state test passed,
// the receipt said done, and the surface ignored it. Read-back of the store cannot catch that; only the reader can.
// Source inspection on purpose: it runs on every key, every time, with nothing to mount.
//
//   chart.setSetting   every `eligible` row is read by the render path, or carries `inert` (which refuses) or `store`.
//   widget.setOption   default-deny: only `live: true` registry fields are offered. Both directions are grepped from each
//                      mounted widget's own source: a live field must be read from `opts`, and a field that IS read must be
//                      live. So an option can be neither inert (offered, unread) nor silently denied (read, refused).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { ELIGIBLE_SETTINGS } from '../components/chart/chartSettingsDescriptors'
import { WIDGET_REGISTRY } from '../widgets/registry'
import { ownControls, widgetControls } from '../widgets/widgetControls'
import { CATEGORY_FILTERS } from '../pages/charts/widgets/tradeExchangeNewsModel'
import { widgetOptionFields, widgetUnboundedFields } from './capabilities/board'

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
    // the pane height is a prop of `updateChart`: without this dependency a new height draws nothing until something else re-runs it
    expect(read('components/StockChart.jsx')).toMatch(/\}, \[volumePaneHeightPct, filteredBars,/)
  })
})

// ── What a mounted widget reads from `opts`, by grep ──
const code = (src) => src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\s\/\/\s.*$/, '')).join('\n')
/** Default and named relative imports of a file: local name → that file's path under src. */
function localImports(rel, src) {
  const out = {}
  const resolve = (spec) => ['', '.js', '.jsx'].map(x => posix.join(posix.dirname(rel), spec) + x).find(p => existsSync(join(SRC, p)) && statSync(join(SRC, p)).isFile())
  for (const m of src.matchAll(/^import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s+'(\.[^']+)'/gm)) {
    const file = resolve(m[3])
    if (!file) continue
    if (m[1]) out[m[1]] = file
    for (const n of (m[2] || '').split(',')) { const local = n.trim().split(/\s+as\s+/).at(-1); if (local) out[local] = file }
  }
  // a code-split component: `const X = lazy(() => import('./y'))`
  for (const m of src.matchAll(/^const (\w+) = lazy\(\(\) => import\('(\.[^']+)'\)\)/gm)) { const file = resolve(m[2]); if (file) out[m[1]] = file }
  return out
}
/** Every key read from `opts`: opts.key, opts?.key, opts['key'], `const { key } = opts`, through an alias (`const o = opts || {}`),
 *  and on through a child handed `opts={opts}` and a helper called with `opts`. */
export function optsReadsOf(rel, seen = new Set()) {
  const reads = new Set()
  if (seen.has(rel)) return reads
  seen.add(rel)
  const src = code(read(rel))
  const aliases = ['opts', ...[...src.matchAll(/\bconst (\w+) = opts\b(?:\s*(?:\|\||\?\?)\s*\{\s*\})?\s*$/gm)].map(m => m[1])]
  for (const a of aliases) {
    for (const m of src.matchAll(new RegExp(`\\b${a}(?:\\?\\.|\\.)(\\w+)|\\b${a}(?:\\?\\.)?\\[['"](\\w+)['"]\\]`, 'g'))) reads.add(m[1] || m[2])
    for (const m of src.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${a}\\b`, 'g'))) for (const k of m[1].split(',')) { const key = k.trim().split(/[:=\s]/)[0]; if (key) reads.add(key) }
  }
  const imports = localImports(rel, read(rel))
  const next = [...src.matchAll(/<(\w+)\b[^>]*?\bopts=\{opts\}/g), ...src.matchAll(/\b(\w+)\(opts\b/g)].map(m => imports[m[1]]).filter(Boolean)
  for (const f of next) for (const k of optsReadsOf(f, seen)) reads.add(k)
  return reads
}

describe('widget.setOption: exactly what the widget reads', () => {
  // every type mounted on /charts → its component file, from WidgetHost's own table, so a new widget is covered the day it exists
  const host = read('pages/charts/WidgetHost.jsx')
  const hostImports = localImports('pages/charts/WidgetHost.jsx', host)
  const mounted = [...host.matchAll(/^ {2}(\w+): \{\s*component: (\w+)/gm)].map(m => [m[1], hostImports[m[2]]])
  const name = (t, f) => `${t}.${f.key}`
  const rows = mounted.flatMap(([t, file]) => { const reads = optsReadsOf(file); return widgetOptionFields(t).map(f => ({ t, f, read: reads.has(f.key) })) })

  it('every field its mounted widget reads is live (a read option is never refused)', () => {
    expect(rows.filter(r => r.read && r.f.live !== true).map(r => name(r.t, r.f))).toEqual([])
  })
  it('every live field is read back from opts by its mounted widget (a refused option is never offered)', () => {
    expect(rows.filter(r => !r.read && r.f.live === true).map(r => name(r.t, r.f))).toEqual([])
  })
  it('a read number with no product range stays refused, by name: a new one has to be given its range or added here on purpose', () => {
    const read = mounted.flatMap(([t, file]) => { const reads = optsReadsOf(file); return widgetUnboundedFields(t).filter(f => reads.has(f.key)).map(f => name(t, f)) })
    expect(read).toEqual(['volumescan.minRvol', 'volumescan.minMove', 'volumescan.minDollarK'])
  })
  it('the offered options are exactly the live fields and the `controls` rows (default-deny)', () => {
    for (const [t] of mounted) {
      const offered = widgetControls(t).map(f => f.key)
      for (const f of WIDGET_REGISTRY[t].paramsSchema || []) {
        expect(offered.includes(f.key), `${t}.${f.key}`).toBe(f.live === true || ownControls(t).some(c => c.key === f.key))
      }
      expect(new Set(offered).size, t).toBe(offered.length)
    }
    expect(getCapability('widget.setOption').hints).not.toMatch(/\b(?:fundamentals|optionsflow):/)    // the routed section carries them
  })
  it('a `controls` row kept in opts is read back from opts by its mounted widget, at the head of its path', () => {
    const silent = mounted.flatMap(([t, file]) => {
      const reads = optsReadsOf(file)
      return ownControls(t).filter(c => !c.door && c.type !== 'action' && !reads.has(String(c.path || c.key).split('.')[0])).map(c => `${t}.${c.key}`)
    })
    expect(silent).toEqual([])
  })
  it('a `controls` row that needs the door has one: the mounted widget publishes its value, its writer and its choices', () => {
    const SOURCE = { themes: 'pages/ThemeTrackerPage.jsx', scanner: 'pages/charts/widgets/ScannerResults.jsx', watchlist: 'pages/Watchlists.jsx' }
    const missing = []
    for (const [t, file] of mounted) {
      const rows = ownControls(t).filter(c => c.door || c.from === 'door' || c.type === 'action')
      if (!rows.length) continue
      const src = code(read(SOURCE[t] || file))
      const at = src.indexOf('useWidgetDoor(')
      const door = at < 0 ? '' : src.slice(at, src.indexOf('\n\n', at))
      for (const c of rows) {
        const named = new RegExp(`\\b${c.key}\\b`).test(door)
        // an `action` row (a button) is run by the door's act(key), and nothing else
        if (c.type === 'action') { if (!named || !/\bact:/.test(door)) missing.push(`${t}.${c.key} act`); continue }
        if (!named) missing.push(`${t}.${c.key}`)
        if (c.door && !/\bread:/.test(door)) missing.push(`${t}.${c.key} read`)
        if (c.door && !/\bwrite:/.test(door)) missing.push(`${t}.${c.key} write`)
        if (c.from === 'door' && !/\boptions:/.test(door)) missing.push(`${t}.${c.key} options`)
      }
    }
    expect(missing).toEqual([])
  })
  it('every Send to Journal door a widget has is offered through its door too, with the same kind', () => {
    const SOURCE = { themes: 'pages/ThemeTrackerPage.jsx', watchlist: 'pages/Watchlists.jsx', scanner: 'pages/charts/widgets/ScannerResults.jsx' }
    const missing = []
    for (const [t, file] of mounted) {
      const src = read(SOURCE[t] || file)
      for (const m of src.matchAll(/sendCaptureToJournal\('(\w+)'/g)) if (!new RegExp(`kind: '${m[1]}'`).test(src)) missing.push(`${t}: ${m[1]}`)
    }
    expect(missing).toEqual([])
  })
  it('every row is well formed: a known type, a key once per widget, its choices or where they come from, a number\'s range', () => {
    const TYPES = ['enum', 'boolean', 'number', 'day', 'set', 'color', 'action']
    for (const t of Object.keys(WIDGET_REGISTRY)) {
      const rows = ownControls(t)
      expect(new Set(rows.map(c => c.key)).size, t).toBe(rows.length)
      for (const c of rows) {
        expect(TYPES, `${t}.${c.key}`).toContain(c.type)
        if (c.type === 'enum' || c.type === 'set') expect(c.from === 'door' || c.options?.length > 0, `${t}.${c.key}`).toBe(true)
        if (c.type === 'number') expect(c.min < c.max, `${t}.${c.key}`).toBe(true)
      }
    }
  })
  it('a list the registry copies stays what the widget shows', () => {
    expect(ownControls('tradeExchangeNews').find(c => c.key === 'category').options).toEqual(CATEGORY_FILTERS)
    expect(ownControls('researchLibrary').find(c => c.key === 'category').options).toEqual(CATEGORY_FILTERS)
    const flow = read('pages/charts/widgets/OptionsFlowWidget.jsx')
    const prem = ownControls('optionsflow').find(c => c.key === 'minPremium').options
    expect([...flow.matchAll(/\{ v: (\d+), label:/g)].map(m => Number(m[1]))).toEqual(prem)
    for (const v of ['SWEEP', 'BLOCK', 'BULL', 'BEAR']) expect(flow).toContain(`k: '${v}'`)
    // every chip word the Agent says is the one on the chip: the premium chips are `{ v, label }`, the others `{ k, l }`
    for (const c of ownControls('optionsflow')) for (const [v, word] of Object.entries(c.shown || {})) {
      expect(flow).toContain(c.key === 'minPremium' ? `{ v: ${v}, label: '${word}' }` : `k: '${v}', l: '${word}'`)
    }
    expect(read('pages/ThemeTrackerPage.jsx')).toContain("'1W': '1w', '1M': '1m', '3M': '3m', '1Y': '1y', 'YTD': 'ytd'")
  })
  it('the rail can see what it checks (guards the parse above)', () => {
    expect(readdirSync(join(SRC, 'pages/charts/widgets')).length).toBeGreaterThan(10)
    expect(mounted.map(([t]) => t).sort()).toEqual(Object.keys(WIDGET_REGISTRY).filter(t => mounted.some(([m]) => m === t)).sort())
    expect(mounted.length).toBeGreaterThanOrEqual(20)
    expect(mounted.every(([, file]) => !!file), 'a mounted type with no component file').toBe(true)
    expect(Object.fromEntries(mounted).chart).toBe('pages/charts/widgets/ChartWidget.jsx')                         // a multi-line entry
    expect(Object.fromEntries(mounted).researchLibrary).toBe('pages/charts/widgets/TradeExchangeNewsWidget.jsx')   // the same component, a second type
    const news = optsReadsOf('pages/charts/widgets/TradeExchangeNewsWidget.jsx')
    for (const k of ['follow', 'linked', 'view', 'categories']) expect(news.has(k), k).toBe(true)
    expect(optsReadsOf('pages/charts/widgets/PeriodSortWidget.jsx').has('group')).toBe(true)
    // a child handed `opts={opts}` is read too: the Theme Tracker reads its basis and set from there, and no period
    const themes = optsReadsOf('pages/charts/widgets/ThemesWidget.jsx')
    expect(themes.has('todayBasis')).toBe(true)
    expect(themes.has('period')).toBe(false)
  })
})
