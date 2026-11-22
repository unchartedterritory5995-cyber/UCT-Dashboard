// app/src/components/chart/ChartSettingsModal.sectionReset.test.jsx — Chart Settings pass 1 (owner 11-15)
//
// "Reset this section": a quiet icon after the open section's title. Two clicks put ONLY that
// section's own keys back to UCT's defaults; every other section, the indicators, the timeframe
// favourites and the header's indicator info values stay exactly as they were. Undoable.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'
import { peekIndicatorHistory, _resetIndicatorHistoryForTests } from './indicatorHistoryStore'

const D = mergeChartSettings(null)
const member = () => mergeChartSettings(JSON.stringify({
  ...D,
  chartType: 'line',
  countdown: true,
  candles: { ...D.candles, upColor: '#123456' },
  grid: { ...D.grid, visible: false },
  crosshair: { ...D.crosshair, magnet: true, color: '#abcdef' },
  swingLabels: { ...D.swingLabels, enabled: true },
  darkPool: { ...D.darkPool, enabled: true },
  indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false }],
  header: { ...D.header, titleMode: 'ticker', timeframes: ['5', 'D'], fields: ['sector'], infoValues: [{ instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto' }] },
}))

beforeEach(() => { _resetIndicatorHistoryForTests(); try { window.sessionStorage.clear() } catch { /* jsdom */ } })

const resetBtn = (name) => screen.getByRole('button', { name: `Reset ${name} to UCT default` })
const confirmBtn = (name) => screen.getByRole('button', { name: `Confirm: reset ${name} to UCT default` })

describe('Reset this section', () => {
  it('Price style: two clicks reset its keys only (type, colours, countdown); undoable', () => {
    const onChange = vi.fn()
    const cs = member()
    render(<ChartSettingsModal open settings={cs} onChange={onChange} historyKey="chart:s" />)
    fireEvent.click(resetBtn('Price style'))
    expect(onChange, 'the first click must only ask').not.toHaveBeenCalled()
    fireEvent.click(confirmBtn('Price style'))
    const next = onChange.mock.calls[0][0]
    expect(next.chartType).toBe(CHART_DEFAULTS.chartType)
    expect(next.countdown).toBe(CHART_DEFAULTS.countdown)
    expect(next.candles.upColor).toBe(CHART_DEFAULTS.candles.upColor)
    expect(next.grid.visible, 'Canvas was touched').toBe(false)
    expect(next.swingLabels.enabled, 'Markers was touched').toBe(true)
    expect(next.indicatorInstances).toEqual(cs.indicatorInstances)
    expect(peekIndicatorHistory('chart:s').past.map((e) => e.label)).toEqual(['Price style reset'])
  })

  it('Canvas keeps the crosshair magnet (the price scale owns it)', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={member()} onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }))
    fireEvent.click(resetBtn('Canvas'))
    fireEvent.click(confirmBtn('Canvas'))
    const next = onChange.mock.calls[0][0]
    expect(next.grid.visible).toBe(true)
    expect(next.crosshair.color).toBe(CHART_DEFAULTS.crosshair.color)
    expect(next.crosshair.magnet).toBe(true)
    expect(next.chartType).toBe('line')
  })

  it('Header & legend keeps the timeframe favourites and the indicator info values', () => {
    const onChange = vi.fn()
    const cs = member()
    render(<ChartSettingsModal open settings={cs} onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Header & legend' }))
    fireEvent.click(resetBtn('Header & legend'))
    fireEvent.click(confirmBtn('Header & legend'))
    const next = onChange.mock.calls[0][0]
    expect(next.header.titleMode).toBe(CHART_DEFAULTS.header.titleMode)
    expect(next.header.fields, 'the stats did not reset').toBeUndefined()
    expect(next.header.timeframes).toEqual(['5', 'D'])
    expect(next.header.infoValues).toEqual(cs.header.infoValues)
  })

  it('Markers resets swing labels and dark pool, not the countdown (Price style owns it now)', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={member()} onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Markers' }))
    fireEvent.click(resetBtn('Markers'))
    fireEvent.click(confirmBtn('Markers'))
    const next = onChange.mock.calls[0][0]
    expect(next.swingLabels.enabled).toBe(CHART_DEFAULTS.swingLabels.enabled)
    expect(next.darkPool.enabled).toBe(false)
    expect(next.countdown).toBe(true)
  })

  it('Indicators shows no section reset (not in pass 1)', () => {
    render(<ChartSettingsModal open settings={member()} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
    expect(screen.queryByRole('button', { name: /^Reset Indicators/ })).toBeNull()
  })
})
