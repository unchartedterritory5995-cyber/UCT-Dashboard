// app/src/pages/breadth/PresetRow.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PresetRow from './PresetRow'

const PRESETS = [
  { id: 'health', label: 'Market Health', hint: 'the daily read', metrics: ['a'] },
  { id: 'thrust', label: 'Breadth Thrust', hint: 'ignition', metrics: ['b'] },
  { id: 'froth', label: 'Froth', group: 'Momentum', hint: 'late-move heat', metrics: ['c'] },
  { id: 'risk', label: 'Risk Appetite', group: 'Leadership', hint: 'who is bought', metrics: ['d'] },
]
const ORDER = ['Leadership', 'Momentum']

const setup = (props = {}) =>
  render(<PresetRow presets={PRESETS} groupOrder={ORDER} activePreset={null} onApply={() => {}} {...props} />)

describe('PresetRow', () => {
  it('shows ungrouped presets as pills and hides grouped ones behind More', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Market Health' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Breadth Thrust' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Froth/ })).toBeNull()
  })

  it('applies a preset from a pill', () => {
    const onApply = vi.fn()
    setup({ onApply })
    fireEvent.click(screen.getByRole('button', { name: 'Market Health' }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[0])
  })

  it('opens the popover in declared group order and applies from it', () => {
    const onApply = vi.fn()
    setup({ onApply })
    const trigger = screen.getByRole('button', { name: /More/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const headings = screen.getAllByRole('presentation').map(n => n.textContent)
    expect(headings).toEqual(['Leadership', 'Momentum'])

    fireEvent.click(screen.getByRole('option', { name: /Risk Appetite/ }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[3])
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows each hint so the popover explains what it is offering', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /More/ }))
    expect(screen.getByText('who is bought')).toBeTruthy()
  })

  it('closes on Escape and on an outside click', () => {
    setup()
    const trigger = screen.getByRole('button', { name: /More/ })

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  // The band must never look like nothing is selected just because the active
  // preset lives behind More.
  it('names the active preset on the trigger when it lives in the popover', () => {
    setup({ activePreset: 'risk' })
    expect(screen.getByRole('button', { name: 'More: Risk Appetite' })).toBeTruthy()
  })

  it('marks the active pill and leaves the trigger plain', () => {
    setup({ activePreset: 'health' })
    expect(screen.getByRole('button', { name: 'Market Health' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })
})
