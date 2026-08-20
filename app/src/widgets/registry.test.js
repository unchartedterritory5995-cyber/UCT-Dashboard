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
  JOURNAL_MENU_TYPES,
  THEME_FOLLOW_TYPES,
  labelMap,
  normalizeParams,
  validateParams,
  paramsPlainText,
  isReconstructable,
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
      scanner:      { w: 8,  h: 10, minW: 2, minH: 4 },
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

  it('journal slash menu offers only types with an in-editor render path (v1: chart)', () => {
    expect(JOURNAL_MENU_TYPES).toEqual(['chart'])
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

// ═══════════════════════════════════════════════════════════════════════════
// PARAMS LAYER (Journal Widgets P2) — captureParams normalization, round-trip
// serialization, plain-text lines, reconstructable verdicts.
// ═══════════════════════════════════════════════════════════════════════════

// One representative live-state capture per widget type. These are the values
// a capture provider would hand normalizeParams — loose, over-full (stray keys
// a provider might leak), with everything the audit said each type freezes.
const CAPTURE_FIXTURES = {
  chart: { symbol: 'amd', tf: '5', from: 1710338700, to: 1710343800, settings: { chartType: 'candles', background: '#0f0f0f' }, _stray: true },
  watchlist: { watchKey: 'user:42', watchName: 'AI Leaders', watchTab: 'mine', settings: { bg: '#111' }, cols: { order: ['flag', 'sym'], sort: { key: 'chg', dir: 'desc' } }, symbols: ['NVDA', 'AMD'] },
  themes: { period: '1m', sortDir: 'desc', openTheme: 'Quantum Computing', search: '', selectedSym: 'IONQ', settings: { bg: '#101010' } },
  scanner: { scanKey: 'top-gainers-30d', scanName: 'Top Gainers (30d)', settings: { bg: '#111' }, cols: { order: ['sym'] }, asOf: '2026-08-11 13:26 ET' },
  fundamentals: { symbol: 'NVDA', view: 'quarterly', company: 'NVIDIA Corp', settings: { bg: '#141414' }, data: { annual: [{ label: 'FY25', eps_actual: 2.94, rev_actual: 130500 }], quarterly: [{ label: 'Q1 26', eps_actual: 0.81, eps_estimate: 0.75 }] } },
  breadth: { hiddenMetrics: ['naaim'], tileStyle: 'spark', settings: { bg: '#0f0f0f' }, row: { date: '2026-08-11', pct_above_50sma: 48.2 }, series: { pct_above_50sma: [44, 46, 48.2] }, updated: '1:26 PM ET' },
  aisearch: { thread: [{ id: 1, q: 'Why is SMCI moving today?', answer: 'Because…', citations: [] }], settings: { bg: '#101010' } },
  news: { symbol: 'NVDA', filter: 'up', company: 'NVIDIA Corp', settings: { bg: '#101010' }, events: [{ type: 'earnings', date: '2026-08-05', title: 'Q2 beat and raise', direction: 'up', move_pct: 6.1, source: 'desk' }] },
  profile: { symbol: 'NVDA', company: 'NVIDIA Corp', statYear: 2026, settings: { bg: '#101010' } },
  alerts: { alerts: [{ id: 'a1', sym: 'NVDA', direction: 'above', target_price: 190, levelAtCapture: 190, priceAtCapture: 182.4, isActive: true }], settings: { bg: '#101010' } },
  calendar: { date: '2026-08-06', econStars: 3, selectedSym: 'AMD', tbdOpen: false, sections: { bmo: { sortBy: 'mcap', sortDir: 'desc', showAll: false }, amc: { sortBy: 'im', sortDir: 'desc', showAll: true } }, settings: { bg: '#101010' } },
  optionsflow: { lead: 'tape', scope: 'symbol', symbol: 'NVDA', filters: { minPrem: 1000000, cp: 'C', type: 'all', dir: 'all' }, settings: { bg: '#101010' } },
  periodsort: { start: 20260706, end: 20260805, group: 'theme', settings: { bg: '#101010' }, colCfg: { order: ['flag', 'sym', 'periodchg'], sort: { key: 'periodchg', dir: 'desc' } } },
}

describe('widget registry — params layer', () => {
  it('every widget type declares a paramsSchema, plainText, reconstructable, and liveCapable', () => {
    for (const id of WIDGET_IDS) {
      const w = WIDGET_REGISTRY[id]
      expect(Array.isArray(w.paramsSchema), `${id}.paramsSchema`).toBe(true)
      expect(w.paramsSchema.length, `${id}.paramsSchema empty`).toBeGreaterThan(0)
      expect(typeof w.plainText, `${id}.plainText`).toBe('function')
      expect(['boolean', 'function'].includes(typeof w.reconstructable), `${id}.reconstructable`).toBe(true)
      expect(typeof w.liveCapable, `${id}.liveCapable`).toBe('boolean')
    }
  })

  it('round-trips capture → normalize → JSON → parse → validate for all 13 types', () => {
    for (const id of WIDGET_IDS) {
      const norm = normalizeParams(id, CAPTURE_FIXTURES[id])
      // Serialization round-trip must be lossless (the doc stores JSON).
      const revived = JSON.parse(JSON.stringify(norm))
      expect(revived, `round-trip for '${id}'`).toEqual(norm)
      const verdict = validateParams(id, revived)
      expect(verdict.ok, `validate for '${id}': ${JSON.stringify(verdict.errors)}`).toBe(true)
    }
  })

  it('normalize drops keys a provider leaked that are not in the schema', () => {
    const norm = normalizeParams('chart', CAPTURE_FIXTURES.chart)
    expect(norm._stray).toBeUndefined()
    expect(norm.symbol).toBe('AMD') // and coerces symbols to upper-case
  })

  it('normalize applies declared defaults and validate flags missing required keys', () => {
    expect(normalizeParams('news', { symbol: 'nvda' }).filter).toBe('all')
    expect(normalizeParams('chart', { symbol: 'AMD' }).tf).toBe('D')
    const bad = validateParams('chart', {})
    expect(bad.ok).toBe(false)
    expect(bad.errors.join(' ')).toMatch(/symbol/)
    // Unknown widget id: never throws, reports itself.
    expect(validateParams('nope', {}).ok).toBe(false)
  })

  it('validate tolerates unknown keys on stored params (forward compatibility)', () => {
    const norm = normalizeParams('news', CAPTURE_FIXTURES.news)
    const future = { ...norm, futureKnob: 'v2-only' }
    expect(validateParams('news', future).ok).toBe(true)
  })

  it('plain-text lines are stable and self-documenting', () => {
    expect(paramsPlainText('chart', normalizeParams('chart', CAPTURE_FIXTURES.chart))).toBe('[chart: AMD 5m]')
    expect(paramsPlainText('watchlist', normalizeParams('watchlist', CAPTURE_FIXTURES.watchlist))).toBe('[watchlist: AI Leaders — 2 symbols]')
    expect(paramsPlainText('breadth', normalizeParams('breadth', CAPTURE_FIXTURES.breadth))).toBe('[breadth: heatmap — 1:26 PM ET]')
    expect(paramsPlainText('optionsflow', normalizeParams('optionsflow', CAPTURE_FIXTURES.optionsflow))).toBe('[flow: NVDA · tape]')
    expect(paramsPlainText('calendar', normalizeParams('calendar', CAPTURE_FIXTURES.calendar))).toBe('[calendar: 2026-08-06]')
    expect(paramsPlainText('periodsort', normalizeParams('periodsort', CAPTURE_FIXTURES.periodsort))).toBe('[periodsort: 2026-07-06 → 2026-08-05 · theme]')
    expect(paramsPlainText('aisearch', normalizeParams('aisearch', CAPTURE_FIXTURES.aisearch))).toBe('[ai search: "Why is SMCI moving today?"]')
    // Unknown id degrades to a generic label, never throws (render chain rule).
    expect(paramsPlainText('nope', {})).toBe('[widget]')
  })

  it('chart reconstructability follows the per-timeframe fetch ceilings', () => {
    const now = Date.now()
    const daysAgo = (d) => Math.floor(now / 1000) - d * 86400
    // 1m: hard 60-day wall.
    expect(isReconstructable('chart', { symbol: 'A', tf: '1', to: daysAgo(30) })).toBe(true)
    expect(isReconstructable('chart', { symbol: 'A', tf: '1', to: daysAgo(90) })).toBe(false)
    // 5m: ~365 days.
    expect(isReconstructable('chart', { symbol: 'A', tf: '5', to: daysAgo(200) })).toBe(true)
    expect(isReconstructable('chart', { symbol: 'A', tf: '5', to: daysAgo(400) })).toBe(false)
    // Daily: any horizon, including string dates.
    expect(isReconstructable('chart', { symbol: 'A', tf: 'D', to: '2019-03-13' })).toBe(true)
    // No anchor at all (capture without a range): renderable from latest bars.
    expect(isReconstructable('chart', { symbol: 'A', tf: '15' })).toBe(true)
    // Custom intraday tfs with an anchor: BOTH durability rails skip them
    // (StockChart drops to=, the warm has no resample target) — never promise
    // a re-render the rails can't serve; archive instead.
    expect(isReconstructable('chart', { symbol: 'A', tf: '45', to: daysAgo(10) })).toBe(false)
    expect(isReconstructable('chart', { symbol: 'A', tf: '45' })).toBe(true)
    // Calendar joined chart on the live path (date-parameterized + backfilled
    // endpoints; CalendarEmbed restores the captured day).
    expect(isReconstructable('calendar', normalizeParams('calendar', CAPTURE_FIXTURES.calendar))).toBe(true)
    // AI search replays its CAPTURED thread (never re-queried) — live only
    // when a conversation actually exists.
    expect(isReconstructable('aisearch', normalizeParams('aisearch', CAPTURE_FIXTURES.aisearch))).toBe(true)
    expect(isReconstructable('aisearch', { thread: [] })).toBe(false)
    // Payload-frozen types (owner decision): the captured data renders
    // verbatim forever — live exactly when the payload exists.
    expect(isReconstructable('fundamentals', normalizeParams('fundamentals', CAPTURE_FIXTURES.fundamentals))).toBe(true)
    expect(isReconstructable('fundamentals', { symbol: 'NVDA' })).toBe(false)
    expect(isReconstructable('news', normalizeParams('news', CAPTURE_FIXTURES.news))).toBe(true)
    expect(isReconstructable('news', { symbol: 'NVDA', events: [] })).toBe(false)
    expect(isReconstructable('breadth', normalizeParams('breadth', CAPTURE_FIXTURES.breadth))).toBe(true)
    expect(isReconstructable('breadth', {})).toBe(false)
    // Alerts + scanner joined the payload-frozen set.
    expect(isReconstructable('alerts', normalizeParams('alerts', CAPTURE_FIXTURES.alerts))).toBe(true)
    expect(isReconstructable('alerts', { alerts: [] })).toBe(false)
    expect(isReconstructable('scanner', normalizeParams('scanner', { ...CAPTURE_FIXTURES.scanner, rows: [{ sym: 'NVDA', price: 224.1, chgPct: 3.0 }] }))).toBe(true)
    expect(isReconstructable('scanner', normalizeParams('scanner', CAPTURE_FIXTURES.scanner))).toBe(false)
    // Watchlist + themes joined via the PAGE-SEAM doors (panel batch 3):
    // frozen {sym, note, chgPct} rows render through FrozenList — live
    // exactly when the captured rows exist.
    expect(isReconstructable('watchlist', normalizeParams('watchlist', {
      ...CAPTURE_FIXTURES.watchlist, rows: [{ sym: 'NVDA', price: 224.1, chgPct: 3.0 }],
    }))).toBe(true)
    expect(isReconstructable('watchlist', normalizeParams('watchlist', CAPTURE_FIXTURES.watchlist))).toBe(false)
    expect(isReconstructable('themes', normalizeParams('themes', {
      ...CAPTURE_FIXTURES.themes, rows: [{ sym: 'SMH', note: 'Semiconductors', chgPct: 2.1 }],
    }))).toBe(true)
    expect(isReconstructable('themes', normalizeParams('themes', CAPTURE_FIXTURES.themes))).toBe(false)
    // Every OTHER non-chart type stays image-only.
    for (const id of WIDGET_IDS.filter(x => !['chart', 'calendar', 'aisearch', 'fundamentals', 'news', 'breadth', 'alerts', 'scanner', 'watchlist', 'themes'].includes(x))) {
      expect(isReconstructable(id, normalizeParams(id, CAPTURE_FIXTURES[id])), id).toBe(false)
    }
    // Unknown/removed widget type: image, never a re-render attempt.
    expect(isReconstructable('nope', {})).toBe(false)
  })

  it('only chart is live-capable in v1', () => {
    for (const id of WIDGET_IDS) {
      expect(WIDGET_REGISTRY[id].liveCapable, id).toBe(id === 'chart')
    }
  })
})
