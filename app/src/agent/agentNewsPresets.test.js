// NEWS FILTER PRESETS (C3-140, agent/pl/news-filter-presets) — unit rails beside the outcome test
// (qa/chartsOutcome/newsPresets.outcome.test.jsx, which runs the real widget):
//   1. the Agent's limits are the widget's own (its menu's 12, its name box's 40), read from the product's source
//   2. class-generated routing: a request that names one of the member's presets beside a preset word brings the board's
//      one-control action (boardEdit) to the model on the FIRST call, whether or not the widget is named
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ITEM_LISTS, AGENT_CONTROLS, itemNamedTypes } from './widgetNames'
import { selectGroups } from './routing'
import { MAX_PRESETS } from '../pages/charts/widgets/tradeExchangeNewsModel'

const here = dirname(fileURLToPath(import.meta.url))
const src = (p) => readFileSync(join(here, '..', p), 'utf8')
const list = ITEM_LISTS.tradeExchangeNews.find(l => l.key === 'presets')
const row = AGENT_CONTROLS.tradeExchangeNews.find(f => f.key === 'preset')

describe('the Agent\'s preset limits are the widget\'s own', () => {
  it('at most MAX_PRESETS presets (the Filters menu hides its Save box at that count)', () => {
    expect(list.max).toBe(MAX_PRESETS)
    expect(src('pages/charts/widgets/TradeExchangeNewsParts.jsx')).toMatch(/presets\.length < MAX_PRESETS/)
  })
  it('a name of at most the name box\'s maxLength (every preset name box in the menu: save and rename, both layouts)', () => {
    const boxes = src('pages/charts/widgets/TradeExchangeNewsParts.jsx').split('\n').filter(l => /maxLength=\{\d+\}/.test(l))
    expect(boxes.length).toBe(4)
    for (const l of boxes) expect(l, l.trim()).toContain(`maxLength={${list.nameMax}}`)
  })
  it('the door enforces the same limits (a write past them changes nothing)', () => {
    const w = src('pages/charts/widgets/TradeExchangeNewsWidget.jsx')
    expect(w).toMatch(new RegExp(`name\\.length <= ${list.nameMax} && presets\\.length < MAX_PRESETS\\) savePreset\\(name\\)`))
    expect(w).toMatch(new RegExp(`name\\.length <= ${list.nameMax}\\) renamePreset\\(v\\.id, name\\)`))
  })
  it('applying a preset puts the search box back on Undo (carries), its opts go back whole (inOpts)', () => {
    expect(row).toMatchObject({ type: 'enum', from: 'door', door: true, inOpts: true, carries: ['search'] })
    expect(AGENT_CONTROLS.tradeExchangeNews.some(f => f.key === 'search' && f.door && !f.inOpts)).toBe(true)
  })
})

// ── class-generated routing ──
const NAMES = ['Macro', 'Earnings Watch', 'Opening Bell']
const names = { widgetTypes: ['chart', 'tradeExchangeNews'], widgetItems: [{ type: 'tradeExchangeNews', key: 'presets', names: NAMES }] }
const APPLY = ['use my {n} preset', 'apply the {n} preset', 'switch to my {n} preset', 'load the {n} filter preset', 'put my {n} preset on', 'turn on the {n} preset']
const MANAGE = ['rename my {n} preset to Later', 'delete the {n} preset', 'remove my {n} filter preset']
const WIDGET = ['', ' in the news', ' on the news widget']
const phrasings = [...APPLY, ...MANAGE].flatMap(t => NAMES.flatMap(n => WIDGET.map(w => `${t.replace('{n}', n)}${w}`)))

describe('class-generated routing: a preset named beside a preset word routes to the board\'s controls', () => {
  it(`all ${phrasings.length} phrasings route boardEdit on the first call`, () => {
    const missed = phrasings.filter(q => !selectGroups(q, { names }).selected.includes('boardEdit'))
    expect(missed).toEqual([])
  })
  it('the News widget is the one reached by its own preset names (itemNamedTypes)', () => {
    for (const q of phrasings) expect(itemNamedTypes(q, names.widgetItems), q).toEqual(['tradeExchangeNews'])
  })
  it('a name that is not one of the member\'s presets does not reach the widget by name', () => {
    expect(itemNamedTypes('use my Biotech preset', names.widgetItems)).toEqual([])
  })
})
