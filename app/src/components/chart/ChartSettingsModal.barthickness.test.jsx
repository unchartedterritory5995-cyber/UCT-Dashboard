import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// Bar thickness (Price Style tab). Lightweight Charts exposes a single boolean
// (BarStyleOptions.thinBars) and nothing at all on CandlestickSeries, so the control
// is intentionally two-state AND intentionally absent for candles/hollow. These tests
// pin both halves — a future "add more thickness steps" change should fail here first.

const withType = (chartType, extra = {}) =>
  mergeChartSettings(JSON.stringify({ chartType, ...extra }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]

describe('ChartSettingsModal — bar thickness', () => {
  it('defaults to Thin, matching the long-standing look', () => {
    expect(withType('bars').candles.thinBars).toBe(true)
  })

  it.each(['bars', 'hlc'])('shows the control for %s and writes candles.thinBars', (type) => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={withType(type)} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Thick' }))
    expect(lastCall(onChange).candles.thinBars).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Thin' }))
    expect(lastCall(onChange).candles.thinBars).toBe(true)
  })

  it('marks the active option pressed', () => {
    const thick = withType('bars', { candles: { thinBars: false } })
    render(<ChartSettingsModal open settings={thick} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Thick' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Thin' })).toHaveAttribute('aria-pressed', 'false')
  })

  it.each(['candles', 'hollow', 'line', 'area'])(
    'hides the control for %s — the library offers no width option there', (type) => {
      render(<ChartSettingsModal open settings={withType(type)} onChange={vi.fn()} />)
      expect(screen.queryByText('Bar thickness')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Thick' })).toBeNull()
    })

  it('preserves the other candle settings when toggling thickness', () => {
    const onChange = vi.fn()
    const s = withType('bars', { candles: { upColor: '#abcdef' } })
    render(<ChartSettingsModal open settings={s} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Thick' }))
    expect(lastCall(onChange).candles.upColor).toBe('#abcdef')
  })
})
