// ⛔ DISCOVERY HONESTY (11-17) — the Agent never answers "Not yet." for something it can do, and never claims what it can't.
// GENERATED over discovery.js's own lists and the chart-settings descriptor table (never a hand list of topics):
//   CAN DO    every capability a topic's canDo describes (`caps`) is REGISTERED; a topic with a canDo has at least one.
//   NOT YET   every "not yet" item a topic lists (`known()`) has a NOT_YET entry naming the capability it would take, and
//             NONE of those is registered — so a capability that lands while its item is still listed fails here.
//   SETTINGS  every `known` descriptor row says why: `legacyOf` a row the Agent writes (eligible / specialized — and such a
//             row is never listed to the member), or `wouldBe` names that are neither registered nor an eligible row.
//             Every `specialized:<cap>` row names a registered capability.
// (It caught: flagging = watchlist.setFlag, a drawing's Save as default = drawing.saveDefaults, sorting a list by a column =
//  watchlist.sortColumn, trendline alerts = drawing.setAlert, ETF holdings = widget.setOption holdingsOpen, favorite / custom timeframes and the default drawing style.)
import { describe, it, expect, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { allCapabilityNames, getCapability } from './capabilities'
import { TOPICS, NOT_YET, answerTopic } from './discovery'
import { CHART_SETTING_DESCRIPTORS, settingDescriptor } from '../components/chart/chartSettingsDescriptors'

vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
registerBuiltins()
const REG = new Set(allCapabilityNames())
// writable = an eligible / specialized descriptor row, or a setting chart.setSetting takes (its LIST settings: header.fields …)
const SET_SETTING = new Set(getCapability('chart.setSetting').args.properties.setting.enum)
const WRITABLE = (id) => { const d = settingDescriptor(id); return SET_SETTING.has(id) || (!!d && (d.agent === 'eligible' || d.agent.startsWith('specialized:'))) }

// the chart-settings topic lists the known descriptor rows itself (knownSettings): those are held by SETTINGS below
const SETTINGS_TOPIC = 'chartSettings'
const ITEMS = TOPICS.filter(t => t.id !== SETTINGS_TOPIC).flatMap(t => (t.known ? t.known() : []).map(item => [t.id, item]))
const CAPS = TOPICS.flatMap(t => (t.caps || []).map(c => [t.id, c]))
const KNOWN_ROWS = CHART_SETTING_DESCRIPTORS.filter(d => d.agent === 'known')

describe('CAN DO: every capability a topic claims is registered', () => {
  it('generated over every topic', () => expect(CAPS.length).toBeGreaterThan(100))
  it.each(CAPS)('%s claims %s', (_t, cap) => expect(REG.has(cap), cap).toBe(true))
  it.each(TOPICS.filter(t => t.canDo).map(t => [t.id, t]))('%s: a canDo describes at least one registered capability', (_id, t) => {
    expect((t.caps || []).filter(c => REG.has(c)).length).toBeGreaterThan(0)
  })
})

describe('NOT YET: every "not yet" item names what it would take, and none of it is registered', () => {
  it('generated over every topic\'s known list', () => expect(ITEMS.length).toBeGreaterThan(15))
  it.each(ITEMS)('%s: "%s"', (_t, item) => {
    const would = NOT_YET[item]
    expect(would, `no NOT_YET entry for "${item}" — name the capability it would take`).toBeTruthy()
    expect(would.length).toBeGreaterThan(0)
    for (const c of would) expect(REG.has(c), `"${item}" is listed as not yet, but ${c} is registered — drop the item or reword it`).toBe(false)
  })
  it('no stale NOT_YET entry (each is an item a topic lists)', () => {
    const listed = new Set(ITEMS.map(([, i]) => i))
    for (const k of Object.keys(NOT_YET)) expect(listed.has(k), k).toBe(true)
  })
})

describe('SETTINGS: a known row says why; a writable row is never "not yet"', () => {
  it.each(KNOWN_ROWS.map(d => [d.id, d]))('%s', (_id, d) => {
    expect(!!d.legacyOf || Array.isArray(d.wouldBe), `${d.id}: add legacyOf or wouldBe (chartSettingsDescriptors KNOWN_WHY)`).toBe(true)
    if (d.legacyOf) expect(WRITABLE(d.legacyOf), `${d.id} is a legacy input of ${d.legacyOf}, which must be writable`).toBe(true)
    for (const w of d.wouldBe || []) {
      expect(REG.has(w), `${d.id} would be ${w}, which is registered`).toBe(false)
      expect(WRITABLE(w), `${d.id} would be ${w}, which is already a writable row`).toBe(false)
    }
  })
  it.each(CHART_SETTING_DESCRIPTORS.filter(d => d.agent.startsWith('specialized:')).map(d => [d.id, d.agent]))('%s → %s is registered', (_id, agent) => {
    expect(REG.has(agent.slice('specialized:'.length))).toBe(true)
  })
  it('the settings answer lists no legacy row and none of the specialized ones', () => {
    const t = TOPICS.find(x => x.id === SETTINGS_TOPIC)
    const listed = t.known()
    for (const d of CHART_SETTING_DESCRIPTORS.filter(x => x.legacyOf || x.agent.startsWith('specialized:'))) {
      if (d.label) expect(listed, d.id).not.toContain(d.label)
    }
    expect(answerTopic(t).text).not.toMatch(/Favorite timeframes|Custom timeframes|Default drawing style|legacy on\/off|Info row fields/)
  })
})

describe('the fixed answers (what a member reads)', () => {
  const ans = (id) => answerTopic(TOPICS.find(t => t.id === id)).text
  it('watchlists: flagging and sorting by a column are no longer "not through me yet"', () => {
    expect(ans('watchlists')).not.toMatch(/flagging|sorting a list/i)
    expect(ans('watchlists')).toMatch(/tags and colors/)
  })
  it('stock info: an ETF’s holdings is something I can do (widget.setOption holdingsOpen), not "not yet"', () => {
    expect(ans('stockInfo')).toMatch(/holdings on its chart/)
    expect(ans('stockInfo').split('In UCT itself')[1]).not.toMatch(/ETF holdings/)
  })
  it('drawings: Save as default is no longer listed as done on the chart', () => expect(ans('drawings').split('In UCT itself')[1]).not.toMatch(/Save as default/))
  it('alerts: a drawing\'s alert is something I can do; trendline alerts are not "not yet"', () => {
    expect(ans('alerts')).toMatch(/alert that follows a drawing/)
    expect(ans('alerts')).not.toMatch(/trendline alerts \(owned/)
  })
})
