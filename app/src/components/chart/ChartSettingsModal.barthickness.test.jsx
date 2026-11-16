import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// Thin bars (Price style → Colors). Lightweight Charts exposes a single boolean
// (BarStyleOptions.thinBars) and nothing at all on CandlestickSeries, so the control
// is intentionally an on/off AND intentionally absent for candles/hollow. These tests
// pin both halves — a future "add more thickness steps" change should fail here first.
// (owner 11-15: it was a Bar thickness Thin/Thick menu; it is the "Thin bars" soft square now.)

const withType = (chartType, extra = {}) =>
  mergeChartSettings(JSON.stringify({ chartType, ...extra }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]
const thinBars = () => screen.getByRole('switch', { name: 'Thin bars' })

describe('ChartSettingsModal — thin bars', () => {
  it('defaults to Thin, matching the long-standing look', () => {
    expect(withType('bars').candles.thinBars).toBe(true)
  })

  it.each(['bars', 'hlc'])('shows the control for %s and writes candles.thinBars', (type) => {
    const onChange = vi.fn()
    const { rerender } = render(<ChartSettingsModal open settings={withType(type)} onChange={onChange} />)

    fireEvent.click(thinBars())
    expect(lastCall(onChange).candles.thinBars).toBe(false)

    // the switch shows the CURRENT value, so hand the window its new (thick) settings first
    rerender(<ChartSettingsModal open settings={withType(type, { candles: { thinBars: false } })} onChange={onChange} />)
    fireEvent.click(thinBars())
    expect(lastCall(onChange).candles.thinBars).toBe(true)
  })

  it('shows the active state', () => {
    const thick = withType('bars', { candles: { thinBars: false } })
    render(<ChartSettingsModal open settings={thick} onChange={vi.fn()} />)

    expect(thinBars().getAttribute('aria-checked')).toBe('false')
  })

  it.each(['candles', 'hollow', 'line', 'area'])(
    'hides the control for %s — the library offers no width option there', (type) => {
      render(<ChartSettingsModal open settings={withType(type)} onChange={vi.fn()} />)
      expect(screen.queryByText('Thin bars')).toBeNull()
      expect(screen.queryByRole('switch', { name: 'Thin bars' })).toBeNull()
    })

  it('preserves the other candle settings when toggling thickness', () => {
    const onChange = vi.fn()
    const s = withType('bars', { candles: { upColor: '#abcdef' } })
    render(<ChartSettingsModal open settings={s} onChange={onChange} />)

    fireEvent.click(thinBars())
    expect(lastCall(onChange).candles.upColor).toBe('#abcdef')
  })
})
