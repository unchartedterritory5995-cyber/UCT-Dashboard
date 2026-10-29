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
const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')

// templated ids: the attribute is written once for a list the product owns (the tools, the widget menu, the tabs)
const TEMPLATES = [
  { prefix: 'chart.tool.', attr: 'data-guide={`chart.tool.${t.id}`}', ids: () => TOOLS.filter(t => t !== 'sep').map(t => t.id) },
  { prefix: 'workspace.widgets.', attr: 'data-guide={`workspace.widgets.${t}`}', ids: () => menuGroups('workspace').flatMap(g => g.items) },
  { prefix: 'chartSettings.tab.', attr: 'data-guide={`chartSettings.tab.${id}`}', ids: () => ['price', 'canvas', 'indicators', 'header', 'markers'] },
]
function targetsOf(f) {
  return f.steps.flatMap(s => [s.target, s.waitFor]).filter(Boolean)
}

describe('every walkthrough points at a real control', () => {
  for (const f of GUIDE_FEATURES) {
    it(`${f.id}: each target is rendered by the product`, () => {
      for (const t of targetsOf(f)) {
        if (typeof t === 'object' && t.widgetType) { expect(source).toContain('data-widget-type={w.type}'); continue }
        if (typeof t === 'object' && t.within) {
          expect(source, t.within).toContain(`data-guide="${t.within}"`)
          expect(source, t.aria).toContain(`aria-label="${t.aria}"`)
          continue
        }
        const tpl = TEMPLATES.find(x => t.startsWith(x.prefix))
        if (tpl) {
          expect(source, t).toContain(tpl.attr)
          expect(tpl.ids(), t).toContain(t.slice(tpl.prefix.length))
          continue
        }
        expect(source, t).toContain(`data-guide="${t}"`)
      }
    })
  }
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
    ['how do I save my layout', 'layouts'],
    ['how do I draw a trendline', 'drawing'],
    ['where are the chart settings', 'settings'],
  ])('%s → %s', (q, id) => { expect(matchFeature(q)?.id).toBe(id) })
})
