import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// The Markers tab (ported from the old gear panel): swing labels, event markers,
// and the bar-close countdown. Guards that each control writes the setting the
// workspace chart actually reads (cs.swingLabels / cs.markers / cs.countdown).

const base = () => mergeChartSettings(JSON.stringify({}))
const openMarkers = () => fireEvent.click(screen.getByRole('tab', { name: 'Markers' }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]

describe('ChartSettingsModal — Markers tab', () => {
  it('enabling swing prices reveals sensitivity + color and writes swingLabels.enabled', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openMarkers()

    // Collapsed until enabled.
    expect(screen.queryByRole('tab', { name: 'Med' })).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: 'Swing prices' }))
    expect(lastCall(onChange).swingLabels.enabled).toBe(true)
  })

  it('sensitivity + tint-by-type colors write through', () => {
    const onChange = vi.fn()
    const enabled = mergeChartSettings(JSON.stringify({ swingLabels: { enabled: true, tintByType: true } }))
    render(<ChartSettingsModal open settings={enabled} onChange={onChange} />)
    openMarkers()

    fireEvent.click(screen.getByRole('tab', { name: 'High' }))
    expect(lastCall(onChange).swingLabels.sensitivity).toBe('high')

    // Tint-by-type on → up/down swatches are present; pick the up color.
    fireEvent.click(screen.getByTitle('Swing-high color'))
    const picker = screen.getByRole('dialog', { name: /Swing-high color/i })
    const hex = within(picker).getByDisplayValue('4ade80')
    fireEvent.change(hex, { target: { value: '00ff00' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(lastCall(onChange).swingLabels.upColor.toLowerCase()).toContain('00ff00')
  })

  it('the label-background swatch writes swingLabels.bg', () => {
    const onChange = vi.fn()
    const enabled = mergeChartSettings(JSON.stringify({ swingLabels: { enabled: true } }))
    render(<ChartSettingsModal open settings={enabled} onChange={onChange} />)
    openMarkers()

    fireEvent.click(screen.getByTitle('Swing label background'))
    const picker = screen.getByRole('dialog', { name: /Swing label background/i })
    // Unset bg → swatch defaults to the canvas background color.
    const hex = within(picker).getByDisplayValue(enabled.background.replace(/^#/, ''))
    fireEvent.change(hex, { target: { value: '112233' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(lastCall(onChange).swingLabels.bg.toLowerCase()).toContain('112233')
  })

  it('the label-background toggle turns the box off, hiding its swatch', () => {
    const onChange = vi.fn()
    const enabled = mergeChartSettings(JSON.stringify({ swingLabels: { enabled: true } }))
    render(<ChartSettingsModal open settings={enabled} onChange={onChange} />)
    openMarkers()

    // Default on → swatch present.
    expect(screen.getByTitle('Swing label background')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Label background' }))
    expect(lastCall(onChange).swingLabels.bgEnabled).toBe(false)
  })

  it('with the background off, no swatch is shown', () => {
    const off = mergeChartSettings(JSON.stringify({ swingLabels: { enabled: true, bgEnabled: false } }))
    render(<ChartSettingsModal open settings={off} onChange={vi.fn()} />)
    openMarkers()
    expect(screen.queryByTitle('Swing label background')).toBeNull()
  })

  it('event-marker toggles write cs.markers.<key> without disturbing siblings', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openMarkers()

    fireEvent.click(screen.getByRole('switch', { name: 'Earnings' }))
    const next = lastCall(onChange)
    expect(next.markers.earnings).toBe(true)
    expect(next.markers.splits).toBe(false)   // sibling intact
    expect(next.preset).toBe('custom')
  })

  it('earnings shows Beat/Miss color swatches only when on; they write markers colors', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openMarkers()

    // Off by default → no beat/miss swatches.
    expect(screen.queryByTitle('Beat color')).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: 'Earnings' }))
    // (onChange emits earnings:true; re-render with it on to reveal the swatches)
    const withEarnings = mergeChartSettings(JSON.stringify({ markers: { earnings: true } }))
    onChange.mockClear()
    render(<ChartSettingsModal open settings={withEarnings} onChange={onChange} />)
    // second modal instance — target its Markers tab
    fireEvent.click(screen.getAllByRole('tab', { name: 'Markers' })[1])

    const beat = screen.getByTitle('Beat color')
    fireEvent.click(beat)
    const picker = screen.getByRole('dialog', { name: /Beat color/i })
    const hex = within(picker).getByDisplayValue('2faf68')
    fireEvent.change(hex, { target: { value: '00ff00' } })
    fireEvent.keyDown(hex, { key: 'Enter' })
    expect(lastCall(onChange).markers.earningsBeat.toLowerCase()).toContain('00ff00')
  })

  // ── Desk mentions (spec 2026-08-11 §C) ──
  // A category, not a mechanism: it must behave exactly like its siblings. These
  // three assert the parts a new key can get wrong on its own — the default, the
  // write, and the round-trip (it carries NO entry in CHART_DEFAULTS.markers, so
  // mergeChartSettings has to preserve it purely by spreading the saved blob).
  it('Desk mentions is OFF by default and its toggle writes cs.markers.desk', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openMarkers()

    const sw = screen.getByRole('switch', { name: 'Desk mentions' })
    expect(sw.getAttribute('aria-checked')).toBe('false')   // opt-in, like News

    fireEvent.click(sw)
    const next = lastCall(onChange)
    expect(next.markers.desk).toBe(true)
    expect(next.markers.news).toBe(false)      // sibling intact
    expect(next.markers.earnings).toBe(false)  // sibling intact
    expect(next.preset).toBe('custom')
  })

  it('a saved markers.desk survives the settings round-trip and renders checked', () => {
    const saved = mergeChartSettings(JSON.stringify({ markers: { desk: true } }))
    expect(saved.markers.desk).toBe(true)      // the merge kept a key defaults never name
    render(<ChartSettingsModal open settings={saved} onChange={vi.fn()} />)
    openMarkers()
    expect(screen.getByRole('switch', { name: 'Desk mentions' }).getAttribute('aria-checked')).toBe('true')
  })

  it('turning Desk mentions back off writes false, not a deleted key', () => {
    const onChange = vi.fn()
    const saved = mergeChartSettings(JSON.stringify({ markers: { desk: true } }))
    render(<ChartSettingsModal open settings={saved} onChange={onChange} />)
    openMarkers()
    fireEvent.click(screen.getByRole('switch', { name: 'Desk mentions' }))
    expect(lastCall(onChange).markers.desk).toBe(false)
  })

  it('countdown toggle writes cs.countdown', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openMarkers()
    fireEvent.click(screen.getByRole('switch', { name: /Countdown to bar close/i }))
    expect(lastCall(onChange).countdown).toBe(true)
  })
})
