import { describe, it, expect } from 'vitest'
import {
  parseBoard, serializeBoard, defaultBoard, MODE_SPLIT, SCAN_MODES, SCAN_LAYOUTS,
  CHART_WIDGET_ID, LIST_WIDGET_ID,
} from '../drillBoardPrefs'
import { listDirection } from './useScanDeck'

const SEED = { settings: { preset: 'uct' }, scanTemplate: 'scan' }
const chartOf = (b) => b.widgets.find(w => w.id === CHART_WIDGET_ID)

describe('Scan Deck board — mode and layout', () => {
  it('a fresh board opens in Focus mode with one chart', () => {
    const b = defaultBoard(SEED)
    expect(b.mode).toBe('focus')
    expect(b.layout).toBe('1')
  })
  it('mode and layout round-trip through the stored pref', () => {
    const b = { ...defaultBoard(SEED), mode: 'table', layout: 'dw', split: MODE_SPLIT.table }
    const back = parseBoard(serializeBoard(b), SEED)
    expect(back.mode).toBe('table')
    expect(back.layout).toBe('dw')
    expect(back.split).toBe(MODE_SPLIT.table)
  })
  it('an unknown mode or layout falls back rather than breaking the window', () => {
    const back = parseBoard(JSON.stringify({ mode: 'kanban', layout: '9', widgets: [] }), SEED)
    expect(back.mode).toBe('focus')
    expect(back.layout).toBe('1')
  })
  it('a pre-Scan-Deck pref (no mode, no layout) opens as Focus with one chart', () => {
    const old = JSON.stringify({ split: 300, widgets: [{ id: CHART_WIDGET_ID, opts: { tf: 'W' } }] })
    const back = parseBoard(old, SEED)
    expect(back.mode).toBe('focus')
    expect(back.layout).toBe('1')
    expect(chartOf(back).opts.tf).toBe('W')
  })
  it('a board stored by the first Scan Deck build (Scan / Groups) opens in Focus', () => {
    for (const mode of ['scan', 'groups']) {
      expect(parseBoard(JSON.stringify({ mode, widgets: [] }), SEED).mode).toBe('focus')
    }
  })
  it('every mode has a list width inside the split travel', () => {
    for (const m of SCAN_MODES) expect(MODE_SPLIT[m]).toBeGreaterThan(0)
    expect(SCAN_LAYOUTS).toEqual(['1', 'dw', '4'])
  })
})

describe('Scan Deck board — the chart template seed', () => {
  it('⭐ a member who never customised the drill chart gets the lean scan look, not their /charts stack', () => {
    const old = JSON.stringify({ split: 340, widgets: [{ id: CHART_WIDGET_ID, opts: {} }] })
    expect(chartOf(parseBoard(old, SEED)).opts).toMatchObject(SEED)
  })
  it('a chart the member already customised in the drill keeps its own settings', () => {
    const mine = { preset: 'custom', mine: true }
    const old = JSON.stringify({ widgets: [{ id: CHART_WIDGET_ID, opts: { settings: mine } }] })
    expect(chartOf(parseBoard(old, SEED)).opts.settings).toEqual(mine)
  })
  it('choosing "My /charts settings" (settings null) survives a reopen', () => {
    const b = defaultBoard(SEED)
    b.widgets = b.widgets.map(w => (w.id === CHART_WIDGET_ID ? { ...w, opts: { settings: null, scanTemplate: 'global' } } : w))
    const back = chartOf(parseBoard(serializeBoard(b), SEED))
    expect(back.opts.settings).toBeNull()
    expect(back.opts.scanTemplate).toBe('global')
  })
  it('⛔ the chart\'s own tab strip is dropped — layouts replace it', () => {
    const old = JSON.stringify({ widgets: [{ id: CHART_WIDGET_ID, opts: { chartTabs: [{ id: 'ct1', tf: 'D' }], activeChartTab: 1, mainTabName: 'x' } }] })
    const opts = chartOf(parseBoard(old, SEED)).opts
    expect(opts.chartTabs).toBeUndefined()
    expect(opts.activeChartTab).toBeUndefined()
    expect(opts.mainTabName).toBeUndefined()
  })
  it('the list stays a breadth drill list whatever the pref says', () => {
    const old = JSON.stringify({ widgets: [{ id: LIST_WIDGET_ID, opts: { source: 'saved' } }] })
    expect(parseBoard(old, SEED).widgets.find(w => w.id === LIST_WIDGET_ID).opts.source).toBe('breadthDrill')
  })
})

describe('listDirection', () => {
  it('reads the direction from the list key', () => {
    expect(listDirection('up_4pct_today_list')).toBe(1)
    expect(listDirection('down_4pct_today_list')).toBe(-1)
    expect(listDirection('new_52w_lows_list')).toBe(-1)
    expect(listDirection('stage4_list')).toBe(-1)
    expect(listDirection('magna_down_list')).toBe(-1)
    expect(listDirection('new_52w_highs_list')).toBe(1)
    expect(listDirection('stage2_list')).toBe(1)
    expect(listDirection(undefined)).toBe(1)
  })
})
