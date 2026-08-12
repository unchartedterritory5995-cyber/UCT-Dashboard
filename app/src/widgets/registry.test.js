// Characterization rail for the widget metadata registry.
//
// Before this registry existed, a widget type was FOUR hand-synced tables
// (WIDGET_DEFAULTS / WIDGET_TYPES+WIDGET_LABELS in ChartsWorkspace.jsx, the
// WidgetBody switch + TYPE_LABEL in WidgetHost.jsx, WIDGET_TAB_* in
// widgetTabs.js) plus two stragglers (WidgetHost's themeFollow array,
// MobileWorkspace's own 5-entry label map). The literals below are those
// tables' exact contents at extraction time — this file is the rail that the
// derived views keep serving byte-identical menus, labels, and sizes.
//
// If a value here needs to change, change it in registry.js and update the
// pin here to match — this test exists to make that a DECISION, not a drift.
import { describe, it, expect } from 'vitest'
import {
  WIDGET_REGISTRY,
  WIDGET_IDS,
  WORKSPACE_MENU_TYPES,
  TAB_MENU_TYPES,
  MOBILE_MENU_TYPES,
  THEME_FOLLOW_TYPES,
  labelMap,
} from './registry'
import { WORKSPACE_WIDGETS } from '../pages/charts/WidgetHost'

const IDS = [
  'chart', 'watchlist', 'themes', 'scanner', 'fundamentals', 'breadth',
  'aisearch', 'news', 'profile', 'alerts', 'calendar', 'optionsflow',
  'periodsort',
]

describe('widget registry — metadata pins', () => {
  it('registers exactly the 13 workspace widget types, in menu order', () => {
    expect(WIDGET_IDS).toEqual(IDS)
  })

  it('header labels match the retired WidgetHost TYPE_LABEL map', () => {
    expect(labelMap('header')).toEqual({
      chart: 'Chart', watchlist: 'Watchlist', themes: 'Themes',
      scanner: 'Scanner', fundamentals: 'Fundamentals', breadth: 'Breadth',
      aisearch: 'AI Search', news: 'News', profile: 'Profile',
      alerts: 'Alerts', calendar: 'Calendar', optionsflow: 'Options Flow',
      periodsort: 'Period Sort',
    })
  })

  it('menu labels match the retired WIDGET_LABELS / WIDGET_TAB_MENU_LABEL maps', () => {
    expect(labelMap('menu')).toEqual({
      chart: 'Chart', watchlist: 'Watchlist', themes: 'Theme Tracker',
      scanner: 'Scanner', fundamentals: 'Fundamentals', breadth: 'Breadth',
      aisearch: 'AI Search', news: 'News & Catalysts', profile: 'Stock Profile',
      alerts: 'Alerts', calendar: 'Calendar', optionsflow: 'Options Flow',
      periodsort: 'Period Sort',
    })
  })

  it('tab-chip labels match the retired WIDGET_TAB_LABEL map (Flow shortening)', () => {
    expect(labelMap('tab')).toEqual({
      chart: 'Chart', watchlist: 'Watchlist', themes: 'Themes',
      scanner: 'Scanner', fundamentals: 'Fundamentals', breadth: 'Breadth',
      aisearch: 'AI Search', news: 'News', profile: 'Profile',
      alerts: 'Alerts', calendar: 'Calendar', optionsflow: 'Flow',
      periodsort: 'Period Sort',
    })
  })

  it('grid defaults match the retired WIDGET_DEFAULTS table', () => {
    const defaults = Object.fromEntries(WIDGET_IDS.map(id => [id, WIDGET_REGISTRY[id].defaults]))
    expect(defaults).toEqual({
      chart:        { w: 12, h: 12, minW: 6, minH: 6 },
      watchlist:    { w: 6,  h: 10, minW: 2, minH: 4 },
      themes:       { w: 6,  h: 10, minW: 2, minH: 4 },
      scanner:      { w: 8,  h: 10, minW: 6, minH: 4 },
      fundamentals: { w: 8,  h: 6,  minW: 6, minH: 2 },
      breadth:      { w: 8,  h: 10, minW: 4, minH: 4 },
      aisearch:     { w: 7,  h: 10, minW: 3, minH: 3 },
      news:         { w: 6,  h: 10, minW: 2, minH: 4 },
      profile:      { w: 6,  h: 12, minW: 3, minH: 5 },
      alerts:       { w: 6,  h: 10, minW: 2, minH: 4 },
      calendar:     { w: 6,  h: 10, minW: 2, minH: 4 },
      optionsflow:  { w: 8,  h: 12, minW: 4, minH: 5 },
      periodsort:   { w: 6,  h: 12, minW: 3, minH: 5 },
    })
  })

  it('periodsort is registered but excluded from both add menus (Tools-only door)', () => {
    expect(WORKSPACE_MENU_TYPES).toEqual([
      'chart', 'watchlist', 'themes', 'scanner', 'fundamentals', 'breadth',
      'aisearch', 'news', 'profile', 'alerts', 'calendar', 'optionsflow',
    ])
    expect(TAB_MENU_TYPES).toEqual(WORKSPACE_MENU_TYPES)
  })

  it('mobile offers exactly the 5 phone-usable types', () => {
    expect(MOBILE_MENU_TYPES).toEqual(['chart', 'watchlist', 'themes', 'scanner', 'fundamentals'])
  })

  it('every type except chart follows the app theme when uncustomized', () => {
    expect([...THEME_FOLLOW_TYPES].sort()).toEqual(IDS.filter(id => id !== 'chart').sort())
  })
})

describe('widget registry — workspace host bindings', () => {
  it('every registry id has a component binding in WidgetHost', () => {
    for (const id of WIDGET_IDS) {
      const b = WORKSPACE_WIDGETS[id]
      expect(b, `missing WORKSPACE_WIDGETS binding for '${id}'`).toBeTruthy()
      const kind = typeof b.component
      expect(kind === 'function' || kind === 'object', `component for '${id}'`).toBe(true)
      expect(typeof b.props, `props builder for '${id}'`).toBe('function')
    }
  })

  it('prop shapes are preserved exactly as the retired WidgetBody switch passed them', () => {
    // These shapes are load-bearing: breadth never received `color`, themes
    // never received `onOptsChange`, aisearch received ONLY `color`, and only
    // chart receives `chartId`. Uniform spreading would change behavior.
    const SPECIAL = {
      chart: ['chartId', 'color', 'onOptsChange', 'opts'],
      themes: ['color', 'opts'],
      breadth: ['onOptsChange', 'opts'],
      aisearch: ['color'],
    }
    const DEFAULT_SHAPE = ['color', 'onOptsChange', 'opts']
    const fn = () => {}
    for (const id of WIDGET_IDS) {
      const props = WORKSPACE_WIDGETS[id].props({ colorKey: 'A', opts: { x: 1 }, onOptsChange: fn, groupId: 'w-1' })
      expect(Object.keys(props).sort(), `prop shape for '${id}'`).toEqual(SPECIAL[id] || DEFAULT_SHAPE)
    }
  })

  it('threads the resolved color key and per-tab group id through', () => {
    const fn = () => {}
    const p = WORKSPACE_WIDGETS.chart.props({ colorKey: 'N:w-1', opts: { a: 1 }, onOptsChange: fn, groupId: 'w-1' })
    expect(p).toEqual({ color: 'N:w-1', opts: { a: 1 }, onOptsChange: fn, chartId: 'w-1' })
  })
})
