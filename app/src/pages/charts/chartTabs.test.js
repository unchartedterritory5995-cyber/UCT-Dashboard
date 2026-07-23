import { describe, it, expect } from 'vitest'
import {
  sanitizeChartTabs, chartTabList, addChartTab, closeChartTab,
  setActiveChartTab, renameChartTab, patchChartTab, uctDefaultTabSettings,
} from './chartTabs'

describe('chartTabs reducer', () => {
  it('a bare/empty opts is a single-chart widget (no extra tabs)', () => {
    expect(sanitizeChartTabs({}).tabs).toEqual([])
    expect(sanitizeChartTabs({}).active).toBe(0)
    expect(sanitizeChartTabs(undefined).tabs).toEqual([])
    // Only the main tab in the UI list, labeled by its timeframe.
    const list = chartTabList({ tf: 'D' })
    expect(list).toHaveLength(1)
    expect(list[0].isMain).toBe(true)
    expect(list[0].label).toBe('1D')
  })

  it('addChartTab appends a UCT-Default tab and makes it active', () => {
    const o1 = addChartTab({ tf: 'D' }, { color: 'B', tf: '30' })
    expect(o1.chartTabs).toHaveLength(1)
    expect(o1.activeChartTab).toBe(1) // the new last tab
    expect(o1.chartTabs[0].color).toBe('B')
    expect(o1.chartTabs[0].tf).toBe('30')
    expect(o1.chartTabs[0].name).toBeNull()
    // Full settings blob, equal to UCT Default.
    expect(o1.chartTabs[0].settings).toEqual(uctDefaultTabSettings())
    const list = chartTabList(o1)
    expect(list).toHaveLength(2)
    expect(list[1].label).toBe('30m') // auto label by tf
  })

  it('each added tab gets an independent settings object (no shared mutation)', () => {
    let o = addChartTab({ tf: 'D' }, { color: 'A', tf: 'D' })
    o = addChartTab(o, { color: 'A', tf: '5' })
    o.chartTabs[0].settings.chartType = 'line' // mutate tab 1's copy
    expect(o.chartTabs[1].settings.chartType).toBe('candles') // tab 2 untouched
  })

  it('patchChartTab isolates a settings write to one tab', () => {
    let o = addChartTab({ tf: 'D' }, { color: 'A', tf: 'D' })
    o = addChartTab(o, { color: 'A', tf: '5' })
    const tab1 = o.chartTabs[0].id
    const nextSettings = { ...o.chartTabs[0].settings, chartType: 'bars' }
    o = patchChartTab(o, tab1, { settings: nextSettings })
    expect(o.chartTabs[0].settings.chartType).toBe('bars')
    expect(o.chartTabs[1].settings.chartType).toBe('candles') // other tab isolated
  })

  it('closeChartTab removes the tab and keeps a sane active pointer', () => {
    let o = addChartTab({ tf: 'D' }, { color: 'A', tf: '5' })   // active -> 1
    o = addChartTab(o, { color: 'A', tf: '30' })                 // active -> 2
    const first = o.chartTabs[0].id
    // Close the FIRST extra tab while the SECOND is active → active shifts 2→1.
    o = closeChartTab(o, first)
    expect(o.chartTabs).toHaveLength(1)
    expect(o.chartTabs[0].tf).toBe('30')
    expect(o.activeChartTab).toBe(1)
  })

  it('closing the active tab falls back to the previous tab', () => {
    let o = addChartTab({ tf: 'D' }, { color: 'A', tf: '5' })   // active -> 1
    const only = o.chartTabs[0].id
    o = closeChartTab(o, only)                                   // close the active one
    expect(o.chartTabs).toBeUndefined()  // cleaned back to bare single-chart
    expect(o.activeChartTab).toBe(0)     // back to main
  })

  it('setActiveChartTab clamps out-of-range indices', () => {
    let o = addChartTab({ tf: 'D' }, { color: 'A', tf: '5' })
    expect(setActiveChartTab(o, 0).activeChartTab).toBe(0)
    expect(setActiveChartTab(o, 99).activeChartTab).toBe(1)  // clamped to last
    expect(setActiveChartTab(o, -5).activeChartTab).toBe(0)
  })

  it('renameChartTab handles main and extra tabs, and clears on blank', () => {
    let o = addChartTab({ tf: 'D' }, { color: 'A', tf: '30' })
    o = renameChartTab(o, '__main__', 'Swing')
    expect(chartTabList(o)[0].label).toBe('Swing')
    o = renameChartTab(o, '__main__', '   ')
    expect(chartTabList(o)[0].label).toBe('1D') // cleared → auto tf label
    const id = o.chartTabs[0].id
    o = renameChartTab(o, id, 'Scalp')
    expect(chartTabList(o)[1].label).toBe('Scalp')
    o = renameChartTab(o, id, '')
    expect(chartTabList(o)[1].label).toBe('30m') // cleared → auto tf label
  })

  it('sanitize clamps a stale active pointer past the tab count', () => {
    const o = { chartTabs: [{ id: 'a', tf: 'D', color: 'A', settings: {} }], activeChartTab: 5 }
    expect(sanitizeChartTabs(o).active).toBe(0)
  })

  it('drops malformed tab entries defensively', () => {
    const o = { chartTabs: [null, { tf: 'D' }, { id: 'ok', tf: '5', color: 'A', settings: {} }] }
    expect(sanitizeChartTabs(o).tabs).toHaveLength(1)
    expect(sanitizeChartTabs(o).tabs[0].id).toBe('ok')
  })
})
