import { describe, it, expect } from 'vitest'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { chartSurfacesOf, countOtherCharts, applyAppearanceToOtherCharts } from './chartAppearanceAll'

// "Apply to all charts" across one layout: every OTHER chart surface (base chart widgets, their extra chart tabs, a chart
// in another widget's tabs) wears the source look; each keeps its own symbol group, timeframe, indicators, panes, compare
// symbols and drawings state; non-chart widgets and the source itself are untouched.

const LOOK = () => mergeChartSettings({ background: '#010203', chartType: 'bars', grid: { color: '#444444', lines: 'vertical' }, sessionBreaks: true, header: { titleMode: 'company' } })
const own = (id) => ({ indicatorInstances: [{ instanceId: `${id}-rsi`, defId: 'rsi', inputs: {} }], comparisonSymbols: [{ sym: `${id.toUpperCase()}X`, enabled: true }], paneOrder: ['price', `${id}-rsi`], paneSizes: { [`${id}-rsi`]: 0.25 }, hideDrawings: true, logScale: true, header: { infoValues: [{ instanceId: `${id}-rsi`, plotKey: 'rsi', format: 'value' }], timeframes: ['5'] } })
const LAYOUT = () => [
  { id: 'src', type: 'chart', color: 'A', opts: { tf: 'D', settings: { background: '#ffffff' } } },
  { id: 'c2', type: 'chart', color: 'B', opts: { tf: '5', watermarkPos: { x: 0.2, y: 0.3 }, settings: own('c2'),
    chartTabs: [{ id: 'ct1', tf: '15', color: 'C', settings: own('ct1') }, { id: 'ct2', tf: 'W', settings: null }] } },
  { id: 'c3', type: 'chart', color: 'A', opts: { tf: '60' } },                                   // never edited: inherits the seed
  { id: 'wl', type: 'watchlist', color: 'A', opts: { settings: { textColor: '#999999' } },
    wtabs: [{ id: 'wt1', type: 'chart', color: 'D', opts: { tf: 'M', settings: own('wt1') } }, { id: 'wt2', type: 'news', opts: {} }] },
]
const SEED = mergeChartSettings({ textSize: 12, indicatorInstances: [{ instanceId: 'seed-ma', defId: 'sma', inputs: {} }] })

describe('chartAppearanceAll', () => {
  it('finds every chart surface, addressed the way ChartWidget knows itself', () => {
    expect(chartSurfacesOf(LAYOUT())).toEqual([
      { chartId: 'src', tabId: null },
      { chartId: 'c2', tabId: null }, { chartId: 'c2', tabId: 'ct1' }, { chartId: 'c2', tabId: 'ct2' },
      { chartId: 'c3', tabId: null },
      { chartId: 'wl:wt1', tabId: null },
    ])
    expect(countOtherCharts(LAYOUT(), { chartId: 'src', tabId: null })).toBe(5)
    expect(countOtherCharts(LAYOUT(), { chartId: 'c2', tabId: 'ct1' })).toBe(5)
    expect(countOtherCharts(LAYOUT(), { chartId: 'nope', tabId: null })).toBe(null)      // not in this layout → no door
    expect(countOtherCharts([LAYOUT()[0]], { chartId: 'src', tabId: null })).toBe(0)     // the only chart
  })

  it('every other chart wears the look; each keeps its symbol group, timeframe, indicators, panes, compare symbols and drawings', () => {
    const before = LAYOUT()
    const { widgets, count } = applyAppearanceToOtherCharts(before, { chartId: 'src', tabId: null }, LOOK(), SEED)
    expect(count).toBe(5)
    const by = Object.fromEntries(widgets.map((w) => [w.id, w]))
    const surfaces = [
      ['c2', by.c2.opts.settings, own('c2')], ['ct1', by.c2.opts.chartTabs[0].settings, own('ct1')],
      ['wt1', by.wl.wtabs[0].opts.settings, own('wt1')],
    ]
    for (const [id, s, mine] of surfaces) {
      const cs = mergeChartSettings(s)
      expect(cs.background, id).toBe('#010203')
      expect(cs.chartType, id).toBe('bars')
      expect(cs.grid.lines, id).toBe('vertical')
      expect(cs.sessionBreaks, id).toBe(true)
      expect(cs.header.titleMode, id).toBe('company')
      expect(s.indicatorInstances, id).toEqual(mine.indicatorInstances)
      expect(s.comparisonSymbols, id).toEqual(mine.comparisonSymbols)
      expect(s.paneOrder, id).toEqual(mine.paneOrder)
      expect(s.paneSizes, id).toEqual(mine.paneSizes)
      expect(s.hideDrawings, id).toBe(true)
      expect(s.logScale, id).toBe(true)
      expect(s.header.infoValues, id).toEqual(mine.header.infoValues)
      expect(s.header.timeframes, id).toEqual(['5'])
    }
    // timeframes, link groups, names, the watermark position: untouched
    expect(by.c2.opts.tf).toBe('5'); expect(by.c2.color).toBe('B'); expect(by.c2.opts.watermarkPos).toEqual({ x: 0.2, y: 0.3 })
    expect(by.c2.opts.chartTabs.map((t) => [t.id, t.tf, t.color])).toEqual([['ct1', '15', 'C'], ['ct2', 'W', undefined]])
    expect(by.wl.wtabs[0].opts.tf).toBe('M'); expect(by.wl.wtabs[0].color).toBe('D')
    // a never-edited chart starts from the seed (what it showed) and keeps the seed's indicators
    for (const s of [by.c3.opts.settings, by.c2.opts.chartTabs[1].settings]) {
      expect(s.background).toBe('#010203')
      expect(s.indicatorInstances).toEqual(SEED.indicatorInstances)
    }
    expect(by.c3.opts.tf).toBe('60')
    // the source and every non-chart widget / tab are the same objects
    expect(by.src).toBe(before[0])
    expect(by.wl.opts).toBe(before[3].opts)
    expect(by.wl.wtabs[1]).toBe(before[3].wtabs[1])
  })

  it('a source inside chart tabs is skipped, its siblings are not', () => {
    const { widgets, count } = applyAppearanceToOtherCharts(LAYOUT(), { chartId: 'c2', tabId: 'ct1' }, LOOK(), SEED)
    expect(count).toBe(5)
    const c2 = widgets.find((w) => w.id === 'c2')
    expect(c2.opts.chartTabs[0].settings).toEqual(own('ct1'))
    expect(mergeChartSettings(c2.opts.settings).background).toBe('#010203')
    expect(mergeChartSettings(widgets[0].opts.settings).background).toBe('#010203')
  })

  it('no other chart, or a source that is not in the layout: nothing changes (same array)', () => {
    const one = [LAYOUT()[0]]
    expect(applyAppearanceToOtherCharts(one, { chartId: 'src', tabId: null }, LOOK(), SEED)).toEqual({ widgets: one, count: 0 })
    const all = LAYOUT()
    expect(applyAppearanceToOtherCharts(all, { chartId: 'other-layout-chart', tabId: null }, LOOK(), SEED).widgets).toBe(all)
  })
})
