import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// The header per-item color override, driven through the real modal → ColorPanel →
// onChange path. Guards the wiring the merge/default unit tests can't see: that a
// swatch writes header.colors.<key> and "Auto" clears it back to the built-in color.

const base = () => mergeChartSettings(JSON.stringify({}))

function openHeaderTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'Header' }))
}

// Latest onChange payload (the modal emits the whole settings object each edit).
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]

describe('ChartSettingsModal — header color overrides', () => {
  it('picking a color writes header.colors.marketCap without touching other keys', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()

    // Each shown row starts on Auto (built-in color).
    expect(screen.getAllByText('Auto').length).toBeGreaterThanOrEqual(5)

    fireEvent.click(screen.getByTitle('Market cap color'))          // open the picker
    const picker = screen.getByRole('dialog', { name: /Market cap color/i })
    const hex = within(picker).getByDisplayValue('c9a84c')          // effective (auto) default
    fireEvent.change(hex, { target: { value: 'ff0000' } })
    fireEvent.keyDown(hex, { key: 'Enter' })

    const next = lastCall(onChange)
    expect(next.header.colors.marketCap.toLowerCase()).toContain('ff0000')
    expect(next.header.colors.dayChange).toBeUndefined()            // siblings untouched
    expect(next.header.showMarketCap).toBe(true)
    expect(next.preset).toBe('custom')
  })

  it('Auto resets an active override back to the built-in color', () => {
    const onChange = vi.fn()
    const withOverride = mergeChartSettings(JSON.stringify({ header: { colors: { uctRating: '#00ff00' } } }))
    render(<ChartSettingsModal open settings={withOverride} onChange={onChange} />)
    openHeaderTab()

    // The UCT rating row now shows a clickable Auto reset (a <button>, not the tag).
    fireEvent.click(screen.getByRole('button', { name: /Reset UCT rating to automatic/i }))
    const next = lastCall(onChange)
    expect('uctRating' in next.header.colors).toBe(false)           // cleared
  })

  it('hiding an item removes its color controls (override is meaningless when hidden)', () => {
    const onChange = vi.fn()
    const hidden = mergeChartSettings(JSON.stringify({ header: { showNextEarnings: false } }))
    render(<ChartSettingsModal open settings={hidden} onChange={onChange} />)
    openHeaderTab()
    expect(screen.queryByTitle('Next earnings color')).toBeNull()
  })
})
