// app/src/components/chart/ChartSettingsModal.restoreDefaults.test.jsx — A1.3 (D5)
//
// Restore Defaults resets the chart's LOOK and keeps the member's indicators; the reset is
// recorded on the chart's Undo stack ("Chart appearance reset") and Undo brings the look back.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'
import { peekIndicatorHistory, undoIndicatorChange, _resetIndicatorHistoryForTests } from './indicatorHistoryStore'

const member = () => mergeChartSettings(JSON.stringify({
  ...mergeChartSettings(null),
  chartType: 'line',
  indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false }],
  indicators: { rsi: { enabled: true, period: 7 } },
  header: { ...(mergeChartSettings(null).header || {}), infoValues: [{ instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto' }] },
}))

beforeEach(() => { _resetIndicatorHistoryForTests(); try { window.sessionStorage.clear() } catch { /* jsdom */ } })

describe('A1.3 — Restore Defaults keeps indicators', () => {
  it('two clicks: the look resets, the indicators, mirror and info values stay; it is undoable', () => {
    const onChange = vi.fn()
    const cs = member()
    render(<ChartSettingsModal open settings={cs} onChange={onChange} historyKey="chart:t" />)
    const btn = screen.getByTitle('Resets chart appearance. Your indicators stay.')
    fireEvent.click(btn)
    fireEvent.click(screen.getByText('Confirm?'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0]
    expect(next.chartType, 'the look did not reset').toBe(CHART_DEFAULTS.chartType)
    expect(next.indicatorInstances, 'Restore Defaults deleted the indicators').toEqual(cs.indicatorInstances)
    expect(next.indicators).toEqual(cs.indicators)
    expect(next.header.infoValues).toEqual(cs.header.infoValues)
    const { past } = peekIndicatorHistory('chart:t')
    expect(past.map((e) => e.label)).toEqual(['Chart appearance reset'])
    let restored = null
    expect(undoIndicatorChange('chart:t', next, (x) => { restored = x }).ok).toBe(true)
    expect(restored.chartType, 'Undo did not bring the look back').toBe('line')
  })
})
