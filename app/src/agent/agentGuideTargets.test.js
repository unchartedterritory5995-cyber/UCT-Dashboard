// PHASE 2 Workstream B — the product guide's registry is REAL: every control a walkthrough points at is a control
// the product renders (its `data-guide` attribute is in the source, or its accessible name inside a registered
// container), every feature's capabilities are registered, and the guide never advertises a feature whose
// capabilities this member cannot use.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { allCapabilityNames, getCapability } from './capabilities'
import { GUIDE_FEATURES, guideFeatures, matchFeature } from './guide/registry'
import { TOPICS } from './discovery'
import { TOOLS } from '../components/chart/ChartToolbar'
import { menuGroups } from '../widgets/registry'

registerBuiltins()
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name) && !p.includes(`${path.sep}agent${path.sep}`)) files.push(p)
  }
})(SRC)
import { SLOTS, DRAWING_TOOLS, GRID_PRESETS } from './guide/slots'
import { LAYOUTS } from '../pages/charts/grid/gridLayouts'
const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')

// templated ids: the attribute is written once for a list the product owns (the tools, the widget menu, the tabs)
const TEMPLATES = [
  { prefix: 'chart.tool.', attr: 'data-guide={`chart.tool.${t.id}`}', ids: () => TOOLS.filter(t => t !== 'sep').map(t => t.id) },
  { prefix: 'workspace.widgets.', attr: 'data-guide={`workspace.widgets.${t}`}', ids: () => menuGroups('workspace').flatMap(g => g.items) },
  { prefix: 'chartSettings.tab.', attr: 'data-guide={`chartSettings.tab.${id}`}', ids: () => ['price', 'canvas', 'indicators', 'header', 'markers'] },
  { prefix: 'multiChart.preset.', attr: 'data-guide={`multiChart.preset.${l.id}`}', ids: () => LAYOUTS.map(l => l.id) },
  { prefix: 'widget.resize.', attr: 'data-guide={`widget.resize.${dir}`}', ids: () => ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] },
]
// a family's steps are checked for every row its slots offer ({tool.id} → each tool); {ind.*} is the live catalog's
const filled = (v, row, slot) => JSON.parse(JSON.stringify(v).replace(new RegExp(`\\{${slot}\\.(\\w+)\\}`, 'g'), (_m, k) => String(row[k] ?? '')))
function expand(steps, f) {
  let out = steps
  for (const name of f.slots || []) {
    const rows = SLOTS[name].rows
    // { each: 'slot' } takes the row's own steps (guide/actions.js)
    if (rows) out = rows.flatMap(row => out.flatMap(s => (s.each === name ? row.steps : [s])).map(s => filled(s, row, name)))
  }
  return out
}
const flat = (t) => (Array.isArray(t) ? t.flatMap(flat) : t && typeof t === 'object' && t.not ? flat(t.not) : t ? [t] : [])
function targetsOf(f) {
  return expand(f.steps, f).flatMap(s => [...flat(s.target), ...flat(s.waitFor), ...flat(s.also)])
}

