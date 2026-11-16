// Timeframe menu in UCT Signature style (owner 11-15): picking, favourites, and the custom-interval
// unit as a ChoiceMenu whose portalled list must not close the timeframe menu when clicked.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import TimeframeMenu from './TimeframeMenu'

function setup(extra = {}) {
  const props = { tf: 'D', onSelect: vi.fn(), favorites: ['5'], onToggleFav: vi.fn(), customCodes: [], onAddCustom: vi.fn(), onRemoveCustom: vi.fn(), onClose: vi.fn(), anchor: { left: 10, bottom: 20 }, ...extra }
  render(<TimeframeMenu {...props} />)
  return props
}

describe('TimeframeMenu (UCT Signature)', () => {
  it('marks the current timeframe and picks another', () => {
    const p = setup()
    expect(screen.getByRole('button', { name: '1D' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '5m' }))
    expect(p.onSelect).toHaveBeenCalledWith('5')
  })
  it('toggles a favourite with the star', () => {
    const p = setup()
    expect(screen.getByRole('button', { name: 'Remove 5m from favorites' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Add 15m to favorites' }))
    expect(p.onToggleFav).toHaveBeenCalledWith('15')
  })
  it('adds a custom interval with the unit dropdown, and the dropdown list does not close the menu', async () => {
    vi.useFakeTimers()
    const p = setup()
    act(() => { vi.runAllTimers() })
    vi.useRealTimers()
    fireEvent.change(screen.getByLabelText('Interval count'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Interval unit: Minutes' }))
    const opt = screen.getByRole('option', { name: /Hours/ })
    fireEvent.mouseDown(opt)
    fireEvent.click(opt)
    expect(p.onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(p.onAddCustom).toHaveBeenCalledTimes(1)
    expect(p.onAddCustom.mock.calls[0][0]).toBeTruthy()
  })
  it('still closes on a click outside', () => {
    vi.useFakeTimers()
    const p = setup()
    act(() => { vi.runAllTimers() })
    vi.useRealTimers()
    fireEvent.mouseDown(document.body)
    expect(p.onClose).toHaveBeenCalled()
  })
})
