// S12 remainder (audit M9, point 2): in phone chart mode the chart drops its auto-labels -- the company
// watermark, Chart IQ and the pattern layer -- through StockChart's VIEW-ONLY props, never its settings,
// until Insights asks for Chart IQ and the patterns back. Off phone mode the props are exactly as before.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const got = vi.hoisted(() => ({ pane: null }))
vi.mock('../../../../components/chart/pane/ChartPane', async () => {
  const { forwardRef } = await import('react')
  return { default: forwardRef(function Pane(props) { got.pane = props; return <div /> }) }
})

import ChartEmbed from './ChartEmbed'

const attrs = { widgetId: 'chart', mode: 'snapshot', params: { symbol: 'NVDA', tf: 'D', settings: { showChartIq: true } } }
beforeEach(() => { got.pane = null })

describe('ChartEmbed phone mode', () => {
  it('drops the watermark, Chart IQ and the pattern labels until Insights is on', () => {
    render(<ChartEmbed attrs={attrs} phoneMode />)
    expect(got.pane.stockChartProps).toMatchObject({ hideWatermark: true, disablePatterns: true })
  })

  it('Insights brings Chart IQ and the patterns back; the watermark stays off', () => {
    render(<ChartEmbed attrs={attrs} phoneMode insights />)
    expect(got.pane.stockChartProps.hideWatermark).toBe(true)
    expect(got.pane.stockChartProps).not.toHaveProperty('disablePatterns')
  })

  it('writes nothing: the stored settings reach the pane untouched', () => {
    render(<ChartEmbed attrs={attrs} phoneMode />)
    expect(got.pane.stored).toEqual({ showChartIq: true })
  })

  it('off phone mode the chart props carry neither key (desktop unchanged)', () => {
    render(<ChartEmbed attrs={attrs} />)
    expect(got.pane.stockChartProps).not.toHaveProperty('hideWatermark')
    expect(got.pane.stockChartProps).not.toHaveProperty('disablePatterns')
  })
})
