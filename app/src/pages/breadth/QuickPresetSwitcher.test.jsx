// app/src/pages/breadth/QuickPresetSwitcher.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QuickPresetSwitcher from './QuickPresetSwitcher'

describe('QuickPresetSwitcher', () => {
  it('lists the presets and reflects the active one', () => {
    render(<QuickPresetSwitcher presetNames={['Default', 'Tight']} activePreset="Tight" onSwitch={() => {}} />)
    const sel = screen.getByLabelText('Switch preset')
    expect(sel.value).toBe('Tight')
    expect(screen.getByRole('option', { name: 'Default preset' })).toBeTruthy()
  })

  it('calls onSwitch when a preset is chosen', () => {
    const onSwitch = vi.fn()
    render(<QuickPresetSwitcher presetNames={['Default', 'Tight']} activePreset="Default" onSwitch={onSwitch} />)
    fireEvent.change(screen.getByLabelText('Switch preset'), { target: { value: 'Tight' } })
    expect(onSwitch).toHaveBeenCalledWith('Tight')
  })
})
