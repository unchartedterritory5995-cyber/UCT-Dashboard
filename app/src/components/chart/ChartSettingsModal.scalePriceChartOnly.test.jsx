// "Scale price chart only" (owner, 2026-11-28: Fred RS should scale like his TradingView chart, whose chart-wide
// scalesProperties.scaleSeriesOnly is true). ON by default; the blob holds the key only while OFF, so an untouched
// chart merges byte-identically; Canvas's section reset and copy carry it.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { APPEARANCE_SECTION_KEYS } from './chartAppearance'

const sw = () => screen.getByRole('switch', { name: /^Scale price chart only/ })
const openCanvas = () => { const t = screen.queryByRole('tab', { name: 'Canvas' }); if (t) fireEvent.click(t) }

describe('Scale price chart only', () => {
  it('an untouched chart has it ON and stores nothing', () => {
    const cs = mergeChartSettings(JSON.stringify({}))
    expect('scalePriceChartOnly' in cs).toBe(false)
    render(<ChartSettingsModal open settings={cs} onChange={vi.fn()} />)
    openCanvas()
    expect(sw().getAttribute('aria-checked')).toBe('true')
  })

  it('turning it off writes false, which the next load keeps; turning it on again drops the key', () => {
    const onChange = vi.fn()
    const cs = mergeChartSettings(JSON.stringify({}))
    const { rerender } = render(<ChartSettingsModal open settings={cs} onChange={onChange} />)
    openCanvas()
    fireEvent.click(sw())
    const off = onChange.mock.calls.at(-1)[0]
    expect(off.scalePriceChartOnly).toBe(false)
    const reloaded = mergeChartSettings(JSON.stringify(off))
    expect(reloaded.scalePriceChartOnly).toBe(false)
    rerender(<ChartSettingsModal open settings={reloaded} onChange={onChange} />)
    expect(sw().getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw())
    const on = onChange.mock.calls.at(-1)[0]
    expect(on.scalePriceChartOnly).toBe(true)
    expect('scalePriceChartOnly' in mergeChartSettings(JSON.stringify(on))).toBe(false)
  })

  it('is part of the Canvas section, so section reset and copy carry it', () => {
    expect(APPEARANCE_SECTION_KEYS.canvas).toContain('scalePriceChartOnly')
  })
})
