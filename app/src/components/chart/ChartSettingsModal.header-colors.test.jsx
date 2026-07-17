import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// The header per-item colors, driven through the real modal → ColorPanel → onChange
// path. Guards the wiring the merge/default unit tests can't see: that a swatch writes
// the right header.colors.<key>, that Day change exposes TWO swatches (up / down), and
// that hidden items expose no color controls.

const base = () => mergeChartSettings(JSON.stringify({}))
const openHeaderTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Header' }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]

function pickColor(pickerLabel, currentHex, nextHex) {
  fireEvent.click(screen.getByTitle(pickerLabel))                     // open the picker
  const picker = screen.getByRole('dialog', { name: new RegExp(pickerLabel, 'i') })
  const hex = within(picker).getByDisplayValue(currentHex)
  fireEvent.change(hex, { target: { value: nextHex } })
  fireEvent.keyDown(hex, { key: 'Enter' })
}

describe('ChartSettingsModal — header colors', () => {
  it('there is no Auto affordance anywhere in the Show section', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openHeaderTab()
    expect(screen.queryByText('Auto')).toBeNull()
  })

  it('Day change exposes an up-day and a down-day swatch that write separate colors', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()

    // Two swatches on the day-change row (defaults: green up / red down).
    pickColor('Up-day color', '1ae51a', '00ff00')
    expect(lastCall(onChange).header.colors.dayChangeUp.toLowerCase()).toContain('00ff00')

    pickColor('Down-day color', 'ff3b47', '0000ff')
    const next = lastCall(onChange)
    expect(next.header.colors.dayChangeDown.toLowerCase()).toContain('0000ff')
    expect(next.header.showChange).toBe(true)
    expect(next.preset).toBe('custom')
  })

  it('single-color items write their own key without touching siblings', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()

    pickColor('Market cap color', 'c9a84c', 'ff0000')
    const next = lastCall(onChange)
    expect(next.header.colors.marketCap.toLowerCase()).toContain('ff0000')
    expect(next.header.colors.nextEarnings).toBeUndefined()
    expect(next.header.showMarketCap).toBe(true)
  })

  it('hiding an item removes its color swatch(es)', () => {
    const hidden = mergeChartSettings(JSON.stringify({ header: { showNextEarnings: false, showChange: false } }))
    render(<ChartSettingsModal open settings={hidden} onChange={vi.fn()} />)
    openHeaderTab()
    expect(screen.queryByTitle('Next earnings color')).toBeNull()
    expect(screen.queryByTitle('Up-day color')).toBeNull()
    expect(screen.queryByTitle('Down-day color')).toBeNull()
  })
})
