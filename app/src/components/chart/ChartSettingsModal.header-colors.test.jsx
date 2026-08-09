import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { HEADER_FIELD_BY_KEY } from './headerFields'

// The header per-item colors, driven through the real modal → ColorPanel → onChange
// path. Guards the wiring the merge/default unit tests can't see: that a swatch writes
// the right header.colors.<key>, that Day change exposes TWO swatches (up / down), and
// that hidden items expose no color controls.

const base = () => mergeChartSettings(JSON.stringify({}))
const openHeaderTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Header' }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]

// The Info Row swatches are titled `${field.label} color` from the very catalog the
// modal renders them out of, so DERIVE the title instead of restating it. A hand-typed
// copy went stale the moment the field was relabelled "Market Cap" — and the negative
// assertions below then matched nothing and asserted nothing, which is the worse half.
const fieldColorTitle = (key) => `${HEADER_FIELD_BY_KEY[key].label} color`

function pickColor(pickerLabel, nextHex) {
  fireEvent.click(screen.getByTitle(pickerLabel))                     // open the picker
  const picker = screen.getByRole('dialog', { name: new RegExp(pickerLabel, 'i') })
  const hex = within(picker).getByRole('textbox')  // the panel's one text field is the hex box
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
    pickColor('Up-day color', '00ff00')
    expect(lastCall(onChange).header.colors.dayChangeUp.toLowerCase()).toContain('00ff00')

    pickColor('Down-day color', '0000ff')
    const next = lastCall(onChange)
    expect(next.header.colors.dayChangeDown.toLowerCase()).toContain('0000ff')
    expect(next.header.showChange).toBe(true)
    expect(next.preset).toBe('custom')
  })

  it('single-color items write their own key without touching siblings', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openHeaderTab()

    pickColor(fieldColorTitle('mcap'), 'ff0000')
    const next = lastCall(onChange)
    expect(next.header.colors.marketCap.toLowerCase()).toContain('ff0000')
    expect(next.header.colors.nextEarnings).toBeUndefined()
    expect(next.header.showMarketCap).toBe(true)
  })

  it('hiding an item removes its color swatch(es)', () => {
    // Prove the swatches are there FIRST. Without this the disappearance below can
    // be satisfied by a title that never matched anything — which is precisely what
    // this assertion had quietly decayed into.
    const shown = render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openHeaderTab()
    expect(screen.getByTitle(fieldColorTitle('earn'))).toBeInTheDocument()
    expect(screen.getByTitle('Up-day color')).toBeInTheDocument()
    expect(screen.getByTitle('Down-day color')).toBeInTheDocument()
    shown.unmount()

    const hidden = mergeChartSettings(JSON.stringify({ header: { showNextEarnings: false, showChange: false } }))
    render(<ChartSettingsModal open settings={hidden} onChange={vi.fn()} />)
    openHeaderTab()
    expect(screen.queryByTitle(fieldColorTitle('earn'))).toBeNull()
    expect(screen.queryByTitle('Up-day color')).toBeNull()
    expect(screen.queryByTitle('Down-day color')).toBeNull()
  })
})