describe('every walkthrough points at a real control', () => {
  // the named-control catalog has its own rail, which also reads each control's accessible name (agentGuideControls.test.js)
  for (const f of GUIDE_FEATURES.filter(x => x.id !== 'control')) {
    it(`${f.id}: each target is rendered by the product`, () => {
      for (let t of targetsOf(f)) {
        if (typeof t === 'object' && t.widgetType) {
          expect(source).toContain('data-widget-type={w.type}')
          if (t.guide) expect(source, t.guide).toContain(`data-guide="${t.guide}"`)
          // a column title is named from its label: aria-label={`Sort by ${label}`}
          if (t.aria) expect(source.includes(`aria-label="${t.aria}"`) || (/^Sort by /.test(t.aria) && source.includes('aria-label={`Sort by ${label}`}')), t.aria).toBe(true)
          continue
        }
        if (typeof t === 'object' && t.inWidget) { expect(source, t.inWidget).toContain(`data-guide="${t.inWidget}"`); continue }
        if (typeof t === 'object' && t.within) {
          expect(source.includes(`data-guide="${t.within}"`) || source.includes(`guide="${t.within}"`), t.within).toBe(true)
          if (t.guide) { expect(source, t.guide).toContain(`data-guide="${t.guide}"`); continue }
          if (t.label) continue   // an on-screen label: proved row by row in the browser (teach-status.md), not by grep
          if (t.cursor) continue  // the chart library's own pane divider: proved in the browser, it is not in our source
          // a menu row: a literal id, or chipMenu.js's own key, or the location row's template
          if (t.attr === 'data-menu-id') { expect(source.includes(`data-menu-id="${t.value}"`) || source.includes(`key: '${t.value}'`) || String(t.value).startsWith('settings-'), t.value).toBe(true); continue }
          if (t.attr) { expect(source, t.attr).toMatch(new RegExp(`${t.attr}[={ ]|${t.attr}$|${t.attr}\\s`, 'm')); continue }
          // PickerHeader names its ＋ New button from the picker's `newTitle` (aria-label={newTitle})
          expect(source.includes(`aria-label="${t.aria}"`) || source.includes(`aria-label={\`${t.aria}`) || source.includes(`newTitle="${t.aria}"`) || (/^Add another /.test(t.aria) && source.includes('aria-label={`Add another ${row.name}`}')), t.aria).toBe(true)
          continue
        }
        if (typeof t === 'object' && t.id) { t = t.id }
        const tpl = TEMPLATES.find(x => t.startsWith(x.prefix))
        if (tpl) {
          expect(source, t).toContain(tpl.attr)
          expect(tpl.ids(), t).toContain(t.slice(tpl.prefix.length))
          continue
        }
        expect(source.includes(`data-guide="${t}"`) || source.includes(`'data-guide': '${t}'`) || source.includes(`guide="${t}"`), t).toBe(true)
      }
    })
  }
})

describe('the families match the product', () => {
  it('every drawing tool on the toolbar has a slot row, and every row a tool', () => {
    expect(DRAWING_TOOLS.map(t => t.id).sort()).toEqual(TOOLS.filter(t => t !== 'sep').map(t => t.id).sort())
  })
  it('every Multi Chart preset has a slot row', () => {
    expect(GRID_PRESETS.map(t => t.id).sort()).toEqual(LAYOUTS.map(l => l.id).sort())
  })
})

describe('the registry is not a second source of truth', () => {
  it('every feature names registered capabilities and an existing discovery topic', () => {
    const reg = new Set(allCapabilityNames())
    const topics = new Set(TOPICS.map(t => t.id))
    for (const f of GUIDE_FEATURES) {
      expect(f.caps.every(c => reg.has(c)), f.id).toBe(true)
      expect(topics.has(f.topic), f.id).toBe(true)
      if (f.doIt?.action) expect(reg.has(f.doIt.action), f.id).toBe(true)
      expect(f.explain.length).toBeGreaterThan(20)
    }
  })
  it('the guide capabilities are queries — they can never change the workspace — and are covered by discovery', () => {
    for (const n of ['guide.explain', 'guide.show']) {
      const c = getCapability(n)
      expect(c.query).toBe(true)
      expect(typeof c.apply).toBe('undefined')
      expect(TOPICS.some(t => t.caps.includes(n))).toBe(true)
    }
  })
  it('a member who cannot manage indicators is not shown the indicator walkthrough', () => {
    const all = guideFeatures({ surface: 'charts', manageIndicators: true, createIndicator: true }).map(f => f.id)
    const none = guideFeatures({ surface: 'charts', manageIndicators: false }).map(f => f.id)
    expect(all).toContain('indicators')
    expect(none).not.toContain('indicators')
    expect(none).toContain('timeframe')
  })
  it.each([
    ['Where do I change the timeframe?', 'timeframe'],
    ['show me where to add an indicator', 'indicators'],
    ['how do i change the symbol', 'symbol'],
    ['how do I add another chart', 'charts'],
    ['how do i use watchlists', 'watchlists'],
    ['show me how to create a watchlist', 'watchlistCreate'],
    ['how do I save my layout', 'layoutSave'],
    ['how do I draw a trendline', 'drawing'],
    ['where are the chart settings', 'settings'],
  ])('%s → %s', (q, id) => { expect(matchFeature(q)?.id).toBe(id) })
})
