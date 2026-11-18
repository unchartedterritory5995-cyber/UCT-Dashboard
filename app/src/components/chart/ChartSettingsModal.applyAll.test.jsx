import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'

// Chart Settings → sidebar foot → "Apply to all charts" (owner 11-16, was Soon). The workspace hands the modal a door
// `{ count(), apply() }`; the modal asks inline (never window.confirm), applies on "Apply", says "Applied to N charts",
// and is disabled with a reason when the layout has no other chart. Without a door there is no control at all.

const base = () => mergeChartSettings(JSON.stringify({}))
const door = (n, applied = n) => ({ count: vi.fn(() => n), apply: vi.fn(() => applied) })
const button = () => screen.getByRole('button', { name: /^Apply to all charts$/ })
const mount = (applyToAllCharts) => {
  const onChange = vi.fn()
  render(<ChartSettingsModal open settings={base()} onChange={onChange} applyToAllCharts={applyToAllCharts} />)
  return onChange
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('ChartSettingsModal — Apply to all charts', () => {
  it('no door (a chart outside a workspace layout): no control, and nothing "coming soon" in its place', () => {
    mount(null)
    expect(screen.queryByRole('button', { name: /Apply to all charts/ })).toBeNull()
    expect(document.body.querySelector('[data-apply-all]')).toBeNull()
  })

  it('is a real button now: enabled, an Agent target, no Soon tag', () => {
    mount(door(2))
    const b = button()
    expect(b.disabled).toBe(false)
    expect(b.getAttribute('data-guide')).toBe('chartSettings.applyAll')
    expect(b.closest('[data-soon]')).toBeNull()
    expect(b.getAttribute('aria-label')).toBeNull()                        // its name is its words, not "(coming soon)"
  })

  it('click → an inline confirm with the count; Cancel writes nothing and brings the button back', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const d = door(3)
    const onChange = mount(d)
    fireEvent.click(button())
    expect(screen.getByText('Apply these settings to 3 other charts in this layout?')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Apply')              // the confirm takes focus
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(d.apply).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button())                          // focus back where it was
  })

  it('Apply copies once through the door, then says "Applied to N charts" for a moment', () => {
    vi.useFakeTimers()
    const d = door(3)
    const onChange = mount(d)
    fireEvent.click(button())
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(d.apply).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()                                // THIS chart is not rewritten — it is the source
    expect(screen.getByRole('status').textContent).toBe('Applied to 3 charts')
    expect(button()).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2700) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the words follow the count: one other chart', () => {
    mount(door(1))
    fireEvent.click(button())
    expect(screen.getByText('Apply these settings to 1 other chart in this layout?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('status').textContent).toBe('Applied to 1 chart')
  })

  it('the only chart in the layout: disabled, with the reason beside it, and clicking does nothing', () => {
    const d = door(0)
    mount(d)
    const b = button()
    expect(b.disabled).toBe(true)
    const hint = document.getElementById(b.getAttribute('aria-describedby'))
    expect(hint?.textContent).toBe('No other charts in this layout')
    fireEvent.click(b)
    expect(screen.queryByText(/Apply these settings/)).toBeNull()
    expect(d.apply).not.toHaveBeenCalled()
  })

  it('closing the dialog drops a pending confirm', () => {
    const d = door(2)
    const { rerender } = render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} applyToAllCharts={d} />)
    fireEvent.click(button())
    expect(screen.getByText(/Apply these settings/)).toBeTruthy()
    rerender(<ChartSettingsModal open={false} settings={base()} onChange={vi.fn()} applyToAllCharts={d} />)
    rerender(<ChartSettingsModal open settings={base()} onChange={vi.fn()} applyToAllCharts={d} />)
    expect(screen.queryByText(/Apply these settings/)).toBeNull()
    expect(button()).toBeTruthy()
  })
})
